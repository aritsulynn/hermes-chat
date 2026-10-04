// Channels route — messaging platform state, credentials, and the Telegram /
// WhatsApp pairing flows.
//
// Ported from the desktop `ChannelsPage.tsx`, scoped to the platforms the
// mobile app can drive end-to-end: the list with enable/test, per-platform env
// credentials, and the Telegram + WhatsApp pairing flows. On a phone the
// pairing link is a tappable deep link (better than scanning a QR on the same
// device), with the raw payload copyable as a fallback.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Copy, ExternalLink, KeyRound, RefreshCw, X, Zap } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { useOpsMutation, useOpsQuery } from '../../store/ops-query';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { toast } from '../../components/ui/toast';
import { writeClipboard } from '../../services/clipboard';
import { brandColor, screenStyle } from '../../theme';
import {
  applyTelegramOnboarding,
  applyWhatsAppOnboarding,
  cancelTelegramOnboarding,
  cancelWhatsAppOnboarding,
  getMessagingPlatforms,
  getTelegramOnboarding,
  getWhatsAppOnboarding,
  startTelegramOnboarding,
  startWhatsAppOnboarding,
  testMessagingPlatform,
  updateMessagingPlatform,
  type MessagingPlatform,
} from '../../services/channels';

type PairingKind = 'telegram' | 'whatsapp';

