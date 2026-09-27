// Notification-response routing slice — turns a notification tap/action into an
// ask-inbox reply, queueing responses that arrive before the gateway/ask state
// is ready. Owns the response queue refs; the provider reads them from the WS
// lifecycle (hydration / logout).
import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { router } from 'expo-router';
import { findAsk, findAskByRpc } from '../../services/ask-inbox';
import { connectionScope } from '../../services/connection';
import {
  ensureAndroidChannel,
  ensureNotificationCategories,
  NOTIFICATION_ASK_ANSWER,
  NOTIFICATION_ASK_APPROVE,
  NOTIFICATION_ASK_OPEN,
  NOTIFICATION_ASK_REJECT,
  NOTIFICATION_DEFAULT_ACTION,
  onNotificationResponse,
} from '../../services/notifications';
import type { HermesNotificationResponse } from '../../services/notifications';
import { normalizeProfileName, notificationResponseKey } from '../helpers';
import type { StoreCtx } from '../ctx';

export interface NotificationResponsesSlice {
  pendingNotificationResponsesRef: MutableRefObject<HermesNotificationResponse[]>;
  notificationDrainRef: MutableRefObject<(() => void) | null>;
  notificationActionInFlightRef: MutableRefObject<boolean>;
  askHydrationRef: MutableRefObject<number>;
  handledNotificationResponsesRef: MutableRefObject<Set<string>>;
  queueNotificationResponse: (response: HermesNotificationResponse) => void;
  clearQueuedNotificationResponse: (response?: HermesNotificationResponse) => void;
  handleNotificationResponse: (response: HermesNotificationResponse) => void;
  drainPendingNotificationResponse: () => void;
}

