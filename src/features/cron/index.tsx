import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Redirect, useRouter } from 'expo-router';
import {
  AlertTriangle,
  Bot,
  Check,
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
} from 'lucide-react-native';
import { useApp } from '../../hooks/app-store';
import type { SessionSummary } from '../../services/gateway-ws';
import { errMsg } from '../../utils/messages';
import { HamburgerBtn } from '../../components/ui/bits';
import * as api from '../../services/api';
import { compactNumber, formatDateTime, formatRunDuration, formatRunTime } from '../../utils/format';
import { JobPromptPreview } from './components/JobPromptPreview';
import { SCHEDULE_PRESETS, getScheduleExpr, parseMessageContent, scopedRunKey } from './helpers';
import type { CronJobItem, CronRunItem, RunMessageItem } from './types';

export function CronScreen() {
  const router = useRouter();
  const { authed, activeProfile, opsGet, opsMut, theme, openSession, getAuthScope } = useApp();
  const dark = theme === 'dark';
  const insets = useSafeAreaInsets();

  const [jobs, setJobs] = useState<CronJobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Modal State for Create / Edit
  const [modalOpen, setModalOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJobItem | null>(null);
  const [formName, setFormName] = useState('');
  const [formSchedule, setFormSchedule] = useState('0 9 * * *');
  const [formPrompt, setFormPrompt] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formDeliver, setFormDeliver] = useState('local');
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Bottom sheet sits under the keyboard on Android (edge-to-edge ignores
  // adjustResize), so lift it by hand like the chat dock does.
  const [kbH, setKbH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e: any) =>
      setKbH(Math.max(0, Math.round(e?.endCoordinates?.height ?? 0))),
    );
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Run History state
  const [runsModalOpen, setRunsModalOpen] = useState(false);
  const [selectedJobForRuns, setSelectedJobForRuns] = useState<CronJobItem | null>(null);
  const [runsList, setRunsList] = useState<CronRunItem[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runMessages, setRunMessages] = useState<Record<string, RunMessageItem[]>>({});
  const [runMessagesLoading, setRunMessagesLoading] = useState(false);

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
        const list: CronJobItem[] = Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data) ? data : [];
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

  const openCreateModal = useCallback(() => {
    setEditingJob(null);
    setFormName('');
    setFormSchedule('0 9 * * *');
    setFormPrompt('');
    setFormModel('');
    setFormDeliver('local');
    setFormError(null);
    setModalOpen(true);
  }, []);

  const openEditModal = useCallback((job: CronJobItem) => {
    setEditingJob(job);
    setFormName(job.name || '');
    setFormSchedule(getScheduleExpr(job) || '0 9 * * *');
    setFormPrompt(job.prompt || '');
    setFormModel(job.model || '');
    setFormDeliver(job.deliver || 'local');
    setFormError(null);
    setModalOpen(true);
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
        const data = await opsGet(
          api.cronJobRuns(job.id, job.profile || activeProfile),
        );
        if (getAuthScope() !== scope) return;
        const list: CronRunItem[] = Array.isArray(data?.runs) ? data.runs : Array.isArray(data) ? data : [];
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
      const data = await opsGet(
        api.cronJobRuns(selectedJobForRuns.id, selectedJobForRuns.profile || activeProfile),
      );
      if (getAuthScope() !== scope) return;
      const list: CronRunItem[] = Array.isArray(data?.runs) ? data.runs : Array.isArray(data) ? data : [];
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
          const data = await opsGet(
            api.cronRunMessages(runId, runProfile),
          );
          if (getAuthScope() !== scope) return;
          const msgs: RunMessageItem[] = Array.isArray(data?.messages) ? data.messages : [];
          setRunMessages((prev) => ({ ...prev, [cacheKey]: msgs }));
        } catch {
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
        if (getAuthScope() === scope) router.push('/chat');
      } catch (e) {
        if (getAuthScope() === scope) Alert.alert('Open Chat Failed', errMsg(e));
      }
    },
    [activeProfile, getAuthScope, openSession, router, selectedJobForRuns],
  );

  // Run Now (Trigger)
  const handleTrigger = async (job: CronJobItem) => {
    const scope = getAuthScope();
    setActionLoadingId(job.id);
    try {
      await opsMut(
        api.cronJobAction(job.id, 'trigger', job.profile || activeProfile),
        'POST',
        {},
      );
      if (getAuthScope() !== scope) return;
      notify(`Triggered "${job.name || job.id}"`);
      await loadJobs(true);
    } catch (e) {
      if (getAuthScope() === scope) Alert.alert('Trigger Failed', errMsg(e));
    } finally {
      if (getAuthScope() === scope) setActionLoadingId(null);
    }
  };

  // Pause
  const handlePause = async (job: CronJobItem) => {
    const scope = getAuthScope();
    setActionLoadingId(job.id);
    try {
      await opsMut(
        api.cronJobAction(job.id, 'pause', job.profile || activeProfile),
        'POST',
        {},
      );
      if (getAuthScope() !== scope) return;
      notify(`Paused "${job.name || job.id}"`);
      await loadJobs(true);
    } catch (e) {
      if (getAuthScope() === scope) Alert.alert('Pause Failed', errMsg(e));
    } finally {
      if (getAuthScope() === scope) setActionLoadingId(null);
    }
  };

  // Resume
  const handleResume = async (job: CronJobItem) => {
    const scope = getAuthScope();
    setActionLoadingId(job.id);
    try {
      await opsMut(
        api.cronJobAction(job.id, 'resume', job.profile || activeProfile),
        'POST',
        {},
      );
      if (getAuthScope() !== scope) return;
      notify(`Resumed "${job.name || job.id}"`);
      await loadJobs(true);
    } catch (e) {
      if (getAuthScope() === scope) Alert.alert('Resume Failed', errMsg(e));
    } finally {
      if (getAuthScope() === scope) setActionLoadingId(null);
    }
  };

  // Delete
  const handleDelete = (job: CronJobItem) => {
    Alert.alert('Delete Cron Job', `Are you sure you want to delete "${job.name || job.id}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const scope = getAuthScope();
          setActionLoadingId(job.id);
          try {
            await opsMut(
              api.cronJob(job.id, job.profile || activeProfile),
              'DELETE',
            );
            if (getAuthScope() !== scope) return;
            notify(`Deleted "${job.name || job.id}"`);
            await loadJobs(true);
          } catch (e) {
            if (getAuthScope() === scope) Alert.alert('Delete Failed', errMsg(e));
          } finally {
            if (getAuthScope() === scope) setActionLoadingId(null);
          }
        },
      },
    ]);
  };

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

    const payload = {
      name: formName.trim(),
      schedule: formSchedule.trim(),
      prompt: formPrompt.trim(),
      deliver: formDeliver.trim() || 'local',
      ...(formModel.trim() ? { model: formModel.trim() } : {}),
    };

    try {
      if (editingJob) {
        await opsMut(
          api.cronJob(editingJob.id, editingJob.profile || activeProfile),
          'PUT',
          { updates: payload },
        );
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

  if (!authed) return <Redirect href="/login" />;

  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#000' : '#fff' }}>
      {/* No 'bottom' edge: main list content already pads insets.bottom + 32. */}
      <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['left', 'right']}>
        <StatusBar style="auto" />

        {/* Header */}
        <View
          className="flex-row items-center justify-between border-b border-neutral-200 bg-white px-4 py-4 dark:border-neutral-800 dark:bg-black"
          style={{ paddingTop: insets.top + 10 }}
        >
          <View className="flex-row items-center gap-3">
            <HamburgerBtn />
            <Text className="text-xl font-bold text-neutral-950 dark:text-neutral-100">Cron Jobs</Text>
          </View>
          <Pressable
            onPress={openCreateModal}
            hitSlop={10}
            className="flex-row items-center gap-1.5 rounded-lg bg-[#1a73e8] px-3 py-1.5"
          >
            <Plus size={16} color="#fff" />
            <Text className="text-xs font-semibold text-white">New</Text>
          </Pressable>
        </View>

        {/* Status feedback toast */}
        {statusNotice && (
          <View className="mx-4 mt-2 rounded-lg bg-emerald-600 px-3 py-2">
            <Text className="text-center text-xs font-semibold text-white">{statusNotice}</Text>
          </View>
        )}

        {error && (
          <View className="m-4 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/40">
            <Text className="text-xs font-medium text-red-700 dark:text-red-300">{error}</Text>
            <Pressable onPress={() => void loadJobs()} className="mt-2 self-start rounded bg-red-600 px-2.5 py-1">
              <Text className="text-xs font-medium text-white">Retry</Text>
            </Pressable>
          </View>
        )}

        <ScrollView
          contentContainerStyle={{
            padding: 14,
            paddingBottom: insets.bottom + 32,
            gap: 12,
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadJobs(true)} />}
        >
          {loading && !refreshing && (
            <View className="items-center justify-center py-16">
              <ActivityIndicator size="large" color="#1a73e8" />
              <Text className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Loading cron jobs…</Text>
            </View>
          )}

          {!loading && jobs.length === 0 && !error && (
            <View className="items-center justify-center rounded-2xl border border-dashed border-neutral-300 p-8 dark:border-neutral-800">
              <Clock size={36} color={dark ? '#666' : '#999'} />
              <Text className="mt-3 text-base font-semibold text-neutral-800 dark:text-neutral-200">
                No Cron Jobs Yet
              </Text>
              <Text className="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
                Schedule recurring prompts or automation tasks for Hermes.
              </Text>
              <Pressable
                onPress={openCreateModal}
                className="mt-4 flex-row items-center gap-1.5 rounded-xl bg-[#1a73e8] px-4 py-2.5"
              >
                <Plus size={16} color="#fff" />
                <Text className="text-sm font-semibold text-white">Create First Job</Text>
              </Pressable>
            </View>
          )}

          {!loading &&
            jobs.map((job) => {
              const isPaused = !job.enabled || job.state === 'paused';
              const isBusy = actionLoadingId === job.id;
              const isExpanded = expandedIds.has(job.id);
              const scheduleExpr = getScheduleExpr(job);
              const isError = job.last_status === 'error' || Boolean(job.last_error);

              return (
                <View
                  key={job.id}
                  className="rounded-2xl border border-neutral-200 bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-900/60"
                >
                  {/* Header: Title + Status Badge */}
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="flex-1">
                      <Text className="text-base font-bold text-neutral-950 dark:text-neutral-100" numberOfLines={1}>
                        {job.name || job.id}
                      </Text>
                      <Text className="text-[11px] font-mono text-neutral-400 dark:text-neutral-500">ID: {job.id}</Text>
                    </View>

                    <View
                      className={`rounded-full px-2.5 py-0.5 border ${
                        isError
                          ? 'border-red-300 bg-red-100 dark:border-red-800 dark:bg-red-950/60'
                          : isPaused
                            ? 'border-amber-300 bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60'
                            : 'border-emerald-300 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60'
                      }`}
                    >
                      <Text
                        className={`text-[11px] font-semibold capitalize ${
                          isError
                            ? 'text-red-700 dark:text-red-300'
                            : isPaused
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {isError ? 'Error' : isPaused ? 'Paused' : 'Active'}
                      </Text>
                    </View>
                  </View>

                  {/* Schedule badge & next run */}
                  <View className="mt-2.5 flex-row flex-wrap items-center gap-2">
                    <View className="flex-row items-center gap-1 rounded-md bg-neutral-200/80 px-2 py-1 dark:bg-neutral-800">
                      <Clock size={12} color={dark ? '#ccc' : '#444'} />
                      <Text className="font-mono text-xs font-medium text-neutral-800 dark:text-neutral-200">
                        {scheduleExpr || '(no schedule)'}
                      </Text>
                    </View>
                    {job.next_run_at && (
                      <Text className="text-[11px] text-neutral-500 dark:text-neutral-400">
                        Next: {formatDateTime(job.next_run_at)}
                      </Text>
                    )}
                    {job.last_run_at && (
                      <Text className="text-[11px] text-neutral-400 dark:text-neutral-500">
                        Last: {formatDateTime(job.last_run_at)}
                      </Text>
                    )}
                  </View>

                  {/* Prompt Preview */}
                  {Boolean(job.prompt) && (
                    <JobPromptPreview
                      prompt={job.prompt!}
                      isExpanded={isExpanded}
                      onToggleExpand={() => toggleExpand(job.id)}
                    />
                  )}

                  {/* Last Error Banner if any */}
                  {Boolean(job.last_error) && (
                    <View className="mt-2.5 flex-row items-start gap-1.5 rounded-lg bg-red-50 p-2 dark:bg-red-950/40">
                      <AlertTriangle size={14} color="#dc2626" className="mt-0.5" />
                      <Text className="flex-1 text-[11px] text-red-700 dark:text-red-300">{job.last_error}</Text>
                    </View>
                  )}

                  {/* Action Buttons Toolbar */}
                  <View className="mt-3.5 flex-row items-center justify-between pt-2.5 border-t border-neutral-200/70 dark:border-neutral-800/70">
                    {/* Left: Runs History */}
                    <Pressable
                      onPress={() => void handleOpenRuns(job)}
                      className="flex-row items-center gap-1.5 rounded-lg border border-[#1a73e8]/30 bg-[#1a73e8]/10 px-2.5 py-1.5 active:bg-[#1a73e8]/20"
                    >
                      <History size={13} color="#1a73e8" />
                      <Text className="text-xs font-semibold text-[#1a73e8] dark:text-[#7aa7ff]">History</Text>
                    </Pressable>

                    {/* Right: Actions */}
                    <View className="flex-row items-center gap-1.5">
                      {/* Trigger / Run Now */}
                      <Pressable
                        disabled={isBusy}
                        onPress={() => void handleTrigger(job)}
                        className="flex-row items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 active:bg-neutral-200 dark:border-neutral-700 dark:active:bg-neutral-800"
                      >
                        {isBusy ? (
                          <ActivityIndicator size="small" color="#1a73e8" />
                        ) : (
                          <>
                            <Play size={12} color={dark ? '#f5f5f5' : '#111'} fill={dark ? '#f5f5f5' : '#111'} />
                            <Text className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">Run</Text>
                          </>
                        )}
                      </Pressable>

                      {/* Pause or Resume */}
                      {isPaused ? (
                        <Pressable
                          disabled={isBusy}
                          onPress={() => void handleResume(job)}
                          className="rounded-lg border border-neutral-300 p-2 active:bg-neutral-200 dark:border-neutral-700 dark:active:bg-neutral-800"
                          hitSlop={4}
                        >
                          <RotateCw size={13} color={dark ? '#f5f5f5' : '#111'} />
                        </Pressable>
                      ) : (
                        <Pressable
                          disabled={isBusy}
                          onPress={() => void handlePause(job)}
                          className="rounded-lg border border-neutral-300 p-2 active:bg-neutral-200 dark:border-neutral-700 dark:active:bg-neutral-800"
                          hitSlop={4}
                        >
                          <Pause size={13} color={dark ? '#f5f5f5' : '#111'} />
                        </Pressable>
                      )}

                      {/* Edit */}
                      <Pressable
                        disabled={isBusy}
                        onPress={() => openEditModal(job)}
                        className="rounded-lg border border-neutral-300 p-2 active:bg-neutral-200 dark:border-neutral-700 dark:active:bg-neutral-800"
                        hitSlop={4}
                      >
                        <Pencil size={13} color={dark ? '#ccc' : '#555'} />
                      </Pressable>

                      {/* Delete */}
                      <Pressable
                        disabled={isBusy}
                        onPress={() => handleDelete(job)}
                        className="rounded-lg border border-red-200 p-2 active:bg-red-50 dark:border-red-900/60 dark:active:bg-red-950/30"
                        hitSlop={4}
                      >
                        <Trash size={13} color="#dc2626" />
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })}
        </ScrollView>

        {/* Create / Edit Modal */}
        <Modal
          visible={modalOpen}
          animationType="slide"
          transparent
          onRequestClose={() => !formSaving && setModalOpen(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            className="flex-1 justify-end bg-black/50"
          >
            <View
              className="max-h-[90%] rounded-t-3xl border-t border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
              style={{ marginBottom: kbH }}
            >
              {/* Modal Header */}
              <View className="flex-row items-center justify-between pb-3 border-b border-neutral-200 dark:border-neutral-800">
                <Text className="text-lg font-bold text-neutral-950 dark:text-neutral-100">
                  {editingJob ? 'Edit Cron Job' : 'New Cron Job'}
                </Text>
                <Pressable onPress={() => !formSaving && setModalOpen(false)} hitSlop={10} className="p-1.5">
                  <X size={20} color={dark ? '#ccc' : '#444'} />
                </Pressable>
              </View>

              {/* Modal Body Form */}
              <ScrollView className="mt-3" contentContainerStyle={{ gap: 14, paddingBottom: 24 }}>
                {formError && (
                  <View className="rounded-xl bg-red-50 p-3 dark:bg-red-950/40">
                    <Text className="text-xs font-medium text-red-700 dark:text-red-300">{formError}</Text>
                  </View>
                )}

                {/* Name */}
                <View>
                  <Text className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">Job Name *</Text>
                  <TextInput
                    value={formName}
                    onChangeText={setFormName}
                    placeholder="e.g. morning-brief"
                    placeholderTextColor={dark ? '#777' : '#999'}
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-950 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                  />
                </View>

                {/* Schedule Expression */}
                <View>
                  <Text className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    Schedule (Cron Expression) *
                  </Text>
                  <TextInput
                    value={formSchedule}
                    onChangeText={setFormSchedule}
                    placeholder="e.g. 0 9 * * *"
                    placeholderTextColor={dark ? '#777' : '#999'}
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="font-mono rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-950 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                  />
                  {/* Presets Chips */}
                  <Text className="mt-2 mb-1 text-[11px] text-neutral-400">Quick presets:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-1.5">
                    {SCHEDULE_PRESETS.map((preset) => (
                      <Pressable
                        key={preset.label}
                        onPress={() => setFormSchedule(preset.expr)}
                        className={`mr-1.5 rounded-lg border px-2.5 py-1 ${
                          formSchedule === preset.expr
                            ? 'border-[#1a73e8] bg-[#1a73e8]/10'
                            : 'border-neutral-300 dark:border-neutral-700'
                        }`}
                      >
                        <Text
                          className={`text-[11px] font-medium ${
                            formSchedule === preset.expr
                              ? 'text-[#1a73e8] dark:text-[#7aa7ff]'
                              : 'text-neutral-600 dark:text-neutral-300'
                          }`}
                        >
                          {preset.label}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>

                {/* Prompt / Instructions */}
                <View>
                  <Text className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    Prompt (Task for Hermes) *
                  </Text>
                  <TextInput
                    value={formPrompt}
                    onChangeText={setFormPrompt}
                    placeholder="Describe what the agent should execute when this cron job triggers..."
                    placeholderTextColor={dark ? '#777' : '#999'}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    className="min-h-[100px] rounded-xl border border-neutral-300 p-3 text-sm text-neutral-950 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                  />
                </View>

                {/* Optional: Model override */}
                <View>
                  <Text className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    Model Override (optional)
                  </Text>
                  <TextInput
                    value={formModel}
                    onChangeText={setFormModel}
                    placeholder="e.g. nous/hermes-3-llama-3.1-8b (leave blank for default)"
                    placeholderTextColor={dark ? '#777' : '#999'}
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="rounded-xl border border-neutral-300 px-3.5 py-2.5 text-sm text-neutral-950 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                  />
                </View>

                {/* Action Buttons */}
                <View className="mt-2 flex-row gap-3">
                  <Pressable
                    disabled={formSaving}
                    onPress={() => setModalOpen(false)}
                    className="flex-1 items-center rounded-xl border border-neutral-300 py-3 dark:border-neutral-700"
                  >
                    <Text className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Cancel</Text>
                  </Pressable>

                  <Pressable
                    disabled={formSaving}
                    onPress={handleSave}
                    className="flex-1 items-center justify-center rounded-xl bg-[#1a73e8] py-3 active:bg-blue-600"
                  >
                    {formSaving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text className="text-sm font-semibold text-white">
                        {editingJob ? 'Save Changes' : 'Create Job'}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Runs History Modal */}
        <Modal visible={runsModalOpen} animationType="slide" transparent onRequestClose={() => setRunsModalOpen(false)}>
          <View className="flex-1 justify-end bg-black/60">
            <View
              style={{ maxHeight: '92%', height: '85%' }}
              className="rounded-t-3xl border-t border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900 flex-col"
            >
              {/* Header */}
              <View className="flex-row items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
                <View className="flex-1 pr-2">
                  <View className="flex-row items-center gap-2">
                    <History size={18} color="#1a73e8" />
                    <Text className="text-base font-bold text-neutral-950 dark:text-neutral-100">Run History</Text>
                  </View>
                  <Text numberOfLines={1} className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    {selectedJobForRuns?.name || selectedJobForRuns?.id}
                  </Text>
                </View>

                <View className="flex-row items-center gap-1">
                  <Pressable
                    disabled={runsLoading}
                    onPress={() => void handleRefreshRuns()}
                    hitSlop={10}
                    className="rounded-lg p-2 active:bg-neutral-100 dark:active:bg-neutral-800"
                  >
                    {runsLoading ? (
                      <ActivityIndicator size="small" color="#1a73e8" />
                    ) : (
                      <RefreshCw size={18} color={dark ? '#ccc' : '#444'} />
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => setRunsModalOpen(false)}
                    hitSlop={10}
                    className="rounded-lg p-2 active:bg-neutral-100 dark:active:bg-neutral-800"
                  >
                    <X size={20} color={dark ? '#ccc' : '#444'} />
                  </Pressable>
                </View>
              </View>

              {/* Body */}
              <ScrollView
                contentContainerStyle={{
                  padding: 16,
                  paddingBottom: insets.bottom + 30,
                  gap: 12,
                }}
              >
                {runsLoading && runsList.length === 0 && (
                  <View className="items-center justify-center py-16">
                    <ActivityIndicator size="large" color="#1a73e8" />
                    <Text className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Loading run history…</Text>
                  </View>
                )}

                {runsError && (
                  <View className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/40">
                    <Text className="text-xs font-medium text-red-700 dark:text-red-300">{runsError}</Text>
                    <Pressable
                      onPress={() => void handleRefreshRuns()}
                      className="mt-2 self-start rounded bg-red-600 px-2.5 py-1"
                    >
                      <Text className="text-xs font-medium text-white">Retry</Text>
                    </Pressable>
                  </View>
                )}

                {!runsLoading && runsList.length === 0 && !runsError && (
                  <View className="items-center justify-center rounded-2xl border border-dashed border-neutral-300 p-8 dark:border-neutral-800">
                    <Clock size={36} color={dark ? '#666' : '#999'} />
                    <Text className="mt-3 text-base font-semibold text-neutral-800 dark:text-neutral-200">
                      No Runs Recorded
                    </Text>
                    <Text className="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
                      This cron job hasn't executed yet. You can tap "Run" on the job card to trigger a run now.
                    </Text>
                  </View>
                )}

                {runsList.map((run) => {
                  const isRunActive = run.is_active || (!run.ended_at && Boolean(run.started_at));
                  const isRunFailed = run.end_reason === 'error';
                  const isRunCompleted = Boolean(run.ended_at) && !isRunFailed;
                  const duration = formatRunDuration(run.started_at, run.ended_at);
                  const isExpanded = expandedRunId === run.id;
                  const messages =
                    runMessages[scopedRunKey(run.id, run.profile || selectedJobForRuns?.profile || activeProfile)];
                  const totalTokens = (run.input_tokens || 0) + (run.output_tokens || 0);

                  return (
                    <View
                      key={run.id}
                      className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3.5 dark:border-neutral-800 dark:bg-neutral-950/50"
                    >
                      {/* Header: Status + Time + Duration */}
                      <View className="flex-row items-center justify-between gap-2">
                        <View className="flex-row items-center gap-2">
                          <View
                            className={`rounded-full px-2 py-0.5 border ${
                              isRunActive
                                ? 'border-blue-300 bg-blue-100 dark:border-blue-800 dark:bg-blue-950/60'
                                : isRunFailed
                                  ? 'border-red-300 bg-red-100 dark:border-red-800 dark:bg-red-950/60'
                                  : isRunCompleted
                                    ? 'border-emerald-300 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60'
                                    : 'border-neutral-300 bg-neutral-200 dark:border-neutral-700 dark:bg-neutral-800'
                            }`}
                          >
                            <Text
                              className={`text-[10px] font-bold uppercase tracking-wider ${
                                isRunActive
                                  ? 'text-blue-700 dark:text-blue-300'
                                  : isRunFailed
                                    ? 'text-red-700 dark:text-red-300'
                                    : isRunCompleted
                                      ? 'text-emerald-700 dark:text-emerald-300'
                                      : run.end_reason || 'Finished'
                              }
                            `}
                            >
                              {isRunActive
                                ? 'Running'
                                : isRunFailed
                                  ? 'Failed'
                                  : isRunCompleted
                                    ? 'Success'
                                    : run.end_reason || 'Finished'}
                            </Text>
                          </View>

                          {duration && (
                            <Text className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
                              ⏱ {duration}
                            </Text>
                          )}
                        </View>

                        <Text className="text-[11px] text-neutral-400 dark:text-neutral-500">
                          {formatRunTime(run.started_at)}
                        </Text>
                      </View>

                      {/* Title / Preview */}
                      <View className="mt-2">
                        <Text
                          className="text-xs font-medium text-neutral-800 dark:text-neutral-200"
                          numberOfLines={isExpanded ? undefined : 2}
                        >
                          {run.title || run.preview || '(No preview available)'}
                        </Text>
                        <Text className="mt-0.5 text-[10px] font-mono text-neutral-400 dark:text-neutral-500">
                          {run.id}
                        </Text>
                      </View>

                      {/* Metrics row */}
                      <View className="mt-2.5 flex-row flex-wrap items-center gap-2">
                        <View className="flex-row items-center gap-1 rounded bg-neutral-200/60 px-2 py-0.5 dark:bg-neutral-800">
                          <MessageSquare size={11} color={dark ? '#aaa' : '#666'} />
                          <Text className="text-[11px] text-neutral-700 dark:text-neutral-300">
                            {run.message_count ?? 0} msgs
                          </Text>
                        </View>

                        {Boolean(run.tool_call_count) && (
                          <View className="flex-row items-center gap-1 rounded bg-neutral-200/60 px-2 py-0.5 dark:bg-neutral-800">
                            <Wrench size={11} color={dark ? '#aaa' : '#666'} />
                            <Text className="text-[11px] text-neutral-700 dark:text-neutral-300">
                              {run.tool_call_count} tools
                            </Text>
                          </View>
                        )}

                        {totalTokens > 0 && (
                          <View className="flex-row items-center gap-1 rounded bg-neutral-200/60 px-2 py-0.5 dark:bg-neutral-800">
                            <Text className="text-[11px] font-mono text-neutral-700 dark:text-neutral-300">
                              {compactNumber(totalTokens)} tok
                            </Text>
                          </View>
                        )}

                        {Number(run.estimated_cost_usd) > 0 && (
                          <View className="rounded bg-emerald-100/80 px-2 py-0.5 dark:bg-emerald-950/50">
                            <Text className="text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
                              ${Number(run.estimated_cost_usd).toFixed(4)}
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* Action buttons: View Messages / Open in Chat */}
                      <View className="mt-3 flex-row items-center justify-between pt-2 border-t border-neutral-200/60 dark:border-neutral-800/60">
                        <Pressable
                          onPress={() => void toggleExpandRun(run.id)}
                          hitSlop={5}
                          className="flex-row items-center gap-1 py-1"
                        >
                          <Text className="text-xs font-semibold text-[#1a73e8] dark:text-[#7aa7ff]">
                            {isExpanded ? 'Hide Messages' : 'View Messages'}
                          </Text>
                          {isExpanded ? (
                            <ChevronUp size={14} color="#1a73e8" />
                          ) : (
                            <ChevronDown size={14} color="#1a73e8" />
                          )}
                        </Pressable>

                        <Pressable
                          onPress={() => void handleOpenInChat(run)}
                          hitSlop={5}
                          className="flex-row items-center gap-1 rounded-lg bg-neutral-200/70 px-2.5 py-1 active:bg-neutral-300 dark:bg-neutral-800 dark:active:bg-neutral-700"
                        >
                          <ExternalLink size={12} color={dark ? '#ddd' : '#333'} />
                          <Text className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
                            Open in Chat
                          </Text>
                        </Pressable>
                      </View>

                      {/* Expanded Transcript Preview */}
                      {isExpanded && (
                        <View className="mt-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-black/60">
                          {runMessagesLoading && !messages && (
                            <View className="items-center justify-center py-6">
                              <ActivityIndicator size="small" color="#1a73e8" />
                              <Text className="mt-2 text-xs text-neutral-400">Loading transcript…</Text>
                            </View>
                          )}

                          {messages && messages.length === 0 && (
                            <Text className="text-center text-xs text-neutral-400 py-4">
                              No messages found for this run session.
                            </Text>
                          )}

                          {messages && messages.length > 0 && (
                            <View className="gap-2.5">
                              {messages.map((m, idx) => {
                                const isUser = m.role === 'user';
                                const isTool = m.role === 'tool';
                                const contentText = parseMessageContent(m.display_content || m.content);
                                const reasoningText = m.reasoning_content || m.reasoning;

                                return (
                                  <View
                                    key={m.id ? String(m.id) : `msg-${idx}`}
                                    className={`rounded-lg p-2.5 ${
                                      isUser
                                        ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40'
                                        : isTool
                                          ? 'bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800'
                                          : 'bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200/70 dark:border-neutral-800'
                                    }`}
                                  >
                                    <View className="flex-row items-center justify-between mb-1">
                                      <View className="flex-row items-center gap-1.5">
                                        {isUser ? (
                                          <User size={12} color="#1a73e8" />
                                        ) : isTool ? (
                                          <Wrench size={12} color="#8b5cf6" />
                                        ) : (
                                          <Bot size={12} color="#10b981" />
                                        )}
                                        <Text
                                          className={`text-[10px] font-bold uppercase tracking-wider ${
                                            isUser
                                              ? 'text-blue-700 dark:text-blue-400'
                                              : isTool
                                                ? 'text-purple-700 dark:text-purple-400'
                                                : 'text-emerald-700 dark:text-emerald-400'
                                          }`}
                                        >
                                          {isUser
                                            ? 'User / Trigger'
                                            : isTool
                                              ? `Tool: ${m.tool_name || m.name || 'call'}`
                                              : 'Hermes'}
                                        </Text>
                                      </View>
                                    </View>

                                    {Boolean(reasoningText) && (
                                      <View className="mb-1.5 rounded bg-neutral-200/60 p-1.5 dark:bg-neutral-800">
                                        <Text className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 mb-0.5">
                                          Thinking / Reasoning:
                                        </Text>
                                        <Text
                                          numberOfLines={4}
                                          className="text-[11px] italic text-neutral-600 dark:text-neutral-300 font-mono"
                                        >
                                          {reasoningText}
                                        </Text>
                                      </View>
                                    )}

                                    {Boolean(contentText) && (
                                      <Text
                                        selectable
                                        className={`text-xs leading-relaxed text-neutral-800 dark:text-neutral-200 ${
                                          isTool ? 'font-mono text-[11px]' : ''
                                        }`}
                                      >
                                        {contentText}
                                      </Text>
                                    )}
                                  </View>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}
