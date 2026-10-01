// Local notifications for turn completion and server asks.
//
// ── Scope note: what this module can and cannot do ───────────────────────────
// The browser Notification API only supports a click: it cannot carry action
// buttons, and it cannot be raised while the tab is closed without a Service
// Worker plus server-side Web Push. So an ask cannot be answered from the
// notification itself.
//
// Answering an ask is therefore **in-app only** — Ask Inbox, reachable from
// More → Ask Inbox. That is a real feature gap, tracked as the Web Push
// backlog item. It is not a bug.
//
// Notifications only fire while the tab is in the BACKGROUND: in the foreground
// the ask sheet / transcript already show the same thing, and a banner would
// just duplicate it.

export interface HermesNotificationOptions {
  data?: Record<string, unknown>;
}

/**
 * A tap handler receives the `data` the notification was raised with. The
 * gateway puts the ask/request identifiers in there, which is how a tap can be
 * routed to the right inbox entry.
 */
export type HermesNotificationTapHandler = (data: Record<string, unknown>) => void;

let tapHandler: HermesNotificationTapHandler | null = null;

/**
 * Touching the `Notification` constructor can throw in a sandboxed frame, so it
 * is only ever reached through these two helpers.
 */
function ctor(): typeof Notification | null {
  try {
    return (globalThis as { Notification?: typeof Notification }).Notification ?? null;
  } catch {
    return null;
  }
}

export function notificationsSupported(): boolean {
  return ctor() !== null;
}

export async function notifyPermissionGranted(): Promise<boolean> {
  try {
    return ctor()?.permission === 'granted';
  } catch {
    return false;
  }
}

/**
 * Ask for notification permission. Browsers only allow this from a user
 * gesture, so it has to be called from a click handler — the Settings toggle
 * is that gesture, which is why permission is requested there and not on boot.
 */
export async function requestNotifyPermission(): Promise<boolean> {
  try {
    const N = ctor();
    if (!N) return false;
    if (N.permission === 'granted') return true;
    if (N.permission === 'denied') return false;
    return (await N.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export function isAppForeground(): boolean {
  try {
    const d = globalThis.document;
    return !d || d.visibilityState !== 'hidden';
  } catch {
    return true;
  }
}

/** Show a notification — a no-op when the tab is visible or permission was
 *  never granted. Returns nothing: the browser Notification object has no
 *  stable identifier, and nothing downstream could act on one anyway (there is
 *  no `dismissNotification` equivalent once the banner is on screen). */
export async function pushNotification(
  title: string,
  body: string,
  options: HermesNotificationOptions = {},
): Promise<void> {
  if (isAppForeground()) return;
  try {
    const N = ctor();
    if (!N || N.permission !== 'granted') return;
    const notification = new N(title, { body, data: options.data });
    notification.onclick = () => {
      // Bring the tab forward; without this the user taps the banner and appears
      // to get nothing, because the click landed on a window that is behind
      // whatever they are looking at.
      try {
        globalThis.window?.focus?.();
      } catch {}
      tapHandler?.(options.data ?? {});
    };
  } catch {
    // A failed banner must never interrupt the turn that raised it.
  }
}

/**
 * Observe notification taps. Returns an unsubscribe function.
 *
 * There is no cold-start equivalent: the browser does not retain a
 * "last responded notification" for a page, and a click on a banner for a page
 * that is already loaded is a plain `onclick`. A tap that arrives before the
 * store has subscribed is therefore dropped rather than queued — the user lands
 * on the app and sees current state, which is the correct outcome anyway.
 */
export function onNotificationTapped(cb: HermesNotificationTapHandler): () => void {
  tapHandler = cb;
  return () => {
    if (tapHandler === cb) tapHandler = null;
  };
}