export function useNotificationResponsesSlice({
  askInboxRef,
  answerInboxApproval,
  answerInboxValue,
  openAskEntry,
  respondToInbox,
  confirmSensitiveNotification,
  latest,
  gw,
  activeProfileRef,
}: StoreCtx): NotificationResponsesSlice {
  const pendingNotificationResponsesRef = useRef<HermesNotificationResponse[]>([]);
  const notificationDrainRef = useRef<(() => void) | null>(null);
  const notificationActionInFlightRef = useRef(false);
  const askHydrationRef = useRef(0);
  const handledNotificationResponsesRef = useRef<Set<string>>(new Set());

  const queueNotificationResponse = useCallback((response: HermesNotificationResponse) => {
    const key = notificationResponseKey(response);
    if (handledNotificationResponsesRef.current.has(key)) return;
    if (pendingNotificationResponsesRef.current.some((item) => notificationResponseKey(item) === key)) return;
    pendingNotificationResponsesRef.current = [...pendingNotificationResponsesRef.current, response];
  }, []);
  const clearQueuedNotificationResponse = useCallback((response?: HermesNotificationResponse) => {
    if (!response) {
      pendingNotificationResponsesRef.current = [];
      return;
    }
    const key = notificationResponseKey(response);
    pendingNotificationResponsesRef.current = pendingNotificationResponsesRef.current.filter(
      (item) => notificationResponseKey(item) !== key,
    );
  }, []);

  // Notification taps/actions are routed through the ask inbox. A cold-start
  // response is held until the handler is ready (the drain effect below).
  useEffect(() => {
    void ensureAndroidChannel();
    void ensureNotificationCategories();
    const unsub = onNotificationResponse((response) => {
      queueNotificationResponse(response);
      notificationDrainRef.current?.();
    });
    return () => unsub?.();
  }, []);

  const handleNotificationResponse = useCallback(
    (response: HermesNotificationResponse) => {
      const data = response.data;
      const responseKey = notificationResponseKey(response);
      if (handledNotificationResponsesRef.current.has(responseKey)) return;
      const currentConnectionId = connectionScope(latest.current.host, latest.current.username);
      if (typeof data.connectionId === 'string' && currentConnectionId && data.connectionId !== currentConnectionId) {
        return;
      }
      if (!currentConnectionId || !gw.current || askHydrationRef.current > 0) {
        queueNotificationResponse(response);
        return;
      }
      const key = typeof data.askKey === 'string' ? data.askKey : '';
      const rpcId = typeof data.rpcId === 'string' ? data.rpcId : '';
      const entry =
        (key ? findAsk(askInboxRef.current, key) : undefined) ??
        (rpcId ? findAskByRpc(askInboxRef.current, connectionScope(latest.current.host, latest.current.username), rpcId) : undefined);
      if (!entry) {
        if (!key && !rpcId) {
          if (response.actionIdentifier === NOTIFICATION_DEFAULT_ACTION) {
            handledNotificationResponsesRef.current.add(responseKey);
            router.push('/chat');
          }
          return;
        }
        queueNotificationResponse(response);
        router.push('/asks' as any);
        return;
      }

      // Background asks must never be actioned against a different profile.
      // Unresolved owners fail closed into the inbox rather than guessing.
      if (!entry.owner.profile || entry.owner.profile !== normalizeProfileName(activeProfileRef.current)) {
        queueNotificationResponse(response);
        router.push('/asks' as any);
        return;
      }

      if (response.actionIdentifier === NOTIFICATION_ASK_APPROVE) {
        const choices = Array.isArray(entry.params.choices) ? entry.params.choices.map(String) : [];
        if (!choices.includes('once')) {
          handledNotificationResponsesRef.current.add(responseKey);
          void openAskEntry(entry);
          return;
        }
        if (notificationActionInFlightRef.current) return;
        notificationActionInFlightRef.current = true;
        void (async () => {
          try {
            if (!(await confirmSensitiveNotification())) {
              handledNotificationResponsesRef.current.add(responseKey);
              router.push('/asks' as any);
              return;
            }
            const current = findAskByRpc(askInboxRef.current, connectionScope(latest.current.host, latest.current.username), entry.rpcId);
            if (!current) {
              queueNotificationResponse(response);
              return;
            }
            if (answerInboxApproval(current.key, 'once')) {
              handledNotificationResponsesRef.current.add(responseKey);
            } else {
              queueNotificationResponse(response);
              router.push('/asks' as any);
            }
          } finally {
            notificationActionInFlightRef.current = false;
            const queued = pendingNotificationResponsesRef.current.find(
              (item) => notificationResponseKey(item) === responseKey,
            );
            if (handledNotificationResponsesRef.current.has(responseKey)) {
              if (queued) clearQueuedNotificationResponse(queued);
            } else if (
              pendingNotificationResponsesRef.current.some((item) => notificationResponseKey(item) !== responseKey)
            ) {
              notificationDrainRef.current?.();
            }
          }
        })();
        return;
      }

      if (response.actionIdentifier === NOTIFICATION_ASK_REJECT) {
        const choices = Array.isArray(entry.params.choices) ? entry.params.choices.map(String) : [];
        if (choices.length > 0 && !choices.includes('deny')) {
          handledNotificationResponsesRef.current.add(responseKey);
          void openAskEntry(entry);
          return;
        }
        if (notificationActionInFlightRef.current) return;
        notificationActionInFlightRef.current = true;
        void (async () => {
          try {
            if (!(await confirmSensitiveNotification())) {
              handledNotificationResponsesRef.current.add(responseKey);
              router.push('/asks' as any);
              return;
            }
            const current = findAskByRpc(askInboxRef.current, connectionScope(latest.current.host, latest.current.username), entry.rpcId);
            if (!current) {
              queueNotificationResponse(response);
              return;
            }
            if (answerInboxApproval(current.key, 'deny')) {
              handledNotificationResponsesRef.current.add(responseKey);
            } else {
              queueNotificationResponse(response);
              router.push('/asks' as any);
            }
          } finally {
            notificationActionInFlightRef.current = false;
            const queued = pendingNotificationResponsesRef.current.find(
              (item) => notificationResponseKey(item) === responseKey,
            );
            if (handledNotificationResponsesRef.current.has(responseKey)) {
              if (queued) clearQueuedNotificationResponse(queued);
            } else if (
              pendingNotificationResponsesRef.current.some((item) => notificationResponseKey(item) !== responseKey)
            ) {
              notificationDrainRef.current?.();
            }
          }
        })();
        return;
      }

      if (response.actionIdentifier === NOTIFICATION_ASK_ANSWER) {
        const text = String(response.userText ?? '').trim();
        if (!text) {
          handledNotificationResponsesRef.current.add(responseKey);
          void openAskEntry(entry);
          return;
        }
        if (notificationActionInFlightRef.current) return;
        notificationActionInFlightRef.current = true;
        void (async () => {
          try {
            if (!(await confirmSensitiveNotification())) {
              handledNotificationResponsesRef.current.add(responseKey);
              router.push('/asks' as any);
              return;
            }
            const current = findAskByRpc(askInboxRef.current, connectionScope(latest.current.host, latest.current.username), entry.rpcId);
            if (!current || current.owner.profile !== normalizeProfileName(activeProfileRef.current)) {
              queueNotificationResponse(response);
              router.push('/asks' as any);
              return;
            }
            if (current.method === 'clarify') {
              if (Array.isArray(current.params.questions) && current.params.questions.length > 0) {
                handledNotificationResponsesRef.current.add(responseKey);
                void openAskEntry(current);
                return;
              }
              if (respondToInbox(current.key, { answer: text })) {
                handledNotificationResponsesRef.current.add(responseKey);
              } else {
                queueNotificationResponse(response);
                router.push('/asks' as any);
              }
            } else if (answerInboxValue(current.key, text)) {
              handledNotificationResponsesRef.current.add(responseKey);
            } else {
              queueNotificationResponse(response);
              router.push('/asks' as any);
            }
          } finally {
            notificationActionInFlightRef.current = false;
            const queued = pendingNotificationResponsesRef.current.find(
              (item) => notificationResponseKey(item) === responseKey,
            );
            if (handledNotificationResponsesRef.current.has(responseKey)) {
              if (queued) clearQueuedNotificationResponse(queued);
            } else if (
              pendingNotificationResponsesRef.current.some((item) => notificationResponseKey(item) !== responseKey)
            ) {
              notificationDrainRef.current?.();
            }
          }
        })();
        return;
      }

      if (response.actionIdentifier === NOTIFICATION_ASK_OPEN) {
        handledNotificationResponsesRef.current.add(responseKey);
        void openAskEntry(entry);
        return;
      }
      if (response.actionIdentifier === NOTIFICATION_DEFAULT_ACTION) {
        handledNotificationResponsesRef.current.add(responseKey);
        router.push('/asks' as any);
      }
    },
    [answerInboxApproval, answerInboxValue, confirmSensitiveNotification, openAskEntry, respondToInbox],
  );

  const drainPendingNotificationResponse = useCallback(() => {
    if (notificationActionInFlightRef.current) return;
    const pending = pendingNotificationResponsesRef.current[0];
    if (!pending) return;
    pendingNotificationResponsesRef.current = pendingNotificationResponsesRef.current.slice(1);
    void handleNotificationResponse(pending);
  }, [handleNotificationResponse]);
  notificationDrainRef.current = drainPendingNotificationResponse;
  useEffect(() => {
    drainPendingNotificationResponse();
    return () => {
      if (notificationDrainRef.current === drainPendingNotificationResponse) {
        notificationDrainRef.current = null;
      }
    };
  }, [drainPendingNotificationResponse]);

  return {
    pendingNotificationResponsesRef,
    notificationDrainRef,
    notificationActionInFlightRef,
    askHydrationRef,
    handledNotificationResponsesRef,
    queueNotificationResponse,
    clearQueuedNotificationResponse,
    handleNotificationResponse,
    drainPendingNotificationResponse,
  };
}
