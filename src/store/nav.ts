// Navigation bridge.
//
// `expo-router` exposed navigation as a module-level `router` singleton, which
// is why slices could navigate from inside plain callbacks. react-router has no
// equivalent: `useNavigate()` is a hook, so calling it from a WS event handler
// or from a `useCallback` that `openWs` froze would mean threading a navigate
// function through the orchestrator and its dependency arrays — the one thing
// AGENTS.md explicitly warns against, because `openWs` already closes over ~50
// symbols.
//
// So this module reproduces the singleton shape on purpose. The provider (which
// *is* inside the Router) registers the real navigator once, and everything
// else calls `navigate()`.
//
// A `navigate` before registration is a real bug — it means something tried to
// route during boot before the shell mounted — so it warns in dev rather than
// silently doing nothing, matching how connection.ts treats storage failures.

type NavigateFn = (to: string, options?: { replace?: boolean }) => void;

let navigator: NavigateFn | null = null;

export function setNavigator(fn: NavigateFn): void {
  navigator = fn;
}

export function navigate(to: string, options?: { replace?: boolean }): void {
  if (!navigator) {
    if (import.meta.env.DEV) console.warn(`[nav] no navigator registered yet, dropping navigate("${to}")`);
    return;
  }
  navigator(to, options);
}
