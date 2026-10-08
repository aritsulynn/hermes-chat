// Shared chat models + pure helpers (no React imports).
// One definition shared by the screens, the store and the UI components.
import type { ModelProviderOption } from '../services/dashboard';

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

// ── Transcript windowing ───────────────────────────────────────────────────
// The REST transcript has no backward cursor (only `order + limit + offset`),
// so older pages advance `offset` from the newest end and are merged by anchor:
// the oldest durable (rowId-bearing) bubble in the current window is located in
// the fresh fetch and only the rows before it are prepended. The fetch overlaps
// the window by a page so that anchor is present to find. Fresh fetches mint new
// `nid()` ids, so reusing the current window's objects keeps memo()/expanded
// state for every already-mounted bubble.

/**
 * Older bubbles to prepend when paging history: everything in `fetched`
 * before the current window's oldest durable message. Returns [] when there
 * is nothing older (anchor at index 0), the anchor is gone (history was
 * rewritten — keep the current window), or neither side can anchor.
 */
export function sliceOlderThan(fetched: UiMessage[], current: UiMessage[]): UiMessage[] {
  if (current.length === 0) return fetched;
  if (fetched.length === 0) return [];
  for (const a of current) {
    if ((a.role === 'user' || a.role === 'assistant') && a.rowId != null) {
      const k = fetched.findIndex((f) => f.role === a.role && f.rowId === a.rowId);
      return k < 0 ? [] : fetched.slice(0, k);
    }
  }
  return [];
}

/**
 * Fold a freshly fetched newest page into the loaded window without replacing
 * it. A reconnect resync must NOT collapse a deep history window: shrinking the
 * content clamps the scroller to the bottom and yanks a reader who was scrolled
 * up. Existing rows keep their identity (same `id`, so React does not remount
 * them and the scroll anchor holds); only rows genuinely newer than the window's
 * newest durable row are appended.
 *
 * Returns `current` unchanged when it cannot align safely (no durable anchor, or
 * the anchor is missing from `fresh`) rather than risk duplicating the tail.
 */
export function mergeHistoryTail(current: UiMessage[], fresh: UiMessage[]): UiMessage[] {
  if (fresh.length === 0) return current;
  if (current.length === 0) return fresh;
  let anchorIdx = -1;
  for (let i = current.length - 1; i >= 0; i--) {
    const m = current[i];
    if ((m.role === 'user' || m.role === 'assistant') && m.rowId != null) {
      anchorIdx = i;
      break;
    }
  }
  if (anchorIdx < 0) return current;
  const anchor = current[anchorIdx];
  const j = fresh.findIndex((f) => f.role === anchor.role && f.rowId === anchor.rowId);
  if (j < 0) return current;
  const out = current.slice(0, anchorIdx + 1);
  const seen = new Set(current.map((m) => m.rowId).filter((id): id is number => id != null));
  for (let k = j + 1; k < fresh.length; k++) {
    const f = fresh[k];
    if (f.rowId != null) {
      if (seen.has(f.rowId)) continue;
      seen.add(f.rowId);
    }
    out.push(f);
  }
  return out;
}

/** Cap on tool bubbles auto-inserted per refresh (see missingHistoryTools). */
export const TOOL_INSERT_CAP = 20;
/**
 * History tool rows with no live bubble. Some gateways never emit live
 * `tool.*` events — tool calls only exist in the transcript — so the turn
 * ends with no tool bubble until a reload rebuilds from REST. Pair live
 * bubbles to history rows by tool name in order and return the trailing
 * surplus: calls the just-finished turn appended. Leading unpaired rows are
 * older than the live window (trimmed head), and with no pairs at all there
 * is nothing to anchor against — both return [] rather than guessing. A
 * surplus past TOOL_INSERT_CAP is structural mismatch, not a turn: skip.
 */
