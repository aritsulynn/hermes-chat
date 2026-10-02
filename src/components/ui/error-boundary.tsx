// A last-resort boundary: what renders when the app throws.
//
// There was none, so any throw during render unmounted everything and left a
// blank page — indistinguishable from a crash to load, with no clue on screen
// and no way back. This catches it, prints what threw, and offers a reload.
//
// It sits OUTSIDE <AppProvider> on purpose: the provider is one of the things it
// has to survive, so it cannot read the theme or the session and must not import
// any app component. The palette is therefore fixed, with `dark:` variants keyed
// off whatever class the store happened to leave on <html>.
//
// A class component because that is still the only error-boundary API React has.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep it in the console as well as on screen: the on-screen copy is for
    // whoever hit it, the console one is for whoever has devtools open.
    console.error('[hermes] render crashed', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-popover p-6 text-center dark:bg-background">
        <div className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
          Something went wrong rendering this screen.
        </div>
        <pre className="max-h-[40vh] max-w-[min(90vw,48rem)] overflow-auto rounded-lg border border-border bg-elevated p-3 text-left text-[12px] leading-[18px] whitespace-pre-wrap text-neutral-700 dark:bg-[#1b1b1b] dark:text-neutral-300">
          {error.message || String(error)}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-border px-3 py-2 text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
          Reload
        </button>
      </div>
    );
  }
}
