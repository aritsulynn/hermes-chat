// Chat route — transcript + composer (was the 'chat' screen in App.tsx).
// Header back goes to /sessions; the native Drawer replaces NavDrawer/EdgeSwipe.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Markdown from 'react-native-markdown-display';
import { Redirect, useNavigation } from 'expo-router';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { Brain, Check, ChevronDown, ChevronUp, Cog, Copy, Info, MoreVertical, Search, X } from 'lucide-react-native';
import { useApp } from '../src/store';
import { FALLBACK_PROVIDERS, cleanThinking, flattenLists } from '../src/models';
import type { UiMessage } from '../src/models';
import { AskSheet, Composer, HamburgerBtn, InfoSheet, TypingDots, mdAi, mdAiDark, mdUser, selectableRules } from '../src/ui';

export default function ChatScreen() {
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
    goSessions,
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
  const { width: winW } = useWindowDimensions();
  const bubbleMax = Math.round(winW * 0.85);

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
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => scrollEnd(true), 50);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setTimeout(() => scrollEnd(true), 50);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scrollEnd]);

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
      title: sessionId ? sessionTitle || 'Chat' : 'No session',
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
      <SafeAreaView className="flex-1 bg-white items-center justify-center gap-3 dark:bg-black" edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="auto" />
        <ActivityIndicator size="large" />
        <Text className="mb-4 text-sm text-neutral-500">connecting…</Text>
      </SafeAreaView>
    );
  }
  if (!authed) return <Redirect href="/login" />;

  if (!sessionId) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['left', 'right', 'bottom']}>
        <StatusBar style="auto" />
        <View className="flex-1 items-center justify-center p-6">
          <Text className="mb-4 text-sm text-neutral-500">No active session — pick one from the list.</Text>
          <Pressable onPress={goSessions} className="mt-2 items-center rounded-lg bg-[#1a73e8] px-[18px] py-[11px]">
            <Text className="text-[15px] font-semibold text-white">‹ History</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['left', 'right', 'bottom']}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Kebab menu: search + session info */}
        <Modal visible={kebabOpen} transparent animationType="fade" onRequestClose={() => setKebabOpen(false)}>
          <Pressable className="flex-1" onPress={() => setKebabOpen(false)}>
            <View className="absolute right-2 top-14 w-52 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-[#212121]">
              <Pressable
                testID="menu-search"
                onPress={() => {
                  setKebabOpen(false);
                  setSearchOpen(true);
                }}
                className="flex-row items-center gap-2.5 rounded-lg px-3 py-2.5"
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
                className="flex-row items-center gap-2.5 rounded-lg px-3 py-2.5"
              >
                <Info size={17} color={headerIcon} />
                <Text className="text-[15px] text-neutral-950 dark:text-neutral-100">Session info</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
        {searchOpen && (
          <View className="flex-row items-center gap-1.5 border-b border-neutral-100 px-2.5 py-1.5 dark:border-neutral-800">
            <Search size={16} color={dark ? '#a3a3a3' : '#666'} />
            <TextInput
              className="flex-1 rounded-lg bg-[#f4f4f6] px-2.5 py-1.5 text-[14px] text-neutral-950 dark:bg-[#212121] dark:text-neutral-100"
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search in conversation…"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="search"
              onSubmitEditing={() => jumpToMatch(matchIdx)}
            />
            <Text className="text-xs text-neutral-500">
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
          renderItem={({ item }) => {
            const think = item.role === 'thinking';
            const typing = !think && item.pending && !item.text;
            const markdown =
              !think && item.role !== 'notice' && item.role !== 'interim' && item.role !== 'tool';
            const copyable = (item.role === 'user' || item.role === 'assistant') && !!item.text && !item.pending;
            const matched = searchOpen && !!sq && item.text.toLowerCase().includes(sq);
            return (
              <View
                className={`rounded-[14px] px-3 py-2 ${
                  item.role === 'user'
                    ? 'self-end bg-[#1a73e8]'
                    : think
                      ? 'self-start border border-[#e2e2e6] bg-[#f7f7f9] dark:border-neutral-700 dark:bg-[#212121]'
                      : item.role === 'interim'
                        ? 'self-start border border-[#f0e0a0] bg-[#fff8e1] dark:border-[#6b5a1e] dark:bg-[#3a2f10]'
                        : item.role === 'notice'
                          ? 'self-center bg-[#fdecea] dark:bg-[#3d2020]'
                          : item.role === 'tool'
                            ? 'self-start border border-[#d3e1f8] bg-[#eef3fd] dark:border-neutral-700 dark:bg-[#272727]'
                            : 'self-start bg-[#f0f0f2] dark:bg-[#272727]'
                }${matched ? ' border-2 border-[#1a73e8]' : ''}`}
                style={{ maxWidth: bubbleMax }}
              >
                {typing ? (
                  <TypingDots />
                ) : think ? (
                  item.text ? (
                    <Pressable
                      onPress={() => {
                        if (longFired.current) {
                          longFired.current = false;
                          return;
                        }
                        setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }));
                      }}
                      onLongPress={() => {
                        longFired.current = true;
                      }}
                    >
                      <View className="flex-row items-start gap-1.5">
                        <Brain size={14} color={dark ? '#999' : '#777'} />
                        <Text
                          selectable={!!expanded[item.id]}
                          className="shrink text-[13px] leading-[18px] text-neutral-500"
                          numberOfLines={expanded[item.id] ? undefined : 1}
                        >
                          {cleanThinking(item.text)}
                        </Text>
                      </View>
                    </Pressable>
                  ) : (
                    <TypingDots dim />
                  )
                ) : item.role === 'tool' ? (
                  <Pressable
                    onPress={() => {
                      if (longFired.current) {
                        longFired.current = false;
                        return;
                      }
                      setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }));
                    }}
                    onLongPress={() => {
                      longFired.current = true;
                    }}
                  >
                    <View className="flex-row items-start gap-1.5">
                      {item.pending ? (
                        <Cog size={14} color={dark ? '#8fa8ff' : '#3b5bdb'} />
                      ) : (
                        <Check size={14} color={dark ? '#8fa8ff' : '#3b5bdb'} />
                      )}
                      <Text
                        selectable={!!expanded[item.id]}
                        className="shrink text-[13px] leading-[18px] text-[#3b5bdb] dark:text-[#8fa8ff]"
                        numberOfLines={expanded[item.id] ? undefined : 2}
                      >
                        {item.text}
                        {item.detail && expanded[item.id] ? `\n${item.detail}` : ''}
                      </Text>
                    </View>
                  </Pressable>
                ) : markdown ? (
                  <Markdown rules={selectableRules} style={item.role === 'user' ? mdUser : dark ? mdAiDark : mdAi}>{flattenLists(item.text)}</Markdown>
                ) : (
                  <Text selectable className={item.role === 'user' ? 'text-[15px] leading-[21px] text-white' : 'text-[15px] leading-[21px] text-neutral-950 dark:text-neutral-100'}>
                    {item.text}
                  </Text>
                )}
                {copyable && (
                  <Pressable onPress={() => void copyText(item.id, item.text)} className="mt-1 flex-row items-center gap-1 self-end px-0.5 py-0.5" hitSlop={6}>
                    {copiedId === item.id ? (
                      <Check size={11} color={item.role === 'user' ? 'rgba(255,255,255,.75)' : dark ? '#aaa' : '#999'} />
                    ) : (
                      <Copy size={11} color={item.role === 'user' ? 'rgba(255,255,255,.75)' : dark ? '#aaa' : '#999'} />
                    )}
                    <Text className={item.role === 'user' ? 'text-[11px] font-semibold text-white/75' : 'text-[11px] font-semibold text-neutral-400'}>
                      {copiedId === item.id ? 'Copied' : 'Copy'}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          }}
        />
        {!!toolLine && (
          <Text className="px-3.5 pb-1 text-xs text-neutral-500" numberOfLines={1}>
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
          providers={providers ?? FALLBACK_PROVIDERS}
          providersLoading={providersLoading}
          providersError={providersError}
          onOpenModelPicker={() => void loadProviders()}
          onPickModel={(slug, mid) => void pickModel(slug, mid)}
          onPickGlobal={(slug, mid) => void setGlobalModel(slug, mid)}
          effort={effort}
          setEffort={setEffort}
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
    </SafeAreaView>
  );
}
