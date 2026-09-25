// Client-side prompt queue slice.
//
// Prompts typed while a turn is running are held here (text-only) and drained
// one per turn end — see `drainRef`/onComplete. An explicit Stop parks the
// queue until the user queues again or taps Resume (desktop parity).
//
// The ref is authoritative (mutated synchronously) and state mirrors it: two
// drains firing before a re-render must not both pick up the same head.
//
// The queue is written directly from several provider call sites (lifecycle
// resets, Stop parking), so the refs and raw setters are returned to the
// provider as well as the composed operations.
import { useCallback, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { nid } from '../../utils/messages';
import type { QueuedPrompt } from '../../utils/messages';

export interface QueueSliceDeps {
  generatingRef: MutableRefObject<boolean>;
  sendRef: MutableRefObject<((text?: string) => Promise<void>) | null>;
  /** The provider's drain slot; this slice installs the drain implementation. */
  drainRef: MutableRefObject<() => void>;
}

export interface QueueSlice {
  queued: QueuedPrompt[];
  queueParked: boolean;
  queuedRef: MutableRefObject<QueuedPrompt[]>;
  queueParkedRef: MutableRefObject<boolean>;
  setQueued: Dispatch<SetStateAction<QueuedPrompt[]>>;
  setQueueParked: Dispatch<SetStateAction<boolean>>;
  setQueue: (update: (prev: QueuedPrompt[]) => QueuedPrompt[]) => void;
  enqueueQueued: (text: string) => void;
  removeQueued: (id: string) => void;
  clearQueue: () => void;
  resumeQueue: () => void;
  sendQueuedNow: (id: string) => void;
}

export function useQueueSlice({ generatingRef, sendRef, drainRef }: QueueSliceDeps): QueueSlice {
  const [queued, setQueued] = useState<QueuedPrompt[]>([]);
  const [queueParked, setQueueParked] = useState(false);
  const queueParkedRef = useRef(false);
  const queuedRef = useRef<QueuedPrompt[]>([]);
  const queueDrainInFlightRef = useRef(false);

  // Mirror state into the authoritative refs.
  queueParkedRef.current = queueParked;
  queuedRef.current = queued;

  const setQueue = useCallback((update: (prev: QueuedPrompt[]) => QueuedPrompt[]) => {
    queuedRef.current = update(queuedRef.current);
    setQueued(queuedRef.current);
  }, []);

  const enqueueQueued = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      queueParkedRef.current = false;
      setQueueParked(false); // queueing lifts a park
      setQueue((prev) => [...prev, { id: nid(), text: t }]);
      // Idle (parked/unparked) → start immediately; mid-turn → waits for onComplete.
      queueMicrotask(() => drainRef.current());
    },
    [setQueue, drainRef],
  );
  const removeQueued = useCallback((id: string) => setQueue((prev) => prev.filter((q) => q.id !== id)), [setQueue]);
  const clearQueue = useCallback(() => {
    setQueue(() => []);
    queueParkedRef.current = false;
    setQueueParked(false);
  }, [setQueue]);
  const resumeQueue = useCallback(() => {
    queueParkedRef.current = false;
    setQueueParked(false);
    queueMicrotask(() => drainRef.current());
  }, [drainRef]);
  const sendQueuedNow = useCallback(
    (id: string) => {
      queueParkedRef.current = false;
      setQueueParked(false);
      if (generatingRef.current) {
        // Busy — move it to the front; the drain picks it up at turn end.
        setQueue((prev) => {
          const item = prev.find((q) => q.id === id);
          return item ? [item, ...prev.filter((q) => q.id !== id)] : prev;
        });
        return;
      }
      const item = queuedRef.current.find((q) => q.id === id);
      if (!item) return;
      setQueue((prev) => prev.filter((q) => q.id !== id));
      void sendRef.current?.(item.text);
    },
    [setQueue, generatingRef, sendRef],
  );

  // Fresh closure each render so the once-created onComplete handler always
  // drains against current queue/generating state.
  drainRef.current = () => {
    if (queueParkedRef.current || generatingRef.current || queueDrainInFlightRef.current) return;
    const next = queuedRef.current[0];
    if (!next) return;
    queueDrainInFlightRef.current = true;
    let submitted = false;
    void Promise.resolve(sendRef.current?.(next.text))
      .then(() => {
        submitted = true;
      })
      .catch(() => {})
      .finally(() => {
        if (submitted) setQueue((prev) => prev.filter((q) => q.id !== next.id));
        queueDrainInFlightRef.current = false;
        if (submitted && !queueParkedRef.current && !generatingRef.current) drainRef.current();
      });
  };

  return {
    queued,
    queueParked,
    queuedRef,
    queueParkedRef,
    setQueued,
    setQueueParked,
    setQueue,
    enqueueQueued,
    removeQueued,
    clearQueue,
    resumeQueue,
    sendQueuedNow,
  };
}
