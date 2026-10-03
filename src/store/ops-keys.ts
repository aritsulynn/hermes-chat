// Pure leaves of the ops-query layer — no imports on purpose.
//
// `ops-query.ts` pulls in React and the whole store, so Node's type-stripping
// test runner cannot import it (it also resolves `./useAppStore` extensionless,
// and that file is .tsx). These two functions are the parts worth pinning down,
// and keeping them here means they can be tested at all — the same reason
// `services/constants.ts` is a leaf.

/**
 * Root of every ops cache key. The connection scope is appended by the hooks in
 * `./ops-query`, so callers only ever name their own part: `opsKey('webhooks')`.
 */
export const opsKey = (...parts: readonly unknown[]): readonly unknown[] => ['ops', ...parts];

/**
 * True for the one error that is not a failure.
 *
 * `opsGet`/`opsMut` throw `'Connection superseded'` when the connection or
 * profile epoch moved while the request was in flight. The request was fine — it
 * just answered a question nobody is asking any more — so it must not render as
 * an error and must not be retried. Every screen used to check this itself;
 * `webhooks` alone did it eight times.
 */
export function isSuperseded(e: unknown): boolean {
  return e instanceof Error && e.message === 'Connection superseded';
}
