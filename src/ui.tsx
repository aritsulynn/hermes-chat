// Shared UI bits — Composer, Field, bottom sheets (via @gorhom/bottom-sheet),
// TypingDots, markdown rules/styles and the global StyleSheet.
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Platform,
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
  MessageSquare,
  Paperclip,
  Plus,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react-native';
import { EFFORTS, parseClarify } from './models';
import type { Attachment } from './models';
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
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={3}>
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
  }
>(function InfoSheet({ onClose, title, model, provider, info, usage, usageLoading }, ref) {
  const snapPoints = useMemo(() => ['60%', '90%'], []);
  return (
    <BottomSheetModal
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
    >
      <BottomSheetScrollView contentContainerStyle={styles.sheet}>
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle}>Session info</Text>
        </View>
        <InfoRow label="Title" value={title} />
        <InfoRow label="Model" value={typeof info?.model === 'string' && info.model ? info.model : model} />
        <InfoRow
          label="Provider"
          value={typeof info?.provider === 'string' && info.provider ? info.provider : provider || undefined}
        />
        <InfoRow label="CWD" value={typeof info?.cwd === 'string' ? info.cwd : undefined} />
        <Text style={styles.sheetSub}>Usage</Text>
        {usageLoading ? (
          <Text style={styles.sub}>loading…</Text>
        ) : (
          <Text style={styles.code}>{usage ? JSON.stringify(usage, null, 2) : '—'}</Text>
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
          <View style={styles.titleRow}>
            <MessageSquare size={18} color="#111" />
            <Text style={styles.sheetTitle}>Clarify</Text>
          </View>
          {questions.map((q) => (
            <View key={q.qid} style={styles.qBlock}>
              {!!q.question && <Text style={styles.qText}>{q.question}</Text>}
              <View style={styles.chips}>
                {q.choices.map((c) => {
                  const on = (picked[q.qid] ?? []).includes(c);
                  return (
                    <Pressable key={c} onPress={() => toggle(q.qid, c, q.multiSelect)} style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {q.choices.length === 0 && (
                <TextInput
                  style={styles.sheetInput}
                  value={text}
                  onChangeText={setText}
                  placeholder="พิมพ์คำตอบ…"
                  multiline
                />
              )}
            </View>
          ))}
          <View style={styles.sheetRow}>
            <Pressable onPress={submitAll} style={styles.primary}>
              <Text style={styles.primaryText}>Send answer</Text>
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
          <View style={styles.titleRow}>
            <TriangleAlert size={18} color="#111" />
            <Text style={styles.sheetTitle}>Allow command?</Text>
          </View>
          {!!cmd && <Text style={styles.code}>{cmd}</Text>}
          {!!ask.params.preview && <Text style={styles.qText}>{String(ask.params.preview)}</Text>}
          <View style={styles.chips}>
            {choices.map((c) => (
              <Pressable key={c} onPress={() => onApproval(c)} style={[styles.chip, c === 'deny' && styles.chipDeny]}>
                <Text style={styles.chipText}>{c}</Text>
              </Pressable>
            ))}
          </View>
        </>
      );
    }

    // Sudo / secret / vault / GUI reads — single masked string under "value".
    const sheetIcon =
      m === 'sudo' ? (
        <KeyRound size={18} color="#111" />
      ) : m === 'secret' || m.startsWith('vault.') ? (
        <Lock size={18} color="#111" />
      ) : (
        <Info size={18} color="#111" />
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
        <View style={styles.titleRow}>
          {sheetIcon}
          <Text style={styles.sheetTitle}>{label}</Text>
        </View>
        {!!ask.params.command && <Text style={styles.code}>{String(ask.params.command)}</Text>}
        <TextInput
          style={styles.sheetInput}
          value={text}
          onChangeText={setText}
          placeholder="…"
          secureTextEntry
          autoFocus
        />
        <View style={styles.sheetRow}>
          <Pressable onPress={() => onValue('')} style={styles.smallBtn}>
            <Text>Skip</Text>
          </Pressable>
          <Pressable onPress={() => onValue(text)} style={styles.primary}>
            <Text style={styles.primaryText}>Send</Text>
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
      <BottomSheetView style={styles.sheet}>{renderBody()}</BottomSheetView>
    </BottomSheetModal>
  );
});

// ── Bits ─────────────────────────────────────────────────────────────────────

export function Composer({
  input,
  setInput,
  send,
  stop,
  generating,
  scrollEnd,
  model,
  modelProvider,
  providers,
  providersLoading,
  providersError,
  onOpenModelPicker,
  onPickModel,
  effort,
  setEffort,
  attachments,
  setAttachments,
}: {
  input: string;
  setInput: (v: string) => void;
  send: () => void;
  stop: () => void;
  generating: boolean;
  scrollEnd: () => void;
  model: string;
  modelProvider: string;
  providers: ModelProviderOption[];
  providersLoading: boolean;
  providersError: string | null;
  onOpenModelPicker: () => void;
  onPickModel: (providerSlug: string, modelId: string) => void;
  effort: string;
  setEffort: (v: string) => void;
  attachments: Attachment[];
  setAttachments: (v: Attachment[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState<null | 'plus' | 'model' | 'effort'>(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
    <View style={[styles.composerWrap, { paddingBottom: kbOpen ? 10 : Math.max(insets.bottom, 10) }]}>
      <View style={styles.composerCard}>
        {attachments.length > 0 && (
          <View style={styles.attachRow}>
            {attachments.map((a) => (
              <Pressable
                key={a.uri + a.name}
                onPress={() => setAttachments(attachments.filter((x) => x.uri !== a.uri))}
                style={styles.attachChip}
              >
                <Paperclip size={12} color="#1a73e8" />
                <Text style={styles.attachText} numberOfLines={1}>
                  {a.name}
                </Text>
                <X size={12} color="#1a73e8" />
              </Pressable>
            ))}
          </View>
        )}
        <TextInput
          style={styles.composerInput}
          value={input}
          onChangeText={setInput}
          placeholder="พิมพ์ข้อความ…"
          multiline
          editable={!generating}
          returnKeyType="send"
          blurOnSubmit={false}
          submitBehavior="blurAndSubmit"
          onFocus={() => setTimeout(() => scrollEnd(), 100)}
          onSubmitEditing={send}
        />
        <View style={styles.toolbar}>
          <Pressable onPress={() => setMenu('plus')} style={styles.toolBtn} hitSlop={8}>
            <Plus size={20} color="#555" />
          </Pressable>
          <Pressable onPress={() => setMenu('model')} style={styles.modelBtn} hitSlop={8}>
            <View style={styles.modelBtnInner}>
              <Text style={styles.modelBtnText} numberOfLines={1}>
                {modelLabel}
              </Text>
              <ChevronDown size={14} color="#333" />
            </View>
          </Pressable>
          <Pressable onPress={() => setMenu('effort')} style={styles.effortBtn} hitSlop={8}>
            <Text style={styles.effortText}>{effort}</Text>
          </Pressable>
          <View style={styles.flex} />
          {generating ? (
            <Pressable onPress={stop} style={[styles.send, styles.stop]}>
              <Square size={14} color="#fff" fill="#fff" />
            </Pressable>
          ) : (
            <Pressable onPress={send} style={[styles.send, !canSend && styles.disabled]} disabled={!canSend}>
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
        <BottomSheetScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
            {menu === 'plus' && (
              <>
                <Text style={styles.sheetTitle}>แนบ</Text>
                <Pressable onPress={pickImage} style={[styles.menuItem, styles.titleRow]}>
                  <ImageIcon size={18} color="#111" />
                  <Text style={styles.menuText}>รูปภาพ</Text>
                </Pressable>
                <Pressable onPress={pickFile} style={[styles.menuItem, styles.titleRow]}>
                  <FileText size={18} color="#111" />
                  <Text style={styles.menuText}>ไฟล์</Text>
                </Pressable>
              </>
            )}
            {menu === 'model' && (
              <>
                <View style={styles.sheetHead}>
                  <Text style={styles.sheetTitle}>Switch model (this chat)</Text>
                </View>
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search models and providers…"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {providersLoading && <Text style={styles.sub}>loading models…</Text>}
                {!!providersError && <Text style={styles.err}>{providersError}</Text>}
                {visibleProviders.map((p) => {
                  const count = p.models?.length ?? p.totalModels;
                  const open = q ? true : (expanded[p.slug] ?? false);
                  return (
                    <View key={p.slug || p.name}>
                      <Pressable
                        onPress={() => setExpanded((e) => ({ ...e, [p.slug]: !(e[p.slug] ?? false) }))}
                        style={styles.provRow}
                      >
                        <Text style={styles.provName}>{p.name}</Text>
                        <Text style={styles.provCount}>
                          {count} model{count === 1 ? '' : 's'}
                        </Text>
                        {open ? (
                          <ChevronDown size={16} color="#666" />
                        ) : (
                          <ChevronRight size={16} color="#666" />
                        )}
                      </Pressable>
                      {open &&
                        (p.models ?? []).map((mm) => {
                          const on = mm === model && p.slug === modelProvider;
                          return (
                            <Pressable
                              key={mm}
                              onPress={() => {
                                onPickModel(p.slug, mm);
                                setMenu(null);
                              }}
                              style={[styles.modelRow, on && styles.menuItemOn]}
                            >
                              <Text style={[styles.menuText, on && styles.menuTextOn]} numberOfLines={1}>
                                {on ? '● ' : '○ '}{mm}
                              </Text>
                            </Pressable>
                          );
                        })}
                      {open && !p.models && (
                        <Text style={styles.sub}>list unavailable — pull to refresh on server</Text>
                      )}
                    </View>
                  );
                })}
                {visibleProviders.length === 0 && !providersLoading && (
                  <Text style={styles.sub}>no matches</Text>
                )}
              </>
            )}
            {menu === 'effort' && (
              <>
                <Text style={styles.sheetTitle}>Thinking effort</Text>
                <View style={styles.effortRow}>
                  {EFFORTS.map((e) => (
                    <Pressable
                      key={e}
                      onPress={() => {
                        setEffort(e);
                        setMenu(null);
                      }}
                      style={[styles.effortSeg, e === effort && styles.effortSegOn]}
                    >
                      <Text style={[styles.effortSegText, e === effort && styles.effortSegTextOn]}>{e}</Text>
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
  if (!secure) {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          style={styles.fieldInput}
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
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.passWrap}>
        <TextInput
          style={[styles.fieldInput, styles.passInput]}
          value={value}
          onChangeText={onChange}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable onPress={() => setVisible((v) => !v)} style={styles.eyeBtn} hitSlop={8}>
          <Text style={styles.eyeText}>{visible ? 'Hide' : 'Show'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function TypingDots({ dim }: { dim?: boolean }) {
  const d1 = useRef(new Animated.Value(0)).current;
  const d2 = useRef(new Animated.Value(0)).current;
  const d3 = useRef(new Animated.Value(0)).current;
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
  const color = dim ? '#bbb' : '#999';
  return (
    <View style={styles.typingRow}>
      {[d1, d2, d3].map((d, i) => (
        <Animated.View
          key={i}
          style={[
            styles.typingDot,
            { backgroundColor: color, opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) },
          ]}
        />
      ))}
    </View>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  boot: { justifyContent: 'center', alignItems: 'center', gap: 12 },
  loginWrap: { flex: 1, justifyContent: 'center', padding: 24, gap: 4 },
  appTitle: { fontSize: 32, fontWeight: '800' },
  sub: { color: '#666', marginBottom: 16 },
  field: { marginBottom: 10 },
  label: { fontSize: 12, color: '#666', marginBottom: 2 },
  fieldInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  passWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
    paddingRight: 4,
  },
  passInput: { flex: 1, borderWidth: 0 },
  eyeBtn: { paddingHorizontal: 10, paddingVertical: 9 },
  eyeText: { fontSize: 14, fontWeight: '600', color: '#1a73e8' },
  primary: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  disabled: { opacity: 0.4 },
  err: { color: '#c5221f', marginTop: 10 },
  hint: { color: '#999', fontSize: 12, marginTop: 12, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  bubbleText: { flexShrink: 1 },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#ddd', borderRadius: 8 },
  backBtn: { paddingHorizontal: 8, paddingVertical: 8, justifyContent: 'center' },
  drawerTitle: { fontSize: 22, fontWeight: '800' },
  drawerSub: { fontSize: 12, color: '#666', marginTop: 2 },
  drawerConn: { fontSize: 12, color: '#666', marginTop: 2, marginBottom: 4 },
  pad: { padding: 14 },
  listPad: { padding: 12, gap: 8 },
  sessCard: { borderWidth: 1, borderColor: '#e3e3e6', borderRadius: 12, padding: 12 },
  sessRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sessTitle: { fontWeight: '600', fontSize: 15 },
  sessMeta: { color: '#888', fontSize: 12, marginTop: 2 },
  sessPrev: { color: '#555', fontSize: 13, marginTop: 4 },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  user: { alignSelf: 'flex-end', backgroundColor: '#1a73e8' },
  ai: { alignSelf: 'flex-start', backgroundColor: '#f0f0f2' },
  interim: { alignSelf: 'flex-start', backgroundColor: '#fff8e1', borderWidth: 1, borderColor: '#f0e0a0' },
  notice: { alignSelf: 'center', backgroundColor: '#fdecea' },
  msg: { fontSize: 15, lineHeight: 21, color: '#111' },
  userMsg: { color: '#fff' },
  think: { alignSelf: 'flex-start', backgroundColor: '#f7f7f9', borderWidth: 1, borderColor: '#e2e2e6' },
  thinkMsg: { fontSize: 13, lineHeight: 18, color: '#777' },
  toolBubble: { alignSelf: 'flex-start', backgroundColor: '#eef3fd', borderWidth: 1, borderColor: '#d3e1f8' },
  toolMsg: { fontSize: 13, lineHeight: 18, color: '#3b5bdb' },
  typingRow: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 2 },
  typingDot: { width: 7, height: 7, borderRadius: 3.5 },
  tool: { fontSize: 12, color: '#666', paddingHorizontal: 14, paddingBottom: 4 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
    maxHeight: 120,
  },
  composerWrap: {
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    backgroundColor: '#fff',
  },
  composerCard: {
    backgroundColor: '#f4f4f6',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
  composerInput: {
    fontSize: 15,
    maxHeight: 120,
    paddingHorizontal: 6,
    paddingVertical: 6,
    color: '#111',
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelBtn: { maxWidth: 170, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: '#e8e8ec' },
  modelBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  modelBtnText: { fontSize: 13, color: '#333', fontWeight: '600', flexShrink: 1 },
  effortBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 },
  effortText: { fontSize: 13, color: '#666', fontWeight: '600' },
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  attachChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#e8eef7', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 220 },
  attachText: { fontSize: 12, color: '#1a73e8', flexShrink: 1 },
  infoRow: { flexDirection: 'row', gap: 8, paddingVertical: 3 },
  infoLabel: { width: 72, fontSize: 13, color: '#888' },
  infoValue: { flex: 1, fontSize: 14, color: '#111' },
  menuItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f2' },
  menuItemOn: { backgroundColor: '#f4f8ff' },
  menuText: { fontSize: 15, color: '#111' },
  menuTextOn: { color: '#1a73e8', fontWeight: '700' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  searchInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  provRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f2' },
  provName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#111' },
  provCount: { fontSize: 13, color: '#666' },
  modelRow: { paddingVertical: 10, paddingLeft: 16, borderBottomWidth: 1, borderBottomColor: '#f5f5f7' },
  effortRow: { flexDirection: 'row', gap: 6 },
  effortSeg: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  effortSegOn: { backgroundColor: '#1a73e8', borderColor: '#1a73e8' },
  effortSegText: { fontSize: 13, color: '#333', fontWeight: '600' },
  effortSegTextOn: { color: '#fff' },
  copyBtn: { alignSelf: 'flex-end', marginTop: 4, paddingHorizontal: 2, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 4 },
  copyText: { fontSize: 11, fontWeight: '600' },
  copyTextUser: { color: 'rgba(255,255,255,.75)' },
  copyTextAi: { color: '#999' },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a73e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: { backgroundColor: '#c5221f' },
  sheet: { backgroundColor: '#fff', padding: 16, gap: 10 },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  sheetSub: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  sheetRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, alignItems: 'center' },
  sheetInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 15 },
  qBlock: { gap: 6 },
  qText: { fontSize: 14, color: '#333' },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, backgroundColor: '#f4f4f6', padding: 8, borderRadius: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#1a73e8', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: '#1a73e8' },
  chipText: { color: '#1a73e8', fontSize: 14 },
  chipTextOn: { color: '#fff' },
  chipDeny: { borderColor: '#c5221f' },
});

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
