// Pure helpers for the live-session map. Kept out of the slice so they are
// testable without pulling in react-native (the store's test glob is
// `src/store/*.test.mjs`, which node runs with no bundler).

/** A live session's state, as reported by `session.active_list`. */
export type LiveStatus = 'working' | 'waiting' | 'starting' | 'idle';

/** Scoped stored id → status. Only non-idle sessions are ever present. */
export type LiveSessionMap = Readonly<Record<string, LiveStatus>>;

/**
 * Whether a status is worth putting a spinner on.
 *
 * The RPC documents exactly three live states plus `idle`, so anything else is
 * an unknown value from a newer server and is left off the row rather than
 * guessed at — a wrong animation on a chat that is not running is worse than
 * no animation.
 */
export function isLiveStatus(status: string): status is Exclude<LiveStatus, 'idle'> {
  return status === 'working' || status === 'waiting' || status === 'starting';
}
