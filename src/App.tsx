import { useEffect } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider } from './hooks/app-store';
import { AppShell } from './AppShell';
import { APP_ROUTES, FALLBACK_PATH } from './routes';
import { LoginScreen } from './features/login';
import { initNativeChrome, isNativeShell } from './platform';

/**
 * `BrowserRouter` on the web (a deep link like /chat survives a reload because
 * the host rewrites unknown paths to index.html), `HashRouter` inside a native
 * shell where there is no server to do that rewrite — `capacitor://localhost`
 * or `file://` has no notion of history-mode fallback. The store's `nav.ts`
 * bridge only calls `navigate(to)`, so it works under either router.
 *
 * Computed once at module load: the shell never changes under a running app.
 */
const Router = isNativeShell() ? HashRouter : BrowserRouter;

/**
 * React Router in history mode: a deep link like /chat has to survive a reload,
 * which means `BrowserRouter` over `HashRouter`. The server must fall back to
 * index.html for unknown paths — a dev server does that by default; a static
 * host needs the equivalent rewrite rule.
 *
 * Inside a native shell (Capacitor, later Electron) there is no server, so
 * `Router` above is already `HashRouter` and this comment does not apply.
 *
 * `/login` (and `/`) sit outside `<AppShell>`: there is no drawer or chrome
 * around an unauthenticated screen.
 */
export default function App() {
  // Native shells draw edge-to-edge: without this the status bar sits on top
  // of the drawer/chat headers (see initNativeChrome). Web no-ops.
  useEffect(() => {
    void initNativeChrome();
  }, []);
  return (
    <Router>
      <AppProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginScreen />} />
          <Route element={<AppShell />}>
            {APP_ROUTES.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
            <Route path="*" element={<Navigate to={FALLBACK_PATH} replace />} />
          </Route>
        </Routes>
      </AppProvider>
    </Router>
  );
}
