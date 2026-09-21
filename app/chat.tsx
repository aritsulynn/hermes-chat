// Chat route — transcript + composer (was the 'chat' screen in App.tsx).
// Header back goes to /sessions; the native Drawer replaces NavDrawer/EdgeSwipe.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Markdown from 'react-native-markdown-display';
import { Redirect, useNavigation } from 'expo-router';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { Brain, Check, ChevronLeft, Cog, Copy, Info } from 'lucide-react-native';
import { useApp } from '../src/store';
import { FALLBACK_PROVIDERS, cleanThinking, flattenLists } from '../src/models';
import type { UiMessage } from '../src/models';
import { AskSheet, Composer, InfoSheet, TypingDots, mdAi, mdUser, selectableRules, styles } from '../src/ui';

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
    goSessions,
    openInfo,
    loadProviders,
    pickModel,
    copyText,
    answerValue,
    answerApproval,
    dismissAsk,
    getGw,
  } = useApp();

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

  // Native Drawer header: live session title, back button, info button.
  // Android content height compacted 64→52 like sessions (iOS stays 44).
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    navigation.setOptions({
      title: sessionId ? sessionTitle || 'Chat' : 'No session',
      ...(Platform.OS === 'android' ? { headerStyle: { height: insets.top + 52 } } : null),
      headerLeft: () => (
        <Pressable onPress={goSessions} style={styles.backBtn} hitSlop={12}>
          <ChevronLeft size={24} color="#111" />
        </Pressable>
      ),
      headerRight: sessionId
        ? () => (
            <Pressable
              testID="info-btn"
              onPress={() => void openInfo()}
              style={styles.backBtn}
              hitSlop={12}
            >
              <Info size={20} color="#111" />
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, insets.top, sessionId, sessionTitle, goSessions, openInfo]);

  if (booting) {
    return (
      <SafeAreaView style={[styles.root, styles.boot]} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="auto" />
        <ActivityIndicator size="large" />
        <Text style={styles.sub}>connecting…</Text>
      </SafeAreaView>
    );
  }
  if (!authed) return <Redirect href="/login" />;

  if (!sessionId) {
    return (
      <SafeAreaView style={styles.root} edges={['left', 'right', 'bottom']}>
        <StatusBar style="auto" />
        <View style={[styles.flex, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
          <Text style={styles.sub}>No active session — pick one from the list.</Text>
          <Pressable onPress={goSessions} style={styles.primary}>
            <Text style={styles.primaryText}>‹ All sessions</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right', 'bottom']}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          style={styles.flex}
          contentContainerStyle={styles.listPad}
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
            return (
              <View
                style={[
                  styles.bubble,
                  { maxWidth: bubbleMax },
                  item.role === 'user'
                    ? styles.user
                    : think
                      ? styles.think
                      : item.role === 'interim'
                        ? styles.interim
                        : item.role === 'notice'
                          ? styles.notice
                          : item.role === 'tool'
                            ? styles.toolBubble
                            : styles.ai,
                ]}
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
                      <View style={styles.bubbleRow}>
                        <Brain size={14} color="#777" />
                        <Text
                          selectable={!!expanded[item.id]}
                          style={[styles.thinkMsg, styles.bubbleText]}
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
                    <View style={styles.bubbleRow}>
                      {item.pending ? (
                        <Cog size={14} color="#3b5bdb" />
                      ) : (
                        <Check size={14} color="#3b5bdb" />
                      )}
                      <Text
                        selectable={!!expanded[item.id]}
                        style={[styles.toolMsg, styles.bubbleText]}
                        numberOfLines={expanded[item.id] ? undefined : 2}
                      >
                        {item.text}
                        {item.detail && expanded[item.id] ? `\n${item.detail}` : ''}
                      </Text>
                    </View>
                  </Pressable>
                ) : markdown ? (
                  <Markdown rules={selectableRules} style={item.role === 'user' ? mdUser : mdAi}>{flattenLists(item.text)}</Markdown>
                ) : (
                  <Text selectable style={[styles.msg, item.role === 'user' && styles.userMsg]}>
                    {item.text}
                  </Text>
                )}
                {copyable && (
                  <Pressable onPress={() => void copyText(item.id, item.text)} style={styles.copyBtn} hitSlop={6}>
                    {copiedId === item.id ? (
                      <Check size={11} color={item.role === 'user' ? 'rgba(255,255,255,.75)' : '#999'} />
                    ) : (
                      <Copy size={11} color={item.role === 'user' ? 'rgba(255,255,255,.75)' : '#999'} />
                    )}
                    <Text style={[styles.copyText, item.role === 'user' ? styles.copyTextUser : styles.copyTextAi]}>
                      {copiedId === item.id ? 'Copied' : 'Copy'}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          }}
        />
        {!!toolLine && (
          <Text style={styles.tool} numberOfLines={1}>
            {toolLine}
          </Text>
        )}
        <Composer
          input={input}
          setInput={setInput}
          send={onSend}
          stop={stop}
          generating={generating}
          scrollEnd={scrollEnd}
          model={model}
          modelProvider={modelProvider}
          providers={providers ?? FALLBACK_PROVIDERS}
          providersLoading={providersLoading}
          providersError={providersError}
          onOpenModelPicker={() => void loadProviders()}
          onPickModel={(slug, mid) => void pickModel(slug, mid)}
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
      />
    </SafeAreaView>
  );
}
