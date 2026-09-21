// Shared chat models + pure helpers (no React imports).
// Split out of the old monolithic App.tsx so the expo-router screens,
// the global store and the shared UI components all use one definition.
import type { ModelProviderOption } from '../lib/dashboard';

export type Role = 'user' | 'assistant' | 'notice' | 'interim' | 'thinking' | 'tool';

export interface UiMessage {
  id: string;
  role: Role;
  text: string;
  pending?: boolean;
  detail?: string;
}

export interface Attachment {
  uri: string;
  name: string;
  mime?: string;
}

let seq = 0;
export const nid = () => `m${Date.now()}-${seq++}`;

// Error values from fetch/WS can be non-Error objects — never render raw.
export function errMsg(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.error === 'string' && o.error) return o.error;
    try {
      const j = JSON.stringify(o);
      return j === '{}' ? String(o) : j;
    } catch {
      return String(o);
    }
  }
  return String(e);
}

// ── Ask helpers ──────────────────────────────────────────────────────────────
// Server asks (srq-*) and their reply shapes — see src/gateway-ws.ts header.

export interface ClarifyQ {
  qid: string;
  question: string;
  choices: string[];
  multiSelect: boolean;
}

export function parseClarify(ask: { params: Record<string, any> }): { single: boolean; questions: ClarifyQ[] } {
  const p = ask.params;
  if (Array.isArray(p.questions) && p.questions.length > 0) {
    return {
      single: false,
      questions: p.questions.map((q: any, i: number) => ({
        qid: String(q?.qid ?? `q${i}`),
        question: String(q?.question ?? ''),
        choices: Array.isArray(q?.choices) ? q.choices.map(String) : [],
        multiSelect: q?.multi_select === true,
      })),
    };
  }
  return {
    single: true,
    questions: [
      {
        qid: String(p.qid ?? p.question_id ?? 'q0'),
        question: String(p.question ?? p.text ?? ''),
        choices: Array.isArray(p.choices)
          ? p.choices.map(String)
          : Array.isArray(p.options)
            ? p.options.map(String)
            : [],
        multiSelect: p.multi_select === true,
      },
    ],
  };
}

// ── Markdown preprocessing ───────────────────────────────────────────────────

// Reasoning streams often open with a one-line activity status like
// "(✦) setting wing angle..." — not real thinking. Drop leading lines with
// that shape so the bubble shows only thinking.
export function cleanThinking(text: string): string {
  const lines = text.split('\n');
  while (lines.length > 1 && /^\([^)\n]{0,12}\)\s*\S.*\.\.\.\s*$/.test(lines[0])) lines.shift();
  return lines.join('\n');
}

// react-native-markdown-display renders lists as flex rows whose width Yoga
// measures as unbounded inside an auto-width bubble — the text never wraps
// and spills out of the bubble. Flatten list markers to plain-text bullets so
// every line is a normal wrapping paragraph.
export function flattenLists(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // Unordered (- * +) with optional [ ]/[x] checkbox → •
      let m = line.match(/^(\s*)[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/);
      if (m) return `${m[1].slice(0, 3)}• ${m[2]}`;
      // Ordered (1. / 1)) → escape the dot so it stays a literal paragraph.
      m = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
      if (m) return `${m[1].slice(0, 3)}${m[2]}\\. ${m[3]}`;
      return line;
    })
    .join('\n');
}

// ── Composer options ─────────────────────────────────────────────────────────
// Real picker inventory comes from the gateway (WS model.options, fallback
// REST GET /api/model/options). This is only the offline fallback.

export const FALLBACK_PROVIDERS: ModelProviderOption[] = [
  {
    slug: '',
    name: 'Default',
    models: ['Muse Spark 1.3 Free', 'opus', 'sonnet', 'haiku'],
    totalModels: 4,
  },
];

export const EFFORTS = ['Low', 'Medium', 'High', 'Xhigh'];
