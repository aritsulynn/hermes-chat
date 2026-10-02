// Full-text session search — `GET /api/sessions/search` (FTS5 over message
// content plus direct id hits, deduped by compression lineage server-side).
//
// Ported from Hermes Desktop's `searchSessions` result shape
// (`web/src/lib/api.ts` → `SessionSearchResult`). Transport only: the sidebar
// owns the debounce and the presentation.
import { sessionsSearch } from './api';

export interface SessionSearchHit {
  /** Live session id to open (the lineage tip, not the matched segment). */
  sessionId: string;
  title: string;
  preview: string;
  /** The matched message excerpt (or a session-id marker for id hits). */
  snippet: string;
  role: string | null;
  source: string | null;
  model: string | null;
  startedAt: number | null;
  lastActive: number | null;
  messageCount: number;
  profile: string;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

export async function searchSessions(
  opsGet: (path: string) => Promise<unknown>,
  query: string,
  profile?: string | null,
  limit = 20,
): Promise<SessionSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await opsGet(sessionsSearch(q, profile, limit));
  const rec = res && typeof res === 'object' && !Array.isArray(res) ? (res as Record<string, unknown>) : {};
  const rows = Array.isArray(rec.results) ? rec.results : [];
  const out: SessionSearchHit[] = [];
  for (const raw of rows) {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const sessionId = str(r.session_id) || str(r.id);
    if (!sessionId) continue;
    out.push({
      sessionId,
      title: str(r.title),
      preview: str(r.preview),
      snippet: str(r.snippet),
      role: typeof r.role === 'string' ? r.role : null,
      source: typeof r.source === 'string' ? r.source : null,
      model: typeof r.model === 'string' ? r.model : null,
      startedAt: num(r.session_started) ?? num(r.started_at),
      lastActive: num(r.last_active),
      messageCount: num(r.message_count) ?? 0,
      profile: str(r.profile) || String(profile ?? ''),
    });
  }
  return out;
}
