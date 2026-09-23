// Context / token / cost snapshot for the composer status strip.
//
// The gateway publishes the same numbers in two shapes: nested under
// `session.info.usage` (tui_gateway `_session_info`) and flat from the
// `session.usage` RPC (`_session_usage_snapshot`). Both carry
// `context_used` / `context_max` / `context_percent` (from
// agent/context_breakdown.py), so one reader covers either source.

export interface UsageSnapshot {
  contextPercent?: number;
  contextUsed?: number;
  contextMax?: number;
  contextEstimated?: boolean;
  total?: number;
  input?: number;
  output?: number;
  subagents?: number;
  costUsd?: number;
}

/** Pick the fields the strip shows; null when the object has none of them. */
export function readUsage(u: unknown): UsageSnapshot | null {
  if (!u || typeof u !== 'object') return null;
  const o = u as Record<string, unknown>;
  const num = (k: string): number | undefined => (typeof o[k] === 'number' ? (o[k] as number) : undefined);
  const snap: UsageSnapshot = {
    contextPercent: num('context_percent'),
    contextUsed: num('context_used'),
    contextMax: num('context_max'),
    total: num('total'),
    input: num('input'),
    output: num('output'),
    subagents: num('active_subagents'),
    costUsd: num('cost_usd'),
  };
  // Only flag estimation when there is something to show, so an empty object
  // reads as "no data" rather than a snapshot.
  if (o.context_estimated === true) snap.contextEstimated = true;
  return Object.values(snap).some((v) => v !== undefined) ? snap : null;
}

/**
 * Merge usage snapshots in freshness order. Snapshots can be complementary:
 * `session.info` may carry token counters while the `session.usage` RPC/event
 * carries the context window (and vice versa on older gateways).
 */
export function mergeUsage(...values: unknown[]): UsageSnapshot | null {
  const merged: UsageSnapshot = {};
  let found = false;
  for (const value of values) {
    const snapshot = readUsage(value);
    if (!snapshot) continue;
    found = true;
    for (const [key, field] of Object.entries(snapshot)) {
      if (field !== undefined) (merged as Record<string, unknown>)[key] = field;
    }
  }
  return found ? merged : null;
}

/** Bar colour bucket for a used-context percentage. */
export function contextTone(percent: number): 'ok' | 'warn' | 'hot' {
  if (percent >= 85) return 'hot';
  if (percent >= 60) return 'warn';
  return 'ok';
}
