// Login route — connect to the dashboard (was the 'login' screen in App.tsx).
import { useEffect, useRef, useState } from 'react';
import { Redirect } from 'expo-router';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AlertCircle, Fingerprint } from 'lucide-react-native';
import * as LocalAuth from 'expo-local-authentication';
import { useApp } from '../../hooks/app-store';
import { Field } from '../../components/ui/bits';
import { BUILD_ID } from '../../build';
import { getPassword } from '../../services/connection';

export function LoginScreen() {
  const { booting, authed, host, setHost, username, setUsername, password, setPassword, busy, error, login, theme } =
    useApp();
  const [bioAvailable, setBioAvailable] = useState(false);
  // Android edge-to-edge breaks adjustResize, so KeyboardAvoidingView alone
  // can't lift the form — track the keyboard height (like the chat dock does)
  // and pad + scroll the form above it ourselves.
  const [kbH, setKbH] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e: any) => {
      setKbH(Math.max(0, Math.round(e?.endCoordinates?.height ?? 0)));
      // Let layout settle, then bring the password + Connect button into view.
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [hw, enrolled] = await Promise.all([LocalAuth.hasHardwareAsync(), LocalAuth.isEnrolledAsync()]);
        const saved = await getPassword(host, username).catch(() => null);
        setBioAvailable(hw && enrolled && !!saved);
      } catch {
        setBioAvailable(false);
      }
    })();
  }, [host, username]);

  const submit = () => {
    if (busy) return;
    Keyboard.dismiss();
    void login();
  };

  const bioLogin = async () => {
    try {
      const r = await LocalAuth.authenticateAsync({
        promptMessage: 'Unlock Hermes',
      });
      if (r.success) await login();
    } catch {}
  };

  if (booting) {
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-black items-center justify-center gap-3"
        edges={['top', 'left', 'right', 'bottom']}
      >
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
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: 24,
            paddingBottom: 24 + kbH,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand */}
          <View className="mb-6 items-center">
            <View className="h-16 w-16 items-center justify-center rounded-3xl bg-[#1a73e8] shadow-lg">
              <Text className="text-[32px] font-extrabold text-white">H</Text>
            </View>
            <Text className="mt-3 text-[28px] font-extrabold tracking-tight text-neutral-950 dark:text-neutral-100">
              Hermes
            </Text>
            <Text className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Connect to your dashboard</Text>
          </View>

          {/* Credentials card */}
          <View className="rounded-3xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
            <Field label="Host" value={host} onChange={setHost} placeholder="http://your-server:9119" />
            <Field label="Username" value={username} onChange={setUsername} />
            <View className="-mb-2">
              <Field label="Password" value={password} onChange={setPassword} secure onSubmit={submit} />
            </View>
          </View>

          {error && (
            <View className="mt-3 flex-row items-center gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-3.5 dark:border-red-950 dark:bg-red-950/30">
              <AlertCircle size={17} color="#dc2626" />
              <Text className="flex-1 text-xs leading-5 text-red-600 dark:text-red-400">{error}</Text>
            </View>
          )}

          <Pressable
            onPress={submit}
            className={`mt-4 items-center rounded-2xl bg-[#1a73e8] px-[18px] py-3.5 active:opacity-80 ${busy ? 'opacity-40' : ''}`}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-[16px] font-bold text-white">Connect</Text>
            )}
          </Pressable>
          {bioAvailable && (
            <Pressable
              onPress={() => void bioLogin()}
              className="mt-2.5 flex-row items-center justify-center gap-2 rounded-2xl border border-neutral-300 px-2.5 py-3 active:bg-neutral-100 dark:border-neutral-700 dark:active:bg-neutral-800"
              disabled={busy}
            >
              <Fingerprint size={16} color="#1a73e8" />
              <Text className="text-[15px] font-semibold text-[#1a73e8] dark:text-[#7aa7ff]">
                Unlock with biometrics
              </Text>
            </Pressable>
          )}
          <Text className="mt-5 text-center text-xs text-neutral-400">build {BUILD_ID}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
