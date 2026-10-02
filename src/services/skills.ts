// Agent skills inventory — ported from Hermes Desktop (`apps/desktop/src/api/skills.ts`).
//
// Same backend REST contract, routed through the mobile app's authed ops
// helpers (cookie auth, no Authorization header). All best-effort: older
// backends without these routes reject, and callers degrade to a notice.
import { skillContent, skillContentUpdate, skillCreate, skills, skillToggle } from './api';

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
  const rows =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { skills?: unknown }).skills
      : undefined;
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];
}

export async function getSkills(opsGet: (path: string) => Promise<unknown>): Promise<SkillInfo[]> {
  const res = await opsGet(skills());
  return rowsOf(res);
}

export async function getSkillContent(
  opsGet: (path: string) => Promise<unknown>,
  name: string,
): Promise<{ content: string; name: string; path: string }> {
  const res = await opsGet(skillContent(name));
  const rec = res && typeof res === 'object' && !Array.isArray(res) ? (res as Record<string, unknown>) : {};
  return {
    content: String(rec.content ?? ''),
    name: String(rec.name ?? name),
    path: String(rec.path ?? ''),
  };
}

export async function setSkillEnabled(
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>,
  name: string,
  enabled: boolean,
): Promise<void> {
  await opsMut(skillToggle(), 'PUT', { name, enabled });
}

/** Replace an existing skill's SKILL.md (full rewrite).
 *
 *  Backend validates frontmatter/name/size via the agent's own skill_manage
 *  write path, so a bad edit returns a 400 with an actionable message — callers
 *  surface it inline in the editor rather than as a toast. */
export async function updateSkillContent(
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>,
  name: string,
  content: string,
): Promise<void> {
  await opsMut(skillContentUpdate(), 'PUT', { name, content });
}

/** Create a new skill from the editor (name + optional category + body). */
export async function createSkill(
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>,
  input: { name: string; content: string; category?: string },
): Promise<void> {
  const category = String(input.category ?? '').trim();
  await opsMut(skillCreate(), 'POST', {
    name: input.name,
    content: input.content,
    ...(category ? { category } : {}),
  });
}
