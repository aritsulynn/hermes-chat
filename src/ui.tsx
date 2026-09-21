// Shared UI bits — Composer, Field, bottom sheets (via @gorhom/bottom-sheet),
// TypingDots, markdown rules/styles (layout uses NativeWind className).
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import Markdown from 'react-native-markdown-display';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Info,
  KeyRound,
  Lock,
  Menu as MenuIcon,
  MessageSquare,
  Mic,
  Paperclip,
  Plus,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react-native';
import { useNavigation } from 'expo-router';
import { EFFORTS, parseClarify } from './models';
import type { Attachment } from './models';
import { useApp } from './store';
import { RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder } from 'expo-audio';
import type { ModelProviderOption } from './dashboard';
import type { GatewayWs, ServerAsk } from './gateway-ws';

const renderBackdrop = (props: any) => (
  <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
);

const renderStaticBackdrop = (props: any) => (
  <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} pressBehavior="none" />
);

// ── Session info sheet ───────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <View className="flex-row gap-2 py-1">
      <Text className="w-[72px] text-[13px] text-neutral-500">{label}</Text>
      <Text className="flex-1 text-sm text-neutral-950 dark:text-neutral-100" numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

export const InfoSheet = forwardRef<
  BottomSheetModal,
  {
    onClose: () => void;
    title: string;
    model: string;
    provider: string;
    info: any;
    usage: any;
    usageLoading: boolean;
    onRename: (title: string) => void;
    tokenEstimate: number;
  }
