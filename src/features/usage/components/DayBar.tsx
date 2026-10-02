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
    // `flex flex-col` is load-bearing, not decoration: the bar and its label are
    // stacked, and `items-center` / `justify-end` do nothing without a flex
    // container.
    <button
      type="button"
      onClick={() => onSelect(day)}
      aria-pressed={selected}
      aria-label={`${formatDayLabel(day)}${hasTokens ? `, ${tokens} tokens` : ', no usage'}`}
      className="flex h-full w-7 flex-col items-center justify-end">
      <div
        className={`w-full rounded-t-sm ${
          selected ? 'bg-brand dark:bg-brand/100' : hasTokens ? 'bg-brand' : 'bg-border'
        }`}
        style={{ height: `${heightPercent}%` }}
      />
      <span
        className={`mt-1.5 font-mono text-[9px] ${
          selected
            ? 'font-bold text-brand'
            : hasTokens
              ? 'font-medium text-neutral-700 dark:text-neutral-300'
              : 'text-neutral-400 dark:text-neutral-600'
        }`}>
        {formatDayLabel(day)}
      </span>
    </button>
  );
});
