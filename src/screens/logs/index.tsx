import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
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
import { useApp } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { HamburgerBtn } from '../../components';

const LOG_FILES = ['agent', 'errors', 'gateway', 'mcp'] as const;
type LogFile = (typeof LOG_FILES)[number];

const LOG_LEVELS = ['ALL', 'INFO', 'WARNING', 'ERROR', 'DEBUG'] as const;
type LogLevelFilter = (typeof LOG_LEVELS)[number];

const LINE_COUNTS = [50, 100, 200, 500] as const;

export type LineSeverity = 'error' | 'warning' | 'info' | 'debug';

const LEVEL_TOKEN_RE =
  /^\d{4}-\d{2}-\d{2}[ T][\d:,.]+\s+(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL|FATAL)\b/;

function classifyLine(line: string): LineSeverity {
  const token = LEVEL_TOKEN_RE.exec(line)?.[1];
  if (token) {
    if (token === 'ERROR' || token === 'CRITICAL' || token === 'FATAL') return 'error';
    if (token === 'WARNING' || token === 'WARN') return 'warning';
    if (token === 'DEBUG') return 'debug';
    return 'info';
  }
  const upper = line.toUpperCase();
  if (/\b(ERROR|CRITICAL|FATAL)\b/.test(upper) || upper.startsWith('TRACEBACK (')) {
    return 'error';
  }
  if (/\b(WARNING|WARN)\b/.test(upper)) return 'warning';
  if (/\bDEBUG\b/.test(upper)) return 'debug';
  return 'info';
}

export function LogsScreen() {
  const { authed, opsGet, theme } = useApp();
  const dark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);

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

  const fetchLogs = useCallback(
    async (isBackground = false) => {
      if (!isBackground) {
        setRefreshing(true);
      }
      setError(null);
      try {
        const params = new URLSearchParams({
          file,
          lines: String(lineCount),
        });
        if (level !== 'ALL') {
          params.set('level', level);
        }
        if (search.trim()) {
          params.set('search', search.trim());
        }

        const res = await opsGet(`/api/logs?${params.toString()}`);
        const rawLines: string[] = Array.isArray(res?.lines) ? res.lines : [];
        setLines(rawLines);
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [file, lineCount, level, search, opsGet],
  );

  // Initial load & when file/level/lines change
  useEffect(() => {
    if (authed) void fetchLogs();
  }, [authed, file, level, lineCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh interval (every 3.5 seconds)
  useEffect(() => {
    if (!autoRefresh || !authed) return;
    const interval = setInterval(() => {
      void fetchLogs(true);
    }, 3500);
    return () => clearInterval(interval);
  }, [autoRefresh, authed, fetchLogs]);

  // Copy to clipboard
  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const scrollToBottom = () => {
    if (lines.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  };

  const scrollToTop = () => {
    if (lines.length > 0) {
      listRef.current?.scrollToIndex({ index: 0, animated: true });
    }
  };

  // Statistics
  const stats = useMemo(() => {
    let errorCount = 0;
    let warnCount = 0;
    for (const l of lines) {
      const sev = classifyLine(l);
      if (sev === 'error') errorCount++;
      else if (sev === 'warning') warnCount++;
    }
    return { errorCount, warnCount, total: lines.length };
  }, [lines]);

  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#000' : '#fff' }}>
    <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['left', 'right', 'bottom']}>
      <StatusBar style="auto" />

      {/* Header */}
      <View
        className="flex-row items-center justify-between border-b border-neutral-200 bg-white px-4 py-4 dark:border-neutral-800 dark:bg-black"
        style={{ paddingTop: insets.top + 10 }}
      >
        <View className="flex-row items-center gap-3">
          <HamburgerBtn />
          <View>
            <Text className="text-xl font-bold text-neutral-950 dark:text-neutral-100">
              Logs
            </Text>
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
                autoRefresh
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-neutral-600 dark:text-neutral-400'
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
            {copied ? (
              <Check size={14} color="#10b981" />
            ) : (
              <Copy size={14} color={dark ? '#9ca3af' : '#6b7280'} />
            )}
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
            <RefreshCw
              size={15}
              color={dark ? '#9ca3af' : '#6b7280'}
              className={refreshing ? 'animate-spin' : ''}
            />
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
            contentContainerStyle={{ gap: 8, paddingRight: 4, alignItems: 'center' }}
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
                  <FileText
                    size={13}
                    color={isSelected ? '#ffffff' : dark ? '#9ca3af' : '#6b7280'}
                  />
                  <Text
                    className={`text-xs font-semibold ${
                      isSelected
                        ? 'text-white'
                        : 'text-neutral-700 dark:text-neutral-300'
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
            <SlidersHorizontal
              size={13}
              color={showFilters ? '#1a73e8' : dark ? '#9ca3af' : '#6b7280'}
            />
            <Text
              className={`text-xs font-medium ${
                showFilters
                  ? 'font-semibold text-[#1a73e8]'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              Filter
            </Text>
          </Pressable>
        </View>

        {showFilters && (
          <View className="mt-3 pt-3 border-t border-neutral-200/70 dark:border-neutral-800/70" style={{ gap: 12 }}>
            {/* Search Input */}
            <View className="flex-row items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950">
              <Search size={15} color={dark ? '#737373' : '#9ca3af'} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Filter logs (substring)..."
                placeholderTextColor={dark ? '#666' : '#999'}
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
                    const levelColors: Record<LogLevelFilter, { activeBg: string; activeText: string; activeBorder: string }> = {
                      ALL: {
                        activeBg: 'bg-neutral-900 dark:bg-neutral-100',
                        activeText: 'text-white dark:text-neutral-950',
                        activeBorder: 'border-neutral-900 dark:border-neutral-100',
                      },
                      INFO: {
                        activeBg: 'bg-blue-600',
                        activeText: 'text-white',
                        activeBorder: 'border-blue-600',
                      },
                      WARNING: {
                        activeBg: 'bg-amber-600',
                        activeText: 'text-white',
                        activeBorder: 'border-amber-600',
                      },
                      ERROR: {
                        activeBg: 'bg-rose-600',
                        activeText: 'text-white',
                        activeBorder: 'border-rose-600',
                      },
                      DEBUG: {
                        activeBg: 'bg-indigo-600',
                        activeText: 'text-white',
                        activeBorder: 'border-indigo-600',
                      },
                    };
                    const color = levelColors[lvl];

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
                            isSelected
                              ? color.activeText
                              : 'text-neutral-600 dark:text-neutral-400'
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
                            isSelected
                              ? 'text-white dark:text-neutral-950'
                              : 'text-neutral-600 dark:text-neutral-400'
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
          <Text className="mt-2.5 text-xs text-neutral-500 dark:text-neutral-400">
            Reading {file}.log…
          </Text>
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
          <FlatList
            ref={listRef}
            data={lines}
            keyExtractor={(_, index) => String(index)}
            contentContainerStyle={{ padding: 10, paddingBottom: insets.bottom + 48 }}
            renderItem={({ item, index }) => {
              const sev = classifyLine(item);
              const isErr = sev === 'error';
              const isWarn = sev === 'warning';
              const isDbg = sev === 'debug';

              return (
                <View
                  className={`flex-row items-start py-0.5 px-1 rounded ${
                    isErr ? 'bg-red-950/30' : isWarn ? 'bg-amber-950/20' : ''
                  }`}
                >
                  <Text className="w-9 select-none font-mono text-[10px] text-neutral-600">
                    {index + 1}
                  </Text>
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
                    {item}
                  </Text>
                </View>
              );
            }}
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
