// App shell: the navigation drawer and the fixed chrome around every screen.
//
// The drawer is a Radix Dialog (overlay on narrow screens) and the same panel
// rendered in flow as a sidebar on wide ones. Its `navigate` and opener live as
// module-level bridges in store/nav.ts, because the store slices route
// themselves from WebSocket callbacks and boot effects where hooks are not
// available.
import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useApp, useThemeValue } from './hooks/app-store';
import { useMediaQuery } from './hooks/use-viewport';
import { setDrawerOpener, setNavigator, setSidebarShown } from './store/nav';
import { ConnectionBanner } from './components/connection-banner';
import { HermesDrawerContent } from './components/drawer/HermesDrawerContent';
import { NavRail } from './components/drawer/NavRail';
import { FilePreviewHost } from './components/chat/media';
import { ToastHost } from './components/ui/toast';
import { screenBg } from './theme';

/**
 * The width at which the drawer stops being an overlay and becomes a sidebar.
 * At 768px the chat still gets a real column beside the 300px panel, and the
 * sidebar can be collapsed.
 */
const SIDEBAR_MIN_WIDTH = 768;

export function AppShell() {
  const { theme } = useThemeValue();
  // `booting` is the store restoring the session from the browser's cookie jar.
  const { booting } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  // Read during render, so the first paint is already in the right mode.
  const isWide = useMediaQuery(`(min-width: ${SIDEBAR_MIN_WIDTH}px)`);
  // One piece of state for both modes: "is the panel showing". `isWide` decides
  // which one is rendered, so they cannot both be up.
  const [panelOpen, setPanelOpen] = useState(isWide);

  // Hand the two bridges their real implementations. They are module-level
  // singletons because their callers cannot use hooks (see store/nav.ts).
  useEffect(() => {
    setNavigator((to, options) => navigate(to, { replace: options?.replace }));
    setDrawerOpener(() => setPanelOpen(true));
  }, [navigate]);

  // Crossing the breakpoint resets to that mode's default, so pulling a wide
  // window narrow does not leave the panel up as an overlay over the chat.
  useEffect(() => {
    setPanelOpen(isWide);
  }, [isWide]);

  // Tell the headers whether the sidebar is up, so their toggle steps aside.
  // On a wide screen the rail is always present (collapsed or not), so the
  // header toggle always steps aside there and the rail carries the expand.
  useEffect(() => {
    setSidebarShown(isWide);
  }, [isWide]);

  // A route change dismisses the overlay. The sidebar is not an overlay:
  // closing it on every nav tap would make it useless for moving between
  // screens.
  useEffect(() => {
    if (!isWide) setPanelOpen(false);
  }, [location.pathname, isWide]);

  const onOpenChange = useCallback((open: boolean) => setPanelOpen(open), []);

  return (
    <div className="flex h-full flex-col" style={{ background: screenBg(theme === 'dark') }}>
      <div className="flex min-h-0 flex-1">
        {/* Wide screens always have a left panel: the full drawer when open, a
            narrow icon rail when collapsed. */}
        {isWide &&
          (panelOpen ? (
            <div
              className="flex w-[300px] shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800"
              data-testid="sidebar">
              <HermesDrawerContent open persistent onOpenChange={onOpenChange} />
            </div>
          ) : (
            <NavRail onExpand={() => setPanelOpen(true)} />
          ))}

        <DialogPrimitive.Root open={!isWide && panelOpen} onOpenChange={onOpenChange}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
            <DialogPrimitive.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[85vw] flex-col shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <HermesDrawerContent open={panelOpen} onOpenChange={onOpenChange} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        {/* Full width so the screen header sits flush to the window edge and
            the transcript's scrollbar rides the real right edge. The reading
            column is narrowed inside each screen instead (see the chat
            transcript and `mx-auto max-w-*` content wrappers). `min-w-0` lets
            this flex item shrink below its content width. */}
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Withheld until the store finishes restoring the session, so a
              deep-linked screen does not see `authed === false` during boot and
              bounce through /login. */}
          {!booting && <Outlet />}
        </main>
      </div>

      <FilePreviewHost />
      <ToastHost />
      <ConnectionBanner />
    </div>
  );
}
