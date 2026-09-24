// Shared chat models + pure helpers (no React imports).
// Split out of the old monolithic App.tsx so the expo-router screens,
// the global store and the shared UI components all use one definition.
import type { ModelProviderOption } from '../lib/dashboard';

export type Role = 'user' | 'assistant' | 'notice' | 'interim' | 'thinking' | 'tool' | 'summary';

export interface UiMessage {
  id: string;
  role: Role;
  text: string;
  pending?: boolean;
  detail?: string;
  /** Authoring time (Unix seconds) — shown muted in the action row. */
  ts?: number;
  /** Full tool RESULT text, formatted for display (utils/toolResult). */
  output?: string;
  /** The tool's command / primary argument, shown above the result. */
  command?: string;
  /** Inline unified diff for a file-editing tool call (see utils/diff). */
  diff?: string;
  /** Durable DB row id (history rows); the rewind/edit target. */
  rowId?: number;
  /** Attachments that travelled with this message (thumbnails in the bubble). */
  media?: Attachment[];
}

export interface Attachment {
  uri: string;
  name: string;
  mime?: string;
}

/** A prompt held back while the agent is mid-turn (client-side queue; drained at
 *  turn end — see the store's queue panel). */
export interface QueuedPrompt {
  id: string;
  text: string;
}

/** One row of the agent's live todo list (`todo.updated` /
 *  `session.todo_state`). Field names are read defensively: the backend passes
 *  the TodoStore snapshot through unchanged. */
export interface TodoItem {
  content?: string;
  text?: string;
  title?: string;
  status?: string;
  activeForm?: string;
}

/** Normalise a todo snapshot; returns [] for malformed/empty payloads. */
export function normalizeTodos(payload: unknown): TodoItem[] {
  const rows = (payload as any)?.todos;
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];
}

export const todoLabel = (t: TodoItem): string => t.content || t.text || t.title || t.activeForm || '';
export const todoDone = (t: TodoItem): boolean => /^(completed|done|complete)$/i.test((t.status || '').trim());
export const todoActive = (t: TodoItem): boolean => /^(in_progress|active|running|doing)$/i.test((t.status || '').trim());

/** One live child agent from `subagent.list` (`SubagentSnapshot`). */
export interface SubagentRow {
  subagent_id: string;
  goal?: string | null;
  status?: string | null;
  tool_count?: number | null;
  last_tool?: string | null;
  model?: string | null;
}

export function normalizeSubagents(payload: unknown): SubagentRow[] {
  const rows = (payload as any)?.subagents;
  return Array.isArray(rows)
    ? rows.filter((r) => r && typeof r === 'object' && typeof r.subagent_id === 'string')
    : [];
}

/** Terminal statuses — a finished child no longer needs the live roster. */
export const subagentDone = (s: SubagentRow): boolean =>
  /^(completed|failed|error|timeout|interrupted)$/i.test((s.status || '').trim());

// ── base64 ⇄ utf8 ────────────────────────────────────────────────────────────
// Hermes ships atob/btoa + Text{En,De}coder; guard anyway so a stripped runtime
// degrades to an empty string instead of throwing inside render.

