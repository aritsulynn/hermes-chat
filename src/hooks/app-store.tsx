// App store entry point.
//
// The implementation (the AppProvider orchestrator + the store slices) lives in
// ../store/useAppStore. This module keeps the historical `hooks/app-store`
// import path stable for screens/components.
export {
  useApp,
  useStreamingChars,
  useStreamingRead,
  useStreamingText,
  useThemeValue,
  AppProvider,
} from '../store/useAppStore';
export type { AppStore, AgentProfile, ScopedSessionSummary } from '../store/types';
