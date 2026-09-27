import { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Menu as MenuIcon } from 'lucide-react-native';
import { useNavigation } from 'expo-router';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { placeholderColor } from '../../theme';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import { Text as UIText } from './text';

// Circular context-window ring for the chat header — sits left of the kebab,
// taps into Session info for the exact numbers.
export function CtxRing({
  pct,
  tone,
  dark,
  onPress,
}: {
  pct: number;
  tone: 'ok' | 'warn' | 'hot';
  dark: boolean;
  onPress: () => void;
}) {
  const size = 24;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const color =
    tone === 'hot'
      ? dark
        ? '#ff8a8a'
        : '#c5221f'
      : tone === 'warn'
        ? dark
          ? '#f0b429'
          : '#d97706'
        : dark
          ? '#5fd28a'
          : '#1a7f37';
  return (
    <Button
      variant="ghost"
      size="icon"
      testID="ctx-ring"
      accessibilityRole="button"
      accessibilityLabel={`Context ${clamped}% — open session info`}
      onPress={onPress}
      className="h-9 w-9 items-center justify-center"
      hitSlop={6}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={dark ? '#3a3a3a' : '#e2e2e6'}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
          strokeLinecap="round"
          // `rotation` + `origin` props make react-native-svg emit a
          // `transform-origin` DOM attribute on web (React warning) — the
          // equivalent `transform` attribute is valid SVG on both platforms.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
    </Button>
  );
}

// One shared drawer hamburger so every screen looks and behaves the same.
export function HamburgerBtn() {
  const { theme } = useThemeValue();
  const navigation = useNavigation();
  return (
    <Button
      variant="ghost"
      size="icon"
      testID="hamburger-btn"
      accessibilityRole="button"
      accessibilityLabel="Open navigation menu"
      onPress={() => {
        // Drop the keyboard first so the drawer isn't stuck behind it while
        // the user was mid-message.
        Keyboard.dismiss();
        (navigation as any).openDrawer?.();
      }}
      className="justify-center px-2 py-2"
      hitSlop={12}
    >
      <MenuIcon size={24} color={theme === 'dark' ? '#f5f5f5' : '#111'} />
    </Button>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  /** Keyboard action (e.g. password Enter = Connect). */
  onSubmit?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  if (!secure) {
    return (
      <View className="mb-2.5">
        <Label className="mb-0.5 text-xs text-neutral-500 dark:text-neutral-400">{label}</Label>
        <Input
          className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black px-2.5 py-2 text-[15px] text-neutral-950 dark:text-neutral-100"
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={placeholderColor(dark)}
          keyboardAppearance={dark ? 'dark' : 'light'}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType={onSubmit ? 'go' : 'default'}
          onSubmitEditing={() => onSubmit?.()}
        />
      </View>
    );
  }
  return (
    <View className="mb-2.5">
      <Label className="mb-0.5 text-xs text-neutral-500 dark:text-neutral-400">{label}</Label>
      <View className="flex-row items-center rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black pr-1">
        <Input
          className="flex-1 px-2.5 py-2 text-[15px] text-neutral-950 dark:text-neutral-100"
          value={value}
          onChangeText={onChange}
          secureTextEntry={!visible}
          keyboardAppearance={dark ? 'dark' : 'light'}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType={onSubmit ? 'go' : 'default'}
          onSubmitEditing={() => onSubmit?.()}
        />
        <Button variant="link" onPress={() => setVisible((v) => !v)} className="px-2.5 py-2" hitSlop={8}>
          <UIText className="text-sm font-semibold">{visible ? 'Hide' : 'Show'}</UIText>
        </Button>
      </View>
    </View>
  );
}

export function TypingDots({ dim }: { dim?: boolean }) {
  const d1 = useRef(new Animated.Value(0)).current;
  const d2 = useRef(new Animated.Value(0)).current;
  const d3 = useRef(new Animated.Value(0)).current;
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  useEffect(() => {
    const pulse = (d: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(d, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 350, useNativeDriver: true }),
        ]),
      );
    const loops = [pulse(d1, 0), pulse(d2, 150), pulse(d3, 300)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [d1, d2, d3]);
  const color = dim ? (dark ? '#888' : '#bbb') : (dark ? '#aaa' : '#999');
  return (
    <View className="flex-row items-center gap-[5px] px-0.5 py-1.5">
      {[d1, d2, d3].map((d, i) => (
        <Animated.View
          key={i}
          className="h-[7px] w-[7px] rounded-full"
          style={{ backgroundColor: color, opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }}
        />
      ))}
    </View>
  );
}
