// Ask-replies slice — sending a reply to a server ask (foreground or inbox),
// opening the owning session, and the biometric confirm for sensitive asks.
import { useCallback } from 'react';
import { navigate } from '../nav';
import { findAsk, findAskByRpc } from '../../services/ask-inbox';
import type { AskInboxEntry } from '../../services/ask-inbox';
import { connectionScope } from '../../services/connection';
import { errMsg } from '../../utils/messages';
import { normalizeProfileName, parseProfileSessionKey, serverAskFromInbox } from '../helpers';
import type { StoreCtx } from '../ctx';

export interface AskRepliesSlice {
  respondToInbox: (key: string, result: Record<string, unknown>) => boolean;
  answerInboxValue: (key: string, value: string) => boolean;
  answerInboxApproval: (key: string, choice: string) => boolean;
  openAskEntry: (entry: AskInboxEntry) => Promise<void>;
  answerAsk: (result: Record<string, unknown>) => boolean;
  answerValue: (value: string) => void;
  answerApproval: (choice: string) => boolean;
  dismissAsk: () => void;
}

export function useAskRepliesSlice({
  askRef,
  askInboxRef,
  setAsk,
  markAskStatus,
  latest,
  sessionIdRef,
  openSessionRef,
  setError,
  gw,
  activeProfileRef,
  runtimeOwners,
}: StoreCtx): AskRepliesSlice {

  const respondToInbox = useCallback(
    (key: string, result: Record<string, unknown>) => {
      const entry = findAsk(askInboxRef.current, key);
      const g = gw.current;
      if (!entry || !g || entry.owner.connectionId !== connectionScope(latest.current.host, latest.current.username)) return false;
      if (entry.owner.profile !== normalizeProfileName(activeProfileRef.current)) return false;
      if (entry.status !== 'pending' && entry.status !== 'answering') return false;
      if (!g.replyToAsk(entry.rpcId, result)) return false;
      markAskStatus(entry.key, 'sent');
      // JSON-RPC has no positive acknowledgement. Give the gateway a moment
      // to settle the request, then reconcile against open_requests.
      if (entry.sessionId) {
        setTimeout(() => {
          if (gw.current === g) void g.syncOpenRequests([entry.sessionId as string]);
        }, 500);
      }
      return true;
    },
    [markAskStatus],
  );

  const answerInboxValue = useCallback(
    (key: string, value: string) => respondToInbox(key, { value }),
    [respondToInbox],
  );

  const answerInboxApproval = useCallback(
    (key: string, choice: string) => respondToInbox(key, { choice }),
    [respondToInbox],
  );

  const openAskEntry = useCallback(async (entry: AskInboxEntry) => {
    if (!entry) return;
    if (entry.status === 'sent') {
      setError('This response was sent but not confirmed yet. Reconnect or refresh Ask Inbox.');
      return;
    }
    if (entry.status !== 'pending' && entry.status !== 'answering') return;
    if (!entry.owner.resolved || !entry.owner.storedSessionId) {
      setError('This background request has no resolved profile yet. Open its session to answer it safely.');
      navigate('/asks');
      return;
    }
    if (entry.owner.profile !== activeProfileRef.current) {
      setError(`Switch to profile “${entry.owner.profile}” before answering this request.`);
      return;
    }
    try {
      await openSessionRef.current({
        id: entry.owner.storedSessionId,
        title: '',
        preview: '',
        messageCount: 0,
        source: 'ask-inbox',
        startedAt: Date.now() / 1000,
        profile: entry.owner.profile,
      });
      // openSession may have restored a fresh runtime id; show the same
      // pending request only after the target room is actually active.
      const activeOwner = sessionIdRef.current
        ? parseProfileSessionKey(runtimeOwners.current.get(sessionIdRef.current) ?? '')
        : null;
      if (
        activeOwner?.profile !== entry.owner.profile ||
        activeOwner?.storedSessionId !== entry.owner.storedSessionId
      ) {
        setError('Could not open the owning session; the request remains in Ask Inbox.');
        return;
      }
      const refreshed = findAskByRpc(askInboxRef.current, connectionScope(latest.current.host, latest.current.username), entry.rpcId) ?? entry;
      setAsk(serverAskFromInbox(refreshed));
      navigate('/chat');
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  const answerAsk = useCallback(
    (result: Record<string, unknown>) => {
      const current = askRef.current;
      if (!current || !gw.current) return false;
      const entry = askInboxRef.current.find(
        (item) =>
          item.owner.connectionId === connectionScope(latest.current.host, latest.current.username) &&
          item.rpcId === current.rpcId,
      );
      return entry ? respondToInbox(entry.key, result) : false;
    },
    [respondToInbox],
  );

  const answerValue = useCallback(
    (value: string) => {
      answerAsk({ value });
    },
    [answerAsk],
  );

  const answerApproval = useCallback((choice: string) => answerAsk({ choice }), [answerAsk]);

  const dismissAsk = useCallback(() => setAsk(null), [setAsk]);

  // `confirmSensitiveNotification` used to sit here: a biometric gate in front
  // of answering an ask from a notification. Its only caller was the
  // notification-reply flow, so it went with it. The browser's equivalent is
  // WebAuthn (`navigator.credentials.get` against a passkey), which is a
  // different mechanism with a server-side challenge and an origin-bound RP id.
  // It belongs to the same Web Push backlog item as the reply flow it guarded.

  return {
    respondToInbox,
    answerInboxValue,
    answerInboxApproval,
    openAskEntry,
    answerAsk,
    answerValue,
    answerApproval,
    dismissAsk,
  };
}
