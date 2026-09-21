import type * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Brain, Check, Cog, Copy } from 'lucide-react-native';
import { cleanThinking, flattenLists } from '../utils/messages';
import type { UiMessage } from '../utils/messages';
import { TypingDots } from './bits';
import { mdAi, mdAiDark, mdUser, selectableRules } from './markdown';

export function MessageBubble({
  item,
  bubbleMax,
  dark,
  expanded,
  highlight,
  longFired,
  onToggleExpand,
  copiedId,
  onCopy,
}: {
  item: UiMessage;
  bubbleMax: number;
  dark: boolean;
  expanded: boolean;
  highlight?: boolean;
  longFired: React.MutableRefObject<boolean>;
  onToggleExpand: (id: string) => void;
  copiedId: string | null;
  onCopy: (id: string, text: string) => void;
}) {
  const think = item.role === 'thinking';
  const typing = !think && item.pending && !item.text;
  const markdown =
    !think && item.role !== 'notice' && item.role !== 'interim' && item.role !== 'tool';
  const copyable = (item.role === 'user' || item.role === 'assistant') && !!item.text && !item.pending;
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
      }${highlight ? ' border-2 border-[#1a73e8]' : ''}`}
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
              onToggleExpand(item.id);
            }}
            onLongPress={() => {
              longFired.current = true;
            }}
          >
            <View className="flex-row items-start gap-1.5">
              <Brain size={14} color={dark ? '#999' : '#777'} />
              <Text
                selectable={!!expanded}
                className="shrink text-[13px] leading-[18px] text-neutral-500 dark:text-neutral-400"
                numberOfLines={expanded ? undefined : 1}
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
            onToggleExpand(item.id);
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
              selectable={!!expanded}
              className="shrink text-[13px] leading-[18px] text-[#3b5bdb] dark:text-[#8fa8ff]"
              numberOfLines={expanded ? undefined : 2}
            >
              {item.text}
              {item.detail && expanded ? `\n${item.detail}` : ''}
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
        <Pressable onPress={() => onCopy(item.id, item.text)} className="mt-1 flex-row items-center gap-1 self-end px-0.5 py-0.5" hitSlop={6}>
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
}
