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
import type { UseMutationResult } from '@tanstack/react-query';

import { useApp } from './useAppStore';
import { isSuperseded, opsKey } from './ops-keys';
import type { OpsGet, OpsMut, OpsResult } from './types';

export { isSuperseded, opsKey };

/**
 * One ops GET. `select` normalises the payload, which is where the per-screen
 * `asRecord` / row-filtering helpers move to — that logic is pure and already
 * tested, so it does not change, it just stops being a `useState` setter.
 *
 * `error` comes back nulled when it is a superseded fetch, so a screen can
 * render `error` directly without every call site re-implementing the check
 * that `webhooks` alone used to do eight times.
 */
// TData is inferred from `select` alone, never from `get`: `get` returns the raw
// OpsResult, so letting it drive inference would collapse every normalised
// screen type back to `{}`.
export function useOpsQuery<TData = OpsResult>(options: {
  key: readonly unknown[];
  get: (opsGet: OpsGet) => Promise<OpsResult>;
  select?: (raw: OpsResult) => TData;
  enabled?: boolean;
  /** Poll interval in ms — replaces the hand-rolled `setInterval` + load. */
  refetchInterval?: number | false;
}) {
  const { opsGet, getAuthScope } = useApp();
  const scope = getAuthScope();
  const query = useQuery({
    queryKey: [...opsKey(...options.key), scope],
    queryFn: () => options.get(opsGet),
    ...(options.select ? { select: options.select } : {}),
    ...(options.enabled != null ? { enabled: options.enabled } : {}),
    ...(options.refetchInterval != null ? { refetchInterval: options.refetchInterval } : {}),
  });
  return { ...query, error: isSuperseded(query.error) ? null : query.error };
}

/**
 * One ops mutation. `done` invalidates the keys it changed — that is the
 * replacement for the `await load(true)` tail every handler used to end with,
 * and it is scoped, so it only ever invalidates the current connection's
 * entries. `onSuccess` is awaited after that refetch settles, so a caller that
 * needs the fresh rows (kanban re-anchors its open detail sheet on them) can
 * read them back out of the cache.
 */
export function useOpsMutation<TData, TVars = void>(options: {
  mutationFn: (opsMut: OpsMut, vars: TVars) => Promise<TData>;
  /** Key parts (no scope) to invalidate once it succeeds. */
  done?: readonly unknown[][];
  onSuccess?: (data: TData, vars: TVars, client: ReturnType<typeof useQueryClient>) => void | Promise<void>;
  onError?: (error: unknown, vars: TVars) => void;
}): UseMutationResult<TData, unknown, TVars> {
  const { opsMut, getAuthScope } = useApp();
  const scope = getAuthScope();
  const client = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    mutationFn: (vars: TVars) => options.mutationFn(opsMut, vars),
    onSuccess: async (data, vars) => {
      await Promise.all(
        (options.done ?? []).map((key) => client.invalidateQueries({ queryKey: [...opsKey(...key), scope] })),
      );
      await options.onSuccess?.(data, vars, client);
    },
    onError: (error) => {
      if (isSuperseded(error)) return;
      options.onError?.(error, undefined as TVars);
    },
  });
}