export function missingHistoryTools(history: UiMessage[], live: UiMessage[], allowUnanchored = false): UiMessage[] {
  const histTools = history.filter((m) => m.role === 'tool');
  const liveTools = live.filter((m) => m.role === 'tool');
  if (histTools.length === 0) return [];
  if (liveTools.length === 0) {
    // No live tool bubble at all: only safe when the caller guarantees the
    // window is intact (no trimmed head, exhaustive history) — otherwise old
    // rows are indistinguishable from new ones.
    return allowUnanchored && histTools.length <= TOOL_INSERT_CAP ? histTools : [];
  }
  const norm = (t: string) => t.trim().toLowerCase();
  const used = new Set<number>();
  const pair = (k: number) => {
    used.add(k);
    lastPaired = Math.max(lastPaired, k);
  };
  let lastPaired = -1;
  // Pass 1: exact (case-insensitive) name match, in order.
  let unmatchedLive = 0;
  for (const lt of liveTools) {
    const want = norm(lt.text);
    let found = false;
    for (let k = 0; k < histTools.length; k++) {
      if (!used.has(k) && norm(histTools[k].text) === want) {
        pair(k);
        found = true;
        break;
      }
    }
    if (!found) unmatchedLive++;
  }
  // Pass 2: positional fallback — both sides list calls in transcript order,
  // so a live bubble whose label differs (event `tool` vs history `Tool`)
  // still consumes its slot instead of looking perpetually missing.
  for (let n = 0; n < unmatchedLive; n++) {
    for (let k = 0; k < histTools.length; k++) {
      if (!used.has(k)) {
        pair(k);
        break;
      }
    }
  }
  if (lastPaired < 0) return [];
  const missing = histTools.filter((_, k) => k > lastPaired);
  return missing.length > TOOL_INSERT_CAP ? [] : missing;
}

/**
 * Thinking bubbles whose live text should settle to the persisted reasoning.
 * The live delta stream carries status quips ("tracking ember fall…") while
 * the durable reasoning sidecar lands in history — the F5 view. Pair both
 * sides from the end (a turn without a reasoning sidecar leaves its live
 * fragments in place and must not shift older pairs) and return id/text
 * overwrites for pairs whose text differs.
 */
export function pairThinkingText(history: UiMessage[], live: UiMessage[]): Array<{ id: string; text: string }> {
  const hist = history.filter((m) => m.role === 'thinking' && m.text.trim());
  const cur = live.filter((m) => m.role === 'thinking');
  const n = Math.min(hist.length, cur.length);
  const out: Array<{ id: string; text: string }> = [];
  for (let i = 0; i < n; i++) {
    const h = hist[hist.length - n + i];
    const l = cur[cur.length - n + i];
    if (l.text !== h.text) out.push({ id: l.id, text: h.text });
  }
  return out;
}

const lastUserIdx = (list: UiMessage[]): number => {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].role === 'user') return i;
  return -1;
};

// Two rows that stand for the same transcript item: same role, and for tools the
// same name (a turn can call the same tool twice, so text is the discriminator).
const sameTurnItem = (a: UiMessage, b: UiMessage) => a.role === b.role && (b.role !== 'tool' || a.text === b.text);

// Roles the durable transcript owns — rebuilt from the stored sidecar at turn
// end. Live-only roles (notice/summary) are never dropped by the rebuild.
const DURABLE_TIMELINE_ROLES: ReadonlySet<Role> = new Set<Role>(['thinking', 'interim']);

/**
 * Rebuild a finished turn's Thought and commentary rows from the durable
 * transcript, in place.
 *
 * The live reasoning stream and the persisted transcript disagree: a provider may
 * stream commentary through the reasoning channel, stream different (or partial)
 * reasoning per step, or none at all, so the live turn can carry the wrong rows
 * in the wrong slots. `pairThinkingText` settles text but pairs positionally from
 * the end, so a single missing/extra row shifts every pair before it — the live
 * view then only matches after a full reload. This drops the live rows of the
 * roles the durable side owns (thinking/interim) and re-splices the durable ones
 * at the positions a reload would show (in front of the tool/answer of their
 * step), keeping every other live row (notice/summary, and the live tool data).
 * A role the durable side has none of is left alone. Returns `live` unchanged
 * when the two sides cannot be aligned.
 */
