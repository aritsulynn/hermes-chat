// Design tokens for the reusables (shadcn-style) components.
//
// These are the TypeScript mirror of the CSS variables declared in global.css:
// the same colours in `hsl()` form, for the places that need a raw colour
// string (inline styles, StatusBar, navigation theming) where a Tailwind class
// cannot be used.
//
// If you change a value in global.css, change it here too.
export const THEME = {
  light: {
    background: 'hsl(0 0% 100%)',
    foreground: 'hsl(0 0% 3.9%)',
    card: 'hsl(0 0% 100%)',
    cardForeground: 'hsl(0 0% 3.9%)',
    popover: 'hsl(0 0% 100%)',
    popoverForeground: 'hsl(0 0% 3.9%)',
    primary: 'hsl(0 0% 9%)',
    primaryForeground: 'hsl(0 0% 98%)',
    secondary: 'hsl(0 0% 96.1%)',
    secondaryForeground: 'hsl(0 0% 9%)',
    muted: 'hsl(0 0% 96.1%)',
    mutedForeground: 'hsl(0 0% 45.1%)',
    accent: 'hsl(0 0% 96.1%)',
    accentForeground: 'hsl(0 0% 9%)',
    destructive: 'hsl(0 84.2% 60.2%)',
    border: 'hsl(0 0% 89.8%)',
    input: 'hsl(0 0% 89.8%)',
    ring: 'hsl(0 0% 63%)',
    radius: '0.625rem',
    chart1: 'hsl(12 76% 61%)',
    chart2: 'hsl(173 58% 39%)',
    chart3: 'hsl(197 37% 24%)',
    chart4: 'hsl(43 74% 66%)',
    chart5: 'hsl(27 87% 67%)',
  },
  dark: {
    background: 'hsl(0 0% 3.9%)',
    foreground: 'hsl(0 0% 98%)',
    card: 'hsl(0 0% 3.9%)',
    cardForeground: 'hsl(0 0% 98%)',
    popover: 'hsl(0 0% 3.9%)',
    popoverForeground: 'hsl(0 0% 98%)',
    primary: 'hsl(0 0% 98%)',
    primaryForeground: 'hsl(0 0% 9%)',
    secondary: 'hsl(0 0% 14.9%)',
    secondaryForeground: 'hsl(0 0% 98%)',
    muted: 'hsl(0 0% 14.9%)',
    mutedForeground: 'hsl(0 0% 63.9%)',
    accent: 'hsl(0 0% 14.9%)',
    accentForeground: 'hsl(0 0% 98%)',
    destructive: 'hsl(0 70.9% 59.4%)',
    border: 'hsl(0 0% 14.9%)',
    input: 'hsl(0 0% 14.9%)',
    ring: 'hsl(300 0% 45%)',
    radius: '0.625rem',
    chart1: 'hsl(220 70% 50%)',
    chart2: 'hsl(160 60% 45%)',
    chart3: 'hsl(30 80% 55%)',
    chart4: 'hsl(280 65% 60%)',
    chart5: 'hsl(340 75% 55%)',
  },
} as const;

export type ThemeColors = (typeof THEME)['light'];

// ── Shared runtime colours ─────────────────────────────────────────────────
// Central tokens for the hex values previously copy-pasted across screens.
// NOTE: Tailwind `className` strings (e.g. `text-[#1a73e8]`) must stay literal
// — NativeWind extracts them statically — so these tokens cover only runtime
// values: `color`/`placeholderTextColor` props and `style` objects.

/** Primary brand blue (light) / its dark-mode counterpart. */
export const BRAND_BLUE = '#1a73e8';
export const BRAND_BLUE_DARK = '#7aa7ff';
/** Brand blue for the current scheme (icon `color` props, inline styles). */
export const brandColor = (dark: boolean): string => (dark ? BRAND_BLUE_DARK : BRAND_BLUE);

/** Full-screen surface behind every tab (`flex: 1` + scheme background). */
export const screenBg = (dark: boolean): string => (dark ? '#000' : '#fff');
/** Style object for a full-screen surface (`style={screenStyle(dark)}`). */
export const screenStyle = (dark: boolean): { flex: 1; backgroundColor: string } => ({
  flex: 1,
  backgroundColor: screenBg(dark),
});

export type PlaceholderKind = 'standard' | 'file' | 'cron' | 'log' | 'composer';
const PLACEHOLDER_COLORS: Record<PlaceholderKind, { light: string; dark: string }> = {
  standard: { light: '#9ca3af', dark: '#888' },
  file: { light: '#9ca3af', dark: '#777' },
  cron: { light: '#999', dark: '#777' },
  log: { light: '#999', dark: '#666' },
  composer: { light: '#9ca3af', dark: '#8a8a8a' },
};
/** `placeholderTextColor` for the current scheme (pass the screen's kind). */
export function placeholderColor(dark: boolean, kind: PlaceholderKind = 'standard'): string {
  const c = PLACEHOLDER_COLORS[kind];
  return dark ? c.dark : c.light;
}

/** Near-black body text of the light assistant markdown theme. */
export const MARKDOWN_INK = '#111';
/** Code-block surface, shared by every markdown theme (light and dark). */
export const CODE_SURFACE = '#1e1e24';