export function ChannelsScreen() {
  const { authed, activeProfile, opsGet, opsMut, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);

  const [query, setQuery] = useState('');
  const [configuring, setConfiguring] = useState<MessagingPlatform | null>(null);
  const [pairing, setPairing] = useState<{ kind: PairingKind; platform: MessagingPlatform } | null>(null);

  // One scoped query replaces the four useState slots + epoch-guarded load.
  const list = useOpsQuery<MessagingPlatform[]>({
    key: ['channels'],
    get: (get) => getMessagingPlatforms(get, activeProfile),
    enabled: authed,
  });
  const platforms = list.data ?? [];
  const loading = list.isPending;
  const refreshing = list.isRefetching;
  const error = list.error ? errMsg(list.error) : null;
  const refresh = useCallback(() => void list.refetch(), [list]);

  const ql = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      ql
        ? platforms.filter((p) =>
            [p.id, p.name, p.description].some((v) =>
              String(v ?? '')
                .toLowerCase()
                .includes(ql),
            ),
          )
        : platforms,
    [platforms, ql],
  );
  const configuredCount = platforms.filter((p) => p.configured).length;

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
      <ScreenScaffold
        header={
          <>
            <ScreenHeader
              title="Channels"
              subtitle={loading ? 'Loading…' : `${configuredCount}/${platforms.length} configured`}
              actions={
                <HeaderIconButton aria-label="Refresh channels" onClick={refresh}>
                  <RefreshCw size={20} color={dark ? '#e5e5e5' : '#333'} className={refreshing ? 'animate-spin' : ''} />
                </HeaderIconButton>
              }
            />
            <div className="border-b border-border px-3 py-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search channels…"
                aria-label="Search channels"
                autoCapitalize="none"
                className="rounded-xl border border-border px-3 py-2 text-[14px] text-neutral-950 dark:text-neutral-100"
              />
            </div>
          </>
        }
        contentClassName="px-4 py-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          {loading && !refreshing ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={24} color={brand} />
            </div>
          ) : error ? (
            <ErrorRetry error={error} onRetry={refresh} />
          ) : visible.length === 0 ? (
            <Card>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">No matching channels.</div>
            </Card>
          ) : (
            visible.map((p) => (
              <PlatformRow
                key={p.id}
                platform={p}
                dark={dark}
                onConfigure={() => setConfiguring(p)}
                onPair={() => setPairing({ kind: p.id === 'whatsapp' ? 'whatsapp' : 'telegram', platform: p })}
              />
            ))
          )}
        </div>
      </ScreenScaffold>

      {configuring && (
        <PlatformConfigSheet
          platform={configuring}
          dark={dark}
          opsMut={opsMut}
          getAuthScope={getAuthScope}
          onClose={() => setConfiguring(null)}
          onChanged={() => {
            setConfiguring(null);
            refresh();
          }}
        />
      )}

      {pairing && (
        <PairingSheet
          kind={pairing.kind}
          platform={pairing.platform}
          dark={dark}
          opsGet={opsGet}
          opsMut={opsMut}
          getAuthScope={getAuthScope}
          onClose={() => setPairing(null)}
          onDone={() => {
            setPairing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function stateLabel(p: MessagingPlatform): string {
  if (!p.enabled) return 'Disabled';
  if (!p.configured) return 'Needs setup';
  switch (p.state) {
    case 'running':
      return 'Connected';
    case 'pending_restart':
      return 'Restart needed';
    case 'startup_failed':
      return 'Start failed';
    case 'gateway_stopped':
      return 'Gateway stopped';
    default:
      return p.state || 'Enabled';
  }
}

function stateTone(p: MessagingPlatform): string {
  if (!p.enabled || p.state === 'startup_failed') return 'text-red-500';
  if (!p.configured || p.state === 'pending_restart' || p.state === 'gateway_stopped')
    return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

function PlatformRow({
  platform,
  dark,
  onConfigure,
  onPair,
}: {
  platform: MessagingPlatform;
  dark: boolean;
  onConfigure: () => void;
  onPair: () => void;
}) {
  const canPair = platform.id === 'telegram' || platform.id === 'whatsapp';

  const toggle = useOpsMutation<void, boolean, MessagingPlatform[]>({
    mutationFn: (mut, next) => updateMessagingPlatform(mut, platform.id, { enabled: next }),
    done: [['channels']],
    // Flip before the request leaves; the hook rolls the cache back on failure.
    optimistic: {
      key: ['channels'],
      patch: (current, next) => (current ?? []).map((p) => (p.id === platform.id ? { ...p, enabled: next } : p)),
    },
    onError: (e) => toast({ title: 'Update failed', description: errMsg(e), variant: 'destructive' }),
  });

  const test = useOpsMutation<{ ok: boolean; message?: string }, void>({
    mutationFn: (mut) => testMessagingPlatform(mut, platform.id),
    onSuccess: (res) => {
      toast({
        title: res.ok ? `${platform.name} OK` : `${platform.name} test failed`,
        description: res.message || undefined,
        ...(res.ok ? {} : { variant: 'destructive' as const }),
      });
    },
    onError: (e) => toast({ title: 'Test failed', description: errMsg(e), variant: 'destructive' }),
  });

  return (
    <Card>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {platform.name}
            </span>
            <span className={`text-[11px] font-semibold ${stateTone(platform)}`}>{stateLabel(platform)}</span>
          </div>
          {!!platform.description && (
            <div className="mt-0.5 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">
              {platform.description}
            </div>
          )}
          {!!platform.errorMessage && (
            <div className="mt-1 line-clamp-2 text-[11px] text-red-600 dark:text-red-400">{platform.errorMessage}</div>
          )}
        </div>
        <Switch
          checked={platform.enabled}
          disabled={toggle.isPending}
          onCheckedChange={(v) => toggle.mutate(v)}
          aria-label={`${platform.enabled ? 'Disable' : 'Enable'} ${platform.name}`}
        />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
        <Button
          aria-label={`Test ${platform.name}`}
          variant="outline"
          onClick={() => test.mutate()}
          disabled={test.isPending}
          className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
          {test.isPending ? <Spinner size={13} color={brandColor(dark)} /> : <Zap size={13} color={brandColor(dark)} />}
          <span className="text-xs font-semibold">Test</span>
        </Button>
        <Button
          aria-label={`Configure ${platform.name}`}
          variant="outline"
          onClick={onConfigure}
          className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
          <KeyRound size={13} color={brandColor(dark)} />
          <span className="text-xs font-semibold">Configure</span>
        </Button>
        {canPair && (
          <Button
            aria-label={`Pair ${platform.name}`}
            onClick={onPair}
            className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
            <span className="text-xs font-semibold text-white">Pair</span>
          </Button>
        )}
      </div>
    </Card>
  );
}

function PlatformConfigSheet({
  platform,
  dark,
  opsMut,
  getAuthScope,
  onClose,
  onChanged,
}: {
  platform: MessagingPlatform;
  dark: boolean;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;
  getAuthScope: () => unknown;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = useCallback(async () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(drafts)) if (v.trim()) env[k] = v.trim();
    if (Object.keys(env).length === 0) {
      onClose();
      return;
    }
    const scope = getAuthScope();
    setSaving(true);
    setErr(null);
    try {
      await updateMessagingPlatform(opsMut, platform.id, { env });
      if (getAuthScope() !== scope) return;
      toast({ title: 'Credentials saved', description: platform.name });
      onChanged();
    } catch (e) {
      if (getAuthScope() === scope) setErr(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setSaving(false);
    }
  }, [drafts, getAuthScope, onChanged, onClose, opsMut, platform.id, platform.name]);

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">{platform.name} credentials</DialogPrimitive.Title>
          <div className="flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close config"
                onClick={onClose}
                className="h-11 w-11 shrink-0 sm:h-11 sm:w-11">
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Button>
              <div className="min-w-0 flex-1 text-sm font-bold text-neutral-900 dark:text-white">{platform.name}</div>
              <Button
                aria-label="Save credentials"
                onClick={() => void save()}
                disabled={saving}
                className="h-auto sm:h-auto shrink-0 rounded-xl px-4 py-2.5">
                {saving ? <Spinner size={14} color="#fff" /> : <Check size={14} color="#fff" />}
                <span className="text-sm font-semibold text-white">Save</span>
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {platform.envVars.length === 0 ? (
                <p className="text-sm text-neutral-500">This channel has no configurable credentials.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {platform.envVars.map((e) => (
                    <div key={e.key}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <Label className="font-mono text-[11px] text-neutral-600 dark:text-neutral-300">
                          {e.label || e.key}
                        </Label>
                        {e.isSet && (
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            Saved{e.redactedValue ? ` · ${e.redactedValue}` : ''}
                          </span>
                        )}
                      </div>
                      <Input
                        type={e.isSecret ? 'password' : 'text'}
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder={e.isSet ? '•••••••• (saved — leave blank to keep)' : e.description || e.key}
                        value={drafts[e.key] ?? ''}
                        onChange={(ev) => setDrafts((prev) => ({ ...prev, [e.key]: ev.target.value }))}
                        className="rounded-xl font-mono text-sm"
                      />
                      {e.description && <div className="mt-0.5 text-[10px] text-neutral-400">{e.description}</div>}
                    </div>
                  ))}
                </div>
              )}
              {err && <div className="mt-3 whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{err}</div>}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PairingSheet({
  kind,
  platform,
  dark,
  opsGet,
  opsMut,
  getAuthScope,
  onClose,
  onDone,
}: {
  kind: PairingKind;
  platform: MessagingPlatform;
  dark: boolean;
  opsGet: (path: string) => Promise<unknown>;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;
  getAuthScope: () => unknown;
  onClose: () => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<'starting' | 'waiting' | 'ready' | 'error'>('starting');
  const [link, setLink] = useState('');
  const [payload, setPayload] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [allowedIds, setAllowedIds] = useState('');
  const [applying, setApplying] = useState(false);
  const pairingIdRef = useRef<string>('');

  // Start on mount; poll until the remote side reports ready.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scope = getAuthScope();

    const begin = async () => {
      try {
        if (kind === 'telegram') {
          const res = await startTelegramOnboarding(opsMut);
          if (cancelled || getAuthScope() !== scope) return;
          pairingIdRef.current = res.pairingId;
          setLink(res.deepLink);
          setPayload(res.qrPayload);
          setPhase('waiting');
          const poll = async () => {
            try {
              const st = await getTelegramOnboarding(opsGet, res.pairingId);
              if (cancelled || getAuthScope() !== scope) return;
              if (st.status === 'ready') {
                setPhase('ready');
                if (st.ownerUserId) setAllowedIds(st.ownerUserId);
                return;
              }
              timer = setTimeout(poll, 2500);
            } catch (e) {
              if (!cancelled) {
                setError(errMsg(e));
                setPhase('error');
              }
            }
          };
          timer = setTimeout(poll, 2500);
        } else {
          const res = await startWhatsAppOnboarding(opsMut, { mode: 'bot' });
          if (cancelled || getAuthScope() !== scope) return;
          pairingIdRef.current = res.pairingId;
          setPayload(res.qrPayload);
          if (res.status === 'connected') {
            setPhase('ready');
            return;
          }
          setPhase('waiting');
          const poll = async () => {
            try {
              const st = await getWhatsAppOnboarding(opsGet, res.pairingId);
              if (cancelled || getAuthScope() !== scope) return;
              if (st.qrPayload) setPayload(st.qrPayload);
              if (st.status === 'connected') {
                setPhase('ready');
                return;
              }
              if (st.status === 'error' || st.status === 'expired') {
                setError(st.error || 'WhatsApp pairing failed.');
                setPhase('error');
                return;
              }
              timer = setTimeout(poll, 2500);
            } catch (e) {
              if (!cancelled) {
                setError(errMsg(e));
                setPhase('error');
              }
            }
          };
          timer = setTimeout(poll, 2500);
        }
      } catch (e) {
        if (!cancelled) {
          setError(errMsg(e));
          setPhase('error');
        }
      }
    };
    void begin();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Start once per opened sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = useCallback(async () => {
    const scope = getAuthScope();
    setApplying(true);
    setError(null);
    try {
      if (kind === 'telegram') {
        const ids = allowedIds
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (ids.length === 0) {
          setError('Add at least one allowed Telegram user ID.');
          return;
        }
        await applyTelegramOnboarding(opsMut, pairingIdRef.current, ids);
        toast({ title: 'Telegram connected' });
      } else {
        await applyWhatsAppOnboarding(opsMut, pairingIdRef.current, { mode: 'bot' });
        toast({ title: 'WhatsApp connected' });
      }
      if (getAuthScope() !== scope) return;
      onDone();
    } catch (e) {
      if (getAuthScope() === scope) setError(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setApplying(false);
    }
  }, [allowedIds, getAuthScope, kind, onDone, opsMut]);

  const cancel = useCallback(async () => {
    const id = pairingIdRef.current;
    try {
      if (id) {
        if (kind === 'telegram') await cancelTelegramOnboarding(opsMut, id);
        else await cancelWhatsAppOnboarding(opsMut, id);
      }
    } catch {
      /* local close still wins */
    }
    onClose();
  }, [kind, onClose, opsMut]);

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && void cancel()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">Pair {platform.name}</DialogPrimitive.Title>
          <div className="flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close pairing"
                onClick={() => void cancel()}
                className="h-11 w-11 shrink-0 sm:h-11 sm:w-11">
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-neutral-900 dark:text-white">Pair {platform.name}</div>
                <div className="mt-0.5 text-[11px] text-neutral-400">
                  {phase === 'ready' ? 'Linked' : 'Waiting for confirmation…'}
                </div>
              </div>
              {phase === 'ready' && (
                <Button
                  aria-label="Finish pairing"
                  onClick={() => void apply()}
                  disabled={applying}
                  className="h-auto sm:h-auto shrink-0 rounded-xl px-4 py-2.5">
                  {applying ? <Spinner size={14} color="#fff" /> : <Check size={14} color="#fff" />}
                  <span className="text-sm font-semibold text-white">Finish</span>
                </Button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {phase === 'starting' ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Spinner size={24} color={brandColor(dark)} />
                  <div className="mt-3 text-xs text-neutral-500">Starting setup…</div>
                </div>
              ) : phase === 'error' ? (
                <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-xs text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300">
                  {error || 'Setup failed.'}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {kind === 'telegram'
                      ? 'Open the link to create and connect the bot in Telegram. This page updates automatically.'
                      : 'Open WhatsApp on this device and link it, or copy the pairing payload into the bridge.'}
                  </p>
                  {!!link && (
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-brand px-3 py-2 text-sm font-semibold text-brand">
                      <ExternalLink size={15} /> Open in {platform.name}
                    </a>
                  )}
                  {!!payload && (
                    <div>
                      <Label className="mb-1 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">
                        Pairing payload
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input readOnly value={payload} className="flex-1 rounded-xl font-mono text-xs" />
                        <Button
                          variant="outline"
                          aria-label="Copy payload"
                          onClick={() => void writeClipboard(payload).catch(() => {})}
                          className="h-auto sm:h-auto shrink-0 rounded-xl px-3 py-2">
                          <Copy size={14} color={brandColor(dark)} />
                        </Button>
                      </div>
                    </div>
                  )}

                  {phase === 'ready' && kind === 'telegram' && (
                    <div>
                      <Label className="mb-1 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">
                        Allowed Telegram user IDs
                      </Label>
                      <Input
                        value={allowedIds}
                        onChange={(e) => setAllowedIds(e.target.value)}
                        autoCapitalize="none"
                        placeholder="123456789, 987654321"
                        className="rounded-xl font-mono text-sm"
                      />
                      <div className="mt-0.5 text-[10px] text-neutral-400">
                        The detected owner ID is prefilled — add more, comma-separated.
                      </div>
                    </div>
                  )}
                  {phase === 'waiting' && (
                    <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                      <Spinner size={12} color={brandColor(dark)} /> Waiting for the link to be confirmed…
                    </div>
                  )}
                  {error && <div className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{error}</div>}
                </div>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
