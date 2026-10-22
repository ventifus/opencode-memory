import type { Plugin } from '@opencode/plugin';

type StorageDomain = Plugin.Context['storage'];

const LAST_MESSAGE_KEY = (sessionID: string) => `session:${sessionID}:lastMessageID`;
const TURN_COUNT_KEY = (sessionID: string) => `session:${sessionID}:turnCount`;
const NUDGE_PENDING_KEY = (sessionID: string) => `session:${sessionID}:nudgePending`;

/**
 * Per-session durable state, entirely backed by `ctx.storage` (auto-namespaced
 * per plugin — see `packages/core/src/plugin/host.ts`'s `storage()`). No
 * in-memory accumulator: the message content itself always comes from
 * `ctx.session.context()`, the authoritative durable record, not anything
 * this plugin buffers — only the "how far have we already filed" cursor and
 * the nudge bookkeeping need to persist here.
 */
export class SessionState {
  constructor(
    private readonly storage: StorageDomain,
    private readonly nudgeThreshold: number,
  ) {}

  async getLastMessageID(sessionID: string): Promise<string | undefined> {
    return (await this.storage.get(LAST_MESSAGE_KEY(sessionID))) as string | undefined;
  }

  async setLastMessageID(sessionID: string, messageID: string): Promise<void> {
    await this.storage.set(LAST_MESSAGE_KEY(sessionID), messageID);
  }

  /**
   * Called on every `prompt` hook firing (once per real user turn — proven
   * distinct from the `context` hook, which fires once per agent step).
   * Increments the durable turn counter and, once the threshold is crossed,
   * sets a one-shot pending-nudge flag consumed later by the `context` hook
   * (which has tool access; `prompt` and `compaction` do not).
   */
  async noteTurn(sessionID: string): Promise<void> {
    const key = TURN_COUNT_KEY(sessionID);
    const current = ((await this.storage.get(key)) as number | undefined) ?? 0;
    const next = current + 1;
    if (next >= this.nudgeThreshold) {
      await this.storage.set(key, 0);
      await this.storage.set(NUDGE_PENDING_KEY(sessionID), true);
    } else {
      await this.storage.set(key, next);
    }
  }

  /** True at most once per threshold crossing; clears the flag so a multi-step turn nudges only once. */
  async consumeNudgePending(sessionID: string): Promise<boolean> {
    const key = NUDGE_PENDING_KEY(sessionID);
    const pending = (await this.storage.get(key)) as boolean | undefined;
    if (!pending) return false;
    await this.storage.remove(key);
    return true;
  }

  async forgetSession(sessionID: string): Promise<void> {
    await this.storage.remove(LAST_MESSAGE_KEY(sessionID));
    await this.storage.remove(TURN_COUNT_KEY(sessionID));
    await this.storage.remove(NUDGE_PENDING_KEY(sessionID));
  }
}
