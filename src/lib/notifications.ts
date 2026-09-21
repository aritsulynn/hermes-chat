// Local notifications for turn completion and server asks.
//
// Native uses expo-notifications (lazy require so the web bundle never evaluates
// it); web uses the browser Notification API, which needs a user gesture to ask
// for permission — so it's requested from the Settings toggle.
//
// Notifications only fire while the app is in the BACKGROUND: in the foreground
// the ask sheet / transcript already show the same thing, and a banner would just
// duplicate it.
import { AppState, Platform } from 'react-native';

let cached: any = null;

function nativeNotifications(): any {
  if (Platform.OS === 'web') return null;
  if (cached !== null) return cached || null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-notifications');
    try {
      mod.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
    } catch {}
    cached = mod;
  } catch {
    cached = false;
  }
  return cached || null;
}

export function notificationsSupported(): boolean {
  if (Platform.OS === 'web') return typeof (globalThis as any).Notification !== 'undefined';
  return !!nativeNotifications();
}

export async function notifyPermissionGranted(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') return (globalThis as any).Notification?.permission === 'granted';
    const N = nativeNotifications();
    if (!N) return false;
    return !!(await N.getPermissionsAsync())?.granted;
  } catch {
    return false;
  }
}

/** Ask for notification permission (must run from a user gesture on web). */
export async function requestNotifyPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      const N = (globalThis as any).Notification;
      if (!N) return false;
      if (N.permission === 'granted') return true;
      if (N.permission === 'denied') return false;
      return (await N.requestPermission()) === 'granted';
    }
    const N = nativeNotifications();
    if (!N) return false;
    if ((await N.getPermissionsAsync())?.granted) return true;
    return !!(await N.requestPermissionsAsync())?.granted;
  } catch {
    return false;
  }
}

export function isAppForeground(): boolean {
  try {
    if (Platform.OS === 'web') {
      const d: any = (globalThis as any).document;
      return !d || d.visibilityState !== 'hidden';
    }
    return AppState.currentState === 'active';
  } catch {
    return true;
  }
}

/** Show a local notification — a no-op when the app is foregrounded or the
 *  permission was never granted. */
export async function pushNotification(title: string, body: string): Promise<void> {
  if (isAppForeground()) return;
  try {
    if (Platform.OS === 'web') {
      const N = (globalThis as any).Notification;
      if (!N || N.permission !== 'granted') return;
      // eslint-disable-next-line no-new
      new N(title, { body });
      return;
    }
    const N = nativeNotifications();
    if (!N) return;
    await N.scheduleNotificationAsync({ content: { title, body }, trigger: null });
  } catch {}
}