export function base64ToUtf8(base64: string): string {
  try {
    if (typeof atob === 'function') {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
  } catch {}
  return '';
}

export function utf8ToBase64(text: string): string {
  try {
    if (typeof btoa === 'function') {
      const bytes = new TextEncoder().encode(text);
      // Chunked join — `+=` per byte is quadratic for large files.
      const CHUNK = 0x8000;
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      return btoa(binary);
    }
  } catch {}
  return '';
}

let seq = 0;
export const nid = () => `m${Date.now()}-${seq++}`;

// ── Slash commands ───────────────────────────────────────────────────────────
// A slash COMMAND invocation: `/` at position 0, a bare name, then whitespace or
// end. `/usr/local` (a second slash) and `run /clean` (not at 0) are prose.
// Mirrors apps/shared/src/slash.ts so every Hermes surface agrees on the shape.

export const SLASH_COMMAND_RE = /^\/[^\s/]+(?:\s|$)/;
export const isSlashCommand = (text: string): boolean => SLASH_COMMAND_RE.test(text);

/** The `/token` a completion request is for (null when the line isn't a lone command). */
export const slashToken = (text: string): string | null =>
  /^\/[^\s]*$/.test(text) ? text : null;

/** Replace a slash-command completion token and leave one trailing space. */
export function applySlashCompletion(input: string, text: string, replaceFrom: number): string {
  // `complete.slash` returns the command name without its trigger (`goal`),
  // while older/offline rows may already include it (`/goal`). Only add the
  // trigger during the command stage; argument rows follow the same RPC and
  // must remain plain values (`/model son` → `/model sonnet `).
  const replacement = slashToken(input) && !text.startsWith('/') ? `/${text}` : text;
  return `${input.slice(0, replaceFrom)}${replacement.replace(/\s+$/, '')} `;
}

/** Trailing `@reference` token under the composer caret (start-of-line or after
 *  whitespace — `foo@bar` is an email, not a reference). Mirrors the TUI/desktop
 *  trigger; `@` alone opens the root hint list. */
export function atToken(text: string): { token: string; start: number } | null {
  const m = /(?:^|\s)(@[^\s@]*)$/.exec(text);
  if (!m) return null;
  const token = m[1];
  return { token, start: m.index + m[0].length - token.length };
}

/** Split `/name arg…` the way the backend does — name lower-cased, no slash. */
export function parseSlashCommand(command: string): { name: string; arg: string } {
  const m = /^(\S+)([\s\S]*)$/.exec(command.replace(/^\/+/, ''));
  return m ? { name: m[1].toLowerCase(), arg: m[2].trim() } : { name: '', arg: '' };
}

// Commands that act on the local terminal/client rather than the session are
// curated centrally in ./slash-commands (ported from the desktop registry).

export const slashName = (text: string): string =>
  (text.replace(/^\/+/, '').split(/\s/, 1)[0] || '').toLowerCase();

// Error values from fetch/WS can be non-Error objects — never render raw.
export function errMsg(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.error === 'string' && o.error) return o.error;
    try {
      const j = JSON.stringify(o);
      return j === '{}' ? String(o) : j;
    } catch {
      return String(o);
    }
  }
  return String(e);
}

// ── Ask helpers ──────────────────────────────────────────────────────────────
// Server asks (srq-*) and their reply shapes — see src/gateway-ws.ts header.

export interface ClarifyQ {
  qid: string;
  question: string;
  choices: string[];
  multiSelect: boolean;
  /** Previously locked answer restored from a reconnect `open_requests` payload. */
  lockedAnswer?: string;
}

export function parseClarify(ask: { params: Record<string, any> }): { single: boolean; questions: ClarifyQ[] } {
  const p = ask.params;
  const locked = p?.answers && typeof p.answers === 'object' && !Array.isArray(p.answers)
    ? p.answers as Record<string, unknown>
    : {};
  if (Array.isArray(p.questions) && p.questions.length > 0) {
    return {
      single: false,
      questions: p.questions.map((q: any, i: number) => {
        const qid = String(q?.qid ?? `q${i}`);
        return {
          qid,
          question: String(q?.question ?? ''),
          choices: Array.isArray(q?.choices) ? q.choices.map(String) : [],
          multiSelect: q?.multi_select === true,
          ...(typeof locked[qid] === 'string' ? { lockedAnswer: locked[qid] } : {}),
        };
      }),
    };
  }
  const qid = String(p.qid ?? p.question_id ?? 'q0');
  return {
    single: true,
    questions: [
      {
        qid,
        question: String(p.question ?? p.text ?? ''),
        choices: Array.isArray(p.choices)
          ? p.choices.map(String)
          : Array.isArray(p.options)
            ? p.options.map(String)
            : [],
        multiSelect: p.multi_select === true,
        ...(typeof locked[qid] === 'string' ? { lockedAnswer: locked[qid] } : {}),
      },
    ],
  };
}

