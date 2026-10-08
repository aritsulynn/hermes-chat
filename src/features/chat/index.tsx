// Chat route — transcript + composer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pickFiles } from '../../services/file-picker';
import { Navigate as Redirect } from 'react-router-dom';
import { ChevronDown, ChevronUp, ChevronRight, Clock, Copy, FileText, Image as ImageIcon, Pencil } from 'lucide-react';
import { useApp, useStreamingRead, useThemeValue } from '../../hooks/app-store';
import { Transcript } from '../../components/chat/transcript';
import { MessageScrollerItem } from '../../components/ui/message-scroller';
import { toast } from '../../components/ui/toast';
import { UserMenuDialog } from '../../components/chat/user-menu-dialog';
import type { TranscriptHandle } from '../../components/chat/transcript';
import { useScrollbarGutter, useViewportSize } from '../../hooks/use-viewport';
import {
  FALLBACK_PROVIDERS,
  applySlashCompletion,
  atToken,
  isSlashCommand,
  slashName,
  slashToken,
  subagentDone,
  todoActive,
  todoDone,
  todoLabel,
  errMsg,
} from '../../utils/messages';
import { REASONING_EFFORT_VALUES, reasoningCapability, reasoningLabel } from '../../utils/reasoning';
import { fuzzyScoreMultiTokens } from '../../utils/fuzzy';
import { contextTone, mergeUsage } from '../../utils/usage';
import { isSlashSuggestion, skillUsage } from '../../utils/slash-commands';
import { screenBg, screenStyle } from '../../theme';
import type { UiMessage } from '../../utils/messages';
import type { SlashCompletionItem } from '../../services/gateway-ws';
import { Composer } from '../../components/chat/composer';
import type { AnchorMeasure, AnchorRect } from '../../components/chat/composer';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  createDropdownMenuHandle,
} from '../../components/ui/dropdown-menu';
import { MessageBubble, formatBubbleTime } from '../../components/chat/message-bubble';
import { AskSheet } from '../../components/ui/sheets';
import { HamburgerBtn } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Spinner } from '../../components/ui/bits';
import { ChatNormalHeader } from './components/ChatHeader';
import { FALLBACK_SLASH } from './helpers';
import { CHAT_WINDOW_SOFT_CAP } from '../../services/constants';

