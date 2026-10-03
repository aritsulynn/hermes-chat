// Scope-aware hooks over TanStack Query.
//
// Screens should not import `useQuery` directly. Two reasons, both of which are
// the reason this file exists:
//
//  1. The query key MUST carry the connection scope. `opsGet` throws
//     'Connection superseded' when the epoch moved mid-flight; without the scope
//     in the key a superseded response lands in the cache and renders under the
//     new connection. Putting the scope in the key makes that unrepresentable.
//
//  2. `opsGet`/`opsMut` come from the store, not from a module, and they change
//     identity with host/username. Reading them through one hook means the key
//     and the fetcher can never disagree about which connection they belong to.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Query, QueryClient, UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { useApp } from './useAppStore';
import { isSuperseded, opsKey } from './ops-keys';
import type { OpsGet, OpsMut, OpsResult } from './types';

export { isSuperseded, opsKey };

/**
 * Deliberately narrower than TanStack's own result type.
 *
 * `error` is `Error | null` here rather than the discriminated union's
 * non-nullable `Error`, because nulling a superseded fetch is the whole reason
 * this hook exists. Handing back the full result would let a screen reach for
 * `isPlaceholderData` or `dataUpdatedAt` without this file knowing; the surface
 * is the five fields an ops screen actually uses, and adding one is a
 * deliberate act.
 */
export interface OpsQueryResult<T> {
  data: T | undefined;
  /** Null when the fetch was superseded — see `isSuperseded`. */
  error: Error | null;
  /** True before this key has produced data. */
  isPending: boolean;
  /** True while a refetch is in flight over data already on screen. */
  isRefetching: boolean;
  refetch: () => Promise<unknown>;
}

/** What `onMutate` hands back so a failed write can put the old value back. */
interface Rollback<T> {
  previous: T | undefined;
}

/**
 * One ops GET.
 *
 * `get` fetches, `select` normalises — that is where the per-screen
 * `asRecord` / row-filtering helpers move to. They were `useState` setters
 * before, which is exactly why they had no tests; as `select` they are pure
 * functions over a payload and can be.
 *
 * Two ways to say what `data` is, and both are checked somewhere:
 *  - with `select`, TData is inferred from `select`'s return — the screen's own
 *    normaliser, which is a pure function and therefore testable;
 *  - without it, the caller passes TData explicitly and `get` is responsible for
 *    it, which holds because the ops service functions all declare their return
 *    type (`getWebhooks(): Promise<WebhooksState>`).
 *
 * The cast is confined to this one place and is what lets those two styles share
 * a signature; nothing else in the app touches the query client directly.
 *
 * `error` comes back nulled when it is a superseded fetch, so a screen can
 * render it directly instead of re-implementing the check that webhooks alone
 * used to do eight times.
 */
export function useOpsQuery<TData = OpsResult>(options: {
  key: readonly unknown[];
  get: (opsGet: OpsGet) => Promise<OpsResult>;
  select?: (raw: OpsResult) => TData;
  enabled?: boolean;
  /**
   * Poll interval in ms — replaces the hand-rolled `setInterval` + load.
   *
   * The function form is TanStack's own, for a poll that stops on its own
   * condition: it reads the query, so "keep polling while this action is still
   * running" needs no interval effect and no cancelled flag. `false` disables.
   */
  refetchInterval?: number | false | ((query: Query<OpsResult, Error>) => number | false);
}): OpsQueryResult<TData> {
  const { opsGet, getAuthScope } = useApp();
  const scope = getAuthScope();
  const { select, ...rest } = options;
  const query = useQuery({
    queryKey: [...opsKey(...options.key), scope],
    queryFn: () => rest.get(opsGet),
    ...(select ? { select } : {}),
    ...(rest.enabled != null ? { enabled: rest.enabled } : {}),
    ...(rest.refetchInterval != null ? { refetchInterval: rest.refetchInterval } : {}),
  }) as UseQueryResult<TData, Error>;
  return {
    data: query.data,
    error: isSuperseded(query.error) ? null : query.error,
    isPending: query.isPending,
    isRefetching: query.isRefetching,
    refetch: () => query.refetch(),
  };
}

/**
 * One ops mutation.
 *
 * `done` invalidates the keys it changed — the replacement for the
 * `await load(true)` tail every handler used to end with — and it is scoped, so
 * it only ever invalidates the current connection's entries. `onSuccess` is
 * awaited after that refetch settles, so a caller that needs the fresh rows
 * (kanban re-anchors its open detail sheet on them) can read them back out of
 * the cache.
 *
 * `optimistic` paints the cache before the request leaves and restores it if the
 * request fails. That is the whole reason the old screens carried hand-written
 * `setState(flip)` / `setState(flip back)` pairs next to every toggle.
 */
export function useOpsMutation<TData, TVars = void, TCached = unknown>(options: {
  mutationFn: (opsMut: OpsMut, vars: TVars) => Promise<TData>;
  /** Key parts (no scope) to invalidate once it succeeds. */
  done?: readonly unknown[][];
  optimistic?: {
    key: readonly unknown[];
    patch: (current: TCached | undefined, vars: TVars) => TCached;
  };
  onSuccess?: (data: TData, vars: TVars, client: QueryClient) => void | Promise<void>;
  onError?: (error: unknown, vars: TVars) => void;
}): UseMutationResult<TData, Error, TVars> {
  const { opsMut, getAuthScope } = useApp();
  const scope = getAuthScope();
  const client = useQueryClient();
  const fullKey = (key: readonly unknown[]) => [...opsKey(...key), scope];
  return useMutation<TData, Error, TVars, Rollback<TCached> | undefined>({
    mutationFn: (vars: TVars) => options.mutationFn(opsMut, vars),
    onMutate: (vars: TVars) => {
      if (!options.optimistic) return undefined;
      const key = fullKey(options.optimistic.key);
      const previous = client.getQueryData<TCached>(key);
      client.setQueryData<TCached>(key, options.optimistic.patch(previous, vars));
      return { previous };
    },
    onSuccess: async (data, vars) => {
      await Promise.all((options.done ?? []).map((key) => client.invalidateQueries({ queryKey: fullKey(key) })));
      await options.onSuccess?.(data, vars, client);
    },
    onError: (error, vars, rollback) => {
      if (isSuperseded(error)) return;
      // Put the pre-write value back so a rejected toggle does not leave the
      // switch showing a state the server never accepted.
      if (options.optimistic && rollback) client.setQueryData(fullKey(options.optimistic.key), rollback.previous);
      options.onError?.(error, vars);
    },
  });
}
