/**
 * Minimal JSON-RPC client for mempalace's HTTP MCP transport.
 *
 * mempalace's HTTP server (`mempalace serve`, mempalace/mcp_server/http.py)
 * is stateless per request: every POST to `/mcp` is dispatched independently
 * (`_http_dispatch`/`handle_request`), no session handshake required first.
 * `initialize` is accepted but not required before `tools/call` — so this
 * client skips the handshake entirely and issues one JSON-RPC `tools/call`
 * per request.
 *
 * Auth: on a loopback bind with no `MEMPALACE_MCP_HTTP_TOKEN` configured,
 * mempalace's own auth check is a no-op (empty token never satisfies the
 * bearer check). This client still sends `Authorization: Bearer <token>`
 * whenever a token is available (env var or explicit option), so it works
 * unmodified against a non-loopback or token-protected server too.
 *
 * Wire format: mempalace wraps every tool result as
 * `{ content: [{ type: "text", text: JSON.stringify(result) }], isError? }`
 * — never `structuredContent`. This client always parses that text block
 * as JSON.
 */

export interface McpCallOptions {
  url?: string;
  token?: string;
  timeoutMs?: number;
}

export class McpUnavailableError extends Error {}
export class McpToolError extends Error {}

const DEFAULT_URL = 'http://127.0.0.1:8767/mcp';
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2000;

let requestId = 0;

function resolveUrl(opts: McpCallOptions): string {
  return opts.url ?? process.env.MEMPALACE_MCP_URL ?? DEFAULT_URL;
}

function resolveToken(opts: McpCallOptions): string | undefined {
  return opts.token ?? process.env.MEMPALACE_MCP_HTTP_TOKEN ?? undefined;
}

function healthUrl(mcpUrl: string): string {
  return mcpUrl.replace(/\/mcp\/?$/, '/healthz');
}

/** True if the mempalace MCP HTTP server responds to its unauthenticated liveness probe. */
export async function isReachable(opts: McpCallOptions = {}): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(healthUrl(resolveUrl(opts)), { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call one mempalace MCP tool and return its parsed result.
 *
 * Throws `McpUnavailableError` for transport-level failures (connection
 * refused, timeout, non-2xx HTTP) and `McpToolError` for JSON-RPC/tool-level
 * failures (unknown tool, bad arguments, tool reported `isError`). Callers
 * that want "fail gracefully, never crash the session" behavior should catch
 * both.
 */
export async function callTool<T = any>(
  name: string,
  args: Record<string, unknown> = {},
  opts: McpCallOptions = {},
): Promise<T> {
  const url = resolveUrl(opts);
  const token = resolveToken(opts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++requestId,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new McpUnavailableError(
      `mempalace MCP server unreachable at ${url}: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new McpUnavailableError(`mempalace MCP HTTP ${res.status} from ${url}`);
  }

  const body: any = await res.json();
  if (body?.error) {
    throw new McpToolError(
      `mempalace tool '${name}' RPC error: ${body.error.message ?? JSON.stringify(body.error)}`,
    );
  }

  const result = body?.result;
  const textBlock = Array.isArray(result?.content)
    ? result.content.find((c: any) => c?.type === 'text')
    : undefined;

  let parsed: unknown = textBlock?.text;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // Not every tool result is JSON — leave as raw text.
    }
  }

  if (result?.isError) {
    const message = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    throw new McpToolError(`mempalace tool '${name}' failed: ${message}`);
  }

  return parsed as T;
}
