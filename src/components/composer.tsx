import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Image, Keyboard, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowUp,
  ChevronDown,
  Paperclip,
  Plus,
  Square,
  X,
} from 'lucide-react-native';

import type { Attachment } from '../utils/messages';
import { reasoningLabel } from '../utils/reasoning';

// How a control reports its position for a screen-level popover. The popover
// lives in the chat screen (not here) so it can float above the list and still
// receive taps — on Android touches outside a parent's bounds are dropped.
// ChatScreen re-invokes the measure fn when the layout shifts (keyboard).
export type AnchorRect = { x: number; y: number; w: number; h: number };
export type AnchorMeasure = (cb: (a: AnchorRect) => void) => void;

const measurer = (ref: { current: View | null }): AnchorMeasure => (cb) => {
  ref.current?.measureInWindow((x, y, w, h) => cb({ x, y, w, h }));
};

// memo(): every streamed token re-renders the chat screen. Without this the
// focused TextInput re-renders ~30×/s, which on Android is enough to drop the
// keyboard mid-sentence. All props must therefore be referentially stable —
// see the useCallback'd handlers in ChatScreen and send() in the store.
export const Composer = memo(function Composer({
  input,
  setInput,
  send,
  stop,
  onRedirect,
  onQueue,
  generating,
  scrollEnd,
  model,
  modelProvider,
  onOpenModelPicker,
  effort,
  effortWire,
  showEffort,
  onOpenEffortPicker,
  onOpenAttachPicker,
  attachments,
  setAttachments,
  dark,
}: {
  input: string;
  setInput: (v: string) => void;
  send: () => void;
  stop: () => void;
  onRedirect: (text: string) => void;
  /** Hold the draft for the next turn while one is running. */
  onQueue: (text: string) => void;
  generating: boolean;
  scrollEnd: () => void;
  model: string;
  modelProvider: string;
  onOpenModelPicker: (measure: AnchorMeasure) => void;
  effort: string;
  /** Wire level the route actually sends (clamp display, e.g. Ultra→Max). */
  effortWire?: string;
  /** Hidden when the current model reports no reasoning support. */
  showEffort: boolean;
  onOpenEffortPicker: (measure: AnchorMeasure) => void;
  onOpenAttachPicker: (measure: AnchorMeasure) => void;
  attachments: Attachment[];
  setAttachments: (v: Attachment[]) => void;
  /** Theme comes in as a prop — a store subscription here would defeat memo(). */
  dark: boolean;
}) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const plusRef = useRef<View>(null);
  const modelRef = useRef<View>(null);
  const effortRef = useRef<View>(null);

  // Web only: while a turn streams, something outside the composer (a portal
  // teardown, a DOM rebuild) can drop focus out of the text field mid-draft —
  // the user has to click back in. If nothing else claimed focus, take it back.
  // A deliberate click on a button/link/other input leaves THAT element
  // focused, so this never fights the user.
  const handleBlur = useCallback(() => {
    if (Platform.OS !== 'web' || !generating) return;
    requestAnimationFrame(() => {
      const node = inputRef.current;
      const active = (globalThis as any).document?.activeElement as Element | null | undefined;
      if (!node || (active && active !== (globalThis as any).document?.body)) return;
      node.focus();
    });
  }, [generating]);
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
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKbOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const canSend = !!input.trim() || attachments.length > 0;
  const modelLabel = modelProvider ? `${modelProvider}:${model}` : model;
  return (
    <View className="border-t border-neutral-200 dark:border-neutral-700 bg-white dark:bg-black px-2.5 pt-2" style={{ paddingBottom: webKb > 0 ? webKb + 10 : kbOpen ? 10 : Math.max(insets.bottom, 10) }}>
      <View className="gap-1.5 rounded-2xl bg-[#f4f4f6] dark:bg-[#212121] px-2.5 pb-2 pt-2">
        {generating && (
          <Text className="px-1.5 text-xs text-amber-700 dark:text-amber-400">
            live — Queue holds · Steer ↪ corrects · ■ stops
          </Text>
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
          ref={inputRef}
          className="max-h-[180px] min-h-[64px] px-1.5 py-2.5 text-[15px] text-neutral-950 dark:text-neutral-100"
          value={input}
          onChangeText={setInput}
          placeholder={generating ? 'Type to steer the running turn' : 'Type a message'}
          placeholderTextColor={dark ? '#888' : '#9ca3af'}
          keyboardAppearance={dark ? 'dark' : 'light'}
          multiline
          textAlignVertical="top"
          editable
          returnKeyType="default"
          // Enter inserts a line break. "blurAndSubmit" used to fire on every
          // Return: a multi-line draft was sent (or steered) mid-typing and the
          // keyboard closed under the user. Send/Steer are explicit buttons now.
          submitBehavior="newline"
          onFocus={() => setTimeout(() => scrollEnd(), 100)}
          onBlur={handleBlur}
        />
        {/* The model chip is the only shrinkable item: without it the row (plus
            + chip + effort + Steer + stop/send) is wider than a phone screen and
            spills past the right edge. */}
        <View className="flex-row items-center gap-1.5">
          <Pressable
            ref={plusRef}
            onPress={() => onOpenAttachPicker(measurer(plusRef))}
            className="h-8 w-8 shrink-0 items-center justify-center rounded-full"
            hitSlop={8}
          >
            <Plus size={20} color={dark ? '#a3a3a3' : '#555'} />
          </Pressable>
          <Pressable
            ref={modelRef}
            onPress={() => onOpenModelPicker(measurer(modelRef))}
            className="min-w-0 max-w-[170px] shrink rounded-lg bg-[#e8e8ec] px-2 py-1.5 dark:bg-[#272727]"
            hitSlop={8}
          >
            <View className="flex-row items-center gap-0.5">
              <Text className="shrink text-[13px] font-semibold text-neutral-700 dark:text-neutral-200" numberOfLines={1}>
                {modelLabel}
              </Text>
              <ChevronDown size={14} color={dark ? '#d4d4d4' : '#333'} />
            </View>
          </Pressable>
          {showEffort && (
            <Pressable
              ref={effortRef}
              onPress={() => onOpenEffortPicker(measurer(effortRef))}
              className="shrink-0 rounded-lg px-2 py-1.5"
              hitSlop={8}
            >
              <Text className="text-[13px] font-semibold text-neutral-500 dark:text-neutral-400">
                {reasoningLabel(effort, effortWire)}
              </Text>
            </Pressable>
          )}
          <View className="flex-1" />
          {generating ? (
            <>
              {!!input.trim() && !attachments.length && (
                <Pressable
                  onPress={() => onQueue(input)}
                  className="shrink-0 items-center rounded-lg bg-[#1a73e8] px-2 py-1.5"
                  hitSlop={8}
                >
                  <Text className="text-[13px] font-semibold text-white">Queue</Text>
                </Pressable>
              )}
              {!!input.trim() && (
                <Pressable
                  onPress={() => onRedirect(input)}
                  className="shrink-0 items-center rounded-lg border border-neutral-300 px-2 py-1.5 dark:border-neutral-700"
                  hitSlop={8}
                >
                  <Text className="text-[13px] font-semibold dark:text-neutral-100">Steer ↪</Text>
                </Pressable>
              )}
              <Pressable
                onPress={stop}
                className="h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#c5221f]"
              >
                <Square size={14} color="#fff" fill="#fff" />
              </Pressable>
            </>
          ) : (
            <Pressable onPress={send} className={`h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1a73e8] ${!canSend ? 'opacity-40' : ''}`} disabled={!canSend}>
              <ArrowUp size={20} color="#fff" />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
});
