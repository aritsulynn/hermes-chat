// Human-readable text from a tool result.
//
// The gateway ships `tool.complete.payload.result` as parsed JSON when it
// parses, else the raw string (tui_gateway/tool_progress.py::_on_tool_complete).
// A terminal tool's result is an object like `{output, exit_code, …}`; dumping
// that raw to the screen shows escaped `\n` and no readable body. This pulls the
// body out (mirroring the desktop's buildToolView intent) and pretty-prints as a
// last resort.

/** Display text for the tool's command / primary argument. Common keys first
 *  (terminal `command`, file `path`, search `query`, …), then a compact JSON
 *  fallback so an arbitrary tool still shows something. */
export function formatToolCommand(args: unknown): string {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : null;
  if (!a) return typeof args === 'string' ? args.trim() : '';
  for (const k of [
    'command',
    'cmd',
    'script',
    // execute_code / browser_exec pass their program as `code`.
    'code',
    'source',
    'query',
    'pattern',
    'url',
    'path',
    'file',
    'filepath',
    'target',
    'name',
    'prompt',
    'content',
    'text',
    'input',
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

// ── untrusted wrapper ────────────────────────────────────────────────────────
// The gateway wraps every external-source tool result in
// `<untrusted_tool_result source="…">` followed by a boilerplate warning, a
// blank line, then the real payload (agent/tool_dispatch_helpers.py). Dumping
// that wrapper is the single biggest readability problem in the tool feed, so
// unwrap it — the same extraction the desktop does for artifacts
// (app/artifacts/artifact-utils.ts::untrustedToolPayload).
const UNTRUSTED_OPEN_RE = /^<untrusted_tool_result\b[^>]*>\s*/;

/** The payload inside an `<untrusted_tool_result>` wrapper, or `text` unchanged. */
export function unwrapUntrustedToolResult(text: string): string {
  const trimmed = text.trim();
  const open = trimmed.match(UNTRUSTED_OPEN_RE);
  if (!open) return text;
  const close = trimmed.lastIndexOf('</untrusted_tool_result>');
  if (close <= open[0].length) return text;
  const wrapped = trimmed.slice(open[0].length, close).trim();
  // The boilerplate paragraph is separated from the payload by a blank line.
  const cut = wrapped.indexOf('\n\n');
  return (cut === -1 ? wrapped : wrapped.slice(cut + 2)).trim();
}

// ── ANSI escapes ─────────────────────────────────────────────────────────────
// Terminal/execute_code output carries colour and cursor codes. A plain block
// renders them as literal noise, so strip them (the desktop parses them into
// colour instead; stripping is the safe floor).
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\u001B\][^\u0007]*(?:\u0007|\u001B\\)|\u001B\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

// ── shared helpers ───────────────────────────────────────────────────────────
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

function firstStr(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Pretty-print a body that is itself a JSON blob (execute_code returns one). */
function prettyNestedJson(text: string): string {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return text;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    // Truncated or otherwise invalid (a tool that cut its own output mid-string
    // fails `JSON.parse`). Only lay it out when it really is JSON — a
    // double-quoted key — and is a single-line blob; a Python dict repr or
    // already-broken text is left alone.
    if (t.includes('\n') || !/"[^"]*":/.test(t)) return text;
    return looseJsonPretty(t);
  }
}

/**
 * Indent a JSON-shaped string without parsing it, so a one-line blob (or one
 * truncated mid-token) still wraps readably. Tracks string/escape state so a
 * comma or brace inside a value is left alone.
 */
function looseJsonPretty(text: string): string {
  let out = '';
  let indent = 0;
  let inStr = false;
  let esc = false;
  const pad = () => '  '.repeat(indent);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === '{' || c === '[') {
      indent += 1;
      out += `${c}\n${pad()}`;
    } else if (c === '}' || c === ']') {
      indent = Math.max(0, indent - 1);
      out += `\n${pad()}${c}`;
    } else if (c === ',') {
      out += `,\n${pad()}`;
    } else if (c === ':') {
      out += ': ';
    } else {
      out += c;
    }
  }
  return out;
}

