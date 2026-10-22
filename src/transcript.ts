import type { Plugin } from '@opencode/plugin';

/**
 * One entry from a session's full, canonical message history
 * (`ctx.session.context({ sessionID })`) — the durable record itself, not a
 * live-event reconstruction. Reading from here means a plugin restart mid
 * session never loses anything: the next flush just resumes from wherever
 * `afterID` was left, because the source of truth is OpenCode's own message
 * store, not this plugin's memory.
 */
export type SessionMessage = Awaited<ReturnType<Plugin.Context['session']['context']>>[number];

export type ClassifiedUnit = {
  /** Where to advance the per-session cursor to if this unit files successfully. */
  readonly endID: string;
  readonly kind: 'exchange' | 'compaction';
  readonly text: string;
};

function assistantText(message: Extract<SessionMessage, { type: 'assistant' }>): string {
  return message.content
    .filter((part): part is Extract<(typeof message.content)[number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n');
}

function quoteUser(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * Walks a session's full message history starting after `afterID` (exclusive),
 * grouping it into filing units:
 *
 * - One "exchange" per user turn: that message's text plus every assistant
 *   text block that follows, up to (not including) the next user message —
 *   matches mempalace's own `>`-quoted exchange-pair convention
 *   (`convo_miner.chunk_exchanges`).
 * - One "compaction" unit per completed compaction message
 *   (`type: "compaction", status: "completed"`) — compaction appears
 *   in-line in the same history array as just another message kind, filed
 *   independently of exchange grouping since it belongs in a different
 *   wing/room regardless of where it falls relative to a pending exchange.
 *
 * Every other message kind (agent-switched, synthetic, system, skill, shell,
 * idle markers, running/failed compaction) is structural/control noise for
 * this plugin's purposes — skipped, neither starting nor interrupting
 * exchange accumulation.
 *
 * If `afterID` is not found (e.g. history was pruned since), every message is
 * treated as new rather than silently dropped. Assistant text that arrives
 * with no user message earlier in this same batch (should not normally
 * happen given execution-completion-gated flushing, but defensively handled
 * rather than dropped) is still filed, just without the `>`-quoted user block.
 */
export function classifyNewMessages(
  messages: readonly SessionMessage[],
  afterID: string | undefined,
): ClassifiedUnit[] {
  let startIndex = 0;
  if (afterID) {
    const idx = messages.findIndex((m) => m.id === afterID);
    if (idx >= 0) startIndex = idx + 1;
  }

  const units: ClassifiedUnit[] = [];
  let pendingUserText: string | undefined;
  let pendingAssistant: string[] = [];
  let pendingEndID: string | undefined;

  const flushPending = () => {
    if (pendingUserText === undefined && pendingAssistant.length === 0) return;
    const assistant = pendingAssistant.join('\n');
    const text =
      pendingUserText !== undefined
        ? assistant
          ? `${quoteUser(pendingUserText)}\n\n${assistant}`
          : quoteUser(pendingUserText)
        : assistant;
    if (text.trim() && pendingEndID) {
      units.push({ kind: 'exchange', endID: pendingEndID, text });
    }
    pendingUserText = undefined;
    pendingAssistant = [];
    pendingEndID = undefined;
  };

  for (let i = startIndex; i < messages.length; i++) {
    const message = messages[i];
    switch (message.type) {
      case 'user':
        flushPending();
        pendingUserText = message.text;
        pendingEndID = message.id;
        break;
      case 'assistant': {
        const text = assistantText(message);
        if (text) pendingAssistant.push(text);
        pendingEndID = message.id;
        break;
      }
      case 'compaction':
        if (message.status === 'completed' && message.summary.trim()) {
          units.push({ kind: 'compaction', endID: message.id, text: message.summary });
        }
        break;
      default:
        break; // agent-switched, synthetic, system, skill, shell, idle, model-selected, location-switched
    }
  }
  flushPending();
  return units;
}