export function ChatScreen() {
  const {
    booting,
    authed,
    sessionId,
    sessionKey,
    sessionTitle,
    messages,
    input,
    setInput,
    model,
    modelProvider,
    providers,
    providersLoading,
    providersError,
    effort,
    applyEffort,
    applyFast,
    showReasoning,
    loadReasoningDisplay,
    applyShowReasoning,
    attachments,
    setAttachments,
    generating,
    copiedId,
    sessionInfo,
    usageInfo,
    toolLine,
    ask,
    send,
    stop,
    redirectLive,
    setGlobalModel,
    newSession,
    loadProviders,
    loadCommandsCatalog,
    queued,
    queueParked,
    enqueueQueued,
    removeQueued,
    clearQueue,
    resumeQueue,
    sendQueuedNow,
    editingRowId,
    editMessage,
    cancelEdit,
    regenerate,
    pasteLarge,
    branchSession,
    historyLoadingMore,
    loadOlderMessages,
    trimHead,
    todos,
    subagents,
    refreshToolResults,
    pickModel,
    copyText,
    exportSession,
    answerValue,
    answerApproval,
    answerAsk,
    dismissAsk,
    getGw,
    applyApprovalMode,
  } = useApp();
  // Reading the live stream is deliberately NON-reactive here. Following it is
  // the bubble's job, per message id (see useStreamingText); this screen wants
  // streamed text in exactly two places — the long-press menu's Copy target and
  // the session-info token estimate — and both read it on demand instead.
  const readStreamedText = useStreamingRead();
  // Theme lives on its own context for the same reason: a toggle would
  // otherwise hand every useApp() consumer a new object.
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const headerIcon = dark ? '#f5f5f5' : '#111';
  // Approval mode shown on the composer's shield. Unknown yet (session info
  // still loading) reads as manual — the safe side.
  const serverApprovalMode =
    sessionInfo?.approval_mode === 'smart' || sessionInfo?.approval_mode === 'off'
      ? sessionInfo.approval_mode
      : 'manual';
  // Optimistic local echo. `applyApprovalMode` is a `config.set` RPC that
  // resolves only when the gateway answers, and the shield is a control whose
  // whole feedback loop is "did the glyph change" — reading only the server
  // value made every tap look dead on a slow socket, and permanently dead on a
  // gateway that does not push `session.info` back after the write. The ref
  // holds the pending value so the next tap cycles from what the user last chose
  // rather than from a stale server read, and `sessionInfo` takes over again as
  // soon as it catches up.
  const [pendingApproval, setPendingApproval] = useState<'manual' | 'smart' | 'off' | null>(null);
  const approvalMode = pendingApproval ?? serverApprovalMode;
  useEffect(() => {
    if (pendingApproval !== null && pendingApproval === serverApprovalMode) setPendingApproval(null);
  }, [pendingApproval, serverApprovalMode]);
  const cycleApproval = useCallback(() => {
    const next = approvalMode === 'manual' ? 'smart' : approvalMode === 'smart' ? 'off' : 'manual';
    setPendingApproval(next);
    void applyApprovalMode(next).catch(() => {
      // The write failed, so the server value still stands — drop the echo and
      // let the glyph snap back rather than showing a mode that is not set.
      setPendingApproval(null);
    });
  }, [approvalMode, applyApprovalMode]);

  // Thinking-effort control follows the MODEL's published capability: hide it
  // when the route reports `reasoning: false` (an unknown/older gateway keeps it
  // visible), drop "Off" when the model can't disable reasoning, and show the
  // wire level the route actually sends (`session.info.reasoning_effort_wire`,
  // e.g. `ultra` → `max`) so the pill never implies a level the route lacks.
  const reasoningCap = reasoningCapability(providers, modelProvider, model);
  const showEffort = reasoningCap?.reasoning !== false;
  const canDisableReasoning = reasoningCap?.can_disable_reasoning !== false;
  const effortWire: string | undefined =
    typeof sessionInfo?.reasoning_effort_wire === 'string' ? sessionInfo.reasoning_effort_wire : undefined;
  const effortOptions = REASONING_EFFORT_VALUES.filter((v) => canDisableReasoning || v !== 'none');

  // Composer status strip: context window + tokens + subagents + cost. The
  // gateway publishes these under session.info.usage (and session.usage answers
  // the same numbers); tap opens the full Session info sheet.
  const usage = mergeUsage(sessionInfo?.usage, usageInfo);
  const ctxPct = usage?.contextPercent != null ? Math.max(0, Math.min(100, Math.round(usage.contextPercent))) : null;
  const ctxTone = ctxPct == null ? 'ok' : contextTone(ctxPct);

  const { width: winW, height: winH } = useViewportSize();

  // Theme tokens resolved once per scheme: this screen re-renders on every
  // streamed token, and a fresh style object per render would rebuild the
  // surface colours each time.
  const screen = useMemo(() => screenStyle(dark), [dark]);
  // The 52px bar plus the OS inset. `env()` in a class would be tidier, but this
  // one also reports a height the layout below reads, so it stays a value.
  const noSessionHeader = useMemo(
    () => ({
      height: 'calc(env(safe-area-inset-top, 0px) + 52px)',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      background: screenBg(dark),
    }),
    [dark],
  );

  // Screen-level anchored popovers ("+" attach, model picker, thinking effort),
  // anchored to the composer controls that opened them. Rendered here, not in
  // the composer, so they can float above the list and still receive taps — on
  // Android touches outside a parent's bounds are dropped, so a popover inside
  // the composer wouldn't work.
  // Only the model picker is still a measured, screen-level panel — see the note
  // on it where it renders. The attach and effort menus used to share this
  // mechanism; they are Base UI menus now, anchored by Base UI to triggers that
  // live in the composer.
  const [popover, setPopover] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const popoverMeasure = useRef<AnchorMeasure | null>(null);
  // Detached menu handles. A `useRef` keeps the identity stable: the handle is a
  // mutable object that Base UI attaches to, not a value to re-create per render.
  const attachMenu = useRef(createDropdownMenuHandle()).current;
  const effortMenu = useRef(createDropdownMenuHandle()).current;
  const [modelQuery, setModelQuery] = useState('');
  const [modelExpanded, setModelExpanded] = useState<Record<string, boolean>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const rootWin = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const openPopover = useCallback(
    (measure: AnchorMeasure) => {
      popoverMeasure.current = measure;
      setModelQuery('');
      void loadProviders();
      measure((a) => setPopover(a));
    },
    [loadProviders],
  );
  // Re-anchor after the keyboard slides in/out and lifts the composer.
  const remeasurePopover = useCallback(() => {
    popoverMeasure.current?.((a) => setPopover((p) => (p ? { ...p, ...a } : p)));
  }, []);
  const closePopover = useCallback(() => {
    popoverMeasure.current = null;
    setPopover(null);
  }, []);

  // The screen's box, in viewport coordinates.
  //
  // This replaces an `onLoad` handler on the root div, which never fired — React
  // only dispatches `load` for elements that load a resource, so `rootWin` sat
  // at all-zeroes. That went unnoticed while the root began at the viewport
  // origin: `y` of 0 was correct, and `x` was never read. The sidebar gave the
  // root an x, and the model panel then landed a sidebar-width right of the chip
  // it is anchored to.
  //
  // A ResizeObserver rather than a one-off read because the root's box is what
  // moves when the on-screen keyboard lifts the composer.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      rootWin.current = { x: r.x, y: r.y, w: r.width, h: r.height };
      remeasurePopover();
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [remeasurePopover]);

  // Composer completion panel — shows above the input for two triggers:
  //   `/token`  → slash commands (built-ins + quick_commands + skills, curated
  //               by the desktop registry via ./slash-commands)
  //   `@token`  → references: files / folders / URLs / git diff / profiles /
  //               plugin providers (`complete.path`). Picking a folder keeps the
  //               panel open so you can walk into it; a file closes it.
  const [completions, setCompletions] = useState<SlashCompletionItem[]>([]);
  const [completionKind, setCompletionKind] = useState<'slash' | 'path'>('slash');
  // Column the accepted row replaces from (server-provided for slash arguments,
  // computed locally for the command/@ stages).
  const [completionFrom, setCompletionFrom] = useState(0);
  // Keep the backend's command dispositions fresh; the live catalog re-curates
  // the wheel (terminal-only etc. drop out) with no code change.
  useEffect(() => {
    if (sessionId) void loadCommandsCatalog();
    if (sessionId) void loadReasoningDisplay();
  }, [sessionId, loadCommandsCatalog, loadReasoningDisplay]);
  useEffect(() => {
    const gw = getGw();
    // `/token` (command stage) or `/cmd args…` (argument stage). The argument
    // stage sends the whole line so the backend can rank args for that command.
    const slashTok = slashToken(input);
    const argStage = !slashTok && isSlashCommand(input) && /\s/.test(input);
    const at = slashTok || argStage ? null : atToken(input);
    if (!gw || (!slashTok && !argStage && !at)) {
      setCompletions((prev) => (prev.length ? [] : prev));
      return;
    }
    let live = true;
    const kind: 'slash' | 'path' = slashTok || argStage ? 'slash' : 'path';
    const token = slashTok ?? at?.token ?? input;
    const localFrom = slashTok ? 0 : (at?.start ?? 0);
    // Small debounce so a burst of keystrokes makes one round-trip.
    const t = setTimeout(() => {
      const req =
        kind === 'slash'
          ? gw.slashCompletions(token, sessionId ?? undefined)
          : gw.pathCompletions(token, sessionId ?? undefined);
      req
        .then((res) => {
          if (!live) return;
          setCompletionKind(kind);
          // Arg stage: the backend's replace_from points at the word to swap.
          setCompletionFrom(argStage ? res.replaceFrom : localFrom);
          setCompletions(res.items);
        })
        .catch(() => {
          if (!live) return;
          setCompletionKind(kind);
          setCompletionFrom(localFrom);
          if (kind === 'slash' && !argStage) {
            const p = token.slice(1).toLowerCase();
            setCompletions(FALLBACK_SLASH.filter((c) => slashName(c.text).startsWith(p)));
          } else {
            setCompletions([]);
          }
        });
    }, 70);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [input, sessionId, getGw]);
  // Slash rows filter at render (not when the RPC lands) so a late
  // `commands.catalog` reply re-curates the rows already on screen. Path rows
  // come curated by the backend. Skill rows rank by backend-observed usage —
  // stable order otherwise so the wheel doesn't jump around.
  const visibleCompletions = useMemo(() => {
    if (completionKind !== 'slash') return completions;
    const filtered = completions.filter((it) => isSlashSuggestion(it.text));
    const withUsage = filtered.map((it, i) => ({
      it,
      i,
      usage: it.kind === 'skill' ? (skillUsage(it.text) ?? -1) : -1,
    }));
    if (!withUsage.some((r) => r.usage >= 0)) return filtered;
    return withUsage.sort((a, b) => b.usage - a.usage || a.i - b.i).map((r) => r.it);
  }, [completionKind, completions]);

  const applyCompletion = useCallback(
    (item: SlashCompletionItem) => {
      const text = item.text || '';
      if (!text) return;
      if (completionKind === 'slash') {
        setInput(applySlashCompletion(input, text, completionFrom));
        setCompletions([]);
        return;
      }
      // Reference: replace just the `@token` under the caret. Folder rows (and
      // the `@file:` / `@folder:` directive prefixes) keep the panel open so the
      // next listing loads; a concrete file closes it.
      const keepOpen = text.endsWith('/') || text.endsWith(':');
      setInput(input.slice(0, completionFrom) + text + (keepOpen ? '' : ' '));
      if (!keepOpen) setCompletions([]);
    },
    [input, completionKind, completionFrom, setInput],
  );

  const listRef = useRef<TranscriptHandle>(null);
  // The reserved scrollbar gutter, and the ref that measures it. The composer is
  // layered over the scroller's right edge, so it has to stop short of the
  // gutter or it hides the scroll control.
  const { scrollerRef, gutter } = useScrollbarGutter();
  // Latest transcript for stable callbacks (tool expand → REST result fill).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Long-press fired: swallow the onPress that fires on release (else a
  // long-press on thinking/tool bubbles toggles them instead of selecting).
  const longFired = useRef(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Agent todo checklist above the composer — collapsed to a one-line summary.
  const [todosOpen, setTodosOpen] = useState(false);
  // Mirrored out of MessageScroller's `scrollable.end` (see Transcript). Used
  // for exactly one thing now: gating the head-trim below, so reading history
  // up top is never yanked. The jump-to-bottom button reads the same state
  // directly inside the transcript.
  const [atBottom, setAtBottom] = useState(true);
  // Height of the bottom footer (panels + composer), keyboard lift included.
  // Feeds the scroll-to-bottom button anchor above it. The footer overlays
  // the transcript (absolute, transparent), so the list reserves room for it
  // via content padding (see listContentStyle) instead of flex space.
  const [dockH, setDockH] = useState(0);
  // The overlay footer's own box, measured. This is the composer clearance the
  // transcript's bottom padding is built from. A ResizeObserver rather than a
  // layout callback, and it watches the footer
  // rather than the composer card, because the footer's box is what the
  // transcript has to clear: it includes the `paddingBottom: kbH + kbGap` that
  // lifts the card above the keyboard, so one number covers both cases.
  //
  // A *callback* ref, not a ref plus a mount effect. The footer only exists in
  // the active-session branch of the render, so the first render is the booting
  // or no-session branch, an effect with `[]` deps runs there, finds a null ref,
  // and never runs again — which is exactly the bug the first attempt at this
  // fix had.
  const dockRef = useRef<HTMLDivElement | null>(null);
  const observeDock = useCallback((el: HTMLDivElement | null) => {
    dockRef.current = el;
    if (!el) return;
    const read = () => setDockH(el.getBoundingClientRect().height);
    read();
    const ro = new ResizeObserver(read);
    // `box: 'border-box'` is load-bearing. The observer defaults to
    // content-box, and the keyboard lift reaches this element only as
    // `paddingBottom` — which grows the border box without touching the
    // content box, so a default observer never fires. `dockH` then stayed at
    // its keyboard-closed value and the transcript never reserved room for the
    // lifted composer: the composer rose, the chat did not. `read` measures
    // the border box, so observe the same box.
    ro.observe(el, { box: 'border-box' });
    return () => ro.disconnect();
  }, []);
  // Keyboard height — the footer is lifted by hand with bottom padding. The
  // list stays full-height underneath the transparent footer zone.
  const [kbH, setKbH] = useState(0);
  // Gap between the lifted dock and the keyboard so the composer doesn't sit
  // flush on it. Only while the keyboard is open.
  const kbGap = kbH > 0 ? 8 : 0;
  // Live child-agent roster (subagent.list) — same collapsed-summary treatment.
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  // Regenerate targets the last assistant bubble; the rewind target is the last
  // user row that carries a durable id.
  const lastAssistantId = useMemo(() => [...messages].reverse().find((m) => m.role === 'assistant')?.id, [messages]);
  const hasRegenTarget = useMemo(
    () => messages.some((m) => m.role === 'user' && m.rowId != null && m.text.trim()),
    [messages],
  );

  const onRedirect = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setInput('');
      void redirectLive(t);
    },
    [redirectLive, setInput],
  );

  // "Queue" while a turn runs: hold the draft for the next turn, clear the input.
  const onQueue = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      enqueueQueued(text);
      setInput('');
    },
    [enqueueQueued, setInput],
  );

  // Stable handlers — MessageBubble and Composer are memo()'d, so inline arrows
  // here would re-render every bubble (markdown re-parse + DOM rebuild)
  // and the focused TextInput on each streamed token.
  const openModelPicker = useCallback((m: AnchorMeasure) => openPopover(m), [openPopover]);
  const onToggleExpand = useCallback(
    (id: string) => {
      // Expanding a tool with no result/diff yet → pull it from the transcript.
      const item = messagesRef.current.find((m) => m.id === id);
      if (item?.role === 'tool' && !item.output && !item.diff) refreshToolResults();
      setExpanded((p) => ({ ...p, [id]: !p[id] }));
    },
    [refreshToolResults],
  );
  const onCopy = useCallback((id: string, text: string) => void copyText(id, text), [copyText]);
  const onRegenerate = useCallback(() => regenerate(), [regenerate]);

  // Export the whole session as JSON. The store returns the raw text; the save
  // is an anchor download, which works on web and in the native shell (the
  // WebView routes the `download` attribute to the platform downloader).
  const [exporting, setExporting] = useState(false);
  const handleExportSession = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { filename, text } = await exportSession(
        sessionTitle && sessionTitle !== '(new session)' ? sessionTitle : undefined,
      );
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast({ title: 'Session exported', description: filename });
    } catch (e) {
      toast({ title: 'Export failed', description: errMsg(e), variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  }, [exportSession, exporting, sessionTitle]);
  // Long-press menu on our own messages (Copy / Edit) — same popover pattern.
  const [userMenu, setUserMenu] = useState<{ anchor: AnchorRect; id: string } | null>(null);
  const openUserMenu = useCallback((m: AnchorMeasure, id: string) => m((a) => setUserMenu({ anchor: a, id })), []);
  const closeUserMenu = useCallback(() => setUserMenu(null), []);
  // Icon tooltips (bubble footer buttons) — a floating label that never
  // captures touches, auto-dismissed. No Modal: a modal would eat the release
  // tap and complicate the guarded onPress in the bubble.
  const [tip, setTip] = useState<{ anchor: AnchorRect; label: string } | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (tipTimer.current) clearTimeout(tipTimer.current);
    },
    [],
  );
  const showTip = useCallback((m: AnchorMeasure, label: string) => {
    m((a) => {
      setTip({ anchor: a, label });
      if (tipTimer.current) clearTimeout(tipTimer.current);
      tipTimer.current = setTimeout(() => setTip(null), 1200);
    });
  }, []);

  // When the keyboard slides up the list height shrinks but content offset
  // stays — explicitly scroll so the latest message sits above the keyboard,
  // like every normal chat app. Delay covers the keyboard animation (~250ms).
  // Also re-anchor any open popover, since the composer moves up with the
  // keyboard (matters for the model search field).
  useEffect(() => {
    let t1: ReturnType<typeof setTimeout> | null = null;
    let t2: ReturnType<typeof setTimeout> | null = null;
    // `winH` is the layout viewport; the visual viewport is what shrinks when
    // the keyboard opens, and the difference between them is its height.
    const vv = window.visualViewport;
    const onKeyboard = () => {
      setKbH(vv ? Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop ?? 0))) : 0);
      t1 = setTimeout(() => {
        listRef.current?.scrollToEnd({ behavior: 'smooth' });
        remeasurePopover();
      }, 50);
      // The 50ms pass lands mid-animation; re-anchor again once the keyboard has settled.
      if (t2) clearTimeout(t2);
      t2 = setTimeout(remeasurePopover, 320);
    };
    vv?.addEventListener('resize', onKeyboard);
    return () => {
      vv?.removeEventListener('resize', onKeyboard);
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
  }, [remeasurePopover]);

  // Fetch picker inventory when entering a chat (WS model.options, REST fallback).
  useEffect(() => {
    if (sessionId && providers === null && !providersLoading) {
      void loadProviders();
    }
  }, [sessionId, providers, providersLoading, loadProviders]);

  const onSend = useCallback(() => {
    void send();
    // Sending has to re-engage following, not just scroll: if the user had
    // scrolled up into history, MessageScroller is in free-scrolling mode and
    // the reply would stream in off-screen. scrollToEnd puts it back in follow
    // mode, which is what the old `stickEnd = true` did.
    listRef.current?.scrollToEnd({ behavior: 'smooth' });
  }, [send]);

  // Attach actions live here (not in the composer) because their UI — the "+"
  // popover — is rendered at screen level. See pickImage/pickFile callers below.
  // Images go through the same <input type="file"> as everything else, with an
  // `accept` filter. Note what is *not* here: there is no downscale-to-quality
  // step. A browser cannot re-encode an image it did not decode, and the upload
  // has a size ceiling that rejects anything too large anyway, so the original
  // file goes up as-is.
  const pickImage = useCallback(async () => {
    setPopover(null);
    const picked = await pickFiles({ accept: 'image/*', multiple: true });
    if (picked.length) {
      setAttachments([
        ...attachments,
        ...picked.map((f) => ({ uri: f.uri, name: f.name || `image-${Date.now()}.jpg`, mime: f.mime })),
      ]);
    }
  }, [attachments, setAttachments]);

  const pickFile = useCallback(async () => {
    setPopover(null);
    const picked = await pickFiles({ multiple: true });
    if (picked.length) {
      setAttachments([...attachments, ...picked.map((f) => ({ uri: f.uri, name: f.name || 'file', mime: f.mime }))]);
    }
  }, [attachments, setAttachments]);

  // The ask and info sheets are controlled Radix dialogs: `open` is the store
  // state, full stop.
  // React re-renders from `open`, so "presenting again" and "staying open" are
  // the same statement.
  //
  // `ask` is the whole contract. The sheet cannot be dismissed
  // by the user at all (AskSheet prevents Escape and outside-press), so
  // onOpenChange only ever fires for a programmatic close we asked for.
  const onAskSheetDismiss = useCallback(() => {
    dismissAsk();
  }, [dismissAsk]);

  // Model picker + list memos must live before the early returns below
  // (hooks can't run after a conditional return). They only read state/props.
  const modelProviders = providers ?? FALLBACK_PROVIDERS;
  const mq = modelQuery.trim().toLowerCase();
  const modelVisibleProviders = useMemo(() => {
    const list0 = modelProviders;
    const q = mq;
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    return list0
      .map((p) => {
        const list = p.models ?? [];
        if (!q) return { ...p, models: list };
        const providerHit =
          fuzzyScoreMultiTokens(p.name, tokens) !== null || fuzzyScoreMultiTokens(p.slug || '', tokens) !== null;
        if (providerHit) return { ...p, models: list };
        const models = list
          .map((mm) => ({ mm, s: fuzzyScoreMultiTokens(mm, tokens)?.score }))
          .filter((x): x is { mm: string; s: number } => x.s !== undefined)
          .sort((a, b) => b.s - a.s)
          .map((x) => x.mm);
        return { ...p, models };
      })
      .filter((p) => (q ? (p.models?.length ?? 0) > 0 : true));
  }, [modelProviders, mq]);
  // The composer clearance is passed to Transcript as `clearance`, not as
  // `padding-bottom` here: the scroller watches the content with a
  // ResizeObserver, which observes the content BOX, and with `h-max` +
  // `box-sizing: border-box` growing the bottom padding shrinks that box by
  // exactly as much — so the observer never fires and the transcript settles one
  // composer-height short of the bottom. Transcript renders the clearance as a
  // real trailing child instead; see the note on TranscriptProps.clearance. The
  // row gap is Transcript's too, for the same reason.
  // The column and the content box are separate because Transcript puts the jump
  // button on a rail that matches the column, so the button lands on the
  // bubbles' right edge — see TranscriptProps.columnClassName.
  const listColumnClass = 'mx-auto w-full max-w-3xl';
  // The header is in normal flow above the scroller (see the JSX below), so the
  // scroller's own top edge is already below it — the content needs no top pad
  // to clear a floating bar. Just the safe area the header does not cover, and
  // a small gap so the first row is not flush against the bar.
  const listContentClass = 'flex flex-col px-3 pt-3';
  const listKeyExtractor = useCallback((m: UiMessage) => m.id, []);
  // Following the tail, holding position across a prepend, and settling the
  // follow state on a release all used to live here as ~150 lines of scroll
  // arithmetic over a known content height. MessageScroller owns all three now;
  // see components/chat/transcript.tsx for what is left on this side.
  const onBranchChat = useCallback(() => void branchSession(), [branchSession]);
  const renderMessage = useCallback(
    ({ item }: { item: UiMessage }) => {
      // Streaming deltas reach the live bubble via StreamingContext inside
      // MessageBubble — merging here would re-key renderMessage/extraData per
      // token and invalidate every row. Other rows keep their stable `item`
      // reference so memo() holds.
      return (
        <MessageBubble
          item={item}
          dark={dark}
          expanded={!!expanded[item.id]}
          longFired={longFired}
          onToggleExpand={onToggleExpand}
          copied={copiedId === item.id}
          onCopy={onCopy}
          canRegenerate={!!lastAssistantId && item.id === lastAssistantId && hasRegenTarget && !generating}
          canBranch={item.role === 'assistant' && !item.pending}
          onRegenerate={onRegenerate}
          onBranchChat={onBranchChat}
          onUserMenu={openUserMenu}
          onTip={showTip}
        />
      );
    },
    [
      dark,
      expanded,
      onToggleExpand,
      copiedId,
      onCopy,
      generating,
      lastAssistantId,
      hasRegenTarget,
      onRegenerate,
      onBranchChat,
      openUserMenu,
      showTip,
    ],
  );

  // ── Transcript window ────────────────────────────────────────────────
  // Older pages prepend above the viewport. The offset shift that keeps the
  // row under the finger put is MessageScroller's (`preserveScrollOnPrepend`),
  // so there is nothing to capture here any more.
  const onLoadOlder = useCallback(() => {
    void loadOlderMessages();
  }, [loadOlderMessages]);
  const handleStartReached = useCallback(() => {
    onLoadOlder();
  }, [onLoadOlder]);
  // The scroller reports whether there is anything below the fold; `end` is the
  // negation of "at the bottom". The head-trim below is the only reader.
  const handleScrollableChange = useCallback((s: { start: boolean; end: boolean }) => {
    setAtBottom(!s.end);
  }, []);
  // Head trim past the soft cap: only while pinned at the bottom, idle, and
  // not paging — reading history up top is never yanked. Trimmed rows stay
  // server-side and come back through onLoadOlder.
  useEffect(() => {
    if (messages.length > CHAT_WINDOW_SOFT_CAP && !generating && atBottom && !historyLoadingMore) {
      trimHead();
    }
  }, [messages.length, generating, atBottom, historyLoadingMore, trimHead]);

  if (booting) {
    return (
      <div style={screen}>
        <div className="flex flex-col flex-1 bg-popover items-center justify-center gap-3 dark:bg-background">
          <Spinner size={24} color="currentColor" />
          <div className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">connecting…</div>
        </div>
      </div>
    );
  }
  if (!authed) return <Redirect to="/login" replace />;

  if (!sessionId) {
    return (
      <div style={screen}>
        <div style={noSessionHeader}>
          <div className="h-[52px] flex items-center px-2">
            <div className="flex flex-col w-11 items-start">
              <HamburgerBtn />
            </div>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col bg-popover dark:bg-background">
          <div className="flex flex-col flex-1 items-center justify-center p-6">
            <div className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
              No active session — start a new one.
            </div>
            <Button
              variant="default"
              onClick={() => void newSession()}
              className="mt-2 items-center px-[18px] py-[11px]">
              <span className="text-[15px] font-semibold">+ New chat</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Popover geometry for the model picker only. Anchor above the tapped control
  // (window → root coords).
  const popW = popover ? Math.min(winW - 24, 340) : 0;
  const popRootH = rootWin.current.h || Math.max(0, winH - rootWin.current.y);
  const popRootW = rootWin.current.w || winW;
  const popRelY = popover ? popover.y - rootWin.current.y : 0;
  const popBottom = popover ? Math.max(8, popRootH - popRelY + 6) : 0;
  // Anchored to the chip that opened it, then clamped to the panel's own width.
  // This used to be a hardcoded `12` — docked to the left screen margin on the
  // theory that a 340px panel under a mid-screen chip would clip. It does not:
  // `min` against `rootW - popW - 8` handles a phone (390 - 340 - 8 = 42, still
  // on screen), so the hardcoding bought nothing and cost the panel its anchor.
  const popRelX = popover ? popover.x - rootWin.current.x : 0;
  const popLeft = popover ? Math.max(8, Math.min(popRelX, popRootW - popW - 8)) : 0;
  // Height budget = the space between the anchor and the top of the screen
  // content, minus the 6px anchor gap and an 8px top margin. The popover grows
  // upward from the composer, so without this the model list (which gets long
  // as soon as a search auto-expands every matching provider) slides up under
  // the header and hides the search field being typed into.
  const popSpaceAbove = popover ? Math.max(0, popRelY - 14) : 0;
  const popMaxH = popover ? Math.min(Math.round(popRootH * 0.55), Math.max(160, popSpaceAbove)) : undefined;

  return (
    <div ref={rootRef} style={screen} className="relative">
      {/* Header in normal flow, not floating. A floating bar overlapped the
          scroller, which meant the scroller owned the full column height and
          its scrollbar ran *under* the header — visible on platforms whose
          scrollbar is an overlay (Android, macOS), where it painted on top of
          the glass with nothing to reserve: `scrollbar-gutter` reserves space
          for a classic scrollbar only, and an overlay one measures zero. In
          flow, the scroller simply starts below the bar, so the scrollbar's
          top edge is the bar's bottom edge. This is also what every other screen
          in the app does via ScreenScaffold, and what OpenChamber does.
          The cost: rows no longer scroll under the bar, so there is no
          backdrop-blur overlap to blur. */}
      <div className="shrink-0 bg-popover dark:bg-background">
        <ChatNormalHeader
          dark={dark}
          title={sessionTitle && sessionTitle !== '(new session)' ? sessionTitle : ''}
          contextPercent={ctxPct}
          contextTone={ctxTone}
          contextUsed={usage?.contextUsed ?? null}
          contextMax={usage?.contextMax ?? null}
          input={usage?.input ?? null}
          output={usage?.output ?? null}
          costUsd={usage?.costUsd ?? null}
          subagents={subagents.length}
          onExport={() => void handleExportSession()}
        />
      </div>

      {/* No 'bottom' edge here: Composer already pads with insets.bottom
          itself when the keyboard is closed, and KeyboardAvoidingView lifts
          it when open. Keeping 'bottom' would double the gap above the
          gesture bar (and float the composer above the keyboard). */}
      <div className="flex min-h-0 flex-1 flex-col bg-popover dark:bg-background">
        {/* Long-press popover on our own messages — Copy / Edit, same pattern. */}
        <UserMenuDialog
          open={!!userMenu}
          onOpenChange={(o) => !o && closeUserMenu()}
          anchor={userMenu?.anchor}
          viewportWidth={winW}>
          {userMenu &&
            (() => {
              const target = messages.find((m) => m.id === userMenu.id);
              // Read on demand, not followed: the menu only ever offers Copy on a
              // settled row, so there is no live delta worth re-rendering for.
              const fullText = target ? target.text + readStreamedText(target.id) : '';
              const showCopy = !!target && !!fullText && !target.pending;
              const showEdit = !!target && target.role === 'user' && target.rowId != null && !generating;
              if (!target || (!showCopy && !showEdit)) return null;
              const menuW = 192;
              const left = Math.max(8, Math.min(userMenu.anchor.x + userMenu.anchor.w - menuW, winW - menuW - 8));
              const above = userMenu.anchor.y > 128;
              return (
                <div
                  className="absolute w-48 rounded-xl border border-border bg-popover p-1.5 shadow-lg"
                  style={
                    above
                      ? { bottom: winH - userMenu.anchor.y + 8, left }
                      : { top: userMenu.anchor.y + userMenu.anchor.h + 8, left }
                  }>
                  {!!target.ts && (
                    <div className="flex items-center gap-2.5 px-3 py-2">
                      <Clock size={17} color={dark ? '#888' : '#999'} />
                      <div className="text-[13px] text-neutral-500 dark:text-neutral-400">
                        {formatBubbleTime(target.ts)}
                      </div>
                    </div>
                  )}
                  {showCopy && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        closeUserMenu();
                        void copyText(target.id, fullText);
                      }}
                      className="flex items-center gap-2.5 px-3 py-2.5">
                      <Copy size={17} color={headerIcon} />
                      <span className="text-[15px] text-neutral-950 dark:text-neutral-100">Copy</span>
                    </Button>
                  )}
                  {showEdit && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        closeUserMenu();
                        editMessage(target.id);
                      }}
                      className="flex items-center gap-2.5 px-3 py-2.5">
                      <Pencil size={17} color={headerIcon} />
                      <span className="text-[15px] text-neutral-950 dark:text-neutral-100">Edit</span>
                    </Button>
                  )}
                </div>
              );
            })()}
        </UserMenuDialog>

        {/* Plain View, not KeyboardAvoidingView: the composer is an absolute
          overlay at the bottom of the transcript container with a transparent
          background, so scrolled messages show through around the card — an
          absolute child ignores the view's padding, and the keyboard is
          handled explicitly via kbH (footer padding lifts the card). */}
        {/* `min-h-0` and `flex flex-col` for the same reason as every other level
          of this chain: it is a column flex item, and `min-height: auto` would
          let it grow to the transcript's full height instead of letting the
          scroller inside it scroll. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Rows are MessageScrollerItem and must stay direct children of the
            content box: the prepend correction restores position by measuring
            the first visible row, and it skips any child without a message id.
            The old `contents` wrapper is gone with it — a display:contents box
            has no rect, and the row alignment it existed for now lives inside
            Message (see components/ui/message.tsx).
            `key` on the scroller is the session: a switch has to remount the
            scroll state, or a transcript opened while scrolled up in the
            previous session would land at the top. */}
          <Transcript
            // Key on the durable STORED id, not the live runtime id: the gateway
            // remints the runtime id on a reconnect/restart, and remounting the
            // scroller would reset it to the bottom. A real session switch changes
            // the stored id, so the scroll state still resets when it should.
            key={sessionKey ?? sessionId}
            ref={listRef}
            scrollerRef={scrollerRef}
            columnClassName={listColumnClass}
            contentClassName={listContentClass}
            clearance={dockH}
            gutter={gutter}
            jumpBottom={dockH + 12}
            onScrollableChange={handleScrollableChange}
            onStartReached={handleStartReached}
            loadingOlder={historyLoadingMore}>
            {messages.map((item) => (
              // `scrollAnchor` on your own messages is what makes a new turn
              // settle near the top of the viewport with a peek of the previous
              // one above it, instead of starting at the bottom edge — the reply
              // then grows into the room below. Once it fills the viewport the
              // scroller is back at the live edge and following takes over, so
              // this composes with `autoScroll` rather than fighting it.
              <MessageScrollerItem key={listKeyExtractor(item)} messageId={item.id} scrollAnchor={item.role === 'user'}>
                {renderMessage({ item })}
              </MessageScrollerItem>
            ))}
          </Transcript>
          {/* Overlay footer: absolute + transparent, so the transcript scrolls
            underneath and shows through around the composer card. The list
            keeps the last bubble reachable via bottom content padding
            (= dockH). Same JSX position as before, so the focused input
            never remounts.
            `pointer-events-none` is what lets a tap on the transparent margin
            fall through to the list (which dismisses the keyboard). Every
            interactive child below opts back in with `pointer-events-auto` —
            the Composer already did; the Tasks / Subagents / Queued /
            completion panels did not, so they inherited `none` and were
            completely inert: no tap, no wheel, no touch-drag. `none` is
            inherited, so a panel that forgets it is not "mostly working", it
            is dead. */}
          <div
            ref={observeDock}
            className="pointer-events-none"
            // `right: gutter` keeps the composer, the status strip and the panels
            // out of the scrollbar's reserved lane. Measured rather than assumed:
            // it is 0 on macOS overlay scrollbars and ~15px on a classic one.
            style={{
              position: 'absolute',
              left: 0,
              right: gutter,
              bottom: 0,
              paddingBottom: kbH + kbGap,
              backgroundColor: 'transparent',
            }}>
            <div className="mx-auto w-full max-w-3xl">
              {/* Composer status strip — context %, tokens, subagents, cost. Tap opens
            the full Session info sheet. */}
              {/* Kept mounted (hidden, not unmounted) while idle: on web a sibling
            that appears/disappears next to a focused input is one more chance
            for the browser to drop the caret out of the composer. */}
              <div
                className="px-3.5 pb-1 text-xs text-neutral-500 dark:text-neutral-400 truncate"
                style={toolLine ? undefined : { display: 'none' }}>
                {toolLine ?? ''}
              </div>
              {/* Agent todo checklist (`todo.updated`) — one collapsed summary line,
            tap to expand the full list. */}
              {todos.length > 0 &&
                (() => {
                  const done = todos.filter(todoDone).length;
                  const active = todos.find(todoActive);
                  return (
                    <div className="pointer-events-auto mx-2.5 mb-1.5 overflow-hidden rounded-2xl border border-border glass-composer">
                      <Button
                        variant="ghost"
                        onClick={() => setTodosOpen((v) => !v)}
                        className="flex items-center gap-2 px-3 py-2">
                        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                          Tasks
                        </span>
                        <span className="shrink-0 text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">
                          {done}/{todos.length}
                        </span>
                        {!todosOpen && active && (
                          <span className="min-w-0 flex-1 text-[12px] text-neutral-500 dark:text-neutral-400 truncate">
                            · {todoLabel(active)}
                          </span>
                        )}
                        {todosOpen && <div className="flex-1" />}
                        {todosOpen ? (
                          <ChevronUp size={15} color={dark ? '#a3a3a3' : '#666'} />
                        ) : (
                          <ChevronDown size={15} color={dark ? '#a3a3a3' : '#666'} />
                        )}
                      </Button>
                      {todosOpen && (
                        <div className="overflow-y-auto max-h-[200px]">
                          <div>
                            {todos.map((t, i) => {
                              const d = todoDone(t);
                              const a = todoActive(t);
                              return (
                                <div key={`${i}-${todoLabel(t)}`} className="flex items-start gap-2 px-3 py-1">
                                  <div
                                    className={`shrink-0 text-[13px] leading-[18px] ${
                                      d
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : a
                                          ? 'text-brand'
                                          : 'text-neutral-400 dark:text-neutral-500'
                                    }`}>
                                    {d ? '✓' : a ? '◐' : '○'}
                                  </div>
                                  <div
                                    className={`min-w-0 flex-1 text-[13px] leading-[18px] ${
                                      d
                                        ? 'text-neutral-400 line-through dark:text-neutral-500'
                                        : 'text-neutral-800 dark:text-neutral-200'
                                    }`}>
                                    {todoLabel(t)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              {/* Live subagents (polled from subagent.list while a turn runs). */}
              {subagents.length > 0 &&
                (() => {
                  const running = subagents.filter((s) => !subagentDone(s)).length;
                  const first = subagents.find((s) => !subagentDone(s)) ?? subagents[0];
                  return (
                    <div className="pointer-events-auto mx-2.5 mb-1.5 overflow-hidden rounded-2xl border border-border glass-composer">
                      <Button
                        variant="ghost"
                        onClick={() => setSubagentsOpen((v) => !v)}
                        className="flex items-center gap-2 px-3 py-2">
                        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                          Subagents
                        </span>
                        <span className="shrink-0 text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">
                          {running}/{subagents.length}
                        </span>
                        {!subagentsOpen && first && (
                          <span className="min-w-0 flex-1 text-[12px] text-neutral-500 dark:text-neutral-400 truncate">
                            · {first.goal || first.last_tool || first.subagent_id}
                          </span>
                        )}
                        {subagentsOpen && <div className="flex-1" />}
                        {subagentsOpen ? (
                          <ChevronUp size={15} color={dark ? '#a3a3a3' : '#666'} />
                        ) : (
                          <ChevronDown size={15} color={dark ? '#a3a3a3' : '#666'} />
                        )}
                      </Button>
                      {subagentsOpen && (
                        <div className="overflow-y-auto max-h-[160px]">
                          <div>
                            {subagents.map((s) => {
                              const done = subagentDone(s);
                              return (
                                <div key={s.subagent_id} className="flex items-center gap-2 px-3 py-1">
                                  <div
                                    className={`shrink-0 text-[13px] leading-[18px] ${
                                      done ? 'text-neutral-400 dark:text-neutral-500' : 'text-brand'
                                    }`}>
                                    {done ? '✓' : '◐'}
                                  </div>
                                  <div
                                    className={`min-w-0 flex-1 text-[13px] leading-[18px] ${
                                      done
                                        ? 'text-neutral-400 dark:text-neutral-500'
                                        : 'text-neutral-800 dark:text-neutral-200'
                                    } truncate`}>
                                    {s.goal || s.last_tool || s.subagent_id}
                                  </div>
                                  {s.tool_count != null && (
                                    <div className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
                                      {s.tool_count} calls
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              {/* Prompt queue — drafts held while a turn runs, drained one per turn
            end. Sits above the completion panel so completions stay nearest the
            input. */}
              {queued.length > 0 && (
                <div className="pointer-events-auto mx-2.5 mb-1.5 overflow-hidden rounded-2xl border border-border glass-composer">
                  <div className="flex items-center justify-between px-3 pb-0.5 pt-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                      {queueParked ? `Queued · paused (${queued.length})` : `Queued (${queued.length})`}
                    </div>
                    {queueParked ? (
                      <Button variant="link" onClick={resumeQueue} className="px-1.5 py-0.5">
                        <span className="text-[11px] font-semibold">Resume</span>
                      </Button>
                    ) : (
                      <Button variant="link" onClick={clearQueue} className="px-1.5 py-0.5">
                        <span className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">Clear</span>
                      </Button>
                    )}
                  </div>
                  <div className="overflow-y-auto max-h-[160px]">
                    <div>
                      {queued.map((q) => (
                        <div key={q.id} className="flex items-center gap-2 px-3 py-1.5">
                          <div className="min-w-0 flex-1 text-[13px] text-neutral-800 dark:text-neutral-200 truncate">
                            {q.text}
                          </div>
                          <Button
                            variant="outline"
                            onClick={() => sendQueuedNow(q.id)}
                            className="shrink-0 px-1.5 py-0.5">
                            <span className="text-[11px] font-semibold">Send</span>
                          </Button>
                          <Button variant="link" onClick={() => removeQueued(q.id)} className="shrink-0 px-1.5 py-0.5">
                            <span className="text-[15px] leading-[15px] text-neutral-400">×</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {/* Composer completion panel (slash commands / @ references) — floats
            above the composer as a normal flex child (not an absolute overlay),
            so its rows stay tappable on Android and the input keeps focus while
            the user keeps typing. */}
              {visibleCompletions.length > 0 && (
                <div className="pointer-events-auto mx-2.5 mb-1.5 overflow-hidden rounded-2xl border border-border glass-composer">
                  <div className="flex items-center justify-between px-3 pb-0.5 pt-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                      {completionKind === 'slash' ? 'Commands' : 'References'}
                    </div>
                    <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
                      {visibleCompletions.length}
                    </div>
                  </div>
                  {/* `overflow-x-hidden` is load-bearing: a row is a `Button`, whose base
                    carries `whitespace-nowrap`, so a long command description
                    made the panel wider than its box and gave it a horizontal
                    scrollbar beside the vertical one. `overscroll-contain` stops
                    a swipe that runs out of rows from chaining to the
                    transcript behind. */}
                  <div className="max-h-[248px] overflow-x-hidden overflow-y-auto overscroll-contain">
                    <div>
                      {visibleCompletions.slice(0, 40).map((item, i) => {
                        const label = item.display || item.text;
                        return (
                          <Button
                            variant="ghost"
                            key={`${item.text}-${i}`}
                            data-testid={`completion-option-${i}`}
                            onClick={() => applyCompletion(item)}
                            // `w-full justify-start min-w-0` override the
                            // button base's `shrink-0` + `justify-center`: a
                            // shrink-to-fit row centred in a narrower box puts
                            // its overflow on *both* sides, and the left half
                            // can never be scrolled to.
                            className="flex w-full min-w-0 items-center justify-start gap-2 overflow-hidden px-3 py-2 text-left">
                            <span className="max-w-[45%] text-[14px] font-semibold text-brand truncate">{label}</span>
                            {item.meta ? (
                              <span className="min-w-0 flex-1 text-[12px] text-neutral-500 dark:text-neutral-400 truncate">
                                {item.meta}
                              </span>
                            ) : (
                              <div className="flex-1" />
                            )}
                            {item.kind === 'skill' && (
                              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-600 dark:bg-muted dark:text-neutral-300">
                                skill
                              </span>
                            )}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              {editingRowId != null && (
                <div className="pointer-events-auto mx-2.5 mb-1 flex items-center gap-2 rounded-xl border border-brand/40 bg-brand/5 px-3 py-1.5/40/10">
                  <div className="min-w-0 flex-1 text-[12px] text-brand">
                    Editing — resend to rewind and rerun from here
                  </div>
                  <Button variant="link" onClick={cancelEdit} className="shrink-0 px-1.5 py-0.5">
                    <span className="text-[12px] font-semibold text-neutral-500 dark:text-neutral-400">Cancel</span>
                  </Button>
                </div>
              )}
              <Composer
                input={input}
                setInput={setInput}
                send={onSend}
                stop={stop}
                onRedirect={onRedirect}
                onQueue={onQueue}
                onPasteLarge={pasteLarge}
                generating={generating}
                model={model}
                modelProvider={modelProvider}
                onOpenModelPicker={openModelPicker}
                effort={effort}
                effortWire={effortWire}
                showEffort={showEffort}
                attachMenu={attachMenu}
                effortMenu={effortMenu}
                attachments={attachments}
                setAttachments={setAttachments}
                dark={dark}
                stackModel={winW < 768}
                keyboardUp={kbH > 0}
                approvalMode={approvalMode}
                onCycleApproval={cycleApproval}
              />
            </div>
          </div>
        </div>
        {/* The jump-to-newest button lives inside <Transcript> now — it is the
          visual half of the scroller's own `scrollable.end` state, and it has
          to be rendered under the same provider to read it. */}

        <AskSheet
          open={!!ask}
          ask={ask}
          onValue={answerValue}
          onApproval={answerApproval}
          onAskResult={answerAsk}
          onOpenChange={(o) => !o && onAskSheetDismiss()}
          gw={getGw()}
          contextLabel={sessionTitle || undefined}
        />

        {/* Thinking effort, as a menu. It was a hand-drawn list in the panel
            below; as a menu it gains arrow-key roving and typeahead, and the
            effort choice becomes a real radio group rather than eight buttons
            each re-deriving its own selected state. */}
        <DropdownMenu
          handle={effortMenu}
          onOpenChange={(o) => {
            // Only on open: the same call the old `openPopover('effort')` made.
            if (o) void loadReasoningDisplay();
          }}>
          <DropdownMenuContent side="top" align="start" className="w-[190px]">
            {/* The label has to sit inside a group: Base UI's GroupLabel reads
                its context and throws without one ("MenuGroupContext is
                missing"), where Radix's Label was happy on its own. */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2.5 pt-1.5 pb-0.5 text-[11px] font-semibold tracking-wide uppercase">
                Thinking effort
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={effort.trim().toLowerCase()}
                onValueChange={(v) => void applyEffort(String(v))}>
                {effortOptions.map((e) => (
                  <DropdownMenuRadioItem
                    key={e}
                    value={e}
                    data-testid={`effort-option-${e}`}
                    className="px-2.5 py-2 pr-8 text-[14px]">
                    {reasoningLabel(e)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            {/* Fast mode — separate from reasoning (`config.set fast`). */}
            <DropdownMenuSeparator className="my-1 h-[1px] bg-muted dark:bg-muted" />
            <DropdownMenuCheckboxItem
              data-testid="fast-toggle"
              checked={sessionInfo?.fast === true}
              onCheckedChange={() => void applyFast(!(sessionInfo?.fast === true))}
              className="px-2.5 py-2 pr-8 text-[14px]">
              Fast mode
            </DropdownMenuCheckboxItem>
            {/* Reasoning display — the switch behind live tool + reasoning
                streaming (`config.set reasoning show|hide`). `hide` persists
                tool calls to history without live events; `show` streams
                everything. Shared display setting (desktop included).
                Never disabled: with an unknown value a tap turns live
                streaming ON (the useful direction — this is the switch that
                fixes "bubbles only appear after the turn ends"). */}
            <DropdownMenuCheckboxItem
              data-testid="show-reasoning-toggle"
              checked={showReasoning === true}
              onCheckedChange={() => void applyShowReasoning(showReasoning !== true)}
              className="px-2.5 py-2 pr-8 text-[14px]">
              Show reasoning
            </DropdownMenuCheckboxItem>
            <div className="px-2.5 pb-1 text-[11px] leading-[15px] text-neutral-500 dark:text-neutral-400">
              {showReasoning === null
                ? 'Streams tool calls + reasoning live. Unknown on this gateway — tap to turn on.'
                : 'Streams tool calls + reasoning live (shared display setting).'}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Attach, as a menu. The two actions close the menu themselves now. */}
        <DropdownMenu handle={attachMenu}>
          <DropdownMenuContent side="top" align="start" className="w-[184px]">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2.5 pt-1.5 pb-0.5 text-[11px] font-semibold tracking-wide uppercase">
                Attach
              </DropdownMenuLabel>
              <DropdownMenuItem
                data-testid="attach-photo"
                onClick={() => void pickImage()}
                className="gap-2.5 px-2.5 py-2 text-[14px]">
                <ImageIcon size={17} color={dark ? '#ccc' : '#444'} />
                <span className="text-neutral-900 dark:text-neutral-100">Photo</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="attach-file"
                onClick={() => void pickFile()}
                className="gap-2.5 px-2.5 py-2 text-[14px]">
                <FileText size={17} color={dark ? '#ccc' : '#444'} />
                <span className="text-neutral-900 dark:text-neutral-100">File</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* The model picker, deliberately NOT a menu.
            It reads as one, but it is a search + browse + act surface: a filter
            field over ~300 models across a dozen providers, providers that
            expand in place, and *two* actions per model (use for this chat, and
            set as the global default). A menu item is a single action, and a
            menu owns focus — typing into the search field would be fighting the
            menu's own typeahead. Its natural home is a combobox, not a menu.
            So it keeps the measured screen-level panel.
            This is also why the panel is still rendered at screen level rather
            than in the composer: that split was for Android's touch bounds,
            which Base UI's portal makes moot for the two menus above, but this
            panel is measured and positioned by hand. */}
        {popover && (
          <>
            <button
              type="button"
              data-testid="popover-backdrop"
              style={{ position: 'absolute', inset: 0, zIndex: 60 }}
              onClick={closePopover}
            />
            <div
              data-testid="anchor-popover"
              // `flex flex-col` is load-bearing, not decoration: the body below
              // is `flex-1 min-h-0 overflow-y-auto` and the panel's own height is
              // capped by `maxHeight`. With a block parent all three of those
              // are inert — the scroller takes its content height (a few
              // thousand px once a provider is expanded) and spills straight out
              // of the capped panel instead of scrolling inside it.
              className="absolute z-[70] flex flex-col rounded-xl border border-border bg-popover p-1"
              style={{
                width: popW,
                left: popLeft,
                bottom: popBottom,
                maxHeight: popMaxH,
              }}>
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Switch model (this chat)
              </div>
              <div className="px-1.5 pb-1.5">
                <Input
                  className="rounded-lg border border-border px-2.5 py-1.5 text-[14px] text-neutral-950 dark:text-neutral-100"
                  value={modelQuery}
                  onChange={(e) => setModelQuery(e.target.value)}
                  placeholder="Search models…"
                  autoCapitalize="none"
                />
              </div>
              {providersLoading && (
                <div className="px-3 py-1 text-[13px] text-neutral-500 dark:text-neutral-400">loading models…</div>
              )}
              {!!providersError && (
                <div role="alert" className="px-3 py-1 text-[13px] text-[#c5221f] dark:text-[#ff7b72]">
                  {providersError}
                </div>
              )}
              <div className="overflow-y-auto min-h-0 flex-1">
                <div>
                  {modelVisibleProviders.map((p) => {
                    const count = p.models?.length ?? p.totalModels;
                    const open = mq ? true : (modelExpanded[p.slug] ?? false);
                    return (
                      <div key={p.slug || p.name}>
                        <Button
                          variant="ghost"
                          onClick={() => setModelExpanded((e) => ({ ...e, [p.slug]: !(e[p.slug] ?? false) }))}
                          className="flex items-center gap-2 px-2.5 py-2">
                          <span className="min-w-0 flex-1 text-[14px] font-bold text-neutral-950 dark:text-neutral-100 truncate">
                            {p.name}
                          </span>
                          <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
                            {count} model{count === 1 ? '' : 's'}
                          </span>
                          {open ? (
                            <ChevronDown size={15} color={dark ? '#a3a3a3' : '#666'} />
                          ) : (
                            <ChevronRight size={15} color={dark ? '#a3a3a3' : '#666'} />
                          )}
                        </Button>
                        {open &&
                          (p.models ?? []).map((mm) => {
                            const on = mm === model && p.slug === modelProvider;
                            return (
                              <div
                                key={mm}
                                // `pl-1.5` to match the provider rows above and the
                                // panel's own `px-3` — the model rows used to start
                                // further in (`pl-3` plus the gap between this
                                // button and Global), which read as a second indent
                                // level under a list that is already flat.
                                className={`flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-1.5 ${
                                  on ? 'bg-brand/10 dark:bg-brand/20' : ''
                                }`}>
                                {' '}
                                <Button
                                  variant="ghost"

                                  aria-pressed={on}
                                  aria-label={mm}
                                  onClick={() => {
                                    void pickModel(p.slug, mm);
                                    closePopover();
                                  }}
                                  // The button base centres its content, which
                                  // reads as a floating label in a full-width row.
                                  // Left-align here and let the label take the
                                  // slack so a long model id ellipsizes against
                                  // the Global button instead of pushing it out.
                                  className="h-auto sm:h-auto min-w-0 flex-1 justify-start">
                                  <span
                                    className={`min-w-0 flex-1 text-left text-[14px] ${
                                      on ? 'font-semibold text-brand' : 'text-neutral-950 dark:text-neutral-100'
                                    } truncate`}>
                                    {on ? '● ' : '○ '}
                                    {mm}
                                  </span>
                                </Button>
                                <Button
                                  variant="outline"
                                  aria-label={`Set ${mm} as the global default`}
                                  onClick={() => {
                                    void setGlobalModel(p.slug, mm);
                                    closePopover();
                                  }}
                                  className="h-auto sm:h-auto shrink-0 px-2 py-1">
                                  <span className="text-[13px]">Global</span>
                                </Button>
                              </div>
                            );
                          })}
                        {open && !p.models && (
                          <div className="px-3 py-1.5 text-[13px] text-neutral-500 dark:text-neutral-400">
                            list unavailable — pull to refresh on server
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {modelVisibleProviders.length === 0 && !providersLoading && (
                    <div className="px-3 py-2 text-[13px] text-neutral-500 dark:text-neutral-400">no matches</div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      {/* Icon tooltip — so it never steals taps. */}
      {!!tip &&
        (() => {
          const relY = tip.anchor.y - rootWin.current.y;
          const rootH = rootWin.current.h || winH;
          const left = Math.max(8, Math.min(tip.anchor.x + tip.anchor.w / 2 - 48, winW - 104));
          return (
            <div
              className="absolute z-50 rounded-lg bg-black/85 px-2.5 py-1.5 dark:bg-popover/90"
              style={{ bottom: Math.max(8, rootH - relY + 8), left }}>
              <div className="text-[12px] text-white dark:text-black">{tip.label}</div>
            </div>
          );
        })()}
    </div>
  );
}
