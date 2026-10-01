import { useCallback, useSyncExternalStore, useState } from 'react';
import { AlertCircle, LoaderCircle, PanelLeft } from 'lucide-react';
import { useThemeValue } from '../../hooks/app-store';
import { cn } from '../../utils/cn';
import { getSidebarShown, openNavDrawer, subscribeSidebarShown } from '../../store/nav';
import { Alert as UIAlert, AlertDescription } from './alert';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';

// Circular context-window ring for the chat header — sits left of the menu
// button, taps into Session info for the exact numbers.
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
  const label = `${parseFloat(pct.toFixed(1))}%`;
  return (
    <Button
      variant="ghost"
      size="icon"
      data-testid="ctx-ring"
      aria-label={`Context ${label} — open session info`}
      onClick={onPress}
      // Pill, not square: the readout lives inside the tap target. Width is
      // inline so no size utility fights it; the inner flex row carries its
      // own gap for the same reason.
      className="h-9 rounded-full px-2"
      style={{ width: 'auto', height: 36 }}>
      <span className="flex items-center gap-1.5">
        <svg
          width={size}
          height={size}
          // Inline style on purpose: Button's `[&_svg]:size-4` rule clamps every
          // class-less svg to 16px and beats width/height attributes, so without
          // this the ring renders 16px no matter what `size` says.
          style={{ width: size, height: size }}
          viewBox={`0 0 ${size} ${size}`}>
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
        <span className="text-ui-label font-medium tabular-nums text-neutral-600 dark:text-neutral-300">{label}</span>
      </span>
    </Button>
  );
}

// Shared sizing for a header icon control: the hamburger, the chat menu button
// and every screen's right-hand actions.
//
//   40px tap target (`h-10 w-10`), matching OpenChamber's compact bar. The
//   `sm:h-9 sm:w-9` half of `size="icon"` still shrinks it to 36px from 640px
//   up, which is the intent for a pointer. This is below the 44pt iOS target —
//   a deliberate trade for the 56px bar; widen it back if the bar grows.
//
//   20px glyph (`[&_svg]:size-5!`). The Button base clamps any class-less <svg>
//   to 16px (`[&_svg:not([class*='size-'])]:size-4`), which silently overrode
//   every `size={15|18|19}` these call sites passed — the icons rendered 16px
//   whatever the prop said. The `!` is load-bearing: it outranks that clamp,
//   so the glyph is 20px, matching the hamburger and the header title.
//
// It is exported as a class rather than only a component because the chat kebab
// is a Base UI `render` target, and the class drops straight onto the <Button>
// that `render` swaps in.
export const headerIconButtonClass = 'h-10 w-10 rounded-lg [&_svg]:size-5!';

/** A header icon button: 40px target, 20px glyph. See `headerIconButtonClass`. */
export function HeaderIconButton({ className, children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button variant="ghost" size="icon" className={cn(headerIconButtonClass, className)} {...props}>
      {children}
    </Button>
  );
}

// One shared drawer toggle so every screen looks and behaves the same.
//
// It steps aside while the wide-screen sidebar is showing. The sidebar has its
// own PanelLeft for collapsing, and two of the same glyph on one screen — one in
// the sidebar header, one in the screen header — read as a bug rather than as a
// control. So this button exists exactly when there is no sidebar on screen to
// carry the toggle, which on a narrow screen is always, and on a wide screen is
// whenever the sidebar has been collapsed.
export function HamburgerBtn() {
  const { theme } = useThemeValue();
  const sidebarShown = useSyncExternalStore(subscribeSidebarShown, getSidebarShown, () => false);
  if (sidebarShown) return null;
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
      className={cn(headerIconButtonClass, 'justify-center')}>
      <PanelLeft size={20} className="size-5" color={theme === 'dark' ? '#f5f5f5' : '#111'} />
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
      // No background or border of its own: the glass surface belongs to the
      // frame (`ScreenScaffold`, or the chat screen's own overlay), which spans
      // the whole header region including any sub-bar. Painting it here would
      // put a second, opaque surface under those sub-bars.
      //
      // `insetTop` was a prop every call site had to thread a number into. The
      // browser already knows the safe area, so the variable in global.css
      // resolves it once and every header reads the same value.
      style={{ paddingTop: 'var(--safe-area-top, 0px)' }}>
      {/* Fixed inner bar height, not padding: the icon control is centred in
          `--header-height` so every screen's header lands on the same line. */}
      <div className="flex h-(--header-height) items-center justify-between px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <HamburgerBtn />
          <div className="min-w-0 flex-1">
            <h1 className="text-ui-header font-bold text-neutral-950 dark:text-neutral-100 truncate">{title}</h1>
            {!!subtitle && (
              <div className="text-ui-meta text-neutral-500 dark:text-neutral-400 truncate">{subtitle}</div>
            )}
          </div>
        </div>
        {actions}
      </div>
    </header>
  );
}

