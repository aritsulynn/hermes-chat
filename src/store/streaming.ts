// The live-token buffer.
//
// While a turn streams, the gateway sends deltas at roughly 30Hz. Routing those
// through React state re-renders every consumer of that state on every delta,
// which is why this app used to (a) keep the buffer in a separate context so
// only the chat re-rendered, and (b) coalesce deltas in the WebSocket client
// into 50ms windows — and that 50ms window is what capped the visible text at
// 20 updates a second, i.e. what made streaming look steppy.
//
// So the buffer is an external store with a subscription per message id. A
// delta now wakes exactly the one bubble it belongs to, the transport can hand
// every token straight through, and the steady cadence the reader sees comes
// from the reveal ticker (see components/chat/use-smooth-text.ts).
export interface StreamingStore {
  /** Current streamed text for one id. Non-reactive. */
  read(id: string): string;
  /** Append a delta and wake that id's subscribers. */
  push(id: string, delta: string): void;
  /** Every id at once, for the end-of-turn fold into the durable transcript. */
  snapshot(): Record<string, string>;
  /** Total characters across every id, for the display-only token estimate. */
  totalChars(): number;
  /** Drop everything, waking each id once. */
  clear(): void;
  /** Follow one id. */
  subscribe(id: string, listener: () => void): () => void;
  /** Follow every id, for an aggregate readout. */
  subscribeAll(listener: () => void): () => void;
}

export function createStreamingStore(): StreamingStore {
  const texts = new Map<string, string>();
  const listeners = new Map<string, Set<() => void>>();
  const watchers = new Set<() => void>();

  const wake = (id: string) => {
    const set = listeners.get(id);
    if (set) for (const listener of [...set]) listener();
    for (const listener of [...watchers]) listener();
  };

  return {
    read: (id) => texts.get(id) ?? '',
    push: (id, delta) => {
      if (!delta) return;
      texts.set(id, (texts.get(id) ?? '') + delta);
      wake(id);
    },
    snapshot: () => Object.fromEntries(texts),
    totalChars: () => {
      let n = 0;
      for (const text of texts.values()) n += text.length;
      return n;
    },
    clear: () => {
      if (texts.size === 0) return;
      const ids = [...texts.keys()];
      texts.clear();
      for (const id of ids) wake(id);
    },
    subscribe: (id, listener) => {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(id);
      };
    },
    subscribeAll: (listener) => {
      watchers.add(listener);
      return () => {
        watchers.delete(listener);
      };
    },
  };
}
