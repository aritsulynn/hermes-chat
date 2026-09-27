import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import type { FlashListRef } from '@shopify/flash-list';
import { Input } from '../../components/ui/input';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Redirect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FileText,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Terminal,
  X,
} from 'lucide-react-native';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { asRecord } from '../../utils/ops';
import { placeholderColor, screenStyle } from '../../theme';
import { HamburgerBtn } from '../../components/ui/bits';
import * as api from '../../services/api';
import { LEVEL_COLORS, LINE_COUNTS, LOG_FILES, LOG_LEVELS, classifyLine } from './helpers';
import type { LineSeverity, LogFile, LogLevelFilter } from './helpers';

type LogRow = { line: string; sev: LineSeverity };

export function LogsScreen() {
  const { authed, opsGet, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const insets = useSafeAreaInsets();
  // Resolved once per scheme: auto-refresh re-renders this screen every 3.5s
  // and each value feeds the header/filter chrome plus the list surface.
  const screen = useMemo(() => screenStyle(dark), [dark]);
  const placeholder = useMemo(() => placeholderColor(dark, 'log'), [dark]);
  const listRef = useRef<FlashListRef<LogRow>>(null);

  const [file, setFile] = useState<LogFile>('agent');
  const [level, setLevel] = useState<LogLevelFilter>('ALL');
  const [lineCount, setLineCount] = useState<number>(100);
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showFilters, setShowFilters] = useState(true);

  useEffect(() => {
    if (authed) return;
    setLines([]);
    setError(null);
    setLoading(true);
  }, [authed]);

  // `search` is submit-driven (not live): read it through a ref so typing in
  // the box doesn't recreate `fetchLogs` and refetch on every keystroke.
  const searchRef = useRef(search);
  searchRef.current = search;

  const fetchLogs = useCallback(
    async (isBackground = false) => {
      const scope = getAuthScope();
      if (!isBackground) {
        setRefreshing(true);
      }
      setError(null);
      try {
        const res = await opsGet(
          api.logs({
            file,
            lines: lineCount,
            level: level !== 'ALL' ? level : undefined,
            search: searchRef.current.trim() || undefined,
          }),
        );
        if (getAuthScope() !== scope) return;
        const raw = asRecord(res).lines;
        const rawLines: string[] = Array.isArray(raw)
          ? raw.filter((l): l is string => typeof l === 'string')
          : [];
        setLines(rawLines);
      } catch (e) {
        if (getAuthScope() === scope) setError(errMsg(e));
      } finally {
        if (getAuthScope() === scope) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [file, getAuthScope, lineCount, level, opsGet],
  );

  // Initial load & when file/level/lines change
  useEffect(() => {
    if (authed) void fetchLogs();
  }, [authed, fetchLogs]);

  // Auto-refresh interval (every 3.5 seconds) — skips when backgrounded
  // so the Drawer keeping this screen mounted doesn't poll forever.
  useEffect(() => {
    if (!autoRefresh || !authed) return;
    let appActive = true;
    const sub = AppState.addEventListener('change', (s) => {
      appActive = s === 'active';
    });
    const interval = setInterval(() => {
      if (!appActive) return;
      void fetchLogs(true);
    }, 3500);
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [autoRefresh, authed, fetchLogs]);

  // Copy to clipboard
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(lines.join('\n'));
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('[logs] copy failed', e);
    }
  };

  // Statistics + per-row severity in one pass — old code ran classifyLine
  // per row in renderItem AND again in stats (2x O(n)).
  const rows = useMemo(() => lines.map((line) => ({ line, sev: classifyLine(line) })), [lines]);
  const stats = useMemo(() => {
    let errorCount = 0;
    let warnCount = 0;
    for (const r of rows) {
      if (r.sev === 'error') errorCount++;
      else if (r.sev === 'warning') warnCount++;
    }
    return { errorCount, warnCount, total: rows.length };
  }, [rows]);

  const scrollToBottom = useCallback(() => {
    if (rows.length > 0) {
      try {
        listRef.current?.scrollToEnd({ animated: true });
      } catch (e) {
        console.warn('[logs] scrollToEnd failed', e);
      }
    }
  }, [rows.length]);

  const scrollToTop = useCallback(() => {
    if (rows.length > 0) {
      try {
        void listRef.current?.scrollToIndex({ index: 0, animated: true });
      } catch (e) {
        console.warn('[logs] scrollToIndex failed', e);
      }
    }
  }, [rows.length]);
  // Index prefix keeps keys unique across refreshes; length suffix disambiguates
  // same-index edits without slicing the line (avoids a per-cell string alloc).
  const logKeyExtractor = useCallback((item: { line: string }, index: number) => `${index}-${item.line.length}`, []);
  const renderLogRow = useCallback(({ item, index }: { item: LogRow; index: number }) => {
    const isErr = item.sev === 'error';
    const isWarn = item.sev === 'warning';
    const isDbg = item.sev === 'debug';
    return (
      <View
        className={`flex-row items-start py-0.5 px-1 rounded ${
          isErr ? 'bg-red-950/30' : isWarn ? 'bg-amber-950/20' : ''
        }`}
      >
        <Text className="w-9 select-none font-mono text-[10px] text-neutral-600">{index + 1}</Text>
        <Text
          selectable
          className={`flex-1 font-mono text-[11px] leading-4 ${
            isErr
              ? 'text-red-400 font-medium'
              : isWarn
                ? 'text-amber-300'
                : isDbg
                  ? 'text-neutral-500'
                  : 'text-neutral-200'
          }`}
        >
          {item.line}
        </Text>
      </View>
    );
  }, []);

  // Stable content style — FlashList re-measures on contentContainerStyle
  // identity change, so keep the ref stable across renders.
  const logListContentStyle = useMemo(
    () => ({
      padding: 10,
      paddingBottom: insets.bottom + 48,
    }),
    [insets.bottom],
  );

  if (!authed) return <Redirect href="/login" />;

  return (
    <View style={screen}>
      {/* No 'bottom' edge: the list content already pads insets.bottom + 48. */}
      <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['left', 'right']}>
        <StatusBar style="auto" />

        {/* Header */}
        <View
          className="flex-row items-center justify-between border-b border-neutral-200 bg-white px-4 py-4 dark:border-neutral-800 dark:bg-black"
          style={{ paddingTop: insets.top + 10 }}
        >
          <View className="flex-row items-center gap-3">
            <HamburgerBtn />
            <View>
              <Text className="text-xl font-bold text-neutral-950 dark:text-neutral-100">Logs</Text>
              <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                {file}.log · {stats.total} lines
              </Text>
            </View>
          </View>

          {/* Header Action Buttons with generous spacing and touch targets */}
          <View className="flex-row items-center" style={{ gap: 8 }}>
            {/* Live / Auto refresh toggle button */}
            <Pressable
              onPress={() => setAutoRefresh((prev) => !prev)}
              hitSlop={6}
              className={`h-9 flex-row items-center gap-1.5 rounded-xl px-3 border ${
                autoRefresh
                  ? 'border-emerald-500/40 bg-emerald-500/10 active:bg-emerald-500/20'
                  : 'border-neutral-200 bg-neutral-100/70 active:bg-neutral-200/70 dark:border-neutral-800 dark:bg-neutral-900 dark:active:bg-neutral-800'
              }`}
            >
              <View
                className={`h-2 w-2 rounded-full ${
                  autoRefresh ? 'bg-emerald-500' : 'bg-neutral-400 dark:bg-neutral-500'
                }`}
              />
              <Text
                className={`text-xs font-semibold ${
                  autoRefresh ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-600 dark:text-neutral-400'
                }`}
              >
                {autoRefresh ? 'Live' : 'Paused'}
              </Text>
            </Pressable>

            {/* Copy button */}
            <Pressable
              onPress={handleCopy}
              hitSlop={6}
              className={`h-9 flex-row items-center gap-1.5 rounded-xl border px-3 ${
                copied
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : 'border-neutral-200 bg-white active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:active:bg-neutral-800'
              }`}
            >
              {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} color={dark ? '#9ca3af' : '#6b7280'} />}
              <Text
                className={`text-xs font-medium ${
                  copied
                    ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                    : 'text-neutral-700 dark:text-neutral-300'
                }`}
              >
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>

            {/* Manual refresh button */}
            <Pressable
              disabled={loading || refreshing}
              onPress={() => void fetchLogs()}
              hitSlop={6}
              className="h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:active:bg-neutral-800"
            >
              <RefreshCw size={15} color={dark ? '#9ca3af' : '#6b7280'} className={refreshing ? 'animate-spin' : ''} />
            </Pressable>
          </View>
        </View>

        {/* Filter Toolbar Card */}
        <View className="border-b border-neutral-200 bg-neutral-50/80 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/60">
          {/* Top line: Log File Tabs & Filter Toggle */}
          <View className="flex-row items-center justify-between" style={{ gap: 10 }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                gap: 8,
                paddingRight: 4,
                alignItems: 'center',
              }}
              className="flex-1"
            >
              {LOG_FILES.map((f) => {
                const isSelected = file === f;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFile(f)}
                    className={`flex-row items-center gap-1.5 rounded-xl px-3.5 py-2 border shadow-xs ${
                      isSelected
                        ? 'border-[#1a73e8] bg-[#1a73e8]'
                        : 'border-neutral-200 bg-white active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 dark:active:bg-neutral-900'
                    }`}
                  >
                    <FileText size={13} color={isSelected ? '#ffffff' : dark ? '#9ca3af' : '#6b7280'} />
                    <Text
                      className={`text-xs font-semibold ${
                        isSelected ? 'text-white' : 'text-neutral-700 dark:text-neutral-300'
                      }`}
                    >
                      {f}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              onPress={() => setShowFilters((v) => !v)}
              hitSlop={6}
              className={`h-9 flex-row items-center gap-1.5 rounded-xl border px-3 ${
                showFilters
                  ? 'border-[#1a73e8]/40 bg-[#1a73e8]/10'
                  : 'border-neutral-200 bg-white active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 dark:active:bg-neutral-900'
              }`}
            >
              <SlidersHorizontal size={13} color={showFilters ? '#1a73e8' : dark ? '#9ca3af' : '#6b7280'} />
              <Text
                className={`text-xs font-medium ${
                  showFilters ? 'font-semibold text-[#1a73e8]' : 'text-neutral-600 dark:text-neutral-400'
                }`}
              >
                Filter
              </Text>
            </Pressable>
          </View>

          {showFilters && (
            <View className="mt-3 pt-3 border-t border-neutral-200/70 dark:border-neutral-800/70" style={{ gap: 12 }}>
              {/* Search Input — border lives on the Input itself */}
              <View className="flex-row items-center gap-2">
                <Search size={15} color={dark ? '#737373' : '#9ca3af'} />
                <Input
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Filter logs (substring)..."
                  placeholderTextColor={placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="flex-1 text-xs text-neutral-950 dark:text-neutral-100 py-0.5"
                  onSubmitEditing={() => void fetchLogs()}
                />
                {Boolean(search) && (
                  <Pressable
                    onPress={() => {
                      setSearch('');
                    }}
                    hitSlop={8}
                  >
                    <X size={15} color={dark ? '#888' : '#999'} />
                  </Pressable>
                )}
              </View>

              {/* Level selector & Line count in dedicated rows for breathing space */}
              <View style={{ gap: 10 }}>
                {/* Severity Level Chips */}
                <View>
                  <Text className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-1.5">
                    Severity Level
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8, paddingRight: 4 }}
                  >
                    {LOG_LEVELS.map((lvl) => {
                      const isSelected = level === lvl;
                      const color = LEVEL_COLORS[lvl];

                      return (
                        <Pressable
                          key={lvl}
                          onPress={() => setLevel(lvl)}
                          className={`rounded-lg border px-3 py-1.5 shadow-xs ${
                            isSelected
                              ? `${color.activeBg} ${color.activeBorder}`
                              : 'border-neutral-200 bg-white active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 dark:active:bg-neutral-900'
                          }`}
                        >
                          <Text
                            className={`text-xs font-semibold ${
                              isSelected ? color.activeText : 'text-neutral-600 dark:text-neutral-400'
                            }`}
                          >
                            {lvl}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {/* Line Count Chips */}
                <View>
                  <Text className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-1.5">
                    Line Count
                  </Text>
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    {LINE_COUNTS.map((cnt) => {
                      const isSelected = lineCount === cnt;
                      return (
                        <Pressable
                          key={cnt}
                          onPress={() => setLineCount(cnt)}
                          className={`flex-1 items-center justify-center rounded-lg border py-1.5 shadow-xs ${
                            isSelected
                              ? 'border-neutral-900 bg-neutral-900 dark:border-neutral-100 dark:bg-neutral-100'
                              : 'border-neutral-200 bg-white active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 dark:active:bg-neutral-900'
                          }`}
                        >
                          <Text
                            className={`text-xs font-semibold ${
                              isSelected ? 'text-white dark:text-neutral-950' : 'text-neutral-600 dark:text-neutral-400'
                            }`}
                          >
                            {cnt}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* Status Bar info & quick severity toggles */}
          <View className="mt-3 flex-row items-center justify-between">
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">
              Showing <Text className="font-semibold text-neutral-700 dark:text-neutral-200">{stats.total}</Text> lines
            </Text>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              {stats.errorCount > 0 && (
                <Pressable
                  onPress={() => setLevel((prev) => (prev === 'ERROR' ? 'ALL' : 'ERROR'))}
                  className={`flex-row items-center gap-1.5 rounded-lg border px-2.5 py-1 ${
                    level === 'ERROR'
                      ? 'border-rose-500 bg-rose-500/20'
                      : 'border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/40'
                  }`}
                >
                  <AlertTriangle size={12} color="#e11d48" />
                  <Text className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                    {stats.errorCount} Error{stats.errorCount > 1 ? 's' : ''}
                  </Text>
                </Pressable>
              )}
              {stats.warnCount > 0 && (
                <Pressable
                  onPress={() => setLevel((prev) => (prev === 'WARNING' ? 'ALL' : 'WARNING'))}
                  className={`flex-row items-center gap-1.5 rounded-lg border px-2.5 py-1 ${
                    level === 'WARNING'
                      ? 'border-amber-500 bg-amber-500/20'
                      : 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/40'
                  }`}
                >
                  <Text className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {stats.warnCount} Warn{stats.warnCount > 1 ? 's' : ''}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {/* Error message banner */}
        {error && (
          <View className="m-3 rounded-xl border border-red-200 bg-red-50 p-2.5 dark:border-red-900/50 dark:bg-red-950/40">
            <Text className="text-xs text-red-700 dark:text-red-300">{error}</Text>
          </View>
        )}

        {/* Log Output Area */}
        {loading && lines.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#1a73e8" />
            <Text className="mt-2.5 text-xs text-neutral-500 dark:text-neutral-400">Reading {file}.log…</Text>
          </View>
        ) : lines.length === 0 ? (
          <View className="flex-1 items-center justify-center p-6">
            <Terminal size={36} color={dark ? '#555' : '#aaa'} />
            <Text className="mt-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              No log entries found
            </Text>
            <Text className="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
              {search ? 'Try clearing the search query or changing log level.' : `${file}.log is empty.`}
            </Text>
          </View>
        ) : (
          <View className="flex-1 bg-[#101014]">
            {/* FlashList v2 sizes rows itself; drawDistance replaces the old
                windowSize/maxToRenderPerBatch overscan tuning. */}
            <FlashList
              ref={listRef}
              data={rows}
              keyExtractor={logKeyExtractor}
              contentContainerStyle={logListContentStyle}
              renderItem={renderLogRow}
              drawDistance={800}
            />

            {/* Quick Jump Buttons (Floating) */}
            <View className="absolute bottom-6 right-5 flex-col" style={{ gap: 12 }}>
              <Pressable
                onPress={scrollToTop}
                className="h-11 w-11 items-center justify-center rounded-full bg-neutral-900/90 shadow-xl active:bg-neutral-800 border border-neutral-700/80"
                style={{ elevation: 4 }}
              >
                <ArrowUp size={18} color="#fff" />
              </Pressable>
              <Pressable
                onPress={scrollToBottom}
                className="h-11 w-11 items-center justify-center rounded-full bg-[#1a73e8] shadow-xl active:bg-blue-600 border border-blue-400/30"
                style={{ elevation: 4 }}
              >
                <ArrowDown size={18} color="#fff" />
              </Pressable>
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}
