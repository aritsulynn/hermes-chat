// Turn slice — the turn engine: beginTurn / runSlash / edit / regenerate /
// pasteLarge / send / releaseLocalTurn / stop.
import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { isSlashCommand, nid, errMsg, parseSlashCommand, utf8ToBase64 } from '../../utils/messages';
import type { Attachment, Role, UiMessage } from '../../utils/messages';
import { slashBlockedMessage, slashMobileAction, slashMobileHint } from '../../utils/slash-commands';
import { connectionScope } from '../../services/connection';
import type { AskOwner } from '../../services/ask-inbox';
import type { SubagentRow } from '../../utils/messages';
import { cutsWholeTranscript, isImageAttachment, profileSessionKey, uploadAttachments } from '../helpers';
import type { StoreRuntime } from '../runtime';

type LatestRef = MutableRefObject<{ host: string; username: string; activeProfile: string; sessionKey: string | null }>;

export interface TurnSliceDeps {
  runtime: StoreRuntime;
  latest: LatestRef;
  queueParkedRef: MutableRefObject<boolean>;
  activeProfile: string;
  sessionId: string | null;
  sessionKey: string | null;
  generating: boolean;
  input: string;
  attachments: Attachment[];
  setMessages: Dispatch<SetStateAction<UiMessage[]>>;
  setSubagents: Dispatch<SetStateAction<SubagentRow[]>>;
  setGenerating: Dispatch<SetStateAction<boolean>>;
  setToolLine: Dispatch<SetStateAction<string | null>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setEditingRowId: Dispatch<SetStateAction<number | null>>;
  setInput: (v: string) => void;
  setQueueParked: Dispatch<SetStateAction<boolean>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  enqueueQueued: (text: string) => void;
  bindAskOwner: (runtimeSessionId: string, owner: AskOwner) => void;
  clearStreaming: () => void;
  liveAid: MutableRefObject<string | null>;
  liveThinkAid: MutableRefObject<string | null>;
  liveTools: MutableRefObject<Map<string, string>>;
  liveToolAid: MutableRefObject<string | null>;
  liveTurnTools: MutableRefObject<string[]>;
  liveTurnDiffs: MutableRefObject<string[]>;
  turnOwnerRef: MutableRefObject<Map<string, string>>;
  parkedLiveRef: MutableRefObject<Set<string>>;
  lastTurnEventAt: MutableRefObject<number>;
}

export interface TurnSlice {
  beginTurn: (
    submitText: string,
    echo?: { text: string; media?: Attachment[] },
    rewindRowId?: number,
    confirmEmptyTruncate?: boolean,
  ) => Promise<void>;
  runSlash: (raw: string) => Promise<void>;
  editMessage: (id: string) => void;
  cancelEdit: () => void;
  regenerate: () => void;
  pasteLarge: (text: string) => Promise<void>;
  send: (override?: string) => Promise<void>;
  releaseLocalTurn: () => void;
  stop: () => void;
}