export function rebuildTurnTimeline(live: UiMessage[], history: UiMessage[]): UiMessage[] {
  const lu = lastUserIdx(live);
  const hu = lastUserIdx(history);
  if (lu < 0 || hu < 0) return live;
  const liveUser = live[lu];
  const histUser = history[hu];
  // Same turn only: the user rows must stand for the same prompt.
  if (liveUser.text.trim() && histUser.text.trim() && liveUser.text.trim() !== histUser.text.trim()) return live;
  const liveTurn = live.slice(lu + 1);
  const histTurn = history.slice(hu + 1);
  const durable = histTurn.filter((m) => DURABLE_TIMELINE_ROLES.has(m.role) && m.text.trim());
  if (durable.length === 0) return live; // nothing durable to show
  const owned = new Set(durable.map((m) => m.role));
  const durableTexts = new Set(durable.map((m) => m.text.trim()));
  // Drop a live timeline row when the durable side owns its role (it is being
  // rebuilt) or when its text was reclassified into a durable row of another
  // role — e.g. commentary the provider streamed through the reasoning channel
  // now lives as `interim`. A live row the durable side says nothing about is
  // kept (notice/summary, and a role the durable turn has none of).
  const dropLive = (m: UiMessage) =>
    DURABLE_TIMELINE_ROLES.has(m.role) && (owned.has(m.role) || durableTexts.has(m.text.trim()));
  // Group each durable row with the history row it precedes (its step's tool, or
  // the answer). Empty-text rows are not shown.
  const before = new Map<UiMessage, UiMessage[]>();
  let pending: UiMessage[] = [];
  for (const h of histTurn) {
    if (DURABLE_TIMELINE_ROLES.has(h.role)) {
      if (owned.has(h.role) && h.text.trim()) pending.push(h);
      continue;
    }
    before.set(h, pending);
    pending = [];
  }
  const tail = pending;
  // Walk the live turn, dropping the rows the durable side owns and inserting the
  // durable ones in front of the live row each history row precedes.
  const used = new Set<UiMessage>();
  const out: UiMessage[] = [];
  for (const l of liveTurn) {
    if (dropLive(l)) continue;
    const anchor = [...before.keys()].find((h) => !used.has(h) && sameTurnItem(l, h));
    if (anchor) {
      used.add(anchor);
      out.push(...(before.get(anchor) ?? []));
    }
    out.push(l);
  }
  // Rows whose anchor never appeared in the live turn (rare) land at the end.
  for (const [h, rows] of before) if (!used.has(h)) out.push(...rows);
  out.push(...tail);
  const next = [...live.slice(0, lu + 1), ...out];
  // If the rebuilt turn shows the same content (role + text) as the live one,
  // keep the live objects: identical content must not remount with fresh ids on
  // every refresh.
  const sig = (list: UiMessage[]) => list.map((m) => `${m.role}\u0000${m.text}`).join('\u0001');
  return sig(next) === sig(live) ? live : next;
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
  const rows = asRecord(payload).todos;
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];
}

export const todoLabel = (t: TodoItem): string => t.content || t.text || t.title || t.activeForm || '';
export const todoDone = (t: TodoItem): boolean => /^(completed|done|complete)$/i.test((t.status || '').trim());
export const todoActive = (t: TodoItem): boolean =>
  /^(in_progress|active|running|doing)$/i.test((t.status || '').trim());

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
  const rows = asRecord(payload).subagents;
  return Array.isArray(rows)
    ? rows.filter((r) => r && typeof r === 'object' && typeof (r as { subagent_id?: unknown }).subagent_id === 'string')
    : [];
}

/** Plain-object view of an unknown payload ({} for anything else). */
function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
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
  } catch (e) {
    console.warn('[messages] base64ToUtf8 decode failed', e);
  }
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
  } catch (e) {
    console.warn('[messages] utf8ToBase64 encode failed', e);
  }
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
export const slashToken = (text: string): string | null => (/^\/[^\s]*$/.test(text) ? text : null);

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

export const slashName = (text: string): string => (text.replace(/^\/+/, '').split(/\s/, 1)[0] || '').toLowerCase();

