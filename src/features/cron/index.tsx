import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Alert as UIAlert, AlertDescription } from '../../components/ui/alert';
import { toast } from '../../components/ui/toast';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { ConfirmDialog } from '../../components/ui/dialog';
import { Sheet } from '../../components/ui/sheets';
import { Spinner } from '../../components/ui/bits';
import { Navigate as Redirect } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  History,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Trash,
  User,
  Wrench,
  X,
} from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import type { SessionSummary } from '../../services/gateway-ws';
import { errMsg } from '../../utils/messages';
import { asRecord } from '../../utils/ops';
import { ErrorRetry, ScreenHeader, ScreenScaffold } from '../../components/ui/bits';
import * as api from '../../services/api';
import { compactNumber, formatDateTime, formatRunDuration, formatRunTime } from '../../utils/format';
import { screenStyle } from '../../theme';
import { JobPromptPreview } from './components/JobPromptPreview';
import {
  LOCAL_DELIVERY,
  SCHEDULE_PRESETS,
  deliveryOptions,
  getScheduleExpr,
  normaliseDelivery,
  parseMessageContent,
  scopedRunKey,
} from './helpers';
import type { DeliveryTarget } from './helpers';
import type { CronJobItem, CronRunItem, RunMessageItem } from './types';
import { navigate } from '../../store/nav';
import { ScheduleBuilder } from './components/ScheduleBuilder';
import {
  buildScheduleString,
  describeSchedule,
  englishOrdinal,
  parseScheduleString,
  type ScheduleBuilderState,
  type ScheduleDescribeStrings,
} from '../../utils/schedule';

/** English strings for the human-readable schedule description. Kept here (not
 *  in the pure helper) so a future i18n layer has one obvious place to swap. */
const SCHEDULE_DESCRIBE_STRINGS: ScheduleDescribeStrings = {
  none: '(no schedule)',
  everyMinutes: 'Every {n} min',
  everyHours: 'Every {n} h',
  everyDays: 'Every {n} day(s)',
  dailyAt: 'Daily at {time}',
  weeklyAt: 'Weekly on {days} at {time}',
  monthlyAt: 'Monthly on the {day} at {time}',
  onceAt: 'Once at {time}',
  weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ordinal: englishOrdinal,
};

type JobCardProps = {
  job: CronJobItem;
  dark: boolean;
  busy: boolean;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onOpenRuns: (job: CronJobItem) => void;
  onTrigger: (job: CronJobItem) => void;
  onPause: (job: CronJobItem) => void;
  onResume: (job: CronJobItem) => void;
  onEdit: (job: CronJobItem) => void;
  onDelete: (job: CronJobItem) => void;
};

