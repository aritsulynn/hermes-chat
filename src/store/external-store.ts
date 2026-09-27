// External store mirror of the app state.
//
// `useApp()` hands out the whole AppContext value, so every store consumer
// re-renders on every `setState` — the drawer, the header and every screen
// wake up for a keystroke in the composer. Streaming already got its own
// context for that reason; this is the same idea for the rest of the store: a
// component subscribes to a slice (see useAppSelector) and stays put while the
// rest of the app churns.
//
// It is a *mirror*, not a second source of truth. AppProvider keeps owning the
// state and renders exactly what it rendered before — it just also publishes
// the assembled value here (useAppStorePublish).
//
// Publishing is two-phase on purpose. `write` runs in the render phase, so a
// reader in the same pass already sees the fresh value and a component using
// both `useApp()` and `useAppSelector()` renders once instead of twice. `flush`
// runs on commit and is the only place subscribers are notified: notifying
// during another component's render is not allowed, and the commit phase is the
// earliest legal point.
import type { AppStore } from './types';

export type StoreListener = () => void;
/** Picks the slice of the store a component cares about. */
export type AppSelector<S> = (store: AppStore) => S;
export type AppEqualityFn<S> = (a: S, b: S) => boolean;

export interface ExternalStore<T> {
  /** Latest published value, or undefined before the first publish. */
  getSnapshot(): T | undefined;
  /** Adopt a new value. Render phase — never notifies. */
  write(value: T): void;
  /** Commit phase — notifies subscribers iff `write` changed the value. */
  flush(): void;
  subscribe(listener: StoreListener): () => void;
}

export function createExternalStore<T>(): ExternalStore<T> {
  let snapshot: T | undefined;
  let dirty = false;
  const listeners = new Set<StoreListener>();
  return {
    getSnapshot: () => snapshot,
    write(value: T) {
      if (Object.is(snapshot, value)) return;
      snapshot = value;
      dirty = true;
    },
    flush() {
      if (!dirty) return;
      dirty = false;
      for (const listener of listeners) listener();
    },
    subscribe(listener: StoreListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app store mirror. Written by AppProvider, read by useAppSelector. */
export const appStore: ExternalStore<AppStore> = createExternalStore<AppStore>();

/**
 * Cached `selector(store)`, the `getSnapshot` a `useSyncExternalStore`
 * subscription needs. React reads it several times per render and again after
 * every notification, so it must hand back the *same* reference until the
 * selected slice really changes — otherwise React re-renders forever.
 *
 * The cache lives in this closure, so the hook rebuilds it only when
 * `selector`/`isEqual` change. Select a stored reference or a primitive and the
 * result is stable on its own; a selector that allocates (`s => ({ ... })`,
 * `s.todos.filter(...)`) needs `isEqual`, otherwise the fresh object identity
 * reads as a change on every call.
 */
export function createSelectionReader<S>(
  store: ExternalStore<AppStore>,
  selector: AppSelector<S>,
  isEqual?: AppEqualityFn<S>,
): () => S {
  let primed = false;
  let lastStore: AppStore | undefined;
  let lastSelection: S;
  return () => {
    const current = store.getSnapshot();
    if (!current) throw new Error('useAppSelector must be used inside AppProvider');
    if (primed && Object.is(current, lastStore)) return lastSelection;
    const next = selector(current);
    if (primed && isEqual !== undefined && isEqual(lastSelection, next)) {
      // Newer store, equal slice: keep the selection the caller already has.
      lastStore = current;
      return lastSelection;
    }
    primed = true;
    lastStore = current;
    lastSelection = next;
    return next;
  };
}
