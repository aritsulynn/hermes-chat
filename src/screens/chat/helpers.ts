// Pure helpers for the chat screen (no React/JSX).
import type { SlashCompletionItem } from '../../services/gateway-ws';
import type { UiMessage } from '../../utils/messages';

// Offline fallback for the "/" wheel when the gateway predates `complete.slash`.
// The live catalog (built-ins + quick_commands + skills) supersedes this whenever
// the RPC answers. Every row here is `null` in the desktop registry (offered) —
// terminal/messaging-only commands are filtered out by isSlashSuggestion().
export const FALLBACK_SLASH: SlashCompletionItem[] = [
  { text: '/new', display: '/new', meta: 'Start a new chat' },
  { text: '/help', display: '/help', meta: 'Show available commands' },
  { text: '/status', display: '/status', meta: 'Session info and recap' },
  { text: '/usage', display: '/usage', meta: 'Token usage and cost' },
  { text: '/context', display: '/context', meta: 'Context-window breakdown' },
  { text: '/compress', display: '/compress', meta: 'Compress conversation context' },
  { text: '/reasoning', display: '/reasoning', meta: 'Reasoning effort or display' },
  { text: '/title', display: '/title', meta: 'Rename this session' },
  { text: '/stop', display: '/stop', meta: 'Stop the active turn' },
  { text: '/diff', display: '/diff', meta: 'Show git changes' },
  { text: '/plan', display: '/plan', meta: 'Write an implementation plan' },
  { text: '/review', display: '/review', meta: 'Run a reviewer subagent' },
  { text: '/goal', display: '/goal', meta: 'Set a standing goal' },
];

export function messageMatchesSearch(message: UiMessage, streamingText: string | undefined, query: string) {
  if (message.role === 'thinking') return false;
  const text = streamingText ? message.text + streamingText : message.text;
  return text.toLowerCase().includes(query);
}
