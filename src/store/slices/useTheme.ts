// Theme slice — light/dark/system preference, NativeWind color-scheme sync,
// and the saved-preference hydration used during boot.
import { useCallback, useEffect, useState } from 'react';
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

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeMode(t);
      // Resolve immediately to avoid a one-frame flash; the effect below keeps
      // NativeWind synced if the device appearance changes later.
      try {
        setColorScheme(t === 'system' ? systemTheme : t);
      } catch (e) {
        console.warn('[theme] setColorScheme failed', e);
      }
      void saveTheme(t).catch((e: unknown) => console.warn('[theme] saveTheme failed', e));
    },
    [setColorScheme, systemTheme],
  );

  useEffect(() => {
    try {
      setColorScheme(theme);
    } catch (e) {
      console.warn('[theme] sync colorScheme failed', e);
    }
  }, [setColorScheme, theme]);

  const hydrateTheme = useCallback(
    (saved?: Theme | null) => {
      if (saved) setThemeMode(saved);
      try {
        setColorScheme(saved === 'system' || !saved ? systemTheme : saved);
      } catch (e) {
        console.warn('[theme] hydrate colorScheme failed', e);
      }
    },
    [setColorScheme, systemTheme],
  );

  return { themeMode, theme, setTheme, hydrateTheme };
}
