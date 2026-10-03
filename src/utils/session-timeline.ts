// The prompt index of one session — the gateway's /api/sessions/{id}/timeline,
// normalised. See docs/feature-parity-roadmap.md §4.7 for why this exists at
// all: the REST transcript has no cursor, so the chat pages history by growing a
// tail limit and gives up at CHAT_HISTORY_MAX_ROWS. A long session therefore
// reports "no more history" with thousands of rows still on the server.
//
// The timeline endpoint is the cursor-based replacement. It returns prompt
// *metadata only* — never tool payloads, never assistant text — which is what
// makes it cheap to page through a 10k-message session from a phone.

export interface TimelineEntry {
  /** Durable message row id; also the anchor for /messages/around. */
  rowId: number;
  /** First 120 characters of the prompt, whitespace-collapsed by the server. */
  preview: string;
  /** Unix seconds. */
  timestamp: number | null;
}

export interface TimelineIndex {
  entries: TimelineEntry[];
  /** Pass as `after_row_id` for the next page; null when exhausted. */
  cursor: number | null;
  /** How many prompts the server thinks this session has. */
  total: number;
  hasMore: boolean;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Normalise one /timeline page.
 *
 * The cursor is the tricky part and it is NOT the last entry's `row_id`. The
 * server's `next_cursor` is a *sort* id — the first physical row of the last
 * logical turn — which for a compacted turn differs from the entry's own row_id
 * (the entry addresses the current representative row for /messages/around,
 * the cursor addresses where the turn began). Taking the last entry's row_id
 * instead would skip the rest of a compacted turn on the next page.
 *
 * So the server's cursor is used verbatim when it is present, and the last
 * entry's row_id is only the fallback for a payload that omits it.
 */
export function buildTimelineIndex(raw: unknown): TimelineIndex {
  const body = asRecord(raw);
  const rows = Array.isArray(body.entries) ? body.entries : [];
  const page = asRecord(body.pagination);

  const entries: TimelineEntry[] = [];
  for (const row of rows) {
    const rec = asRecord(row);
    const rowId = rec.row_id;
    const preview = typeof rec.preview === 'string' ? rec.preview : '';
    // The server already excludes synthetic and hidden prompts; a blank preview
    // means something upstream changed, and rendering a row with no text is worse
    // than not rendering it.
    if (typeof rowId !== 'number' || !preview) continue;
    entries.push({
      rowId,
      preview,
      timestamp: typeof rec.timestamp === 'number' ? rec.timestamp : null,
    });
  }

  // A null `next_cursor` is meaningful — it says "exhausted" — so it must not
  // fall through to the fallback. Only an ABSENT key (an older or trimmed
  // payload) does, and there the last row_id is the best guess available.
  const cursor =
    page.next_cursor === null
      ? null
      : typeof page.next_cursor === 'number'
        ? page.next_cursor
        : (entries.at(-1)?.rowId ?? null);
  return {
    entries,
    cursor,
    total: typeof page.total === 'number' ? page.total : entries.length,
    hasMore: page.has_more === true,
  };
}

/**
 * Fold a later page into the index built so far.
 *
 * Dedupes on row_id because the cursor row comes back as the first entry of the
 * next page — the cursor is a first-row id, so the turn it points at is
 * returned again rather than skipped.
 */
export function mergeTimelinePage(current: TimelineIndex, next: TimelineIndex): TimelineIndex {
  const seen = new Set(current.entries.map((e) => e.rowId));
  const merged = [...current.entries];
  for (const entry of next.entries) {
    if (seen.has(entry.rowId)) continue;
    seen.add(entry.rowId);
    merged.push(entry);
  }
  return {
    entries: merged,
    // The newest page's cursor wins; a later page always knows more than the one
    // before it. `total` likewise — the gateway recounts inside the same
    // snapshot as the page, so it stays current, and compaction between two
    // pages can move it either way.
    cursor: next.cursor ?? current.cursor,
    total: next.total || current.total,
    hasMore: next.hasMore,
  };
}
