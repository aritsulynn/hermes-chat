// Chat route — transcript + composer (was the 'chat' screen in App.tsx).
// Header back opens the drawer; the native Drawer replaces NavDrawer/EdgeSwipe.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { pickFiles } from '../../services/file-picker';
import { Navigate as Redirect } from 'react-router-dom';
import { ChevronDown, ChevronUp, Check, ChevronRight, Clock, Copy, FileText, Image as ImageIcon, Pencil, Search } from 'lucide-react';
import { useApp, useStreaming, useThemeValue } from '../../hooks/app-store';
import { Transcript } from '../../components/chat/transcript';
import { UserMenuDialog } from '../../components/chat/user-menu-dialog';
import type { TranscriptHandle } from '../../components/chat/transcript';
import { blurActiveElement, useViewportSize } from '../../hooks/use-viewport';
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
} from '../../utils/messages';
import { REASONING_EFFORT_VALUES, reasoningCapability, reasoningLabel } from '../../utils/reasoning';
import { fuzzyScoreMultiTokens } from '../../utils/fuzzy';
import { contextTone, mergeUsage } from '../../utils/usage';
import { isSlashSuggestion, skillUsage } from '../../utils/slash-commands';
import { placeholderColor, screenBg, screenStyle } from '../../theme';
import type { UiMessage } from '../../utils/messages';
import type { SlashCompletionItem } from '../../services/gateway-ws';
import { Composer } from '../../components/chat/composer';
import type { AnchorMeasure, AnchorRect } from '../../components/chat/composer';
import { MessageBubble, formatBubbleTime } from '../../components/chat/message-bubble';
import { AskSheet, InfoSheet } from '../../components/ui/sheets';
import { CtxRing, HamburgerBtn } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Text as UIText } from '../../components/ui/text';
import { Spinner } from '../../components/ui/bits';
import { ChatNormalHeader, ChatSearchHeader } from './components/ChatHeader';
import { FALLBACK_SLASH, messageMatchesSearch } from './helpers';
import { CHAT_WINDOW_SOFT_CAP } from '../../services/constants';
import type { TranscriptHit } from '../../store/types';
import { ScrollArea } from '../../components/ui/scroll';

// FlashList v2 sizes rows itself (no estimatedItemSize / getItemLayout).
// Heterogeneous bubbles recycle per role via getItemType below.

