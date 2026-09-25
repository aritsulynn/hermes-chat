// Collapsible prompt preview for a cron job (clamped to 3 lines).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

export function JobPromptPreview({
  prompt,
  isExpanded,
  onToggleExpand,
}: {
  prompt: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const [canExpand, setCanExpand] = useState(() => {
    // Only true initially if there are explicitly more than 3 newline breaks
    return prompt.split('\n').length > 3;
  });
  const textRef = useRef<any>(null);

  const checkOverflow = useCallback(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const measure = () => {
        const el = textRef.current as HTMLElement | null;
        if (el && !isExpanded) {
          const isClamped = el.scrollHeight > el.clientHeight + 1;
          setCanExpand(isClamped);
        }
      };
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(measure);
      } else {
        setTimeout(measure, 0);
      }
    }
  }, [isExpanded]);

  useEffect(() => {
    checkOverflow();
  }, [prompt, isExpanded, checkOverflow]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('resize', checkOverflow);
      return () => window.removeEventListener('resize', checkOverflow);
    }
  }, [checkOverflow]);

  return (
    <View className="mt-3 rounded-xl bg-white/80 p-2.5 dark:bg-neutral-950/60">
      <Text
        ref={textRef}
        numberOfLines={isExpanded ? undefined : 3}
        onLayout={checkOverflow}
        onTextLayout={(e) => {
          if (Platform.OS !== 'web') {
            const hasMoreLines = e.nativeEvent.lines.length > 3;
            setCanExpand(hasMoreLines);
          }
        }}
        className="text-xs leading-relaxed text-neutral-800 dark:text-neutral-200"
      >
        {prompt}
      </Text>
      {canExpand && (
        <Pressable onPress={onToggleExpand} hitSlop={8} className="mt-1.5 flex-row items-center justify-end gap-1">
          <Text className="text-[10px] font-medium text-[#1a73e8] dark:text-[#7aa7ff]">
            {isExpanded ? 'Collapse' : 'Show more'}
          </Text>
          {isExpanded ? <ChevronUp size={12} color="#1a73e8" /> : <ChevronDown size={12} color="#1a73e8" />}
        </Pressable>
      )}
    </View>
  );
}
