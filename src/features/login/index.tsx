// Login route — connect to the dashboard.
//
// There is no biometric unlock: it would need a *stored* password to gate, and
// no password is stored. The browser equivalent would be a passkey (WebAuthn)
// against the gateway, which is a different mechanism with a server-side
// challenge — it belongs to the same Web Auth backlog item as the notification
// reply flow.
import { useEffect, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useApp } from '../../hooks/app-store';
import { Field, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { BUILD_ID } from '../../build';

export function LoginScreen() {
  const { booting, authed, host, setHost, username, setUsername, password, setPassword, busy, error, login } = useApp();

  // Mobile browsers do not resize the layout for the virtual keyboard, so the
  // form would sit under it. Pad by the visual-viewport gap and let the page
  // scroll; `env()` covers the non-keyboard case for free.
  const [kbH, setKbH] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKbH(Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop ?? 0))));
    onResize();
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  const submit = () => {
    if (busy) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    void login();
  };

  if (booting) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background">
        <Spinner size={24} color="var(--brand-hex)" />
        <span className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">connecting…</span>
      </div>
    );
  }
  if (authed) return <Redirect to="/chat" replace />;

  return (
    <div
      className="flex h-full flex-col overflow-y-auto bg-background"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6"
        style={{ paddingBottom: 24 + kbH }}>
        {/* Brand */}
        <div className="mb-6 flex flex-col items-center">
          {/* The real app mark, same asset the launcher icon and the web manifest
              use. It was a hand-drawn green "H" tile here, which is a different
              mark from the one the app ships — the login screen read as another
              app. Served from public/, so the URL has to stay relative: `base` is
              "./" and the bundle also loads from a static sub-path, from
              capacitor://localhost, and from file://. */}
          <img
            src={`${import.meta.env.BASE_URL}android-chrome-512x512.png`}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 select-none"
          />
          <h1 className="mt-3 text-[28px] font-extrabold tracking-tight text-neutral-950 dark:text-neutral-100">
            Hermes
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Connect to your dashboard</p>
        </div>

        {/* Credentials card */}
        <div className="rounded-3xl border border-border bg-elevated p-4 dark:bg-elevated">
          <Field label="Host" value={host} onChange={setHost} placeholder="http://your-server:9119" />
          <Field label="Username" value={username} onChange={setUsername} />
          <div className="-mb-2">
            <Field label="Password" value={password} onChange={setPassword} secure onSubmit={submit} />
          </div>
        </div>

        {error && (
          <Alert icon={AlertCircle} variant="destructive" className="mt-3">
            <AlertDescription className="text-xs leading-5 text-red-600 dark:text-red-400">{error}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={submit}
          aria-label="Connect to the gateway"
          className="mt-4 h-auto sm:h-auto rounded-2xl bg-brand px-[18px] py-3.5 text-white hover:bg-brand/90"
          disabled={busy}>
          {busy ? (
            <Spinner size={16} color="#fff" />
          ) : (
            <span className="text-[16px] font-bold text-white">Connect</span>
          )}
        </Button>
        <p className="mt-5 text-center text-xs text-neutral-400">build {BUILD_ID}</p>
      </div>
    </div>
  );
}
