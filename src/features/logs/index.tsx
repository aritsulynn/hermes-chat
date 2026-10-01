import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/bits';
import { Alert as UIAlert, AlertDescription } from '../../components/ui/alert';
import { Navigate as Redirect } from 'react-router-dom';
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
} from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { asRecord } from '../../utils/ops';
import { placeholderColor, screenStyle } from '../../theme';
import { ScreenHeader } from '../../components/ui/bits';
import * as api from '../../services/api';
import { LEVEL_COLORS, LINE_COUNTS, LOG_FILES, LOG_LEVELS, classifyLine } from './helpers';
import type { LogFile, LogLevelFilter } from './helpers';
import { writeClipboard } from '../../services/clipboard';

export function LogsScreen() {
  const { authed, opsGet, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  // Resolved once per scheme: auto-refresh re-renders this screen every 3.5s
  // and each value feeds the header/filter chrome plus the list surface.
  const screen = useMemo(() => screenStyle(dark), [dark]);
  const placeholder = useMemo(() => placeholderColor(dark, 'log'), [dark]);
  const listRef = useRef<HTMLDivElement>(null);

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
    const onVisibility = () => {
      appActive = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibility);
    const interval = setInterval(() => {
      if (!appActive) return;
      void fetchLogs(true);
    }, 3500);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
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
      await writeClipboard(lines.join('\n'));
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
    if (rows.length> 0) {
      try {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
      } catch (e) {
        console.warn('[logs] scrollToEnd failed', e);
      }
    }
  }, [rows.length]);

  const scrollToTop = useCallback(() => {
    if (rows.length> 0) {
      try {
        listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) {
        console.warn('[logs] scrollToIndex failed', e);
      }
    }
  }, [rows.length]);
  // Padding only; the scroller below supplies the flex column.
  const logListContentClass =
    'p-2.5 pb-[calc(env(safe-area-inset-bottom,0px)+48px)]';

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screen}>
      {/* No 'bottom' edge: the list content already pads insets.bottom + 48. */}
      <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-black">
        

        {/* Header */}
        <ScreenHeader
          title="Logs"

          subtitle={`${file}.log · ${stats.total} lines`}
          actions={
            <div className="flex items-center" style={{ gap: 8 }}>
              {/* Live / Auto refresh toggle button */}
              <Button
                onClick={() => setAutoRefresh((prev) => !prev)}

                aria-checked={autoRefresh}
                aria-label="Live refresh"
                className={`h-9 rounded-xl border px-3 ${
                  autoRefresh
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-neutral-200 bg-neutral-100/70 dark:border-neutral-800 dark:bg-neutral-900'
                }`}
>
                <div
                  className={`h-2 w-2 rounded-full ${
                    autoRefresh ? 'bg-emerald-500' : 'bg-neutral-400 dark:bg-neutral-500'
                  }`}
                />
                <span
                  className={`text-xs font-semibold ${
                    autoRefresh ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-600 dark:text-neutral-400'
                  }`}
>
                  {autoRefresh ? 'Live' : 'Paused'}
                </span>
              </Button>

              {/* Copy button */}
              <Button
                onClick={handleCopy}
                aria-label="Copy log"
                className={`h-9 rounded-xl border px-3 ${
                  copied
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
                }`}
>
                {copied ? (
                  <Check size={14} color="#10b981" />
                ) : (
                  <Copy size={14} color={dark ? '#9ca3af' : '#6b7280'} />
                )}
                <span
                  className={`text-xs font-medium ${
                    copied
                      ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                      : 'text-neutral-700 dark:text-neutral-300'
                  }`}
>
                  {copied ? 'Copied' : 'Copy'}
                </span>
              </Button>

              {/* Manual refresh button */}
              <Button
                variant="outline"
                size="icon"
                disabled={loading || refreshing}
                onClick={() => void fetchLogs()}
                aria-label="Refresh logs"
                className="h-9 w-9 rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
>
                <RefreshCw
                  size={15}
                  color={dark ? '#9ca3af' : '#6b7280'}
                  className={refreshing ? 'animate-spin' : ''}
                />
              </Button>
            </div>
          }
        />

        {/* Filter Toolbar Card */}
        <div className="border-b border-neutral-200 bg-neutral-50/80 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900/60">
          {/* Top line: Log File Tabs & Filter Toggle */}
          <div className="flex items-center justify-between" style={{ gap: 10 }}>
            <div className="overflow-x-auto flex-1"><div className="gap-2 pr-1 items-center">
              {LOG_FILES.map((f) => {
                const isSelected = file === f;
                return (
                  <Button
                    key={f}
                    variant="ghost"

                    aria-pressed={isSelected}
                    aria-label={`${f} log`}
                    onClick={() => setFile(f)}
                    className={`h-auto sm:h-auto rounded-xl border px-3.5 py-2 ${
                      isSelected
                        ? 'border-[#1a73e8] bg-[#1a73e8]'
                        : 'border-neutral-200 bg-white active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 dark:active:bg-neutral-900'
                    }`}
>
                    <FileText size={13} color={isSelected ? '#ffffff' : dark ? '#9ca3af' : '#6b7280'} />
                    <span
                      className={`text-xs font-semibold ${
                        isSelected ? 'text-white' : 'text-neutral-700 dark:text-neutral-300'
                      }`}
>
                      {f}
                    </span>
                  </Button>
                );
              })}
            </div></div>

            <Button
              variant="ghost"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              aria-label="Toggle filters"
              className={`h-9 rounded-xl border px-3 ${
                showFilters
                  ? 'border-[#1a73e8]/40 bg-[#1a73e8]/10'
                  : 'border-neutral-200 bg-white active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 dark:active:bg-neutral-900'
              }`}
