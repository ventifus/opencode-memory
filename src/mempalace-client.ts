/**
 * High-level mempalace write path, built on the stateless HTTP MCP client.
 *
 * This plugin's only job is making sure content reaches mempalace
 * automatically — recall and journaling (search, kg_query, kg_add,
 * diary_write/diary_read) are the agent's own job, per the bundled
 * mempalace-memory skill. So the only writes this module ever performs are
 * the two mechanical capture paths: verbatim transcript exchanges and
 * OpenCode's own compaction summaries. It never calls diary_write or any
 * kg_* tool — those require genuine agent judgment, not a mechanical hook.
 */

import { callTool, isReachable as mcpIsReachable, McpUnavailableError } from './mcp-client.js';

export { isReachable } from './mcp-client.js';

/**
 * Fixed identity used for every write this plugin ever makes — never
 * computed, never session- or model-specific. A journal fragmented by
 * session ID is orphaned the moment that session ends (nothing can query
 * for an identity it doesn't already know), and there is no principled
 * reason to partition by which tool or instance happens to be running:
 * concurrency and tool choice are exactly as irrelevant to "whose journal
 * this is" as using the same tool twice in a row. See the mempalace-memory
 * skill for the full reasoning.
 */
export const AGENT_NAME = 'agent';

export async function isMempalaceReachable(): Promise<boolean> {
  return mcpIsReachable();
}

/**
 * File one verbatim unit of content into the palace. Returns false (never
 * throws) on failure so a mempalace outage never breaks the host session.
 */
export async function addDrawer(
  wing: string,
  room: string,
  content: string,
  sourceFile?: string,
): Promise<boolean> {
  if (!content.trim()) return true;
  try {
    await callTool('mempalace_add_drawer', {
      wing,
      room,
      content,
      added_by: AGENT_NAME,
      ...(sourceFile ? { source_file: sourceFile } : {}),
    });
    return true;
  } catch (error) {
    if (!(error instanceof McpUnavailableError)) {
      console.warn('[opencode-memory] add_drawer failed:', error);
    }
    return false;
  }
}
