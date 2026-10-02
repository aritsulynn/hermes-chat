// User-configurable Hermes capability groups, ported from Hermes Desktop's
// Capabilities → Toolsets REST surface. These changes are profile-wide and
// apply to newly created chats; the active session keeps its current schema.
//
// NOTE: the import below carries an explicit `.ts` extension. This module is
// loaded directly by node's test runner (--experimental-strip-types), and node
// ESM does not do extensionless resolution. Keep it that way here.
import {
  toolsetConfig,
  toolsetEnv,
  toolsetPostSetup,
  toolsetProvider,
  toolsetToggle,
  toolsets as toolsetsPath,
} from './api.ts';

export interface ToolsetInfo {
  name: string;
  label?: string;
  description?: string;
  platform?: string;
  platform_label?: string;
  enabled: boolean;
  available?: boolean;
  configured: boolean;
  tools: string[];
  [key: string]: unknown;
}

export interface ToolsetToggleResult {
  ok?: boolean;
  name?: string;
  platform?: string;
  enabled?: boolean;
  post_setup_started?: boolean;
  [key: string]: unknown;
}

function rowsOf(payload: unknown): ToolsetInfo[] {
  const maybeToolsets =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { toolsets?: unknown }).toolsets
      : undefined;
  const rows: unknown[] = Array.isArray(payload) ? payload : Array.isArray(maybeToolsets) ? maybeToolsets : [];
  return rows
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .filter((row) => typeof row.name === 'string')
    .map((row) => ({
      ...row,
      name: String(row.name),
      label: typeof row.label === 'string' ? row.label : undefined,
      description: typeof row.description === 'string' ? row.description : '',
      enabled: row.enabled !== false,
      configured: row.configured === true,
      tools: Array.isArray(row.tools) ? row.tools.filter((tool): tool is string => typeof tool === 'string') : [],
    })) as ToolsetInfo[];
}

export async function getToolsets(opsGet: (path: string) => Promise<unknown>, profile: string): Promise<ToolsetInfo[]> {
  return rowsOf(await opsGet(toolsetsPath(profile)));
}

export async function setToolsetEnabled(
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>,
  name: string,
  enabled: boolean,
  profile: string,
): Promise<ToolsetToggleResult> {
  const result = await opsMut(toolsetToggle(name, profile), 'PUT', { enabled });
  return result && typeof result === 'object' && !Array.isArray(result) ? (result as ToolsetToggleResult) : {};
}

// ── Toolset backends / provider config ──────────────────────────────────────

export interface ToolsetEnvVar {
  key: string;
  prompt: string;
  url?: string | null;
  default?: string | null;
  isSet: boolean;
}

export interface ToolsetProviderRow {
  name: string;
  badge?: string;
  tag?: string;
  envVars: ToolsetEnvVar[];
  postSetup?: string | null;
  requiresNousAuth: boolean;
  isActive: boolean;
  status?: string;
}

export interface ToolsetConfigResult {
  name: string;
  hasCategory: boolean;
  providers: ToolsetProviderRow[];
  activeProvider: string | null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

/** Provider matrix + key status for one toolset's config panel. */
export async function getToolsetConfig(
  opsGet: (path: string) => Promise<unknown>,
  name: string,
  profile: string,
): Promise<ToolsetConfigResult> {
  const res = await opsGet(toolsetConfig(name, profile));
  const r = res && typeof res === 'object' && !Array.isArray(res) ? (res as Record<string, unknown>) : {};
  const providers: ToolsetProviderRow[] = [];
  if (Array.isArray(r.providers)) {
    for (const raw of r.providers) {
      const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const envVars: ToolsetEnvVar[] = [];
      if (Array.isArray(p.env_vars)) {
        for (const rawEnv of p.env_vars) {
          const e = rawEnv && typeof rawEnv === 'object' ? (rawEnv as Record<string, unknown>) : {};
          const key = str(e.key);
          if (!key) continue;
          envVars.push({
            key,
            prompt: str(e.prompt) || key,
            url: typeof e.url === 'string' ? e.url : null,
            default: typeof e.default === 'string' ? e.default : null,
            isSet: e.is_set === true,
          });
        }
      }
      providers.push({
        name: str(p.name),
        badge: str(p.badge),
        tag: str(p.tag),
        envVars,
        postSetup: typeof p.post_setup === 'string' ? p.post_setup : null,
        requiresNousAuth: p.requires_nous_auth === true,
        isActive: p.is_active === true,
        ...(typeof p.status === 'string' ? { status: p.status } : {}),
      });
    }
  }
  return {
    name: str(r.name) || name,
    hasCategory: r.has_category === true,
    providers,
    activeProvider: typeof r.active_provider === 'string' ? r.active_provider : null,
  };
}

/** Select the active provider row for a toolset. */
export async function selectToolsetProvider(
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>,
  name: string,
  provider: string,
  profile: string,
): Promise<void> {
  await opsMut(toolsetProvider(name, profile), 'PUT', { provider });
}

export interface ToolsetEnvSaveResult {
  saved: string[];
  isSet: Record<string, boolean>;
}

/** Save one or more API keys / env vars for a toolset backend. */
export async function saveToolsetEnv(
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>,
  name: string,
  env: Record<string, string>,
  profile: string,
): Promise<ToolsetEnvSaveResult> {
  const res = await opsMut(toolsetEnv(name, profile), 'PUT', { env });
  const r = res && typeof res === 'object' && !Array.isArray(res) ? (res as Record<string, unknown>) : {};
  const isSet: Record<string, boolean> = {};
  if (r.is_set && typeof r.is_set === 'object' && !Array.isArray(r.is_set)) {
    for (const [k, v] of Object.entries(r.is_set as Record<string, unknown>)) isSet[k] = v === true;
  }
  return {
    saved: Array.isArray(r.saved) ? r.saved.map(String) : [],
    isSet,
  };
}

/** Run a provider's one-time post-setup install hook. Returns the action name. */
export async function runToolsetPostSetup(
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>,
  name: string,
  key: string,
  profile: string,
): Promise<string> {
  const res = await opsMut(toolsetPostSetup(name, profile), 'POST', { key });
  const r = res && typeof res === 'object' && !Array.isArray(res) ? (res as Record<string, unknown>) : {};
  return str(r.name);
}