// ── MEDIA: delivery tags ─────────────────────────────────────────────────────
// The agent's attachment contract: a reply carries `MEDIA:<path>` (optionally
// quoted or markdown-emphasised) and the platform layer uploads the file. The
// WS + REST transports this app uses hand the tag over verbatim, so we turn it
// into markdown the chat can render: an inline image for image types, a link
// (→ file chip) for everything else. Mirrors the desktop app's
// `renderMediaTags()` and the Python `MEDIA_DELIVERY_EXTS` list so all three
// surfaces agree on the syntax.

const MEDIA_DELIVERY_EXTS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'svg',
  'mp4', 'mov', 'avi', 'mkv', 'webm', '3gp',
  'mp3', 'm2a', 'wav', 'ogg', 'opus', 'm4a', 'flac',
  'pdf', 'docx', 'doc', 'odt', 'rtf', 'txt', 'md', 'epub',
  'xlsx', 'xls', 'ods', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml',
  'kmz', 'kml', 'geojson', 'gpx',
  'pptx', 'ppt', 'odp', 'key',
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'apk', 'ipa',
  'html', 'htm',
];

// Longest-first so a short ext never matches as a prefix of a longer one.
const MEDIA_EXT_ALT = [...MEDIA_DELIVERY_EXTS].sort((a, b) => b.length - a.length).join('|');

// Unquoted path: anchored on `~/`, `/` or `X:\`, interior spaces allowed, ends
// on a known extension (#96657 — "Morten - Nobly Kickoff.docx" is one path).
const MEDIA_PATH_ANCHORED =
  `(?:~/|/|[A-Za-z]:[/\\\\])\\S+?(?:[^\\S\\n]+\\S+?)*?\\.(?:${MEDIA_EXT_ALT})(?=[\\s\`"'*_,;:)\\]}]|MEDIA:|$)`;

const MEDIA_LINE_RE = new RegExp(
  `(^|\\n)[\\t ]*[\`"']?MEDIA:\\s*(\`[^\`\\n]+\`|"[^"\\n]+"|'[^'\\n]+'|${MEDIA_PATH_ANCHORED}|\\S+)[\`"']?[\\t ]*(\\n|$)`,
  'g',
);
const MEDIA_TAG_RE = new RegExp(
  `[\`"']?MEDIA:\\s*(\`[^\`\\n]+\`|"[^"\\n]+"|'[^'\\n]+'|${MEDIA_PATH_ANCHORED}|\\S+)[\`"']?`,
  'g',
);

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'svg']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp']);
const AUDIO_EXTS = new Set(['mp3', 'm2a', 'wav', 'ogg', 'opus', 'm4a', 'flac']);
// Extensions <Image> can actually draw — the rest become file chips.
const INLINE_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

export const mediaExt = (p: string) => (p.split(/[?#]/, 1)[0].split('.').pop() ?? '').toLowerCase();
export const isInlineImagePath = (p: string) => INLINE_IMAGE_EXTS.has(mediaExt(p));

export function mediaKind(p: string): 'image' | 'video' | 'audio' | 'file' {
  const ext = mediaExt(p);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return 'file';
}

export const mediaName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

function unquoteMediaPath(value: string): string {
  const t = value.trim();
  const q = t[0];
  return q && q === t[t.length - 1] && ['"', "'", '`'].includes(q) ? t.slice(1, -1) : t;
}

// `#media:<encoded path>` — the href the media rules in components/media.tsx
// recognise. Encoding keeps spaces, quotes and parentheses out of the markdown
// destination, which markdown-it would otherwise mangle.
export const mediaHref = (p: string) => `#media:${encodeURIComponent(p)}`;
export const mediaPathFromHref = (href: string) =>
  href.startsWith('#media:') ? decodeURIComponent(href.slice(7)) : null;

function mediaLink(value: string): string {
  const path = unquoteMediaPath(value);
  const kind = mediaKind(path);
  const label = `${kind[0].toUpperCase()}${kind.slice(1)}: ${mediaName(path)}`;
  // Images render inline in the bubble; everything else becomes a file chip.
  return isInlineImagePath(path) ? `![${label}](${mediaHref(path)})` : `[${label}](${mediaHref(path)})`;
}

// Bare path the `tui`-flavoured platform prompt tells the agent to write:
// "deliver a file by stating its absolute path or URL in plain text". Mirrors
// the server's extract_local_files() (same anchors, same extension list) except
// that the app cannot stat the file — a wrong guess degrades to a small chip.
const BARE_PATH_SRC = `(?:~/|/|[A-Za-z]:[/\\\\])(?:[\\w.\\-]+[/\\\\])*[\\w.\\-]+\\.(?:${MEDIA_EXT_ALT})`;
// Not preceded by a URL/relative-path/word character or an open paren (a
// markdown destination — that link already handles itself).
const BARE_PATH_RE = new RegExp(`(?<![/:\\w.(])${BARE_PATH_SRC}\\b`, 'gi');
const BARE_PATH_EXACT_RE = new RegExp(`^${BARE_PATH_SRC}$`);

/** Apply `fn` to every slice of `text` outside `mask` matches (code fences…). */
function mapOutside(text: string, mask: RegExp, fn: (chunk: string) => string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(mask)) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last));
}

