// MCP servers — configured connections and the Nous-approved catalog.
//
// Wraps `hermes_cli/web_routers/mcp.py` over the app's authed ops helpers,
// mirroring Hermes Desktop's `McpPage.tsx` data layer. Transport + parsing only;
// the screen owns the presentation.
import {
  mcpCatalog,
  mcpCatalogInstall,
  mcpServerAuth,
  mcpServerEnabled,
  mcpServers,
  mcpServerTest,
  mcpServersSave,
  mcpServer,
} from './api';

/** A configured MCP server row (`_mcp_server_summary`). */
export interface McpServer {
  name: string;
  transport: string;
  url: string | null;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  auth: string | null;
  enabled: boolean;
  /** Enabled tool names, or null = all. */
  tools: string[] | null;
  source: string;
  plugin: string | null;
}

export interface McpEnvSpec {
  name: string;
  prompt: string;
  required: boolean;
}

/** A catalog entry (`_catalog_entry_json`). */
export interface McpCatalogEntry {
  name: string;
  description: string;
  connectorSlug: string;
  source: string;
  transport: string;
  authType: string;
  requiredEnv: McpEnvSpec[];
  command: string | null;
  args: string[];
  url: string | null;
  installUrl: string | null;
  bootstrap: string[];
  postInstall: string;
  needsInstall: boolean;
  installed: boolean;
  enabled: boolean;
}

export interface McpCatalogDiagnostic {
  name: string;
  kind: string;
  message: string;
}

export interface McpServerTestResult {
  ok: boolean;
  error: string;
  tools: { name: string; description: string }[];
  prompts: number;
  resources: number;
}

export interface McpAuthStart {
  flowId: string;
  url: string;
}