// Shared screen frame. The header floats over one scrolling body, so the body's
// content passes *under* it — that overlap is the whole point. The header's
// `backdrop-blur` blurs whatever is painted behind it, and with the header in
// normal flow above the scroller there is nothing behind it but the opaque page
// background, so the glass reads as a plain solid bar. Here the wrapper is
// `relative`, the header region is `absolute`, and the body is padded down by
// the region's measured height.
//
// `header` is the whole top region — the `ScreenHeader` plus any sub-bar the
// screen draws under it (usage's period picker, files' breadcrumbs). Measuring
// the region, rather than assuming `--header-height`, is what lets those
// screens keep their sub-bar without a second layout pass.
export function ScreenScaffold({
  header,
  children,
  contentClassName,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  const [headerH, setHeaderH] = useState(0);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const read = () => setHeaderH(Math.round(el.getBoundingClientRect().height));
    read();
    const ro = new ResizeObserver(read);
    // `border-box`, not the default `content-box`: the safe-area pad and any
    // sub-bar change the region's border box, and the measured height is what
    // the body is padded by. (Same gotcha as the chat footer's dock observer —
    // a default observer never fires when only padding changes.)
    ro.observe(el, { box: 'border-box' });
    return () => ro.disconnect();
  }, []);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-white dark:bg-black">
      <div
        ref={measure}
        // The glass. 80% opaque + blur behind it; no border — the blur is what
        // separates the header from the content, the way OpenChamber does it.
        className="absolute inset-x-0 top-0 z-30 bg-white/80 backdrop-blur dark:bg-black/80">
        {header}
      </div>
      <div
        className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', contentClassName)}
        // The measured height, with the static safe-area + bar height as the
        // first-paint value so the content does not start under the header for
        // a frame.
        style={{ paddingTop: headerH || 'calc(var(--safe-area-top, 0px) + var(--header-height))' }}>
        {children}
      </div>
    </div>
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
      <Button variant="destructive" size="sm" onClick={onRetry} className="mt-1 self-start" aria-label={retryLabel}>
        <span className="text-xs font-semibold">{retryLabel}</span>
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
  // Makes the browser draw the input (and its autofill dropdown, and
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
      <div className="frame-focus flex items-center rounded-lg border border-neutral-300 bg-white pr-1 dark:border-neutral-700 dark:bg-black">
        <Input
          id={idFor(label)}
          style={scheme}
          // The row around this draws the field; the base border + background
          // inside it would read as a frame within a frame. dark:bg-transparent
          // is required — the base sets dark:bg-input/30.
          className="flex-1 border-0 bg-transparent px-2.5 py-2 text-[15px] text-neutral-950 focus-visible:ring-0 dark:bg-transparent dark:text-neutral-100"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={visible ? 'text' : 'password'}
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint={onSubmit ? 'go' : 'enter'}
          onKeyDown={onKeyDown}
        />
        <Button variant="link" onClick={() => setVisible((v) => !v)} className="px-2.5 py-2">
          <span className="text-sm font-semibold">{visible ? 'Hide' : 'Show'}</span>
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
 * with the element, so a row that leaves the viewport cannot leave an animation
 * running.
 */
export function Spinner({
  size = 14,
  color,
  className,
}: {
  size?: number;
  /**
   * A raw colour string for the places that cannot use a class — inline styles,
   * a value read off the theme in JS. Prefer `className` with a `text-*`
   * utility (and `dark:text-*` for the other scheme): it keeps the colour in
   * CSS, so switching theme is a class swap rather than a re-render.
   */
  color?: string;
  className?: string;
}) {
  return (
    // No `color` prop on the icon means `currentColor`, which is what lets
    // `className` drive it.
    <span className={cn('inline-flex animate-spin', className)} style={color ? { color } : undefined}>
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
          // pulsing as one bar.
          style={{ backgroundColor: color, animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}
