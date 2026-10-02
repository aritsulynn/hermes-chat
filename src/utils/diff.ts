// Inline-diff helpers for tool result rendering.
//
// Ported from Hermes Desktop:
//   apps/shared/src/ansi.ts
//   apps/desktop/src/components/assistant-ui/tool/fallback-model/index.ts
//     (countDiffLineStats / stripInlineDiffChrome / inlineDiffFromResult)
// The gateway already renders the diff for a file-editing tool and ships it on
// `tool.complete` as `inline_diff` (tui_gateway/tool_progress.py
// `_on_tool_complete` → `render_edit_diff_with_delta`); the REST transcript
// carries it inside the tool result JSON. These helpers normalise either shape.

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_CSI_RE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
const ANSI_INCOMPLETE_CSI_RE = new RegExp(`${ESC}\\[[0-?]*[ -/]*(?=${ESC}|\\n|$)`, 'g');
const ANSI_OSC_RE = new RegExp(`${ESC}\\][\\s\\S]*?(?:${BEL}|${ESC}\\\\)`, 'g');
const ANSI_STRING_RE = new RegExp(`${ESC}[PX^_][\\s\\S]*?(?:${BEL}|${ESC}\\\\)`, 'g');
const ANSI_NON_CSI_ESC_SEQ_RE = new RegExp(`${ESC}(?!\\[|\\]|P|X|\\^|_)[ -/]*[0-~]`, 'g');
const ANSI_STRAY_ESC_RE = new RegExp(`${ESC}(?!\\[)[\\s\\S]?`, 'g');
// eslint-disable-next-line no-control-regex -- intentionally strips C0/C1 control chars
const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0D\x0E-\x1A\x1C-\x1F\x7F]/g;

/** Remove every ANSI escape sequence and control byte, returning plain text. */
export function stripAnsi(s: string): string {
  return s
    .replace(ANSI_OSC_RE, '')
    .replace(ANSI_STRING_RE, '')
    .replace(ANSI_INCOMPLETE_CSI_RE, '')
    .replace(ANSI_CSI_RE, '')
    .replace(ANSI_INCOMPLETE_CSI_RE, '')
    .replace(ANSI_NON_CSI_ESC_SEQ_RE, '')
    .replace(ANSI_STRAY_ESC_RE, '')
    .replace(CONTROL_RE, '');
}

/** Drop the `┊ review diff` header Rich prepends, then normalise whitespace. */
export function stripInlineDiffChrome(value: string): string {
  return value
    ? stripAnsi(value)
        .replace(/^\s*┊\s*review diff\s*\n/i, '')
        .trim()
    : '';
}

export interface DiffLineStats {
  added: number;
  removed: number;
}

/** `+`/`-` line counts, ignoring the `+++`/`---` file headers. */
export function countDiffLineStats(diff: string): DiffLineStats {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed };
}

/** Cheap shape check: a hunk header, or at least two +/- body lines. */
export function looksLikeDiff(text: string): boolean {
  let marks = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('@@')) return true;
    if ((line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---'))) {
      marks += 1;
    }
  }
  return marks >= 2;
}

/** Pull an inline diff out of a tool result: a JSON wrapper carrying
 *  `inline_diff` / `diff`, else the text itself when it is already diff-shaped.
 *  Returns '' when there is nothing diff-like to render. */
export function inlineDiffFromDetail(detail: string | undefined): string {
  const text = stripInlineDiffChrome(detail ?? '');
  if (!text) return '';
  const head = text.trimStart()[0];
  if (head === '{' || head === '[') {
    try {
      const parsed: any = JSON.parse(text);
      for (const key of ['inline_diff', 'diff']) {
        const v = parsed?.[key];
        if (typeof v === 'string' && v.trim()) return stripInlineDiffChrome(v);
      }
    } catch {
      // Not JSON — fall through to the raw-text check.
    }
  }
  return looksLikeDiff(text) ? text : '';
}

export type DiffLineKind = 'add' | 'del' | 'hunk' | 'meta' | 'ctx';

/** Classify one unified-diff line for colouring. */
export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
    return 'meta';
  }
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

export interface ChangedFile {
  path: string;
  name: string;
  added: number;
  removed: number;
}

function diffHeaderPath(line: string): string | null {
  const m = /^(?:\+\+\+|---)\s+(.+?)(?:\t.*)?$/.exec(line);
  if (!m) return null;
  let p = m[1].trim();
  if (p === '/dev/null') return null;
  // Strip the a/ b/ prefixes git uses.
  p = p.replace(/^[ab]\//, '');
  return p || null;
}

/** Fold a unified diff into one row per file it touched (first-seen order).
 *  Paths come from the `+++`/`---` headers, so it works without tool args. */
export function changedFilesFromDiff(diff: string): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  let cur: string | null = null;
  for (const line of diff.split('\n')) {
    const header = line.startsWith('+++ ') || line.startsWith('--- ') ? diffHeaderPath(line) : null;
    if (header) {
      cur = header;
      continue;
    }
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('@@')) continue;
    if (!cur) continue;
    if (!line.startsWith('+') && !line.startsWith('-')) continue;
    const row = byPath.get(cur) ?? { path: cur, name: cur.split('/').pop() || cur, added: 0, removed: 0 };
    if (line.startsWith('+')) row.added += 1;
    else row.removed += 1;
    byPath.set(cur, row);
  }
  return [...byPath.values()];
}
