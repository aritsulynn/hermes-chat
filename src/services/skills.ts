// Agent skills inventory — ported from Hermes Desktop (`apps/desktop/src/api/skills.ts`).
//
// Same backend REST contract, routed through the mobile app's authed ops
// helpers (cookie auth, no Authorization header). All best-effort: older
// backends without these routes reject, and callers degrade to a notice.
import {
  skillContent,
  skillContentUpdate,
  skillCreate,
  skillHubInstall,
  skillHubPreview,
  skillHubScan,
  skillHubSearch,
  skillHubSources,
  skillHubUninstall,
  skillHubUpdate,
  skills,
  skillToggle,
} from './api';

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

// ── Skills hub ──────────────────────────────────────────────────────────────

/** One hub search result / featured row (`_skill_meta_to_payload`). */
export interface SkillHubResult {
  name: string;
  description: string;
  source: string;
  identifier: string;
  trust_level: string;
  repo?: string | null;
  tags: string[];
}

/** A connected hub source (`GET /api/skills/hub/sources`). */
export interface SkillHubSource {
  id: string;
  label: string;
  rate_limited?: boolean;
  available?: boolean;
  searchable?: boolean;
}

export interface SkillHubSources {
  sources: SkillHubSource[];
  indexAvailable: boolean;
  featured: SkillHubResult[];
  /** identifier -> installed lock entry. */
  installed: Record<string, { name?: string; trust_level?: string; scan_verdict?: string }>;
}

export interface SkillHubSearchResult {
  results: SkillHubResult[];
  sourceCounts: Record<string, number>;
  timedOut: string[];
  installed: SkillHubSources['installed'];
}

export interface SkillHubPreview {
  name: string;
  description: string;
  source: string;
  identifier: string;
  trustLevel: string;
  repo?: string | null;
  tags: string[];
  skillMd: string;
  files: string[];
}

export interface SkillHubScanFinding {
  severity: string;
  category?: string;
  file?: string;
  line?: number | null;
  description?: string;
}

export interface SkillHubScan {
  name: string;
  identifier: string;
  source: string;
  trustLevel: string;
  verdict: string;
  summary: string;
  policy: string;
  policyReason: string;
  findings: SkillHubScanFinding[];
  severityCounts: Record<string, number>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

function hubResults(value: unknown): SkillHubResult[] {
  if (!Array.isArray(value)) return [];
  const out: SkillHubResult[] = [];
  for (const raw of value) {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    out.push({
      name: str(r.name),
      description: str(r.description),
      source: str(r.source),
      identifier: str(r.identifier),
      trust_level: str(r.trust_level) || 'community',
      repo: typeof r.repo === 'string' ? r.repo : null,
      tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    });
  }
  return out;
}

function installedMap(value: unknown): SkillHubSources['installed'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: SkillHubSources['installed'] = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    out[id] = {
      name: typeof r.name === 'string' ? r.name : undefined,
      trust_level: typeof r.trust_level === 'string' ? r.trust_level : undefined,
      scan_verdict: typeof r.scan_verdict === 'string' ? r.scan_verdict : undefined,
    };
  }
  return out;
}

/** Connected hub sources + featured skills + installed provenance. */
export async function getSkillHubSources(
  opsGet: (path: string) => Promise<unknown>,
  profile?: string | null,
): Promise<SkillHubSources> {
  const res = await opsGet(skillHubSources(profile));
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  const sources: SkillHubSource[] = [];
  if (Array.isArray(r.sources)) {
    for (const raw of r.sources) {
      const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const id = str(s.id);
      if (!id) continue;
      sources.push({
        id,
        label: str(s.label) || id,
        ...(typeof s.rate_limited === 'boolean' ? { rate_limited: s.rate_limited } : {}),
        ...(typeof s.available === 'boolean' ? { available: s.available } : {}),
        ...(typeof s.searchable === 'boolean' ? { searchable: s.searchable } : {}),
      });
    }
  }
  return {
    sources,
    indexAvailable: r.index_available === true,
    featured: hubResults(r.featured),
    installed: installedMap(r.installed),
  };
}