export function useTurnSlice(deps: TurnSliceDeps): TurnSlice {
  const {
    runtime,
    latest,
    queueParkedRef,
    activeProfile,
    sessionId,
    sessionKey,
    generating,
    input,
    attachments,
    setMessages,
    setSubagents,
    setGenerating,
    setToolLine,
    setSessionId,
    setEditingRowId,
    setInput,
    setQueueParked,
    setAttachments,
    enqueueQueued,
    bindAskOwner,
    clearStreaming,
    liveAid,
    liveThinkAid,
    liveTools,
    liveToolAid,
    liveTurnTools,
    liveTurnDiffs,
    turnOwnerRef,
    parkedLiveRef,
    lastTurnEventAt,
  } = deps;
  const {
    gw,
    activeProfileRef,
    profileEpochRef,
    connectionEpochRef,
    sessionIdRef,
    runtimeOwners,
    generatingRef,
    messagesRef,
    editingRowRef: editRowRef,
    stampRowIdsRef,
    drainRef,
    sendRef,
    stopRef,
    newSessionRef,
    renameSessionRef,
    releaseLocalTurnRef,
    uploadingRef: uploading,
  } = runtime;

  // Start an agent turn: echo the user line (when this call owns it), pin the
  // pending assistant bubble, submit, and recover from an expired live runtime.
  // Shared by send() and the slash dispatches that expand to a prompt (skills,
  // bundles, /bg-style sends).
  const beginTurn = useCallback(
    async (
      submitText: string,
      echo?: { text: string; media?: Attachment[] },
      rewindRowId?: number,
      confirmEmptyTruncate?: boolean,
    ) => {
      const g = gw.current;
      const sid = sessionId;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      const connectionEpoch = connectionEpochRef.current;
      if (!g || !sid) return;
      const submitOpts =
        rewindRowId != null
          ? {
              rewindRowId,
              ...(confirmEmptyTruncate ? { confirmEmptyTruncate: true } : {}),
            }
          : {};
      const roomKey = sessionKey ?? sid ?? '';
      const owner = profileSessionKey(profile, roomKey);
      const sameRoom = () => {
        if (
          connectionEpochRef.current !== connectionEpoch ||
          activeProfileRef.current !== profile ||
          profileEpochRef.current !== epoch
        )
          return false;
        const currentRuntime = sessionIdRef.current;
        if (!currentRuntime) return false;
        return runtimeOwners.current.get(currentRuntime) === owner || latest.current.sessionKey === roomKey;
      };
      turnOwnerRef.current.set(sid, owner);
      runtimeOwners.current.set(sid, owner);
      bindAskOwner(sid, {
        connectionId: connectionScope(latest.current.host, latest.current.username),
        profile,
        storedSessionId: sessionKey ?? sid,
        runtimeSessionId: sid,
        resolved: true,
      });
      // Rewind: the server cuts history at that user row, so drop the matching
      // local tail first (and re-echo the user line for regenerate, which passes
      // no explicit echo).
      if (rewindRowId != null) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.rowId === rewindRowId);
          return idx >= 0 ? prev.slice(0, idx) : prev;
        });
      }
      if (echo) {
        setMessages((prev) => [
          ...prev,
          {
            id: nid(),
            role: 'user' as Role,
            text: echo.text,
            ts: Math.floor(Date.now() / 1000),
            ...(echo.media?.length ? { media: echo.media } : {}),
          },
        ]);
      } else if (rewindRowId != null) {
        setMessages((prev) => [
          ...prev,
          {
            id: nid(),
            role: 'user' as Role,
            text: submitText,
            ts: Math.floor(Date.now() / 1000),
          },
        ]);
      }
      const aid = nid();
      liveAid.current = aid;
      liveThinkAid.current = null; // fresh turn → fresh thinking bubble
      liveTools.current.clear();
      liveToolAid.current = null;
      liveTurnTools.current = [];
      liveTurnDiffs.current = [];
      clearStreaming();
      setSubagents([]);
      setMessages((prev) => [...prev, { id: aid, role: 'assistant', text: '', pending: true }]);
      setGenerating(true);
      generatingRef.current = true; // flip now: a drain before the re-render must not double-send
      lastTurnEventAt.current = Date.now();
      try {
        const status = await g.submit(sid, submitText, submitOpts);
        if (!sameRoom()) return;
        if (status === 'queued') setToolLine('queued — will run after the live turn…');
      } catch (e: any) {
        if (!sameRoom()) return;
        let msg = e?.message ?? String(e);
        let code = e?.code;
        // Live runtime expired server-side (orphan-reaped / evicted / idle TTL) —
        // resume the STORED session for a fresh live id and retry once.
        if ((code === 4001 || /not.?found/i.test(msg)) && sessionKey) {
          try {
            const r: any = await g.call('session.resume', {
              profile,
              session_id: sessionKey,
              omit_messages: false,
            });
            if (!sameRoom()) return;
            const liveId = typeof r?.session_id === 'string' && r.session_id ? r.session_id : sessionKey;
            runtimeOwners.current.set(liveId, owner);
            bindAskOwner(liveId, {
              connectionId: connectionScope(latest.current.host, latest.current.username),
              profile,
              storedSessionId: sessionKey,
              runtimeSessionId: liveId,
              resolved: true,
            });
            sessionIdRef.current = liveId;
            setSessionId(liveId);
            turnOwnerRef.current.delete(sid);
            turnOwnerRef.current.set(liveId, owner);
            runtimeOwners.current.set(liveId, owner);
            const status = await g.submit(liveId, submitText, submitOpts);
            if (!sameRoom()) return;
            if (status === 'queued') setToolLine('queued — will run after the live turn…');
            return;
          } catch (e2: any) {
            if (!sameRoom()) return;
            msg = e2?.message ?? String(e2);
            code = e2?.code;
          }
        }
        liveAid.current = null;
        setGenerating(false);
        generatingRef.current = false;
        if (code === 4009) {
          setMessages((prev) => [
            ...prev,
            {
              id: nid(),
              role: 'notice',
              text: `Session busy (${msg}). Stop the live turn and resend.`,
            },
          ]);
        } else {
          setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Send failed: ${msg}` }]);
        }
        setMessages((prev) => prev.filter((m) => m.id !== aid));
      }
    },
    [activeProfile, sessionId, sessionKey, setSessionId],
  );

  // Run a slash command server-side: slash.exec first (live shortcuts + worker),
  // falling back to command.dispatch for skill/quick/bundle commands (4018). The
  // worker result is either plain output text or a dispatch directive, handled
  // the way the desktop/TUI clients do (skills/bundles submit a prompt, /undo
  // drops text back into the composer).
  const runSlash = useCallback(
    async (raw: string) => {
      const g = gw.current;
      const sid = sessionId;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      const connectionEpoch = connectionEpochRef.current;
      const roomKey = sessionKey ?? sid ?? '';
      const full = raw.trim();
      if (!g || !sid || generating || !full) return;
      const current = () =>
        connectionEpochRef.current === connectionEpoch &&
        activeProfileRef.current === profile &&
        profileEpochRef.current === epoch &&
        (sessionIdRef.current === sid ||
          runtimeOwners.current.get(sessionIdRef.current ?? '') === profileSessionKey(profile, roomKey));
      setMessages((prev) => [...prev, { id: nid(), role: 'user', text: full }]);
      const show = (text: string) => {
        if (current()) setMessages((prev) => [...prev, { id: nid(), role: 'assistant', text }]);
      };
      const fail = (text: string) => {
        if (current()) setMessages((prev) => [...prev, { id: nid(), role: 'notice', text }]);
      };

      // slash.exec refuses skill/quick/bundle commands with 4018 — reroute those
      // through command.dispatch, whose result is the structured directive.
      const exec = async (command: string): Promise<any> => {
        try {
          const r: any = await g.slashExec(sid, command);
          if (!current()) return null;
          if (r && typeof r === 'object' && typeof r.type === 'string') return r;
          const out = typeof r?.output === 'string' ? r.output.trim() : '';
          const warn = typeof r?.warning === 'string' ? r.warning.trim() : '';
          show([warn, out || '(no output)'].filter(Boolean).join('\n\n'));
          return null;
        } catch (e: any) {
          if (!current()) return null;
          if (e?.code === 4018 || e?.code === 4011) {
            const { name, arg } = parseSlashCommand(command);
            return g.commandDispatch(sid, name, arg);
          }
          throw e;
        }
      };

      const handle = async (d: any): Promise<void> => {
        if (!d || !current()) return;
        switch (d.type) {
          case 'exec':
          case 'plugin':
            show((typeof d.output === 'string' && d.output.trim()) || '(no output)');
            return;
          case 'alias': {
            const target = typeof d.target === 'string' ? d.target.trim() : '';
            if (!target) return;
            const { arg } = parseSlashCommand(full);
            const next = `/${target.replace(/^\/+/, '')}${arg ? ` ${arg}` : ''}`;
            const nested = await exec(next);
            if (nested) await handle(nested);
            return;
          }
          case 'skill':
          case 'send': {
            const message = typeof d.message === 'string' ? d.message : '';
            if (!message.trim()) {
              fail('command returned an empty message');
              return;
            }
            // runSlash already echoed the typed command, so no second user bubble.
            await beginTurn(message);
            return;
          }
          case 'prefill':
            if (typeof d.message === 'string' && current()) {
              setInput(d.message);
              if (d.notice) show(String(d.notice));
            }
            return;
          default:
            fail('command returned an unexpected response');
        }
      };

      const { name } = parseSlashCommand(full);
      setToolLine(`running /${name || 'command'}…`);
      let d: any = null;
      try {
        d = await exec(full);
      } catch (e: any) {
        if (!current()) return;
        setToolLine(null);
        fail(`/${name || 'command'}: ${errMsg(e)}`);
        return;
      }
      if (!current()) return;
      setToolLine(null);
      if (d) await handle(d);
    },
    [activeProfile, sessionId, sessionKey, generating, beginTurn, setInput],
  );

  // ── Edit / regenerate (rewind) ────────────────────────────────────────────
  // "Edit & resend" rewinds history to that user row and resubmits the edited
  // text; "Regenerate" reruns the last user turn. Both need the durable row id
  // (ordinal-only cuts are refused for durable sessions).

  const editMessage = useCallback(
    (id: string) => {
      const m = messagesRef.current.find((x) => x.id === id);
      if (!m || m.role !== 'user') return;
      if (m.rowId == null) {
        stampRowIdsRef.current();
        setMessages((prev) => [
          ...prev,
          {
            id: nid(),
            role: 'notice',
            text: 'Loading the message id — tap Edit again in a moment.',
          },
        ]);
        return;
      }
      editRowRef.current = m.rowId;
      setEditingRowId(m.rowId);
      setInput(m.text);
    },
    [setInput],
  );

  const cancelEdit = useCallback(() => {
    editRowRef.current = null;
    setEditingRowId(null);
    setInput('');
  }, [setInput]);

  const regenerate = useCallback(() => {
    const g = gw.current;
    if (!g || !sessionId || generatingRef.current) return;
    const list = messagesRef.current;
    const lastUser = [...list].reverse().find((m) => m.role === 'user' && m.rowId != null && m.text.trim());
    if (!lastUser) {
      setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: 'Nothing to regenerate yet.' }]);
      stampRowIdsRef.current();
      return;
    }
    void beginTurn(lastUser.text, undefined, lastUser.rowId as number, cutsWholeTranscript(list, lastUser.id));
  }, [sessionId, beginTurn]);

  // Large-paste handling: stage text in the active session workspace so it
  // follows the selected profile instead of the process launch home.
  const pasteLarge = useCallback(
    async (text: string) => {
      const g = gw.current;
      const sid = sessionId;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      if (!g || !sid) {
        setInput(text);
        return;
      }
      try {
        const r: any = await g.call('file.attach', {
          session_id: sid,
          name: `paste-${Date.now()}.txt`,
          data_url: `data:text/plain;base64,${utf8ToBase64(text)}`,
        });
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setInput(typeof r?.ref_text === 'string' && r.ref_text ? r.ref_text : text);
      } catch {
        if (activeProfileRef.current === profile && profileEpochRef.current === epoch) setInput(text);
      }
    },
    [activeProfile, sessionId, setInput],
  );

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      const g = gw.current;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      const files = override === undefined ? attachments : [];
      if ((!text && files.length === 0) || !g || !sessionId) return;
      // An edit resend rewinds history to that user row first (cleared below).
      const rewindRowId = editRowRef.current ?? undefined;
      if (editRowRef.current != null) {
        editRowRef.current = null;
        setEditingRowId(null);
      }
      if (generatingRef.current) {
        // Mid-turn: hold it for the next turn instead of dropping it.
        if (text) enqueueQueued(text);
        if (override === undefined) setInput('');
        return;
      }

      // A leading `/command` runs server-side instead of going to the model:
      // prompt.submit does NOT dispatch slash commands (parity with the TUI's
      // slash fallthrough). Attachments keep the normal prompt path.
      if (!files.length && isSlashCommand(text)) {
        if (override === undefined) setInput('');
        // 1) Commands this app owns (a remote /new would mint a session id we
        //    never adopt; /title and /stop map to existing mobile controls).
        const action = slashMobileAction(text);
        if (action === 'new') {
          void newSessionRef.current();
        } else if (action === 'title') {
          const t = parseSlashCommand(text).arg;
          if (t) void renameSessionRef.current(t);
          else setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: 'Usage: /title <name>' }]);
        } else if (action === 'stop') {
          stopRef.current();
        } else {
          // 2) Curated like the desktop registry: terminal/messaging/settings-only
          //    commands get the reason instead of a doomed slash.exec round-trip.
          const blocked = slashBlockedMessage(text);
          // 3) Offered, but a mobile control owns the surface (model chip, drawer).
          const hint = slashMobileHint(text);
          if (blocked) setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: blocked }]);
          else if (hint) setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: hint }]);
          else {
            await runSlash(text);
            if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
          }
        }
        // A queued slash command doesn't start a turn, so drain the next one here.
        drainRef.current();
        return;
      }

      // Bytes go up BEFORE the prompt through the active runtime session, so
      // attachments land in the selected profile's workspace. A failed upload
      // aborts the send and leaves the input + chips in place to retry.
      let sent: { name: string; path: string; image: boolean }[] = [];
      if (files.length) {
        // Uploads take seconds — a second tap mid-flight would send the file and
        // the prompt twice.
        if (uploading.current) return;
        uploading.current = true;
        setToolLine(`uploading ${files.length} file${files.length === 1 ? '' : 's'}…`);
        try {
          sent = await uploadAttachments(files, g, sessionId);
        } catch (e) {
          if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
          setToolLine(null);
          setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Upload failed: ${errMsg(e)}` }]);
          return;
        } finally {
          uploading.current = false;
        }
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setToolLine(null);
      }

      // Only a user-initiated send clears the composer — a queue drain must not
      // wipe a draft the user is typing while the turn finishes.
      if (override === undefined) {
        setInput('');
        setAttachments([]);
      }
      const images = files.filter(isImageAttachment);
      // Images show as thumbnails in the bubble; other files keep their name line.
      const shownText = [...files.filter((f) => !isImageAttachment(f)).map((f) => `📎 ${f.name}`), text]
        .filter(Boolean)
        .join('\n');
      const submitText = [...sent.map((s) => `[attached ${s.image ? 'image' : 'file'}: ${s.path}]`), text]
        .filter(Boolean)
        .join('\n');
      // Editing the first turn rewrites the whole transcript — same server gate
      // as regenerate (confirm_empty_truncate).
      const rewindTarget =
        rewindRowId != null
          ? messagesRef.current.find((m) => m.rowId === rewindRowId && (m.role === 'user' || m.role === 'assistant'))
          : undefined;
      await beginTurn(
        submitText,
        { text: shownText, media: images },
        rewindRowId,
        rewindTarget ? cutsWholeTranscript(messagesRef.current, rewindTarget.id) : false,
      );
    },
    [activeProfile, input, attachments, sessionId, setInput, setAttachments, beginTurn, runSlash, enqueueQueued],
  );
  sendRef.current = send;

  // Release the local "a turn is running" latch without clearing the live
  // assistant bubble id — a late message.complete can still finalize it. Used
  // when an interrupt can't reach the server, so the composer never sticks.
  const releaseLocalTurn = useCallback(() => {
    liveThinkAid.current = null;
    liveTurnTools.current = [];
    generatingRef.current = false;
    setGenerating(false);
    setToolLine(null);
    setMessages((prev) => prev.map((m) => (m.pending ? { ...m, pending: false } : m)));
    queueMicrotask(() => {
      if (!queueParkedRef.current) drainRef.current();
    });
  }, []);
  releaseLocalTurnRef.current = releaseLocalTurn;

  const stop = useCallback(() => {
    // An explicit halt parks the queue until the user queues again / taps Resume.
    queueParkedRef.current = true;
    setQueueParked(true);
    const g = gw.current;
    const sid = sessionId;
    const profile = activeProfile;
    const epoch = profileEpochRef.current;
    // No live socket/session, or the interrupt itself fails → the server will
    // never emit the turn-end event, so clear the latch ourselves.
    if (!g || !sid) {
      releaseLocalTurn();
      return;
    }
    g.interrupt(sid).catch(() => {
      if (activeProfileRef.current === profile && profileEpochRef.current === epoch && sessionIdRef.current === sid) {
        releaseLocalTurn();
      }
    });
  }, [activeProfile, sessionId, releaseLocalTurn]);

  return { beginTurn, runSlash, editMessage, cancelEdit, regenerate, pasteLarge, send, releaseLocalTurn, stop };
}
