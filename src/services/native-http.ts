// Native HTTP pipe (Android WebView bypass).
//
// The app runs on http://localhost while the gateway is a user-supplied LAN
// host, and the gateway's session cookie is `SameSite=lax`. A WebView will
// never attach that cookie to a cross-origin fetch — that is the cookie's own
// contract, not a flag we forgot. So on native we skip the browser network
// stack: this module forwards the request (headers exactly as given, including
// our explicit `Cookie` header from the JS jar) to the NativeHttp plugin and
// returns every response header, including each `Set-Cookie`, for the JS jar
// to merge. CORS is equally absent on this path — a failure here is a real
// network failure, never a masked 401 (compare the missing ACAO headers on
// the gateway's error responses, which is what made the WebView report
// "Failed to fetch" for an unauthenticated ticket request).
//
// Web is untouched: `nativeHttpAvailable()` is false there and callers fall
// back to `fetch`. Electron later gets the same choice — either this pipe (if
// its shell forbids the cookies) or plain fetch.
import { registerPlugin } from '@capacitor/core';
import { isNativeShell } from '../platform';

export interface NativeHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
}

export interface NativeHttpResult {
  status: number;
  /** Lowercased header names → all values (Set-Cookie survives intact). */
  headers: Record<string, string[]>;
  body: string;
}

interface NativeHttpPlugin {
  request(options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string | null;
    timeoutMs: number;
  }): Promise<{ status: number; headers: Record<string, string | string[]>; body: string }>;
}

const NativeHttp = registerPlugin<NativeHttpPlugin>('NativeHttp');

/** True only inside a native shell whose WebView build ships the plugin. */
export function nativeHttpAvailable(): boolean {
  try {
    if (!isNativeShell()) return false;
    // `isPluginAvailable` is absent on older runtimes — the direct call below
    // is still guarded by try/catch at every use site.
    return true;
  } catch {
    return false;
  }
}

/** Every `Set-Cookie` value the response carried (possibly empty). */
export function nativeSetCookies(headers: Record<string, string[]>): string[] {
  const hit = Object.entries(headers).find(([name]) => name.toLowerCase() === 'set-cookie');
  return hit ? hit[1] : [];
}

export async function nativeRequest(req: NativeHttpRequest): Promise<NativeHttpResult> {
  let raw: { status: number; headers: Record<string, string | string[]>; body: string };
  try {
    raw = await NativeHttp.request({
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: req.body,
      timeoutMs: req.timeoutMs,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/timed?\s*out/i.test(msg)) throw new Error(`Request timed out (${req.timeoutMs / 1000}s): ${req.url}`);
    throw new Error(msg);
  }
  const headers: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(raw.headers ?? {})) {
    headers[name.toLowerCase()] = Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return { status: Number(raw.status), headers, body: String(raw.body ?? '') };
}
