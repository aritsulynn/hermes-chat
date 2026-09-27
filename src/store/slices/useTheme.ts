// Theme slice — light/dark/system preference, NativeWind color-scheme sync,
// and the saved-preference hydration used during boot.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme as useSystemScheme } from 'react-native';
import { useColorScheme as useNWColorScheme } from 'nativewind';
import { saveTheme } from '../../services/connection';
import type { ResolvedTheme, Theme } from '../../services/connection';

export interface ThemeSlice {
  themeMode: Theme;
  theme: ResolvedTheme;
  setTheme: (t: Theme) => void;
  /** Apply the persisted preference during boot (also syncs NativeWind). */
  hydrateTheme: (saved?: Theme | null) => void;
}

export function useThemeSlice(): ThemeSlice {
  const systemScheme = useSystemScheme();
  const systemTheme: ResolvedTheme = systemScheme === 'dark' ? 'dark' : 'light';
  // First install follows the device. An explicit saved Light/Dark choice wins.
  const [themeMode, setThemeMode] = useState<Theme>('system');
  const theme: ResolvedTheme = themeMode === 'system' ? systemTheme : themeMode;
  const { setColorScheme } = useNWColorScheme();

  // react-native-css-interop's colorScheme.set() calls Appearance.setColorScheme()
  // UNCONDITIONALLY — no equality check — and every call invalidates every
  // appearance-dependent style, i.e. all 841 `dark:` sites. setTheme applies the
  // scheme eagerly (so the className channel starts moving in the same frame as
  // the press) and the effect below applies it again once React has re-rendered,
  // so a single toggle used to invalidate the whole tree twice. Remember what we
  // last pushed and skip the redundant call.
  const appliedSchemeRef = useRef<ResolvedTheme | null>(null);
  const applyScheme = useCallback(
    (next: ResolvedTheme) => {
      if (appliedSchemeRef.current === next) return;
      appliedSchemeRef.current = next;
      try {
        setColorScheme(next);
      } catch (e) {
        console.warn('[theme] setColorScheme failed', e);
      }
    },
    [setColorScheme],
  );

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeMode(t);
      // Resolve immediately so the className channel starts moving in the same
      // frame as the press; the effect below keeps it synced if the device
      // appearance changes later.
      applyScheme(t === 'system' ? systemTheme : t);
      void saveTheme(t).catch((e: unknown) => console.warn('[theme] saveTheme failed', e));
    },
    [applyScheme, systemTheme],
  );

  useEffect(() => {
    applyScheme(theme);
  }, [applyScheme, theme]);

  const hydrateTheme = useCallback(
    (saved?: Theme | null) => {
      if (saved) setThemeMode(saved);
      applyScheme(saved === 'system' || !saved ? systemTheme : saved);
    },
    [applyScheme, systemTheme],
  );

  // Memoised: this object is the ThemeContext value, so a fresh literal every
  // render would re-render all ~18 theme consumers on EVERY store update
  // (each keystroke, each session change) instead of only on a theme change.
  return useMemo(
    () => ({ themeMode, theme, setTheme, hydrateTheme }),
    [themeMode, theme, setTheme, hydrateTheme],
  );
}
