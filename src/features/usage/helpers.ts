// Pure helpers for the Usage screen.
export interface ToolSkillItem {
  name: string;
  count: number;
  percentage?: number;
}

/** One row of `GET /api/analytics/models` (`_get_models_analytics`). */
export interface ModelUsageItem {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  estimatedCost: number;
  actualCost: number;
  sessions: number;
  apiCalls: number;
  toolCalls: number;
  avgTokensPerSession: number;
  lastUsedAt: number | null;
  /** Auxiliary-task models (vision/compression) carry the task name. */
  auxTask: string;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Normalize `GET /api/analytics/models` into typed rows, largest token total first. */
export function normalizeModelUsage(raw: unknown): ModelUsageItem[] {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rows = Array.isArray(rec.models) ? rec.models : [];
  const out: ModelUsageItem[] = [];
  for (const rawRow of rows) {
    const r = rawRow && typeof rawRow === 'object' ? (rawRow as Record<string, unknown>) : {};
    const model = String(r.model ?? '').trim();
    if (!model) continue;
    out.push({
      model,
      provider: String(r.provider ?? r.billing_provider ?? ''),
      inputTokens: num(r.input_tokens),
      outputTokens: num(r.output_tokens),
      cacheReadTokens: num(r.cache_read_tokens),
      reasoningTokens: num(r.reasoning_tokens),
      estimatedCost: num(r.estimated_cost),
      actualCost: num(r.actual_cost),
      sessions: num(r.sessions),
      apiCalls: num(r.api_calls),
      toolCalls: num(r.tool_calls),
      avgTokensPerSession: num(r.avg_tokens_per_session),
      lastUsedAt: typeof r.last_used_at === 'number' ? r.last_used_at : null,
      auxTask: String(r.aux_task ?? ''),
    });
  }
  out.sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
  return out;
}

export function normalizeToolSkillList(raw: any, keyField: 'tool' | 'skill'): ToolSkillItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item, idx) => {
      if (typeof item === 'string') {
        return { name: item, count: 1 };
      }
      if (typeof item === 'object' && item !== null) {
        const name = String(item[keyField] ?? item.name ?? item.id ?? item.key ?? `Item ${idx + 1}`);
        const count = typeof item.count === 'number' ? item.count : Number(item.count || item.total || item.calls || 0);
        const percentage = typeof item.percentage === 'number' ? item.percentage : undefined;
        return { name, count, percentage };
      }
      return { name: String(item), count: 1 };
    });
  }
  if (typeof raw === 'object' && raw !== null) {
    return Object.entries(raw).map(([key, val]) => {
      if (typeof val === 'number') {
        return { name: key, count: val };
      }
      if (typeof val === 'object' && val !== null) {
        const item = val as any;
        const name = String(item[keyField] ?? item.name ?? key);
        const count = typeof item.count === 'number' ? item.count : Number(item.count || item.total || item.calls || 0);
        const percentage = typeof item.percentage === 'number' ? item.percentage : undefined;
        return { name, count, percentage };
      }
      return { name: key, count: Number(val) || 0 };
    });
  }
  return [];
}
