import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  Coins,
  Cpu,
  DollarSign,
  Layers,
  MessageSquare,
  RefreshCw,
  TrendingUp,
  Wrench,
  Zap,
} from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { Card, ScreenHeader } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert as UIAlert, AlertDescription } from '../../components/ui/alert';
import { Progress } from '../../components/ui/progress';
import { Text as UIText } from '../../components/ui/text';
import { Spinner } from '../../components/ui/bits';
import { brandColor, screenStyle } from '../../theme';
import * as api from '../../services/api';
import { compactNumber, formatCost } from '../../utils/format';
import { DayBar } from './components/DayBar';
import { normalizeToolSkillList } from './helpers';
import type { ToolSkillItem } from './helpers';
import { ScrollArea } from '../../components/ui/scroll';

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
        const res = await opsGet(api.usage(days));
        if (getAuthScope() !== scope) return;
        setData(res);
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

    for (let i = days - 1; i>= 0; i--) {
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
      if (dayTokens> max) max = dayTokens;
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
      {/* No 'bottom' edge: ScrollView content pads insets.bottom + 32. */}
      <div className="flex-1 bg-white dark:bg-black">
        

        {/* Header */}
        <ScreenHeader
          title="Usage & Analytics"

          actions={
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh usage"
              disabled={loading || refreshing}
              onClick={() => void fetchUsage(true)}
              className="h-8 w-8 rounded-lg border border-neutral-300 dark:border-neutral-700"
>
              <RefreshCw size={15} color={dark ? '#ccc' : '#444'} />
            </Button>
          }
        />

        {/* Period Selector Bar */}
        <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50/70 px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/60">
          <UIText className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Time Period</UIText>
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map((opt) => (
              <Button
                key={opt.days}
                variant="ghost"

                aria-pressed={days === opt.days}
                aria-label={opt.label}
                onClick={() => setDays(opt.days)}
                className={`h-auto rounded-lg border px-3 py-1.5 ${
                  days === opt.days
                    ? 'border-[#1a73e8] bg-[#1a73e8]'
                    : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950'
                }`}
>
                <UIText
                  className={`text-xs font-semibold ${
                    days === opt.days ? 'text-white' : 'text-neutral-700 dark:text-neutral-300'
                  }`}
>
                  {opt.label}
                </UIText>
              </Button>
            ))}
          </div>
        </div>

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
                className="ml-6 mt-1 self-start"
>
                <UIText className="text-xs font-medium text-white">Retry</UIText>
              </Button>
            </UIAlert>
          </div>
        )}

        <ScrollArea
          contentClassName="p-3.5 pb-[calc(env(safe-area-inset-bottom,0px)+32px)] gap-4"

