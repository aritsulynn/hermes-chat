import { useState } from 'react';
import { AlertCircle, LoaderCircle, Menu as MenuIcon } from 'lucide-react';
import { useThemeValue } from '../../hooks/app-store';
import { cn } from '../../utils/cn';
import { openNavDrawer } from '../../store/nav';
import { Alert as UIAlert, AlertDescription } from './alert';
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
      data-testid="ctx-ring"
      aria-label={`Context ${clamped}% — open session info`}
      onClick={onPress}
      className="h-9 w-9 items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={dark ? '#3a3a3a' : '#e2e2e6'}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </Button>
  );
}

// One shared drawer hamburger so every screen looks and behaves the same.
export function HamburgerBtn() {
  const { theme } = useThemeValue();
  return (
    <Button
      variant="ghost"
      size="icon"
      data-testid="hamburger-btn"
      aria-label="Open navigation menu"
      onClick={() => {
        // Drop focus first so the drawer isn't left behind the keyboard the
        // user was mid-sentence in. On the web this means blurring the active
        // element, which is the whole of what Keyboard.dismiss() did.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        openNavDrawer();
      }}
      className="justify-center px-2 py-2">
      <MenuIcon size={24} color={theme === 'dark' ? '#f5f5f5' : '#111'} />
    </Button>
  );
}

// One shared screen header. Every non-chat screen had its own copy of the same
// bar - hamburger, title, optional subtitle, optional right-hand actions - and
// they drifted: two of them sized the title colour differently and only some
// passed a subtitle. `subtitle` is a node because Files, Logs, Skills and
// Toolsets all interpolate counts into it.
export function ScreenHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header
      className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 pb-4 dark:border-neutral-800 dark:bg-black"
      // `insetTop` was a prop every call site had to thread a number into. The
      // browser already knows the safe area, so it asks instead.
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <HamburgerBtn />
        <div className="min-w-0 flex-1">
          <UIText numberOfLines={1} className="text-xl font-bold text-neutral-950 dark:text-neutral-100">
            {title}
          </UIText>
          {!!subtitle && (
            <UIText numberOfLines={1} className="text-xs text-neutral-500 dark:text-neutral-400">
              {subtitle}
            </UIText>
          )}
        </div>
      </div>
      {actions}
    </header>
  );
}

// The card surface every settings/usage/skills/toolsets section sits on. The
// class string was pasted into 19 places and had already started drifting
// (two padding sizes, one background variant), so it lives here now. `className`
// still wins, which is how the compact `p-3.5` variant stays honest.
export function Card({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60',
        className,
      )}
      {...props}>
      {children}
    </div>
  );
}

// The "something failed, here is the message, try again" block that every list
// screen repeated verbatim. Rendered only when `error` is set, so callers can
// drop their own conditional.
export function ErrorRetry({
  error,
  onRetry,
  className,
  retryLabel = 'Retry',
  compact,
}: {
  error: string | null;
  onRetry: () => void;
  className?: string;
  retryLabel?: string;
  /** Denser variant for banners that sit inside a card or a list header. */
  compact?: boolean;
}) {
  if (!error) return null;
  return (
    <UIAlert
      icon={AlertCircle}
      variant="destructive"
      className={cn(compact ? 'rounded-xl px-4 pt-3' : 'rounded-2xl', className)}>
      <AlertDescription className="text-xs font-medium text-red-700 dark:text-red-300">{error}</AlertDescription>
      <Button
        variant="destructive"
        size="sm"
        onClick={onRetry}
        className="mt-1 self-start"
        aria-label={retryLabel}>
        <UIText className="text-xs font-semibold">{retryLabel}</UIText>
      </Button>
    </UIAlert>
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
  /** Enter key action (e.g. password Enter = Connect). */
  onSubmit?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const { theme } = useThemeValue();
  // Makes the browser draw the native input (and its autofill dropdown, and
  // the on-screen keyboard) in the app's palette rather than the OS default.
  const scheme = { colorScheme: theme === 'dark' ? ('dark' as const) : ('light' as const) };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };
  if (!secure) {
    return (
      <div className="mb-2.5">
        <Label className="mb-0.5 text-xs text-neutral-500 dark:text-neutral-400" htmlFor={idFor(label)}>
          {label}
        </Label>
        <Input
          id={idFor(label)}
          style={scheme}
          className="rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-[15px] text-neutral-950 dark:border-neutral-700 dark:bg-black dark:text-neutral-100"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint={onSubmit ? 'go' : 'enter'}
          onKeyDown={onKeyDown}
        />
      </div>
    );
  }
  return (
    <div className="mb-2.5">
      <Label className="mb-0.5 text-xs text-neutral-500 dark:text-neutral-400" htmlFor={idFor(label)}>
        {label}
      </Label>
      <div className="flex items-center rounded-lg border border-neutral-300 bg-white pr-1 dark:border-neutral-700 dark:bg-black">
        <Input
          id={idFor(label)}
          style={scheme}
          // The row around this draws the field; the base border + background
          // inside it would read as a frame within a frame. dark:bg-transparent
          // is required — the base sets dark:bg-input/30.
          className="flex-1 border-0 bg-transparent px-2.5 py-2 text-[15px] text-neutral-950 dark:bg-transparent dark:text-neutral-100"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={visible ? 'text' : 'password'}
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint={onSubmit ? 'go' : 'enter'}
          onKeyDown={onKeyDown}
        />
        <Button variant="link" onClick={() => setVisible((v) => !v)} className="px-2.5 py-2">
          <UIText className="text-sm font-semibold">{visible ? 'Hide' : 'Show'}</UIText>
        </Button>
      </div>
    </div>
  );
}

/** A stable DOM id per label, so <Label htmlFor> can point at its field. */
function idFor(label: string): string {
  return `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/**
 * A small rotating ring for "this is running right now".
 *
 * Deliberately an icon rather than a bare spinner box: next to a title it has
 * to sit on the text baseline without nudging the row's height, and the user
 * reads it as a state of that chat, not as a screen-wide loading state.
 * `animate-spin` needs no mount/unmount bookkeeping — the CSS animation stops
 * with the element, so a row that scrolls out of a windowed list cannot leave
 * an animation running. That was the reason the native version kept a ref and
 * had to stop an Animated.loop on cleanup.
 */
export function Spinner({ size = 14, color }: { size?: number; color: string }) {
  return (
    <span className="inline-flex animate-spin" style={{ color }}>
      <LoaderCircle size={size} color={color} />
    </span>
  );
}

export function TypingDots({ dim }: { dim?: boolean }) {
  const { theme } = useThemeValue();
  const color = dim ? (theme === 'dark' ? '#888' : '#bbb') : theme === 'dark' ? '#aaa' : '#999';
  return (
    <div className="flex items-center gap-[5px] px-0.5 py-1.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-[7px] w-[7px] animate-[dot-pulse_700ms_ease-in-out_infinite] rounded-full"
          // Staggered start so the three dots rise in sequence rather than
          // pulsing as one bar. The native build got this from three
          // Animated.timing loops with 0/150/300ms delays.
          style={{ backgroundColor: color, animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}
