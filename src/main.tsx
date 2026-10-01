// Entry point.
//
// React Router in history mode: the gateway host serves this app from a
// subpath or the domain root, and a deep link like /chat has to survive a
// reload. That is what BrowserRouter buys over HashRouter. It does mean the
// server must fall back to index.html for unknown paths — a dev server does
// that by default; a static host needs the equivalent rewrite rule.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import '../global.css';
import RootLayout from './app/_layout';
import { FALLBACK_PATH, ROUTES } from './app/routes';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<RootLayout />}>
          {ROUTES.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          <Route path="*" element={<Navigate to={FALLBACK_PATH} replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
