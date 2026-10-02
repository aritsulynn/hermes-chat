// Native-shell detection.
//
// Capacitor and (later) Electron both load the same `dist/` bundle outside a
// normal http host — `capacitor://localhost`, `file://` — where history routing
// and absolute asset URLs break. This module is the single place that answers
// "are we inside a native shell?", so features never import `@capacitor/core`
// directly and Electron can become a second `||` here instead of a refactor.
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

/** True inside Capacitor (and later, any native shell we add here). */
export function isNativeShell(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * One-time native chrome setup, called from `<App>` on mount.
 *
 * The WebView draws edge-to-edge, so the status bar lands on top of whatever
 * the topmost screen drew — the drawer's "Hermes" header, the chat header.
 * The screens do pad with `env(safe-area-inset-top)`, but that reads 0 in a
 * WebView whose window never told Chromium about the inset. Rather than
 * chasing every header, lay the WebView out *below* the status bar: every
 * screen clears it at once, and the `env()` extras elsewhere harmlessly read
 * 0. Web is untouched (this returns before touching the plugin).
 */
export async function initNativeChrome(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {
    // Old shells without the plugin: the CSS `env()` insets stay the fallback.
  }
}

/**
 * Keep the status-bar icons readable against whatever the app drew behind
 * them. Edge-to-edge is enforced on current Android, so the bar is
 * transparent and its icons float over the topmost screen.
 *
 * Watch the naming: Capacitor's `Style` describes the BAR, not the text —
 * `Dark` is a dark bar with light icons, `Light` is a light bar with dark
 * icons (see StatusBar.java: `setAppearanceLightStatusBars(!style == DARK)`).
 * Dark theme (black top) therefore wants `Style.Dark`. Getting this backwards
 * shows nothing at all — dark icons on a black top read as a "missing" clock.
 * Call whenever `theme` changes.
 */
export async function syncStatusBarStyle(dark: boolean): Promise<void> {
  if (!isNativeShell()) return;
  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
  } catch {
    // Cosmetic only — never break boot for an icon colour.
  }
}
