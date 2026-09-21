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
import { EFFORTS, FALLBACK_PROVIDERS } from '../../utils/messages';
import type { UiMessage } from '../../utils/messages';
import { AskSheet, Composer, HamburgerBtn, InfoSheet, MessageBubble } from '../../components';
import type { AnchorMeasure } from '../../components';

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
    setEffort,
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

  const listRef = useRef<FlatList<UiMessage>>(null);
  // Long-press fired: swallow the onPress that fires on release (else a
  // long-press on thinking/tool bubbles toggles them instead of selecting).
  const longFired = useRef(false);
  // True while the user sits at the bottom (following the live turn).
  // Content-size growth (stream tokens, expand thinking) auto-scrolls only
  // then — expanding an old bubble mid-list no longer yanks to the bottom.
  const stickEnd = useRef(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const tokenEstimate = messages.reduce((n, m) => n + Math.ceil(m.text.length / 4), 0);
  // Kebab menu + in-conversation search.
  const [kebabOpen, setKebabOpen] = useState(false);
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
      headerLeft: () => <HamburgerBtn />,
      headerRight: sessionId
        ? () => (
            <Pressable
              testID="kebab-btn"
              onPress={() => setKebabOpen((v) => !v)}
              className="justify-center px-2 py-2"
              hitSlop={12}
            >
              <MoreVertical size={20} color={headerIcon} />
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
  const popMaxH = popover?.kind === 'model' ? Math.round(popRootH * 0.55) : undefined;
  const popRelY = popover ? popover.y - rootWin.current.y : 0;
  const popBottom = popover ? Math.max(8, popRootH - popRelY + 6) : 0;
  const popLeft = popover ? Math.max(8, Math.min(popover.x, winW - popW - 8)) : 0;

  // Model picker list (search + provider accordions), moved out of the old
  // composer bottom sheet so it can render in the screen-level popover.
  const modelProviders = providers ?? FALLBACK_PROVIDERS;
  const mq = modelQuery.trim().toLowerCase();
  const modelVisibleProviders = modelProviders
    .map((p) => {
      const list = p.models ?? [];
      const models = mq
        ? list.filter(
            (mm) =>
              mm.toLowerCase().includes(mq) ||
              p.name.toLowerCase().includes(mq) ||
              p.slug.toLowerCase().includes(mq),
          )
        : list;
      return { ...p, models };
    })
    .filter((p) => (mq ? p.models.length > 0 : true));

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
            className="absolute right-2 w-52 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-[#212121]"
            // Content area already starts below the native header, so anchor
            // just under it. (top: insets.top + 52 double-counts the header
            // and drops the menu mid-screen.)
            style={{ top: 8, zIndex: 50, elevation: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8 }}
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
          contentContainerStyle={{ padding: 12, gap: 8 }}
          onContentSizeChange={() => {
            if (stickEnd.current) scrollEnd();
          }}
          onLayout={() => {
            stickEnd.current = true;
            scrollEnd(false);
          }}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            stickEnd.current =
              contentSize.height - (contentOffset.y + layoutMeasurement.height) < 120;
          }}
          scrollEventThrottle={16}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => (
            <MessageBubble item={item} bubbleMax={bubbleMax} dark={dark} expanded={!!expanded[item.id]} highlight={searchOpen && !!sq && item.text.toLowerCase().includes(sq)} longFired={longFired} onToggleExpand={(id) => setExpanded((p) => ({...p, [id]: !p[id]}))} copiedId={copiedId} onCopy={(id, text) => void copyText(id, text)} />
          )}
        />
        {!!toolLine && (
          <Text className="px-3.5 pb-1 text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
            {toolLine}
          </Text>
        )}
        <Composer
          input={input}
          setInput={setInput}
          send={onSend}
          stop={stop}
          onRedirect={onRedirect}
          generating={generating}
          scrollEnd={scrollEnd}
          model={model}
          modelProvider={modelProvider}
          onOpenModelPicker={(m) => openPopover('model', m)}
          effort={effort}
          onOpenEffortPicker={(m) => openPopover('effort', m)}
          onOpenAttachPicker={(m) => openPopover('attach', m)}
          attachments={attachments}
          setAttachments={setAttachments}
        />
      </KeyboardAvoidingView>
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
            {popover.kind === 'effort' && (
              <>
                <Text className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Thinking effort
                </Text>
                {EFFORTS.map((e) => {
                  const on = e === effort;
                  return (
                    <Pressable
                      key={e}
                      testID={`effort-option-${e.toLowerCase()}`}
                      onPress={() => {
                        setEffort(e);
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
                        {e}
                      </Text>
                      {on && <Check size={15} color="#1a73e8" />}
                    </Pressable>
                  );
                })}
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
