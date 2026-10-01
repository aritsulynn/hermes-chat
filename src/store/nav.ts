// Navigation bridge.
//
// `expo-router` exposed navigation as a module-level `router` singleton, which
// is why slices could navigate from inside plain callbacks. react-router has no
// equivalent: `useNavigate()` is a hook, so calling it from a WS event handler
// or from a `useCallback` that `openWs` froze would mean threading a navigate
// function through the orchestrator and its dependency arrays — the one thing
// worth never doing here, because `openWs` already closes over ~50 symbols and
// unwinding that is a redesign rather than a refactor.
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
let openDrawer: (() => void) | null = null;

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

/**
 * Open the navigation drawer.
 *
 * The native build got this for free: expo-router's Drawer lives above the
 * screen stack, so any component could call `navigation.openDrawer()` and a
 * swipe gesture opened it too. On the web the drawer is a sibling of the
 * routes rather than an ancestor, so the shell — which owns its open state —
 * registers the trigger here instead.
 *
 * There is no swipe equivalent. A drag-to-open gesture is not something a
 * browser will let a page do, and emulating it in JS is worse than not having
 * it: the hamburger is always visible on every screen, so nothing is lost but
 * the gesture itself.
 */
export function openNavDrawer(): void {
  if (!openDrawer) {
    if (import.meta.env.DEV) console.warn('[nav] no drawer registered yet, dropping openNavDrawer()');
    return;
  }
  openDrawer();
}

export function setDrawerOpener(fn: () => void): void {
  openDrawer = fn;
}
