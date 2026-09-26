// Skills route — agent skill inventory ported from Hermes Desktop's
// Capabilities pane (`apps/desktop/src/api/skills.ts` + `store/agent-plugins.ts`).
// Same backend REST contract over the mobile app's authed ops helpers.
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Redirect } from 'expo-router';
import { AlertCircle, RefreshCw, X } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useApp } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { HamburgerBtn } from '../../components/ui/bits';
import { Switch } from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { Alert as UIAlert, AlertDescription } from '../../components/ui/alert';
import { Text as UIText } from '../../components/ui/text';
import { getSkillContent, getSkills, setSkillEnabled } from '../../services/skills';
import type { SkillInfo } from '../../services/skills';

export function SkillsScreen() {
  const { authed, opsGet, opsMut, theme, getAuthScope } = useApp();
  const dark = theme === 'dark';
  const insets = useSafeAreaInsets();

  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);

  useEffect(() => {
    if (authed) return;
    setSkills(null);
    setViewing(null);
    setContent('');
    setError(null);
  }, [authed]);

  const load = useCallback(
    async (isRefresh = false) => {
      const scope = getAuthScope();
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const next = await getSkills(opsGet);
        if (getAuthScope() !== scope) return;
        setSkills(next);
        setUnsupported(false);
      } catch (e) {
        if (getAuthScope() !== scope) return;
        const msg = errMsg(e);
        if (/HTTP 404/.test(msg)) {
          setUnsupported(true);
          setSkills([]);
        } else {
          setError(msg);
        }
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
    if (authed) void load();
  }, [authed, load]);

  const toggle = useCallback(
    async (name: string, enabled: boolean) => {
      const scope = getAuthScope();
      setToggling(name);
      setSkills((prev) => (prev ?? []).map((s) => (s.name === name ? { ...s, enabled } : s)));
      try {
        await setSkillEnabled(opsMut, name, enabled);
        if (getAuthScope() !== scope) return;
      } catch (e) {
        if (getAuthScope() !== scope) return;
        setSkills((prev) => (prev ?? []).map((s) => (s.name === name ? { ...s, enabled: !enabled } : s)));
        Alert.alert('Toggle failed', errMsg(e));
      } finally {
        if (getAuthScope() === scope) setToggling(null);
      }
    },
    [getAuthScope, opsMut],
  );

  const openContent = useCallback(
    async (name: string) => {
      const scope = getAuthScope();
      setViewing(name);
      setContent('');
      setContentLoading(true);
      try {
        const res = await getSkillContent(opsGet, name);
        if (getAuthScope() === scope) setContent(res.content || '(empty)');
      } catch (e) {
        if (getAuthScope() === scope) setContent(`Couldn't load SKILL.md: ${errMsg(e)}`);
      } finally {
        if (getAuthScope() === scope) setContentLoading(false);
      }
    },
    [getAuthScope, opsGet],
  );

  if (!authed) return <Redirect href="/login" />;

  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#000' : '#fff' }}>
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
              <Text className="text-xl font-bold text-neutral-950 dark:text-neutral-100">Skills</Text>
              <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                {loading ? 'Loading...' : `${skills?.length ?? 0} installed`}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => void load(true)}
            hitSlop={8}
            className="rounded-lg p-2 active:bg-neutral-100 dark:active:bg-neutral-800"
          >
            <RefreshCw size={18} color={dark ? '#e5e5e5' : '#333'} className={refreshing ? 'animate-spin' : ''} />
          </Pressable>
        </View>

        <ScrollView
          className="flex-1 px-4 py-4"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
        >
          {loading && !refreshing ? (
            <View className="items-center py-16">
              <ActivityIndicator size="large" color="#1a73e8" />
            </View>
          ) : unsupported ? (
            <View className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
              <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                Skills aren&apos;t available on this backend — run skills from the chat with /name instead.
              </Text>
            </View>
          ) : error ? (
            <UIAlert icon={AlertCircle} variant="destructive">
              <AlertDescription className="text-xs text-red-600 dark:text-red-400">{error}</AlertDescription>
              <Button
                variant="destructive"
                size="sm"
                onPress={() => void load()}
                className="ml-6 mt-1 self-start"
              >
                <UIText className="text-xs font-semibold">Retry</UIText>
              </Button>
            </UIAlert>
          ) : !skills?.length ? (
            <View className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
              <Text className="text-xs text-neutral-500 dark:text-neutral-400">No skills installed.</Text>
            </View>
          ) : (
            <View className="gap-2">
              {skills.map((s) => {
                const name = String(s.name ?? '(unnamed)');
                const enabled = s.enabled !== false;
                const canToggle = typeof s.enabled === 'boolean';
                return (
                  <View
                    key={name}
                    className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60"
                  >
                    <View className="flex-row items-center gap-2">
                      <Pressable className="min-w-0 flex-1" onPress={() => void openContent(name)}>
                        <Text
                          className="text-sm font-semibold text-neutral-900 dark:text-neutral-100"
                          numberOfLines={1}
                        >
                          {name}
                        </Text>
                        {!!s.description && (
                          <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={2}>
                            {String(s.description)}
                          </Text>
                        )}
                        <Text className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                          {[s.origin ? String(s.origin) : '', typeof s.usage === 'number' ? `${s.usage} uses` : '']
                            .filter(Boolean)
                            .join(' · ') || 'Tap to view SKILL.md'}
                        </Text>
                      </Pressable>
                      {canToggle &&
                        (toggling === name ? (
                          <ActivityIndicator size="small" color="#1a73e8" />
                        ) : (
                          <Switch checked={enabled} onCheckedChange={(v) => void toggle(name, v)} />
                        ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* SKILL.md viewer */}
        <Modal
          visible={viewing !== null}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setViewing(null)}
        >
          <View className="flex-1 bg-white dark:bg-neutral-950" style={{ paddingTop: 48 }}>
            <View className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <Text className="flex-1 font-mono text-sm font-bold text-neutral-900 dark:text-white" numberOfLines={1}>
                {viewing ?? ''}
              </Text>
              <Pressable onPress={() => void Clipboard.setStringAsync(content).catch(() => {})} className="px-2 py-1.5">
                <Text className="text-xs font-semibold text-[#1a73e8] dark:text-[#7aa7ff]">Copy</Text>
              </Pressable>
              <Pressable onPress={() => setViewing(null)} hitSlop={8} className="p-1.5">
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Pressable>
            </View>
            <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
              {contentLoading ? (
                <ActivityIndicator size="small" color="#1a73e8" />
              ) : (
                <Text selectable className="font-mono text-xs leading-5 text-neutral-900 dark:text-neutral-100">
                  {content}
                </Text>
              )}
            </ScrollView>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}