>
              <SlidersHorizontal size={13} color={showFilters ? '#1a73e8' : dark ? '#9ca3af' : '#6b7280'} />
              <span
                className={`text-xs font-medium ${
                  showFilters ? 'font-semibold text-[#1a73e8]' : 'text-neutral-600 dark:text-neutral-400'
                }`}
>
                Filter
              </span>
            </Button>
          </div>

          {showFilters && (
            <div className="mt-3 pt-3 border-t border-neutral-200/70 dark:border-neutral-800/70" style={{ gap: 12 }}>
              {/* Search Input — border lives on the Input itself */}
              <div className="flex items-center gap-2">
                <Search size={15} color={dark ? '#737373' : '#9ca3af'} />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter logs (substring)..."
                  autoCapitalize="none"
                  className="flex-1 text-xs text-neutral-950 dark:text-neutral-100 py-0.5"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void fetchLogs() } }}
                />
                {Boolean(search) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setSearch('');
                    }}
                    aria-label="Clear filter"
                    className="h-6 w-6 rounded-md"
>
                    <X size={15} color={dark ? '#888' : '#999'} />
                  </Button>
                )}
              </div>

              {/* Level selector & Line count in dedicated rows for breathing space */}
              <div style={{ gap: 10 }}>
                {/* Severity Level Chips */}
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-1.5">
                    Severity Level
                  </div>
                  <div className="overflow-x-auto"><div className="gap-2 pr-1">
                    {LOG_LEVELS.map((lvl) => {
                      const isSelected = level === lvl;
                      const color = LEVEL_COLORS[lvl];

                      return (
                        <Button
                          key={lvl}
                          variant="ghost"

                          aria-pressed={isSelected}
                          aria-label={`${lvl} level`}
                          onClick={() => setLevel(lvl)}
                          className={`h-auto sm:h-auto rounded-lg border px-3 py-1.5 ${
                            isSelected
                              ? `${color.activeBg} ${color.activeBorder}`
                              : 'border-neutral-200 bg-white active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 dark:active:bg-neutral-900'
                          }`}
>
                          <span
                            className={`text-xs font-semibold ${
                              isSelected ? color.activeText : 'text-neutral-600 dark:text-neutral-400'
                            }`}
>
                            {lvl}
                          </span>
                        </Button>
                      );
                    })}
                  </div></div>
                </div>

                {/* Line Count Chips */}
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-1.5">
                    Line Count
                  </div>
                  <div className="flex items-center" style={{ gap: 8 }}>
                    {LINE_COUNTS.map((cnt) => {
                      const isSelected = lineCount === cnt;
                      return (
                        <Button
                          key={cnt}
                          variant="ghost"

                          aria-pressed={isSelected}
                          aria-label={`${cnt} lines`}
                          onClick={() => setLineCount(cnt)}
                          className={`h-auto sm:h-auto flex-1 rounded-lg border py-1.5 ${
                            isSelected
                              ? 'border-neutral-900 bg-neutral-900 dark:border-neutral-100 dark:bg-neutral-100'
                              : 'border-neutral-200 bg-white active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 dark:active:bg-neutral-900'
                          }`}
>
                          <span
                            className={`text-xs font-semibold ${
                              isSelected ? 'text-white dark:text-neutral-950' : 'text-neutral-600 dark:text-neutral-400'
                            }`}
>
                            {cnt}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Status Bar info & quick severity toggles */}
          <div className="mt-3 flex items-center justify-between">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {/* A <span> so the sentence stays inline. */}
              Showing <span className="font-semibold text-neutral-700 dark:text-neutral-200">{stats.total}</span> lines
            </div>
            <div className="flex items-center" style={{ gap: 8 }}>
              {stats.errorCount> 0 && (
                <Button
                  variant="ghost"
                  onClick={() => setLevel((prev) => (prev === 'ERROR' ? 'ALL' : 'ERROR'))}

                  aria-checked={level === 'ERROR'}
                  aria-label={`Show only errors, ${stats.errorCount} found`}
                  className={`h-auto sm:h-auto rounded-lg border px-2.5 py-1 ${
                    level === 'ERROR'
                      ? 'border-rose-500 bg-rose-500/20'
                      : 'border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/40'
                  }`}
>
                  <AlertTriangle size={12} color="#e11d48" />
                  <span className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                    {stats.errorCount} Error{stats.errorCount> 1 ? 's' : ''}
                  </span>
                </Button>
              )}
              {stats.warnCount> 0 && (
                <Button
                  variant="ghost"
                  onClick={() => setLevel((prev) => (prev === 'WARNING' ? 'ALL' : 'WARNING'))}

                  aria-checked={level === 'WARNING'}
                  aria-label={`Show only warnings, ${stats.warnCount} found`}
                  className={`h-auto sm:h-auto rounded-lg border px-2.5 py-1 ${
                    level === 'WARNING'
                      ? 'border-amber-500 bg-amber-500/20'
                      : 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/40'
                  }`}
>
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {stats.warnCount} Warn{stats.warnCount> 1 ? 's' : ''}
                  </span>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Error message banner */}
        {error && (
          <UIAlert icon={AlertTriangle} variant="destructive" className="m-3 rounded-xl px-4 pt-2.5 pb-2">
            <AlertDescription className="text-xs text-red-700 dark:text-red-300">{error}</AlertDescription>
          </UIAlert>
        )}

        {/* Log Output Area */}
        {loading && lines.length === 0 ? (
          <div className="flex flex-col flex-1 items-center justify-center">
            <Spinner size={24} color="#1a73e8" />
            <div className="mt-2.5 text-xs text-neutral-500 dark:text-neutral-400">Reading {file}.log…</div>
          </div>
        ) : lines.length === 0 ? (
          <div className="flex flex-col flex-1 items-center justify-center p-6">
            <Terminal size={36} color={dark ? '#555' : '#aaa'} />
            <div className="mt-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              No log entries found
            </div>
            <div className="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
              {search ? 'Try clearing the search query or changing log level.' : `${file}.log is empty.`}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col bg-[#101014]">
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className={`mx-auto flex min-h-full w-full max-w-4xl flex-col ${logListContentClass}`}>
                {rows.map((item, index) => {
                  const isErr = item.sev === 'error';
                  const isWarn = item.sev === 'warning';
                  const isDbg = item.sev === 'debug';
                  return (
                    <div
                      key={`${index}-${item.line.length}`}
                      className={`flex items-start rounded px-1 py-0.5 ${
                        isErr ? 'bg-red-950/30' : isWarn ? 'bg-amber-950/20' : ''
                      }`}>
                      <div className="w-9 select-none font-mono text-[10px] text-neutral-600">{index + 1}</div>
                      <div
                        className={`flex-1 font-mono text-[11px] leading-4 ${
                          isErr
                            ? 'font-medium text-red-400'
                            : isWarn
                              ? 'text-amber-300'
                              : isDbg
                                ? 'text-neutral-500'
                                : 'text-neutral-200'
                        }`}>
                        {item.line}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Jump Buttons (Floating) */}
            <div className="absolute bottom-6 right-5 flex-col" style={{ gap: 12 }}>
              <Button
                variant="ghost"
                size="icon"
                onClick={scrollToTop}
                aria-label="Scroll to top"
                className="h-11 w-11 rounded-full border border-neutral-700/80 bg-neutral-900/90 active:bg-neutral-800"
>
                <ArrowUp size={18} color="#fff" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={scrollToBottom}
                aria-label="Scroll to bottom"
                className="h-11 w-11 rounded-full border border-blue-400/30 bg-[#1a73e8] active:bg-blue-600"
>
                <ArrowDown size={18} color="#fff" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
