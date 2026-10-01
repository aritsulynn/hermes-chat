import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="flex h-full items-center justify-center text-muted-foreground">
      Scaffold
    </div>
  </StrictMode>,
);
