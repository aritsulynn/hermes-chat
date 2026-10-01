// Login route — connect to the dashboard (was the 'login' screen in App.tsx).
import { useEffect, useRef, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import { AlertCircle, Fingerprint } from 'lucide-react';
import * as LocalAuth from 'expo-local-authentication';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { Field } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Text as UIText } from '../../components/ui/text';
import { Spinner } from '../../components/ui/bits';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { BUILD_ID } from '../../build';
import { getPassword } from '../../services/connection';

export function LoginScreen() {
  const { booting, authed, host, setHost, username, setUsername, password, setPassword, busy, error, login } =
    useApp();
  const { theme } = useThemeValue();
  const [bioAvailable, setBioAvailable] = useState(false);
  // Android edge-to-edge breaks adjustResize, so KeyboardAvoidingView alone
  // can't lift the form — track the keyboard height (like the chat dock does)
  // and pad + scroll the form above it ourselves.
  const [kbH, setKbH] = useState(0);
  const scrollRef = useRef<ScrollArea>(null);
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
      <div
        className="flex-1 bg-white dark:bg-black items-center justify-center gap-3"
       
      >
        
        <Spinner size={24} color=currentColor />
        <UIText className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">connecting…</UIText>
      </div>
    );
  }
  if (authed) return <Redirect to="/chat" replace />;

  return (
    <div className="flex-1 bg-white dark:bg-black">
      
      <div
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollArea
          ref={scrollRef}
          className="flex-1"
          contentClassName="grow justify-center p-[object Object] pb-[object Object]"
        >
          {/* Brand */}
          <div className="mb-6 items-center">
            <div className="h-16 w-16 items-center justify-center rounded-3xl bg-[#1a73e8] shadow-lg">
              <UIText className="text-[32px] font-extrabold text-white">H</UIText>
            </div>
            <UIText className="mt-3 text-[28px] font-extrabold tracking-tight text-neutral-950 dark:text-neutral-100">
              Hermes
            </UIText>
            <UIText className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Connect to your dashboard</UIText>
          </div>

          {/* Credentials card */}
          <div className="rounded-3xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
            <Field label="Host" value={host} onChange={setHost} placeholder="http://your-server:9119" />
            <Field label="Username" value={username} onChange={setUsername} />
            <div className="-mb-2">
              <Field label="Password" value={password} onChange={setPassword} secure onSubmit={submit} />
            </div>
          </div>

          {error && (
            <Alert icon={AlertCircle} variant="destructive" className="mt-3">
              <AlertDescription className="flex-1 text-xs leading-5 text-red-600 dark:text-red-400">{error}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={submit}
            aria-label="Connect to the gateway"
            className="mt-4 h-auto rounded-2xl bg-[#1a73e8] px-[18px] py-3.5 active:opacity-80"
            disabled={busy}
          >
            {busy ? (
              <Spinner size={14} color=#fff />
            ) : (
              <UIText className="text-[16px] font-bold text-white">Connect</UIText>
            )}
          </Button>
          {bioAvailable && (
            <Button
              variant="outline"
              onClick={() => void bioLogin()}
              aria-label="Unlock with biometrics"
              className="mt-2.5 h-auto rounded-2xl px-2.5 py-3"
              disabled={busy}
            >
              <Fingerprint size={16} color="#1a73e8" />
              <UIText className="text-[15px] font-semibold text-[#1a73e8] dark:text-[#7aa7ff]">
                Unlock with biometrics
              </UIText>
            </Button>
          )}
          <UIText className="mt-5 text-center text-xs text-neutral-400">build {BUILD_ID}</UIText>
        </ScrollArea>
      </div>
    </div>
  );
}
