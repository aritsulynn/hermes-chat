import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Keyboard, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Plus,
  Square,
  X,
} from 'lucide-react-native';
import { EFFORTS } from '../models';
import type { Attachment } from '../models';
import { useApp } from '../store';
import { RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder } from 'expo-audio';
import type { ModelProviderOption } from '../dashboard';
import { renderBackdrop } from './sheets';

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
  // Mobile browsers don't resize the layout for the virtual keyboard and
  // KeyboardAvoidingView is a no-op on web — track the visual viewport
  // shrink instead and pad the composer above the keyboard manually.
  const [webKb, setWebKb] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const vv = (window as any).visualViewport;
    if (!vv) return;
    const onResize = () => {
      const gap = window.innerHeight - vv.height - (vv.offsetTop ?? 0);
      setWebKb(Math.max(0, Math.round(gap)));
    };
    onResize();
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);
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
    <View className="border-t border-neutral-200 dark:border-neutral-700 bg-white dark:bg-black px-2.5 pt-2" style={{ paddingBottom: webKb > 0 ? webKb + 10 : kbOpen ? 10 : Math.max(insets.bottom, 10) }}>
      <View className="gap-1.5 rounded-2xl bg-[#f4f4f6] dark:bg-[#212121] px-2.5 pb-2 pt-2">
        {generating && (
          <Text className="px-1.5 text-xs text-amber-700 dark:text-amber-400">● live — พิมพ์แล้วกด Steer ↪ เพื่อหักพวงมาลัย</Text>
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
          placeholderTextColor={dark ? '#888' : '#9ca3af'}
          keyboardAppearance={dark ? 'dark' : 'light'}
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
            <Mic size={20} color={recording ? '#c5221f' : dark ? '#a3a3a3' : '#555'} />
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
            <Text className="text-[13px] font-semibold text-neutral-500 dark:text-neutral-400">{effort}</Text>
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
        backgroundStyle={{ backgroundColor: dark ? '#000' : '#fff' }}
        handleIndicatorStyle={{ backgroundColor: dark ? '#525252' : '#d4d4d4' }}
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
                  placeholderTextColor={dark ? '#888' : '#9ca3af'}
                  keyboardAppearance={dark ? 'dark' : 'light'}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {providersLoading && <Text className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">loading models…</Text>}
                {!!providersError && <Text className="mt-2.5 text-[#c5221f] dark:text-[#ff7b72]">{providersError}</Text>}
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
                        <Text className="text-[13px] text-neutral-500 dark:text-neutral-400">
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
                        <Text className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">list unavailable — pull to refresh on server</Text>
                      )}
                    </View>
                  );
                })}
                {visibleProviders.length === 0 && !providersLoading && (
                  <Text className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">no matches</Text>
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
