// React bindings for the app store mirror (see external-store.ts).
//
//   import { useAppSelector } from '../store/useAppSelector';
//   const generating = useAppSelector((s) => s.generating);
//
// Additive: `useApp()` still returns the whole context value and every
// existing consumer keeps working. Use this only where a component wants to
// depend on a slice *instead* of the whole store.
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { appStore, createSelectionReader } from './external-store.ts';
import type { AppEqualityFn, AppSelector } from './external-store.ts';
import type { AppStore } from './types';

/**
 * Subscribe to one slice of the app store: the component re-renders when that
 * slice changes, not on every `setState` in the provider.
 *
 * Selectors that allocate (objects, `filter`/`map` results) need an `isEqual`
 * — the value is a new object on every read, and without `isEqual` that looks
 * like a change and React re-renders forever:
 *
 *   const { messages, generating } = useAppSelector(
 *     (s) => ({ messages: s.messages, generating: s.generating }),
 *     (a, b) => a.messages === b.messages && a.generating === b.generating,
 *   );
 */
export function useAppSelector<S>(selector: AppSelector<S>, isEqual?: AppEqualityFn<S>): S {
  const getSelection = useMemo(
    () => createSelectionReader(appStore, selector, isEqual),
    [selector, isEqual],
  );
  return useSyncExternalStore(appStore.subscribe, getSelection, getSelection);
}

/**
 * Mirror the provider's context value into the external store. Called by
 * AppProvider on every render; not a hook consumers should use.
 *
 * The dirty flag lives in the store rather than in this render's closure, so a
 * render that never commits cannot swallow the notification for the next one.
 */
export function useAppStorePublish(value: AppStore): void {
  appStore.write(value);
  useLayoutEffect(() => appStore.flush());
}