>(function InfoSheet({ onClose, title, model, provider, info, usage, usageLoading, onRename, tokenEstimate }, ref) {
  const snapPoints = useMemo(() => ['60%', '90%'], []);
  const { theme } = useApp();
  const dark = theme === 'dark';
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  return (
    <BottomSheetModal
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
    >
      <BottomSheetScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <View className="flex-row items-center justify-between">
          <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">Session info</Text>
        </View>
        <InfoRow label="Title" value={title} />
        <View className="flex-row items-center gap-2">
          <TextInput
            className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm text-neutral-950 dark:text-neutral-100"
            value={draft}
            onChangeText={setDraft}
            placeholder="Rename session…"
            autoCapitalize="none"
          />
          <Pressable onPress={() => draft.trim() && onRename(draft.trim())} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5">
            <Text className="dark:text-neutral-100">Save</Text>
          </Pressable>
        </View>
        <InfoRow label="~Tokens" value={tokenEstimate > 0 ? `≈ ${tokenEstimate.toLocaleString()}` : undefined} />
        <InfoRow label="Model" value={typeof info?.model === 'string' && info.model ? info.model : model} />
        <InfoRow
          label="Provider"
          value={typeof info?.provider === 'string' && info.provider ? info.provider : provider || undefined}
        />
        <InfoRow label="CWD" value={typeof info?.cwd === 'string' ? info.cwd : undefined} />
        <Text className="mt-1 text-sm font-bold text-neutral-950 dark:text-neutral-100">Usage</Text>
        {usageLoading ? (
          <Text className="mb-4 text-sm text-neutral-500">loading…</Text>
        ) : (
          <Text className="rounded-lg bg-[#f4f4f6] dark:bg-[#212121] p-2 font-mono text-[13px] text-neutral-950 dark:text-neutral-100">{usage ? JSON.stringify(usage, null, 2) : '—'}</Text>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

// ── Ask sheet (clarify / approval / sudo / secret / vault) ───────────────────

export const AskSheet = forwardRef<
  BottomSheetModal,
  {
    ask: ServerAsk | null;
    onValue: (v: string) => void;
    onApproval: (c: string) => void;
    onDismiss: () => void;
    gw: GatewayWs | null;
  }
>(function AskSheet({ ask, onValue, onApproval, onDismiss, gw }, ref) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const snapPoints = useMemo(() => ['50%', '85%'], []);
  const { theme } = useApp();
  const dark = theme === 'dark';

  useEffect(() => {
    setText('');
    setPicked({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask?.rpcId]);

  const renderBody = () => {
    if (!ask) return null;
    const m = ask.method;

    // Batch/single clarify — answer locks per question via clarify.lock so the
    // agent sees partial progress; the final answer set resolves the request.
    if (m === 'clarify') {
      const { single, questions } = parseClarify(ask);
      const toggle = (qid: string, choice: string, multi: boolean) => {
        setPicked((prev) => {
          const cur = prev[qid] ?? [];
          const next = multi
            ? cur.includes(choice)
              ? cur.filter((c) => c !== choice)
              : [...cur, choice]
            : [choice];
          // Lock-in: server keeps it even on timeout.
          gw?.call('clarify.lock', { request_id: ask.rpcId, question_id: qid, answer: next.join(', ') }).catch(() => {});
          return { ...prev, [qid]: next };
        });
      };
      const submitAll = () => {
        if (!gw) return;
        if (single) {
          const q = questions[0];
          const ans = picked[q.qid]?.join(', ') ?? text.trim();
          gw.replyToAsk(ask.rpcId, { answer: ans });
        } else {
          const answers: Record<string, string> = {};
          for (const q of questions) answers[q.qid] = picked[q.qid]?.join(', ') ?? '';
          gw.replyToAsk(ask.rpcId, { answers });
        }
        onDismiss();
      };
      return (
        <>
          <View className="flex-row items-center gap-2">
            <MessageSquare size={18} color={dark ? '#f5f5f5' : '#111'} />
            <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">Clarify</Text>
          </View>
          {questions.map((q) => (
            <View key={q.qid} className="gap-1.5">
              {!!q.question && <Text className="text-sm text-neutral-700 dark:text-neutral-200">{q.question}</Text>}
              <View className="flex-row flex-wrap gap-2">
                {q.choices.map((c) => {
                  const on = (picked[q.qid] ?? []).includes(c);
                  return (
                    <Pressable key={c} onPress={() => toggle(q.qid, c, q.multiSelect)} className={`rounded-full border border-[#1a73e8] px-3 py-[7px] ${on ? 'bg-[#1a73e8]' : ''}`}>
                      <Text className={`text-sm ${on ? 'text-white' : 'text-[#1a73e8]'}`}>{c}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {q.choices.length === 0 && (
                <TextInput
                  className="rounded-lg border border-neutral-300 dark:border-neutral-700 p-2.5 text-[15px] text-neutral-950 dark:text-neutral-100"
                  value={text}
                  onChangeText={setText}
                  placeholder="พิมพ์คำตอบ…"
                  multiline
                />
              )}
            </View>
          ))}
          <View className="flex-row items-center justify-end gap-2.5">
            <Pressable onPress={submitAll} className="mt-2 items-center rounded-lg bg-[#1a73e8] px-[18px] py-[11px]">
              <Text className="text-[15px] font-semibold text-white">Send answer</Text>
            </Pressable>
          </View>
        </>
      );
    }

    // Dangerous-command approval — choice comes from the payload's own list.
    if (m === 'approval') {
      const choices: string[] = Array.isArray(ask.params.choices) && ask.params.choices.length > 0
        ? ask.params.choices.map(String)
        : ['once', 'deny'];
      const cmd = ask.params.command ? String(ask.params.command) : '';
      return (
        <>
          <View className="flex-row items-center gap-2">
            <TriangleAlert size={18} color={dark ? '#f5f5f5' : '#111'} />
            <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">Allow command?</Text>
          </View>
          {!!cmd && <Text className="rounded-lg bg-[#f4f4f6] dark:bg-[#212121] p-2 font-mono text-[13px] text-neutral-950 dark:text-neutral-100">{cmd}</Text>}
          {!!ask.params.preview && <Text className="text-sm text-neutral-700 dark:text-neutral-200">{String(ask.params.preview)}</Text>}
          <View className="flex-row flex-wrap gap-2">
            {choices.map((c) => (
              <Pressable key={c} onPress={() => onApproval(c)} className={`rounded-full border px-3 py-[7px] ${c === 'deny' ? 'border-[#c5221f]' : 'border-[#1a73e8]'}`}>
                <Text className="text-sm text-[#1a73e8]">{c}</Text>
              </Pressable>
            ))}
          </View>
        </>
      );
    }

    // Sudo / secret / vault / GUI reads — single masked string under "value".
    const sheetIcon =
      m === 'sudo' ? (
        <KeyRound size={18} color={dark ? '#f5f5f5' : '#111'} />
      ) : m === 'secret' || m.startsWith('vault.') ? (
        <Lock size={18} color={dark ? '#f5f5f5' : '#111'} />
      ) : (
        <Info size={18} color={dark ? '#f5f5f5' : '#111'} />
      );
    const label =
      m === 'sudo'
        ? 'Sudo password'
        : m === 'secret'
          ? String(ask.params.prompt ?? ask.params.env_var ?? 'Secret')
          : m.startsWith('vault.')
            ? String(ask.params.display_name ?? ask.params.site ?? m)
            : `${m}`;
    return (
      <>
        <View className="flex-row items-center gap-2">
          {sheetIcon}
          <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">{label}</Text>
        </View>
        {!!ask.params.command && <Text className="rounded-lg bg-[#f4f4f6] dark:bg-[#212121] p-2 font-mono text-[13px] text-neutral-950 dark:text-neutral-100">{String(ask.params.command)}</Text>}
        <TextInput
          className="rounded-lg border border-neutral-300 dark:border-neutral-700 p-2.5 text-[15px] text-neutral-950 dark:text-neutral-100"
          value={text}
          onChangeText={setText}
          placeholder="…"
          secureTextEntry
          autoFocus
        />
        <View className="flex-row items-center justify-end gap-2.5">
          <Pressable onPress={() => onValue('')} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5">
            <Text className="dark:text-neutral-100">Skip</Text>
          </Pressable>
          <Pressable onPress={() => onValue(text)} className="mt-2 items-center rounded-lg bg-[#1a73e8] px-[18px] py-[11px]">
            <Text className="text-[15px] font-semibold text-white">Send</Text>
          </Pressable>
        </View>
      </>
    );
  };

  // Never swipe/backdrop-dismissable — every path answers or skips
  // explicitly, else the server ask hangs. Dismissal is programmatic
  // (parent presents/dismisses as `ask` changes).
  return (
    <BottomSheetModal
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={renderStaticBackdrop}
      enablePanDownToClose={false}
      onDismiss={onDismiss}
    >
      <BottomSheetView className="bg-white dark:bg-black p-4 gap-2.5">{renderBody()}</BottomSheetView>
    </BottomSheetModal>
  );
});

// ── Bits ─────────────────────────────────────────────────────────────────────

// One shared drawer hamburger so every screen looks and behaves the same.
export function HamburgerBtn() {
  const { theme } = useApp();
  const navigation = useNavigation();
  return (
    <Pressable
      testID="hamburger-btn"
      onPress={() => (navigation as any).openDrawer?.()}
      className="justify-center px-2 py-2"
      hitSlop={12}
    >
      <MenuIcon size={24} color={theme === 'dark' ? '#f5f5f5' : '#111'} />
    </Pressable>
  );
}

export function Composer({
  input,
  setInput,
  send,
  stop,
  onRedirect,
  generating,
  scrollEnd,
  model,
  modelProvider,
  providers,
  providersLoading,
  providersError,
  onOpenModelPicker,
  onPickModel,
  onPickGlobal,
  effort,
  setEffort,
  attachments,
  setAttachments,
}: {
  input: string;
  setInput: (v: string) => void;
  send: () => void;
  stop: () => void;
  onRedirect: (text: string) => void;
  generating: boolean;
  scrollEnd: () => void;
  model: string;
  modelProvider: string;
  providers: ModelProviderOption[];
  providersLoading: boolean;
  providersError: string | null;
  onOpenModelPicker: () => void;
  onPickModel: (providerSlug: string, modelId: string) => void;
  onPickGlobal: (providerSlug: string, modelId: string) => void;
  effort: string;
  setEffort: (v: string) => void;
  attachments: Attachment[];
  setAttachments: (v: Attachment[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const { theme } = useApp();
  const dark = theme === 'dark';
  const [menu, setMenu] = useState<null | 'plus' | 'model' | 'effort'>(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKbOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  useEffect(() => {
    if (menu === 'model') {
      setQuery('');
      onOpenModelPicker();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);
  const sheetRef = useRef<BottomSheetModal>(null);
  const sheetSnapPoints = useMemo(() => ['45%', '90%'], []);
  // Never dismiss an un-presented modal (see chat.tsx: gorhom poisons a
  // fresh modal's status to DISMISSING and its portal never renders again).
  const menuPresented = useRef(false);
  useEffect(() => {
    if (menu) {
      sheetRef.current?.present();
      menuPresented.current = true;
    } else if (menuPresented.current) {
      menuPresented.current = false;
      sheetRef.current?.dismiss();
    }
  }, [menu]);
  const canSend = !!input.trim() || attachments.length > 0;
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const toggleRecord = async () => {
    try {
      if (recorder.isRecording) {
        await recorder.stop();
        const uri = recorder.uri;
        setRecording(false);
        if (uri) {
          setAttachments([
            ...attachments,
            { uri, name: `voice-${Date.now()}.m4a`, mime: 'audio/m4a' },
          ]);
        }
        return;
      }
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch {
      setRecording(false);
    }
  };

  const pickImage = async () => {
    setMenu(null);
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
  };

  const pickFile = async () => {
    setMenu(null);
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
  };

  const modelLabel = modelProvider ? `${modelProvider}:${model}` : model;
  const q = query.trim().toLowerCase();
  const visibleProviders = providers
    .map((p) => {
      const list = p.models ?? [];
      const models = q
        ? list.filter((mm) => mm.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q))
        : list;
      return { ...p, models };
    })
    .filter((p) => (q ? p.models.length > 0 : true));
  return (
    <View className="border-t border-neutral-200 dark:border-neutral-700 bg-white dark:bg-black px-2.5 pt-2" style={{ paddingBottom: kbOpen ? 10 : Math.max(insets.bottom, 10) }}>
      <View className="gap-1.5 rounded-2xl bg-[#f4f4f6] dark:bg-[#212121] px-2.5 pb-2 pt-2">
        {generating && (
          <Text className="px-1.5 text-xs text-amber-700">● live — พิมพ์แล้วกด Steer ↪ เพื่อหักพวงมาลัย</Text>
        )}
        {attachments.length > 0 && (
          <View className="flex-row flex-wrap gap-1.5">
            {attachments.map((a) => {
              const isImg =
                (a.mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/i.test(a.name);
              return (
                <Pressable
                  key={a.uri + a.name}
                  onPress={() => setAttachments(attachments.filter((x) => x.uri !== a.uri))}
                  className="max-w-[220px] flex-row items-center gap-1 rounded-xl bg-[#e8eef7] dark:bg-[#272727] px-2 py-1"
                >
                  {isImg ? (
                    // eslint-disable-next-line jsx-a11y/alt-text
                    <Image source={{ uri: a.uri }} className="h-7 w-7 rounded-md bg-[#d7e3f7]" />
                  ) : (
                    <Paperclip size={12} color="#1a73e8" />
                  )}
                  <Text className="shrink text-xs text-[#1a73e8] dark:text-[#7aa7ff]" numberOfLines={1}>
                    {a.name}
                  </Text>
                  <X size={12} color="#1a73e8" />
                </Pressable>
              );
            })}
          </View>
        )}
        <TextInput
          className="max-h-[120px] px-1.5 py-1.5 text-[15px] text-neutral-950 dark:text-neutral-100"
          value={input}
          onChangeText={setInput}
          placeholder={generating ? 'พิมพ์เพื่อ steer เทิร์นที่กำลังรัน…' : 'พิมพ์ข้อความ…'}
          multiline
          editable
          returnKeyType="send"
          blurOnSubmit={false}
          submitBehavior="blurAndSubmit"
          onFocus={() => setTimeout(() => scrollEnd(), 100)}
          onSubmitEditing={() => {
            if (generating) {
              if (input.trim()) onRedirect(input);
            } else {
              send();
            }
          }}
        />
        <View className="flex-row items-center gap-2">
          <Pressable onPress={() => setMenu('plus')} className="h-8 w-8 items-center justify-center rounded-full" hitSlop={8}>
            <Plus size={20} color={dark ? '#a3a3a3' : '#555'} />
          </Pressable>
          <Pressable onPress={() => void toggleRecord()} className="h-8 w-8 items-center justify-center rounded-full" hitSlop={8}>
            <Mic size={20} color={recording ? '#c5221f' : '#555'} />
          </Pressable>
          <Pressable onPress={() => setMenu('model')} className="max-w-[170px] rounded-lg bg-[#e8e8ec] dark:bg-[#272727] px-2 py-1.5" hitSlop={8}>
            <View className="flex-row items-center gap-0.5">
              <Text className="shrink text-[13px] font-semibold text-neutral-700 dark:text-neutral-200" numberOfLines={1}>
                {modelLabel}
              </Text>
              <ChevronDown size={14} color={dark ? '#d4d4d4' : '#333'} />
            </View>
          </Pressable>
          <Pressable onPress={() => setMenu('effort')} className="rounded-lg px-2 py-1.5" hitSlop={8}>
            <Text className="text-[13px] font-semibold text-neutral-500">{effort}</Text>
          </Pressable>
          <View className="flex-1" />
          {generating ? (
            <>
              {!!input.trim() && (
                <Pressable
                  onPress={() => onRedirect(input)}
                  className="mr-1.5 items-center rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5"
                  hitSlop={8}
                >
                  <Text className="dark:text-neutral-100">Steer ↪</Text>
                </Pressable>
              )}
              <Pressable
                onPress={stop}
                className="h-10 w-10 items-center justify-center rounded-full bg-[#c5221f]"
              >
                <Square size={14} color="#fff" fill="#fff" />
              </Pressable>
            </>
          ) : (
            <Pressable onPress={send} className={`h-10 w-10 items-center justify-center rounded-full bg-[#1a73e8] ${!canSend ? 'opacity-40' : ''}`} disabled={!canSend}>
              <ArrowUp size={20} color="#fff" />
            </Pressable>
          )}
        </View>
      </View>
      <BottomSheetModal
        ref={sheetRef}
        index={0}
        snapPoints={sheetSnapPoints}
        backdropComponent={renderBackdrop}
        onDismiss={() => {
          menuPresented.current = false;
          setMenu(null);
        }}
      >
        <BottomSheetScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
            {menu === 'plus' && (
              <>
                <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">แนบ</Text>
                <Pressable onPress={pickImage} className="flex-row items-center gap-2 border-b border-[#f0f0f2] dark:border-neutral-800 py-3">
                  <ImageIcon size={18} color={dark ? '#f5f5f5' : '#111'} />
                  <Text className="text-[15px] text-neutral-950 dark:text-neutral-100">รูปภาพ</Text>
                </Pressable>
                <Pressable onPress={pickFile} className="flex-row items-center gap-2 border-b border-[#f0f0f2] dark:border-neutral-800 py-3">
                  <FileText size={18} color={dark ? '#f5f5f5' : '#111'} />
                  <Text className="text-[15px] text-neutral-950 dark:text-neutral-100">ไฟล์</Text>
                </Pressable>
              </>
            )}
            {menu === 'model' && (
              <>
                <View className="flex-row items-center justify-between">
                  <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">Switch model (this chat)</Text>
                </View>
                <TextInput
                  className="rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm text-neutral-950 dark:text-neutral-100"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search models and providers…"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {providersLoading && <Text className="mb-4 text-sm text-neutral-500">loading models…</Text>}
                {!!providersError && <Text className="mt-2.5 text-[#c5221f]">{providersError}</Text>}
                {visibleProviders.map((p) => {
                  const count = p.models?.length ?? p.totalModels;
                  const open = q ? true : (expanded[p.slug] ?? false);
                  return (
                    <View key={p.slug || p.name}>
                      <Pressable
                        onPress={() => setExpanded((e) => ({ ...e, [p.slug]: !(e[p.slug] ?? false) }))}
                        className="flex-row items-center gap-2 border-b border-[#f0f0f2] dark:border-neutral-800 py-3"
                      >
                        <Text className="flex-1 text-[15px] font-bold text-neutral-950 dark:text-neutral-100">{p.name}</Text>
                        <Text className="text-[13px] text-neutral-500">
                          {count} model{count === 1 ? '' : 's'}
                        </Text>
                        {open ? (
                          <ChevronDown size={16} color={dark ? '#a3a3a3' : '#666'} />
                        ) : (
                          <ChevronRight size={16} color={dark ? '#a3a3a3' : '#666'} />
                        )}
                      </Pressable>
                      {open &&
                        (p.models ?? []).map((mm) => {
                          const on = mm === model && p.slug === modelProvider;
                          return (
                            <View key={mm} className={`flex-row items-center gap-2 border-b border-[#f5f5f7] dark:border-neutral-800 py-2.5 pl-4 ${on ? 'bg-[#f4f8ff]' : ''}`}>
                              <Pressable
                                onPress={() => {
                                  onPickModel(p.slug, mm);
                                  setMenu(null);
                                }}
                                className="flex-1"
                              >
                                <Text className={`text-[15px] ${on ? 'font-bold text-[#1a73e8] dark:text-[#7aa7ff]' : 'text-neutral-950 dark:text-neutral-100'}`} numberOfLines={1}>
                                  {on ? '● ' : '○ '}{mm}
                                </Text>
                              </Pressable>
                              <Pressable
                                onPress={() => {
                                  onPickGlobal(p.slug, mm);
                                  setMenu(null);
                                }}
                                className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5"
                                hitSlop={8}
                              >
                                <Text className="dark:text-neutral-100">Global</Text>
                              </Pressable>
                            </View>
                          );
                        })}
                      {open && !p.models && (
                        <Text className="mb-4 text-sm text-neutral-500">list unavailable — pull to refresh on server</Text>
                      )}
                    </View>
                  );
                })}
                {visibleProviders.length === 0 && !providersLoading && (
                  <Text className="mb-4 text-sm text-neutral-500">no matches</Text>
                )}
              </>
            )}
            {menu === 'effort' && (
              <>
                <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">Thinking effort</Text>
                <View className="flex-row gap-1.5">
                  {EFFORTS.map((e) => (
                    <Pressable
                      key={e}
                      onPress={() => {
                        setEffort(e);
                        setMenu(null);
                      }}
                      className={`flex-1 items-center rounded-[10px] border py-2.5 ${e === effort ? 'border-[#1a73e8] bg-[#1a73e8]' : 'border-neutral-300 dark:border-neutral-700'}`}
                    >
                      <Text className={`text-[13px] font-semibold ${e === effort ? 'text-white' : 'text-neutral-700 dark:text-neutral-200'}`}>{e}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
        </BottomSheetScrollView>
      </BottomSheetModal>
    </View>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const { theme } = useApp();
  const dark = theme === 'dark';
  if (!secure) {
    return (
      <View className="mb-2.5">
        <Text className="mb-0.5 text-xs text-neutral-500">{label}</Text>
        <TextInput
          className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black px-2.5 py-2 text-[15px] text-neutral-950 dark:text-neutral-100"
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    );
  }
  return (
    <View className="mb-2.5">
      <Text className="mb-0.5 text-xs text-neutral-500">{label}</Text>
      <View className="flex-row items-center rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black pr-1">
        <TextInput
          className="flex-1 px-2.5 py-2 text-[15px] text-neutral-950 dark:text-neutral-100"
          value={value}
          onChangeText={onChange}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable onPress={() => setVisible((v) => !v)} className="px-2.5 py-2" hitSlop={8}>
          <Text className="text-sm font-semibold text-[#1a73e8] dark:text-[#7aa7ff]">{visible ? 'Hide' : 'Show'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function TypingDots({ dim }: { dim?: boolean }) {
  const d1 = useRef(new Animated.Value(0)).current;
  const d2 = useRef(new Animated.Value(0)).current;
  const d3 = useRef(new Animated.Value(0)).current;
  const { theme } = useApp();
  const dark = theme === 'dark';
  useEffect(() => {
    const pulse = (d: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(d, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 350, useNativeDriver: true }),
        ]),
      );
    const loops = [pulse(d1, 0), pulse(d2, 150), pulse(d3, 300)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [d1, d2, d3]);
  const color = dim ? (dark ? '#888' : '#bbb') : (dark ? '#aaa' : '#999');
  return (
    <View className="flex-row items-center gap-[5px] px-0.5 py-1.5">
      {[d1, d2, d3].map((d, i) => (
        <Animated.View
          key={i}
          className="h-[7px] w-[7px] rounded-full"
          style={{ backgroundColor: color, opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }}
        />
      ))}
    </View>
  );
}

// ── Markdown (assistant = dark on light, user = white on blue) ──────────────

// Leaf text nodes render selectable so long-press selects partial text.
export const selectableRules = {
  text: (node: any, children: any, parent: any, styles: any, inheritedStyles: any = {}) => (
    <Text key={node.key} selectable style={[inheritedStyles, styles.text]}>
      {node.content}
    </Text>
  ),
  // ^ leaf-only selectable is ignored on Android when nested — the selectable
  // must sit on the OUTERMOST Text of each block (one TextView = one
  // selectable unit). textgroup wraps a paragraph's inline spans.
  textgroup: (node: any, children: any, parent: any, styles: any) => (
    <Text key={node.key} selectable style={styles.textgroup}>
      {children}
    </Text>
  ),
  code_block: (node: any, children: any, parent: any, styles: any, inheritedStyles: any = {}) => {
    let { content } = node;
    if (typeof node.content === 'string' && node.content.charAt(node.content.length - 1) === '\n') {
      content = node.content.substring(0, node.content.length - 1);
    }
    return (
      <Text key={node.key} selectable style={[inheritedStyles, styles.code_block]}>
        {content}
      </Text>
    );
  },
  fence: (node: any, children: any, parent: any, styles: any, inheritedStyles: any = {}) => {
    let { content } = node;
    if (typeof node.content === 'string' && node.content.charAt(node.content.length - 1) === '\n') {
      content = node.content.substring(0, node.content.length - 1);
    }
    return (
      <Text key={node.key} selectable style={[inheritedStyles, styles.fence]}>
        {content}
      </Text>
    );
  },
};

export const mdAi = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21, color: '#111' },
  heading1: { fontSize: 20, fontWeight: '700', marginVertical: 6, color: '#111' },
  heading2: { fontSize: 18, fontWeight: '700', marginVertical: 6, color: '#111' },
  heading3: { fontSize: 16, fontWeight: '700', marginVertical: 4, color: '#111' },
  paragraph: { marginVertical: 4 },
  link: { color: '#1a73e8' },
  blockquote: { backgroundColor: '#e8eef7', borderLeftWidth: 3, borderLeftColor: '#1a73e8', paddingHorizontal: 8, paddingVertical: 4 },
  code_inline: { backgroundColor: '#e4e4e8', borderRadius: 4, paddingHorizontal: 4, fontSize: 13 },
  fence: { backgroundColor: '#1e1e24', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  code_block: { backgroundColor: '#1e1e24', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { flexDirection: 'row', marginVertical: 2 },
  bullet_list_content: { flex: 1 },
  ordered_list_content: { flex: 1 },
  hr: { backgroundColor: '#ddd', height: 1, marginVertical: 8 },
  table: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6 },
  th: { padding: 6, fontWeight: '700' },
  td: { padding: 6 },
  tr: { borderBottomWidth: 1, borderColor: '#eee' },
});

export const mdAiDark = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21, color: '#e8e8ea' },
  heading1: { fontSize: 20, fontWeight: '700', marginVertical: 6, color: '#e8e8ea' },
  heading2: { fontSize: 18, fontWeight: '700', marginVertical: 6, color: '#e8e8ea' },
  heading3: { fontSize: 16, fontWeight: '700', marginVertical: 4, color: '#e8e8ea' },
  paragraph: { marginVertical: 4 },
  link: { color: '#7aa7ff' },
  blockquote: { backgroundColor: '#232a3a', borderLeftWidth: 3, borderLeftColor: '#7aa7ff', paddingHorizontal: 8, paddingVertical: 4 },
  code_inline: { backgroundColor: '#2b2b31', borderRadius: 4, paddingHorizontal: 4, fontSize: 13, color: '#e8e8ea' },
  fence: { backgroundColor: '#212121', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  code_block: { backgroundColor: '#212121', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { flexDirection: 'row', marginVertical: 2 },
  bullet_list_content: { flex: 1 },
  ordered_list_content: { flex: 1 },
  hr: { backgroundColor: '#333', height: 1, marginVertical: 8 },
  table: { borderWidth: 1, borderColor: '#333', borderRadius: 6 },
  th: { padding: 6, fontWeight: '700' },
  td: { padding: 6 },
  tr: { borderBottomWidth: 1, borderColor: '#222' },
});

export const mdUser = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21, color: '#fff' },
  heading1: { fontSize: 20, fontWeight: '700', marginVertical: 6, color: '#fff' },
  heading2: { fontSize: 18, fontWeight: '700', marginVertical: 6, color: '#fff' },
  heading3: { fontSize: 16, fontWeight: '700', marginVertical: 4, color: '#fff' },
  paragraph: { marginVertical: 4 },
  link: { color: '#cfe3ff' },
  blockquote: { backgroundColor: 'rgba(255,255,255,.15)', borderLeftWidth: 3, borderLeftColor: '#fff', paddingHorizontal: 8, paddingVertical: 4 },
  code_inline: { backgroundColor: 'rgba(255,255,255,.2)', borderRadius: 4, paddingHorizontal: 4, fontSize: 13, color: '#fff' },
  fence: { backgroundColor: 'rgba(0,0,0,.3)', color: '#fff', borderRadius: 8, padding: 10, fontSize: 13 },
  code_block: { backgroundColor: 'rgba(0,0,0,.3)', color: '#fff', borderRadius: 8, padding: 10, fontSize: 13 },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { flexDirection: 'row', marginVertical: 2 },
  bullet_list_content: { flex: 1 },
  ordered_list_content: { flex: 1 },
  hr: { backgroundColor: 'rgba(255,255,255,.4)', height: 1, marginVertical: 8 },
});
