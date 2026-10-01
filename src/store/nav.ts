// Navigation bridge.
//
// The store slices route themselves from WebSocket callbacks and boot effects,
// where no hook is available: `useNavigate()` is a hook, so calling it from a
// WS event handler or from a `useCallback` that `openWs` froze would mean
// threading a navigate function through the orchestrator and its dependency
// arrays — the one thing worth never doing here, because `openWs` already
// closes over ~50 symbols and unwinding that is a redesign rather than a
// refactor.
//
// So this module exposes a module-level `navigate()`. The shell (which *is*
// inside the Router) registers the real navigator once, and everything else
// calls `navigate()`.
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
 * The shell owns the drawer's open state, so it registers the trigger here and
 * every screen header's hamburger calls this. The mobile shell additionally
 * opens it from a left-edge swipe (see `use-edge-swipe`), which calls the
 * sidebar state directly rather than coming through here.
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

/**
 * Whether the shell is showing its persistent sidebar.
 *
 * The shell owns this — it is the only component that knows the breakpoint and
 * the open state. But the hamburger that has to get out of the way while the
 * sidebar is up lives in every screen's header, far below the shell, which is
 * the same distance problem `openNavDrawer` solves. So it gets the same answer:
 * a module singleton the shell writes and the headers subscribe to.
 *
 * This is deliberately *not* `openDrawer` above. That is a command; this is a
 * state, and the overlay drawer on a narrow screen must not hide the hamburger
 * (the hamburger is underneath the overlay anyway, and closing it is the
 * overlay's own job).
 */
let sidebarShown = false;
const sidebarListeners = new Set<() => void>();

export function setSidebarShown(shown: boolean): void {
  if (sidebarShown === shown) return;
  sidebarShown = shown;
  for (const listener of sidebarListeners) listener();
}

export function subscribeSidebarShown(listener: () => void): () => void {
  sidebarListeners.add(listener);
  return () => {
    sidebarListeners.delete(listener);
  };
}

export function getSidebarShown(): boolean {
  return sidebarShown;
}
