// App shell: the navigation sidebar and the fixed chrome around every screen.
//
// The panel used to be built here — an `isWide` media query, a `panelOpen`
// boolean, a Radix Dialog for the overlay and a separate `NavRail` for the
// collapsed state, with the drawer's own content in a third file. All of that
// frame is shadcn's `Sidebar` now (the Base UI build — see
// components/ui/sidebar.tsx), and this file is down to two jobs: mounting it,
// and registering the module-level bridges the rest of the app routes through
// (see store/nav.ts for why those cannot be hooks).
import { useCallback, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp, useThemeValue } from './hooks/app-store';
import { useEdgeSwipe } from './hooks/use-edge-swipe';
import { setDrawerOpener, setNavigator, setSidebarShown } from './store/nav';
import { syncStatusBarStyle } from './platform';
import { ConnectionBanner } from './components/connection-banner';
import { HermesSidebarContent } from './components/drawer/HermesSidebarContent';
import { FilePreviewHost } from './components/chat/media';
import { ToastHost } from './components/ui/toast';
import { Sidebar, SidebarInset, SidebarProvider, useSidebar } from './components/ui/sidebar';
import { TooltipProvider } from './components/ui/tooltip';
import { screenBg } from './theme';

/**
 * The remembered open/collapsed choice.
 *
 * `SidebarProvider` writes this cookie on every toggle but never reads it back:
 * shadcn's own example reads it on the server, and this app has no server.
 * Reading it here is what makes the persisted value mean anything after a
 * reload. An absent cookie leaves `defaultOpen` in charge (expanded).
 */
function readSidebarCookie(): boolean | undefined {
  const match = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/);
  return match ? match[1] === 'true' : undefined;
}

/**
 * Publishes the frame's state to the rest of the app.
 *
 * Two commands and one piece of state, all of which screens far below the shell
 * need and none of which can be reached with a hook from where they are. This
 * has to be a *child* of `SidebarProvider` because the state lives in that
 * context; the shell itself renders the provider.
 */
function ShellBridges() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isMobile, setOpen, setOpenMobile } = useSidebar();

  useEffect(() => {
    setNavigator((to, options) => navigate(to, { replace: options?.replace }));
  }, [navigate]);

  // The hamburger every screen header carries. On a phone it opens the sheet;
  // on desktop it expands the panel. Named `setDrawerOpener` still, because
  // that is what the callers call it.
  useEffect(() => {
    setDrawerOpener(() => {
      if (isMobile) setOpenMobile(true);
      else setOpen(true);
    });
  }, [isMobile, setOpen, setOpenMobile]);

  // `sidebarShown` means "the sidebar carries its own toggle, so the screen
  // header's hamburger steps aside". The rail is that toggle on desktop — click
  // it to expand (see Sidebar) — so desktop hides the hamburger. A phone's
  // sheet has no persistent control at all, so the button stays and is the only
  // way in besides the edge swipe.
  useEffect(() => {
    setSidebarShown(!isMobile);
  }, [isMobile]);

  // A route change dismisses the mobile sheet. The desktop panel is furniture,
  // not an overlay: closing it on every nav tap would make it useless for moving
  // between screens.
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);

  return null;
}

/**
 * Edge-swipe open/close for the mobile drawer. Lives here (inside
 * `SidebarProvider`) because the open state lives in that context — no bridge
 * module needed. Closed: swipe right from the left edge opens. Open: swipe
 * left from anywhere closes. Desktop: disabled, the panel is furniture there.
 */
function EdgeSwipeHandler() {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const openDrawer = useCallback(() => setOpenMobile(true), [setOpenMobile]);
  const closeDrawer = useCallback(() => setOpenMobile(false), [setOpenMobile]);
  useEdgeSwipe({
    enabled: isMobile,
    anywhere: openMobile,
    onLeftEdgeSwipe: openMobile ? undefined : openDrawer,
    onRightEdgeSwipe: openMobile ? closeDrawer : undefined,
  });
  return null;
}

export function AppShell() {
  const { theme } = useThemeValue();
  // `booting` is the store restoring the session from the browser's cookie jar.
  const { booting } = useApp();

  // Native only: the status bar is transparent (edge-to-edge is enforced), so
  // its icons must contrast with the app's own top. Web no-ops.
  useEffect(() => {
    void syncStatusBarStyle(theme === 'dark');
  }, [theme]);

  return (
    <SidebarProvider
      // `h-full`/`flex-col` rather than the component's default `min-h-svh`:
      // this app fills the viewport and scrolls its own panes, so the wrapper is
      // a column holding one row (panel + content) with the overlay hosts below.
      className="h-full flex-col"
      // The remembered cookie wins; without one the panel starts open, so a
      // first-time desktop visitor sees the session list rather than only the
      // rail. Collapsing is one click on the rail's own PanelLeft control.
      defaultOpen={readSidebarCookie() ?? true}
      style={{ background: screenBg(theme === 'dark') }}>
      {/* Tooltips only appear when the panel is collapsed to the rail, where
          the label has nowhere else to live. Base UI does not require the
          provider — it is what makes adjacent hints appear instantly instead of
          re-running the open delay. */}
      <TooltipProvider>
        <ShellBridges />
        <EdgeSwipeHandler />
        <div className="flex min-h-0 flex-1">
          <Sidebar collapsible="icon" side="left">
            <HermesSidebarContent />
          </Sidebar>
          {/* Full width so the screen header sits flush to the window edge and
              the transcript's scrollbar rides the real right edge. The reading
              column is narrowed inside each screen instead (see the chat
              transcript and `mx-auto max-w-*` content wrappers). `min-h-0` and
              `min-w-0` let this flex item shrink below its content width, which
              is what keeps the transcript scrolling instead of the document. */}
          <SidebarInset className="min-h-0 min-w-0">
            {/* Withheld until the store finishes restoring the session, so a
                deep-linked screen does not see `authed === false` during boot and
                bounce through /login. */}
            {!booting && <Outlet />}
          </SidebarInset>
        </div>
      </TooltipProvider>

      <FilePreviewHost />
      <ToastHost />
      <ConnectionBanner />
    </SidebarProvider>
  );
}
