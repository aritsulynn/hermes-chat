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
import { setDrawerOpener, setNavigator } from '../store/nav';
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

function Shell() {
  const { theme } = useThemeValue();
  // `booting` is the store restoring the session from the browser's cookie jar.
  // The outlet is withheld until that settles — see the note at the render site.
  const { booting } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Hand the two bridges their real implementations. Both are module-level
  // singletons because their callers cannot use hooks (see store/nav.ts), so
  // this is the one place in the app that is allowed to know they exist.
  useEffect(() => {
    setNavigator((to, options) => navigate(to, { replace: options?.replace }));
    setDrawerOpener(() => setDrawerOpen(true));
  }, [navigate]);

  // Any route change closes the drawer. The native drawer did this itself on
  // navigation; a DOM drawer has to be told.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const onOpenChange = useCallback((open: boolean) => setDrawerOpen(open), []);

  return (
    <div className="flex h-full flex-col" style={{ background: screenBg(theme === 'dark') }}>
      <DialogPrimitive.Root open={drawerOpen} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            // Radix wants a title; the drawer is titled by its own content, so
            // this satisfies the requirement without a second visible heading.
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[85vw] flex-col shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <HermesDrawerContent open={drawerOpen} onOpenChange={onOpenChange} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <main className="relative flex min-h-0 flex-1 flex-col">
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
