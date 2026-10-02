// Models — the model-assignment management surface.
//
// Wraps `hermes_cli/web_routers/models.py` over the app's authed ops helpers,
// mirroring Hermes Desktop's `ModelsPage.tsx`. Transport only. The main-slot
// picker already lives in the composer; this service backs the management page.
import { modelAuxiliary, modelInfo, modelRecommendedDefault } from './api';

export interface ModelInfo {
  model: string;
  provider: string;
  autoContextLength: number;
  configContextLength: number;
  effectiveContextLength: number;
  capabilities: {
    supportsTools: boolean;
    supportsVision: boolean;
    supportsReasoning: boolean;
    contextWindow: number;
    maxOutputTokens: number;
    modelFamily: string;
  };
}

export interface AuxiliaryTask {
  task: string;
  provider: string;
  model: string;
  baseUrl: string;
  reasoningEffort: string | null;
  localEndpoint: boolean;
}

export interface AuxiliaryModels {
  tasks: AuxiliaryTask[];
  main: { provider: string; model: string };
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
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export async function getModelInfo(opsGet: OpsGet, profile?: string | null): Promise<ModelInfo> {
  const r = rec(await opsGet(modelInfo(profile)));
  const c = rec(r.capabilities);
  return {
    model: str(r.model),
    provider: str(r.provider),
    autoContextLength: num(r.auto_context_length),
    configContextLength: num(r.config_context_length),
    effectiveContextLength: num(r.effective_context_length),
    capabilities: {
      supportsTools: c.supports_tools === true,
      supportsVision: c.supports_vision === true,
      supportsReasoning: c.supports_reasoning === true,
      contextWindow: num(c.context_window),
      maxOutputTokens: num(c.max_output_tokens),
      modelFamily: str(c.model_family),
    },
  };
}

export async function getAuxiliaryModels(opsGet: OpsGet, profile?: string | null): Promise<AuxiliaryModels> {
  const r = rec(await opsGet(modelAuxiliary(profile)));
  const tasks: AuxiliaryTask[] = [];
  for (const raw of arr(r.tasks)) {
    const t = rec(raw);
    const task = str(t.task);
    if (!task) continue;
    tasks.push({
      task,
      provider: str(t.provider) || 'auto',
      model: str(t.model),
      baseUrl: str(t.base_url),
      reasoningEffort: typeof t.reasoning_effort === 'string' ? t.reasoning_effort : null,
      localEndpoint: t.local_endpoint === true,
    });
  }
  const main = rec(r.main);
  return { tasks, main: { provider: str(main.provider), model: str(main.model) } };
}

export interface ModelAssignmentResult {
  ok: boolean;
  confirmRequired: boolean;
  confirmMessage: string;
}

/**
 * Assign a provider/model to a slot. `scope="auxiliary"` with `task=""` applies
 * to every slot; `task="__reset__"` resets every slot to `provider="auto"`.
 */
export async function setModelAssignment(
  opsMut: OpsMut,
  body: {
    scope: 'main' | 'auxiliary';
    provider: string;
    model: string;
    task?: string;
    reasoningEffort?: string | null;
    confirmExpensiveModel?: boolean;
    profile?: string | null;
  },
): Promise<ModelAssignmentResult> {
  const payload: Record<string, unknown> = {
    scope: body.scope,
    provider: body.provider,
    model: body.model,
    ...(body.task !== undefined ? { task: body.task } : {}),
    ...(body.profile ? { profile: body.profile } : {}),
  };
  if (body.reasoningEffort !== undefined) payload.reasoning_effort = body.reasoningEffort;
  if (body.confirmExpensiveModel) payload.confirm_expensive_model = true;
  const r = rec(await opsMut('/api/model/set', 'POST', payload));
  return {
    ok: r.ok !== false,
    confirmRequired: r.confirm_required === true,
    confirmMessage: str(r.confirm_message),
  };
}

/** Recommended default model for a freshly-authenticated provider. */
export async function getRecommendedDefault(
  opsGet: OpsGet,
  provider: string,
  profile?: string | null,
): Promise<{ provider: string; model: string; freeTier: boolean | null }> {
  const r = rec(await opsGet(modelRecommendedDefault(provider, profile)));
  return {
    provider: str(r.provider) || provider,
    model: str(r.model),
    freeTier: typeof r.free_tier === 'boolean' ? r.free_tier : null,
  };
}

/** The auxiliary slots, with display labels — matches `_AUX_TASK_SLOTS`. */
export const AUX_TASKS: ReadonlyArray<{ key: string; label: string; hint: string }> = [
  { key: 'vision', label: 'Vision', hint: 'Image analysis' },
  { key: 'compression', label: 'Compression', hint: 'Context compaction' },
  { key: 'skills_hub', label: 'Skills Hub', hint: 'Skill search' },
  { key: 'approval', label: 'Approval', hint: 'Smart auto-approve' },
  { key: 'mcp', label: 'MCP', hint: 'MCP tool routing' },
  { key: 'title_generation', label: 'Title Gen', hint: 'Session titles' },
  { key: 'review', label: 'Review', hint: '/review subagent' },
  { key: 'triage_specifier', label: 'Triage Specifier', hint: 'Kanban spec fleshing' },
  { key: 'kanban_decomposer', label: 'Kanban Decomposer', hint: 'Task decomposition' },
  { key: 'profile_describer', label: 'Profile Describer', hint: 'Auto profile descriptions' },
  { key: 'curator', label: 'Curator', hint: 'Skill-usage review' },
];

/** Human-readable context length, e.g. 200000 → "200K". */
export function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}
