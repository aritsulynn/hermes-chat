// Local-notifications slice — the persisted enable flag, OS permission
// reconciliation, and the foreground recheck. The `notifyRef` mirrors the
// state so handlers frozen inside openWs can read it without re-subscribing.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { AppState } from 'react-native';
import { getNotifyEnabled, saveNotifyEnabled } from '../../lib/connection';
import { notifyPermissionGranted, requestNotifyPermission } from '../../lib/notifications';

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

  // While a turn runs in the background, re-check that permission is still
  // granted whenever the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !notifyRef.current) return;
      void notifyPermissionGranted().then((granted) => {
        if (!granted && notifyRef.current) setNotifyEnabled(false);
      });
    });
    return () => sub.remove();
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
