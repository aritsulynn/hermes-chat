// Narrowing helpers for `unknown` JSON payloads from the ops REST helpers
// (`opsGet`/`opsMut` resolve `unknown` — see services/dashboard.ts).
// Prefer these over `as` casts; they never throw on malformed shapes.

/** The payload as a string-keyed object, or {} when it isn't one. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The payload as an array, or [] when it isn't one. */
export function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** String field of an unknown payload (undefined when missing/not a string). */
export function strField(value: unknown, key: string): string | undefined {
  const v = asRecord(value)[key];
  return typeof v === 'string' ? v : undefined;
}
