// Environment variables / API keys — the `.env` credential surface.
//
// Wraps `hermes_cli/web_routers/config_env.py` over the app's authed ops
// helpers, mirroring Hermes Desktop's `EnvPage.tsx`. Transport only.
import { envReveal, envVars, providerValidate } from './api';

export interface EnvVarInfo {
  isSet: boolean;
  redactedValue: string;
  description: string;
  url: string;
  category: string;
  isPassword: boolean;
  tools: string[];
  advanced: boolean;
  /** Owned by a Channels page card — the Keys page hides it. */
  channelManaged: boolean;
  /** Catalog provider identity, for grouping like the CLI model picker. */
  provider: string;
  providerLabel: string;
  providerPrimary: boolean;
  /** True for an arbitrary key the user added directly. */
  custom: boolean;
}

export interface ProviderValidation {
  ok: boolean;
  reachable: boolean;
  message: string;
  models: string[];
}

type OpsGet = (path: string) => Promise<unknown>;
type OpsMut = (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : [];
}

export async function getEnvVars(
  opsGet: OpsGet,
  profile?: string | null,
): Promise<Record<string, EnvVarInfo>> {
  const r = rec(await opsGet(envVars(profile)));
  const out: Record<string, EnvVarInfo> = {};
  for (const [key, raw] of Object.entries(r)) {
    const e = rec(raw);
    out[key] = {
      isSet: e.is_set === true,
      redactedValue: str(e.redacted_value),
      description: str(e.description),
      url: str(e.url),
      category: str(e.category),
      isPassword: e.is_password === true,
      tools: strList(e.tools),
      advanced: e.advanced === true,
      channelManaged: e.channel_managed === true,
      provider: str(e.provider),
      providerLabel: str(e.provider_label),
      providerPrimary: e.provider_primary === true,
      custom: e.custom === true,
    };
  }
  return out;
}

export async function setEnvVar(
  opsMut: OpsMut,
  key: string,
  value: string,
  profile?: string | null,
): Promise<void> {
  await opsMut(envVars(profile), 'PUT', { key, value, ...(profile ? { profile } : {}) });
}

export async function deleteEnvVar(
  opsMut: OpsMut,
  key: string,
  profile?: string | null,
): Promise<void> {
  await opsMut(envVars(profile), 'DELETE', { key, ...(profile ? { profile } : {}) });
}

/** Return the real (unredacted) value of one env var. Token-gated + rate limited. */
export async function revealEnvVar(opsMut: OpsMut, key: string): Promise<string> {
  const r = rec(await opsMut(envReveal(), 'POST', { key }));
  return str(r.value);
}

/**
 * Live-probe a provider credential before saving. `ok=false, reachable=false`
 * means the probe could not run (offline) — the caller may save with a warning.
 */
export async function validateProviderKey(opsMut: OpsMut, key: string, value: string): Promise<ProviderValidation> {
  const r = rec(await opsMut(providerValidate(), 'POST', { key, value }));
  return {
    ok: r.ok === true,
    reachable: r.reachable === true,
    message: str(r.message),
    models: strList(r.models),
  };
}

/** Group env rows by category, preserving the desktop's section order. */
export function groupEnvVars(vars: Record<string, EnvVarInfo>): Array<{ category: string; entries: Array<[string, EnvVarInfo]> }> {
  const byCategory = new Map<string, Array<[string, EnvVarInfo]>>();
  for (const entry of Object.entries(vars)) {
    const [, info] = entry;
    if (info.channelManaged) continue;
    const cat = info.category || 'provider';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(entry);
  }
  const order = ['provider', 'custom'];
  const categories = [...byCategory.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  return categories.map((category) => ({
    category,
    entries: byCategory.get(category)!.sort(([a], [b]) => a.localeCompare(b)),
  }));
}
