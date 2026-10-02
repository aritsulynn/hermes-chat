// Messaging channels — platform state, credentials, and the Telegram/WhatsApp
// QR/deep-link onboarding flows.
//
// Wraps `hermes_cli/web_routers/messaging.py` over the app's authed ops helpers,
// mirroring Hermes Desktop's `ChannelsPage.tsx`. Transport only.
import {
  messagingPlatform,
  messagingPlatformTest,
  messagingPlatforms,
  telegramOnboarding,
  telegramOnboardingApply,
  telegramOnboardingStart,
  whatsappOnboarding,
  whatsappOnboardingApply,
  whatsappOnboardingStart,
} from './api';

export interface MessagingEnvVar {
  key: string;
  required: boolean;
  isSet: boolean;
  redactedValue: string;
  label: string;
  description: string;
  isSecret: boolean;
}

export interface MessagingPlatform {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  enabled: boolean;
  configured: boolean;
  gatewayRunning: boolean;
  state: string;
  errorCode: string | null;
  errorMessage: string | null;
  homeChannel: string;
  envVars: MessagingEnvVar[];
  ingressUrl: string | null;
  /** WhatsApp only. */
  whatsappSetup?: { mode: string; allowedUsersSet: boolean; homeChannelSet: boolean };
}

export interface TelegramOnboarding {
  pairingId: string;
  status: string;
  suggestedUsername: string;
  deepLink: string;
  qrPayload: string;
  expiresAt: string;
  botUsername: string;
  ownerUserId: string;
}

export interface WhatsAppOnboarding {
  pairingId: string;
  status: string;
  qrPayload: string;
  expiresAt: string;
  mode: string;
  allowedUsers: string;
  accountId: string;
  accountName: string;
  accountPhone: string;
  error: string;
}

type OpsGet = (path: string) => Promise<unknown>;
type OpsMut = (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
}

export async function getMessagingPlatforms(opsGet: OpsGet, profile?: string | null): Promise<MessagingPlatform[]> {
  const r = rec(await opsGet(messagingPlatforms(profile)));
  const rows = Array.isArray(r.platforms) ? r.platforms : [];
  const out: MessagingPlatform[] = [];
  for (const raw of rows) {
    const p = rec(raw);
    const id = str(p.id);
    if (!id) continue;
    const envVars: MessagingEnvVar[] = [];
    if (Array.isArray(p.env_vars)) {
      for (const rawEnv of p.env_vars) {
        const e = rec(rawEnv);
        const key = str(e.key);
        if (!key) continue;
        envVars.push({
          key,
          required: e.required === true,
          isSet: e.is_set === true,
          redactedValue: str(e.redacted_value),
          label: str(e.label),
          description: str(e.description),
          isSecret: e.is_secret === true,
        });
      }
    }
    out.push({
      id,
      name: str(p.name) || id,
      description: str(p.description),
      docsUrl: str(p.docs_url),
      enabled: p.enabled === true,
      configured: p.configured === true,
      gatewayRunning: p.gateway_running === true,
      state: str(p.state),
      errorCode: typeof p.error_code === 'string' ? p.error_code : null,
      errorMessage: typeof p.error_message === 'string' ? p.error_message : null,
      homeChannel: str(p.home_channel),
      envVars,
      ingressUrl: typeof p.ingress_url === 'string' ? p.ingress_url : null,
      ...(p.whatsapp_setup && typeof p.whatsapp_setup === 'object'
        ? {
            whatsappSetup: {
              mode: str(rec(p.whatsapp_setup).mode),
              allowedUsersSet: rec(p.whatsapp_setup).allowed_users_set === true,
              homeChannelSet: rec(p.whatsapp_setup).home_channel_set === true,
            },
          }
        : {}),
    });
  }
  return out;
}

