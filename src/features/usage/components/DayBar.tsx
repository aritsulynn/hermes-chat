import { Text as UIText } from '../../../components/ui/text';
// Memo bar — selecting one day shouldn't re-render the other 89 bars.
import { memo } from 'react';
import { formatDayLabel } from '../../../utils/format';

export const DayBar = memo(function DayBar({
  day,
  tokens,
  maxTokens,
  selected,
  onSelect,
}: {
  day: string;
  tokens: number;
  maxTokens: number;
  selected: boolean;
  onSelect: (day: string) => void;
}) {
  const hasTokens = tokens > 0;
  const heightPercent = hasTokens ? Math.max(12, Math.round((tokens / maxTokens) * 100)) : 4;
  return (
    <button type="button" onClick={() => onSelect(day)} className="items-center justify-end w-7 h-full">
      <div
        className={`w-full rounded-t-sm ${
          selected
            ? 'bg-blue-600 dark:bg-blue-500'
            : hasTokens
              ? 'bg-[#1a73e8] dark:bg-[#7aa7ff]'
              : 'bg-neutral-200 dark:bg-neutral-800'
        }`}
        style={{ height: `${heightPercent}%` }}
      />
      <UIText
        className={`mt-1.5 font-mono text-[9px] ${
          selected
            ? 'font-bold text-blue-600 dark:text-blue-400'
            : hasTokens
              ? 'text-neutral-700 dark:text-neutral-300 font-medium'
              : 'text-neutral-400 dark:text-neutral-600'
        }`}
      >
        {formatDayLabel(day)}
      </UIText>
    </button>
  );
});
