// Channel pairing — pending requests and approved users.
//
// Wraps `hermes_cli/web_routers/ops.py` (`/api/pairing`) over the app's authed
// ops helpers, mirroring Hermes Desktop's `PairingPage.tsx`. Transport only.
import { pairing, pairingApprove, pairingClearPending, pairingRevoke } from './api';

/** One pending or approved pairing row (`store.list_pending/list_approved`). */
export interface PairingUser {
  platform: string;
  user_id: string;
  user_name: string;
  request_id: string;
  /** Age of a pending request in minutes (pending rows only). */
  ageMinutes: number | null;
}

export interface PairingState {
  pending: PairingUser[];
  approved: PairingUser[];
}

type OpsGet = (path: string) => Promise<unknown>;
type OpsMut = (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

function usersOf(value: unknown): PairingUser[] {
  if (!Array.isArray(value)) return [];
  const out: PairingUser[] = [];
  for (const raw of value) {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const userId = str(r.user_id) || str(r.id);
    const platform = str(r.platform);
    if (!userId && !platform) continue;
    out.push({
      platform,
      user_id: userId,
      user_name: str(r.user_name) || str(r.name),
      request_id: str(r.request_id) || str(r.id),
      ageMinutes: typeof r.age_minutes === 'number' ? r.age_minutes : null,
    });
  }
  return out;
}

export async function getPairing(opsGet: OpsGet): Promise<PairingState> {
  const res = await opsGet(pairing());
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  return { pending: usersOf(r.pending), approved: usersOf(r.approved) };
}

/** Approve a pending request by its request id (the admin path). */
export async function approvePairing(opsMut: OpsMut, platform: string, requestId: string): Promise<void> {
  await opsMut(pairingApprove(), 'POST', { platform, request_id: requestId });
}

/** Revoke an approved user's access. */
export async function revokePairing(opsMut: OpsMut, platform: string, userId: string): Promise<void> {
  await opsMut(pairingRevoke(), 'POST', { platform, user_id: userId });
}

/** Clear every pending pairing request. Returns the number cleared. */
export async function clearPendingPairing(opsMut: OpsMut): Promise<number> {
  const res = await opsMut(pairingClearPending(), 'POST', {});
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  return typeof r.cleared === 'number' ? r.cleared : 0;
}
