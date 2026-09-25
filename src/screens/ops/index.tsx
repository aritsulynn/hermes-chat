// Ops route — parity with the dashboard web UI:
// cron jobs, kanban boards/tasks, log viewer, usage analytics, file browser.
// All best-effort REST over the session cookie (see src/dashboard.ts opsGet/opsMut).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Redirect, useNavigation } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { HamburgerBtn } from '../../components';
import * as api from '../../lib/api';

export type OpsTab = 'cron' | 'kanban' | 'logs' | 'usage' | 'files';

const TABS: OpsTab[] = ['cron', 'kanban', 'logs', 'usage', 'files'];

export function OpsScreen({
  tab: fixedTab,
  initialTab,
  hideTabs = false,
}: {
  tab?: OpsTab;
  initialTab?: string;
  hideTabs?: boolean;
} = {}) {
  const { booting, authed, activeProfile, opsGet, opsMut, theme, getAuthScope } = useApp();
  const dark = theme === 'dark';
  const navigation = useNavigation();

  const [tab, setTab] = useState<OpsTab>(() => {
    if (fixedTab) return fixedTab;
    if (initialTab && (TABS as readonly string[]).includes(initialTab)) return initialTab as OpsTab;
    return 'cron';
  });

  useEffect(() => {
    if (fixedTab) {
      setTab(fixedTab);
    } else if (initialTab && (TABS as readonly string[]).includes(initialTab)) {
      setTab(initialTab as OpsTab);
    }
  }, [fixedTab, initialTab]);

  useEffect(() => {
    const titles: Record<OpsTab, string> = {
      cron: 'Cron Jobs',
      kanban: 'Kanban',
      logs: 'Logs',
      usage: 'Usage',
      files: 'Files',
    };
    (navigation as any).setOptions?.({
      headerLeft: () => <HamburgerBtn />,
      headerTintColor: dark ? '#f5f5f5' : '#111',
      title: titles[tab] || 'Ops',
    });
  }, [navigation, dark, tab]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  // Log filters + file browser path.
  const [logFile, setLogFile] = useState('agent');
  const [logLevel, setLogLevel] = useState('INFO');
  const [logLines, setLogLines] = useState('200');
  const [filePath, setFilePath] = useState('/');
  useEffect(() => {
    if (authed) return;
    setData(null);
    setError(null);
    setLoading(false);
  }, [authed]);

  const load = useCallback(async () => {
    const scope = getAuthScope();
    setLoading(true);
    setError(null);
    const applyData = (value: any) => {
      if (getAuthScope() === scope) setData(value);
    };
    try {
      if (tab === 'cron') applyData(await opsGet(api.cronJobs()));
      else if (tab === 'kanban') {
        try {
          applyData(await opsGet(api.kanbanBoardsWithArchived()));
        } catch {
          applyData(await opsGet(api.kanbanBoard()));
        }
      } else if (tab === 'logs') {
        applyData(
          await opsGet(
            api.logs({ file: logFile, lines: logLines, level: logLevel || undefined }),
          ),
        );
      } else if (tab === 'usage') {
        try {
          applyData(await opsGet(api.usageLast7Days()));
        } catch {
          applyData(await opsGet(api.portal()));
        }
      } else {
        applyData(await opsGet(api.files(filePath)));
      }
    } catch (e) {
      if (getAuthScope() === scope) {
        setError(errMsg(e));
        setData(null);
      }
    } finally {
      if (getAuthScope() === scope) setLoading(false);
    }
  }, [getAuthScope, tab, opsGet, logFile, logLevel, logLines, filePath]);

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  if (booting) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-black items-center justify-center gap-3">
        <StatusBar style="auto" />
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }
  if (!authed) return <Redirect href="/login" />;

  const cronJobs: any[] = Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data) ? data : [];
  // JSON dump is expensive on large boards — stringify once per data change, not per render.
  const dataDump = useMemo(() => {
    if (tab === 'cron' || data === null) return '';
    try {
      return (typeof data === 'string' ? data : JSON.stringify(data, null, 2)).slice(0, 8000);
    } catch {
      return '';
    }
  }, [tab, data]);

  const profileForJob = (id: string) => {
    const job = cronJobs.find((item) => String(item?.id ?? '') === id);
    return String(job?.profile ?? activeProfile);
  };
  const withJobProfile = (path: string, id: string) => api.withProfile(path, profileForJob(id));

  const cronAction = async (id: string, action: api.CronJobAction) => {
    const scope = getAuthScope();
    try {
      await opsMut(api.cronJobAction(id, action, profileForJob(id)), 'POST', {});
      if (getAuthScope() === scope) void load();
    } catch (e) {
      if (getAuthScope() === scope) setError(errMsg(e));
    }
  };
  const cronDelete = async (id: string) => {
    const scope = getAuthScope();
    try {
      await opsMut(withJobProfile(api.cronJob(id), id), 'DELETE');
      if (getAuthScope() === scope) void load();
    } catch (e) {
      if (getAuthScope() === scope) setError(errMsg(e));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#000' : '#fff' }}>
    <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['left', 'right', 'bottom']}>
      <StatusBar style="auto" />
      {!hideTabs && (
        <View className="flex-row gap-1.5 p-3 pb-1">
          {TABS.map((t) => (
            <Pressable
              key={t}
              onPress={() => {
                setTab(t);
                (navigation as any).setParams?.({ tab: t });
              }}
              className={`flex-1 items-center rounded-[10px] border border-neutral-300 dark:border-neutral-700 py-2.5 ${t === tab ? 'border-[#1a73e8] bg-[#1a73e8]' : ''}`}
            >
              <Text className={`text-[13px] font-semibold text-neutral-700 dark:text-neutral-200 ${t === tab ? 'text-white' : ''}`}>{t}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {tab === 'logs' && (
        <View className="px-3 gap-2">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {['agent', 'errors', 'gateway'].map((f) => (
              <Pressable
                key={f}
                onPress={() => setLogFile(f)}
                className={`rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 ${logFile === f ? 'border-[#1a73e8] bg-[#1a73e8]' : 'bg-white dark:bg-neutral-900'}`}
              >
                <Text className={`text-xs font-semibold ${logFile === f ? 'text-white' : 'text-neutral-700 dark:text-neutral-300'}`}>{f}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {['ALL', 'INFO', 'WARNING', 'ERROR'].map((l) => (
              <Pressable
                key={l}
                onPress={() => setLogLevel(l)}
                className={`rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1 ${logLevel === l ? 'border-[#1a73e8] bg-[#1a73e8]/15' : 'bg-white dark:bg-neutral-900'}`}
              >
                <Text className={`text-xs font-medium ${logLevel === l ? 'text-[#1a73e8] dark:text-[#7aa7ff]' : 'text-neutral-600 dark:text-neutral-400'}`}>{l}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      {tab === 'files' && (
        <View className="flex-row items-center gap-1.5 px-3">
          <TextInput
            className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm text-neutral-950 dark:text-neutral-100"
            value={filePath}
            onChangeText={setFilePath}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="/path"
            placeholderTextColor={dark ? '#888' : '#9ca3af'}
            keyboardAppearance={dark ? 'dark' : 'light'}
            onSubmitEditing={() => void load()}
          />
          <Pressable onPress={() => void load()} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5">
            <Text className="dark:text-neutral-100">Go</Text>
          </Pressable>
        </View>
      )}
      {error && <Text className="mt-2.5 p-3.5 text-[#c5221f] dark:text-[#ff7b72]">{error}</Text>}
      <ScrollView
        contentContainerStyle={{ padding: 12, gap: 8 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
      >
        {loading && <ActivityIndicator />}
        {tab === 'cron' && !loading && (
          <>
            {cronJobs.length === 0 && <Text className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">no cron jobs</Text>}
            {cronJobs.map((j: any) => {
              const id = String(j?.id ?? j?.name ?? Math.random());
              return (
                <View key={id} className="rounded-xl border border-[#e3e3e6] dark:border-neutral-800 p-3">
                  <Text className="text-[15px] font-semibold text-neutral-950 dark:text-neutral-100" numberOfLines={1}>
                    {String(j?.name ?? j?.id ?? '(job)')}
                  </Text>
                  <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={2}>
                    {String(j?.schedule ?? j?.state ?? '')} · {String(j?.prompt ?? '').slice(0, 120)}
                  </Text>
                  <View className="mt-2 flex-row gap-1.5">
                    <Pressable onPress={() => void cronAction(id, 'trigger')} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5">
                      <Text className="dark:text-neutral-100">Run</Text>
                    </Pressable>
                    <Pressable onPress={() => void cronAction(id, 'pause')} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5">
                      <Text className="dark:text-neutral-100">Pause</Text>
                    </Pressable>
                    <Pressable onPress={() => void cronAction(id, 'resume')} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5">
                      <Text className="dark:text-neutral-100">Resume</Text>
                    </Pressable>
                    <Pressable onPress={() => void cronDelete(id)} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5">
                      <Text className="text-[#c5221f] dark:text-[#ff7b72]">Delete</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </>
        )}
        {tab !== 'cron' && data !== null && !loading && (
          <Text selectable className="rounded-lg bg-[#f4f4f6] dark:bg-[#212121] p-2 font-mono text-[13px] text-neutral-950 dark:text-neutral-100">
            {dataDump}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
    </View>
  );
}