>
          {loading && !refreshing ? (
            <div className="items-center justify-center py-20">
              <Spinner size={24} color={brand} />
              <UIText className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Loading usage analytics…</UIText>
            </div>
          ) : (
            <>
              {/* KPI Cards Grid */}
              <div className="flex flex-wrap gap-2.5">
                {/* Total Tokens */}
                <Card className="flex-1 min-w-[140px]">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp size={16} color={brand} />
                    <UIText className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Total Tokens</UIText>
                  </div>
                  <UIText className="mt-1.5 text-2xl font-black text-neutral-950 dark:text-neutral-100">
                    {compactNumber(totalTokens)}
                  </UIText>
                  <UIText className="mt-0.5 text-[11px] text-neutral-400">in {days} days</UIText>
                </Card>

                {/* Estimated Cost */}
                <Card className="flex-1 min-w-[140px]">
                  <div className="flex items-center gap-1.5">
                    <DollarSign size={16} color="#16a34a" />
                    <UIText className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Est. Cost</UIText>
                  </div>
                  <UIText className="mt-1.5 text-2xl font-black text-neutral-950 dark:text-neutral-100">
                    {formatCost(totals?.total_estimated_cost)}
                  </UIText>
                  <UIText className="mt-0.5 text-[11px] text-neutral-400">
                    Actual: {formatCost(totals?.total_actual_cost)}
                  </UIText>
                </Card>

                {/* Sessions */}
                <Card className="flex-1 min-w-[140px]">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare size={16} color="#8b5cf6" />
                    <UIText className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Sessions</UIText>
                  </div>
                  <UIText className="mt-1.5 text-2xl font-black text-neutral-950 dark:text-neutral-100">
                    {totals?.total_sessions?.toLocaleString() || '0'}
                  </UIText>
                  <UIText className="mt-0.5 text-[11px] text-neutral-400">conversations</UIText>
                </Card>

                {/* API Calls */}
                <Card className="flex-1 min-w-[140px]">
                  <div className="flex items-center gap-1.5">
                    <Zap size={16} color="#f59e0b" />
                    <UIText className="text-xs font-medium text-neutral-500 dark:text-neutral-400">API Calls</UIText>
                  </div>
                  <UIText className="mt-1.5 text-2xl font-black text-neutral-950 dark:text-neutral-100">
                    {totals?.total_api_calls?.toLocaleString() || '0'}
                  </UIText>
                  <UIText className="mt-0.5 text-[11px] text-neutral-400">requests</UIText>
                </Card>
              </div>

              {/* Token Breakdown Card */}
              <Card>
                <UIText className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Token Breakdown</UIText>
                <div className="mt-3 gap-2.5">
                  {/* Input Tokens */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <UIText className="text-xs text-neutral-600 dark:text-neutral-300">Input Tokens</UIText>
                      <UIText className="text-xs font-semibold text-neutral-950 dark:text-neutral-100 font-mono">
                        {(totals?.total_input || 0).toLocaleString()}
                      </UIText>
                    </div>
                    <Progress
                      value={Math.min(100, totalTokens ? ((totals?.total_input || 0) / totalTokens) * 100 : 0)}
                      indicatorClassName="bg-[#1a73e8]"
                      className="bg-neutral-200 dark:bg-neutral-800"
                    />
                  </div>

                  {/* Output Tokens */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <UIText className="text-xs text-neutral-600 dark:text-neutral-300">Output Tokens</UIText>
                      <UIText className="text-xs font-semibold text-neutral-950 dark:text-neutral-100 font-mono">
                        {(totals?.total_output || 0).toLocaleString()}
                      </UIText>
                    </div>
                    <Progress
                      value={Math.min(100, totalTokens ? ((totals?.total_output || 0) / totalTokens) * 100 : 0)}
                      indicatorClassName="bg-[#8b5cf6]"
                      className="bg-neutral-200 dark:bg-neutral-800"
                    />
                  </div>

                  {/* Reasoning Tokens */}
                  {(totals?.total_reasoning || 0)> 0 && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <UIText className="text-xs text-neutral-600 dark:text-neutral-300">Reasoning / Thinking</UIText>
                        <UIText className="text-xs font-semibold text-neutral-950 dark:text-neutral-100 font-mono">
                          {(totals?.total_reasoning || 0).toLocaleString()}
                        </UIText>
                      </div>
                      <Progress
                        value={Math.min(100, totalTokens ? ((totals?.total_reasoning || 0) / totalTokens) * 100 : 0)}
                        indicatorClassName="bg-[#f59e0b]"
                        className="bg-neutral-200 dark:bg-neutral-800"
                      />
                    </div>
                  )}

                  {/* Cache Read Tokens */}
                  {(totals?.total_cache_read || 0)> 0 && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <UIText className="text-xs text-neutral-600 dark:text-neutral-300">Cache Read Tokens</UIText>
                        <UIText className="text-xs font-semibold text-neutral-950 dark:text-neutral-100 font-mono">
                          {(totals?.total_cache_read || 0).toLocaleString()}
                        </UIText>
                      </div>
                      <Progress
                        value={Math.min(100, totalTokens ? ((totals?.total_cache_read || 0) / totalTokens) * 100 : 0)}
                        indicatorClassName="bg-[#10b981]"
                        className="bg-neutral-200 dark:bg-neutral-800"
                      />
                    </div>
                  )}
                </div>
              </Card>

              {/* Daily Activity Chart */}
              <Card>
                <div className="flex items-center justify-between">
                  <UIText className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Daily Activity</UIText>
                  {selectedDay && (
                    <UIText className="text-xs font-mono text-[#1a73e8] dark:text-[#7aa7ff]">
                      {selectedDay.day}:{' '}
                      {compactNumber((selectedDay.input_tokens || 0) + (selectedDay.output_tokens || 0))} tokens (
                      {selectedDay.sessions || 0} sess)
                    </UIText>
                  )}
                </div>

                {fullDailyEntries.length === 0 ? (
                  <UIText className="mt-4 text-center text-xs text-neutral-400">
                    No activity recorded for this period.
                  </UIText>
                ) : (
                  <ScrollArea horizontal className="mt-4">
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
                  </ScrollArea>
                )}
              </Card>

              {/* Usage by Model */}
              <Card>
                <UIText className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Usage by Model</UIText>
                <div className="mt-3 gap-2.5">
                  {modelEntries.length === 0 ? (
                    <UIText className="text-xs text-neutral-400">No model usage data available.</UIText>
                  ) : (
                    modelEntries.map((m, idx) => {
                      const mTokens = (m?.input_tokens || 0) + (m?.output_tokens || 0);
                      const modelName = String(m?.model ?? `Model ${idx + 1}`);
                      return (
                        <div
                          key={`${modelName}-${idx}`}
                          className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950"
>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <UIText
                                className="text-sm font-semibold text-neutral-950 dark:text-neutral-100"
                                numberOfLines={1}
>
                                {modelName}
                              </UIText>
                              <UIText className="text-[11px] text-neutral-400 mt-0.5">
                                {m?.sessions || 0} sessions · {m?.api_calls || 0} calls
                              </UIText>
                            </div>
                            <div className="items-end">
                              <UIText className="text-sm font-bold font-mono text-neutral-950 dark:text-neutral-100">
                                {compactNumber(mTokens)}
                              </UIText>
                              {Boolean(m.estimated_cost) && (
                                <UIText className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                                  {formatCost(m.estimated_cost)}
                                </UIText>
                              )}
                            </div>
                          </div>

                          <div className="mt-2.5 flex items-center justify-between border-t border-neutral-100 pt-2 dark:border-neutral-900">
                            <UIText className="text-[11px] text-neutral-500">In: {compactNumber(m.input_tokens)}</UIText>
                            <UIText className="text-[11px] text-neutral-500">Out: {compactNumber(m.output_tokens)}</UIText>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </Card>

              {/* Tools & Skills Breakdown */}
              {(toolsList.length> 0 || skillsList.length> 0) && (
                <Card>
                  <UIText className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Tools & Skills</UIText>

                  {/* Tools */}
                  {toolsList.length> 0 && (
                    <div className="mt-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Wrench size={13} color={dark ? '#aaa' : '#666'} />
                        <UIText className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                          Tools Executed
                        </UIText>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {toolsList.map((item) => (
                          <Badge
                            key={item.name}
                            variant="secondary"
                            className="gap-1.5 rounded-lg border-transparent px-2.5 py-1"
>
                            <UIText className="font-mono text-xs text-neutral-800 dark:text-neutral-200">
                              {item.name}
                            </UIText>
                            <UIText className="font-mono text-[11px] font-bold text-[#1a73e8] dark:text-[#7aa7ff]">
                              {item.count}
                            </UIText>
                            {typeof item.percentage === 'number' && (
                              <UIText className="text-[10px] text-neutral-400">{item.percentage}%</UIText>
                            )}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Skills */}
                  {skillsList.length> 0 && (
                    <div className="mt-4">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Cpu size={13} color={dark ? '#aaa' : '#666'} />
                        <UIText className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                          Skills Triggered
                        </UIText>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {skillsList.map((item) => (
                          <Badge
                            key={item.name}
                            variant="secondary"
                            className="gap-1.5 rounded-lg border-transparent px-2.5 py-1"
>
                            <UIText className="text-xs text-neutral-800 dark:text-neutral-200">{item.name}</UIText>
                            <UIText className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                              {item.count}
                            </UIText>
                            {typeof item.percentage === 'number' && (
                              <UIText className="text-[10px] text-neutral-400">{item.percentage}%</UIText>
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
        </ScrollArea>
      </div>
    </div>
  );
}