// Memoized so toggling/acting on one job doesn't re-render every other card.
const JobCard = memo(function JobCard({
  job,
  dark,
  busy,
  expanded,
  onToggleExpand,
  onOpenRuns,
  onTrigger,
  onPause,
  onResume,
  onEdit,
  onDelete,
}: JobCardProps) {
  const isPaused = !job.enabled || job.state === 'paused';
  const scheduleExpr = getScheduleExpr(job);
  const scheduleDesc = describeSchedule(
    typeof job.schedule === 'object' && job.schedule ? job.schedule : undefined,
    job.schedule_display || scheduleExpr,
    SCHEDULE_DESCRIBE_STRINGS,
  );
  const isError = job.last_status === 'error' || Boolean(job.last_error);

  return (
    <div className="rounded-2xl border border-border bg-elevated p-4 dark:bg-elevated">
      {/* Header: Title + Status Badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="text-base font-bold text-neutral-950 dark:text-neutral-100 truncate">
            {job.name || job.id}
          </div>
          <div className="text-[11px] font-mono text-neutral-400 dark:text-neutral-500">ID: {job.id}</div>
        </div>

        <div
          className={`rounded-full px-2.5 py-0.5 border ${
            isError
              ? 'border-red-300 bg-red-100 dark:border-red-800 dark:bg-red-950/60'
              : isPaused
                ? 'border-amber-300 bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60'
                : 'border-emerald-300 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60'
          }`}>
          <div
            className={`text-[11px] font-semibold capitalize ${
              isError
                ? 'text-red-700 dark:text-red-300'
                : isPaused
                  ? 'text-amber-700 dark:text-amber-300'
                  : 'text-emerald-700 dark:text-emerald-300'
            }`}>
            {isError ? 'Error' : isPaused ? 'Paused' : 'Active'}
          </div>
        </div>
      </div>

      {/* Schedule badge & next run */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <div title={scheduleExpr} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 dark:bg-muted">
          <Clock size={12} color={dark ? '#ccc' : '#444'} />
          <div className="text-xs font-medium text-neutral-800 dark:text-neutral-200">{scheduleDesc}</div>
        </div>
        {job.next_run_at && (
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
            Next: {formatDateTime(job.next_run_at)}
          </div>
        )}
        {job.last_run_at && (
          <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
            Last: {formatDateTime(job.last_run_at)}
          </div>
        )}
      </div>

      {/* Prompt Preview */}
      {Boolean(job.prompt) && (
        <JobPromptPreview prompt={job.prompt!} isExpanded={expanded} onToggleExpand={() => onToggleExpand(job.id)} />
      )}

      {/* Last Error Banner if any */}
      {Boolean(job.last_error) && (
        <UIAlert
          icon={AlertTriangle}
          variant="destructive"
          className="mt-2.5 rounded-lg px-3 pt-2.5 pb-2"
          iconClassName="size-3.5">
          <AlertDescription className="pl-5 text-[11px] font-medium text-red-700 dark:text-red-300">
            {job.last_error}
          </AlertDescription>
        </UIAlert>
      )}

      {/* Action Buttons Toolbar */}
      <div className="mt-3.5 flex items-center justify-between pt-2.5 border-t border-border/70 dark:border-border/70">
        {/* Left: Runs History */}
        <Button
          variant="ghost"
          onClick={() => void onOpenRuns(job)}
          aria-label={`Run history for ${job.name || job.id}`}
          className="h-auto sm:h-auto rounded-lg border border-brand/30 bg-brand/10 px-2.5 py-1.5 active:bg-brand/20">
          <History size={13} color="var(--brand-hex)" />
          <span className="text-xs font-semibold text-brand">History</span>
        </Button>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          {/* Trigger / Run Now */}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void onTrigger(job)}
            aria-label={`Run ${job.name || job.id} now`}
            className="h-auto sm:h-auto rounded-lg border border-border px-2.5 py-1.5 active:bg-muted dark:active:bg-muted">
            {busy ? (
              <Spinner size={14} color="var(--brand-hex)" />
            ) : (
              <>
                <Play size={12} color={dark ? '#f5f5f5' : '#111'} fill={dark ? '#f5f5f5' : '#111'} />
                <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">Run</span>
              </>
            )}
          </Button>

          {/* Pause or Resume */}
          {isPaused ? (
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              onClick={() => void onResume(job)}
              aria-label={`Resume ${job.name || job.id}`}
              className="h-8 w-8 rounded-lg border border-border active:bg-muted dark:active:bg-muted">
              <RotateCw size={13} color={dark ? '#f5f5f5' : '#111'} />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              onClick={() => void onPause(job)}
              aria-label={`Pause ${job.name || job.id}`}
              className="h-8 w-8 rounded-lg border border-border active:bg-muted dark:active:bg-muted">
              <Pause size={13} color={dark ? '#f5f5f5' : '#111'} />
            </Button>
          )}

          {/* Edit */}
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={() => onEdit(job)}
            aria-label={`Edit ${job.name || job.id}`}
            className="h-8 w-8 rounded-lg border border-border active:bg-muted dark:active:bg-muted">
            <Pencil size={13} color={dark ? '#ccc' : '#555'} />
          </Button>

          {/* Delete */}
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={() => onDelete(job)}
            aria-label={`Delete ${job.name || job.id}`}
            className="h-8 w-8 rounded-lg border border-red-200 active:bg-red-50 dark:border-red-900/60 dark:active:bg-red-950/30">
            <Trash size={13} color="#dc2626" />
          </Button>
        </div>
      </div>
    </div>
  );
});

type RunCardProps = {
  run: CronRunItem;
  dark: boolean;
  expanded: boolean;
  messages: RunMessageItem[] | undefined;
  messagesLoading: boolean;
  onToggleRun: (runId: string) => void;
  onOpenInChat: (run: CronRunItem) => void;
};

