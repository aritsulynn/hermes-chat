// Store helpers — pure, non-React logic extracted from hooks/app-store.tsx:
// timeouts, profile/session keys, usage merging, context hydration, attachment
// uploads, and history→transcript conversion.
import * as api from '../services/api';
import { opsGet as dashboardOpsGet } from '../services/dashboard';
import { DEFAULT_PROFILE, MAX_UPLOAD_BYTES } from '../services/constants';
import type { AskInboxEntry } from '../services/ask-inbox';
import type { GatewayWs, HistoryMessage, ServerAsk } from '../services/gateway-ws';
import { cleanThinking, nid } from '../utils/messages';
import type { Attachment, UiMessage } from '../utils/messages';
import { formatToolResult } from '../utils/toolResult';
import type { AgentProfile } from './types';

// Rejecting timeout so a wedged server can never trap the UI on a spinner.
export function withTimeout<T>(p: Promise<T>, ms: number, what = 'timed out'): Promise<T> {
  let t: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, rej) => {
    t = setTimeout(() => rej(new Error(what)), ms);
  });
  return Promise.race([
    p.then(
      (v) => {
        if (t) clearTimeout(t);
        return v;
      },
      (e) => {
        if (t) clearTimeout(t);
        throw e;
      },
    ),
    timeout,
  ]);
}

export function normalizeProfileName(name: string | null | undefined): string {
  const value = String(name ?? '').trim();
  return value || DEFAULT_PROFILE;
}

export function profilesOf(payload: unknown): AgentProfile[] {
  const maybeProfiles =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { profiles?: unknown }).profiles
      : undefined;
  const rows: unknown[] = Array.isArray(payload) ? payload : Array.isArray(maybeProfiles) ? maybeProfiles : [];
  return rows
    .filter(
      (row): row is Record<string, unknown> =>
        !!row && typeof row === 'object' && typeof (row as { name?: unknown }).name === 'string',
    )
    .filter((row) => String(row.name).trim().length > 0)
    .map((row) => ({ ...row, name: normalizeProfileName(String(row.name)) }));
}

export async function discoverAgentProfiles(
  host: string,
  cookie: string,
  onCookie?: (nextCookie: string) => void | Promise<void>,
): Promise<{ profiles: AgentProfile[]; current: string }> {
  const [listResult, currentResult] = await Promise.allSettled([
    dashboardOpsGet(host, cookie, api.profiles(), onCookie),
    dashboardOpsGet(host, cookie, api.activeProfile(), onCookie),
  ]);
  const rows = listResult.status === 'fulfilled' ? profilesOf(listResult.value) : [];
  const currentPayload = currentResult.status === 'fulfilled' ? currentResult.value : null;
  const currentRec =
    currentPayload && typeof currentPayload === 'object' && !Array.isArray(currentPayload)
      ? (currentPayload as Record<string, unknown>)
      : {};
  const current = normalizeProfileName(typeof currentRec.current === 'string' ? currentRec.current : rows[0]?.name);
  return { profiles: rows, current };
}

/** Durable session identity is profile + stored id; stored ids may collide across profiles. */
export function profileSessionKey(profile: string, storedId: string): string {
  return JSON.stringify([normalizeProfileName(profile), storedId]);
}

export function parseProfileSessionKey(value: string): { profile: string; storedSessionId: string } | null {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') return null;
    return { profile: parsed[0], storedSessionId: parsed[1] };
  } catch {
    return null;
  }
}

export function serverAskFromInbox(entry: AskInboxEntry): ServerAsk {
  return {
    rpcId: entry.rpcId,
    method: entry.method,
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    params: entry.params,
    replayed: entry.replayed,
  };
}

// `notificationResponseKey` lived here — it keyed a notification reply by
// (connection, ask, rpc, action, text) so a response could be sent to the
// gateway exactly once even across reconnects. It went with the reply flow
// itself; see the "Scope note" at the top of services/notifications.ts. If Web
// Push ever lands, this is the dedup key it needs, and the
// "a reply uses the original request id exactly once, and is deferred never
// dropped or misrouted" invariant is what it would have to keep satisfying.

/** Keep the raw gateway usage shape in state; `readUsage` normalizes at render. */
export function mergeUsageState(
  previous: Record<string, unknown> | null,
  patch: unknown,
): Record<string, unknown> | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    return previous && typeof previous === 'object' ? previous : null;
  const base = previous && typeof previous === 'object' ? previous : {};
  return { ...base, ...(patch as Record<string, unknown>) };
}

// A cold resume builds its agent off the response path. The breakdown RPC is
// intentionally no-wait, so retry briefly until that build can reconstruct
// context occupancy from the restored transcript.
export const CONTEXT_WAKEUP_DELAYS_MS = [0, 200, 600, 1500, 3000];

export function scheduleContextHydration(
  gateway: GatewayWs,
  sessionId: string,
  isCurrent: () => boolean,
  publish: (snapshot: Record<string, unknown>) => void,
  delays = CONTEXT_WAKEUP_DELAYS_MS,
): () => void {
  let stopped = false;
  const attempt = (index: number) => {
    setTimeout(async () => {
      if (stopped || !isCurrent()) return;
      try {
        const snapshot = await gateway.contextBreakdown(sessionId);
        if (stopped || !isCurrent()) return;
        if (typeof snapshot?.context_max === 'number' && snapshot.context_max > 0) {
          publish(snapshot);
          return;
        }
      } catch {
        return;
      }
      if (index + 1 < delays.length) attempt(index + 1);
    }, delays[index]);
  };
  attempt(0);
  return () => {
    stopped = true;
  };
}

