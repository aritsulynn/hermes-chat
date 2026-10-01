// Root layout — the app shell.
//
// expo-router put a Drawer here, which owned the navigation state and rendered
// a `Drawer.Screen` per route. On the web the drawer is a sibling of the routes
// rather than an ancestor of them, so it is a Radix Dialog whose open state
// lives here and whose opener is registered into store/nav.ts (the hamburger in
// every screen header calls that bridge, because it is a component far below
// this one and has no way to reach React state).
//
// The same goes for `navigate`: the store slices route themselves from WS
// callbacks and boot effects, which have no `useNavigate` available.
import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AppProvider, useApp, useThemeValue } from '../hooks/app-store';
import { useMediaQuery } from '../hooks/use-viewport';
import { setDrawerOpener, setNavigator, setSidebarShown } from '../store/nav';
import { ConnectionBanner } from '../components/connection-banner';
import { HermesDrawerContent } from '../components/drawer/HermesDrawerContent';
import { FilePreviewHost } from '../components/chat/media';
import { ToastHost } from '../components/ui/toast';
import { screenBg } from '../theme';

export default function RootLayout() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

/**
 * The width at which the drawer stops being an overlay and becomes a sidebar.
 *
 * 768px rather than 1024px. A 300px panel on a 1024px window is only worth
 * showing on a maximised desktop, and the point of a sidebar is that it is there
 * when you want it; at 768px the chat still gets 468px, which is a phone in
 * landscape — narrow, but a real column, and the mode is a preference rather
 * than a constraint because it can be collapsed.
 */
const SIDEBAR_MIN_WIDTH = 768;

function Shell() {
  const { theme } = useThemeValue();
  // `booting` is the store restoring the session from the browser's cookie jar.
  // The outlet is withheld until that settles — see the note at the render site.
  const { booting } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  // Read during render, so the very first paint is already in the right mode.
  const isWide = useMediaQuery(`(min-width: ${SIDEBAR_MIN_WIDTH}px)`);
  // One piece of state for both modes: "is the panel showing". On a wide screen
  // it starts expanded and lives in the layout; on a narrow one it starts hidden
  // and comes up as an overlay. They cannot both be up, because `isWide` decides
  // which one is rendered.
  const [panelOpen, setPanelOpen] = useState(isWide);

  // Hand the two bridges their real implementations. Both are module-level
  // singletons because their callers cannot use hooks (see store/nav.ts), so
  // this is the one place in the app that is allowed to know they exist.
  useEffect(() => {
    setNavigator((to, options) => navigate(to, { replace: options?.replace }));
    setDrawerOpener(() => setPanelOpen(true));
  }, [navigate]);

  // Crossing the breakpoint resets to that mode's default. Without this, pulling
  // a wide window narrow would leave the panel "open" as an overlay covering the
  // chat it was sitting beside a moment ago.
  useEffect(() => {
    setPanelOpen(isWide);
  }, [isWide]);

  // Tell the headers whether the sidebar is up, so their toggle can step aside.
  // An overlay does not count: it is drawn over those headers anyway.
  useEffect(() => {
    setSidebarShown(isWide && panelOpen);
  }, [isWide, panelOpen]);

  // A route change dismisses the *overlay*. The native drawer did this itself on
  // navigation and a DOM drawer has to be told. The sidebar is not an overlay:
  // closing it on every nav tap would make it useless for the one thing it is
  // for, which is moving between screens.
  useEffect(() => {
    if (!isWide) setPanelOpen(false);
  }, [location.pathname, isWide]);

  const onOpenChange = useCallback((open: boolean) => setPanelOpen(open), []);

  return (
    <div className="flex h-full flex-col" style={{ background: screenBg(theme === 'dark') }}>
      <div className="flex min-h-0 flex-1">
        {/* The same panel, in flow, on a screen wide enough to afford it. Not a
            Dialog here: there is nothing to be modal about with the chat sitting
            right next to it, and a dialog would trap focus away from it. */}
        {isWide && panelOpen && (
          <div
            className="flex w-[300px] shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800"
            data-testid="sidebar">
            <HermesDrawerContent open persistent onOpenChange={onOpenChange} />
          </div>
        )}

        {/* Narrow screens keep the overlay, which is what the drawer always was.
            Rendered even on a wide screen and simply never opened, so switching
            modes is a change of `open` rather than a remount. */}
        <DialogPrimitive.Root open={!isWide && panelOpen} onOpenChange={onOpenChange}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
            <DialogPrimitive.Content
              // Radix wants a title; the drawer is titled by its own content, so
              // this satisfies the requirement without a second visible heading.
              aria-describedby={undefined}
              className="fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[85vw] flex-col shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <HermesDrawerContent open={panelOpen} onOpenChange={onOpenChange} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        {/* `min-w-0` is load-bearing now that this is a flex *row* item. A flex
            item defaults to `min-width: auto`, which refuses to shrink below its
            content, and the chat's min-content is ~787px — so with the sidebar's
            300px beside it, main stayed 787 wide and pushed the layout 207px past
            the window. It never bit before because main used to be a child of a
            *column*, where `min-width: auto` is the cross axis and the width is
            simply stretched. */}
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Withheld while the store boots, and this is load-bearing rather than
              a nicety. Every screen guards itself with
              `if (!authed) return <Redirect to="/login" replace />`, and on a hard
              load that guard sees `authed === false` during the window before the
              store has restored the session from the cookie jar. So a deep link to
              any route other than /chat went /logs -> /login -> /chat: the screen
              bounced before the cookie had been checked, then the login screen
              bounced back once auth came back true, and the visitor lost their
              place. Withholding the outlet closes the window in which that
              race can happen, and it is the one place to do it — the alternative
              is teaching ten screens to distinguish "not authed" from "not authed
              yet".

              The login screen has its own `booting` branch, which this makes
              unreachable. It is left in place deliberately: it is correct, and
              LoginScreen is also reachable directly. */}
          {!booting && <Outlet />}
        </main>
      </div>

      {/* File links inside markdown preview through this host (a Modal can't
          live inside the <Text> the markdown pipeline builds). */}
      <FilePreviewHost />
      {/* App-wide toasts (replaces the old Alert.alert error popups). */}
      <ToastHost />
      {/* Overlays every screen, so a dropped socket is visible from chat, files
          or logs alike. Renders null while the connection is ready. */}
      <ConnectionBanner />
    </div>
  );
}
