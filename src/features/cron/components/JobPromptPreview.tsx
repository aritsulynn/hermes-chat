// Collapsible prompt preview for a cron job (clamped to 3 lines).
//
// `canExpand` is measured, not guessed: the element's own scrollHeight against
// its clientHeight is the only thing that knows whether the clamp is actually
// hiding text. The native build had a second path counting rendered lines via
// onTextLayout; there is no such event on the web and the measurement already
// covered it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export function JobPromptPreview({
  prompt,
  isExpanded,
  onToggleExpand,
}: {
  prompt: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const [canExpand, setCanExpand] = useState(() => prompt.split('\n').length > 3);
  const textRef = useRef<HTMLDivElement>(null);

  const checkOverflow = useCallback(() => {
    const measure = () => {
      const el = textRef.current;
      if (el && !isExpanded) {
        setCanExpand(el.scrollHeight > el.clientHeight + 1);
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
    else setTimeout(measure, 0);
  }, [isExpanded]);

  useEffect(() => {
    checkOverflow();
  }, [prompt, isExpanded, checkOverflow]);

  useEffect(() => {
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [checkOverflow]);

  return (
    <div className="mt-3 rounded-xl bg-white/80 p-2.5 dark:bg-neutral-950/60">
      <div
        ref={textRef}
        className={`text-xs leading-relaxed text-neutral-800 dark:text-neutral-200 ${
          isExpanded ? '' : 'line-clamp-3'
        }`}>
        {prompt}
      </div>
      {canExpand && (
        <button type="button" onClick={onToggleExpand} aria-expanded={isExpanded} className="mt-1.5 flex w-full items-center justify-end gap-1">
          <span className="text-[10px] font-medium text-[#1a73e8] dark:text-[#7aa7ff]">
            {isExpanded ? 'Collapse' : 'Show more'}
          </span>
          {isExpanded ? <ChevronUp size={12} color="#1a73e8" /> : <ChevronDown size={12} color="#1a73e8" />}
        </button>
      )}
    </div>
  );
}
