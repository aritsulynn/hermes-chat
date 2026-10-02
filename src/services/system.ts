// System / operations — host stats, gateway lifecycle, credential pool, and the
// one-shot maintenance actions (doctor, security audit, backup, checkpoints).
//
// Wraps `hermes_cli/web_routers/status.py` and `ops.py` over the app's authed
// ops helpers, mirroring Hermes Desktop's `SystemPage.tsx`. Transport only.
import {
  credentialsPool,
  curator,
  curatorRun,
  gatewayStart,
  gatewayStop,
  health,
  opsBackup,
  opsCheckpoints,
  opsCheckpointsPrune,
  opsDoctor,
  opsSecurityAudit,
  systemStats,
} from './api';

export interface SystemStats {
  os: string;
  release: string;
  platformLabel: string;
  arch: string;
  hostname: string;
  pythonVersion: string;
  hermesVersion: string;
  cpuCount: number;
  cpuPercent: number | null;
  loadAvg: number[] | null;
  uptimeSeconds: number | null;
  memory: { total: number; used: number; available: number; percent: number } | null;
  disk: { total: number; used: number; free: number; percent: number } | null;
  process: { pid: number; rss: number; createTime: number; threads: number } | null;
  psutil: boolean;
}

export interface CredentialEntry {
  label: string;
  authType: string;
  source: string;
  status: string;
  masked: string;
}

export interface CredentialProvider {
  provider: string;
  entries: CredentialEntry[];
}

export interface CheckpointsState {
  sessions: { session: string; files: number; bytes: number }[];
  totalBytes: number;
}

export interface CuratorState {
  paused: boolean;
  lastRun: number | null;
  intervalHours: number | null;
}

type OpsGet = (path: string) => Promise<unknown>;
type OpsMut = (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

export async function getSystemStats(opsGet: OpsGet): Promise<SystemStats> {
  const r = rec(await opsGet(systemStats()));
  const mem = rec(r.memory);
  const disk = rec(r.disk);
  const proc = rec(r.process);
  return {
    os: str(r.os),
    release: str(r.release),
    platformLabel: str(r.platform_label ?? r.platform),
    arch: str(r.arch),
    hostname: str(r.hostname),
    pythonVersion: str(r.python_version),
    hermesVersion: str(r.hermes_version),
    cpuCount: num(r.cpu_count) ?? 0,
    cpuPercent: num(r.cpu_percent),
    loadAvg: Array.isArray(r.load_avg) ? r.load_avg.map(Number) : null,
    uptimeSeconds: num(r.uptime_seconds),
    memory:
      typeof mem.total === 'number'
        ? { total: Number(mem.total), used: Number(mem.used), available: Number(mem.available), percent: Number(mem.percent) }
        : null,
    disk:
      typeof disk.total === 'number'
        ? { total: Number(disk.total), used: Number(disk.used), free: Number(disk.free), percent: Number(disk.percent) }
        : null,
    process:
      typeof proc.pid === 'number'
        ? { pid: Number(proc.pid), rss: Number(proc.rss), createTime: Number(proc.create_time), threads: Number(proc.num_threads) }
        : null,
    psutil: r.psutil === true,
  };
}

/** Machine-level health probe. Returns the raw record (shape varies by version). */
export async function getHealth(opsGet: OpsGet): Promise<Record<string, unknown>> {
  return rec(await opsGet(health()));
}

export async function startGateway(opsMut: OpsMut): Promise<void> {
  await opsMut(gatewayStart(), 'POST', {});
}
export async function stopGateway(opsMut: OpsMut): Promise<void> {
  await opsMut(gatewayStop(), 'POST', {});
}

export async function getCredentialPool(opsGet: OpsGet): Promise<CredentialProvider[]> {
  const r = rec(await opsGet(credentialsPool()));
  const providers = Array.isArray(r.providers) ? r.providers : [];
  const out: CredentialProvider[] = [];
  for (const raw of providers) {
    const p = rec(raw);
    const provider = str(p.provider);
    if (!provider) continue;
    const entries: CredentialEntry[] = [];
    if (Array.isArray(p.entries)) {
      for (const rawEntry of p.entries) {
        const e = rec(rawEntry);
        entries.push({
          label: str(e.label),
          authType: str(e.auth_type),
          source: str(e.source),
          status: str(e.status),
          masked: str(e.masked ?? e.token_preview ?? e.api_key_masked),
        });
      }
    }
    out.push({ provider, entries });
  }
  return out;
}

export async function getCheckpoints(opsGet: OpsGet): Promise<CheckpointsState> {
  const r = rec(await opsGet(opsCheckpoints()));
  const sessions = Array.isArray(r.sessions) ? r.sessions : [];
  return {
    sessions: sessions.map((raw) => {
      const s = rec(raw);
      return { session: str(s.session), files: num(s.files) ?? 0, bytes: num(s.bytes) ?? 0 };
    }),
    totalBytes: num(r.total_bytes) ?? 0,
  };
}

export async function getCurator(opsGet: OpsGet): Promise<CuratorState> {
  const r = rec(await opsGet(curator()));
  return {
    paused: r.paused === true,
    lastRun: num(r.last_run ?? r.last_run_at),
    intervalHours: num(r.interval_hours ?? r.every_hours),
  };
}

export async function runCurator(opsMut: OpsMut): Promise<void> {
  await opsMut(curatorRun(), 'POST', {});
}

/** Run a one-shot ops action; returns the spawned action name for polling. */
export async function runOpsAction(
  opsMut: OpsMut,
  which: 'doctor' | 'security-audit' | 'backup' | 'checkpoints-prune',
): Promise<string> {
  const path =
    which === 'doctor'
      ? opsDoctor()
      : which === 'security-audit'
        ? opsSecurityAudit()
        : which === 'backup'
          ? opsBackup()
          : opsCheckpointsPrune();
  const res = await opsMut(path, 'POST', {});
  const r = rec(res);
  return str(r.name);
}
