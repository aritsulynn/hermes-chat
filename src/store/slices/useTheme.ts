// Theme slice — light/dark/system preference, `.dark` class sync on <html>,
// and the saved-preference hydration used during boot.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { saveAccent, saveTheme } from '../../services/connection';
import type { Accent, ResolvedTheme, Theme } from '../../services/connection';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * The OS preference, as a live subscription. It has to be a subscription and
 * not a read at mount: the user can flip their system theme while the tab is
 * open, and `themeMode === 'system'` has to follow it.
 *
 * `matches` is a boolean, so the snapshot is referentially stable and
 * useSyncExternalStore will not loop on it.
 */
function subscribeToSystemScheme(onChange: () => void): () => void {
  const mql = globalThis.matchMedia?.(DARK_QUERY);
  if (!mql) return () => {};
  // Safari below 14 only has the deprecated add/removeListener pair.
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

function readSystemScheme(): boolean {
  try {
    return globalThis.matchMedia?.(DARK_QUERY).matches ?? false;
  } catch {
    return false;
  }
}

export interface ThemeSlice {
  themeMode: Theme;
  theme: ResolvedTheme;
  setTheme: (t: Theme) => void;
  /** Accent palette on top of light/dark — default is Hermes, openchamber is warm. */
  accent: Accent;
  setAccent: (a: Accent) => void;
  /** Apply the persisted preference during boot (also syncs the `.dark` class). */
  hydrateTheme: (saved?: Theme | null, savedAccent?: Accent | null) => void;
}

export function useThemeSlice(): ThemeSlice {
  const systemDark = useSyncExternalStore(subscribeToSystemScheme, readSystemScheme, () => false);
  const systemTheme: ResolvedTheme = systemDark ? 'dark' : 'light';
  // First install follows the device. An explicit saved Light/Dark choice wins.
  const [themeMode, setThemeMode] = useState<Theme>('system');
  const [accent, setAccentState] = useState<Accent>('default');
  const theme: ResolvedTheme = themeMode === 'system' ? systemTheme : themeMode;

  // Every `dark:` variant in the app resolves against `.dark` on <html>, so one
  // redundant classList write means a style recalc across the whole document.
  // setTheme applies the class eagerly (so the palette starts moving in the same
  // frame as the press) and the effect below applies it again once React has
  // re-rendered, so without this guard one toggle would recalc twice.
  const appliedSchemeRef = useRef<ResolvedTheme | null>(null);
  const appliedAccentRef = useRef<Accent | null>(null);
  const applyScheme = useCallback((next: ResolvedTheme) => {
    if (appliedSchemeRef.current === next) return;
    appliedSchemeRef.current = next;
    try {
      document.documentElement.classList.toggle('dark', next === 'dark');
    } catch (e) {
      console.warn('[theme] could not toggle the .dark class', e);
    }
  }, []);

  const applyAccent = useCallback((next: Accent) => {
    if (appliedAccentRef.current === next) return;
    appliedAccentRef.current = next;
    try {
      if (next === 'default') document.documentElement.removeAttribute('data-accent');
      else document.documentElement.setAttribute('data-accent', next);
    } catch (e) {
      console.warn('[theme] could not set data-accent', e);
    }
  }, []);

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeMode(t);
      // Resolve immediately so the classList write lands in the same frame as
      // the press; the effect below keeps it synced if the OS preference
      // changes later.
      applyScheme(t === 'system' ? systemTheme : t);
      void saveTheme(t).catch((e: unknown) => console.warn('[theme] saveTheme failed', e));
    },
    [applyScheme, systemTheme],
  );

  useEffect(() => {
    applyScheme(theme);
  }, [applyScheme, theme]);

  useEffect(() => {
    applyAccent(accent);
  }, [applyAccent, accent]);

  const setAccent = useCallback(
    (a: Accent) => {
      setAccentState(a);
      applyAccent(a);
      void saveAccent(a).catch((e: unknown) => console.warn('[theme] saveAccent failed', e));
    },
    [applyAccent],
  );

  const hydrateTheme = useCallback(
    (saved?: Theme | null, savedAccent?: Accent | null) => {
      if (saved) setThemeMode(saved);
      if (savedAccent) setAccentState(savedAccent);
      applyScheme(saved === 'system' || !saved ? systemTheme : saved);
      applyAccent(savedAccent ?? 'default');
    },
    [applyScheme, applyAccent, systemTheme],
  );

  // Memoised: this object is the ThemeContext value, so a fresh literal every
  // render would re-render all ~18 theme consumers on EVERY store update
  // (each keystroke, each session change) instead of only on a theme change.
  return useMemo(
    () => ({ themeMode, theme, setTheme, accent, setAccent, hydrateTheme }),
    [themeMode, theme, setTheme, accent, setAccent, hydrateTheme],
  );
}