// ── HTML in tool text ────────────────────────────────────────────────────────
// API results (AniList, scraped pages) carry HTML in their string fields —
// `<br>`, `<I>`, entities — which reads as noise in a plain block. Turn breaks
// into newlines and drop the tags. Applied to the final display text, so a JSON
// tree keeps its shape but its string values read as prose.
function stripHtml(text: string): string {
  if (!/<[a-z/!][^>]*>/i.test(text)) return text;
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── browser snapshots ────────────────────────────────────────────────────────
// A browser snapshot is a long accessibility dump. The desktop summarises it
// (summarizeBrowserSnapshot) rather than printing thousands of lines. Guarded by
// the tool name at the call site so a log that happens to mention `button "…"`
// is not swallowed.
function summarizeBrowserSnapshot(text: string): string | null {
  const hits = text.match(/(?:button|link|textbox|combobox|searchbox)\s+"[^"]+"/g);
  if (!hits || hits.length < 3) return null;
  const count = (re: RegExp) => text.match(re)?.length ?? 0;
  const stats = [
    `${count(/button\s+"[^"]+"/g)} buttons`,
    `${count(/link\s+"[^"]+"/g)} links`,
    `${count(/(?:textbox|combobox|searchbox)\s+"[^"]+"/g)} inputs`,
  ].join(' · ');
  const labels = Array.from(text.matchAll(/(?:button|link|combobox|textbox)\s+"([^"]+)"/g))
    .map((m) => m[1].trim())
    .filter(Boolean)
    .slice(0, 4);
  return labels.length ? `${stats}\nTop controls: ${labels.join(', ')}` : stats;
}

// ── web-search results ───────────────────────────────────────────────────────
const SEARCH_ARRAY_KEYS = [
  'results',
  'search_results',
  'organic_results',
  'web',
  'web_sources',
  'sources',
  'items',
  'data',
];

function formatSearchHits(arr: unknown[]): string {
  const rows: string[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const title = stripAnsi(firstStr(o, ['title', 'name', 'heading'])).trim();
    const url = stripAnsi(firstStr(o, ['url', 'link', 'href'])).trim();
    const snippet = stripAnsi(firstStr(o, ['snippet', 'description', 'body', 'text'])).trim();
    if (!title && !url) continue;
    let row = `• ${title || url}`;
    if (title && url) row += `\n  ${url}`;
    if (snippet) row += `\n  ${snippet.length > 240 ? `${snippet.slice(0, 240)}…` : snippet}`;
    rows.push(row);
  }
  return rows.join('\n\n');
}

function collectSearchHits(o: Record<string, unknown>): string | null {
  for (const k of SEARCH_ARRAY_KEYS) {
    const arr = o[k];
    if (Array.isArray(arr)) {
      const rows = formatSearchHits(arr);
      if (rows) return rows;
    }
  }
  return null;
}

// ── body text ────────────────────────────────────────────────────────────────
/** Clean a free-text body: unwrap, strip ANSI, summarise a snapshot, pretty a
 *  nested JSON blob. */
function displayText(text: string, toolName?: string): string {
  const t = unwrapUntrustedToolResult(stripAnsi(text)).trim();
  if (toolName && /browser|snapshot/i.test(toolName)) {
    const summary = summarizeBrowserSnapshot(t);
    if (summary) return summary;
  }
  return stripHtml(prettyNestedJson(t));
}

/** Best-effort display text for a tool result (object, JSON string, or plain). */
export function formatToolResult(raw: unknown, toolName?: string): string {
  const v = parseMaybeJson(typeof raw === 'string' ? unwrapUntrustedToolResult(raw) : raw);
  if (v == null) return '';
  if (typeof v === 'string') return displayText(v, toolName);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return collectSearchHits({ results: v }) ?? prettyJson(v);
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const parts: string[] = [];
    const body = firstStr(o, ['stdout', 'output', 'content', 'text', 'result', 'message', 'summary', 'body']);
    const stderr = firstStr(o, ['stderr']);
    if (body) parts.push(displayText(body, toolName));
    if (stderr && stderr.trim() && stderr.trim() !== body.trim()) {
      parts.push(`stderr:\n${displayText(stderr, toolName)}`);
    }
    if (parts.length) {
      const code = o.exit_code ?? o.exitCode ?? o.code;
      if (typeof code === 'number' && code !== 0) parts.push(`(exit ${code})`);
      // The gateway caps captured stdout; say so rather than letting a clipped
      // JSON blob look like the whole answer.
      if (o.stdout_truncated === true || o.truncated === true) {
        const omitted = o.stdout_bytes_omitted;
        parts.push(
          typeof omitted === 'number' && omitted > 0 ? `(truncated — ${omitted} bytes omitted)` : '(truncated)',
        );
      }
      return parts.join('\n\n').trim();
    }
    // Structured web-search rows (when the payload has no plain body).
    const hits = collectSearchHits(o);
    if (hits) return hits;
    // A file-edit result whose only payload is the diff: the bubble renders the
    // diff itself, so don't also print the raw JSON here.
    if (typeof o.inline_diff === 'string' || typeof o.diff === 'string') return '';
    return prettyJson(v);
  }
  return String(v);
}

