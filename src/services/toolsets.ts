// User-configurable Hermes capability groups, ported from Hermes Desktop's
// Capabilities → Toolsets REST surface. These changes are profile-wide and
// apply to newly created chats; the active session keeps its current schema.
//
// NOTE: the import below carries an explicit `.ts` extension. This module is
// loaded directly by node's test runner (--experimental-strip-types), and node
// ESM does not do extensionless resolution. Keep it that way here.
import { DEFAULT_PROFILE } from './constants.ts';
import { toolsetToggle, toolsets as toolsetsPath } from './api.ts';

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

export async function getToolsets(
  opsGet: (path: string) => Promise<unknown>,
  profile: string,
): Promise<ToolsetInfo[]> {
  return rowsOf(await opsGet(toolsetsPath(profile)));
}

export async function setToolsetEnabled(
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>,
  name: string,
  enabled: boolean,
  profile: string,
): Promise<ToolsetToggleResult> {
  const result = await opsMut(toolsetToggle(name, profile), 'PUT', { enabled });
  return result && typeof result === 'object' && !Array.isArray(result)
    ? (result as ToolsetToggleResult)
    : {};
}
