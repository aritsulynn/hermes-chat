// Chat route — transcript + composer (was the 'chat' screen in App.tsx).
// Header back opens the drawer; the native Drawer replaces NavDrawer/EdgeSwipe.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Redirect, useNavigation } from 'expo-router';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { ChevronDown, ChevronUp, Check, ChevronRight, FileText, Image as ImageIcon, Info, MoreVertical, Search, X } from 'lucide-react-native';
import { useApp } from '../../hooks/app-store';
import {
  FALLBACK_PROVIDERS,
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
import { compactNumber } from '../../utils/format';
import { fuzzyScoreMulti } from '../../utils/fuzzy';
import { contextTone, readUsage } from '../../utils/usage';
import { isSlashSuggestion } from '../../utils/slash-commands';
import type { UiMessage } from '../../utils/messages';
import type { SlashCompletionItem } from '../../lib/gateway-ws';
import { AskSheet, Composer, HamburgerBtn, InfoSheet, MessageBubble } from '../../components';
import type { AnchorMeasure } from '../../components';

// Offline fallback for the "/" wheel when the gateway predates `complete.slash`.
// The live catalog (built-ins + quick_commands + skills) supersedes this whenever
// the RPC answers. Every row here is `null` in the desktop registry (offered) —
// terminal/messaging-only commands are filtered out by isSlashSuggestion().
const FALLBACK_SLASH: SlashCompletionItem[] = [
  { text: '/new', display: '/new', meta: 'Start a new chat' },
  { text: '/help', display: '/help', meta: 'Show available commands' },
  { text: '/status', display: '/status', meta: 'Session info and recap' },
  { text: '/usage', display: '/usage', meta: 'Token usage and cost' },
  { text: '/context', display: '/context', meta: 'Context-window breakdown' },
  { text: '/compress', display: '/compress', meta: 'Compress conversation context' },
  { text: '/reasoning', display: '/reasoning', meta: 'Reasoning effort or display' },
  { text: '/title', display: '/title', meta: 'Rename this session' },
  { text: '/stop', display: '/stop', meta: 'Stop the active turn' },
  { text: '/diff', display: '/diff', meta: 'Show git changes' },
  { text: '/plan', display: '/plan', meta: 'Write an implementation plan' },
  { text: '/review', display: '/review', meta: 'Run a reviewer subagent' },
  { text: '/goal', display: '/goal', meta: 'Set a standing goal' },
];

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
    todos,
    subagents,
    refreshToolResults,
    pickModel,
    copyText,
    answerValue,
    answerApproval,
    dismissAsk,
    getGw,
    theme,
  } = useApp();
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
  const usage = readUsage(sessionInfo?.usage) ?? readUsage(usageInfo);
  const ctxPct =
    usage?.contextPercent != null ? Math.max(0, Math.min(100, Math.round(usage.contextPercent))) : null;
  const ctxTone = ctxPct == null ? 'ok' : contextTone(ctxPct);

  // Numeric bubble cap: percent maxWidth resolves too late for Yoga to wrap
  // row-nested markdown (lists) — a pixel value constrains measurement itself.
  const { width: winW, height: winH } = useWindowDimensions();
  const bubbleMax = Math.round(winW * 0.85);

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
  const rootRef = useRef<View>(null);
  const rootWin = useRef({ y: 0, h: 0 });

  const openPopover = useCallback(
    (kind: 'effort' | 'attach' | 'model', measure: AnchorMeasure) => {
      popoverMeasure.current = measure;
      if (kind === 'model') {
        setModelQuery('');
        void loadProviders();
      }
      measure((a) => setPopover({ kind, ...a }));
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
  }, [sessionId, loadCommandsCatalog]);
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
  // come curated by the backend.
  const visibleCompletions =
    completionKind === 'slash' ? completions.filter((it) => isSlashSuggestion(it.text)) : completions;

  const applyCompletion = useCallback(
    (item: SlashCompletionItem) => {
      const text = item.text || '';
      if (!text) return;
      if (completionKind === 'slash') {
        setInput(`${input.slice(0, completionFrom)}${text.replace(/\s+$/, '')} `);
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

  const listRef = useRef<FlatList<UiMessage>>(null);
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Agent todo checklist above the composer — collapsed to a one-line summary.
  const [todosOpen, setTodosOpen] = useState(false);
  // True while the list is scrolled up — shows the jump-to-bottom button.
  const [atBottom, setAtBottom] = useState(true);
  // Height of the floating bottom dock (panels + composer) — the list reserves
  // this much padding so the last message can scroll above it.
  const [dockH, setDockH] = useState(0);
  // Live child-agent roster (subagent.list) — same collapsed-summary treatment.
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  const tokenEstimate = messages.reduce((n, m) => n + Math.ceil(m.text.length / 4), 0);
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
  // Kebab menu + in-conversation search.
  const [kebabOpen, setKebabOpen] = useState(false);
  // The dropdown is anchored to the kebab ICON, measured on open — a fixed
  // `right-*` class drifts the moment the header button's padding changes.
  const kebabRef = useRef<View>(null);
  const [kebabAnchor, setKebabAnchor] = useState({ right: 12, top: 8 });
  useEffect(() => {
    if (!kebabOpen) return;
    kebabRef.current?.measureInWindow((x, y, w, h) => {
      if (w <= 0) return;
      const contentTop = rootWin.current.y;
      setKebabAnchor({
        right: Math.max(8, Math.round(winW - (x + w))),
        // The icon sits in the header, above the screen content — so its
        // bottom edge lands at (or above) the content top. Clamp to the
        // content so the card always hangs just below the header.
        top: contentTop > 0 ? Math.max(4, Math.round(y + h + 4 - contentTop)) : 8,
      });
    });
  }, [kebabOpen, winW]);
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
  const onEdit = useCallback((id: string) => editMessage(id), [editMessage]);
  const onRegenerate = useCallback(() => regenerate(), [regenerate]);

  const scrollEnd = useCallback((animated?: unknown) => {
    const anim = animated === false ? false : true;
    // Double-tick: one frame for layout shrink (keyboard resize), one for content.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: anim }));
    });
  }, []);

  // When the keyboard slides up the list height shrinks but content offset
  // stays — explicitly scroll so the latest message sits above the keyboard,
  // like every normal chat app. Delay covers the keyboard animation (~250ms).
  // Also re-anchor any open popover, since the composer moves up with the
  // keyboard (matters for the model search field).
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => {
        scrollEnd(true);
        remeasurePopover();
      }, 50);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setTimeout(() => {
        scrollEnd(true);
        remeasurePopover();
      }, 50);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scrollEnd, remeasurePopover]);

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
  const pickImage = useCallback(async () => {
    setPopover(null);
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (!r.canceled && r.assets?.length) {
        const picked = r.assets.map((a, i) => ({
          uri: a.uri,
          name: a.fileName ?? `image-${Date.now()}-${i}.jpg`,
          mime: a.mimeType,
        }));
        setAttachments([...attachments, ...picked]);
      }
    } catch {}
  }, [attachments, setAttachments]);

  const pickFile = useCallback(async () => {
    setPopover(null);
    try {
      const r = await DocumentPicker.getDocumentAsync({ multiple: true });
      if (!r.canceled && r.assets?.length) {
        const picked = r.assets.map((a) => ({
          uri: a.uri,
          name: a.name ?? 'file',
          mime: a.mimeType,
        }));
        setAttachments([...attachments, ...picked]);
      }
    } catch {}
  }, [attachments, setAttachments]);

  // Bottom sheets are programmatic: present/dismiss as store state changes.
  // NEVER dismiss a modal that was never presented: gorhom's dismiss() on a
  // fresh modal flips its internal status to DISMISSING, after which the
  // portal refuses to render anything — silently, forever. Track presented.
  const infoRef = useRef<BottomSheetModal>(null);
  const infoPresented = useRef(false);
  useEffect(() => {
    if (infoSeq > 0) {
      infoRef.current?.present();
      infoPresented.current = true;
    }
  }, [infoSeq]);
  useEffect(() => {
    if (!infoOpen && infoPresented.current) {
      // Programmatic close only — a user-swiped sheet already closed itself
      // (onDismiss reset the flag); dismissing it again repoisons the modal.
      infoPresented.current = false;
      infoRef.current?.dismiss();
    }
  }, [infoOpen]);
  const askRef = useRef<BottomSheetModal>(null);
  const askPresented = useRef(false);
  useEffect(() => {
    if (ask) {
      askRef.current?.present();
      askPresented.current = true;
    } else if (askPresented.current) {
      askPresented.current = false;
      askRef.current?.dismiss();
    }
  }, [ask]);

  // In-conversation search — match message indices, jump between them.
  const sq = searchQuery.trim().toLowerCase();
  const matchIndices = useMemo(
    () =>
      searchOpen && sq
        ? messages.map((m, i) => (m.text.toLowerCase().includes(sq) ? i : -1)).filter((i) => i >= 0)
        : [],
    [searchOpen, sq, messages],
  );
  const jumpToMatch = useCallback(
    (n: number) => {
      if (matchIndices.length === 0) return;
      const k = ((n % matchIndices.length) + matchIndices.length) % matchIndices.length;
      setMatchIdx(k);
      stickEnd.current = false;
      try {
        listRef.current?.scrollToIndex({ index: matchIndices[k], viewPosition: 0.5, animated: true });
      } catch {}
    },
    [matchIndices],
  );
  useEffect(() => {
    setMatchIdx(0);
    if (matchIndices.length > 0) {
      const t = setTimeout(() => {
        try {
          listRef.current?.scrollToIndex({ index: matchIndices[0], viewPosition: 0.5, animated: true });
        } catch {}
      }, 100);
      return () => clearTimeout(t);
    }
  }, [sq]); // eslint-disable-line react-hooks/exhaustive-deps

  // Native Drawer header: live session title, hamburger, kebab menu.
  // Android content height compacted 64→52 like sessions (iOS stays 44).
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    navigation.setOptions({
      title: sessionId ? (sessionTitle && sessionTitle !== '(new session)' ? sessionTitle : '') : '',
      headerStyle: {
        backgroundColor: dark ? '#000' : '#fff',
        ...(Platform.OS === 'android' ? { height: insets.top + 52 } : null),
      },
      headerTintColor: headerIcon,
      headerTitleStyle: { color: headerIcon },
      // Header buttons get a little breathing room from the screen edges.
      headerLeft: () => (
        <View className="pl-2">
          <HamburgerBtn />
        </View>
      ),
      headerRight: sessionId
        ? () => (
            <Pressable
              testID="kebab-btn"
              accessibilityRole="button"
              accessibilityLabel="Chat menu"
              onPress={() => setKebabOpen((v) => !v)}
              className="justify-center px-4 py-2"
              hitSlop={12}
            >
              <View ref={kebabRef}>
                <MoreVertical size={20} color={headerIcon} />
              </View>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, insets.top, sessionId, sessionTitle, dark, headerIcon]);

  if (booting) {
    return (
      <View style={{ flex: 1, backgroundColor: dark ? '#000' : '#fff' }}>
        <SafeAreaView className="flex-1 bg-white items-center justify-center gap-3 dark:bg-black" edges={['top', 'left', 'right', 'bottom']}>
          <StatusBar style="auto" />
          <ActivityIndicator size="large" />
          <Text className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">connecting…</Text>
        </SafeAreaView>
      </View>
    );
  }
  if (!authed) return <Redirect href="/login" />;

  if (!sessionId) {
    return (
      <View style={{ flex: 1, backgroundColor: dark ? '#000' : '#fff' }}>
        <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['left', 'right', 'bottom']}>
          <StatusBar style="auto" />
          <View className="flex-1 items-center justify-center p-6">
            <Text className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">No active session — start a new one.</Text>
            <Pressable onPress={() => void newSession()} className="mt-2 items-center rounded-lg bg-[#1a73e8] px-[18px] py-[11px]">
              <Text className="text-[15px] font-semibold text-white">+ New chat</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // Popover geometry: anchor above the tapped control (window → root coords).
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
  const popLeft = popover ? Math.max(8, Math.min(popover.x, winW - popW - 8)) : 0;
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

  // Model picker list (search + provider accordions), moved out of the old
  // composer bottom sheet so it can render in the screen-level popover.
  const modelProviders = providers ?? FALLBACK_PROVIDERS;
  const mq = modelQuery.trim().toLowerCase();
  const modelVisibleProviders = modelProviders
    .map((p) => {
      const list = p.models ?? [];
      if (!mq) return { ...p, models: list };
      // Provider-name hit keeps its whole list; otherwise rank models fuzzily
      // (`son4` → claude-sonnet-4) instead of a plain substring filter.
      const providerHit =
        fuzzyScoreMulti(p.name, mq) !== null || fuzzyScoreMulti(p.slug || '', mq) !== null;
      if (providerHit) return { ...p, models: list };
      const models = list
        .map((mm) => ({ mm, s: fuzzyScoreMulti(mm, mq)?.score }))
        .filter((x): x is { mm: string; s: number } => x.s !== undefined)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.mm);
      return { ...p, models };
    })
    .filter((p) => (mq ? (p.models?.length ?? 0) > 0 : true));

  return (
    <View
      ref={rootRef}
      onLayout={() =>
        rootRef.current?.measureInWindow((_x, y, _w, h) => {
          rootWin.current = { y, h };
          // Keyboard resize moves the composer; keep the popover glued to it.
          remeasurePopover();
        })
      }
      style={{ flex: 1, backgroundColor: dark ? '#000' : '#fff' }}
    >
      {/* No 'bottom' edge here: Composer already pads with insets.bottom
          itself when the keyboard is closed, and KeyboardAvoidingView lifts
          it when open. Keeping 'bottom' would double the gap above the
          gesture bar (and float the composer above the keyboard). */}
      <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['left', 'right']}>
        <StatusBar style="auto" />

      {/* Kebab dropdown — absolute overlay, no Modal, no new Android window */}
      {kebabOpen && (
        <>
          <Pressable
            style={{ position: 'absolute', inset: 0, zIndex: 40 }}
            onPress={() => setKebabOpen(false)}
          />
          <View
            className="absolute w-52 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-[#212121]"
            // Content area already starts below the native header, so anchor
            // just under it. (top: insets.top + 52 double-counts the header
            // and drops the menu mid-screen.) `right` comes from the measured
            // kebab icon so the card's edge lines up with the button.
            style={{ top: kebabAnchor.top, right: kebabAnchor.right, zIndex: 50, elevation: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8 }}
          >
            <Pressable
              testID="menu-search"
              onPress={() => {
                setKebabOpen(false);
                setSearchOpen(true);
              }}
              className="flex-row items-center gap-2.5 rounded-lg px-3 py-2.5 active:bg-neutral-100 dark:active:bg-neutral-800"
            >
              <Search size={17} color={headerIcon} />
              <Text className="text-[15px] text-neutral-950 dark:text-neutral-100">Search</Text>
            </Pressable>
            <Pressable
              testID="menu-info"
              onPress={() => {
                setKebabOpen(false);
                void openInfo();
              }}
              className="flex-row items-center gap-2.5 rounded-lg px-3 py-2.5 active:bg-neutral-100 dark:active:bg-neutral-800"
            >
              <Info size={17} color={headerIcon} />
              <Text className="text-[15px] text-neutral-950 dark:text-neutral-100">Session info</Text>
            </Pressable>
            <Pressable
              testID="menu-branch"
              onPress={() => {
                setKebabOpen(false);
                void branchSession();
              }}
              className="flex-row items-center gap-2.5 rounded-lg px-3 py-2.5 active:bg-neutral-100 dark:active:bg-neutral-800"
            >
              <FileText size={17} color={headerIcon} />
              <Text className="text-[15px] text-neutral-950 dark:text-neutral-100">Branch chat</Text>
            </Pressable>
          </View>
        </>
      )}

      <KeyboardAvoidingView
        className="flex-1"
        behavior="padding"
        keyboardVerticalOffset={insets.top + (Platform.OS === 'android' ? 52 : 44)}
      >
        {searchOpen && (
          <View className="flex-row items-center gap-1.5 border-b border-neutral-100 px-2.5 py-1.5 dark:border-neutral-800">
            <Search size={16} color={dark ? '#a3a3a3' : '#666'} />
            <TextInput
              className="flex-1 rounded-lg bg-[#f4f4f6] px-2.5 py-1.5 text-[14px] text-neutral-950 dark:bg-[#212121] dark:text-neutral-100"
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search in conversation…"
              placeholderTextColor={dark ? '#888' : '#9ca3af'}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              keyboardAppearance={dark ? 'dark' : 'light'}
              returnKeyType="search"
              onSubmitEditing={() => jumpToMatch(matchIdx)}
            />
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">
              {sq ? `${matchIndices.length ? matchIdx + 1 : 0}/${matchIndices.length}` : ''}
            </Text>
            <Pressable onPress={() => jumpToMatch(matchIdx - 1)} className="p-1" hitSlop={8} disabled={!matchIndices.length}>
              <ChevronUp size={18} color={matchIndices.length ? headerIcon : '#ccc'} />
            </Pressable>
            <Pressable onPress={() => jumpToMatch(matchIdx + 1)} className="p-1" hitSlop={8} disabled={!matchIndices.length}>
              <ChevronDown size={18} color={matchIndices.length ? headerIcon : '#ccc'} />
            </Pressable>
            <Pressable
              onPress={() => {
                setSearchOpen(false);
                setSearchQuery('');
              }}
              className="p-1"
              hitSlop={8}
            >
              <X size={18} color={headerIcon} />
            </Pressable>
          </View>
        )}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          className="flex-1"
          contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 12 + dockH }}
          onContentSizeChange={() => {
            if (stickEnd.current) scrollEnd();
          }}
          onLayout={() => {
            stickEnd.current = true;
            scrollEnd(false);
          }}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const atEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 120;
            stickEnd.current = atEnd;
            setAtBottom((p) => (p === atEnd ? p : atEnd));
          }}
          scrollEventThrottle={16}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => (
            <MessageBubble
              item={item}
              bubbleMax={bubbleMax}
              dark={dark}
              expanded={!!expanded[item.id]}
              highlight={searchOpen && !!sq && item.text.toLowerCase().includes(sq)}
              longFired={longFired}
              onToggleExpand={onToggleExpand}
              copied={copiedId === item.id}
              onCopy={onCopy}
              canEdit={item.role === 'user' && item.rowId != null && !generating}
              canRegenerate={
                !!lastAssistantId && item.id === lastAssistantId && hasRegenTarget && !generating
              }
              onEdit={onEdit}
              onRegenerate={onRegenerate}
            />
          )}
        />
        {/* Floating bottom dock — transparent, so the transcript shows behind the
            composer instead of a solid background band. */}
        <View
          className="absolute bottom-0 left-0 right-0"
          onLayout={(e) => setDockH(e.nativeEvent.layout.height)}
        >
        {/* Composer status strip — context %, tokens, subagents, cost. Tap opens
            the full Session info sheet. */}
        {usage && (
          <Pressable
            onPress={() => void openInfo()}
            className="flex-row items-center gap-2 px-3.5 pb-0.5"
            hitSlop={6}
          >
            {ctxPct != null && (
              <>
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                  ctx
                </Text>
                <View className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                  <View
                    className={`h-full rounded-full ${
                      ctxTone === 'hot' ? 'bg-[#c5221f]' : ctxTone === 'warn' ? 'bg-[#d97706]' : 'bg-[#1a7f37]'
                    }`}
                    style={{ width: `${ctxPct}%` }}
                  />
                </View>
                <Text
                  className={`text-[11px] font-semibold ${
                    ctxTone === 'hot'
                      ? 'text-[#c5221f] dark:text-[#ff8a8a]'
                      : ctxTone === 'warn'
                        ? 'text-[#d97706] dark:text-[#f0b429]'
                        : 'text-neutral-500 dark:text-neutral-400'
                  }`}
                >
                  {usage.contextEstimated ? '~' : ''}
                  {ctxPct}%
                </Text>
              </>
            )}
            {usage.contextUsed != null && usage.contextMax != null && (
              <Text className="text-[11px] text-neutral-400 dark:text-neutral-500">
                {compactNumber(usage.contextUsed)}/{compactNumber(usage.contextMax)}
              </Text>
            )}
            {usage.subagents != null && usage.subagents > 0 && (
              <Text className="text-[11px] text-neutral-400 dark:text-neutral-500">· {usage.subagents} sub</Text>
            )}
            {usage.costUsd != null && usage.costUsd > 0 ? (
              <Text className="text-[11px] text-neutral-400 dark:text-neutral-500">· ${usage.costUsd.toFixed(2)}</Text>
            ) : usage.total != null && usage.total > 0 ? (
              <Text className="text-[11px] text-neutral-400 dark:text-neutral-500">
                · {compactNumber(usage.total)} tok
              </Text>
            ) : null}
          </Pressable>
        )}
        {/* Kept mounted (hidden, not unmounted) while idle: on web a sibling
            that appears/disappears next to a focused input is one more chance
            for the browser to drop the caret out of the composer. */}
        <Text
          className="px-3.5 pb-1 text-xs text-neutral-500 dark:text-neutral-400"
          numberOfLines={1}
          style={toolLine ? undefined : { display: 'none' }}
        >
          {toolLine ?? ''}
        </Text>
        {/* Agent todo checklist (`todo.updated`) — one collapsed summary line,
            tap to expand the full list. */}
        {todos.length > 0 &&
          (() => {
            const done = todos.filter(todoDone).length;
            const active = todos.find(todoActive);
            return (
              <View className="mx-2.5 mb-1.5 overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-[#212121]">
                <Pressable
                  onPress={() => setTodosOpen((v) => !v)}
                  className="flex-row items-center gap-2 px-3 py-2"
                >
                  <Text className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Tasks
                  </Text>
                  <Text className="shrink-0 text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">
                    {done}/{todos.length}
                  </Text>
                  {!todosOpen && active && (
                    <Text
                      className="min-w-0 flex-1 text-[12px] text-neutral-500 dark:text-neutral-400"
                      numberOfLines={1}
                    >
                      · {todoLabel(active)}
                    </Text>
                  )}
                  {todosOpen && <View className="flex-1" />}
                  {todosOpen ? (
                    <ChevronUp size={15} color={dark ? '#a3a3a3' : '#666'} />
                  ) : (
                    <ChevronDown size={15} color={dark ? '#a3a3a3' : '#666'} />
                  )}
                </Pressable>
                {todosOpen && (
                  <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                    {todos.map((t, i) => {
                      const d = todoDone(t);
                      const a = todoActive(t);
                      return (
                        <View key={`${i}-${todoLabel(t)}`} className="flex-row items-start gap-2 px-3 py-1">
                          <Text
                            className={`shrink-0 text-[13px] leading-[18px] ${
                              d
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : a
                                  ? 'text-[#1a73e8] dark:text-[#7aa7ff]'
                                  : 'text-neutral-400 dark:text-neutral-500'
                            }`}
                          >
                            {d ? '✓' : a ? '◐' : '○'}
                          </Text>
                          <Text
                            className={`min-w-0 flex-1 text-[13px] leading-[18px] ${
                              d
                                ? 'text-neutral-400 line-through dark:text-neutral-500'
                                : 'text-neutral-800 dark:text-neutral-200'
                            }`}
                          >
                            {todoLabel(t)}
                          </Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            );
          })()}
        {/* Live subagents (polled from subagent.list while a turn runs). */}
        {subagents.length > 0 &&
          (() => {
            const running = subagents.filter((s) => !subagentDone(s)).length;
            const first = subagents.find((s) => !subagentDone(s)) ?? subagents[0];
            return (
              <View className="mx-2.5 mb-1.5 overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-[#212121]">
                <Pressable
                  onPress={() => setSubagentsOpen((v) => !v)}
                  className="flex-row items-center gap-2 px-3 py-2"
                >
                  <Text className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Subagents
                  </Text>
                  <Text className="shrink-0 text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">
                    {running}/{subagents.length}
                  </Text>
                  {!subagentsOpen && first && (
                    <Text
                      className="min-w-0 flex-1 text-[12px] text-neutral-500 dark:text-neutral-400"
                      numberOfLines={1}
                    >
                      · {first.goal || first.last_tool || first.subagent_id}
                    </Text>
                  )}
                  {subagentsOpen && <View className="flex-1" />}
                  {subagentsOpen ? (
                    <ChevronUp size={15} color={dark ? '#a3a3a3' : '#666'} />
                  ) : (
                    <ChevronDown size={15} color={dark ? '#a3a3a3' : '#666'} />
                  )}
                </Pressable>
                {subagentsOpen && (
                  <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
                    {subagents.map((s) => {
                      const done = subagentDone(s);
                      return (
                        <View key={s.subagent_id} className="flex-row items-center gap-2 px-3 py-1">
                          <Text
                            className={`shrink-0 text-[13px] leading-[18px] ${
                              done ? 'text-neutral-400 dark:text-neutral-500' : 'text-[#1a73e8] dark:text-[#7aa7ff]'
                            }`}
                          >
                            {done ? '✓' : '◐'}
                          </Text>
                          <Text
                            className={`min-w-0 flex-1 text-[13px] leading-[18px] ${
                              done ? 'text-neutral-400 dark:text-neutral-500' : 'text-neutral-800 dark:text-neutral-200'
                            }`}
                            numberOfLines={1}
                          >
                            {s.goal || s.last_tool || s.subagent_id}
                          </Text>
                          {s.tool_count != null && (
                            <Text className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
                              {s.tool_count} calls
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            );
          })()}
        {/* Prompt queue — drafts held while a turn runs, drained one per turn
            end. Sits above the completion panel so completions stay nearest the
            input. */}
        {queued.length > 0 && (
          <View className="mx-2.5 mb-1.5 overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-[#212121]">
            <View className="flex-row items-center justify-between px-3 pb-0.5 pt-2">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                {queueParked ? `Queued · paused (${queued.length})` : `Queued (${queued.length})`}
              </Text>
              {queueParked ? (
                <Pressable onPress={resumeQueue} hitSlop={8} className="rounded px-1.5 py-0.5">
                  <Text className="text-[11px] font-semibold text-[#1a73e8] dark:text-[#7aa7ff]">Resume</Text>
                </Pressable>
              ) : (
                <Pressable onPress={clearQueue} hitSlop={8} className="rounded px-1.5 py-0.5">
                  <Text className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">Clear</Text>
                </Pressable>
              )}
            </View>
            <ScrollView style={{ maxHeight: 160 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {queued.map((q) => (
                <View key={q.id} className="flex-row items-center gap-2 px-3 py-1.5">
                  <Text
                    className="min-w-0 flex-1 text-[13px] text-neutral-800 dark:text-neutral-200"
                    numberOfLines={1}
                  >
                    {q.text}
                  </Text>
                  <Pressable
                    onPress={() => sendQueuedNow(q.id)}
                    hitSlop={8}
                    className="shrink-0 rounded border border-neutral-300 px-1.5 py-0.5 dark:border-neutral-700"
                  >
                    <Text className="text-[11px] font-semibold dark:text-neutral-100">Send</Text>
                  </Pressable>
                  <Pressable onPress={() => removeQueued(q.id)} hitSlop={10} className="shrink-0 px-0.5">
                    <Text className="text-[15px] leading-[15px] text-neutral-400">×</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
        {/* Composer completion panel (slash commands / @ references) — floats
            above the composer as a normal flex child (not an absolute overlay),
            so its rows stay tappable on Android and the input keeps focus while
            the user keeps typing. */}
        {visibleCompletions.length > 0 && (
          <View className="mx-2.5 mb-1.5 overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-[#212121]">
            <View className="flex-row items-center justify-between px-3 pb-0.5 pt-2">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                {completionKind === 'slash' ? 'Commands' : 'References'}
              </Text>
              <Text className="text-[11px] text-neutral-400 dark:text-neutral-500">{visibleCompletions.length}</Text>
            </View>
            <ScrollView style={{ maxHeight: 248 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {visibleCompletions.slice(0, 40).map((item, i) => {
                const label = item.display || item.text;
                return (
                  <Pressable
                    key={`${item.text}-${i}`}
                    testID={`completion-option-${i}`}
                    onPress={() => applyCompletion(item)}
                    className="flex-row items-center gap-2 px-3 py-2 active:bg-neutral-100 dark:active:bg-neutral-800"
                  >
                    <Text
                      className="shrink-0 text-[14px] font-semibold text-[#1a73e8] dark:text-[#7aa7ff]"
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                    {item.meta ? (
                      <Text
                        className="min-w-0 flex-1 text-[12px] text-neutral-500 dark:text-neutral-400"
                        numberOfLines={1}
                      >
                        {item.meta}
                      </Text>
                    ) : (
                      <View className="flex-1" />
                    )}
                    {item.kind === 'skill' && (
                      <Text className="shrink-0 rounded bg-neutral-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        skill
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
        {editingRowId != null && (
          <View className="mx-2.5 mb-1 flex-row items-center gap-2 rounded-xl border border-[#1a73e8]/40 bg-[#1a73e8]/5 px-3 py-1.5 dark:border-[#7aa7ff]/40 dark:bg-[#7aa7ff]/10">
            <Text className="flex-1 text-[12px] text-[#1a73e8] dark:text-[#7aa7ff]">
              Editing — resend to rewind and rerun from here
            </Text>
            <Pressable onPress={cancelEdit} hitSlop={8} className="shrink-0 rounded px-1.5 py-0.5">
              <Text className="text-[12px] font-semibold text-neutral-500 dark:text-neutral-400">Cancel</Text>
            </Pressable>
          </View>
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
          scrollEnd={scrollEnd}
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
        </View>
      </KeyboardAvoidingView>
      {/* Jump to the newest message (shown once the user scrolls up). */}
      {!atBottom && (
        <Pressable
          testID="scroll-to-bottom"
          onPress={() => {
            stickEnd.current = true;
            scrollEnd();
          }}
          className="absolute right-3 z-40 h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-[#2a2a2a]"
          style={{ bottom: 150, elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 6 }}
        >
          <ChevronDown size={18} color={dark ? '#e5e5e5' : '#333'} />
        </Pressable>
      )}
      <AskSheet
        ref={askRef}
        ask={ask}
        onValue={answerValue}
        onApproval={answerApproval}
        onDismiss={dismissAsk}
        gw={getGw()}
      />
      <InfoSheet
        ref={infoRef}
        onClose={() => {
          infoPresented.current = false;
          setInfoOpen(false);
        }}
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
          <Pressable
            testID="popover-backdrop"
            style={{ position: 'absolute', inset: 0, zIndex: 60 }}
            onPress={closePopover}
          />
          <View
            testID="anchor-popover"
            className="absolute z-[70] rounded-xl border border-neutral-200 bg-white p-1 dark:border-neutral-700 dark:bg-[#212121]"
            style={{
              width: popW,
              left: popLeft,
              bottom: popBottom,
              maxHeight: popMaxH,
              elevation: 16,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: dark ? 0.5 : 0.18,
              shadowRadius: 10,
            }}
          >
            {popover.kind === 'effort' && showEffort && (
              <>
                <Text className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Thinking effort
                </Text>
                {effortOptions.map((e) => {
                  const on = e === effort.trim().toLowerCase();
                  return (
                    <Pressable
                      key={e}
                      testID={`effort-option-${e}`}
                      onPress={() => {
                        void applyEffort(e);
                        closePopover();
                      }}
                      className={`flex-row items-center gap-2 rounded-lg px-2.5 py-2 ${
                        on
                          ? 'bg-[#1a73e8]/10 dark:bg-[#1a73e8]/20'
                          : 'active:bg-neutral-100 dark:active:bg-neutral-800'
                      }`}
                    >
                      <Text
                        className={`flex-1 text-[14px] ${
                          on
                            ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                            : 'text-neutral-900 dark:text-neutral-100'
                        }`}
                      >
                        {reasoningLabel(e)}
                      </Text>
                      {on && <Check size={15} color="#1a73e8" />}
                    </Pressable>
                  );
                })}
                {/* Fast mode — separate from reasoning (`config.set fast`). */}
                <View className="my-1 h-[1px] bg-neutral-100 dark:bg-neutral-800" />
                <Pressable
                  testID="fast-toggle"
                  onPress={() => {
                    void applyFast(!(sessionInfo?.fast === true));
                    closePopover();
                  }}
                  className="flex-row items-center gap-2 rounded-lg px-2.5 py-2 active:bg-neutral-100 dark:active:bg-neutral-800"
                >
                  <Text
                    className={`flex-1 text-[14px] ${
                      sessionInfo?.fast === true
                        ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                        : 'text-neutral-900 dark:text-neutral-100'
                    }`}
                  >
                    Fast mode
                  </Text>
                  {sessionInfo?.fast === true && <Check size={15} color="#1a73e8" />}
                </Pressable>
              </>
            )}

            {popover.kind === 'attach' && (
              <>
                <Text className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Attach
                </Text>
                <Pressable
                  testID="attach-photo"
                  onPress={() => void pickImage()}
                  className="flex-row items-center gap-2.5 rounded-lg px-2.5 py-2 active:bg-neutral-100 dark:active:bg-neutral-800"
                >
                  <ImageIcon size={17} color={dark ? '#ccc' : '#444'} />
                  <Text className="text-[14px] text-neutral-900 dark:text-neutral-100">Photo</Text>
                </Pressable>
                <Pressable
                  testID="attach-file"
                  onPress={() => void pickFile()}
                  className="flex-row items-center gap-2.5 rounded-lg px-2.5 py-2 active:bg-neutral-100 dark:active:bg-neutral-800"
                >
                  <FileText size={17} color={dark ? '#ccc' : '#444'} />
                  <Text className="text-[14px] text-neutral-900 dark:text-neutral-100">File</Text>
                </Pressable>
              </>
            )}

            {popover.kind === 'model' && (
              <>
                <Text className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Switch model (this chat)
                </Text>
                <View className="px-1.5 pb-1.5">
                  <TextInput
                    className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-[14px] text-neutral-950 dark:border-neutral-700 dark:text-neutral-100"
                    value={modelQuery}
                    onChangeText={setModelQuery}
                    placeholder="Search models…"
                    placeholderTextColor={dark ? '#888' : '#9ca3af'}
                    keyboardAppearance={dark ? 'dark' : 'light'}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                {providersLoading && (
                  <Text className="px-3 py-1 text-[13px] text-neutral-500 dark:text-neutral-400">loading models…</Text>
                )}
                {!!providersError && (
                  <Text className="px-3 py-1 text-[13px] text-[#c5221f] dark:text-[#ff7b72]">{providersError}</Text>
                )}
                <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
                  {modelVisibleProviders.map((p) => {
                    const count = p.models?.length ?? p.totalModels;
                    const open = mq ? true : (modelExpanded[p.slug] ?? false);
                    return (
                      <View key={p.slug || p.name}>
                        <Pressable
                          onPress={() =>
                            setModelExpanded((e) => ({ ...e, [p.slug]: !(e[p.slug] ?? false) }))
                          }
                          className="flex-row items-center gap-2 rounded-lg px-2.5 py-2 active:bg-neutral-100 dark:active:bg-neutral-800"
                        >
                          <Text
                            className="flex-1 text-[14px] font-bold text-neutral-950 dark:text-neutral-100"
                            numberOfLines={1}
                          >
                            {p.name}
                          </Text>
                          <Text className="text-[12px] text-neutral-500 dark:text-neutral-400">
                            {count} model{count === 1 ? '' : 's'}
                          </Text>
                          {open ? (
                            <ChevronDown size={15} color={dark ? '#a3a3a3' : '#666'} />
                          ) : (
                            <ChevronRight size={15} color={dark ? '#a3a3a3' : '#666'} />
                          )}
                        </Pressable>
                        {open &&
                          (p.models ?? []).map((mm) => {
                            const on = mm === model && p.slug === modelProvider;
                            return (
                              <View
                                key={mm}
                                className={`flex-row items-center gap-2 rounded-lg py-1.5 pl-3 pr-1.5 ${
                                  on ? 'bg-[#1a73e8]/10 dark:bg-[#1a73e8]/20' : ''
                                }`}
                              >
                                <Pressable
                                  onPress={() => {
                                    void pickModel(p.slug, mm);
                                    closePopover();
                                  }}
                                  className="flex-1"
                                >
                                  <Text
                                    className={`text-[14px] ${
                                      on
                                        ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                                        : 'text-neutral-950 dark:text-neutral-100'
                                    }`}
                                    numberOfLines={1}
                                  >
                                    {on ? '● ' : '○ '}
                                    {mm}
                                  </Text>
                                </Pressable>
                                <Pressable
                                  onPress={() => {
                                    void setGlobalModel(p.slug, mm);
                                    closePopover();
                                  }}
                                  className="rounded-lg border border-neutral-300 px-2 py-1 dark:border-neutral-700"
                                  hitSlop={8}
                                >
                                  <Text className="text-[13px] dark:text-neutral-100">Global</Text>
                                </Pressable>
                              </View>
                            );
                          })}
                        {open && !p.models && (
                          <Text className="px-3 py-1.5 text-[13px] text-neutral-500 dark:text-neutral-400">
                            list unavailable — pull to refresh on server
                          </Text>
                        )}
                      </View>
                    );
                  })}
                  {modelVisibleProviders.length === 0 && !providersLoading && (
                    <Text className="px-3 py-2 text-[13px] text-neutral-500 dark:text-neutral-400">no matches</Text>
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </>
      )}
    </SafeAreaView>
    </View>
  );
}