// ── JSON tokenizing (for syntax colouring) ───────────────────────────────────
export type JsonKind = 'key' | 'string' | 'number' | 'keyword' | 'punct';

export interface JsonToken {
  text: string;
  kind: JsonKind;
}

/**
 * Tokenize one line of (possibly truncated) JSON — no parse, so it survives a
 * blob a tool cut mid-token. A quoted run immediately followed by `:` is a key.
 */
export function tokenizeJson(line: string): JsonToken[] {
  const out: JsonToken[] = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    const c = line[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && line[j] !== '"') j += line[j] === '\\' ? 2 : 1;
      out.push({ text: line.slice(i, Math.min(j + 1, n)), kind: 'string' });
      i = j + 1;
      continue;
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      let j = i + 1;
      while (j < n && /[0-9eE+\-.]/.test(line[j])) j++;
      out.push({ text: line.slice(i, j), kind: 'number' });
      i = j;
      continue;
    }
    const kw = line.slice(i).match(/^(?:true|false|null)\b/);
    if (kw) {
      out.push({ text: kw[0], kind: 'keyword' });
      i += kw[0].length;
      continue;
    }
    out.push({ text: c, kind: 'punct' });
    i += 1;
  }
  for (let k = 0; k < out.length; k++) {
    if (out[k].kind !== 'string') continue;
    const next = out[k + 1];
    if (next && next.kind === 'punct' && next.text === ':') out[k] = { ...out[k], kind: 'key' };
  }
  return out;
}

// ── code tokenizing (for the tool's input/command box) ───────────────────────
export type CodeKind = 'comment' | 'string' | 'number' | 'plain';

export interface CodeToken {
  text: string;
  kind: CodeKind;
}

/**
 * Light tokenizer for a shell/Python-ish command: comments (`#` to end of line),
 * quoted strings, and numbers get a colour; everything else is plain. Not a
 * parser — just enough to tint the tool's input the way its output is tinted.
 * `//` is deliberately not a comment (it is a path separator in the URLs these
 * commands carry).
 */
export function tokenizeCode(line: string): CodeToken[] {
  const out: CodeToken[] = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    const c = line[i];
    if (c === '#') {
      out.push({ text: line.slice(i), kind: 'comment' });
      break;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
      out.push({ text: line.slice(i, Math.min(j + 1, n)), kind: 'string' });
      i = j + 1;
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(line[j])) j++;
      out.push({ text: line.slice(i, j), kind: 'number' });
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < n && !/[#'"\d]/.test(line[j])) j++;
    out.push({ text: line.slice(i, j), kind: 'plain' });
    i = j;
  }
  return out;
}
