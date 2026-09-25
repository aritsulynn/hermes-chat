import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Redirect } from 'expo-router';
import {
  Activity,
  Coins,
  Cpu,
  DollarSign,
  Layers,
  MessageSquare,
  RefreshCw,
  TrendingUp,
  Wrench,
  Zap,
} from 'lucide-react-native';
import { useApp } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { HamburgerBtn } from '../../components';
import * as api from '../../services/api';
import { compactNumber, formatCost } from '../../utils/format';
import { DayBar } from './components/DayBar';
import { normalizeToolSkillList } from './helpers';
import type { ToolSkillItem } from './helpers';

const PERIOD_OPTIONS = [
  { label: '7 Days', days: 7 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
] as const;


export function UsageScreen() {
  const { authed, opsGet, theme, getAuthScope } = useApp();
  const dark = theme === 'dark';
  const insets = useSafeAreaInsets();

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

  if (!authed) return <Redirect href="/login" />;

  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#000' : '#fff' }}>
      {/* No 'bottom' edge: ScrollView content pads insets.bottom + 32. */}
      <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['left', 'right']}>
        <StatusBar style="auto" />

        {/* Header */}
        <View
          className="flex-row items-center justify-between border-b border-neutral-200 bg-white px-4 py-4 dark:border-neutral-800 dark:bg-black"
          style={{ paddingTop: insets.top + 10 }}
        >
          <View className="flex-row items-center gap-3">
            <HamburgerBtn />
            <Text className="text-xl font-bold text-neutral-950 dark:text-neutral-100">Usage & Analytics</Text>
          </View>
          <Pressable
            disabled={loading || refreshing}
            onPress={() => void fetchUsage(true)}
            hitSlop={10}
            className="p-2 rounded-lg border border-neutral-300 dark:border-neutral-700"
          >
            <RefreshCw size={15} color={dark ? '#ccc' : '#444'} />
          </Pressable>
        </View>

        {/* Period Selector Bar */}
        <View className="flex-row items-center justify-between border-b border-neutral-200 bg-neutral-50/70 px-4 py-2.5 dark:border-neutral-800 dark:bg-neutral-900/60">
          <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Time Period</Text>
          <View className="flex-row gap-1">
            {PERIOD_OPTIONS.map((opt) => (
              <Pressable
                key={opt.days}
                onPress={() => setDays(opt.days)}
                className={`rounded-lg px-3 py-1.5 border ${
                  days === opt.days
                    ? 'border-[#1a73e8] bg-[#1a73e8]'
                    : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950'
                }`}
              >
                <Text
                  className={`text-xs font-semibold ${
                    days === opt.days ? 'text-white' : 'text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {error && (
          <View className="m-4 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/40">
            <Text className="text-xs font-medium text-red-700 dark:text-red-300">{error}</Text>
            <Pressable onPress={() => void fetchUsage(true)} className="mt-2 self-start rounded bg-red-600 px-2.5 py-1">
              <Text className="text-xs font-medium text-white">Retry</Text>
            </Pressable>
          </View>
        )}

        <ScrollView
          contentContainerStyle={{
            padding: 14,
            paddingBottom: insets.bottom + 32,
            gap: 16,
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void fetchUsage(true)} />}
        >
          {loading && !refreshing ? (
            <View className="items-center justify-center py-20">
              <ActivityIndicator size="large" color="#1a73e8" />
              <Text className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Loading usage analytics…</Text>
            </View>
          ) : (
            <>
              {/* KPI Cards Grid */}
              <View className="flex-row flex-wrap gap-2.5">
                {/* Total Tokens */}
                <View className="flex-1 min-w-[140px] rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3.5 dark:border-neutral-800 dark:bg-neutral-900/60">
                  <View className="flex-row items-center gap-1.5">
                    <TrendingUp size={16} color="#1a73e8" />
                    <Text className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Total Tokens</Text>
                  </View>
                  <Text className="mt-1.5 text-2xl font-black text-neutral-950 dark:text-neutral-100">
                    {compactNumber(totalTokens)}
                  </Text>
                  <Text className="mt-0.5 text-[11px] text-neutral-400">in {days} days</Text>
                </View>

                {/* Estimated Cost */}
                <View className="flex-1 min-w-[140px] rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3.5 dark:border-neutral-800 dark:bg-neutral-900/60">
                  <View className="flex-row items-center gap-1.5">
                    <DollarSign size={16} color="#16a34a" />
                    <Text className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Est. Cost</Text>
                  </View>
                  <Text className="mt-1.5 text-2xl font-black text-neutral-950 dark:text-neutral-100">
                    {formatCost(totals?.total_estimated_cost)}
                  </Text>
                  <Text className="mt-0.5 text-[11px] text-neutral-400">
                    Actual: {formatCost(totals?.total_actual_cost)}
                  </Text>
                </View>

                {/* Sessions */}
                <View className="flex-1 min-w-[140px] rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3.5 dark:border-neutral-800 dark:bg-neutral-900/60">
                  <View className="flex-row items-center gap-1.5">
                    <MessageSquare size={16} color="#8b5cf6" />
                    <Text className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Sessions</Text>
                  </View>
                  <Text className="mt-1.5 text-2xl font-black text-neutral-950 dark:text-neutral-100">
                    {totals?.total_sessions?.toLocaleString() || '0'}
                  </Text>
                  <Text className="mt-0.5 text-[11px] text-neutral-400">conversations</Text>
                </View>

                {/* API Calls */}
                <View className="flex-1 min-w-[140px] rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3.5 dark:border-neutral-800 dark:bg-neutral-900/60">
                  <View className="flex-row items-center gap-1.5">
                    <Zap size={16} color="#f59e0b" />
                    <Text className="text-xs font-medium text-neutral-500 dark:text-neutral-400">API Calls</Text>
                  </View>
                  <Text className="mt-1.5 text-2xl font-black text-neutral-950 dark:text-neutral-100">
                    {totals?.total_api_calls?.toLocaleString() || '0'}
                  </Text>
                  <Text className="mt-0.5 text-[11px] text-neutral-400">requests</Text>
                </View>
              </View>

              {/* Token Breakdown Card */}
              <View className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
                <Text className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Token Breakdown</Text>
                <View className="mt-3 gap-2.5">
                  {/* Input Tokens */}
                  <View>
                    <View className="flex-row justify-between text-xs mb-1">
                      <Text className="text-xs text-neutral-600 dark:text-neutral-300">Input Tokens</Text>
                      <Text className="text-xs font-semibold text-neutral-950 dark:text-neutral-100 font-mono">
                        {(totals?.total_input || 0).toLocaleString()}
                      </Text>
                    </View>
                    <View className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                      <View
                        className="h-full bg-[#1a73e8] rounded-full"
                        style={{
                          width: `${Math.min(100, totalTokens ? ((totals?.total_input || 0) / totalTokens) * 100 : 0)}%`,
                        }}
                      />
                    </View>
                  </View>

                  {/* Output Tokens */}
                  <View>
                    <View className="flex-row justify-between text-xs mb-1">
                      <Text className="text-xs text-neutral-600 dark:text-neutral-300">Output Tokens</Text>
                      <Text className="text-xs font-semibold text-neutral-950 dark:text-neutral-100 font-mono">
                        {(totals?.total_output || 0).toLocaleString()}
                      </Text>
                    </View>
                    <View className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                      <View
                        className="h-full bg-[#8b5cf6] rounded-full"
                        style={{
                          width: `${Math.min(100, totalTokens ? ((totals?.total_output || 0) / totalTokens) * 100 : 0)}%`,
                        }}
                      />
                    </View>
                  </View>

                  {/* Reasoning Tokens */}
                  {(totals?.total_reasoning || 0) > 0 && (
                    <View>
                      <View className="flex-row justify-between text-xs mb-1">
                        <Text className="text-xs text-neutral-600 dark:text-neutral-300">Reasoning / Thinking</Text>
                        <Text className="text-xs font-semibold text-neutral-950 dark:text-neutral-100 font-mono">
                          {(totals?.total_reasoning || 0).toLocaleString()}
                        </Text>
                      </View>
                      <View className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                        <View
                          className="h-full bg-[#f59e0b] rounded-full"
                          style={{
                            width: `${Math.min(100, totalTokens ? ((totals?.total_reasoning || 0) / totalTokens) * 100 : 0)}%`,
                          }}
                        />
                      </View>
                    </View>
                  )}

                  {/* Cache Read Tokens */}
                  {(totals?.total_cache_read || 0) > 0 && (
                    <View>
                      <View className="flex-row justify-between text-xs mb-1">
                        <Text className="text-xs text-neutral-600 dark:text-neutral-300">Cache Read Tokens</Text>
                        <Text className="text-xs font-semibold text-neutral-950 dark:text-neutral-100 font-mono">
                          {(totals?.total_cache_read || 0).toLocaleString()}
                        </Text>
                      </View>
                      <View className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                        <View
                          className="h-full bg-[#10b981] rounded-full"
                          style={{
                            width: `${Math.min(100, totalTokens ? ((totals?.total_cache_read || 0) / totalTokens) * 100 : 0)}%`,
                          }}
                        />
                      </View>
                    </View>
                  )}
                </View>
              </View>

              {/* Daily Activity Chart */}
              <View className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Daily Activity</Text>
                  {selectedDay && (
                    <Text className="text-xs font-mono text-[#1a73e8] dark:text-[#7aa7ff]">
                      {selectedDay.day}:{' '}
                      {compactNumber((selectedDay.input_tokens || 0) + (selectedDay.output_tokens || 0))} tokens (
                      {selectedDay.sessions || 0} sess)
                    </Text>
                  )}
                </View>

                {fullDailyEntries.length === 0 ? (
                  <Text className="mt-4 text-center text-xs text-neutral-400">
                    No activity recorded for this period.
                  </Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-4">
                    <View className="flex-row items-end gap-2 h-36 pt-4 pb-2 px-1">
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
                    </View>
                  </ScrollView>
                )}
              </View>

              {/* Usage by Model */}
              <View className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
                <Text className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Usage by Model</Text>
                <View className="mt-3 gap-2.5">
                  {modelEntries.length === 0 ? (
                    <Text className="text-xs text-neutral-400">No model usage data available.</Text>
                  ) : (
                    modelEntries.map((m, idx) => {
                      const mTokens = (m?.input_tokens || 0) + (m?.output_tokens || 0);
                      const modelName = String(m?.model ?? `Model ${idx + 1}`);
                      return (
                        <View
                          key={`${modelName}-${idx}`}
                          className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950"
                        >
                          <View className="flex-row items-start justify-between gap-2">
                            <View className="flex-1">
                              <Text
                                className="text-sm font-semibold text-neutral-950 dark:text-neutral-100"
                                numberOfLines={1}
                              >
                                {modelName}
                              </Text>
                              <Text className="text-[11px] text-neutral-400 mt-0.5">
                                {m?.sessions || 0} sessions · {m?.api_calls || 0} calls
                              </Text>
                            </View>
                            <View className="items-end">
                              <Text className="text-sm font-bold font-mono text-neutral-950 dark:text-neutral-100">
                                {compactNumber(mTokens)}
                              </Text>
                              {Boolean(m.estimated_cost) && (
                                <Text className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                                  {formatCost(m.estimated_cost)}
                                </Text>
                              )}
                            </View>
                          </View>

                          <View className="mt-2.5 flex-row items-center justify-between border-t border-neutral-100 pt-2 dark:border-neutral-900">
                            <Text className="text-[11px] text-neutral-500">In: {compactNumber(m.input_tokens)}</Text>
                            <Text className="text-[11px] text-neutral-500">Out: {compactNumber(m.output_tokens)}</Text>
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              </View>

              {/* Tools & Skills Breakdown */}
              {(toolsList.length > 0 || skillsList.length > 0) && (
                <View className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
                  <Text className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Tools & Skills</Text>

                  {/* Tools */}
                  {toolsList.length > 0 && (
                    <View className="mt-3">
                      <View className="flex-row items-center gap-1.5 mb-2">
                        <Wrench size={13} color={dark ? '#aaa' : '#666'} />
                        <Text className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                          Tools Executed
                        </Text>
                      </View>
                      <View className="flex-row flex-wrap gap-1.5">
                        {toolsList.map((item) => (
                          <View
                            key={item.name}
                            className="flex-row items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 dark:border-neutral-800 dark:bg-neutral-950"
                          >
                            <Text className="font-mono text-xs text-neutral-800 dark:text-neutral-200">
                              {item.name}
                            </Text>
                            <Text className="font-mono text-[11px] font-bold text-[#1a73e8] dark:text-[#7aa7ff]">
                              {item.count}
                            </Text>
                            {typeof item.percentage === 'number' && (
                              <Text className="text-[10px] text-neutral-400">{item.percentage}%</Text>
                            )}
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Skills */}
                  {skillsList.length > 0 && (
                    <View className="mt-4">
                      <View className="flex-row items-center gap-1.5 mb-2">
                        <Cpu size={13} color={dark ? '#aaa' : '#666'} />
                        <Text className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                          Skills Triggered
                        </Text>
                      </View>
                      <View className="flex-row flex-wrap gap-1.5">
                        {skillsList.map((item) => (
                          <View
                            key={item.name}
                            className="flex-row items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 dark:border-neutral-800 dark:bg-neutral-950"
                          >
                            <Text className="text-xs text-neutral-800 dark:text-neutral-200">{item.name}</Text>
                            <Text className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                              {item.count}
                            </Text>
                            {typeof item.percentage === 'number' && (
                              <Text className="text-[10px] text-neutral-400">{item.percentage}%</Text>
                            )}
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
