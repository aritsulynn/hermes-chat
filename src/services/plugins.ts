// Plugins — installed agent plugins, the curated catalog, and the runtime
// provider selection (memory provider / context engine).
//
// Wraps `hermes_cli/web_routers/dashboard_ui.py` + `memory_providers.py` over the
// app's authed ops helpers, mirroring Hermes Desktop's `PluginsPage.tsx`.
// Transport only.
import {
  agentPluginDisable,
  agentPluginEnable,
  agentPluginInstall,
  agentPluginUpdate,
  memoryProviderSetup,
  memoryStatus,
  pluginProviders,
  pluginVisibility,
  pluginsCatalog,
  pluginsHub,
  pluginsRescan,
} from './api';

export interface DashboardManifest {
  name: string;
  label: string;
  description: string;
  icon: string;
  version: string;
  path: string;
  hidden: boolean;
  hasApi: boolean;
  source: string;
}

export interface AgentPluginRow {
  name: string;
  version: string;
  description: string;
  source: string;
  runtimeStatus: string;
  hasDashboardManifest: boolean;
  dashboardManifest: DashboardManifest | null;
  path: string;
  canRemove: boolean;
  canUpdateGit: boolean;
  authRequired: boolean;
  authCommand: string;
  userHidden: boolean;
  removedReason: string | null;
}

export interface MemoryProviderInfo {
  name: string;
  description: string;
  available: boolean;
  configured: boolean;
  status: string;
}

export interface PluginProviders {
  memoryProvider: string;
  memoryOptions: MemoryProviderInfo[];
  contextEngine: string;
  contextOptions: Array<{ name: string; description: string }>;
}

export interface PluginsHub {
  plugins: AgentPluginRow[];
  orphanDashboardPlugins: DashboardManifest[];
  providers: PluginProviders;
}

export interface CatalogCapabilities {
  providesTools: string[];
  providesHooks: string[];
  providesMiddleware: string[];
  requiresEnv: string[];
}

export interface CatalogEntry {
  name: string;
  title: string;
  description: string;
  repo: string;
  shaShort: string;
  tier: string;
  category: string;
  maintainer: string;
  version: string;
  capabilities: CatalogCapabilities;
  capabilitySummary: string;
  installed: boolean;
  installedSha: string | null;
  updateAvailable: boolean;
  runtimeStatus: string | null;
  removedReason: string | null;
}

export interface PluginInstallResult {
  ok: boolean;
  pluginName: string;
  warnings: string[];
  missingEnv: string[];
  enabled: boolean;
  consentRequired: boolean;
  error: string;
}

type OpsGet = (path: string) => Promise<unknown>;
type OpsMut = (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}
function strList(v: unknown): string[] {
  return arr(v).map(str).filter(Boolean);
}

function manifestOf(raw: unknown): DashboardManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = rec(raw);
  const tab = rec(m.tab);
  return {
    name: str(m.name),
    label: str(m.label) || str(m.name),
    description: str(m.description),
    icon: str(m.icon),
    version: str(m.version),
    path: str(tab.path),
    hidden: tab.hidden === true,
    hasApi: m.has_api === true,
    source: str(m.source),
  };
}

export async function getPluginsHub(opsGet: OpsGet, profile?: string | null): Promise<PluginsHub> {
  const r = rec(await opsGet(pluginsHub(profile)));

  const plugins: AgentPluginRow[] = [];
  for (const raw of arr(r.plugins)) {
    const p = rec(raw);
    const name = str(p.name);
    if (!name) continue;
    plugins.push({
      name,
      version: str(p.version),
      description: str(p.description),
      source: str(p.source),
      runtimeStatus: str(p.runtime_status),
      hasDashboardManifest: p.has_dashboard_manifest === true,
      dashboardManifest: manifestOf(p.dashboard_manifest),
      path: str(p.path),
      canRemove: p.can_remove === true,
      canUpdateGit: p.can_update_git === true,
      authRequired: p.auth_required === true,
      authCommand: str(p.auth_command),
      userHidden: p.user_hidden === true,
      removedReason: typeof p.removed_reason === 'string' ? p.removed_reason : null,
    });
  }

  const providerRec = rec(r.providers);
  const memoryOptions: MemoryProviderInfo[] = [];
  for (const raw of arr(providerRec.memory_options)) {
    const m = rec(raw);
    const name = str(m.name);
    if (!name) continue;
    memoryOptions.push({
      name,
      description: str(m.description),
      available: m.available === true,
      configured: m.configured === true,
      status: str(m.status),
    });
  }
  const contextOptions: Array<{ name: string; description: string }> = [];
  for (const raw of arr(providerRec.context_options)) {
    const c = rec(raw);
    const name = str(c.name);
    if (!name) continue;
    contextOptions.push({ name, description: str(c.description) });
  }

  return {
    plugins,
    orphanDashboardPlugins: arr(r.orphan_dashboard_plugins)
      .map(manifestOf)
      .filter((m): m is DashboardManifest => !!m),
    providers: {
      memoryProvider: str(providerRec.memory_provider),
      memoryOptions,
      contextEngine: str(providerRec.context_engine),
      contextOptions,
    },
  };
}

