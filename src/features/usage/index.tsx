import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import { AlertCircle, Cpu, DollarSign, MessageSquare, RefreshCw, TrendingUp, Wrench, Zap } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { Card, HeaderIconButton, ScreenHeader, ScreenScaffold } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert as UIAlert, AlertDescription } from '../../components/ui/alert';
import { Progress } from '../../components/ui/progress';
import { Spinner } from '../../components/ui/bits';
import { brandColor, screenStyle } from '../../theme';
import * as api from '../../services/api';
import { compactNumber, formatCost } from '../../utils/format';
import { DayBar } from './components/DayBar';
import { normalizeModelUsage, normalizeToolSkillList } from './helpers';
import type { ModelUsageItem, ToolSkillItem } from './helpers';

const PERIOD_OPTIONS = [
  { label: '7 Days', days: 7 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
] as const;

export function UsageScreen() {
  const { authed, opsGet, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  // Shared by the spinner and the KPI icon — resolve once per scheme.
  const brand = useMemo(() => brandColor(dark), [dark]);

  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<any>(null);
  const [modelsData, setModelsData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<any | null>(null);

  useEffect(() => {
    if (authed) return;
    setData(null);
    setSelectedDay(null);
    setError(null);
    setLoading(true);
  }, [authed]);

  const fetchUsage = useCallback(
    async (isRefresh = false) => {
      const scope = getAuthScope();
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        // Fire both analytics calls together — the model breakdown is a second
        // endpoint and there is no reason to serialize them.
        const [res, modelsRes] = await Promise.all([
          opsGet(api.usage(days)),
          opsGet(api.usageModels(days)).catch((e) => {
            // Older gateways may lack /analytics/models; degrade to the
            // by_model rows already inside /analytics/usage.
            console.warn('[usage] models analytics unavailable', e);
            return null;
          }),
        ]);
        if (getAuthScope() !== scope) return;
        setData(res);
        setModelsData(modelsRes);
      } catch (e) {
        if (getAuthScope() === scope) setError(errMsg(e));
      } finally {
        if (getAuthScope() === scope) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [days, getAuthScope, opsGet],
  );

  useEffect(() => {
    if (authed) void fetchUsage();
  }, [authed, fetchUsage]);

  const totals = data?.totals || {};
  const totalTokens = (totals?.total_input || 0) + (totals?.total_output || 0) + (totals?.total_reasoning || 0);
  const dailyEntries: any[] = Array.isArray(data?.daily) ? data.daily : [];
  const modelEntries: any[] = Array.isArray(data?.by_model) ? data.by_model : [];
  // Prefer the richer `/analytics/models` rows (provider, cost, sessions); fall
  // back to the lighter `by_model` from `/analytics/usage` when either is empty.
  const modelUsage: ModelUsageItem[] = useMemo(() => normalizeModelUsage(modelsData), [modelsData]);
  const richModels = modelUsage.length > 0;
  const toolsList: ToolSkillItem[] = useMemo(() => normalizeToolSkillList(data?.tools, 'tool'), [data?.tools]);
  const skillsList: ToolSkillItem[] = useMemo(() => normalizeToolSkillList(data?.skills, 'skill'), [data?.skills]);

  // Fill in missing days so the chart shows a continuous daily timeline
  const fullDailyEntries = useMemo(() => {
    const entryMap = new Map<string, any>();
    for (const d of dailyEntries) {
      if (d?.day) {
        entryMap.set(d.day, d);
      }
    }

    const result: any[] = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 86400000);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dayStr = `${year}-${month}-${day}`;

      if (entryMap.has(dayStr)) {
        result.push(entryMap.get(dayStr));
      } else {
        result.push({
          day: dayStr,
          input_tokens: 0,
          output_tokens: 0,
          reasoning_tokens: 0,
          cache_read_tokens: 0,
          estimated_cost: 0,
          actual_cost: 0,
          sessions: 0,
          api_calls: 0,
          isZero: true,
        });
      }
    }

    return result;
  }, [dailyEntries, days]);

  // Maximum tokens in a single day for bar heights
  const maxDayTokens = useMemo(() => {
    let max = 1;
    for (const d of fullDailyEntries) {
      const dayTokens = (d?.input_tokens || 0) + (d?.output_tokens || 0) + (d?.reasoning_tokens || 0);
      if (dayTokens > max) max = dayTokens;
    }
    return max;
  }, [fullDailyEntries]);
  const handleSelectDay = useCallback(
    (day: string) => {
      setSelectedDay((prev: any) => (prev?.day === day ? null : (fullDailyEntries.find((d) => d.day === day) ?? null)));
    },
    [fullDailyEntries],
  );

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
      {/* No 'bottom' edge: the scroll content pads the safe area + 32. */}
      <ScreenScaffold
        header={
          <>
            {/* Header */}
            <ScreenHeader
              title="Usage & Analytics"

              actions={
                <HeaderIconButton
                  variant="outline"
                  aria-label="Refresh usage"
                  disabled={loading || refreshing}
                  onClick={() => void fetchUsage(true)}
                  className="border border-border">
                  <RefreshCw size={20} color={dark ? '#ccc' : '#444'} />
                </HeaderIconButton>
              }
            />

            {/* Period Selector Bar */}
            <div className="flex items-center justify-between border-b border-border bg-elevated px-4 py-2.5 dark:bg-elevated">
              <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Time Period</div>
              <div className="flex gap-1">
                {PERIOD_OPTIONS.map((opt) => (
                  <Button
                    key={opt.days}
                    variant="ghost"

                    aria-pressed={days === opt.days}
                    aria-label={opt.label}
                    onClick={() => setDays(opt.days)}
                    className={`h-auto sm:h-auto rounded-lg border px-3 py-1.5 ${
                      days === opt.days
                        ? 'border-brand bg-brand'
                        : 'border-border bg-popover dark:border-border'
                    }`}>
                    <span
                      className={`text-xs font-semibold ${
                        days === opt.days ? 'text-white' : 'text-neutral-700 dark:text-neutral-300'
                      }`}>
                      {opt.label}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          </>
        }>
        {error && (
          <div className="m-4">
            <UIAlert icon={AlertCircle} variant="destructive">
              <AlertDescription className="text-xs font-medium text-red-700 dark:text-red-300">
                {error}
              </AlertDescription>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void fetchUsage(true)}
                className="ml-6 mt-1 self-start">
                <span className="text-xs font-medium text-white">Retry</span>
              </Button>
            </UIAlert>
          </div>
        )}

        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-3.5 pb-[calc(env(safe-area-inset-bottom,0px)+32px)]">
            {loading && !refreshing ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Spinner size={24} color={brand} />
                <div className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Loading usage analytics…</div>
              </div>
            ) : (
              <>
                {/* KPI Cards Grid */}
                <div className="flex flex-wrap gap-2.5">
                  {/* Total Tokens */}
                  <Card className="flex-1 min-w-[140px]">
                    <div className="flex items-center gap-1.5">
                      <TrendingUp size={16} color={brand} />
                      <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Total Tokens</div>
                    </div>
                    <div className="mt-1.5 text-2xl font-black text-neutral-950 dark:text-neutral-100">
                      {compactNumber(totalTokens)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-neutral-400">in {days} days</div>
                  </Card>

                  {/* Estimated Cost */}
                  <Card className="flex-1 min-w-[140px]">
                    <div className="flex items-center gap-1.5">
                      <DollarSign size={16} color="#16a34a" />
                      <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Est. Cost</div>
                    </div>
                    <div className="mt-1.5 text-2xl font-black text-neutral-950 dark:text-neutral-100">
                      {formatCost(totals?.total_estimated_cost)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-neutral-400">
                      Actual: {formatCost(totals?.total_actual_cost)}
                    </div>
                  </Card>

                  {/* Sessions */}
                  <Card className="flex-1 min-w-[140px]">
                    <div className="flex items-center gap-1.5">
                      <MessageSquare size={16} color="#8b5cf6" />
                      <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Sessions</div>
                    </div>
                    <div className="mt-1.5 text-2xl font-black text-neutral-950 dark:text-neutral-100">
                      {totals?.total_sessions?.toLocaleString() || '0'}
                    </div>
                    <div className="mt-0.5 text-[11px] text-neutral-400">conversations</div>
                  </Card>

                  {/* API Calls */}
                  <Card className="flex-1 min-w-[140px]">
                    <div className="flex items-center gap-1.5">
                      <Zap size={16} color="#f59e0b" />
                      <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">API Calls</div>
                    </div>
                    <div className="mt-1.5 text-2xl font-black text-neutral-950 dark:text-neutral-100">
                      {totals?.total_api_calls?.toLocaleString() || '0'}
                    </div>
                    <div className="mt-0.5 text-[11px] text-neutral-400">requests</div>
                  </Card>
                </div>

                {/* Token Breakdown Card */}
                <Card>
                  <div className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Token Breakdown</div>
                  <div className="flex flex-col mt-3 gap-2.5">
                    {/* Input Tokens */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <div className="text-xs text-neutral-600 dark:text-neutral-300">Input Tokens</div>
                        <div className="text-xs font-semibold text-neutral-950 dark:text-neutral-100 font-mono">
                          {(totals?.total_input || 0).toLocaleString()}
                        </div>
                      </div>
                      <Progress
                        value={Math.min(100, totalTokens ? ((totals?.total_input || 0) / totalTokens) * 100 : 0)}
                        indicatorClassName="bg-brand"
                        className="bg-border"
                      />
                    </div>

                    {/* Output Tokens */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <div className="text-xs text-neutral-600 dark:text-neutral-300">Output Tokens</div>
                        <div className="text-xs font-semibold text-neutral-950 dark:text-neutral-100 font-mono">
                          {(totals?.total_output || 0).toLocaleString()}
                        </div>
                      </div>
                      <Progress
                        value={Math.min(100, totalTokens ? ((totals?.total_output || 0) / totalTokens) * 100 : 0)}
                        indicatorClassName="bg-[#8b5cf6]"
                        className="bg-border"
                      />
                    </div>

                    {/* Reasoning Tokens */}
                    {(totals?.total_reasoning || 0) > 0 && (
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <div className="text-xs text-neutral-600 dark:text-neutral-300">Reasoning / Thinking</div>
                          <div className="text-xs font-semibold text-neutral-950 dark:text-neutral-100 font-mono">
                            {(totals?.total_reasoning || 0).toLocaleString()}
                          </div>
                        </div>
                        <Progress
                          value={Math.min(100, totalTokens ? ((totals?.total_reasoning || 0) / totalTokens) * 100 : 0)}
                          indicatorClassName="bg-[#f59e0b]"
                          className="bg-border"
                        />
                      </div>
                    )}

                    {/* Cache Read Tokens */}
                    {(totals?.total_cache_read || 0) > 0 && (
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <div className="text-xs text-neutral-600 dark:text-neutral-300">Cache Read Tokens</div>
                          <div className="text-xs font-semibold text-neutral-950 dark:text-neutral-100 font-mono">
                            {(totals?.total_cache_read || 0).toLocaleString()}
                          </div>
                        </div>
                        <Progress
                          value={Math.min(100, totalTokens ? ((totals?.total_cache_read || 0) / totalTokens) * 100 : 0)}
                          indicatorClassName="bg-[#10b981]"
                          className="bg-border"
                        />
                      </div>
                    )}
                  </div>
                </Card>

                {/* Daily Activity Chart */}
                <Card>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Daily Activity</div>
                    {selectedDay && (
                      <div className="text-xs font-mono text-brand">
                        {selectedDay.day}:{' '}
                        {compactNumber((selectedDay.input_tokens || 0) + (selectedDay.output_tokens || 0))} tokens (
                        {selectedDay.sessions || 0} sess)
                      </div>
                    )}
                  </div>

                  {fullDailyEntries.length === 0 ? (
                    <div className="mt-4 text-center text-xs text-neutral-400">
                      No activity recorded for this period.
                    </div>
                  ) : (
                    <div className="overflow-x-auto mt-4">
                      <div>
                        <div className="flex items-end gap-2 h-36 pt-4 pb-2 px-1">
                          {fullDailyEntries.map((d) => (
                            <DayBar
                              key={d.day}
                              day={d.day}
                              tokens={(d?.input_tokens || 0) + (d?.output_tokens || 0) + (d?.reasoning_tokens || 0)}
                              maxTokens={maxDayTokens}
                              selected={selectedDay?.day === d.day}
                              onSelect={handleSelectDay}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </Card>

                {/* Usage by Model */}
                <Card>
                  <div className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Usage by Model</div>
                  <div className="flex flex-col mt-3 gap-2.5">
                    {richModels ? (
                      modelUsage.map((m, idx) => {
                        const mTokens = m.inputTokens + m.outputTokens;
                        return (
                          <div
                            key={`${m.provider}:${m.model}-${idx}`}
                            className="rounded-xl border border-border bg-popover p-3 dark:bg-input/30">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-neutral-950 dark:text-neutral-100">
                                  {m.model}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400">
                                  {!!m.provider && (
                                    <span className="rounded-md border border-border px-1.5 py-px font-mono">
                                      {m.provider}
                                    </span>
                                  )}
                                  {!!m.auxTask && (
                                    <span className="rounded-md border border-border px-1.5 py-px">
                                      aux: {m.auxTask}
                                    </span>
                                  )}
                                  <span>
                                    {m.sessions} sessions · {m.apiCalls} calls
                                    {m.toolCalls ? ` · ${m.toolCalls} tools` : ''}
                                  </span>
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-col items-end">
                                <div className="font-mono text-sm font-bold text-neutral-950 dark:text-neutral-100">
                                  {compactNumber(mTokens)}
                                </div>
                                {m.estimatedCost > 0 && (
                                  <div className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                                    {formatCost(m.estimatedCost)}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2">
                              <div className="text-[11px] text-neutral-500">In: {compactNumber(m.inputTokens)}</div>
                              <div className="text-[11px] text-neutral-500">Out: {compactNumber(m.outputTokens)}</div>
                              {m.reasoningTokens > 0 && (
                                <div className="text-[11px] text-neutral-500">
                                  Think: {compactNumber(m.reasoningTokens)}
                                </div>
                              )}
                              {m.avgTokensPerSession > 0 && (
                                <div className="text-[11px] text-neutral-500">
                                  ~{compactNumber(m.avgTokensPerSession)}/sess
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : modelEntries.length === 0 ? (
                      <div className="text-xs text-neutral-400">No model usage data available.</div>
                    ) : (
                      modelEntries.map((m, idx) => {
                        const mTokens = (m?.input_tokens || 0) + (m?.output_tokens || 0);
                        const modelName = String(m?.model ?? `Model ${idx + 1}`);
                        return (
                          <div
                            key={`${modelName}-${idx}`}
                            className="rounded-xl border border-border bg-popover p-3 dark:bg-input/30">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <div className="text-sm font-semibold text-neutral-950 dark:text-neutral-100 truncate">
                                  {modelName}
                                </div>
                                <div className="text-[11px] text-neutral-400 mt-0.5">
                                  {m?.sessions || 0} sessions · {m?.api_calls || 0} calls
                                </div>
                              </div>
                              <div className="flex flex-col items-end">
                                <div className="text-sm font-bold font-mono text-neutral-950 dark:text-neutral-100">
                                  {compactNumber(mTokens)}
                                </div>
                                {Boolean(m.estimated_cost) && (
                                  <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                                    {formatCost(m.estimated_cost)}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2">
                              <div className="text-[11px] text-neutral-500">In: {compactNumber(m.input_tokens)}</div>
                              <div className="text-[11px] text-neutral-500">Out: {compactNumber(m.output_tokens)}</div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </Card>

                {/* Tools & Skills Breakdown */}
                {(toolsList.length > 0 || skillsList.length > 0) && (
                  <Card>
                    <div className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Tools & Skills</div>

                    {/* Tools */}
                    {toolsList.length > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Wrench size={13} color={dark ? '#aaa' : '#666'} />
                          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                            Tools Executed
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {toolsList.map((item) => (
                            <Badge
                              key={item.name}
                              variant="secondary"
                              className="gap-1.5 rounded-lg border-transparent px-2.5 py-1">
                              <span className="font-mono text-xs text-neutral-800 dark:text-neutral-200">
                                {item.name}
                              </span>
                              <span className="font-mono text-[11px] font-bold text-brand">
                                {item.count}
                              </span>
                              {typeof item.percentage === 'number' && (
                                <span className="text-[10px] text-neutral-400">{item.percentage}%</span>
                              )}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Skills */}
                    {skillsList.length > 0 && (
                      <div className="mt-4">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Cpu size={13} color={dark ? '#aaa' : '#666'} />
                          <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                            Skills Triggered
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {skillsList.map((item) => (
                            <Badge
                              key={item.name}
                              variant="secondary"
                              className="gap-1.5 rounded-lg border-transparent px-2.5 py-1">
                              <span className="text-xs text-neutral-800 dark:text-neutral-200">{item.name}</span>
                              <span className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                {item.count}
                              </span>
                              {typeof item.percentage === 'number' && (
                                <span className="text-[10px] text-neutral-400">{item.percentage}%</span>
                              )}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </Card>
                )}
              </>
            )}
        </div>
      </ScreenScaffold>
    </div>
  );
}