/**
 * Hermes-authored boundary copy for a turn that ended without an answer.
 * Kept in sync with `FAILED_TURN_NOTICE` / `PARTIAL_FAILED_TURN_NOTICE` in the
 * gateway's `agent/turn_failure_copy.py`.
 *
 * The gateway sends this two ways, and the client has to drop both:
 *  - appended to `message.complete`'s `text` (gateway/run_turn.py's
 *    `_hmwa_add_failed_turn_notice`), so it arrives as if the model had said it;
 *  - as a durable assistant row tagged `display_kind: "failed_turn"`.
 *
 * Pressing Stop is a deliberate cancellation, and "send it again" is wrong
 * advice for it, so neither copy is rendered. Matching on the exact trailing
 * copy (not the whole string) is deliberate: a real reply that merely quotes it
 * is still a reply.
 */
export const FAILED_TURN_NOTICE = 'Your request was not processed. Send it again if you still want me to carry it out.';
export const PARTIAL_FAILED_TURN_NOTICE =
  'This turn did not complete. Some actions may already have run; verify their effects before resending.';

/** Strip a trailing failed-turn boundary notice from a completed turn's text. */
export function stripFailedTurnNotice(text: string): string {
  let out = text.trimEnd();
  for (const notice of [FAILED_TURN_NOTICE, PARTIAL_FAILED_TURN_NOTICE]) {
    if (out.endsWith(notice)) out = out.slice(0, out.length - notice.length).trimEnd();
  }
  return out;
}

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