/** Search every configured hub source. */
export async function searchSkillHub(
  opsGet: (path: string) => Promise<unknown>,
  q: string,
  opts: { source?: string; limit?: number; profile?: string | null } = {},
): Promise<SkillHubSearchResult> {
  const res = await opsGet(skillHubSearch(q, opts));
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  return {
    results: hubResults(r.results),
    sourceCounts:
      r.source_counts && typeof r.source_counts === 'object' ? (r.source_counts as Record<string, number>) : {},
    timedOut: Array.isArray(r.timed_out) ? r.timed_out.map(String) : [],
    installed: installedMap(r.installed),
  };
}

/** A hub skill's SKILL.md + file manifest, without installing. */
export async function previewSkillHub(
  opsGet: (path: string) => Promise<unknown>,
  identifier: string,
): Promise<SkillHubPreview> {
  const res = await opsGet(skillHubPreview(identifier));
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  return {
    name: str(r.name) || identifier,
    description: str(r.description),
    source: str(r.source),
    identifier: str(r.identifier) || identifier,
    trustLevel: str(r.trust_level) || 'community',
    repo: typeof r.repo === 'string' ? r.repo : null,
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    skillMd: str(r.skill_md),
    files: Array.isArray(r.files) ? r.files.map(String) : [],
  };
}

/** Install-time security scan, without installing. */
export async function scanSkillHub(
  opsGet: (path: string) => Promise<unknown>,
  identifier: string,
): Promise<SkillHubScan> {
  const res = await opsGet(skillHubScan(identifier));
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  const findings: SkillHubScanFinding[] = [];
  if (Array.isArray(r.findings)) {
    for (const raw of r.findings) {
      const f = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      findings.push({
        severity: str(f.severity),
        ...(typeof f.category === 'string' ? { category: f.category } : {}),
        ...(typeof f.file === 'string' ? { file: f.file } : {}),
        ...(typeof f.line === 'number' ? { line: f.line } : {}),
        ...(typeof f.description === 'string' ? { description: f.description } : {}),
      });
    }
  }
  return {
    name: str(r.name) || identifier,
    identifier: str(r.identifier) || identifier,
    source: str(r.source),
    trustLevel: str(r.trust_level) || 'community',
    verdict: str(r.verdict),
    summary: str(r.summary),
    policy: str(r.policy),
    policyReason: str(r.policy_reason),
    findings,
    severityCounts:
      r.severity_counts && typeof r.severity_counts === 'object' ? (r.severity_counts as Record<string, number>) : {},
  };
}

type OpsMut = (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;

/** Start installing a hub skill. Returns the spawned action's name for polling. */
export async function installSkillHub(opsMut: OpsMut, identifier: string, profile?: string | null): Promise<string> {
  const res = await opsMut(skillHubInstall(), 'POST', {
    identifier,
    ...(String(profile ?? '').trim() ? { profile: String(profile).trim() } : {}),
  });
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  return str(r.name);
}

/** Uninstall an installed hub skill. Returns the spawned action's name. */
export async function uninstallSkillHub(opsMut: OpsMut, name: string, profile?: string | null): Promise<string> {
  const res = await opsMut(skillHubUninstall(), 'POST', {
    name,
    ...(String(profile ?? '').trim() ? { profile: String(profile).trim() } : {}),
  });
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  return str(r.name);
}

/** Update every installed hub skill. Returns the spawned action's name. */
export async function updateSkillsHub(opsMut: OpsMut, profile?: string | null): Promise<string> {
  const res = await opsMut(skillHubUpdate(), 'POST', {
    ...(String(profile ?? '').trim() ? { profile: String(profile).trim() } : {}),
  });
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  return str(r.name);
}
