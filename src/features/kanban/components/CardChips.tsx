// Card metadata chips: assignee, priority, progress, comments, warnings.
import { memo } from 'react';
import { Badge } from '../../../components/ui/badge';
import { Text as UIText } from '../../../components/ui/text';
import type { KanbanTask } from '../types';

export const CardChips = memo(function CardChips({ t, dark }: { t: KanbanTask; dark: boolean }) {
  const chips: string[] = [];
  if (t.assignee) chips.push(`@${t.assignee}`);
  if (t.priority != null) chips.push(`P${t.priority}`);
  if (t.progress && t.progress.total > 0) chips.push(`✓ ${t.progress.done}/${t.progress.total}`);
  if (t.comment_count) chips.push(`◷ ${t.comment_count}`);
  if (!chips.length && !t.warnings?.count) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <Badge key={c} variant="secondary" className="rounded-md border-transparent px-1.5 py-0.5">
          <UIText className="text-[11px] text-neutral-600 dark:text-neutral-300">{c}</UIText>
        </Badge>
      ))}
      {!!t.warnings?.count && (
        <Badge variant="destructive" className="rounded-md border-transparent px-1.5 py-0.5">
          <UIText className="text-[11px] font-semibold">! {t.warnings.count}</UIText>
        </Badge>
      )}
    </div>
  );
});
