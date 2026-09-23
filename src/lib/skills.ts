// Agent skills inventory — ported from Hermes Desktop (`apps/desktop/src/api/skills.ts`).
//
// Same backend REST contract, routed through the mobile app's authed ops
// helpers (cookie auth, no Authorization header). All best-effort: older
// backends without these routes reject, and callers degrade to a notice.
export interface SkillInfo {
  name: string;
  description?: string;
  enabled?: boolean;
  origin?: string;
  usage?: number;
  [key: string]: unknown;
}

function rowsOf(payload: unknown): SkillInfo[] {
  if (Array.isArray(payload)) {
    return payload.filter((r) => r && typeof r === 'object') as SkillInfo[];
  }
  const rows = (payload as any)?.skills;
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];
}

export async function getSkills(opsGet: (path: string) => Promise<any>): Promise<SkillInfo[]> {
  const res = await opsGet('/api/skills');
  return rowsOf(res);
}

export async function getSkillContent(
  opsGet: (path: string) => Promise<any>,
  name: string,
): Promise<{ content: string; name: string; path: string }> {
  const res = await opsGet(`/api/skills/content?name=${encodeURIComponent(name)}`);
  return {
    content: String((res as any)?.content ?? ''),
    name: String((res as any)?.name ?? name),
    path: String((res as any)?.path ?? ''),
  };
}

export async function setSkillEnabled(
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<any>,
  name: string,
  enabled: boolean,
): Promise<void> {
  await opsMut('/api/skills/toggle', 'PUT', { name, enabled });
}
