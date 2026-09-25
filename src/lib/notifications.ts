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
let browserResponseHandler: ((response: HermesNotificationResponse) => void) | null = null;

export interface HermesNotificationOptions {
  data?: Record<string, unknown>;
  categoryIdentifier?: string;
  identifier?: string;
}

export interface HermesNotificationResponse {
  actionIdentifier: string;
  data: Record<string, unknown>;
  userText?: string;
}

export const NOTIFICATION_DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';
export const NOTIFICATION_LEGACY_DEFAULT_ACTION = 'default';
export const NOTIFICATION_ASK_APPROVE = 'hermes.ask.approve';
export const NOTIFICATION_ASK_REJECT = 'hermes.ask.reject';
export const NOTIFICATION_ASK_ANSWER = 'hermes.ask.answer';
export const NOTIFICATION_ASK_OPEN = 'hermes.ask.open';

const ASK_CATEGORY_APPROVAL = 'hermes.ask.approval.v1';
const ASK_CATEGORY_CLARIFY = 'hermes.ask.clarify.v1';
const ASK_CATEGORY_INPUT = 'hermes.ask.input.v1';
let categoriesReady = false;

/** Expo Go (SDK 53+) removed push-notification support entirely — even
 *  `require('expo-notifications')` throws an uncaught redbox, so never touch
 *  the module there. Real devices use a dev build / APK instead. */
function isExpoGo(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-constants');
    const Constants = mod?.default ?? mod;
    return Constants?.appOwnership === 'expo';
  } catch {
    return false;
  }
}

