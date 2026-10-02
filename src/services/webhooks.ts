// Webhook subscriptions — the events GitHub/GitLab/etc. deliver to the agent.
//
// Wraps `hermes_cli/web_routers/ops.py` (`/api/webhooks`) over the app's authed
// ops helpers, mirroring Hermes Desktop's `WebhooksPage.tsx`. Transport only.
// The per-route HMAC secret is redacted on read and returned exactly once on
// create, so callers surface it immediately rather than storing it here.
import { webhook, webhookEnabled, webhooks, webhooksEnable } from './api';

export interface WebhookRoute {
  name: string;
  description: string;
  events: string[];
  deliver: string;
  deliverOnly: boolean;
  prompt: string;
  script: string;
  skills: string[];
  createdAt: string | null;
  /** Full ingest URL for this route. */
  url: string;
  secretSet: boolean;
  enabled: boolean;
}

export interface WebhooksState {
  enabled: boolean;
  baseUrl: string;
  subscriptions: WebhookRoute[];
}

export interface WebhookCreateInput {
  name: string;
  description?: string;
  events?: string[];
  prompt?: string;
  script?: string;
  skills?: string[];
  deliver?: string;
  deliverOnly?: boolean;
  secret?: string;
}

type OpsGet = (path: string) => Promise<unknown>;
type OpsMut = (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function routeOf(raw: unknown): WebhookRoute | null {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const name = str(r.name);
  if (!name) return null;
  return {
    name,
    description: str(r.description),
    events: strList(r.events),
    deliver: str(r.deliver) || 'log',
    deliverOnly: r.deliver_only === true,
    prompt: str(r.prompt),
    script: str(r.script),
    skills: strList(r.skills),
    createdAt: typeof r.created_at === 'string' ? r.created_at : null,
    url: str(r.url),
    secretSet: r.secret_set === true,
    enabled: r.enabled !== false,
  };
}

export async function getWebhooks(opsGet: OpsGet, profile?: string | null): Promise<WebhooksState> {
  const res = await opsGet(webhooks(profile));
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  const subs = Array.isArray(r.subscriptions) ? r.subscriptions : [];
  const subscriptions: WebhookRoute[] = [];
  for (const raw of subs) {
    const route = routeOf(raw);
    if (route) subscriptions.push(route);
  }
  return { enabled: r.enabled === true, baseUrl: str(r.base_url), subscriptions };
}

/** Turn the webhook platform on. Returns whether a gateway restart is needed. */
export async function enableWebhooks(opsMut: OpsMut): Promise<{ needRestart: boolean }> {
  const res = await opsMut(webhooksEnable(), 'POST', {});
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  return { needRestart: r.needs_restart === true };
}

/** Create a route; returns its summary including the one-time secret. */
export async function createWebhook(
  opsMut: OpsMut,
  input: WebhookCreateInput,
): Promise<{ route: WebhookRoute | null; secret: string }> {
  const res = await opsMut(webhooks(), 'POST', {
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    events: input.events ?? [],
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.script ? { script: input.script } : {}),
    skills: input.skills ?? [],
    deliver: input.deliver ?? 'log',
    ...(input.deliverOnly ? { deliver_only: true } : {}),
    ...(input.secret ? { secret: input.secret } : {}),
  });
  const r = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  return { route: routeOf(r), secret: str(r.secret) };
}

export async function deleteWebhook(opsMut: OpsMut, name: string): Promise<void> {
  await opsMut(webhook(name), 'DELETE');
}

export async function setWebhookEnabled(opsMut: OpsMut, name: string, enabled: boolean): Promise<void> {
  await opsMut(webhookEnabled(name), 'PUT', { enabled });
}
