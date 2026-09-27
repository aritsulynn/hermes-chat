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
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import { useApp, useThemeValue } from '../hooks/app-store';
import { Button } from './ui/button';
import { Text as UIText } from './ui/text';

export function ConnectionBanner() {
  const { conn, authed, login } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const insets = useSafeAreaInsets();

  if (!authed) return null;
  const stalled = conn === 'connecting' || conn === 'reconnecting';
  const dropped = conn === 'closed';
  if (!stalled && !dropped) return null;

  const message = dropped
    ? 'Disconnected from the gateway'
    : conn === 'reconnecting'
      ? 'Connection lost — reconnecting…'
      : 'Connecting to the gateway…';

  return (
    // Absolute so showing/hiding it never reflows the screen underneath, and
    // box-none so the strip only swallows taps on itself.
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + 4, left: 0, right: 0, zIndex: 60 }}
    >
      <View className="mx-2 flex-row items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-950/80">
        {dropped ? (
          <CloudOff size={16} color={dark ? '#fcd34d' : '#b45309'} />
        ) : (
          <ActivityIndicator size="small" color={dark ? '#fcd34d' : '#b45309'} />
        )}
        <UIText
          numberOfLines={2}
          className="flex-1 text-xs font-medium text-amber-900 dark:text-amber-100"
        >
          {message}
        </UIText>
        {dropped && (
          <Button
            variant="ghost"
            size="sm"
            accessibilityLabel="Reconnect to the gateway"
            onPress={() => void login()}
            className="h-auto shrink-0 rounded-lg px-2 py-1"
          >
            <RefreshCw size={13} color={dark ? '#fcd34d' : '#b45309'} />
            <UIText className="text-xs font-semibold text-amber-800 dark:text-amber-200">
              Retry
            </UIText>
          </Button>
        )}
      </View>
    </View>
  );
}
