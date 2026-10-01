
import * as React from 'react';
import { CircleCheck, TriangleAlert, X } from 'lucide-react';

type ToastVariant = 'default' | 'destructive' | 'success';

type ToastData = {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
};

const DURATION_MS = 4000;
const MAX_VISIBLE = 3;

let seq = 0;
let queue: ToastData[] = [];
const listeners = new Set<(next: ToastData[]) => void>();

function publish() {
  const snapshot = [...queue];
  listeners.forEach((l) => l(snapshot));
}

/** Auto-dismissing. Safe to call from anywhere; no hooks, no provider. */
export function toast(input: { title: string; description?: string; variant?: ToastVariant }) {
  const item: ToastData = { id: ++seq, variant: 'default', ...input };
  // Keep the stack short: a burst of failures should not bury the screen.
  queue = [...queue, item].slice(-MAX_VISIBLE);
  publish();
  setTimeout(() => toast.dismiss(item.id), DURATION_MS);
  return item.id;
}

toast.dismiss = (id: number) => {
  const next = queue.filter((t) => t.id !== id);
  if (next.length === queue.length) return;
  queue = next;
  publish();
};

function useToasts() {
  const [list, setList] = React.useState<ToastData[]>(queue);
  React.useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}

function ToastItem({
  title,
  description,
  variant,
  onDismiss,
}: Omit<ToastData, 'id'> & { onDismiss: () => void }) {
  const Icon = variant === 'destructive' ? TriangleAlert : CircleCheck;
  const iconColor = variant === 'destructive' ? '#ef4444' : variant === 'success' ? '#10b981' : '#888888';
  return (
    <button
      type="button"
      onClick={onDismiss}
      // Errors interrupt; everything else is announced politely. `role` maps to
      // the matching ARIA live region.
      role={variant === 'destructive' ? 'alert' : 'status'}
      aria-live={variant === 'destructive' ? 'assertive' : 'polite'}
      aria-label={description ? `${title}. ${description}` : title}
      className="flex w-full max-w-[420px] animate-[toast-in_220ms_ease-out] items-start gap-2.5 rounded-xl border border-neutral-200 bg-white px-3.5 py-3 text-left shadow-lg shadow-black/10 dark:border-neutral-700 dark:bg-[#1c1c1e]">
      <span className="mt-0.5">
        <Icon size={17} color={iconColor} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`text-[14px] font-semibold ${
            variant === 'destructive'
              ? 'text-red-600 dark:text-red-400'
              : 'text-neutral-950 dark:text-neutral-100'
          } line-clamp-2`}>
          {title}
        </span>
        {!!description && (
          <span
            className="mt-0.5 text-[13px] leading-[18px] text-neutral-600 dark:text-neutral-300 line-clamp-3">
            {description}
          </span>
        )}
      </span>
      <span className="mt-0.5">
        <X size={15} color={iconColor} />
      </span>
    </button>
  );
}

/** Mount once, last in the root layout. Renders nothing while idle. */
export function ToastHost() {
  const list = useToasts();
  if (!list.length) return null;
  return (
    // `pointer-events-none` on the stack so it never swallows a click meant for
    // the screen underneath; each row opts back in.
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4"
      // Clears the home indicator via the browser-reported safe area.
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
      {list.map((t) => (
        <div key={t.id} className="pointer-events-auto w-full max-w-[420px]">
          <ToastItem
            title={t.title}
            description={t.description}
            variant={t.variant}
            onDismiss={() => toast.dismiss(t.id)}
          />
        </div>
      ))}
    </div>
  );
}
