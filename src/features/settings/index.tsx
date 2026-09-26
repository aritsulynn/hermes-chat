import { useCallback } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Redirect } from 'expo-router';
import {
  Check,
  CircleUserRound,
  Globe,
  Info,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Server,
  Shield,
  Sun,
  User,
} from 'lucide-react-native';
import { useApp } from '../../hooks/app-store';
import { HamburgerBtn } from '../../components/ui/bits';
import { Switch } from '../../components/ui/switch';
import { Separator } from '../../components/ui/separator';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { Text as UIText } from '../../components/ui/text';
import { UpdatePanel } from '../../components/ui/update-panel';
import { notificationsSupported } from '../../services/notifications';
import { BUILD_ID } from '../../build';
import * as Clipboard from 'expo-clipboard';
export function SettingsScreen() {
  const { authed, username, host, conn, activeProfile, theme, themeMode, setTheme, logout, sessionInfo, applyApprovalMode, diagnostics, notificationsEnabled, setNotifications } = useApp();
  const dark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const isReady = conn === 'ready';
  const isConnecting = conn === 'connecting' || conn === 'reconnecting';
  const diag = diagnostics() as any;
  const approvalMode = typeof sessionInfo?.approval_mode === 'string' ? sessionInfo.approval_mode : '';
  const mcpServers: any[] = Array.isArray(sessionInfo?.mcp_servers) ? sessionInfo.mcp_servers : [];
  const APPROVALS: { value: 'manual' | 'smart' | 'off'; label: string; hint: string }[] = [
    { value: 'manual', label: 'Manual', hint: 'Ask before every dangerous command' },
    { value: 'smart', label: 'Smart', hint: 'Model decides when to ask' },
    { value: 'off', label: 'Off (YOLO)', hint: 'Never ask — run everything' },
  ];

  const handleLogout = useCallback(() => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out of Hermes?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: () => {
            void logout();
          },
        },
      ],
      { cancelable: true }
    );
  }, [logout]);

  if (!authed) return <Redirect href="/login" />;

  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#000' : '#fff' }}>
    {/* No 'bottom' edge: the only bottom padding lives in the ScrollView
        content (insets.bottom + 24). Keeping 'bottom' doubles the gap
        above the gesture bar on edge-to-edge Android. */}
    <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['left', 'right']}>
      <StatusBar style="auto" />

      {/* Header */}
      <View
        className="flex-row items-center justify-between border-b border-neutral-200 bg-white px-4 py-4 dark:border-neutral-800 dark:bg-black"
        style={{ paddingTop: insets.top + 10 }}
      >
        <View className="flex-row items-center gap-3">
          <HamburgerBtn />
          <Text className="text-xl font-bold text-neutral-950 dark:text-neutral-100">
            Settings
          </Text>
        </View>
      </View>

      <ScrollView
        className="flex-1 px-4 py-4"
        nestedScrollEnabled
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        {/* Appearance Section */}
        <View className="mb-6">
          <View className="flex-row items-center gap-2 mb-2">
            <Palette size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
            <Text className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Appearance
            </Text>
          </View>
          <View className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
            <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
              Theme Mode
            </Text>
            <Text className="text-xs text-neutral-500 dark:text-neutral-400 mb-3.5">
              Follow your device or choose a fixed theme
            </Text>

            <View className="flex-row gap-2">
              {/* Light Theme Card */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Light theme"
                accessibilityState={{ selected: themeMode === 'light' }}
                onPress={() => setTheme('light')}
                className={`flex-1 items-center justify-center rounded-xl border p-3.5 ${
                  themeMode === 'light'
                    ? 'border-amber-500 bg-amber-50 dark:bg-neutral-950'
                    : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950'
                }`}
              >
                <View className="flex-row items-center justify-center h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-950/60 mb-2">
                  <Sun size={18} color="#d97706" />
                </View>
                <Text
                  className={`text-sm font-semibold ${
                    themeMode === 'light' ? 'text-amber-700 font-bold dark:text-amber-300' : 'text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  Light
                </Text>
                {themeMode === 'light' && (
                  <View className="mt-1.5 flex-row items-center gap-1">
                    <Check size={12} color="#b45309" />
                    <Text className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Active</Text>
                  </View>
                )}
              </Pressable>

              {/* Dark Theme Card */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dark theme"
                accessibilityState={{ selected: themeMode === 'dark' }}
                onPress={() => setTheme('dark')}
                className={`flex-1 items-center justify-center rounded-xl border p-3.5 ${
                  themeMode === 'dark'
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50'
                    : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950'
                }`}
              >
                <View className="flex-row items-center justify-center h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-950/60 mb-2">
                  <Moon size={18} color="#6366f1" />
                </View>
                <Text
                  className={`text-sm font-semibold ${
                    themeMode === 'dark' ? 'text-indigo-700 font-bold dark:text-indigo-300' : 'text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  Dark
                </Text>
                {themeMode === 'dark' && (
                  <View className="mt-1.5 flex-row items-center gap-1">
                    <Check size={12} color="#a5b4fc" />
                    <Text className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">Active</Text>
                  </View>
                )}
              </Pressable>

              {/* Follow the device appearance. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="System theme"
                accessibilityState={{ selected: themeMode === 'system' }}
                onPress={() => setTheme('system')}
                className={`flex-1 items-center justify-center rounded-xl border p-3.5 ${
                  themeMode === 'system'
                    ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/50'
                    : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950'
                }`}
              >
                <View className="mb-2 h-8 w-8 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-950/60">
                  <Monitor size={18} color={dark ? '#38bdf8' : '#0284c7'} />
                </View>
                <Text
                  className={`text-sm font-semibold ${
                    themeMode === 'system'
                      ? 'font-bold text-sky-700 dark:text-sky-300'
                      : 'text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  System
                </Text>
                {themeMode === 'system' && (
                  <View className="mt-1.5 flex-row items-center gap-1">
                    <Check size={12} color={dark ? '#7dd3fc' : '#0369a1'} />
                    <Text className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">Active</Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>
        </View>

        {/* Account & Server Section */}
        <View className="mb-6">
          <View className="flex-row items-center gap-2 mb-2">
            <User size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
            <Text className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Account & Server
            </Text>
          </View>
          <View className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
            {/* User row */}
            <View className="flex-row items-center justify-between py-2 border-b border-neutral-200 dark:border-neutral-800">
              <View className="flex-row items-center gap-2.5">
                <Avatar alt={username || 'Profile'} className="bg-[#1a73e8]">
                  <AvatarFallback className="bg-[#1a73e8]">
                    <UIText className="text-sm font-bold text-white">
                      {(username || 'H').slice(0, 1).toUpperCase()}
                    </UIText>
                  </AvatarFallback>
                </Avatar>
                <View>
                  <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {username || 'Hermes User'}
                  </Text>
                  <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                    Account
                  </Text>
                </View>
              </View>
            </View>

            {/* Active agent profile — switch from the Drawer. */}
            <View className="flex-row items-center justify-between border-b border-neutral-200 py-2.5 dark:border-neutral-800">
              <View className="flex-row items-center gap-2">
                <CircleUserRound size={15} color={dark ? '#aaa' : '#666'} />
                <Text className="text-xs text-neutral-600 dark:text-neutral-300">Agent Profile</Text>
              </View>
              <Text className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{activeProfile}</Text>
            </View>

            {/* Host row */}
            <View className="flex-row items-center justify-between py-2.5 border-b border-neutral-200 dark:border-neutral-800">
              <View className="flex-row items-center gap-2">
                <Server size={15} color={dark ? '#aaa' : '#666'} />
                <Text className="text-xs text-neutral-600 dark:text-neutral-300">Server Host</Text>
              </View>
              <Text className="text-xs font-mono font-medium text-neutral-900 dark:text-neutral-100">
                {host || 'Not connected'}
              </Text>
            </View>

            {/* Gateway status row */}
            <View className="flex-row items-center justify-between py-2.5">
              <View className="flex-row items-center gap-2">
                <Globe size={15} color={dark ? '#aaa' : '#666'} />
                <Text className="text-xs text-neutral-600 dark:text-neutral-300">Gateway Status</Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <View
                  className={`h-2 w-2 rounded-full ${
                    isReady ? 'bg-emerald-500' : isConnecting ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                />
                <Text
                  className={`text-xs font-medium ${
                    isReady
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : isConnecting
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-500'
                  }`}
                >
                  {isReady ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Agent / runtime Section */}
        <View className="mb-6">
          <View className="flex-row items-center gap-2 mb-2">
            <Shield size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
            <Text className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Agent
            </Text>
          </View>
          <View className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
            <Text className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Dangerous-command approvals
            </Text>
            <Text className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
              How the agent handles shell commands flagged as risky
            </Text>
            <View className="gap-2">
              {APPROVALS.map((a) => {
                const on = approvalMode === a.value;
                return (
                  <Pressable
                    key={a.value}
                    testID={`approval-${a.value}`}
                    onPress={() => void applyApprovalMode(a.value)}
                    className={`flex-row items-center gap-2.5 rounded-xl border px-3 py-2.5 ${
                      on
                        ? 'border-[#1a73e8] bg-blue-50/70 dark:bg-blue-950/40'
                        : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950'
                    }`}
                  >
                    <View className="min-w-0 flex-1">
                      <Text
                        className={`text-sm font-semibold ${
                          on ? 'text-[#1a73e8] dark:text-[#7aa7ff]' : 'text-neutral-800 dark:text-neutral-200'
                        }`}
                      >
                        {a.label}
                      </Text>
                      <Text className="text-[11px] text-neutral-500 dark:text-neutral-400">{a.hint}</Text>
                    </View>
                    {on && <Check size={15} color={dark ? '#7aa7ff' : '#1a73e8'} />}
                  </Pressable>
                );
              })}
            </View>

            <Separator className="my-3 bg-neutral-200 dark:bg-neutral-800" />
            {[
              ['Profile', typeof sessionInfo?.profile_name === 'string' ? sessionInfo.profile_name : ''],
              ['Model', typeof sessionInfo?.model === 'string' ? sessionInfo.model : ''],
              ['Provider', typeof sessionInfo?.provider === 'string' ? sessionInfo.provider : ''],
              ['Working dir', typeof sessionInfo?.cwd === 'string' ? sessionInfo.cwd : ''],
            ].map(([label, value]) =>
              value ? (
                <View key={label} className="flex-row items-center justify-between gap-3 py-1">
                  <Text className="text-xs text-neutral-600 dark:text-neutral-300">{label}</Text>
                  <Text
                    className="shrink text-xs font-mono font-medium text-neutral-900 dark:text-neutral-100"
                    numberOfLines={1}
                  >
                    {value}
                  </Text>
                </View>
              ) : null,
            )}

            {mcpServers.length > 0 && (
              <>
                <Separator className="my-2 bg-neutral-200 dark:bg-neutral-800" />
                <Text className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  MCP servers
                </Text>
                {mcpServers.map((s, i) => (
                  <View key={`${s?.name ?? i}`} className="flex-row items-center justify-between py-1">
                    <Text className="text-xs text-neutral-600 dark:text-neutral-300" numberOfLines={1}>
                      {String(s?.name ?? 'server')}
                    </Text>
                    <Text className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      {String(s?.status ?? '')}
                      {typeof s?.tool_count === 'number' ? ` · ${s.tool_count} tools` : ''}
                    </Text>
                  </View>
                ))}
              </>
            )}
          </View>
        </View>

        {/* Notifications Section */}
        <View className="mb-6">
          <View className="flex-row items-center gap-2 mb-2">
            <Info size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
            <Text className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Notifications
            </Text>
          </View>
          <View className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
            <View className="flex-row items-center gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  Background alerts
                </Text>
                <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  Notify when a turn finishes or the agent needs input (approval, clarify), while the
                  app is in the background.
                  {!notificationsSupported() && ' Requires a development build — not available in Expo Go.'}
                </Text>
              </View>
              <Switch
                accessibilityLabel="Background notifications"
                checked={notificationsEnabled}
                onCheckedChange={(v) => void setNotifications(v)}
              />
            </View>
          </View>
        </View>

        {/* About / System Info */}
        <View className="mb-6">
          <View className="flex-row items-center gap-2 mb-2">
            <Info size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
            <Text className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              About
            </Text>
          </View>
          <View className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
            <View className="flex-row items-center justify-between py-1 border-b border-neutral-200 dark:border-neutral-800">
              <Text className="text-xs text-neutral-600 dark:text-neutral-300">Client</Text>
              <Text className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                Hermes Mobile
              </Text>
            </View>
            <View className="flex-row items-center justify-between py-2">
              <Text className="text-xs text-neutral-600 dark:text-neutral-300">Build ID</Text>
              <Text className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                {BUILD_ID}
              </Text>
            </View>
            <View className="flex-row items-center justify-between py-1 border-t border-neutral-200 dark:border-neutral-800">
              <Text className="text-xs text-neutral-600 dark:text-neutral-300">Last event</Text>
              <Text className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                {String(diag?.ws?.lastEvent ?? '—')}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy diagnostics"
              onPress={() =>
                void Clipboard.setStringAsync(JSON.stringify(diag, null, 2)).catch(() => {})
              }
              className="mt-2 items-center rounded-xl border border-neutral-300 py-2.5 active:bg-neutral-100 dark:border-neutral-700 dark:active:bg-neutral-800"
            >
              <Text className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">
                Copy diagnostics
              </Text>
            </Pressable>
          </View>

          {/* Server update: check / apply / live log stream. */}
          <View className="mt-3">
            <UpdatePanel />
          </View>
        </View>

        {/* Log Out Action Button */}
        <Pressable
          onPress={handleLogout}
          className="flex-row items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50/60 py-3.5 active:bg-red-100/80 dark:border-red-950 dark:bg-red-950/30 dark:active:bg-red-950/50"
        >
          <LogOut size={16} color="#dc2626" />
          <Text className="text-sm font-semibold text-red-600 dark:text-red-400">
            Log Out
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
    </View>
  );
}
