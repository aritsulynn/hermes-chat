// App-wide connection state strip.
//
// Why this exists: when the socket drops, the app retries with exponential
// backoff and every screen keeps rendering its last known state — a live turn
// looks identical to a stalled one, and a cleared ask list looks identical to
// "nothing is waiting". `conn` was only readable on Settings, so the one moment
// the user needs information is the one moment the app is silent.
//
// Deliberately narrow: it renders null while `ready`, on `idle` (before the
// first connect — the login screen reports its own progress), and on
// "auth-expired" (which forces a logout on the next tick, see useGateway), so
// the strip only appears when it has something durable to say.
import { CloudOff, RefreshCw } from 'lucide-react';
import { useApp, useConn, useThemeValue } from '../hooks/app-store';
import { useGrace } from '../hooks/use-grace';
import { Button } from './ui/button';
import { Spinner } from './ui/bits';

/**
 * How long a drop has to last before the strip admits it exists.
 *
 * A socket that is going to come back inside this window never surfaces. See
 * hooks/use-grace for why the flash was worse than the outage.
 */
const BANNER_GRACE_MS = 1500;

export function ConnectionBanner() {
  const { authed, login, reconnectNow, diagnostics } = useApp();
  // Read through its own context: this strip is the one thing that must react
  // to a socket transition, and it should be the only thing that does.
  const conn = useConn();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';

  // `connecting` is included: the first connect after a cold boot is a real wait
  // the login screen cannot cover. The resume case — a drop that heals in a few
  // hundred ms — is not, and that is what this window hides.
  const offline = conn === 'connecting' || conn === 'reconnecting' || conn === 'closed';
  const announced = useGrace(offline, BANNER_GRACE_MS);

  if (!authed || !announced) return null;

  const stalled = conn === 'connecting' || conn === 'reconnecting';
  const dropped = conn === 'closed';

  // Last socket close, so a stuck "reconnecting…" names its cause (1006 =
  // network/server gone, 44xx = auth). Already in Copy diagnostics too.
  let closeHint = '';
  try {
    const closes = (diagnostics() as any)?.ws?.closes;
    const last = Array.isArray(closes) && closes.length > 0 ? closes[closes.length - 1] : null;
    if (last && (typeof last.code === 'number' || last.reason)) {
      closeHint = ` (close ${last.code ?? '?'}${last.reason ? `: ${last.reason}` : ''})`;
    }
  } catch {}

  const message = dropped
    ? 'Disconnected from the gateway'
    : conn === 'reconnecting'
      ? `Connection lost — reconnecting…${closeHint}`
      : 'Connecting to the gateway…';

  return (
    // Fixed so showing/hiding it never reflows the screen underneath, and
    // pointer-events-none on the wrapper so the strip only swallows taps on
    // itself — the screen below stays fully interactive while it is up.
    <div
      className="pointer-events-none fixed inset-x-0 z-[60]"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 4px)' }}>
      <div className="pointer-events-auto mx-2 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-950/80">
        {dropped ? (
          <CloudOff size={16} color={dark ? '#fcd34d' : '#b45309'} />
        ) : (
          <Spinner size={14} color={dark ? '#fcd34d' : '#b45309'} />
        )}
        <div className="flex-1 text-xs font-medium text-amber-900 dark:text-amber-100 line-clamp-2">{message}</div>
        {(dropped || stalled) && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Reconnect to the gateway"
            onClick={() => (dropped ? void login() : reconnectNow())}
            className="h-auto sm:h-auto shrink-0 rounded-lg px-2 py-1">
            <RefreshCw size={13} color={dark ? '#fcd34d' : '#b45309'} />
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">Retry</span>
          </Button>
        )}
      </div>
    </div>
  );
}
