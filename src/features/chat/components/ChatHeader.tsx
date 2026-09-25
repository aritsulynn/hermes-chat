// Chat top bar — the normal header and the in-transcript search header.
// Extracted from index.tsx to keep the screen focused on orchestration.
import { Text, TextInput, View } from 'react-native';
import { ChevronDown, ChevronUp, MoreVertical, Search, X } from 'lucide-react-native';
import { CtxRing, HamburgerBtn, Tap } from '../../../components';

export function ChatNormalHeader({
  insetTop,
  dark,
  iconColor,
  title,
  contextPercent,
  contextTone,
  onOpenSearch,
  onOpenMenu,
  onOpenInfo,
}: {
  insetTop: number;
  dark: boolean;
  iconColor: string;
  title: string;
  contextPercent: number | null;
  contextTone: 'ok' | 'warn' | 'hot';
  onOpenSearch: () => void;
  onOpenMenu: () => void;
  onOpenInfo: () => void;
}) {
  return (
    <View
      style={{
        height: insetTop + 52,
        paddingTop: insetTop,
        backgroundColor: dark ? '#000' : '#fff',
      }}
    >
      <View className="h-[52px] flex-row items-center gap-1 px-2">
        <View className="w-11 shrink-0 items-start">
          <HamburgerBtn />
        </View>
        <Text
          numberOfLines={1}
          className="min-w-0 flex-1 px-1 text-[17px] font-semibold text-neutral-950 dark:text-neutral-100"
        >
          {title}
        </Text>
        <View className="flex-row items-center gap-1">
          {contextPercent != null && (
            <CtxRing pct={contextPercent} tone={contextTone} dark={dark} onPress={onOpenInfo} />
          )}
          <Tap
            testID="search-open"
            accessibilityRole="button"
            accessibilityLabel="Search conversation"
            onPress={onOpenSearch}
            hitSlop={2}
            radius={20}
            className="h-10 w-10 items-center justify-center"
          >
            <Search size={20} color={iconColor} />
          </Tap>
          <Tap
            testID="kebab-btn"
            accessibilityRole="button"
            accessibilityLabel="Chat menu"
            onPress={onOpenMenu}
            hitSlop={2}
            radius={20}
            className="h-10 w-10 items-center justify-center"
          >
            <MoreVertical size={20} color={iconColor} />
          </Tap>
        </View>
      </View>
    </View>
  );
}

export function ChatSearchHeader({
  insetTop,
  dark,
  iconColor,
  query,
  matchIndex,
  matchCount,
  onChangeQuery,
  onPrevious,
  onNext,
  onClose,
}: {
  insetTop: number;
  dark: boolean;
  iconColor: string;
  query: string;
  matchIndex: number;
  matchCount: number;
  onChangeQuery: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const hasQuery = query.trim().length > 0;
  const disabledColor = dark ? '#666' : '#aaa';
  return (
    <View
      style={{
        height: insetTop + 52,
        paddingTop: insetTop,
        backgroundColor: dark ? '#000' : '#fff',
      }}
    >
      <View className="h-[52px] flex-row items-center gap-1 px-2">
        <View className="min-w-0 flex-1 flex-row items-center gap-1">
          <View className="h-11 min-w-0 flex-1 flex-row items-center rounded-xl border border-neutral-200 bg-[#f4f4f6] px-3 dark:border-neutral-700 dark:bg-[#212121]">
            <Search size={18} color={dark ? '#aaa' : '#666'} />
            <TextInput
              testID="conversation-search"
              accessibilityLabel="Search conversation"
              className="ml-2 min-w-0 flex-1 bg-transparent px-0 py-0 text-[16px] text-neutral-950 dark:text-neutral-100"
              value={query}
              onChangeText={onChangeQuery}
              placeholder="Search conversation…"
              placeholderTextColor={dark ? '#888' : '#9ca3af'}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              keyboardAppearance={dark ? 'dark' : 'light'}
              returnKeyType="search"
              selectionColor="#1a73e8"
              onSubmitEditing={onNext}
            />
            {hasQuery && (
              <Text className="ml-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                {matchCount ? matchIndex + 1 : 0}/{matchCount}
              </Text>
            )}
          </View>
          <Tap
            testID="search-prev"
            accessibilityRole="button"
            accessibilityLabel="Previous search match"
            onPress={onPrevious}
            disabled={!matchCount}
            hitSlop={2}
            radius={16}
            className="h-11 w-10 items-center justify-center"
          >
            <ChevronUp size={20} color={matchCount ? iconColor : disabledColor} />
          </Tap>
          <Tap
            testID="search-next"
            accessibilityRole="button"
            accessibilityLabel="Next search match"
            onPress={onNext}
            disabled={!matchCount}
            hitSlop={2}
            radius={16}
            className="h-11 w-10 items-center justify-center"
          >
            <ChevronDown size={20} color={matchCount ? iconColor : disabledColor} />
          </Tap>
        </View>
        <Tap
          testID="search-close"
          accessibilityRole="button"
          accessibilityLabel="Close conversation search"
          onPress={onClose}
          hitSlop={2}
          radius={20}
          className="h-11 w-10 items-center justify-center"
        >
          <X size={22} color={iconColor} />
        </Tap>
      </View>
    </View>
  );
}
