// Mobile slash-command curation, ported from Hermes Desktop.
//
// Source of truth: apps/desktop/src/lib/desktop-slash-registry.json — the
// backend's per-command `desktop=` disposition (dumped from
// hermes_cli/commands.py by scripts/dump_desktop_slash_registry.py), plus the
// handful of Ink/desktop-only names the registry never heard of
// (desktop-slash-commands.ts::TS_ONLY_NO_DESKTOP_SURFACE).
//
// `null`      — the command has a real (non-terminal) surface, so it's offered.
// a reason    — no surface here; the wheel hides it and a typed one gets the
//               reason instead of a doomed slash.exec round-trip (e.g. /update
//               times out in the 45s slash worker).
// `'hidden'`  — executable but picker-owned, kept out of the palette (/model).
// undefined   — not a built-in: a skill / quick / plugin command from the server.
//
// The table below is ONLY the offline fallback. At runtime the app calls
// `commands.catalog` and rememberCommandsCatalog() makes the backend's live
// dispositions/aliases win, so the app never needs a code change when the
// backend registry moves. To refresh the fallback, re-run
// scripts/dump_desktop_slash_registry.py in the hermes-agent repo and paste the
// JSON in.

import { slashName } from './messages';

export type SlashUnavailableReason =
  | 'advanced'
  | 'composer-voice'
  | 'messaging'
  | 'settings'
  | 'terminal';

export type SlashDisposition = SlashUnavailableReason | 'hidden' | null;

/** `/name` (aliases included) → disposition. */
export const SLASH_REGISTRY: Record<string, SlashDisposition> = {
  '/agents': null,
  '/approvals': null,
  '/approve': 'messaging',
  '/battery': null,
  '/bg': null,
  '/blueprint': null,
  '/bp': null,
  '/branch': null,
  '/browser': null,
  '/btw': null,
  '/bundles': null,
  '/busy': 'terminal',
  '/clear': 'terminal',
  '/codex-runtime': null,
  '/codex_runtime': null,
  '/commands': null,
  '/compact': null,
  '/compose': null,
  '/compress': null,
  '/config': 'terminal',
  '/context': null,
  '/copy': 'terminal',
  '/cron': 'terminal',
  '/ctx': null,
  '/curator': 'advanced',
  '/debug': null,
  '/density': 'terminal',
  '/deny': 'messaging',
  '/details': 'terminal',
  '/diff': null,
  '/egress': null,
  '/exit': 'terminal',
  '/export': null,
  '/fast': 'advanced',
  '/focus': null,
  '/footer': 'terminal',
  '/fork': null,
  '/gateway': 'terminal',
  '/generate-pet': null,
  '/goal': null,
  '/handoff': null,
  '/hatch': null,
  '/hb': null,
  '/heartbeat': null,
  '/help': null,
  '/history': 'terminal',
  '/image': 'terminal',
  '/import': null,
  '/indicator': 'terminal',
  '/init': null,
  '/insights': 'advanced',
  '/journey': null,
  '/kanban': 'advanced',
  '/learn': null,
  '/learning': null,
  '/login': 'settings',
  '/logs': 'terminal',
  '/loop': null,
  '/memory': null,
  '/memory-graph': null,
  '/moa': null,
  '/model': 'hidden',
  '/mouse': 'terminal',
  '/new': null,
  '/palette': null,
  '/paste': 'terminal',
  '/pause': null,
  '/personality': null,
  '/pet': null,
  '/pets': 'settings',
  '/plan': null,
  '/platform': null,
  '/platforms': 'terminal',
  '/plugins': 'terminal',
  '/proactive': null,
  '/profile': null,
  '/prompt': null,
  '/q': null,
  '/queue': null,
  '/quit': 'terminal',
  '/reasoning': null,
  '/redraw': 'terminal',
  '/refine': null,
  '/reload': 'terminal',
  '/reload-mcp': 'advanced',
  '/reload-skills': 'advanced',
  '/reload_mcp': 'advanced',
  '/reload_skills': 'advanced',
  '/reset': null,
  '/restart': 'terminal',
  '/resume': null,
  '/retry': null,
  '/review': null,
  '/rollback': null,
  '/save': null,
  '/sb': 'terminal',
  '/sessions': null,
  '/set-home': 'terminal',
  '/sethome': 'terminal',
  '/skills': 'settings',
  '/skin': null,
  '/snap': 'terminal',
  '/snapshot': 'terminal',
  '/start': null,
  '/status': null,
  '/statusbar': 'terminal',
  '/steer': null,
  '/stop': null,
  '/subgoal': null,
  '/subscription': null,
  '/suggest': null,
  '/suggestions': null,
  '/tasks': null,
  '/timestamps': null,
  '/title': null,
  '/tools': null,
  '/toolsets': 'terminal',
  '/topic': null,
  '/topup': null,
  '/ts': null,
  '/undo': null,
  '/update': 'terminal',
  '/upgrade': null,
  '/usage': null,
  '/v': null,
  '/verbose': 'terminal',
  '/version': null,
  '/voice': 'composer-voice',
  '/wake': null,
  '/whoami': null,
  '/worktree': null,
  '/yolo': null,
};

/** Alias → canonical name (desktop-slash-commands.ts::ALIAS_TO_CANONICAL). Only a
 *  cold-start fallback — the live `commands.catalog` `canon` map wins once it lands. */
export const SLASH_ALIASES: Record<string, string> = {
  '/reset': '/new',
  '/fork': '/branch',
  '/commands': '/help',
  '/learning': '/journey',
  '/memory-graph': '/journey',
  '/sessions': '/resume',
  '/switch': '/resume',
  '/compact': '/compress',
  '/generate-pet': '/hatch',
};

