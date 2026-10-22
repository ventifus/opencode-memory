import { Plugin } from '@opencode/plugin';
import { addDrawer, isMempalaceReachable, AGENT_NAME } from './mempalace-client.js';
import { classifyNewMessages } from './transcript.js';
import { SessionState } from './state.js';
import { wingFromDirectory, AGENT_WING } from './utils.js';

const CONVERSATIONS_ROOM = 'conversations';
const SUMMARIES_ROOM = 'session-summaries';
const DEFAULT_NUDGE_THRESHOLD = 15;

const NUDGE_TEXT = [
  '[MemPalace] You have exchanged several messages this session.',
  `If anything durable happened (a decision, a milestone, a resolved problem, a stated preference),`,
  `call mempalace_mempalace_kg_add now (subject/predicate/object, 128 chars or fewer).`,
  `If this feels like a natural stopping point — or this session has spanned multiple projects worth`,
  `tying together — also consider a reflective mempalace_mempalace_diary_write entry`,
  `(agent_name: "${AGENT_NAME}", topic: the current project) and, if two projects turned out to be`,
  `genuinely related, mempalace_mempalace_create_tunnel. Don't force it — only write what's genuinely`,
  'durable. Then continue normally.',
].join(' ');

/** Wing is resolved per-session (never from the plugin's own load location — a single instance can
 * observe sessions rooted in different directories; see `Context.location`'s own doc comment). */
async function wingForSession(ctx: Plugin.Context, sessionID: string): Promise<string> {
  try {
    const session = await ctx.session.get({ sessionID });
    return wingFromDirectory(session?.location?.directory);
  } catch {
    return 'wing_general';
  }
}

/**
 * Reads the session's full, authoritative message history and files
 * everything new since the last flush. Because this always re-reads from
 * `ctx.session.context()` (the durable record) rather than anything
 * accumulated in memory, a plugin restart mid-session loses nothing — the
 * next flush just resumes from the stored cursor.
 */
async function flushSession(ctx: Plugin.Context, state: SessionState, sessionID: string): Promise<void> {
  try {
    if (!(await isMempalaceReachable())) return;

    const afterID = await state.getLastMessageID(sessionID);
    const messages = await ctx.session.context({ sessionID });
    if (messages.length === 0) return;

    const units = classifyNewMessages(messages, afterID);
    const wing = await wingForSession(ctx, sessionID);

    let cursor = afterID;
    let allFiled = true;
    for (const unit of units) {
      const isCompaction = unit.kind === 'compaction';
      const ok = await addDrawer(
        isCompaction ? AGENT_WING : wing,
        isCompaction ? SUMMARIES_ROOM : CONVERSATIONS_ROOM,
        unit.text,
        `opencode-session:${sessionID}`,
      );
      if (!ok) {
        allFiled = false;
        break;
      }
      cursor = unit.endID;
    }

    // Everything filed (including any trailing skip-only messages with nothing
    // to file) — safe to advance all the way to the tail so the next flush
    // doesn't re-scan a run of ignorable messages forever. A partial failure
    // instead stops exactly at the last unit that actually filed, so a
    // transient mempalace outage retries just the unfiled remainder next time.
    if (allFiled) {
      const tail = messages[messages.length - 1]?.id;
      if (tail) cursor = tail;
    }

    if (cursor !== afterID && cursor) {
      await state.setLastMessageID(sessionID, cursor);
    }
  } catch (error) {
    console.warn(`[opencode-memory] flushSession failed for ${sessionID}:`, error);
  }
}

/**
 * This plugin has exactly one job: make sure the conversation ends up in
 * mempalace without the agent having to remember to call a checkpoint tool
 * itself. Wake-up / context-injection is NOT this plugin's responsibility —
 * OpenCode already has mempalace registered as a normal MCP server, and the
 * agent drives its own recall (mempalace_search, mempalace_diary_read, etc.)
 * per mempalace's own integration protocol (see the bundled
 * mempalace-memory skill). Duplicating that here would just inject the
 * same context twice through two different paths.
 */
export default Plugin.define({
  id: 'opencode-memory',

  async setup(ctx) {
    const threshold = (ctx.options?.threshold as number) ?? DEFAULT_NUDGE_THRESHOLD;
    const state = new SessionState(ctx.storage, threshold);

    await ctx.session.hook('prompt', async (event) => {
      await state.noteTurn(event.sessionID);
    });

    await ctx.session.hook('context', async (event) => {
      if (await state.consumeNudgePending(event.sessionID)) {
        event.system.push({ type: 'text', text: NUDGE_TEXT });
      }
    });

    const controller = new AbortController();
    const subscription = (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          switch (event.type) {
            // `session.idle` is deprecated and, as far as we've observed, no
            // longer actually published — "going idle" is now recorded only
            // as a `type: "idle"` marker message in the session's own
            // history (already skipped as noise in classifyNewMessages).
            // `session.execution.*` are the real, live, per-turn completion
            // signals: fired reliably right after each turn's execution
            // concludes, regardless of outcome — no extra inactivity debounce
            // to wait on, unlike idle ever was.
            case 'session.execution.succeeded':
            case 'session.execution.failed':
            case 'session.execution.interrupted':
              await flushSession(ctx, state, event.data.sessionID);
              break;
            case 'session.deleted':
              await flushSession(ctx, state, event.data.sessionID);
              await state.forgetSession(event.data.sessionID);
              break;
            default:
              break;
          }
        }
      } catch (error) {
        if ((error as { name?: string })?.name !== 'AbortError') {
          console.warn('[opencode-memory] event subscription ended unexpectedly:', error);
        }
      }
    })();

    return () => {
      controller.abort();
      return subscription;
    };
  },
});