function nativeNotifications(): any {
  if (Platform.OS === 'web') return null;
  if (cached !== null) return cached || null;
  if (isExpoGo()) {
    cached = false;
    return null;
  }
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

/**
 * Register native ask actions once. The web Notification API has no category
 * buttons, so web falls back to opening the in-app Ask Inbox.
 */
export async function ensureNotificationCategories(): Promise<void> {
  if (Platform.OS === 'web' || categoriesReady) return;
  const N = nativeNotifications();
  if (!N?.setNotificationCategoryAsync) return;
  try {
    await Promise.all([
      N.setNotificationCategoryAsync(ASK_CATEGORY_APPROVAL, [
        {
          identifier: NOTIFICATION_ASK_APPROVE,
          buttonTitle: 'Allow once',
          options: {
            opensAppToForeground: true,
            isAuthenticationRequired: true,
          },
        },
        {
          identifier: NOTIFICATION_ASK_REJECT,
          buttonTitle: 'Reject',
          options: {
            opensAppToForeground: true,
            isDestructive: true,
            isAuthenticationRequired: true,
          },
        },
        {
          identifier: NOTIFICATION_ASK_OPEN,
          buttonTitle: 'Open Hermes',
          options: { opensAppToForeground: true },
        },
      ]),
      N.setNotificationCategoryAsync(ASK_CATEGORY_CLARIFY, [
        {
          identifier: NOTIFICATION_ASK_ANSWER,
          buttonTitle: 'Answer',
          options: {
            opensAppToForeground: true,
            isAuthenticationRequired: true,
            textInput: {
              submitButtonTitle: 'Send',
              placeholder: 'Type your answer…',
            },
          },
        },
        {
          identifier: NOTIFICATION_ASK_OPEN,
          buttonTitle: 'Open Hermes',
          options: { opensAppToForeground: true },
        },
      ]),
      // Secrets and vault codes must never be entered from a lock-screen
      // notification. The only safe action is opening the authenticated app.
      N.setNotificationCategoryAsync(ASK_CATEGORY_INPUT, [
        {
          identifier: NOTIFICATION_ASK_OPEN,
          buttonTitle: 'Open Hermes',
          options: { opensAppToForeground: true },
        },
      ]),
    ]);
    categoriesReady = true;
  } catch {}
}

export function askNotificationCategory(method?: string): string {
  if (method === 'approval') return ASK_CATEGORY_APPROVAL;
  if (method === 'clarify') return ASK_CATEGORY_CLARIFY;
  return ASK_CATEGORY_INPUT;
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

/** Android 8+ drops channel-less notifications on many devices — create ours
 *  once (idempotent, no permission needed). */
let channelReady = false;

export async function ensureAndroidChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android') return;
  try {
    const N = nativeNotifications();
    if (!N?.setNotificationChannelAsync) return;
    await N.setNotificationChannelAsync('hermes-alerts', {
      name: 'Hermes alerts',
      importance: N.AndroidImportance?.HIGH ?? 4,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1a73e8',
    });
    channelReady = true;
  } catch {}
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
export async function pushNotification(
  title: string,
  body: string,
  options: HermesNotificationOptions = {},
): Promise<string | null> {
  if (isAppForeground()) return null;
  try {
    if (Platform.OS === 'web') {
      const N = (globalThis as any).Notification;
      if (!N || N.permission !== 'granted') return null;
      // eslint-disable-next-line no-new
      const notification = new N(title, { body, data: options.data });
      notification.onclick = () => {
        try {
          (globalThis as any).window?.focus?.();
        } catch {}
        browserResponseHandler?.({
          actionIdentifier: NOTIFICATION_DEFAULT_ACTION,
          data: options.data ?? {},
        });
      };
      return null;
    }
    const N = nativeNotifications();
    if (!N) return null;
    await ensureAndroidChannel();
    if (options.categoryIdentifier) await ensureNotificationCategories();
    return (await N.scheduleNotificationAsync({
      ...(options.identifier ? { identifier: options.identifier } : {}),
      content: {
        title,
        body,
        ...(options.data ? { data: options.data } : {}),
        ...(options.categoryIdentifier ? { categoryIdentifier: options.categoryIdentifier } : {}),
      },
      trigger: Platform.OS === 'android' ? { channelId: 'hermes-alerts' } : null,
    })) as string;
  } catch {
    return null;
  }
}

/** Remove a scheduled notification by its stable identifier. */
export async function dismissNotification(identifier?: string): Promise<void> {
  if (!identifier || Platform.OS === 'web') return;
  try {
    const N = nativeNotifications();
    await N?.dismissNotificationAsync?.(identifier);
  } catch {}
}

function normalizeNotificationResponse(response: any): HermesNotificationResponse | null {
  if (!response) return null;
  const data = response?.notification?.request?.content?.data;
  const rawAction = String(response?.actionIdentifier ?? NOTIFICATION_DEFAULT_ACTION);
  const actionIdentifier = rawAction === NOTIFICATION_LEGACY_DEFAULT_ACTION ? NOTIFICATION_DEFAULT_ACTION : rawAction;
  return {
    actionIdentifier,
    data: data && typeof data === 'object' ? data : {},
    ...(typeof response?.userText === 'string' ? { userText: response.userText } : {}),
  };
}

/**
 * Observe notification taps/actions. Also consumes the last response so an app
 * launched from a notification action can handle the action after the gateway
 * reconnects. Returns an unsubscribe function.
 */
export function onNotificationResponse(cb: (response: HermesNotificationResponse) => void): (() => void) | null {
  try {
    if (Platform.OS === 'web') {
      browserResponseHandler = cb;
      return () => {
        if (browserResponseHandler === cb) browserResponseHandler = null;
      };
    }
    const N = nativeNotifications();
    if (!N?.addNotificationResponseReceivedListener) return null;
    const deliver = (response: any) => {
      const normalized = normalizeNotificationResponse(response);
      if (normalized) cb(normalized);
    };
    const sub = N.addNotificationResponseReceivedListener(deliver);
    // Cold-start path. The API is async in SDK 57; older builds simply do not
    // expose it and the listener remains the fallback.
    void N.getLastNotificationResponseAsync?.()
      .then?.(deliver)
      .catch?.(() => {});
    return () => {
      try {
        sub?.remove?.();
      } catch {}
    };
  } catch {
    return null;
  }
}

