// "Jump to prompt" — the index of every human prompt in the open session.
//
// This is the escape hatch for long transcripts. The chat's own paging grows a
// tail limit and stops at CHAT_HISTORY_MAX_ROWS, so a session longer than that
// reports no more history while thousands of rows sit on the server; this sheet
// lists the prompts so any of them can be opened directly.
import { useEffect } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowUp, ListTree, X } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { Spinner } from '../../../components/ui/bits';
import type { JumpSlice } from '../../../store/useJump';

function stamp(seconds: number | null): string {
  if (seconds == null) return '';
  const d = new Date(seconds * 1000);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function JumpToPromptSheet({ dark, jump, onClose }: { dark: boolean; jump: JumpSlice; onClose: () => void }) {
  const { index, indexLoading, indexError, indexExhausted, loadIndex, jumping, jumpTo } = jump;

  // First open fetches the first page; `loadMore` pages the rest.
  useEffect(() => {
    if (!index && !indexLoading) void loadIndex();
  }, [index, indexLoading, loadIndex]);

  const entries = index?.entries ?? [];
  const total = index?.total ?? 0;

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">Jump to prompt</DialogPrimitive.Title>
          <div className="flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close jump list"
                onClick={onClose}
                className="h-11 w-11 shrink-0 sm:h-11 sm:w-11">
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Button>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-neutral-900 dark:text-white">Jump to prompt</div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  {total > 0 ? `${total} prompt${total === 1 ? '' : 's'} in this conversation` : 'Loading…'}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {indexError ? (
                <div className="px-3 py-6 text-center text-sm text-red-600 dark:text-red-400">{indexError}</div>
              ) : entries.length === 0 && indexLoading ? (
                <div className="flex justify-center py-10">
                  <Spinner size={20} color={dark ? '#bbb' : '#555'} />
                </div>
              ) : entries.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  No prompts in this conversation yet.
                </div>
              ) : (
                <>
                  {/* Newest last, so the list matches how the transcript reads. */}
                  {entries
                    .map((e, i) => ({ e, i }))
                    .reverse()
                    .map(({ e }) => (
                      <button
                        key={e.rowId}
                        type="button"
                        disabled={jumping}
                        aria-label={`Jump to prompt: ${e.preview}`}
                        onClick={() => {
                          void jumpTo(e.rowId).then((ok) => {
                            if (ok) onClose();
                          });
                        }}
                        className="flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-elevated disabled:opacity-50">
                        <ListTree size={15} color={dark ? '#888' : '#999'} className="mt-0.5 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-[13px] text-neutral-900 dark:text-neutral-100">
                            {e.preview}
                          </span>
                          {!!stamp(e.timestamp) && (
                            <span className="mt-0.5 block font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
                              {stamp(e.timestamp)}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  <div className="px-3 py-3 text-center">
                    {indexExhausted ? (
                      <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                        {entries.length === total ? 'All prompts loaded' : `${entries.length} of ${total} loaded`}
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Load older prompts"
                        disabled={indexLoading}
                        onClick={() => void loadIndex({ append: true })}
                        className="rounded-full px-3 py-1.5">
                        {indexLoading ? <Spinner size={14} color={dark ? '#bbb' : '#555'} /> : <ArrowUp size={14} />}
                        <span className="text-xs font-semibold">Older</span>
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