// ── Catalog ─────────────────────────────────────────────────────────────────

export async function getPluginsCatalog(opsGet: OpsGet): Promise<CatalogEntry[]> {
  const r = rec(await opsGet(pluginsCatalog()));
  const out: CatalogEntry[] = [];
  for (const raw of arr(r.entries)) {
    const e = rec(raw);
    const name = str(e.name);
    if (!name) continue;
    const caps = rec(e.capabilities);
    const entry: CatalogEntry = {
      name,
      title: str(e.title) || name,
      description: str(e.description),
      repo: str(e.repo),
      shaShort: str(e.sha_short),
      tier: str(e.tier),
      category: str(e.category),
      maintainer: str(e.maintainer),
      version: str(e.version),
      capabilities: {
        providesTools: strList(caps.provides_tools),
        providesHooks: strList(caps.provides_hooks),
        providesMiddleware: strList(caps.provides_middleware),
        requiresEnv: strList(caps.requires_env),
      },
      capabilitySummary: str(e.capability_summary),
      installed: e.installed === true,
      installedSha: typeof e.installed_sha === 'string' ? e.installed_sha : null,
      updateAvailable: e.update_available === true,
      runtimeStatus: typeof e.runtime_status === 'string' ? e.runtime_status : null,
      removedReason: null,
    };
    out.push(entry);
  }
  return out;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

function installResult(raw: unknown): PluginInstallResult {
  const r = rec(raw);
  return {
    ok: r.ok !== false,
    pluginName: str(r.plugin_name),
    warnings: strList(r.warnings),
    missingEnv: strList(r.missing_env),
    enabled: r.enabled === true,
    consentRequired: r.consent_required === true,
    error: str(r.error),
  };
}

export async function installAgentPlugin(
  opsMut: OpsMut,
  input: { identifier?: string; catalogName?: string; force?: boolean; enable?: boolean },
): Promise<PluginInstallResult> {
  return installResult(
    await opsMut(agentPluginInstall(), 'POST', {
      identifier: input.identifier ?? '',
      ...(input.catalogName ? { catalog_name: input.catalogName } : {}),
      ...(input.force ? { force: true } : {}),
      enable: input.enable !== false,
    }),
  );
}

export async function setAgentPluginEnabled(opsMut: OpsMut, name: string, enabled: boolean): Promise<void> {
  await opsMut(enabled ? agentPluginEnable(name) : agentPluginDisable(name), 'POST', {});
}

export async function updateAgentPlugin(
  opsMut: OpsMut,
  name: string,
  acceptCapabilities = false,
): Promise<{ ok: boolean; consentRequired: boolean; unchanged: boolean; deltaLines: string[] }> {
  const r = rec(await opsMut(agentPluginUpdate(name), 'POST', acceptCapabilities ? { accept_capabilities: true } : {}));
  return {
    ok: r.ok !== false,
    consentRequired: r.consent_required === true,
    unchanged: r.unchanged === true,
    deltaLines: strList(r.delta_lines),
  };
}

export async function removeAgentPlugin(opsMut: OpsMut, name: string): Promise<void> {
  await opsMut(`/api/dashboard/agent-plugins/${encodeURI(name)}`, 'DELETE');
}

export async function setPluginVisibility(opsMut: OpsMut, name: string, hidden: boolean): Promise<void> {
  await opsMut(pluginVisibility(name), 'POST', { hidden });
}

export async function rescanPlugins(opsGet: OpsGet): Promise<number> {
  const r = rec(await opsGet(pluginsRescan()));
  return typeof r.count === 'number' ? r.count : 0;
}

// ── Providers ───────────────────────────────────────────────────────────────

export async function savePluginProviders(
  opsMut: OpsMut,
  input: { memoryProvider?: string; contextEngine?: string },
  profile?: string | null,
): Promise<void> {
  await opsMut(pluginProviders(profile), 'PUT', {
    ...(input.memoryProvider !== undefined ? { memory_provider: input.memoryProvider } : {}),
    ...(input.contextEngine !== undefined ? { context_engine: input.contextEngine } : {}),
  });
}

/** Backend memory status — used to show the live active provider. */
export async function getMemoryStatus(opsGet: OpsGet, profile?: string | null): Promise<string> {
  const r = rec(await opsGet(memoryStatus(profile)));
  return str(r.active);
}

/** Run a memory provider's declared dependency install commands. */
export async function setupMemoryProvider(
  opsMut: OpsMut,
  name: string,
  values: Record<string, unknown> = {},
): Promise<void> {
  await opsMut(memoryProviderSetup(name), 'POST', { values });
}