type OpsGet = (path: string) => Promise<unknown>;
type OpsMut = (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function serversOf(payload: unknown): McpServer[] {
  const rec =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const rows = Array.isArray(rec.servers) ? rec.servers : [];
  const out: McpServer[] = [];
  for (const raw of rows) {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const name = str(r.name);
    if (!name) continue;
    const env: Record<string, string> = {};
    if (r.env && typeof r.env === 'object' && !Array.isArray(r.env)) {
      for (const [k, v] of Object.entries(r.env as Record<string, unknown>)) env[k] = str(v);
    }
    out.push({
      name,
      transport: str(r.transport) || 'unknown',
      url: strOrNull(r.url),
      command: strOrNull(r.command),
      args: Array.isArray(r.args) ? r.args.map(String) : [],
      env,
      auth: strOrNull(r.auth),
      enabled: r.enabled !== false,
      tools: Array.isArray(r.tools) ? r.tools.map(String) : null,
      source: str(r.source) || 'config',
      plugin: strOrNull(r.plugin),
    });
  }
  return out;
}

export async function getMcpServers(opsGet: OpsGet, profile?: string | null): Promise<McpServer[]> {
  return serversOf(await opsGet(mcpServers(profile)));
}

export async function setMcpServerEnabled(opsMut: OpsMut, name: string, enabled: boolean): Promise<void> {
  await opsMut(mcpServerEnabled(name), 'PUT', { enabled });
}

export async function deleteMcpServer(opsMut: OpsMut, name: string): Promise<void> {
  await opsMut(mcpServer(name), 'DELETE');
}

/** Probe a server: connect, list tools, disconnect. */
export async function testMcpServer(opsMut: OpsMut, name: string): Promise<McpServerTestResult> {
  const res = await opsMut(mcpServerTest(name), 'POST', {});
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  const tools = Array.isArray(r.tools)
    ? r.tools.map((t) => {
        const rec = t && typeof t === 'object' ? (t as Record<string, unknown>) : {};
        return { name: str(rec.name), description: str(rec.description) };
      })
    : [];
  return {
    ok: r.ok === true,
    error: str(r.error),
    tools,
    prompts: typeof r.prompts === 'number' ? r.prompts : 0,
    resources: typeof r.resources === 'number' ? r.resources : 0,
  };
}

/** Add a stdio or HTTP server. `bearer_token` persists to the profile .env. */
export async function addMcpServer(
  opsMut: OpsMut,
  input: {
    name: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    auth?: string;
    bearerToken?: string;
  },
): Promise<void> {
  await opsMut(mcpServersSave(), 'POST', {
    name: input.name,
    ...(input.url ? { url: input.url } : {}),
    ...(input.command ? { command: input.command } : {}),
    ...(input.args && input.args.length ? { args: input.args } : {}),
    ...(input.env && Object.keys(input.env).length ? { env: input.env } : {}),
    ...(input.auth ? { auth: input.auth } : {}),
    ...(input.bearerToken ? { bearer_token: input.bearerToken } : {}),
  });
}

export interface McpCatalogResult {
  entries: McpCatalogEntry[];
  diagnostics: McpCatalogDiagnostic[];
}

function catalogEntries(payload: unknown): McpCatalogResult {
  const rec =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const entries: McpCatalogEntry[] = [];
  if (Array.isArray(rec.entries)) {
    for (const raw of rec.entries) {
      const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const name = str(r.name);
      if (!name) continue;
      const requiredEnv: McpEnvSpec[] = [];
      if (Array.isArray(r.required_env)) {
        for (const rawEnv of r.required_env) {
          const e = rawEnv && typeof rawEnv === 'object' ? (rawEnv as Record<string, unknown>) : {};
          const envName = str(e.name);
          if (!envName) continue;
          requiredEnv.push({ name: envName, prompt: str(e.prompt) || envName, required: e.required !== false });
        }
      }
      entries.push({
        name,
        description: str(r.description),
        connectorSlug: str(r.connector_slug),
        source: str(r.source),
        transport: str(r.transport),
        authType: str(r.auth_type) || 'none',
        requiredEnv,
        command: strOrNull(r.command),
        args: Array.isArray(r.args) ? r.args.map(String) : [],
        url: strOrNull(r.url),
        installUrl: strOrNull(r.install_url),
        bootstrap: Array.isArray(r.bootstrap) ? r.bootstrap.map(String) : [],
        postInstall: str(r.post_install),
        needsInstall: r.needs_install === true,
        installed: r.installed === true,
        enabled: r.enabled === true,
      });
    }
  }
  const diagnostics: McpCatalogDiagnostic[] = [];
  if (Array.isArray(rec.diagnostics)) {
    for (const raw of rec.diagnostics) {
      const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      diagnostics.push({ name: str(d.name), kind: str(d.kind), message: str(d.message) });
    }
  }
  return { entries, diagnostics };
}

export async function getMcpCatalog(opsGet: OpsGet, profile?: string | null): Promise<McpCatalogResult> {
  return catalogEntries(await opsGet(mcpCatalog(profile)));
}

/** Install a catalog entry. Returns the background action name when the entry
 *  needs a git clone, else null (installed synchronously). */
export async function installMcpCatalogEntry(
  opsMut: OpsMut,
  input: { name: string; env?: Record<string, string>; enable?: boolean },
): Promise<{ background: boolean; action: string | null }> {
  const res = await opsMut(mcpCatalogInstall(), 'POST', {
    name: input.name,
    ...(input.env && Object.keys(input.env).length ? { env: input.env } : {}),
    enable: input.enable !== false,
  });
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  return {
    background: r.background === true,
    action: typeof r.action === 'string' ? r.action : null,
  };
}

/** Start MCP OAuth for a server; returns the URL to open. */
export async function startMcpAuth(opsMut: OpsMut, name: string): Promise<McpAuthStart> {
  const res = await opsMut(mcpServerAuth(name), 'POST', {});
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  // The flow snapshot names the URL `authorization_url` (tools/mcp_dashboard_oauth.py).
  return { flowId: str(r.flow_id), url: str(r.authorization_url) || str(r.url) };
}