const FENCED_CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE = /`([^`\n]*)`/g;

// A code span whose entire content is one deliverable path (`` `/tmp/shot.png` ``)
// becomes the file itself — models routinely quote paths for readability.
function replaceBarePaths(chunk: string): string {
  const spans = chunk.replace(INLINE_CODE, (whole, inner: string) => {
    const p = inner.trim();
    return BARE_PATH_EXACT_RE.test(p) ? mediaLink(p) : whole;
  });
  return spans.replace(BARE_PATH_RE, (m) => mediaLink(m));
}

/**
 * Rewrite the agent's file-delivery syntax into renderable markdown:
 * `MEDIA:<path>` tags (the platform contract) plus bare absolute paths (what
 * the terminal-style prompt asks for). No-op when there is nothing to rewrite.
 */
export function renderMediaTags(text: string): string {
  if (!text) return text;
  let out = text;
  if (out.includes('MEDIA:')) {
    // Code fences AND inline spans are skipped: the server masks them too, so a
    // documented example tag stays literal instead of becoming an image.
    out = mapOutside(out, new RegExp(`${FENCED_CODE.source}|${INLINE_CODE.source}`, 'g'), (chunk) =>
      chunk
        .replace(MEDIA_LINE_RE, (_m, lead: string, value: string, trailer: string) => `${lead}${mediaLink(value)}${trailer}`)
        .replace(MEDIA_TAG_RE, (_m, value: string) => mediaLink(value)),
    );
  }
  // Fenced blocks stay literal (code samples); inline spans may be paths.
  return mapOutside(out, FENCED_CODE, replaceBarePaths);
}

// ── Markdown preprocessing ───────────────────────────────────────────────────

// Reasoning streams often open with a one-line activity status like
// "(✦) setting wing angle..." — not real thinking. Drop leading lines with
// that shape so the bubble shows only thinking.
export function cleanThinking(text: string): string {
  const lines = text.split('\n');
  while (lines.length > 1 && /^\([^)\n]{0,12}\)\s*\S.*\.\.\.\s*$/.test(lines[0])) lines.shift();
  return lines.join('\n');
}

// react-native-markdown-display renders lists as flex rows whose width Yoga
// measures as unbounded inside an auto-width bubble — the text never wraps
// and spills out of the bubble. Flatten list markers to plain-text bullets so
// every line is a normal wrapping paragraph.
export function flattenLists(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // Unordered (- * +) with optional [ ]/[x] checkbox → •
      let m = line.match(/^(\s*)[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/);
      if (m) return `${m[1].slice(0, 3)}• ${m[2]}`;
      // Ordered (1. / 1)) → escape the dot so it stays a literal paragraph.
      m = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
      if (m) return `${m[1].slice(0, 3)}${m[2]}\\. ${m[3]}`;
      return line;
    })
    .join('\n');
}

// ── Composer options ─────────────────────────────────────────────────────────
// Real picker inventory comes from the gateway (WS model.options, fallback
// REST GET /api/model/options). This is only the offline fallback.

export const FALLBACK_PROVIDERS: ModelProviderOption[] = [
  {
    slug: '',
    name: 'Default',
    models: ['Muse Spark 1.3 Free', 'opus', 'sonnet', 'haiku'],
    totalModels: 4,
  },
];
