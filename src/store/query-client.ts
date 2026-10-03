// The TanStack Query client, and the scope-aware wrappers the ops screens use.
//
// ── Why a cache at all ───────────────────────────────────────────────────────
// Every ops screen (webhooks, pairing, profiles, keys, plugins, …) fetches the
// same shape of thing on mount: GET one or two endpoints, normalise the payload,
// render. They each implemented that by hand, and each hand-rolled copy had the
// same four pieces of state (loading / refreshing / error / data) plus a race
// guard, because `opsGet` closes over a host + cookie that can change mid-flight.
//
// ── The scope is the whole point ─────────────────────────────────────────────
// `opsGet`/`opsMut` throw `'Connection superseded'` when the connection or
// profile epoch moved on while the request was in flight. Before this cache,
// each screen caught that and compared `getAuthScope()` itself — 8 separate
// checks in webhooks alone. Putting the scope in the query key makes that
// structural: a different connection is a different key, so a superseded
// response can never be rendered under a new one, and the old entry is simply
// garbage collected.
//
// Note what the scope does and does not cover. It is
// `${connectionEpoch}:${profileEpoch}` — two counters that bump on logout, on
// auth expiry, and on a profile switch. It does NOT include host/username, but
// it does not need to: reaching the login screen requires logout (the screen
// redirects to /chat while authed, see features/login), and logout bumps the
// epoch. So a scope change is always a hard boundary.
//
// ── Defaults ─────────────────────────────────────────────────────────────────
// staleTime 30s: these are admin dashboards, not a chat transcript. Someone
// opening two screens in a row should not pay for two round trips, but a
// manual refresh button still has to feel instant — hence `refetchOnMount` and
// `refetchOnWindowFocus` off by default and the screens call `refetch()`.
//
// retry: 1, not the default 3. A gateway that is down should say so once. Three
// silent retries against an unreachable LAN host is a 30-second spinner.
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
