// Card metadata chips: assignee, priority, progress, comments, warnings.
import { Text, View } from 'react-native';
import type { KanbanTask } from '../types';

export function CardChips({ t, dark }: { t: KanbanTask; dark: boolean }) {
  const chips: string[] = [];
  if (t.assignee) chips.push(`@${t.assignee}`);
  if (t.priority != null) chips.push(`P${t.priority}`);
  if (t.progress && t.progress.total > 0) chips.push(`✓ ${t.progress.done}/${t.progress.total}`);
  if (t.comment_count) chips.push(`◷ ${t.comment_count}`);
  if (!chips.length && !t.warnings?.count) return null;
  return (
    <View className="mt-1.5 flex-row flex-wrap gap-1.5">
      {chips.map((c) => (
        <Text
          key={c}
          className="rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-white/10 dark:text-neutral-300"
        >
          {c}
        </Text>
      ))}
      {!!t.warnings?.count && (
        <Text className="rounded-md bg-[#c5221f]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#c5221f] dark:text-[#ff8a8a]">
          ! {t.warnings.count}
        </Text>
      )}
    </View>
  );
}
