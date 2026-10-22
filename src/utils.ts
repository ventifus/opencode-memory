/**
 * Project-wing naming. Applied per-session (via each session's own
 * `location.directory`, resolved through `ctx.session.get`) — never derived
 * from the plugin's own load-time location, since a single plugin instance
 * can observe sessions rooted in different directories (see
 * `packages/plugin/src/promise/plugin.ts`'s doc comment on `ctx.location`).
 */
export function wingFromDirectory(directory: string | undefined | null): string {
  if (!directory || directory === '/') {
    return 'wing_general';
  }
  const base = directory.split(/[\\/]/).filter(Boolean).pop() ?? '';
  const sanitized = base.toLowerCase().replace(/[^a-z0-9]/g, '-');
  return sanitized ? `wing_${sanitized}` : 'wing_general';
}

/** Shared cross-project, cross-session, cross-tool wing for diary + compaction summaries. */
export const AGENT_WING = 'wing_agent';