// Memoized so expanding one run's transcript doesn't re-render every row.
const RunCard = memo(function RunCard({
  run,
  dark,
  expanded,
  messages,
  messagesLoading,
  onToggleRun,
  onOpenInChat,
}: RunCardProps) {
  const isRunActive = run.is_active || (!run.ended_at && Boolean(run.started_at));
  const isRunFailed = run.end_reason === 'error';
  const isRunCompleted = Boolean(run.ended_at) && !isRunFailed;
  const duration = formatRunDuration(run.started_at, run.ended_at);
  const totalTokens = (run.input_tokens || 0) + (run.output_tokens || 0);

  return (
    <div className="rounded-2xl border border-border bg-elevated p-3.5 dark:bg-input/30/50">
      {/* Header: Status + Time + Duration */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={`rounded-full px-2 py-0.5 border ${
              isRunActive
                ? 'border-brand/40 bg-brand/15 dark:border-brand/40'
                : isRunFailed
                  ? 'border-red-300 bg-red-100 dark:border-red-800 dark:bg-red-950/60'
                  : isRunCompleted
                    ? 'border-emerald-300 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60'
                    : 'border-border bg-muted dark:bg-muted'
            }`}>
            <div
              className={`text-[10px] font-bold uppercase tracking-wider ${
                isRunActive
                  ? 'text-brand'
                  : isRunFailed
                    ? 'text-red-700 dark:text-red-300'
                    : isRunCompleted
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : run.end_reason || 'Finished'
              }
            `}>
              {isRunActive
                ? 'Running'
                : isRunFailed
                  ? 'Failed'
                  : isRunCompleted
                    ? 'Success'
                    : run.end_reason || 'Finished'}
            </div>
          </div>

          {duration && <div className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">⏱ {duration}</div>}
        </div>

        <div className="text-[11px] text-neutral-400 dark:text-neutral-500">{formatRunTime(run.started_at)}</div>
      </div>

      {/* Title / Preview */}
      <div className="mt-2">
        <div className={`text-xs font-medium text-neutral-800 dark:text-neutral-200 ${expanded ? '' : 'line-clamp-2'}`}>
          {run.title || run.preview || '(No preview available)'}
        </div>
        <div className="mt-0.5 text-[10px] font-mono text-neutral-400 dark:text-neutral-500">{run.id}</div>
      </div>

      {/* Metrics row */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 dark:bg-muted">
          <MessageSquare size={11} color={dark ? '#aaa' : '#666'} />
          <div className="text-[11px] text-neutral-700 dark:text-neutral-300">{run.message_count ?? 0} msgs</div>
        </div>

        {Boolean(run.tool_call_count) && (
          <div className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 dark:bg-muted">
            <Wrench size={11} color={dark ? '#aaa' : '#666'} />
            <div className="text-[11px] text-neutral-700 dark:text-neutral-300">{run.tool_call_count} tools</div>
          </div>
        )}

        {totalTokens > 0 && (
          <div className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 dark:bg-muted">
            <div className="text-[11px] font-mono text-neutral-700 dark:text-neutral-300">
              {compactNumber(totalTokens)} tok
            </div>
          </div>
        )}

        {Number(run.estimated_cost_usd) > 0 && (
          <div className="rounded bg-emerald-100/80 px-2 py-0.5 dark:bg-emerald-950/50">
            <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
              ${Number(run.estimated_cost_usd).toFixed(4)}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons: View Messages / Open in Chat */}
      <div className="mt-3 flex items-center justify-between pt-2 border-t border-border/60 dark:border-border/60">
        <Button
          variant="ghost"
          onClick={() => void onToggleRun(run.id)}

          aria-label={expanded ? 'Hide messages' : 'View messages'}
          className="h-auto sm:h-auto px-0 py-1">
          <span className="text-xs font-semibold text-brand">{expanded ? 'Hide Messages' : 'View Messages'}</span>
          {expanded ? (
            <ChevronUp size={14} color="var(--brand-hex)" />
          ) : (
            <ChevronDown size={14} color="var(--brand-hex)" />
          )}
        </Button>

        <Button
          variant="ghost"
          onClick={() => void onOpenInChat(run)}
          aria-label="Open this run in chat"
          className="h-auto sm:h-auto rounded-lg bg-muted px-2.5 py-1 active:bg-muted dark:bg-muted dark:active:bg-muted">
          <ExternalLink size={12} color={dark ? '#ddd' : '#333'} />
          <span className="text-xs font-medium text-neutral-800 dark:text-neutral-200">Open in Chat</span>
        </Button>
      </div>

      {/* Expanded Transcript Preview */}
      {expanded && (
        <div className="mt-3 rounded-xl border border-border bg-popover p-3 dark:bg-background/60">
          {messagesLoading && !messages && (
            <div className="flex flex-col items-center justify-center py-6">
              <Spinner size={14} color="var(--brand-hex)" />
              <div className="mt-2 text-xs text-neutral-400">Loading transcript…</div>
            </div>
          )}

          {messages && messages.length === 0 && (
            <div className="text-center text-xs text-neutral-400 py-4">No messages found for this run session.</div>
          )}

          {messages && messages.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {messages.map((m, idx) => {
                const isUser = m.role === 'user';
                const isTool = m.role === 'tool';
                const contentText = parseMessageContent(m.display_content || m.content);
                const reasoningText = m.reasoning_content || m.reasoning;

                return (
                  <div
                    key={m.id ? String(m.id) : `msg-${idx}`}
                    className={`rounded-lg p-2.5 ${
                      isUser
                        ? 'bg-brand/10 border border-brand/30 dark:border-brand/30'
                        : isTool
                          ? 'bg-elevated border border-border dark:border-border'
                          : 'bg-elevated border border-border/70 dark:border-border'
                    }`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        {isUser ? (
                          <User size={12} color="var(--brand-hex)" />
                        ) : isTool ? (
                          <Wrench size={12} color="#8b5cf6" />
                        ) : (
                          <Bot size={12} color="#10b981" />
                        )}
                        <div
                          className={`text-[10px] font-bold uppercase tracking-wider ${
                            isUser
                              ? 'text-brand'
                              : isTool
                                ? 'text-purple-700 dark:text-purple-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                          }`}>
                          {isUser ? 'User / Trigger' : isTool ? `Tool: ${m.tool_name || m.name || 'call'}` : 'Hermes'}
                        </div>
                      </div>
                    </div>

                    {Boolean(reasoningText) && (
                      <div className="mb-1.5 rounded bg-muted p-1.5 dark:bg-muted">
                        <div className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 mb-0.5">
                          Thinking / Reasoning:
                        </div>
                        <div className="text-[11px] italic text-neutral-600 dark:text-neutral-300 font-mono line-clamp-4">
                          {reasoningText}
                        </div>
                      </div>
                    )}

                    {Boolean(contentText) && (
                      <div
                        className={`text-xs leading-relaxed text-neutral-800 dark:text-neutral-200 ${
                          isTool ? 'font-mono text-[11px]' : ''
                        }`}>
                        {contentText}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export function CronScreen() {
  const { authed, activeProfile, opsGet, opsMut, openSession, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  // Resolved once per scheme: the job list re-renders on every poll and each
  // value feeds the screen surface plus all four form fields.
  const screen = useMemo(() => screenStyle(dark), [dark]);

  const [jobs, setJobs] = useState<CronJobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  // Themed replacement for the old Alert.alert delete confirm.
  const [confirmDelete, setConfirmDelete] = useState<{ title: string; body: string; run: () => void } | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Modal State for Create / Edit
  const [modalOpen, setModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJobItem | null>(null);
  const [formName, setFormName] = useState('');
  // The schedule picker owns structured state; `formSchedule` below is the
  // backend-compatible string derived from it on every render.
  const [scheduleState, setScheduleState] = useState<ScheduleBuilderState>(() => parseScheduleString('0 9 * * *'));
  const formSchedule = buildScheduleString(scheduleState);
  const [formPrompt, setFormPrompt] = useState('');
  const [formModel, setFormModel] = useState('');
  // Omitted from the payload when empty so the server keeps whatever target the
  // job already had. It used to be seeded to 'local' and always shipped, which
  // pinned any job whose delivery was configured elsewhere.
  const [formDeliver, setFormDeliver] = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // `GET /api/cron/delivery-targets` — the server owns this list (connected
  // platforms + bot-chat targets per profile), so the form never invents a
  // platform name. Empty means the fetch failed; the form then offers `local`
  // only rather than offering targets that may not exist.
  const [deliveryTargets, setDeliveryTargets] = useState<DeliveryTarget[]>([]);

  // Run History state
  const [runsModalOpen, setRunsModalOpen] = useState(false);
  const [selectedJobForRuns, setSelectedJobForRuns] = useState<CronJobItem | null>(null);
  const [runsList, setRunsList] = useState<CronRunItem[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runMessages, setRunMessages] = useState<Record<string, RunMessageItem[]>>({});
  const [runMessagesLoading, setRunMessagesLoading] = useState(false);

  // Bottom sheets: Sheet drives present/dismiss from these two booleans.

  useEffect(() => {
    if (authed) return;
    setJobs([]);
    setRunsList([]);
    setRunMessages({});
    setSelectedJobForRuns(null);
    setRunsModalOpen(false);
    setModalOpen(false);
    setError(null);
  }, [authed]);

  const loadJobs = useCallback(
    async (isRefresh = false) => {
      const scope = getAuthScope();
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const data = await opsGet(api.cronJobsAllProfiles());
        if (getAuthScope() !== scope) return;
        const payload = asRecord(data);
        const list = (Array.isArray(payload.jobs) ? payload.jobs : Array.isArray(data) ? data : []) as CronJobItem[];
        setJobs(list);
      } catch (e) {
        if (getAuthScope() === scope) setError(errMsg(e));
      } finally {
        if (getAuthScope() === scope) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [getAuthScope, opsGet],
  );

  useEffect(() => {
    if (authed) void loadJobs();
  }, [authed, loadJobs]);

  // Loaded once per auth: the target list only changes when a platform is
  // connected or a home channel is set, and a failed fetch must not block the
  // job list (the form falls back to `local`).
  const loadDeliveryTargets = useCallback(async () => {
    const scope = getAuthScope();
    try {
      const data = await opsGet(api.cronDeliveryTargets(activeProfile));
      if (getAuthScope() !== scope) return;
      const payload = asRecord(data);
      const rows = Array.isArray(payload.targets) ? payload.targets : [];
      const targets: DeliveryTarget[] = [];
      for (const row of rows) {
        const t = asRecord(row);
        const id = typeof t.id === 'string' ? t.id.trim() : '';
        if (!id) continue;
        targets.push({
          id,
          name: typeof t.name === 'string' && t.name ? t.name : id,
          home_target_set: t.home_target_set !== false,
          home_env_var: typeof t.home_env_var === 'string' ? t.home_env_var : null,
        });
      }
      setDeliveryTargets(targets);
    } catch {
      if (getAuthScope() === scope) setDeliveryTargets([]);
    }
  }, [activeProfile, getAuthScope, opsGet]);

  useEffect(() => {
    if (authed) void loadDeliveryTargets();
  }, [authed, loadDeliveryTargets]);

  const openCreateModal = useCallback(() => {
    setEditingJob(null);
    setFormName('');
    setScheduleState(parseScheduleString('0 9 * * *'));
    setFormPrompt('');
    setFormModel('');
    setFormDeliver(LOCAL_DELIVERY);
    setFormError(null);
    setModalOpen(true);
  }, []);

  const openEditModal = useCallback(
    (job: CronJobItem) => {
      setEditingJob(job);
      setFormName(job.name || '');
      setScheduleState(parseScheduleString(getScheduleExpr(job) || '0 9 * * *'));
      setFormPrompt(job.prompt || '');
      setFormModel(job.model || '');
      setFormDeliver(normaliseDelivery(job.deliver, deliveryOptions(deliveryTargets, { hasOrigin: true })));
      setFormError(null);
      setModalOpen(true);
    },
    [deliveryTargets],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const notify = (msg: string) => {
    setStatusNotice(msg);
    setTimeout(() => setStatusNotice(null), 3000);
  };

  // Run History Handlers
  const handleOpenRuns = useCallback(
    async (job: CronJobItem) => {
      const scope = getAuthScope();
      setSelectedJobForRuns(job);
      setRunsModalOpen(true);
      setRunsLoading(true);
      setRunsError(null);
      setExpandedRunId(null);
      try {
        const data = await opsGet(api.cronJobRuns(job.id, job.profile || activeProfile));
        if (getAuthScope() !== scope) return;
        const runsPayload = asRecord(data);
        const list = (
          Array.isArray(runsPayload.runs) ? runsPayload.runs : Array.isArray(data) ? data : []
        ) as CronRunItem[];
        setRunsList(list);
      } catch (e) {
        if (getAuthScope() === scope) setRunsError(errMsg(e));
      } finally {
        if (getAuthScope() === scope) setRunsLoading(false);
      }
    },
    [activeProfile, getAuthScope, opsGet],
  );

  const handleRefreshRuns = useCallback(async () => {
    if (!selectedJobForRuns) return;
    const scope = getAuthScope();
    setRunsLoading(true);
    setRunsError(null);
    try {
      const data = await opsGet(api.cronJobRuns(selectedJobForRuns.id, selectedJobForRuns.profile || activeProfile));
      if (getAuthScope() !== scope) return;
      const refreshPayload = asRecord(data);
      const list = (
        Array.isArray(refreshPayload.runs) ? refreshPayload.runs : Array.isArray(data) ? data : []
      ) as CronRunItem[];
      setRunsList(list);
    } catch (e) {
      if (getAuthScope() === scope) setRunsError(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setRunsLoading(false);
    }
  }, [activeProfile, getAuthScope, opsGet, selectedJobForRuns]);

  const toggleExpandRun = useCallback(
    async (runId: string) => {
      const scope = getAuthScope();
      if (expandedRunId === runId) {
        setExpandedRunId(null);
        return;
      }
      setExpandedRunId(runId);
      const run = runsList.find((item) => item.id === runId);
      const runProfile = run?.profile || selectedJobForRuns?.profile || activeProfile;
      const cacheKey = scopedRunKey(runId, runProfile);
      if (!runMessages[cacheKey]) {
        setRunMessagesLoading(true);
        try {
          const data = await opsGet(api.cronRunMessages(runId, runProfile));
          if (getAuthScope() !== scope) return;
          const msgsPayload = asRecord(data);
          const msgs = (Array.isArray(msgsPayload.messages) ? msgsPayload.messages : []) as RunMessageItem[];
          setRunMessages((prev) => ({ ...prev, [cacheKey]: msgs }));
        } catch (e) {
          console.warn('[cron] run messages failed', e);
          if (getAuthScope() === scope) setRunMessages((prev) => ({ ...prev, [cacheKey]: [] }));
        } finally {
          if (getAuthScope() === scope) setRunMessagesLoading(false);
        }
      }
    },
    [activeProfile, expandedRunId, getAuthScope, opsGet, runMessages, runsList, selectedJobForRuns],
  );

  const handleOpenInChat = useCallback(
    async (run: CronRunItem) => {
      const scope = getAuthScope();
      try {
        const summary: SessionSummary = {
          id: run.id,
          title: run.title || selectedJobForRuns?.name || run.id,
          preview: run.preview || '',
          messageCount: run.message_count || 0,
          source: 'cron',
          profile: run.profile || selectedJobForRuns?.profile || activeProfile,
          startedAt: Number(run.started_at || 0),
        };
        if (getAuthScope() !== scope) return;
        setRunsModalOpen(false);
        await openSession(summary);
        if (getAuthScope() === scope) navigate('/chat');
      } catch (e) {
        if (getAuthScope() === scope)
          toast({ title: 'Open Chat Failed', description: errMsg(e), variant: 'destructive' });
      }
    },
    [activeProfile, getAuthScope, openSession, selectedJobForRuns],
  );

  // Run Now (Trigger)
  const handleTrigger = useCallback(
    async (job: CronJobItem) => {
      const scope = getAuthScope();
      setActionLoadingId(job.id);
      try {
        await opsMut(api.cronJobAction(job.id, 'trigger', job.profile || activeProfile), 'POST', {});
        if (getAuthScope() !== scope) return;
        notify(`Triggered "${job.name || job.id}"`);
        await loadJobs(true);
      } catch (e) {
        if (getAuthScope() === scope)
          toast({ title: 'Trigger Failed', description: errMsg(e), variant: 'destructive' });
      } finally {
        if (getAuthScope() === scope) setActionLoadingId(null);
      }
    },
    [activeProfile, getAuthScope, loadJobs, opsMut],
  );

  // Pause
  const handlePause = useCallback(
    async (job: CronJobItem) => {
      const scope = getAuthScope();
      setActionLoadingId(job.id);
      try {
        await opsMut(api.cronJobAction(job.id, 'pause', job.profile || activeProfile), 'POST', {});
        if (getAuthScope() !== scope) return;
        notify(`Paused "${job.name || job.id}"`);
        await loadJobs(true);
      } catch (e) {
        if (getAuthScope() === scope) toast({ title: 'Pause Failed', description: errMsg(e), variant: 'destructive' });
      } finally {
        if (getAuthScope() === scope) setActionLoadingId(null);
      }
    },
    [activeProfile, getAuthScope, loadJobs, opsMut],
  );

  // Resume
  const handleResume = useCallback(
    async (job: CronJobItem) => {
      const scope = getAuthScope();
      setActionLoadingId(job.id);
      try {
        await opsMut(api.cronJobAction(job.id, 'resume', job.profile || activeProfile), 'POST', {});
        if (getAuthScope() !== scope) return;
        notify(`Resumed "${job.name || job.id}"`);
        await loadJobs(true);
      } catch (e) {
        if (getAuthScope() === scope) toast({ title: 'Resume Failed', description: errMsg(e), variant: 'destructive' });
      } finally {
        if (getAuthScope() === scope) setActionLoadingId(null);
      }
    },
    [activeProfile, getAuthScope, loadJobs, opsMut],
  );

  // Delete
  const handleDelete = useCallback(
    (job: CronJobItem) => {
      setConfirmDelete({
        title: 'Delete Cron Job',
        body: `Are you sure you want to delete "${job.name || job.id}"?`,
        run: async () => {
          const scope = getAuthScope();
          setActionLoadingId(job.id);
          try {
            await opsMut(api.cronJob(job.id, job.profile || activeProfile), 'DELETE');
            if (getAuthScope() !== scope) return;
            notify(`Deleted "${job.name || job.id}"`);
            await loadJobs(true);
          } catch (e) {
            if (getAuthScope() === scope)
              toast({ title: 'Delete Failed', description: errMsg(e), variant: 'destructive' });
          } finally {
            if (getAuthScope() === scope) setActionLoadingId(null);
          }
        },
      });
    },
    [activeProfile, getAuthScope, loadJobs, opsMut],
  );

  // Save (Create or Edit)
  const handleSave = async () => {
    const scope = getAuthScope();
    if (!formName.trim()) {
      setFormError('Job name is required');
      return;
    }
    if (!formSchedule.trim()) {
      setFormError('Schedule expression is required');
      return;
    }
    if (!formPrompt.trim()) {
      setFormError('Prompt / instructions are required');
      return;
    }

    setFormSaving(true);
    setFormError(null);

    const deliver = formDeliver.trim();
    const payload = {
      name: formName.trim(),
      schedule: formSchedule.trim(),
      prompt: formPrompt.trim(),
      // Only sent when it differs from what the job already has, so an untouched
      // field can't rewrite a target the form never showed.
      ...(deliver && deliver !== (editingJob?.deliver || '') ? { deliver } : {}),
      ...(formModel.trim() ? { model: formModel.trim() } : {}),
    };

    try {
      if (editingJob) {
        await opsMut(api.cronJob(editingJob.id, editingJob.profile || activeProfile), 'PUT', { updates: payload });
        if (getAuthScope() !== scope) return;
        notify(`Updated "${payload.name}"`);
      } else {
        await opsMut(api.cronJobs(activeProfile), 'POST', payload);
        if (getAuthScope() !== scope) return;
        notify(`Created "${payload.name}"`);
      }
      setModalOpen(false);
      await loadJobs(true);
    } catch (e) {
      if (getAuthScope() === scope) setFormError(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setFormSaving(false);
    }
  };

  // What the Notify field offers for the job being edited. `origin` only makes
  // sense for a job that has somewhere to go back to, and the server's list
  // never includes it (it prepends it per-blueprint, ops.py list_cron_blueprints).
  const deliverChoices = useMemo(
    () => deliveryOptions(deliveryTargets, { hasOrigin: Boolean(editingJob) }),
    [deliveryTargets, editingJob],
  );

  const jobsEmpty = useMemo(() => {
    if (loading && !refreshing) {
      return (
        <div className="flex flex-col items-center justify-center py-16">
          <Spinner size={24} color="var(--brand-hex)" />
          <div className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Loading cron jobs…</div>
        </div>
      );
    }
    if (!error) {
      return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-8">
          <Clock size={36} color={dark ? '#666' : '#999'} />
          <div className="mt-3 text-base font-semibold text-neutral-800 dark:text-neutral-200">No Cron Jobs Yet</div>
          <div className="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
            Schedule recurring prompts or automation tasks for Hermes.
          </div>
          <Button
            onClick={openCreateModal}
            aria-label="Create first cron job"
            className="mt-4 h-auto sm:h-auto rounded-xl bg-brand px-4 py-2.5">
            <Plus size={16} color="#fff" />
            <span className="text-sm font-semibold text-white">Create First Job</span>
          </Button>
        </div>
      );
    }
    return null;
  }, [dark, error, loading, openCreateModal, refreshing]);

  const runsHeader = useMemo(
    () =>
      runsError ? (
        <ErrorRetry error={runsError} onRetry={() => void handleRefreshRuns()} className="mb-3" compact />
      ) : null,
    [handleRefreshRuns, runsError],
  );
  const runsEmpty = useMemo(() => {
    if (runsLoading && runsList.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16">
          <Spinner size={24} color="var(--brand-hex)" />
          <div className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Loading run history…</div>
        </div>
      );
    }
    if (runsList.length === 0 && !runsError) {
      return (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-8">
          <Clock size={36} color={dark ? '#666' : '#999'} />
          <div className="mt-3 text-base font-semibold text-neutral-800 dark:text-neutral-200">No Runs Recorded</div>
          <div className="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
            This cron job hasn&apos;t executed yet. You can tap &quot;Run&quot; on the job card to trigger a run now.
          </div>
        </div>
      );
    }
    return null;
  }, [dark, runsError, runsList.length, runsLoading]);
  const jobsContentClass = 'p-3.5 pb-[calc(env(safe-area-inset-bottom,0px)+32px)]';
  const runsContentClass = 'p-4 pb-[calc(env(safe-area-inset-bottom,0px)+30px)]';

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screen}>
      {/* No 'bottom' edge: main list content already pads insets.bottom + 32. */}
      <ScreenScaffold
        header={
          <ScreenHeader
            title="Cron Jobs"
            actions={
              <Button onClick={openCreateModal} className="h-8 rounded-lg bg-brand px-3">
                <Plus size={16} color="#fff" />
                <span className="text-xs font-semibold text-white">New</span>
              </Button>
            }
          />
        }>
        {/* Status feedback toast */}
        {statusNotice && (
          <div className="mx-4 mt-2 rounded-lg bg-emerald-600 px-3 py-2">
            <div className="text-center text-xs font-semibold text-white">{statusNotice}</div>
          </div>
        )}

        <ErrorRetry error={error} onRetry={() => void loadJobs()} className="mx-4 mb-3 mt-3" compact />

        <div className={`mx-auto flex min-h-full w-full max-w-4xl flex-col ${jobsContentClass}`}>
          {jobs.length === 0
            ? jobsEmpty
            : jobs.map((job, i) => (
                <div key={job.id}>
                  {i > 0 && <div style={{ height: 12 }} />}
                  <JobCard
                    job={job}
                    dark={dark}
                    busy={actionLoadingId === job.id}
                    expanded={expandedIds.has(job.id)}
                    onToggleExpand={toggleExpand}
                    onOpenRuns={handleOpenRuns}
                    onTrigger={handleTrigger}
                    onPause={handlePause}
                    onResume={handleResume}
                    onEdit={openEditModal}
                    onDelete={handleDelete}
                  />
                </div>
              ))}
        </div>
      </ScreenScaffold>

      {/* Create / Edit sheet */}
      <Sheet open={modalOpen} onOpenChange={setModalOpen}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 pb-3">
          <div className="text-lg font-bold text-neutral-950 dark:text-neutral-100">
            {editingJob ? 'Edit Cron Job' : 'New Cron Job'}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            disabled={formSaving}
            onClick={() => setModalOpen(false)}
            className="h-8 w-8 rounded-lg">
            <X size={20} color={dark ? '#ccc' : '#444'} />
          </Button>
        </div>

        {/* Body form */}
        <div className="overflow-y-auto bg-background">
          <div className="flex flex-col gap-3.5 p-4 pb-8">
            {formError && (
              <UIAlert icon={AlertCircle} variant="destructive" className="rounded-xl px-4 pt-3">
                <AlertDescription className="text-xs font-medium text-red-700 dark:text-red-300">
                  {formError}
                </AlertDescription>
              </UIAlert>
            )}

            {/* Name */}
            <div>
              <Label className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">Job Name *</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. morning-brief"
                autoCapitalize="none"
                className="rounded-xl border border-border px-3.5 py-2.5 text-sm text-neutral-950 dark:bg-input/30 dark:text-neutral-100"
              />
            </div>

            {/* Schedule */}
            <div>
              <Label className="mb-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300">Schedule *</Label>
              <ScheduleBuilder value={scheduleState} onChange={setScheduleState} />
              {/* Quick presets — one tap to a common schedule, parsed back into
                    the builder so its fields fill in. */}
              <div className="mt-2 mb-1 text-[11px] text-neutral-400">Quick presets:</div>
              <div className="overflow-x-auto flex gap-1.5">
                <div>
                  {SCHEDULE_PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      variant="ghost"
                      aria-pressed={formSchedule === preset.expr}
                      aria-label={`${preset.label} schedule, ${preset.expr}`}
                      onClick={() => setScheduleState(parseScheduleString(preset.expr))}
                      className={`h-auto sm:h-auto mr-1.5 rounded-lg border px-2.5 py-1 ${
                        formSchedule === preset.expr ? 'border-brand bg-brand/10' : 'border-border dark:border-border'
                      }`}>
                      <span
                        className={`text-[11px] font-medium ${
                          formSchedule === preset.expr ? 'text-brand' : 'text-neutral-600 dark:text-neutral-300'
                        }`}>
                        {preset.label}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Prompt / Instructions */}
            <div>
              <Label className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                Prompt (Task for Hermes) *
              </Label>
              <Textarea
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.target.value)}
                placeholder="Describe what the agent should execute when this cron job triggers..."

                numberOfLines={4}
                className="min-h-[100px] rounded-xl border border-border p-3 text-sm text-neutral-950 dark:bg-input/30 dark:text-neutral-100"
              />
            </div>

            {/* Optional: Model override */}
            <div>
              <Label className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                Model Override (optional)
              </Label>
              <Input
                value={formModel}
                onChange={(e) => setFormModel(e.target.value)}
                placeholder="e.g. nous/hermes-3-llama-3.1-8b (leave blank for default)"
                autoCapitalize="none"
                className="rounded-xl border border-border px-3.5 py-2.5 text-sm text-neutral-950 dark:bg-input/30 dark:text-neutral-100"
              />
            </div>

            {/* Delivery target — options come from the server, never guessed. */}
            <div>
              <Label className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">Notify</Label>
              {deliverChoices.length === 1 ? (
                <div className="rounded-xl border border-dashed border-border px-3.5 py-2.5">
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">
                    This gateway reports no notification targets, so runs are saved without sending anywhere. Connect a
                    platform on the server to enable delivery.
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {deliverChoices.map((option) => {
                    const selected = formDeliver === option.id;
                    const disabled = !option.home_target_set;
                    return (
                      <Button
                        key={option.id}
                        variant="ghost"

                        aria-label={`Deliver to ${option.name}`}
                        disabled={disabled}
                        onClick={() => setFormDeliver(option.id)}
                        className={`h-auto sm:h-auto w-full items-start justify-start rounded-xl border px-3 py-2.5 ${
                          selected ? 'border-brand bg-brand/10' : 'border-border dark:border-border'
                        } ${disabled ? 'opacity-50' : ''}`}>
                        <div className="flex-1">
                          <div
                            className={`text-sm font-medium ${
                              selected ? 'text-brand' : 'text-neutral-800 dark:text-neutral-200'
                            }`}>
                            {option.name}
                          </div>
                          {disabled ? (
                            <div className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                              No home channel set
                              {option.home_env_var ? ` (${option.home_env_var})` : ''}
                            </div>
                          ) : null}
                        </div>
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="mt-2 flex gap-3">
              <Button
                variant="outline"
                disabled={formSaving}
                onClick={() => setModalOpen(false)}
                aria-label="Cancel"
                className="h-auto sm:h-auto flex-1 rounded-xl py-3">
                <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Cancel</span>
              </Button>

              <Button
                disabled={formSaving}
                onClick={handleSave}
                aria-label={editingJob ? 'Save changes' : 'Create job'}
                className="h-auto sm:h-auto flex-1 rounded-xl bg-brand py-3 active:bg-brand">
                {formSaving ? (
                  <Spinner size={14} color="#fff" />
                ) : (
                  <span className="text-sm font-semibold text-white">{editingJob ? 'Save Changes' : 'Create Job'}</span>
                )}
              </Button>
            </div>
          </div>
        </div>
      </Sheet>

      {/* Runs History sheet */}
      <Sheet open={runsModalOpen} onOpenChange={setRunsModalOpen}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 pb-3">
          <div className="flex-1 pr-2">
            <div className="flex items-center gap-2">
              <History size={18} color="var(--brand-hex)" />
              <div className="text-base font-bold text-neutral-950 dark:text-neutral-100">Run History</div>
            </div>
            <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 truncate">
              {selectedJobForRuns?.name || selectedJobForRuns?.id}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh runs"
              disabled={runsLoading}
              onClick={() => void handleRefreshRuns()}
              className="h-9 w-9 rounded-lg">
              {runsLoading ? (
                <Spinner size={14} color="var(--brand-hex)" />
              ) : (
                <RefreshCw size={18} color={dark ? '#ccc' : '#444'} />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close run history"
              onClick={() => setRunsModalOpen(false)}
              className="h-9 w-9 rounded-lg">
              <X size={20} color={dark ? '#ccc' : '#444'} />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className={`mx-auto flex min-h-full w-full max-w-4xl flex-col ${runsContentClass}`}>
            {runsHeader}
            {runsList.length === 0
              ? runsEmpty
              : runsList.map((run, i) => (
                  <div key={run.id}>
                    {i > 0 && <div style={{ height: 12 }} />}
                    <RunCard
                      run={run}
                      dark={dark}
                      expanded={expandedRunId === run.id}
                      messages={
                        runMessages[scopedRunKey(run.id, run.profile || selectedJobForRuns?.profile || activeProfile)]
                      }
                      messagesLoading={runMessagesLoading}
                      onToggleRun={toggleExpandRun}
                      onOpenInChat={handleOpenInChat}
                    />
                  </div>
                ))}
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete?.title ?? ''}
        description={confirmDelete?.body}
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirmDelete?.run()}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
      />
    </div>
  );
}
