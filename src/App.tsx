import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider } from './hooks/app-store';
import { AppShell } from './AppShell';
import { APP_ROUTES, FALLBACK_PATH } from './routes';
import { LoginScreen } from './features/login';

/**
 * React Router in history mode: a deep link like /chat has to survive a reload,
 * which means `BrowserRouter` over `HashRouter`. The server must fall back to
 * index.html for unknown paths — a dev server does that by default; a static
 * host needs the equivalent rewrite rule.
 *
 * `/login` (and `/`) sit outside `<AppShell>`: there is no drawer or chrome
 * around an unauthenticated screen.
 */
export default function App() {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
}
