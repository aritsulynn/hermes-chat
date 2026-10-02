// Local-notifications slice — the persisted enable flag, OS permission
// reconciliation, and the foreground recheck. The `notifyRef` mirrors the
// state so handlers frozen inside openWs can read it without re-subscribing.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { getNotifyEnabled, saveNotifyEnabled } from '../../services/connection';
import { notifyPermissionGranted, requestNotifyPermission } from '../../services/notifications';

export interface NotificationsSlice {
  notifyEnabled: boolean;
  notifyRef: MutableRefObject<boolean>;
  setNotifications: (on: boolean) => Promise<void>;
  /** Restore the persisted preference at boot, reconciled with OS permission. */
  loadNotifications: (isCancelled?: () => boolean) => Promise<boolean>;
}

export function useNotificationsSlice(): NotificationsSlice {
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const notifyRef = useRef(false);
  notifyRef.current = notifyEnabled;

  // While a turn runs in another tab, re-check that permission is still granted
  // whenever this one comes back to the foreground — the user can revoke it
  // from the browser's own UI at any time, with no event we can observe.
  useEffect(() => {
    const recheck = () => {
      if (document.hidden || !notifyRef.current) return;
      void notifyPermissionGranted().then((granted) => {
        if (!granted && notifyRef.current) setNotifyEnabled(false);
      });
    };
    document.addEventListener('visibilitychange', recheck);
    return () => document.removeEventListener('visibilitychange', recheck);
  }, []);

  // Local notifications: request permission on enable (web needs the gesture).
  const setNotifications = useCallback(async (on: boolean) => {
    if (!on) {
      setNotifyEnabled(false);
      await saveNotifyEnabled(false);
      return;
    }
    const ok = await requestNotifyPermission();
    setNotifyEnabled(ok);
    await saveNotifyEnabled(ok);
  }, []);

  const loadNotifications = useCallback(async (isCancelled?: () => boolean) => {
    const savedNotify = await getNotifyEnabled().catch(() => false);
    const effectiveNotify = savedNotify ? await notifyPermissionGranted() : false;
    if (!isCancelled?.()) {
      setNotifyEnabled(effectiveNotify);
      if (savedNotify && !effectiveNotify) await saveNotifyEnabled(false);
    }
    return effectiveNotify;
  }, []);

  return { notifyEnabled, notifyRef, setNotifications, loadNotifications };
}
