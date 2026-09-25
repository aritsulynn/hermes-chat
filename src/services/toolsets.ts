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
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.toolsets)
      ? (payload as any).toolsets
      : [];
  return rows
    .filter((row: unknown) => row && typeof row === 'object' && typeof (row as any).name === 'string')
    .map((row: any) => ({
      ...(row as any),
      name: String((row as any).name),
      label: typeof (row as any).label === 'string' ? (row as any).label : undefined,
      description: typeof (row as any).description === 'string' ? (row as any).description : '',
      enabled: (row as any).enabled !== false,
      configured: (row as any).configured === true,
      tools: Array.isArray((row as any).tools)
        ? (row as any).tools.filter((tool: unknown) => typeof tool === 'string')
        : [],
    })) as ToolsetInfo[];
}

export async function getToolsets(
  opsGet: (path: string) => Promise<any>,
  profile: string,
): Promise<ToolsetInfo[]> {
  return rowsOf(await opsGet(toolsetsPath(profile)));
}

export async function setToolsetEnabled(
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<any>,
  name: string,
  enabled: boolean,
  profile: string,
): Promise<ToolsetToggleResult> {
  const result = await opsMut(toolsetToggle(name, profile), 'PUT', { enabled });
  return result && typeof result === 'object' ? (result as ToolsetToggleResult) : {};
}
