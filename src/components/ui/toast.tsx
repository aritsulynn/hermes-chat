// Lightweight toast host — the themed replacement for the
// `Alert.alert(title, message)` one-button popups the app fired on every failed
// action. Those blocked the screen they were reporting on, and on Android they
// ignored the app theme and dark mode entirely.
//
// `toast()` is a plain module function so it can be called from callbacks and
// async handlers without threading a hook through every feature. <ToastHost />
// must be mounted once near the root (see app/_layout.tsx).
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { Text as UIText } from '@/components/ui/text';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { FadeInUp, FadeOutDown, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleCheck, TriangleAlert, X } from 'lucide-react-native';

type ToastVariant = 'default' | 'destructive' | 'success';

type ToastData = {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
};

const DURATION_MS = 4000;
const MAX_VISIBLE = 3;

let seq = 0;
let queue: ToastData[] = [];
const listeners = new Set<(next: ToastData[]) => void>();

function publish() {
  const snapshot = [...queue];
  listeners.forEach((l) => l(snapshot));
}

/** Auto-dismissing. Safe to call from anywhere; no hooks, no provider. */
export function toast(input: { title: string; description?: string; variant?: ToastVariant }) {
  const item: ToastData = { id: ++seq, variant: 'default', ...input };
  // Keep the stack short: a burst of failures should not bury the screen.
  queue = [...queue, item].slice(-MAX_VISIBLE);
  publish();
  setTimeout(() => toast.dismiss(item.id), DURATION_MS);
  return item.id;
}

toast.dismiss = (id: number) => {
  const next = queue.filter((t) => t.id !== id);
  if (next.length === queue.length) return;
  queue = next;
  publish();
};

function useToasts() {
  const [list, setList] = React.useState<ToastData[]>(queue);
  React.useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}

function ToastItem({
  title,
  description,
  variant,
  onDismiss,
}: Omit<ToastData, 'id'> & { onDismiss: () => void }) {
  const Icon = variant === 'destructive' ? TriangleAlert : CircleCheck;
  const iconColor = variant === 'destructive' ? '#ef4444' : variant === 'success' ? '#10b981' : '#888888';
  return (
    <Pressable
      onPress={onDismiss}
      // Errors interrupt; everything else is announced politely when the row
      // mounts (Pressable's role union has no "status").
      accessibilityRole={variant === 'destructive' ? 'alert' : undefined}
      accessibilityLiveRegion={variant === 'destructive' ? 'assertive' : 'polite'}
      accessibilityLabel={description ? `${title}. ${description}` : title}
      className="w-full max-w-[420px] flex-row items-start gap-2.5 rounded-xl border border-neutral-200 bg-white px-3.5 py-3 shadow-lg shadow-black/10 dark:border-neutral-700 dark:bg-[#1c1c1e]">
      <View className="mt-0.5">
        <Icon size={17} color={iconColor} />
      </View>
      <View className="min-w-0 flex-1">
        <UIText
          numberOfLines={2}
          className={`text-[14px] font-semibold ${
            variant === 'destructive'
              ? 'text-red-600 dark:text-red-400'
              : 'text-neutral-950 dark:text-neutral-100'
          }`}
        >
          {title}
        </UIText>
        {!!description && (
          <UIText
            numberOfLines={3}
            className="mt-0.5 text-[13px] leading-[18px] text-neutral-600 dark:text-neutral-300"
          >
            {description}
          </UIText>
        )}
      </View>
      <View className="mt-0.5">
        <X size={15} color={iconColor} />
      </View>
    </Pressable>
  );
}

/** Mount once, last in the root layout. Renders nothing while idle. */
export function ToastHost() {
  const list = useToasts();
  const insets = useSafeAreaInsets();
  if (!list.length) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 100 }}
    >
      {/* Animated wrapper so each row's `exiting` plays out before the element
          is dropped from the tree. */}
      <NativeOnlyAnimatedView
        entering={FadeInUp.duration(220).reduceMotion(ReduceMotion.System)}
        className="items-center gap-2 px-4"
        style={{ paddingBottom: insets.bottom + 16 }}>
        {list.map((t) => (
          <NativeOnlyAnimatedView
            key={t.id}
            entering={FadeInUp.duration(220).reduceMotion(ReduceMotion.System)}
            exiting={FadeOutDown.duration(180).reduceMotion(ReduceMotion.System)}
            className="w-full items-center">
            <ToastItem
              title={t.title}
              description={t.description}
              variant={t.variant}
              onDismiss={() => toast.dismiss(t.id)}
            />
          </NativeOnlyAnimatedView>
        ))}
      </NativeOnlyAnimatedView>
    </View>
  );
}
