// Agent profiles — the multi-persona/workspace surface.
//
// Wraps `hermes_cli/web_routers/profiles.py` over the app's authed ops helpers,
// mirroring Hermes Desktop's `ProfilesPage.tsx`. Transport only.
import {
  profile as profilePath,
  profileDescription,
  profileDescribeAuto,
  profileExport,
  profileImport,
  profileModel,
  profileSoul,
  profiles as profilesPath,
} from './api';

export interface ProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
  model: string | null;
  provider: string | null;
  hasEnv: boolean;
  skillCount: number;
  gatewayRunning: boolean;
  description: string;
  descriptionAuto: boolean;
  displayName: string;
  hasAlias: boolean;
}

type OpsGet = (path: string) => Promise<unknown>;
type OpsMut = (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

export async function getProfiles(opsGet: OpsGet): Promise<ProfileInfo[]> {
  const r = rec(await opsGet(profilesPath()));
  const rows = Array.isArray(r.profiles) ? r.profiles : [];
  const out: ProfileInfo[] = [];
  for (const raw of rows) {
    const p = rec(raw);
    const name = str(p.name);
    if (!name) continue;
    out.push({
      name,
      path: str(p.path),
      isDefault: p.is_default === true,
      model: strOrNull(p.model),
      provider: strOrNull(p.provider),
      hasEnv: p.has_env === true,
      skillCount: typeof p.skill_count === 'number' ? p.skill_count : 0,
      gatewayRunning: p.gateway_running === true,
      description: str(p.description),
      descriptionAuto: p.description_auto === true,
      displayName: str(p.display_name),
      hasAlias: p.has_alias === true,
    });
  }
  return out;
}

export async function createProfile(
  opsMut: OpsMut,
  input: { name: string; cloneFromDefault?: boolean; cloneAll?: boolean; description?: string },
): Promise<void> {
  await opsMut(profilesPath(), 'POST', {
    name: input.name,
    ...(input.cloneFromDefault ? { clone_from_default: true } : {}),
    ...(input.cloneAll ? { clone_all: true } : {}),
    ...(input.description ? { description: input.description } : {}),
  });
}

export async function renameProfile(opsMut: OpsMut, name: string, newName: string): Promise<void> {
  await opsMut(profilePath(name), 'PATCH', { new_name: newName });
}

export async function deleteProfile(opsMut: OpsMut, name: string): Promise<void> {
  await opsMut(profilePath(name), 'DELETE');
}

export async function setActiveProfile(opsMut: OpsMut, name: string): Promise<void> {
  await opsMut('/api/profiles/active', 'POST', { name });
}

export async function getProfileSoul(opsGet: OpsGet, name: string): Promise<{ content: string; exists: boolean }> {
  const r = rec(await opsGet(profileSoul(name)));
  return { content: str(r.content), exists: r.exists === true };
}

export async function updateProfileSoul(opsMut: OpsMut, name: string, content: string): Promise<void> {
  await opsMut(profileSoul(name), 'PUT', { content });
}

export async function updateProfileDescription(opsMut: OpsMut, name: string, description: string): Promise<void> {
  await opsMut(profileDescription(name), 'PUT', { description });
}

/** Auto-generate a description via the auxiliary LLM. Returns the new text. */
export async function describeProfileAuto(
  opsMut: OpsMut,
  name: string,
  overwrite = true,
): Promise<{ ok: boolean; description: string; reason: string }> {
  const r = rec(await opsMut(profileDescribeAuto(name), 'POST', { overwrite }));
  return { ok: r.ok !== false, description: str(r.description), reason: str(r.reason ?? r.error) };
}

export async function updateProfileModel(
  opsMut: OpsMut,
  name: string,
  provider: string,
  model: string,
): Promise<void> {
  await opsMut(profileModel(name), 'PUT', { provider, model });
}

/** Export a profile to a `.tar.gz` on the backend; returns the archive path. */
export async function exportProfile(opsMut: OpsMut, name: string): Promise<string> {
  const r = rec(await opsMut(profileExport(name), 'POST', {}));
  return str(r.archive);
}

/** Import a profile from a `.tar.gz` already on the backend filesystem. */
export async function importProfile(opsMut: OpsMut, archive: string, name?: string): Promise<string> {
  const r = rec(await opsMut(profileImport(), 'POST', { archive, ...(name ? { name } : {}) }));
  return str(r.name);
}