/** Enable/disable a platform, and/or write env credentials. */
export async function updateMessagingPlatform(
  opsMut: OpsMut,
  platformId: string,
  body: { enabled?: boolean; env?: Record<string, string>; clearEnv?: string[] },
): Promise<void> {
  await opsMut(messagingPlatform(platformId), 'PUT', {
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.env ? { env: body.env } : {}),
    ...(body.clearEnv ? { clear_env: body.clearEnv } : {}),
  });
}

export async function testMessagingPlatform(
  opsMut: OpsMut,
  platformId: string,
): Promise<{ ok: boolean; message: string }> {
  const r = rec(await opsMut(messagingPlatformTest(platformId), 'POST', {}));
  return { ok: r.ok !== false, message: str(r.message ?? r.error) };
}

// ── Telegram onboarding ─────────────────────────────────────────────────────

export async function startTelegramOnboarding(opsMut: OpsMut): Promise<TelegramOnboarding> {
  const r = rec(await opsMut(telegramOnboardingStart(), 'POST', { bot_name: 'Hermes Agent' }));
  return {
    pairingId: str(r.pairing_id),
    status: 'waiting',
    suggestedUsername: str(r.suggested_username),
    deepLink: str(r.deep_link),
    qrPayload: str(r.qr_payload),
    expiresAt: str(r.expires_at),
    botUsername: '',
    ownerUserId: '',
  };
}

export async function getTelegramOnboarding(opsGet: OpsGet, pairingId: string): Promise<TelegramOnboarding> {
  const r = rec(await opsGet(telegramOnboarding(pairingId)));
  return {
    pairingId,
    status: str(r.status),
    suggestedUsername: '',
    deepLink: '',
    qrPayload: '',
    expiresAt: str(r.expires_at),
    botUsername: str(r.bot_username),
    ownerUserId: str(r.owner_user_id),
  };
}

export async function applyTelegramOnboarding(
  opsMut: OpsMut,
  pairingId: string,
  allowedUserIds: string[],
): Promise<void> {
  await opsMut(telegramOnboardingApply(pairingId), 'POST', { allowed_user_ids: allowedUserIds });
}

export async function cancelTelegramOnboarding(opsMut: OpsMut, pairingId: string): Promise<void> {
  await opsMut(telegramOnboarding(pairingId), 'DELETE');
}

// ── WhatsApp onboarding ─────────────────────────────────────────────────────

function whatsappOf(raw: unknown): WhatsAppOnboarding {
  const r = rec(raw);
  return {
    pairingId: str(r.pairing_id),
    status: str(r.status),
    qrPayload: str(r.qr_payload),
    expiresAt: str(r.expires_at),
    mode: str(r.mode),
    allowedUsers: str(r.allowed_users),
    accountId: str(r.account_id),
    accountName: str(r.account_name),
    accountPhone: str(r.account_phone),
    error: str(r.error),
  };
}

export async function startWhatsAppOnboarding(
  opsMut: OpsMut,
  input: { mode?: string; allowedUsers?: string } = {},
): Promise<WhatsAppOnboarding> {
  return whatsappOf(
    await opsMut(whatsappOnboardingStart(), 'POST', {
      mode: input.mode ?? 'bot',
      allowed_users: input.allowedUsers ?? '',
    }),
  );
}

export async function getWhatsAppOnboarding(opsGet: OpsGet, pairingId: string): Promise<WhatsAppOnboarding> {
  return whatsappOf(await opsGet(whatsappOnboarding(pairingId)));
}

export async function applyWhatsAppOnboarding(
  opsMut: OpsMut,
  pairingId: string,
  input: { mode?: string; allowedUsers?: string } = {},
): Promise<void> {
  await opsMut(whatsappOnboardingApply(pairingId), 'POST', {
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.allowedUsers !== undefined ? { allowed_users: input.allowedUsers } : {}),
  });
}

export async function cancelWhatsAppOnboarding(opsMut: OpsMut, pairingId: string): Promise<void> {
  await opsMut(whatsappOnboarding(pairingId), 'DELETE');
}