export function ChatScreen() {
  const {
    booting,
    authed,
    sessionId,
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
    infoOpen,
    setInfoOpen,
    infoSeq,
    sessionInfo,
    usageInfo,
    usageLoading,
    toolLine,
    ask,
    send,
    stop,
    redirectLive,
    renameSession,
    setGlobalModel,
    newSession,
    openInfo,
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
    historyExhausted,
    trimmedOlder,
    loadOlderMessages,
    trimHead,
    searchTranscript,
    findHitIndex,
    todos,
    subagents,
    refreshToolResults,
    pickModel,
    copyText,
    answerValue,
    answerApproval,
    answerAsk,
    dismissAsk,
    getGw,
  } = useApp();
  // High-frequency token deltas live in their own context (see useStreaming):
  // subscribing here keeps per-token re-renders inside the chat screen while
  // the rest of the app stays put.
  const streamingTexts = useStreaming();
  // Theme lives on its own context for the same reason: a toggle would
  // otherwise hand every useApp() consumer a new object.
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const headerIcon = dark ? '#f5f5f5' : '#111';

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
  const ctxPct =
    usage?.contextPercent != null ? Math.max(0, Math.min(100, Math.round(usage.contextPercent))) : null;
  const ctxTone = ctxPct == null ? 'ok' : contextTone(ctxPct);

  // Numeric bubble cap. A percentage max-width is not enough here: markdown
  // nests lists inside the bubble, and a percentage only resolves against a
  // parent that has already been laid out. A pixel value constrains the
  // measurement itself.
  const { width: winW, height: winH } = useViewportSize();
  const bubbleMax = Math.round(winW * 0.85);

  // Theme tokens resolved once per scheme: this screen re-renders on every
  // streamed token, and a fresh style object per render would re-push the
  // surface colours to native each time.
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
  const placeholder = useMemo(() => placeholderColor(dark), [dark]);

  // Screen-level anchored popovers ("+" attach, model picker, thinking effort),
  // anchored to the composer controls that opened them. Rendered here, not in
  // the composer, so they can float above the list and still receive taps — on
  // Android touches outside a parent's bounds are dropped, so a popover inside
  // the composer wouldn't work.
  const [popover, setPopover] = useState<
    { kind: 'effort' | 'attach' | 'model'; x: number; y: number; w: number; h: number } | null
>(null);
  const popoverMeasure = useRef<AnchorMeasure | null>(null);
  const [modelQuery, setModelQuery] = useState('');
  const [modelExpanded, setModelExpanded] = useState<Record<string, boolean>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const rootWin = useRef({ y: 0, h: 0 });

  const openPopover = useCallback(
    (kind: 'effort' | 'attach' | 'model', measure: AnchorMeasure) => {
      popoverMeasure.current = measure;
      if (kind === 'model') {
        setModelQuery('');
        void loadProviders();
      }
      if (kind === 'effort') {
        void loadReasoningDisplay();
      }
      measure((a) => setPopover({ kind, ...a }));
    },
    [loadProviders, loadReasoningDisplay],
  );
  // Re-anchor after the keyboard slides in/out and lifts the composer.
  const remeasurePopover = useCallback(() => {
    popoverMeasure.current?.((a) => setPopover((p) => (p ? { ...p, ...a } : p)));
  }, []);
  const closePopover = useCallback(() => {
    popoverMeasure.current = null;
    setPopover(null);
  }, []);

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
    if (!withUsage.some((r) => r.usage>= 0)) return filtered;
    return withUsage
      .sort((a, b) => b.usage - a.usage || a.i - b.i)
      .map((r) => r.it);
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
  // Latest transcript for stable callbacks (tool expand → REST result fill).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // Long-press fired: swallow the onPress that fires on release (else a
  // long-press on thinking/tool bubbles toggles them instead of selecting).
  const longFired = useRef(false);
  // True while the user sits at the bottom (following the live turn).
  // Content-size growth (stream tokens, expand thinking) auto-scrolls only
  // then — expanding an old bubble mid-list no longer yanks to the bottom.
  const stickEnd = useRef(true);
  // px from the true end that still counts as "at the bottom" (jump button
  // hides, transcript auto-follows). Shared by onScroll and snapToEnd below.
  const AT_END_PX = 120;
  // True briefly while the keyboard/dock padding changes — suppresses the
  // content-size auto-scroll so opening the keyboard doesn't shift the transcript.
  const kbResizeRef = useRef(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Agent todo checklist above the composer — collapsed to a one-line summary.
  const [todosOpen, setTodosOpen] = useState(false);
  // False while the list is scrolled up — shows the jump-to-bottom button.
  const [atBottom, setAtBottom] = useState(true);
  // True while the transcript actually overflows the viewport. Gates the jump
  // button so short chats never show it, and so a stale "not at bottom"
  // reading on a non-scrollable list can't pin the button on screen.
  const [canScroll, setCanScroll] = useState(false);
  // Height of the bottom footer (panels + composer), keyboard lift included.
  // Feeds the scroll-to-bottom button anchor above it. The footer overlays
  // the transcript (absolute, transparent), so the list reserves room for it
  // via content padding (see listContentStyle) instead of flex space.
  const [dockH, setDockH] = useState(0);
  // The overlay footer's own box, measured. This is the composer clearance the
  // transcript's bottom padding is built from, and it was silently zero: the
  // native build measured it with `onLayout`, the port dropped that prop, and
  // nothing was left to write the state. Symptom was the last bubble rendering
  // underneath the composer card.
  //
  // A ResizeObserver rather than a layout callback, and it watches the footer
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
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Keyboard height — the footer is lifted by hand with bottom padding. The
  // list stays full-height underneath the transparent footer zone.
  const [kbH, setKbH] = useState(0);
  // Gap between the lifted dock and the keyboard so the composer doesn't sit
  // flush on it. Only while the keyboard is open.
  const kbGap = kbH> 0 ? 8 : 0;
  const contentH = useRef(0);
  const layoutH = useRef(0);
  const endPad = useRef(0);
  // Tail gap lives in the list content padding (= dockH, see
  // listContentStyle) so the last bubble can scroll above the overlaid
  // footer instead of hiding behind it.
  endPad.current = 0;
  // Fresh-load pin: after F5 / session switch / resume, land at the bottom
  // explicitly (instant, one shot). The content-size follow alone can lose the
  // race against MVCP stabilization on a cold load and strand the viewport at
  // the top. Detects reloads by session/first-message/length signature —
  // plain appends (new messages while reading history) deliberately do NOT
  // pin; stickEnd governs those.
  const pinTrack = useRef({ sid: null as string | null, first: null as string | null, len: 0 });
  // Y where the current drag started — snap only fires on net-downward moves.
  const dragStartY = useRef(0);
  // Consecutive non-touch, non-bottom scroll frames (see handleScroll) —
  // transients must persist before they may cancel following.
  const missEnd = useRef(0);
  // Fresh-load intent: set on reload signature, cleared on landing, on user
  // positioning (drag/momentum release), or never — it survives transient
  // system events that must not strand a cold load mid-list. Plain appends
  // never set it, so reading history is never yanked.
  const pinWanted = useRef(false);
  // Latest scroll offset (mirrored in onScroll) — the jump button instant-jumps
  // when far instead of smooth-scrolling ten thousand pixels sluggishly.
  const scrollY = useRef(0);
  // True while the user's finger is down — onScroll only flips follow state on
  // user-driven scrolls, never mid-flight of a programmatic scrollEnd.
  const touching = useRef(false);
  // True while a programmatic scrollEnd is in flight (cleared on arrival or by
  // timeout). Without this, onScroll mid-flight flips stickEnd=false, and any
  // growth during the flight (stream tokens, a loading image resolving) lands
  // the list short with nobody left to finish the trip.
  const flying = useRef(false);
  // Live child-agent roster (subagent.list) — same collapsed-summary treatment.
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  const tokenEstimate = useMemo(() => {
    let n = 0;
    for (const m of messages) n += Math.ceil(m.text.length / 4);
    for (const k in streamingTexts) n += Math.ceil(streamingTexts[k].length / 4);
    return n;
  }, [messages, streamingTexts]);
  // Regenerate targets the last assistant bubble; the rewind target is the last
  // user row that carries a durable id.
  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'assistant')?.id,
    [messages],
  );
  const hasRegenTarget = useMemo(
    () => messages.some((m) => m.role === 'user' && m.rowId != null && m.text.trim()),
    [messages],
  );
  // In-conversation search.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);

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
  // here would re-render every bubble (markdown re-parse + native tree rebuild)
  // and the focused TextInput on each streamed token.
  const openModelPicker = useCallback((m: AnchorMeasure) => openPopover('model', m), [openPopover]);
  const openEffortPicker = useCallback((m: AnchorMeasure) => openPopover('effort', m), [openPopover]);
  const openAttachPicker = useCallback((m: AnchorMeasure) => openPopover('attach', m), [openPopover]);
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
  // Long-press menu on our own messages (Copy / Edit) — same popover pattern.
  const [userMenu, setUserMenu] = useState<{ anchor: AnchorRect; id: string } | null>(null);
  const openUserMenu = useCallback(
    (m: AnchorMeasure, id: string) => m((a) => setUserMenu({ anchor: a, id })),
    [],
  );
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

  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Trailing throttle for the per-token auto-follow (see
  // handleContentSizeChange): without it every streamed token fires a native
  // scroll command (~30/s) — layout thrash and a viewport that fights back.
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Backstop for the fresh-load pin below (cleared + reset per reload).
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollEnd = useCallback((animated?: unknown) => {
    const anim = animated === false ? false : true;
    // Double-tick: one frame for layout shrink (keyboard resize), one for content.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Exact offset, not scrollToEnd(): the measured end is deterministic
        // (contentH/layoutH track the same geometry the padding is built from).
        const end = Math.max(0, contentH.current - layoutH.current);
        if (end <= 0) return;
        flying.current = true;
        // `flying` means "the next scroll events are mine, not the user's".
        //
        // On a native list that had to cover a momentum animation, so it was held
        // for 1200ms as a backstop. A DOM scroll is not like that:
        // `behavior: 'auto'` is applied synchronously and emits exactly one
        // scroll event, so a short window is correct; `'smooth'` genuinely does
        // animate and needs longer. The two are now separated because the
        // over-long window on the instant path was a livelock, not just waste —
        // `handleScroll` ignores the user's own scroll while `flying` is set, so
        // a follow re-arming it every 250ms meant the counter that disengages
        // following could never advance, and wheeling up was dragged back to the
        // bottom indefinitely. The scrollbar still worked, which is what made it
        // look like a pointer problem rather than a follow problem.
        if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
        scrollEndTimer.current = setTimeout(() => {
          flying.current = false;
        }, anim ? 600 : 120);
        listRef.current?.scrollToOffset({ offset: end, animated: anim });
      });
    });
  }, []);
  useEffect(
    () => () => {
      if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
      if (followTimer.current) clearTimeout(followTimer.current);
      if (pinTimer.current) clearTimeout(pinTimer.current);
    },
    [],
  );

  // Small snap-through near the end on downward releases only — an upward
  // release is the user reading back, and must never be stolen.
  //
  // Fired from the scroller's pointerup rather than from a scroll event: the
  // native list had a drag-end event, and a scroll tick is not the same thing.
  // On the web a fling can come to rest before its last scroll event is
  // delivered, so a screen that only heard `onScroll` would settle the follow
  // state late or not at all.
  const snapToEnd = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    touching.current = false;
    const y = el.scrollTop();
    // Settle follow state from the release position itself (don't wait for
    // scroll events that may never come on a static list): released at the
    // bottom → following; released mid-list → user parked deliberately.
    const rest = el.distanceFromEnd();
    stickEnd.current = rest < AT_END_PX;
    pinWanted.current = false;
    if (y < dragStartY.current - 4) return;
    if (rest <= 2 || rest > endPad.current + 8) return;
    stickEnd.current = true;
    setAtBottom(true);
    scrollEnd();
  }, [scrollEnd, setAtBottom]);

  // pointerdown on the scroller. Both values are read at the gesture's start:
  // dragStartY is the reference the release is compared against, and reading it
  // later would compare the release against itself and make every drag look
  // like it scrolled nowhere.
  const handleInteractStart = useCallback(() => {
    const el = listRef.current;
    touching.current = true;
    dragStartY.current = el ? el.scrollTop() : 0;
  }, []);

  // The scroller's own height. This is the number the distance-to-the-end
  // arithmetic needs, and it is genuinely separate from the content height: a
  // keyboard opening shrinks the scroller and leaves the content untouched.
  const handleViewportResize = useCallback((viewportH: number) => {
    layoutH.current = viewportH;
    setCanScroll(contentH.current > viewportH + 40);
    if (stickEnd.current) scrollEnd(false);
  }, [scrollEnd]);

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
        scrollEnd(true);
        remeasurePopover();
      }, 50);
    };
    const onKeyboardHide = () => {
      setKbH(0);
      t2 = setTimeout(() => {
        scrollEnd(true);
        remeasurePopover();
      }, 50);
    };
    vv?.addEventListener('resize', onKeyboard);
    return () => {
      vv?.removeEventListener('resize', onKeyboard);
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
  }, [scrollEnd, remeasurePopover]);

  // Keyboard/footer resize does NOT auto-scroll: other chat apps leave the
  // transcript where it is and let the user scroll down to the newest message.
  // (kbResizeRef guards the follow during the resize transition.)
  useEffect(() => {
    if (kbH === 0 && dockH === 0) return;
    kbResizeRef.current = true;
    const t = setTimeout(() => {
      kbResizeRef.current = false;
    }, 450);
    return () => clearTimeout(t);
  }, [kbH, dockH]);

  useEffect(() => {
    const prev = pinTrack.current;
    const first = messages.length ? messages[0].id : null;
    pinTrack.current = { sid: sessionId, first, len: messages.length };
    if (!sessionId || messages.length === 0) return;
    const reloaded =
      sessionId !== prev.sid || first !== prev.first || prev.len === 0;
    if (!reloaded) return;
    // Declare intent immediately; the actual pin rides the content-size
    // follow (correct measurements post-layout), NOT a direct scrollEnd here:
    // on a cold load contentH/layoutH are still stale when this effect runs,
    // so an immediate scroll computes a bogus small offset, strands the
    // viewport up top, and reads exactly like "went down then bounced back".
    stickEnd.current = true;
    setAtBottom(true);
    // Backstop: if no content-size event ever arrives to trigger the follow
    // (static transcript, kb-suppressed window), pin once, late. Survives
    // appends (only a new reload resets it); holding a finger down re-arms
    // instead of firing into an actively-driven list.
    if (pinTimer.current) clearTimeout(pinTimer.current);
    pinWanted.current = true;
    pinTimer.current = setTimeout(function tick() {
      pinTimer.current = null;
      if (touching.current) {
        pinTimer.current = setTimeout(tick, 600);
        return;
      }
      if (stickEnd.current || pinWanted.current) scrollEnd(false);
    }, 600);
  }, [sessionId, messages, scrollEnd]);

  // Fetch picker inventory when entering a chat (WS model.options, REST fallback).
  useEffect(() => {
    if (sessionId && providers === null && !providersLoading) {
      void loadProviders();
    }
  }, [sessionId, providers, providersLoading, loadProviders]);

  const onSend = useCallback(() => {
    stickEnd.current = true;
    void send();
    scrollEnd();
  }, [send, scrollEnd]);

  // Attach actions live here (not in the composer) because their UI — the "+"
  // popover — is rendered at screen level. See pickImage/pickFile callers below.
  // Images go through the same <input type="file"> as everything else, with an
  // `accept` filter standing in for the native picker's `mediaTypes`. Note what
  // is *not* here: the native path asked the picker to downscale to quality
  // 0.8. A browser cannot re-encode an image it did not decode, and the
  // upload has a size ceiling that rejects anything too large anyway, so the
  // original file goes up as-is.
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
      setAttachments([
        ...attachments,
        ...picked.map((f) => ({ uri: f.uri, name: f.name || 'file', mime: f.mime })),
      ]);
    }
  }, [attachments, setAttachments]);

  // The ask and info sheets are controlled Radix dialogs: `open` is the store
  // state, full stop.
  //
  // The 60 lines this replaces were a state machine for two gorhom bugs. Its
  // dismiss() on a never-presented sheet flipped the internal status to
  // DISMISSING, after which the portal refused to render anything — silently,
  // forever — and presenting mid-dismiss stranded the backdrop as a stuck dark
  // screen. Both needed a flag to avoid the call. Neither has a DOM equivalent:
  // React re-renders from `open`, so "presenting again" and "staying open" are
  // the same statement.
  //
  // `ask` and `infoOpen` are the whole contract. The sheet cannot be dismissed
  // by the user at all (AskSheet prevents Escape and outside-press), so
  // onOpenChange only ever fires for a programmatic close we asked for.
  const onAskSheetDismiss = useCallback(() => {
    dismissAsk();
  }, [dismissAsk]);

  // In-conversation search — full-transcript hits (server rows, not just the
  // loaded window), with jumps that page older history in until the hit is
  // mounted. Window highlight stays query-local (see highlightIds below).
  const sq = searchQuery.trim().toLowerCase();
  const [searchHits, setSearchHits] = useState<TranscriptHit[]>([]);
  const jumpToHit = useCallback(
    async (n: number, hits: TranscriptHit[]) => {
      if (hits.length === 0) return;
      const k = ((n % hits.length) + hits.length) % hits.length;
      setMatchIdx(k);
      stickEnd.current = false;
      let idx = findHitIndex(hits[k]);
      // Page older history in until the hit mounts (bounded; exhausted stops).
      let guard = 0;
      while (idx < 0 && guard++ < 8 && !historyExhausted) {
        const ran = await loadOlderMessages();
        if (!ran) break;
        idx = findHitIndex(hits[k]);
      }
      if (idx < 0) return;
      try {
        void listRef.current
          ?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: true })
          ?.catch(() => {});
      } catch {}
    },
    [findHitIndex, historyExhausted, loadOlderMessages],
  );
  const jumpToHitRef = useRef(jumpToHit);
  jumpToHitRef.current = jumpToHit;
  // Debounced so a burst of keystrokes makes one index filter (the full fetch
  // itself is cached per transcript revision inside searchTranscript).
  useEffect(() => {
    if (!searchOpen || !sq) {
      setSearchHits([]);
      setMatchIdx(0);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      void searchTranscript(sq).then((hits) => {
        if (!live) return;
        setSearchHits(hits);
        void jumpToHitRef.current(0, hits);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [searchOpen, sq, searchTranscript]);

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
      .filter((p) => (q ? (p.models?.length ?? 0)> 0 : true));
  }, [modelProviders, mq]);
  // Search highlight: precompute matched ids once instead of toLowerCase per bubble per render.
  // Includes buffered streaming text for searchable conversation messages.
  const highlightIds = useMemo(() => {
    if (!searchOpen || !sq) return null;
    const s = new Set<string>();
    for (const m of messages) {
      if (messageMatchesSearch(m, streamingTexts[m.id], sq)) s.add(m.id);
    }
    return s;
  }, [searchOpen, sq, messages, streamingTexts]);
  // `paddingBottom: dockH` keeps the last bubble scrollable above the overlaid
  // composer; the gap between rows is `gap-2` on this box, which is what
  // FlashList's explicit separator existed to work around (its cells are
  // absolutely positioned, so `gap` on the container was ignored).
  // Static classes only. The composer clearance is a style, not a class: a
  // Tailwind utility built from a template literal is never emitted by the
  // scanner, so `pb-[${dockH}px]` produced no rule at all and the transcript had
  // no bottom padding — the last bubble sat under the composer.
  const listContentClass = 'flex flex-col gap-2 px-3 pt-3';
  const listContentStyle = useMemo(() => ({ paddingBottom: Math.round(dockH) }), [dockH]);
  const listKeyExtractor = useCallback((m: UiMessage) => m.id, []);
  // (was: FlashList recycled per bubble role, and
  // Armed while an older page loads: offset + content height captured after
  // the fetch resolves, consumed by the next content-size growth (see
  // handleContentSizeChange). Without it a prepend yanks the viewport upward.
  const prependAdj = useRef<{ prevY: number; prevContentH: number } | null>(null);
  // held the viewport steady across a prepend. Both are gone: the scroller is
  // plain DOM, so `renderItem` re-runs on any prop change and the position is
  // corrected by handleContentSizeChange.)
  const handleContentSizeChange = useCallback(
    (h: number) => {
      const prevH = contentH.current;
      contentH.current = h;
      setCanScroll(h> layoutH.current + 40);
      // Prepended an older page above the viewport: shift the offset down by
      // the growth so the row under the finger stays put (no yank to top).
      if (prependAdj.current) {
        const { prevY, prevContentH } = prependAdj.current;
        prependAdj.current = null;
        const dh = h - (prevContentH ?? prevH);
        if (dh> 8) {
          flying.current = true;
          if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
          scrollEndTimer.current = setTimeout(() => {
            flying.current = false;
          }, 1200);
          listRef.current?.scrollToOffset({ offset: Math.max(0, prevY + dh), animated: false });
        }
        return;
      }
      if (touching.current) return;
      if (!stickEnd.current || kbResizeRef.current) return;
      // Coalesce: at most one follow per window no matter how many tokens
      // land inside it. Discrete follows (send, keyboard, session open) call
      // scrollEnd directly and are unaffected.
      if (followTimer.current) return;
      followTimer.current = setTimeout(() => {
        followTimer.current = null;
        if ((!stickEnd.current && !pinWanted.current) || touching.current) return;
        // Skip micro-gaps: the bottom is already on screen, and firing a
        // native scroll per tick for a few pixels is what made following look
        // steppy. Glide (animated) for short hops, jump (instant) for long
        // hauls — same rule as the scroll-to-bottom button (a full-transcript
        // animated glide reads as a slow descent).
        const end = Math.max(0, contentH.current - layoutH.current);
        const dist = end - scrollY.current;
        if (dist < 12) return;
        scrollEnd(dist < 3000);
      }, 250);
    },
    [scrollEnd],
  );
  // The same stick-to-bottom heuristic as before, reading position off the
  // element instead of a native scroll event. `AT_END_PX` and every ref below
  // are unchanged — only the source of the numbers moved.
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    scrollY.current = el.scrollTop();
    const atEnd = el.distanceFromEnd() < AT_END_PX;
    if (flying.current && !touching.current) {
      if (atEnd) flying.current = false;
      else return;
    }
    if (atEnd) {
      // Landing near the bottom (re)engages following and retires any fresh-
      // load intent — self-healing after programmatic scrolls, layout shifts
      // and keyboard transitions. A fling that lands here is over by definition.
      missEnd.current = 0;
      stickEnd.current = true;
      pinWanted.current = false;
    } else if (touching.current) {
      // Genuine user driving (finger down, wheel, or trackpad): disengage
      // immediately and retire load intent — the user positioned deliberately.
      //
      // This used to read `touching.current || momentum.current`, and the
      // momentum half was dead on arrival: its only setter was FlashList's
      // onMomentumScrollBegin, which went when FlashList did. On the web a
      // trackpad fling is a wheel gesture, so `touching` now covers it.
      missEnd.current = 0;
      stickEnd.current = false;
      pinWanted.current = false;
    } else {
      // No touch, no momentum: MVCP adjustments, layout shifts and stray
      // events. A lone transient must never cancel following (it strands the
      // viewport mid-list with no further follow queued) — require it to
      // persist across frames. pinWanted deliberately survives this branch.
      missEnd.current += 1;
      if (missEnd.current>= 3) {
        stickEnd.current = false;
      }
    }
    setAtBottom((p) => (p === atEnd ? p : atEnd));
  }, []);
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
          bubbleMax={bubbleMax}
          dark={dark}
          expanded={!!expanded[item.id]}
          highlight={highlightIds?.has(item.id) ?? false}
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
    [bubbleMax, dark, expanded, highlightIds, onToggleExpand, copiedId, onCopy, generating, lastAssistantId, hasRegenTarget, onRegenerate, onBranchChat, openUserMenu, showTip],
  );

  const closeSearch = useCallback(() => {
    blurActiveElement();
    setSearchOpen(false);
    setSearchQuery('');
  }, []);

  // A room switch should not carry another conversation's search term/results.
  useEffect(() => {
    closeSearch();
  }, [closeSearch, sessionId]);

  // ── Transcript window ────────────────────────────────────────────────
  // Older pages prepend above the viewport: capture the offset AFTER the
  // fetch resolves (pre-flush, so contentH still excludes the new rows) and
  // let handleContentSizeChange shift it down by the growth.
  const onLoadOlder = useCallback(() => {
    void loadOlderMessages().then((ran) => {
      if (ran) prependAdj.current = { prevY: scrollY.current, prevContentH: contentH.current };
    });
  }, [loadOlderMessages]);
  const handleStartReached = useCallback(() => {
    onLoadOlder();
  }, [onLoadOlder]);
  // Head trim past the soft cap: only while pinned at the bottom, idle, and
  // not paging — reading history up top is never yanked. Trimmed rows stay
  // server-side and come back through onLoadOlder.
  useEffect(() => {
    if (messages.length> CHAT_WINDOW_SOFT_CAP && !generating && atBottom && !historyLoadingMore) {
      trimHead();
    }
  }, [messages.length, generating, atBottom, historyLoadingMore, trimHead]);
  const ListHeader = useCallback(() => {
    if (historyLoadingMore) {
      return (
        <div className="flex flex-col items-center py-3">
          <Spinner size={14} color="currentColor" />
          <UIText className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">loading older…</UIText>
        </div>
      );
    }
    if (trimmedOlder> 0 || !historyExhausted) {
      return (
        <div className="flex flex-col items-center py-1.5">
          <Button variant="ghost" onClick={onLoadOlder} className="px-3 py-1.5">
            <UIText className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
              ↑ Load older messages
            </UIText>
          </Button>
        </div>
      );
    }
    return null;
  }, [historyLoadingMore, historyExhausted, trimmedOlder, onLoadOlder]);

  const searchVisible = Boolean(sessionId && searchOpen);

  if (booting) {
    return (
      <div style={screen}>
        <div className="flex flex-col flex-1 bg-white items-center justify-center gap-3 dark:bg-black">
          
          <Spinner size={24} color="currentColor" />
          <UIText className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">connecting…</UIText>
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
        <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-black">
          
          <div className="flex flex-col flex-1 items-center justify-center p-6">
            <UIText className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">No active session — start a new one.</UIText>
            <Button variant="default" onClick={() => void newSession()} className="mt-2 items-center px-[18px] py-[11px]">
              <UIText className="text-[15px] font-semibold">+ New chat</UIText>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Popover geometry: anchor above the tapped control (window → root coords).
  // (modelVisibleProviders/highlight/list memos live above the early returns.)
  const popW = popover
    ? popover.kind === 'model'
      ? Math.min(winW - 24, 340)
      : popover.kind === 'attach'
        ? 184
        : 168
    : 0;
  const popRootH = rootWin.current.h || Math.max(0, winH - rootWin.current.y);
  const popRelY = popover ? popover.y - rootWin.current.y : 0;
  const popBottom = popover ? Math.max(8, popRootH - popRelY + 6) : 0;
  const popLeft = popover
    ? popover.kind === 'model'
      // Wide panel: dock to the left screen margin instead of the mid-screen
      // anchor chip, so it never floats mid-air or clips past the right edge.
      ? 12
      : Math.max(8, Math.min(popover.x, winW - popW - 8))
    : 0;
  // Height budget = the space between the anchor and the top of the screen
  // content, minus the 6px anchor gap and an 8px top margin. The popover grows
  // upward from the composer, so without this the model list (which gets long
  // as soon as a search auto-expands every matching provider) slides up under
  // the native header and hides the search field being typed into.
  const popSpaceAbove = popover ? Math.max(0, popRelY - 14) : 0;
  const popMaxH =
    popover?.kind === 'model'
      ? Math.min(Math.round(popRootH * 0.55), Math.max(160, popSpaceAbove))
      : undefined;

  return (
    <div
      ref={rootRef}
      onLoad={() => {
        const el = rootRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        rootWin.current = { y: r.y, h: r.height };
        // Keyboard resize moves the composer; keep the popover glued to it.
        remeasurePopover();
      }}
      style={screen}
>
      {searchVisible ? (
        <ChatSearchHeader

          dark={dark}
          iconColor={headerIcon}
          query={searchQuery}
          matchIndex={matchIdx}
          matchCount={searchHits.length}
          onChangeQuery={setSearchQuery}
          onPrevious={() => void jumpToHit(matchIdx - 1, searchHits)}
          onNext={() => void jumpToHit(matchIdx + 1, searchHits)}
          onClose={closeSearch}
        />
      ) : (
        <ChatNormalHeader

          dark={dark}
          iconColor={headerIcon}
          title={sessionTitle && sessionTitle !== '(new session)' ? sessionTitle : ''}
          contextPercent={ctxPct}
          contextTone={ctxTone}
          onOpenSearch={() => {
            setSearchOpen(true);
          }}
          onSelectInfo={() => void openInfo()}
          onOpenInfo={() => void openInfo()}
        />
      )}

      {/* No 'bottom' edge here: Composer already pads with insets.bottom
          itself when the keyboard is closed, and KeyboardAvoidingView lifts
          it when open. Keeping 'bottom' would double the gap above the
          gesture bar (and float the composer above the keyboard). */}
      <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-black">
        

      {/* Long-press popover on our own messages — Copy / Edit, same pattern. */}
      <UserMenuDialog
        open={!!userMenu}
        onOpenChange={(o) => !o && closeUserMenu()}
        anchor={userMenu?.anchor}
        viewportWidth={winW}
      >
        {userMenu &&
          (() => {
              const target = messages.find((m) => m.id === userMenu.id);
              const delta = target ? streamingTexts[target.id] : undefined;
              const fullText = target ? target.text + (delta ?? '') : '';
              const showCopy = !!target && !!fullText && !target.pending;
              const showEdit = !!target && target.role === 'user' && target.rowId != null && !generating;
              if (!target || (!showCopy && !showEdit)) return null;
              const menuW = 192;
              const left = Math.max(8, Math.min(userMenu.anchor.x + userMenu.anchor.w - menuW, winW - menuW - 8));
              const above = userMenu.anchor.y> 128;
              return (
                <div
                  className="absolute w-48 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-[#212121]"
                  style={
                    above
                      ? { bottom: winH - userMenu.anchor.y + 8, left }
                      : { top: userMenu.anchor.y + userMenu.anchor.h + 8, left }
                  }
>
                  {!!target.ts && (
                    <div className="flex items-center gap-2.5 px-3 py-2">
                      <Clock size={17} color={dark ? '#888' : '#999'} />
                      <UIText className="text-[13px] text-neutral-500 dark:text-neutral-400">
                        {formatBubbleTime(target.ts)}
                      </UIText>
                    </div>
                  )}
                  {showCopy && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        closeUserMenu();
                        void copyText(target.id, fullText);
                      }}
                      className="flex items-center gap-2.5 px-3 py-2.5"
>
                      <Copy size={17} color={headerIcon} />
                      <UIText className="text-[15px] text-neutral-950 dark:text-neutral-100">Copy</UIText>
                    </Button>
                  )}
                  {showEdit && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        closeUserMenu();
                        editMessage(target.id);
                      }}
                      className="flex items-center gap-2.5 px-3 py-2.5"
>
                      <Pencil size={17} color={headerIcon} />
                      <UIText className="text-[15px] text-neutral-950 dark:text-neutral-100">Edit</UIText>
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
        {/* A plain scroll container, not a virtualizer — see
            components/chat/transcript.tsx for why this list is the exception.
            `onScroll` is the only scroll signal: a DOM scroller fires it
            continuously, where the native list needed momentum/drag-end events
            as a backstop and had to distinguish them. Stick-to-bottom and the
            prepend correction are unchanged and still driven from here. */}
        <Transcript
          ref={listRef}
          contentClassName={listContentClass}
          contentStyle={listContentStyle}
          onStartReached={handleStartReached}
          onContentSizeChange={handleContentSizeChange}
          onViewportResize={handleViewportResize}
          onInteractStart={handleInteractStart}
          onInteractEnd={snapToEnd}
          onScroll={handleScroll}
        >
          {ListHeader()}
          {messages.map((item) => (
            // `contents` so the bubble itself is the flex item of the content
            // column and its self-* alignment applies. See the note in
            // components/chat/transcript.tsx.
            <div key={listKeyExtractor(item)} className="contents">
              {renderMessage({ item })}
            </div>
          ))}
        </Transcript>
        {/* Overlay footer: absolute + transparent, so the transcript scrolls
            underneath and shows through around the composer card. The list
            keeps the last bubble reachable via bottom content padding
            (= dockH). Same JSX position as before, so the focused input
            never remounts. box-none: taps on the transparent margins fall
            through to the list (which dismisses the keyboard); the card and
            panels stay fully tappable. */}
        <div
          ref={observeDock}
          className="pointer-events-none"
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: kbH + kbGap, backgroundColor: 'transparent' }}
        >
        {/* Composer status strip — context %, tokens, subagents, cost. Tap opens
            the full Session info sheet. */}
        {/* Kept mounted (hidden, not unmounted) while idle: on web a sibling
            that appears/disappears next to a focused input is one more chance
            for the browser to drop the caret out of the composer. */}
        <UIText
          className="px-3.5 pb-1 text-xs text-neutral-500 dark:text-neutral-400"
          numberOfLines={1}
          style={toolLine ? undefined : { display: 'none' }}
>
          {toolLine ?? ''}
        </UIText>
        {/* Agent todo checklist (`todo.updated`) — one collapsed summary line,
            tap to expand the full list. */}
        {todos.length> 0 &&
          (() => {
            const done = todos.filter(todoDone).length;
            const active = todos.find(todoActive);
            return (
              <div className="mx-2.5 mb-1.5 overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-[#212121]">
                <Button
                  variant="ghost"
                  onClick={() => setTodosOpen((v) => !v)}
                  className="flex items-center gap-2 px-3 py-2"
>
                  <UIText className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Tasks
                  </UIText>
                  <UIText className="shrink-0 text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">
                    {done}/{todos.length}
                  </UIText>
                  {!todosOpen && active && (
                    <UIText
                      className="min-w-0 flex-1 text-[12px] text-neutral-500 dark:text-neutral-400"
                      numberOfLines={1}
>
                      · {todoLabel(active)}
                    </UIText>
                  )}
                  {todosOpen && <div className="flex-1" />}
                  {todosOpen ? (
                    <ChevronUp size={15} color={dark ? '#a3a3a3' : '#666'} />
                  ) : (
                    <ChevronDown size={15} color={dark ? '#a3a3a3' : '#666'} />
                  )}
                </Button>
                {todosOpen && (
                  <ScrollArea className="max-h-[200px]">
                    {todos.map((t, i) => {
                      const d = todoDone(t);
                      const a = todoActive(t);
                      return (
                        <div key={`${i}-${todoLabel(t)}`} className="flex items-start gap-2 px-3 py-1">
                          <UIText
                            className={`shrink-0 text-[13px] leading-[18px] ${
                              d
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : a
                                  ? 'text-[#1a73e8] dark:text-[#7aa7ff]'
                                  : 'text-neutral-400 dark:text-neutral-500'
                            }`}
>
                            {d ? '✓' : a ? '◐' : '○'}
                          </UIText>
                          <UIText
                            className={`min-w-0 flex-1 text-[13px] leading-[18px] ${
                              d
                                ? 'text-neutral-400 line-through dark:text-neutral-500'
                                : 'text-neutral-800 dark:text-neutral-200'
                            }`}
>
                            {todoLabel(t)}
                          </UIText>
                        </div>
                      );
                    })}
                  </ScrollArea>
                )}
              </div>
            );
          })()}
        {/* Live subagents (polled from subagent.list while a turn runs). */}
        {subagents.length> 0 &&
          (() => {
            const running = subagents.filter((s) => !subagentDone(s)).length;
            const first = subagents.find((s) => !subagentDone(s)) ?? subagents[0];
            return (
              <div className="mx-2.5 mb-1.5 overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-[#212121]">
                <Button
                  variant="ghost"
                  onClick={() => setSubagentsOpen((v) => !v)}
                  className="flex items-center gap-2 px-3 py-2"
>
                  <UIText className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Subagents
                  </UIText>
                  <UIText className="shrink-0 text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">
                    {running}/{subagents.length}
                  </UIText>
                  {!subagentsOpen && first && (
                    <UIText
                      className="min-w-0 flex-1 text-[12px] text-neutral-500 dark:text-neutral-400"
                      numberOfLines={1}
>
                      · {first.goal || first.last_tool || first.subagent_id}
                    </UIText>
                  )}
                  {subagentsOpen && <div className="flex-1" />}
                  {subagentsOpen ? (
                    <ChevronUp size={15} color={dark ? '#a3a3a3' : '#666'} />
                  ) : (
                    <ChevronDown size={15} color={dark ? '#a3a3a3' : '#666'} />
                  )}
                </Button>
                {subagentsOpen && (
                  <ScrollArea className="max-h-[160px]">
                    {subagents.map((s) => {
                      const done = subagentDone(s);
                      return (
                        <div key={s.subagent_id} className="flex items-center gap-2 px-3 py-1">
                          <UIText
                            className={`shrink-0 text-[13px] leading-[18px] ${
                              done ? 'text-neutral-400 dark:text-neutral-500' : 'text-[#1a73e8] dark:text-[#7aa7ff]'
                            }`}
>
                            {done ? '✓' : '◐'}
                          </UIText>
                          <UIText
                            className={`min-w-0 flex-1 text-[13px] leading-[18px] ${
                              done ? 'text-neutral-400 dark:text-neutral-500' : 'text-neutral-800 dark:text-neutral-200'
                            }`}
                            numberOfLines={1}
>
                            {s.goal || s.last_tool || s.subagent_id}
                          </UIText>
                          {s.tool_count != null && (
                            <UIText className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
                              {s.tool_count} calls
                            </UIText>
                          )}
                        </div>
                      );
                    })}
                  </ScrollArea>
                )}
              </div>
            );
          })()}
        {/* Prompt queue — drafts held while a turn runs, drained one per turn
            end. Sits above the completion panel so completions stay nearest the
            input. */}
        {queued.length> 0 && (
          <div className="mx-2.5 mb-1.5 overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-[#212121]">
            <div className="flex items-center justify-between px-3 pb-0.5 pt-2">
              <UIText className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                {queueParked ? `Queued · paused (${queued.length})` : `Queued (${queued.length})`}
              </UIText>
              {queueParked ? (
                <Button variant="link" onClick={resumeQueue} className="px-1.5 py-0.5">
                  <UIText className="text-[11px] font-semibold">Resume</UIText>
                </Button>
              ) : (
                <Button variant="link" onClick={clearQueue} className="px-1.5 py-0.5">
                  <UIText className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">Clear</UIText>
                </Button>
              )}
            </div>
            <ScrollArea className="max-h-[160px]">
              {queued.map((q) => (
                <div key={q.id} className="flex items-center gap-2 px-3 py-1.5">
                  <UIText
                    className="min-w-0 flex-1 text-[13px] text-neutral-800 dark:text-neutral-200"
                    numberOfLines={1}
>
                    {q.text}
                  </UIText>
                  <Button
                    variant="outline"
                    onClick={() => sendQueuedNow(q.id)}
                    className="shrink-0 px-1.5 py-0.5"
>
                    <UIText className="text-[11px] font-semibold">Send</UIText>
                  </Button>
                  <Button variant="link" onClick={() => removeQueued(q.id)} className="shrink-0 px-1.5 py-0.5">
                    <UIText className="text-[15px] leading-[15px] text-neutral-400">×</UIText>
                  </Button>
                </div>
              ))}
            </ScrollArea>
          </div>
        )}
        {/* Composer completion panel (slash commands / @ references) — floats
            above the composer as a normal flex child (not an absolute overlay),
            so its rows stay tappable on Android and the input keeps focus while
            the user keeps typing. */}
        {visibleCompletions.length> 0 && (
          <div className="mx-2.5 mb-1.5 overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-[#212121]">
            <div className="flex items-center justify-between px-3 pb-0.5 pt-2">
              <UIText className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                {completionKind === 'slash' ? 'Commands' : 'References'}
              </UIText>
              <UIText className="text-[11px] text-neutral-400 dark:text-neutral-500">{visibleCompletions.length}</UIText>
            </div>
            <ScrollArea className="max-h-[248px]">
              {visibleCompletions.slice(0, 40).map((item, i) => {
                const label = item.display || item.text;
                return (
                  <Button
                    variant="ghost"
                    key={`${item.text}-${i}`}
                    data-testid={`completion-option-${i}`}
                    onClick={() => applyCompletion(item)}
                    className="flex items-center gap-2 px-3 py-2"
>
                    <UIText
                      className="shrink-0 text-[14px] font-semibold text-[#1a73e8] dark:text-[#7aa7ff]"
                      numberOfLines={1}
>
                      {label}
                    </UIText>
                    {item.meta ? (
                      <UIText
                        className="min-w-0 flex-1 text-[12px] text-neutral-500 dark:text-neutral-400"
                        numberOfLines={1}
>
                        {item.meta}
                      </UIText>
                    ) : (
                      <div className="flex-1" />
                    )}
                    {item.kind === 'skill' && (
                      <UIText className="shrink-0 rounded bg-neutral-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        skill
                      </UIText>
                    )}
                  </Button>
                );
              })}
            </ScrollArea>
          </div>
        )}
        {editingRowId != null && (
          <div className="mx-2.5 mb-1 flex items-center gap-2 rounded-xl border border-[#1a73e8]/40 bg-[#1a73e8]/5 px-3 py-1.5 dark:border-[#7aa7ff]/40 dark:bg-[#7aa7ff]/10">
            <UIText className="min-w-0 flex-1 text-[12px] text-[#1a73e8] dark:text-[#7aa7ff]">
              Editing — resend to rewind and rerun from here
            </UIText>
            <Button variant="link" onClick={cancelEdit} className="shrink-0 px-1.5 py-0.5">
              <UIText className="text-[12px] font-semibold text-neutral-500 dark:text-neutral-400">Cancel</UIText>
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
          onOpenEffortPicker={openEffortPicker}
          onOpenAttachPicker={openAttachPicker}
          attachments={attachments}
          setAttachments={setAttachments}
          dark={dark}
        />
        </div>
      </div>
      {/* Jump to the newest message — shown only when the transcript
          overflows and the user has scrolled up. */}
      {canScroll && !atBottom && (
        <Button
          variant="ghost"
          size="icon"
          data-testid="scroll-to-bottom"
          onClick={() => {
            stickEnd.current = true;
            // Far away: jump instantly (smooth-scrolling ~10k px is the sludge);
            // nearby: keep the short smooth glide.
            const dist = contentH.current - (scrollY.current + layoutH.current);
            scrollEnd(dist < 3000);
          }}
          className="absolute right-3 z-40 h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-[#2a2a2a]"
          // Floats just above the footer, whose measured height already
          // includes the keyboard lift.
          style={{ bottom: dockH + 12, boxShadow: '0 2px 6px rgb(0 0 0 / 0.18)' }}
>
          <ChevronDown size={18} color={dark ? '#e5e5e5' : '#333'} />
        </Button>
      )}
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
      <InfoSheet
        open={infoOpen}
        onOpenChange={(o) => !o && setInfoOpen(false)}
        title={sessionTitle}
        model={model}
        provider={modelProvider}
        info={sessionInfo}
        usage={usageInfo}
        usageLoading={usageLoading}
        tokenEstimate={tokenEstimate}
        onRename={(t) => void renameSession(t)}
      />

      {/* Screen-level anchored popovers: "+" attach, model picker, thinking
          effort. Rendered here (not in the composer) so they float above the
          list and still receive taps — Android drops touches outside a
          parent's bounds. */}
      {popover && (
        <>
          <button type="button"
            data-testid="popover-backdrop"
            style={{ position: 'absolute', inset: 0, zIndex: 60 }}
            onClick={closePopover}
          />
          <div
            data-testid="anchor-popover"
            className="absolute z-[70] rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-700 dark:bg-[#212121]"
            style={{
              width: popW,
              left: popLeft,
              bottom: popBottom,
              maxHeight: popMaxH,
            }}
>
            {popover.kind === 'effort' && showEffort && (
              <>
                <UIText className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Thinking effort
                </UIText>
                {effortOptions.map((e) => {
                  const on = e === effort.trim().toLowerCase();
                  return (
                    <Button
                      variant="ghost"
                      key={e}
                      data-testid={`effort-option-${e}`}
                      onClick={() => {
                        void applyEffort(e);
                        closePopover();
                      }}
                      className={`flex items-center gap-2 px-2.5 py-2 ${
                        on ? 'bg-[#1a73e8]/10 dark:bg-[#1a73e8]/20' : ''
                      }`}
>
                      <UIText
                        className={`min-w-0 flex-1 text-[14px] ${
                          on
                            ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                            : 'text-neutral-900 dark:text-neutral-100'
                        }`}
>
                        {reasoningLabel(e)}
                      </UIText>
                      {on && <Check size={15} color="#1a73e8" />}
                    </Button>
                  );
                })}
                {/* Fast mode — separate from reasoning (`config.set fast`). */}
                <div className="my-1 h-[1px] bg-neutral-100 dark:bg-neutral-800" />
                <Button
                  variant="ghost"
                  data-testid="fast-toggle"
                  onClick={() => {
                    void applyFast(!(sessionInfo?.fast === true));
                    closePopover();
                  }}
                  className="flex items-center gap-2 px-2.5 py-2"
>
                  <UIText
                    className={`min-w-0 flex-1 text-[14px] ${
                      sessionInfo?.fast === true
                        ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                        : 'text-neutral-900 dark:text-neutral-100'
                    }`}
>
                    Fast mode
                  </UIText>
                  {sessionInfo?.fast === true && <Check size={15} color="#1a73e8" />}
                </Button>
                {/* Reasoning display — the switch behind live tool + reasoning
                    streaming (`config.set reasoning show|hide`). `hide` persists
                    tool calls to history without live events; `show` streams
                    everything. Shared display setting (desktop included).
                    Never disabled: with an unknown value a tap turns live
                    streaming ON (the useful direction — this is the switch that
                    fixes "bubbles only appear after the turn ends"). */}
                <Button
                  variant="ghost"
                  data-testid="show-reasoning-toggle"
                  onClick={() => void applyShowReasoning(showReasoning !== true)}
                  className="flex items-center gap-2 px-2.5 py-2"
>
                  <UIText
                    className={`min-w-0 flex-1 text-[14px] ${
                      showReasoning === true
                        ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                        : 'text-neutral-900 dark:text-neutral-100'
                    }`}
>
                    Show reasoning
                  </UIText>
                  {showReasoning === true && <Check size={15} color="#1a73e8" />}
                </Button>
                <UIText className="px-2.5 pb-1 text-[11px] leading-[15px] text-neutral-500 dark:text-neutral-400">
                  {showReasoning === null
                    ? 'Streams tool calls + reasoning live. Unknown on this gateway — tap to turn on.'
                    : 'Streams tool calls + reasoning live (shared display setting).'}
                </UIText>
              </>
            )}

            {popover.kind === 'attach' && (
              <>
                <UIText className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Attach
                </UIText>
                <Button
                  variant="ghost"
                  data-testid="attach-photo"
                  onClick={() => void pickImage()}
                  className="flex items-center gap-2.5 px-2.5 py-2"
>
                  <ImageIcon size={17} color={dark ? '#ccc' : '#444'} />
                  <UIText className="text-[14px] text-neutral-900 dark:text-neutral-100">Photo</UIText>
                </Button>
                <Button
                  variant="ghost"
                  data-testid="attach-file"
                  onClick={() => void pickFile()}
                  className="flex items-center gap-2.5 px-2.5 py-2"
>
                  <FileText size={17} color={dark ? '#ccc' : '#444'} />
                  <UIText className="text-[14px] text-neutral-900 dark:text-neutral-100">File</UIText>
                </Button>
              </>
            )}

            {popover.kind === 'model' && (
              <>
                <UIText className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Switch model (this chat)
                </UIText>
                <div className="px-1.5 pb-1.5">
                  <Input
                    className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-[14px] text-neutral-950 dark:border-neutral-700 dark:text-neutral-100"
                    value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                    placeholder="Search models…"
                    autoCapitalize="none"
                  />
                </div>
                {providersLoading && (
                  <UIText className="px-3 py-1 text-[13px] text-neutral-500 dark:text-neutral-400">loading models…</UIText>
                )}
                {!!providersError && (
                  <UIText
                    role="alert"
                    className="px-3 py-1 text-[13px] text-[#c5221f] dark:text-[#ff7b72]"
>
                    {providersError}
                  </UIText>
                )}
                <ScrollArea className="min-h-0 flex-1">
                  {modelVisibleProviders.map((p) => {
                    const count = p.models?.length ?? p.totalModels;
                    const open = mq ? true : (modelExpanded[p.slug] ?? false);
                    return (
                      <div key={p.slug || p.name}>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setModelExpanded((e) => ({ ...e, [p.slug]: !(e[p.slug] ?? false) }))
                          }
                          className="flex items-center gap-2 px-2.5 py-2"
>
                          <UIText
                            className="min-w-0 flex-1 text-[14px] font-bold text-neutral-950 dark:text-neutral-100"
                            numberOfLines={1}
>
                            {p.name}
                          </UIText>
                          <UIText className="text-[12px] text-neutral-500 dark:text-neutral-400">
                            {count} model{count === 1 ? '' : 's'}
                          </UIText>
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
                                className={`flex items-center gap-2 rounded-lg py-1.5 pl-3 pr-1.5 ${
                                  on ? 'bg-[#1a73e8]/10 dark:bg-[#1a73e8]/20' : ''
                                }`}
>                                <Button
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
                                  className="h-auto min-w-0 flex-1 justify-start"
>
                                  <UIText
                                    numberOfLines={1}
                                    className={`min-w-0 flex-1 text-left text-[14px] ${
                                      on
                                        ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                                        : 'text-neutral-950 dark:text-neutral-100'
                                    }`}
>
                                    {on ? '● ' : '○ '}
                                    {mm}
                                  </UIText>
                                </Button>
                                <Button
                                  variant="outline"
                                  aria-label={`Set ${mm} as the global default`}
                                  onClick={() => {
                                    void setGlobalModel(p.slug, mm);
                                    closePopover();
                                  }}
                                  className="h-auto shrink-0 px-2 py-1"
>
                                  <UIText className="text-[13px]">Global</UIText>
                                </Button>
                              </div>
                            );
                          })}
                        {open && !p.models && (
                          <UIText className="px-3 py-1.5 text-[13px] text-neutral-500 dark:text-neutral-400">
                            list unavailable — pull to refresh on server
                          </UIText>
                        )}
                      </div>
                    );
                  })}
                  {modelVisibleProviders.length === 0 && !providersLoading && (
                    <UIText className="px-3 py-2 text-[13px] text-neutral-500 dark:text-neutral-400">no matches</UIText>
                  )}
                </ScrollArea>
              </>
            )}
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

              className="absolute z-50 rounded-lg bg-black/85 px-2.5 py-1.5 dark:bg-white/90"
              style={{ bottom: Math.max(8, rootH - relY + 8), left }}
>
              <UIText className="text-[12px] text-white dark:text-black">{tip.label}</UIText>
            </div>
          );
        })()}
    </div>
  );
}
