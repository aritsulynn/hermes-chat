// Entry point.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../global.css';
import { ErrorBoundary } from './components/ui/error-boundary';
import App from './App';

// The boundary wraps <App> rather than living inside it: the provider, the
// router and every screen are all things it has to be able to survive. See the
// note in components/ui/error-boundary.tsx.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
