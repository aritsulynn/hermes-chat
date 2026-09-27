// Human-readable text from a tool result.
//
// The gateway ships `tool.complete.payload.result` as parsed JSON when it
// parses, else the raw string (tui_gateway/tool_progress.py::_on_tool_complete).
// A terminal tool's result is an object like `{output, exit_code, …}`; dumping
// that raw to the screen shows escaped `\n` and no readable body. This pulls the
// body out (mirroring the desktop's buildToolView/cleanVisibleText intent) and
// pretty-prints as a last resort.

/** Display text for the tool's command / primary argument. Common keys first
 *  (terminal `command`, file `path`, search `query`, …), then a compact JSON
 *  fallback so an arbitrary tool still shows something. */
export function formatToolCommand(args: unknown): string {
  const a =
    args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : null;
  if (!a) return typeof args === 'string' ? args.trim() : '';
  for (const k of [
    'command',
    'cmd',
    'script',
    'query',
    'pattern',
    'url',
    'path',
    'file',
    'filepath',
    'target',
    'name',
    'prompt',
  ]) {
    const v = a[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) return v.join('\n');
  }
  try {
    const j = JSON.stringify(a);
    if (j && j !== '{}') return j.length > 300 ? `${j.slice(0, 300)}…` : j;
  } catch (e) {
    console.warn('[toolResult] formatToolCommand stringify failed', e);
  }
  return '';
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return value;
  try {
    return JSON.parse(t);
  } catch {
    return value;
  }
}

const pickBody = (o: Record<string, unknown>): string => {
  for (const k of ['output', 'stdout', 'content', 'text', 'result', 'message', 'summary', 'body']) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
};

/** Best-effort display text for a tool result (object, JSON string, or plain). */
export function formatToolResult(raw: unknown): string {
  const v = parseMaybeJson(raw);
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const parts: string[] = [];
    const body = pickBody(o);
    if (body) parts.push(body);
    if (typeof o.stderr === 'string' && o.stderr.trim()) parts.push(o.stderr);
    if (parts.length) {
      const code = o.exit_code ?? o.exitCode ?? o.code;
      if (typeof code === 'number' && code !== 0) parts.push(`(exit ${code})`);
      return parts.join('\n').trim();
    }
    // A file-edit result whose only payload is the diff: the bubble renders the
    // diff itself, so don't also print the raw JSON here.
    if (typeof o.inline_diff === 'string' || typeof o.diff === 'string') return '';
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  return String(v);
}