// ── Live catalog ─────────────────────────────────────────────────────────────
// `commands.catalog` (tui_gateway/contracts/tools_commands.py) is the authority
// for a command's `desktop=` disposition and its alias `canon` map — the backend
// owns the registry, so new/renamed/changed commands reach the app with no code
// change. SLASH_REGISTRY only covers the gap before the first reply (or an older
// backend that never answers).

export interface CommandsCatalogMeta {
  /** `null` = offered · a reason = no surface here · 'hidden' = picker-owned. */
  desktop?: string | null;
  argument_mode?: string | null;
}

export interface CommandsCatalogLike {
  canon?: Record<string, string>;
  commands?: Record<string, CommandsCatalogMeta>;
}

let liveCatalog: CommandsCatalogLike | undefined;

/** Remember the last `commands.catalog` result (called from the app store). */
export function rememberCommandsCatalog(catalog: CommandsCatalogLike | undefined): void {
  liveCatalog = catalog && typeof catalog === 'object' ? catalog : undefined;
}

function catalogCanonical(normalized: string): string | undefined {
  const canon = liveCatalog?.canon;
  if (!canon) return undefined;
  return canon[normalized] ?? canon[normalized.toLowerCase()];
}

/** Registry-offered commands that still have no mobile equivalent at all — hidden
 *  from the wheel, and a typed one gets the reason (see MOBILE_UI_HINT). */
const MOBILE_UNSUPPORTED = new Set(['/handoff', '/btw', '/wake', '/profile']);

const AS_REASON: Record<string, SlashUnavailableReason> = {
  advanced: 'advanced',
  'composer-voice': 'composer-voice',
  messaging: 'messaging',
  settings: 'settings',
  terminal: 'terminal',
};

/** Resolve an alias to its canonical command name (live canon first). */
export function canonicalSlash(name: string): string {
  const n = slashName(name);
  const key = n ? `/${n}` : '';
  return SLASH_ALIASES[key] || catalogCanonical(key) || key;
}

/** null = offered · a reason = unavailable · 'hidden' = picker-owned · undefined = extension.
 *  The live catalog wins; SLASH_REGISTRY is the offline fallback. */
export function slashDisposition(name: string): SlashDisposition | undefined {
  const canonical = canonicalSlash(name);
  const meta = liveCatalog?.commands?.[canonical];
  if (meta) {
    if (meta.desktop === 'hidden') return 'hidden';
    const reason = meta.desktop ? AS_REASON[meta.desktop] : undefined;
    // Present in the catalog with no reason (or an unknown one) = offered.
    return reason ?? null;
  }
  return SLASH_REGISTRY[canonical];
}

/** Whether the wheel should list this command: offered built-ins + extensions,
 *  minus aliases (duplicates), hidden/blocked ones, and mobile-unsupported ones. */
export function isSlashSuggestion(name: string): boolean {
  const key = `/${slashName(name)}`;
  const canonical = canonicalSlash(name);
  if (canonical !== key) return false; // alias
  if (MOBILE_UNSUPPORTED.has(canonical)) return false;
  const d = slashDisposition(canonical);
  return d === null || d === undefined;
}

const UNAVAILABLE_MESSAGE: Record<SlashUnavailableReason, (command: string) => string> = {
  advanced: (c) => `${c} isn't available in the mobile app — use the dashboard or terminal.`,
  'composer-voice': (c) => `${c} isn't available in the mobile app.`,
  messaging: (c) => `${c} is only used from messaging platforms.`,
  settings: (c) => `${c} is managed from the dashboard settings.`,
  terminal: (c) => `${c} is terminal-only — run it on the server.`,
};

/** Blocking line for a command this app can't run, or null when it's runnable. */
export function slashBlockedMessage(name: string): string | null {
  const canonical = canonicalSlash(name);
  const d = slashDisposition(canonical);
  if (d === undefined || d === null) return null;
  if (d === 'hidden') return null; // picker-owned but executable server-side
  return UNAVAILABLE_MESSAGE[d](canonical);
}

/** Commands the registry offers but a *mobile control* owns — running them
 *  server-side is wrong, so point at the control instead. Mobile's twin of the
 *  desktop's local `action`/`picker` specs. */
const MOBILE_UI_HINT: Record<string, string> = {
  '/model': 'Use the model chip in the composer to switch models.',
  '/resume': 'Pick a chat from the drawer instead.',
  '/sessions': 'Pick a chat from the drawer instead.',
  '/switch': 'Pick a chat from the drawer instead.',
  '/profile': "Profile switching isn't available in the mobile app.",
  // Server-side handoff would move this chat to another platform behind our back.
  '/handoff': 'Handoff is set up on the server — not from the mobile app.',
  // The worker only acknowledges /btw; the answer arrives as a btw.complete event
  // this app doesn't render, so it would look like it silently did nothing.
  '/btw': "Side questions (/btw) aren't supported in the mobile app yet — send it as a normal message.",
  '/wake': "The wake-word listener is desktop/terminal-only — not available in the mobile app.",
};

export function slashMobileHint(name: string): string | null {
  return MOBILE_UI_HINT[canonicalSlash(name)] ?? null;
}

/** Commands this app fulfils itself (never the slash worker). */
export type SlashMobileAction = 'new' | 'stop' | 'title';

export function slashMobileAction(name: string): SlashMobileAction | null {
  switch (canonicalSlash(name)) {
    case '/new':
      return 'new';
    case '/stop':
      return 'stop';
    case '/title':
      return 'title';
    default:
      return null;
  }
}
