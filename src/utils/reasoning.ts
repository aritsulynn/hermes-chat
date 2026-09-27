// Reasoning-effort vocabulary + labels.
//
// Ported from apps/shared/src/reasoning-effort.ts and
// apps/desktop/src/lib/reasoning-effort.ts (Hermes Desktop). Mirrors the
// backend's VALID_REASONING_EFFORTS (hermes_constants.py): `none` is not a
// level, it's thinking disabled.

/** Hermes' reasoning levels, ascending — the backend's own order. */
export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** The scale plus the off state — the full set `/reasoning` accepts. */
export const REASONING_EFFORT_VALUES = ['none', ...REASONING_EFFORTS] as const;

export type ReasoningEffortValue = (typeof REASONING_EFFORT_VALUES)[number];

/** True for a real level (case-insensitive, trimmed); `none` is not a level. */
export const isReasoningEffort = (value: string): value is ReasoningEffort =>
  (REASONING_EFFORTS as readonly string[]).includes(value.trim().toLowerCase());

const LABELS: Record<string, string> = {
  none: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  ultra: 'Ultra',
};

/** Pretty label for the composer chip / picker rows (`xhigh` → `XHigh`). */
export function reasoningLabel(effort: string, wire?: string): string {
  const clamp = reasoningEffortClamp(effort, wire);
  if (clamp) return `${LABELS[clamp.effort] ?? effort}→${LABELS[clamp.wire] ?? clamp.wire}`;
  const key = effort.trim().toLowerCase();
  return LABELS[key] ?? effort;
}

const normalizeEffort = (v: string) => v.trim().toLowerCase();

/** A pick the route does not send verbatim (e.g. `ultra` → `max` on
 *  OpenAI-compatible wires). `wire` comes from the gateway's
 *  `session.info.reasoning_effort_wire`; nothing is inferred client-side, so an
 *  empty/equal wire reads as "no clamp". */
export function reasoningEffortClamp(
  effort: string,
  wire: string | undefined,
): { effort: ReasoningEffort; wire: ReasoningEffort } | null {
  const picked = normalizeEffort(effort);
  const sent = normalizeEffort(wire ?? '');
  if (!sent || sent === picked || !isReasoningEffort(picked) || !isReasoningEffort(sent)) return null;
  return { effort: picked, wire: sent };
}

/** Per-model capability row from `model.options`
 *  (hermes_cli/inventory.py::_apply_capabilities → `ModelCapabilities`). */
export interface ModelReasoningCapability {
  fast?: boolean;
  reasoning?: boolean;
  can_disable_reasoning?: boolean | null;
}

interface ProviderWithCaps {
  slug: string;
  isCurrent?: boolean;
  capabilities?: Record<string, ModelReasoningCapability> | null;
}

/** Look up a model's reasoning capability across the provider rows. Returns
 *  undefined when the backend didn't publish one (older gateway) — callers
 *  should then keep the control visible rather than hide a capable model's dial. */
export function reasoningCapability(
  providers: ProviderWithCaps[] | null | undefined,
  providerSlug: string,
  model: string,
): ModelReasoningCapability | undefined {
  const rows = providers ?? [];
  const byProvider = rows.find((p) => p.slug === providerSlug);
  return (
    byProvider?.capabilities?.[model] ??
    rows.map((r) => r.capabilities?.[model]).find((c): c is ModelReasoningCapability => !!c)
  );
}
