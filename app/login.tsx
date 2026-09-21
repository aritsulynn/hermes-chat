// Login route — connect to the dashboard (was the 'login' screen in App.tsx).
import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Fingerprint } from 'lucide-react-native';
import * as LocalAuth from 'expo-local-authentication';
import { useApp } from '../src/store';
import { Field } from '../src/ui';
import { BUILD_ID } from '../src/build';
import { getPassword } from '../src/connection';

export default function LoginScreen() {
  const { booting, authed, host, setHost, username, setUsername, password, setPassword, busy, error, login, theme } =
    useApp();
  const [bioAvailable, setBioAvailable] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [hw, enrolled] = await Promise.all([
          LocalAuth.hasHardwareAsync(),
          LocalAuth.isEnrolledAsync(),
        ]);
        const saved = await getPassword().catch(() => null);
        setBioAvailable(hw && enrolled && !!saved);
      } catch {
        setBioAvailable(false);
      }
    })();
  }, []);

  const bioLogin = async () => {
    try {
      const r = await LocalAuth.authenticateAsync({ promptMessage: 'Unlock Hermes' });
      if (r.success) await login();
    } catch {}
  };

  if (booting) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-black items-center justify-center gap-3" edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="auto" />
        <ActivityIndicator size="large" />
        <Text className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">connecting…</Text>
      </SafeAreaView>
    );
  }
  if (authed) return <Redirect href="/chat" />;

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View className="flex-1 justify-center gap-1 p-6">
          <Text className="text-[32px] font-extrabold text-neutral-950 dark:text-neutral-100">Hermes</Text>
          <Text className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">connect to your dashboard</Text>
          <Field label="Host" value={host} onChange={setHost} />
          <Field label="Username" value={username} onChange={setUsername} />
          <Field label="Password" value={password} onChange={setPassword} secure />
          <Pressable
            onPress={() => void login()}
            className={`mt-2 items-center rounded-lg bg-[#1a73e8] px-[18px] py-[11px] ${busy ? 'opacity-40' : ''}`}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text className="text-[15px] font-semibold text-white">Connect</Text>}
          </Pressable>
          {bioAvailable && (
            <Pressable onPress={() => void bioLogin()} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5" disabled={busy}>
              <View className="flex-row items-center gap-2">
                <Fingerprint size={16} color="#1a73e8" />
                <Text className="font-semibold text-[#1a73e8] dark:text-[#7aa7ff]">Unlock with biometrics</Text>
              </View>
            </Pressable>
          )}
          {error && <Text className="mt-2.5 text-[#c5221f] dark:text-[#ff7b72]">{error}</Text>}
          <Text className="mt-3 text-center text-xs text-neutral-400">Trusted LAN / VPN only — plain HTTP.</Text>
          {Platform.OS === 'web' && (
            <Text className="mt-1 text-center text-xs text-neutral-400">
              Browser build needs dashboard CORS for this origin — otherwise use Expo Go.
            </Text>
          )}
          <Text className="mt-3 text-center text-xs text-neutral-400">build {BUILD_ID}</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