// ── Attachment upload ───────────────────────────────────────────────────────
// prompt.submit is text-only, so bytes are staged through session-scoped
// file.attach/image.attach_bytes RPCs and the agent is handed the returned ref.
// MAX_UPLOAD_BYTES lives in ../services/constants (the 1.4x check below accounts for
// the JSON base64 inflation).

export const isImageAttachment = (a: Attachment) =>
  (a.mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(a.name);

export async function blobToBase64(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const s = String(reader.result ?? '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : '');
    };
    reader.readAsDataURL(blob);
  });
}

export async function uploadAttachments(
  files: Attachment[],
  gateway: GatewayWs,
  sessionId: string,
): Promise<{ name: string; path: string; image: boolean }[]> {
  // Parallel with cap 3 — old serial for..await took N x latency.
  const out: { name: string; path: string; image: boolean }[] = new Array(files.length);
  let cursor = 0;
  const uploadOne = async (index: number) => {
    const f = files[index];
    const name = f.name.replace(/[\\/]/g, '_') || `upload-${Date.now()}-${index}`;
    const image = isImageAttachment(f);
    // Attachments come from an <input type="file">, so the uri is always a
    // blob:/data: URL.
    const b64 = await blobToBase64(f.uri);
    if (!b64) throw new Error(`${name}: could not read the file`);
    if (b64.length > MAX_UPLOAD_BYTES * 1.4) throw new Error(`${name}: too large (10 MB max)`);
    const dataUrl = `data:${f.mime || 'application/octet-stream'};base64,${b64}`;
    const result: Record<string, unknown> = image
      ? await gateway.call('image.attach_bytes', {
          session_id: sessionId,
          content_base64: b64,
          filename: name,
        })
      : await gateway.call('file.attach', {
          session_id: sessionId,
          name,
          data_url: dataUrl,
        });
    const path =
      typeof result?.path === 'string' && result.path
        ? result.path
        : typeof result?.ref_text === 'string' && result.ref_text
          ? result.ref_text
          : name;
    out[index] = { name, path, image };
  };
  const workers = Array.from({ length: Math.min(3, files.length) }, async () => {
    while (cursor < files.length) {
      const i = cursor++;
      await uploadOne(i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** True when rewinding to this message wipes the whole durable transcript (the
 *  target is the first row-id-bearing turn) — the server then requires
 *  `confirm_empty_truncate` on top of `confirm_truncate`. Scoped to real
 *  turns only: thinking/tool/summary/notice rows carry no durable ids. */
export function cutsWholeTranscript(list: UiMessage[], targetId: string): boolean {
  const idx = list.findIndex((m) => m.id === targetId);
  if (idx < 0) return false;
  return !list.slice(0, idx).some((m) => (m.role === 'user' || m.role === 'assistant') && m.rowId != null);
}

/** Turn a REST/WS history transcript into transcript items — shared by opening a
 *  session and by the post-reconnect resync. */
export function historyToItems(hist: HistoryMessage[]): UiMessage[] {
  const items: UiMessage[] = [];
  for (const m of hist) {
    // A `failed_turn` row is Hermes' own boundary copy, never the model
    // speaking — the desktop maps it to a system role (chat-messages/hydration.ts).
    // Unlike the live path there is no `status` on a durable row to tell a Stop
    // from a real failure, and the row's whole purpose is "this turn produced
    // no answer". Rendering it as an assistant reply would make the app look
    // like it answered, so it is dropped; the live turn still surfaces a genuine
    // failure as a notice (see useGateway's onComplete).
    if (m.displayKind === 'failed_turn') continue;
    if (m.role === 'assistant' && m.reasoning?.trim()) {
      items.push({
        id: nid(),
        role: 'thinking',
        text: cleanThinking(m.reasoning),
      });
    }
    // Interim assistant commentary is its own bubble, not a Thought — the
    // gateway's `display_commentary` is what separates it from the reasoning
    // (desktop parity: agent/history_commentary.py). Same shape the live
    // `message.interim` produces.
    if (m.role === 'assistant' && m.commentary?.length) {
      for (const text of m.commentary) {
        if (text.trim()) items.push({ id: nid(), role: 'interim', text: cleanThinking(text) });
      }
    }
    if (m.role === 'tool' && (m.content.trim() || m.name)) {
      const label = m.name || m.content;
      items.push({
        id: nid(),
        role: 'tool',
        text: label,
        ...(m.content.trim() ? { output: formatToolResult(m.content) } : {}),
        ...(m.command ? { command: m.command } : {}),
      });
    }
    if ((m.role === 'user' || m.role === 'assistant') && m.content.trim() !== '') {
      items.push({
        id: nid(),
        role: m.role as 'user' | 'assistant',
        text: m.content,
        ...(m.rowId != null ? { rowId: m.rowId } : {}),
        ...(m.ts != null ? { ts: m.ts } : {}),
      });
    }
  }
  return items;
}