export function parseClarify(ask: { params: Record<string, unknown> }): {
  single: boolean;
  questions: ClarifyQ[];
} {
  const p = ask.params;
  const locked =
    p.answers && typeof p.answers === 'object' && !Array.isArray(p.answers)
      ? (p.answers as Record<string, unknown>)
      : {};
  if (Array.isArray(p.questions) && p.questions.length > 0) {
    return {
      single: false,
      questions: (p.questions as unknown[]).map((q, i: number) => {
        const row = q && typeof q === 'object' ? (q as Record<string, unknown>) : {};
        const qid = String(row.qid ?? `q${i}`);
        return {
          qid,
          question: String(row.question ?? ''),
          choices: Array.isArray(row.choices) ? row.choices.map(String) : [],
          multiSelect: row.multi_select === true,
          ...(typeof locked[qid] === 'string' ? { lockedAnswer: locked[qid] as string } : {}),
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
          ? (p.choices as unknown[]).map(String)
          : Array.isArray(p.options)
            ? (p.options as unknown[]).map(String)
            : [],
        multiSelect: p.multi_select === true,
        ...(typeof locked[qid] === 'string' ? { lockedAnswer: locked[qid] as string } : {}),
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
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tiff',
  'svg',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  '3gp',
  'mp3',
  'm2a',
  'wav',
  'ogg',
  'opus',
  'm4a',
  'flac',
  'pdf',
  'docx',
  'doc',
  'odt',
  'rtf',
  'txt',
  'md',
  'epub',
  'xlsx',
  'xls',
  'ods',
  'csv',
  'tsv',
  'json',
  'xml',
  'yaml',
  'yml',
  'kmz',
  'kml',
  'geojson',
  'gpx',
  'pptx',
  'ppt',
  'odp',
  'key',
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'apk',
  'ipa',
  'html',
  'htm',
];

// Longest-first so a short ext never matches as a prefix of a longer one.
const MEDIA_EXT_ALT = [...MEDIA_DELIVERY_EXTS].sort((a, b) => b.length - a.length).join('|');

// Unquoted path: anchored on `~/`, `/` or `X:\`, interior spaces allowed, ends
// on a known extension (#96657 — "Morten - Nobly Kickoff.docx" is one path).
const MEDIA_PATH_ANCHORED = `(?:~/|/|[A-Za-z]:[/\\\\])\\S+?(?:[^\\S\\n]+\\S+?)*?\\.(?:${MEDIA_EXT_ALT})(?=[\\s\`"'*_,;:)\\]}]|MEDIA:|$)`;

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
        .replace(
          MEDIA_LINE_RE,
          (_m, lead: string, value: string, trailer: string) => `${lead}${mediaLink(value)}${trailer}`,
        )
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
  // Collapse runs of invisible-only lines: streaming deltas and some models
  // pad with blank / zero-width-space lines, and a block element renders every
  // one at full line height — a tall empty void under the real content.
  // A line carrying only invisible chars shows nothing, so keep at most one
  // blank separator (paragraph breaks survive) and strip the rest, including
  // zero-width chars that `\s` doesn't match (U+200B/C/D, U+2060).
  const out: string[] = [];
  let blanks = 0;
  for (const line of lines) {
    if (/^[\s\u200B\u200C\u200D\u2060\uFEFF]*$/.test(line)) {
      blanks += 1;
      if (blanks > 1) continue;
      out.push('');
    } else {
      blanks = 0;
      out.push(line);
    }
  }
  return out.join('\n').replace(/[\s\u200B\u200C\u200D\u2060\uFEFF]+$/, '');
}

// ── Provider-wait status ─────────────────────────────────────────────────────
// `thinking.delta` is the kawaii spinner and the explained provider waits — NOT
// the model's reasoning (desktop parity: apps/desktop keeps most frames out of
// the transcript). Most frames are spinner rewrites like `(✦) measuring burn...`
// which must never paint the Thought bubble; only a wait notice is worth the
// status strip. Mirrors apps/desktop/src/store/provider-wait.ts.
const PROVIDER_WAIT_RE =
  /^(?:⏳|⚠|↻|⚙)\s*(?:(?:still\s+)?waiting on|loading|processing prompt|no (?:output|response)|model returned|rate limited|provider (?:overloaded|temporarily unavailable))/i;

/** The status text worth showing for a `thinking.delta`, or '' for a spinner rewrite. */
export function providerWaitText(text: string): string {
  const value = text.trim();
  return PROVIDER_WAIT_RE.test(value) ? value : '';
}

// ── Streaming markdown ───────────────────────────────────────────────────────
//
// A streaming reply is re-rendered once per animation frame, and re-parsing the
// WHOLE body each time is what makes the text stutter on a long answer: measured
// at ~1ms for 1KB but ~6ms for 9KB, which does not fit in a 16ms frame alongside
// the layout of a markdown tree that size.
//
// So the body is split at the last blank line that is not inside a code fence.
// Everything before that boundary cannot change again — the text only ever grows
// — so its parse is memoised and paid once. Only the tail, which is one block at
// most, is re-parsed per frame. That is the same shape streamdown uses, and it
// keeps the cost per frame flat no matter how long the reply gets.
//
// The boundary is a blank line, i.e. a markdown BLOCK boundary, which is what
// lets the two halves be rendered as two independent documents and still come
// out identical to rendering the whole.
//
// The transform above (renderMediaTags) is line-local and left-to-right, so
// splitting after it is safe: the prefix of the transformed text renders exactly
// as the prefix of the full render will.
export function splitSettled(body: string): [settled: string, tail: string] {
  let fence: string | null = null;
  let cut = 0;
  let offset = 0;
  for (const line of body.split('\n')) {
    const fenceMark = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMark) {
      const marker = fenceMark[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
    } else if (!fence && line.trim() === '') {
      // Just past this line's newline: the boundary is the blank line itself.
      cut = offset + line.length + 1;
    }
    offset += line.length + 1;
  }
  return cut > 0 ? [body.slice(0, cut), body.slice(cut)] : ['', body];
}

// ── Composer options ─────────────────────────────────────────────────────────
// Real picker inventory comes from the gateway (WS model.options, fallback
// REST GET /api/model/options). This is only the offline fallback.
//
// Deliberately carries NO model names: a fabricated entry would render as a
// selectable model that the server then rejects. `models: null` makes the
// picker show an empty, honest list while the gateway is unreachable.

export const FALLBACK_PROVIDERS: ModelProviderOption[] = [
  {
    slug: '',
    name: 'Default',
    models: null,
    totalModels: 0,
  },
];
