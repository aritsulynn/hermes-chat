// Login route — connect to the dashboard (was the 'login' screen in App.tsx).
import { Redirect } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../src/store';
import { Field, styles } from '../src/ui';
import { BUILD_ID } from '../src/build';

export default function LoginScreen() {
  const { booting, authed, host, setHost, username, setUsername, password, setPassword, busy, error, login } =
    useApp();

  if (booting) {
    return (
      <SafeAreaView style={[styles.root, styles.boot]} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="auto" />
        <ActivityIndicator size="large" />
        <Text style={styles.sub}>connecting…</Text>
      </SafeAreaView>
    );
  }
  if (authed) return <Redirect href="/sessions" />;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.loginWrap}>
          <Text style={styles.appTitle}>Hermes</Text>
          <Text style={styles.sub}>connect to your dashboard</Text>
          <Field label="Host" value={host} onChange={setHost} />
          <Field label="Username" value={username} onChange={setUsername} />
          <Field label="Password" value={password} onChange={setPassword} secure />
          <Pressable onPress={() => void login()} style={[styles.primary, busy && styles.disabled]} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Connect</Text>}
          </Pressable>
          {error && <Text style={styles.err}>{error}</Text>}
          <Text style={styles.hint}>Trusted LAN / VPN only — plain HTTP.</Text>
          <Text style={styles.hint}>build {BUILD_ID}</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
