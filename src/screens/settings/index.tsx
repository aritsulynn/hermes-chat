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
import {
  Check,
  Globe,
  Info,
  LogOut,
  Moon,
  Palette,
  Server,
  Shield,
  Sun,
  User,
} from 'lucide-react-native';
import { useApp } from '../../hooks/app-store';
import { HamburgerBtn } from '../../components';
import { BUILD_ID } from '../../build';

export function SettingsScreen() {
  const { authed, username, host, conn, theme, setTheme, logout } = useApp();
  const dark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const isReady = conn === 'ready';
  const isConnecting = conn === 'connecting' || conn === 'reconnecting';

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
          <Text className="text-xl font-bold text-neutral-950 dark:text-neutral-100">
            Settings
          </Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-4 py-4" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
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
              Choose your interface color theme
            </Text>

            <View className="flex-row gap-3">
              {/* Light Theme Card */}
              <Pressable
                onPress={() => setTheme('light')}
                className={`flex-1 items-center justify-center rounded-xl border p-3.5 ${
                  theme === 'light'
                    ? 'border-[#1a73e8] bg-blue-50/70 dark:bg-blue-950/40'
                    : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950'
                }`}
              >
                <View className="flex-row items-center justify-center h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-950/60 mb-2">
                  <Sun size={18} color="#d97706" />
                </View>
                <Text
                  className={`text-sm font-semibold ${
                    theme === 'light' ? 'text-[#1a73e8] font-bold' : 'text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  Light
                </Text>
                {theme === 'light' && (
                  <View className="mt-1.5 flex-row items-center gap-1">
                    <Check size={12} color="#1a73e8" />
                    <Text className="text-[11px] font-semibold text-[#1a73e8]">Active</Text>
                  </View>
                )}
              </Pressable>

              {/* Dark Theme Card */}
              <Pressable
                onPress={() => setTheme('dark')}
                className={`flex-1 items-center justify-center rounded-xl border p-3.5 ${
                  theme === 'dark'
                    ? 'border-[#1a73e8] bg-blue-50/70 dark:bg-blue-950/40'
                    : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950'
                }`}
              >
                <View className="flex-row items-center justify-center h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-950/60 mb-2">
                  <Moon size={18} color="#6366f1" />
                </View>
                <Text
                  className={`text-sm font-semibold ${
                    theme === 'dark' ? 'text-[#1a73e8] dark:text-[#7aa7ff] font-bold' : 'text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  Dark
                </Text>
                {theme === 'dark' && (
                  <View className="mt-1.5 flex-row items-center gap-1">
                    <Check size={12} color={dark ? '#7aa7ff' : '#1a73e8'} />
                    <Text className="text-[11px] font-semibold text-[#1a73e8] dark:text-[#7aa7ff]">Active</Text>
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
                <View className="h-8 w-8 items-center justify-center rounded-full bg-[#1a73e8]">
                  <Text className="text-sm font-bold text-white">
                    {(username || 'H').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View>
                  <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {username || 'Hermes User'}
                  </Text>
                  <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                    Active Profile
                  </Text>
                </View>
              </View>
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
