// Webhooks route — manage event subscriptions GitHub/GitLab/etc. deliver to.
//
// Ported from Hermes Desktop's `WebhooksPage.tsx`. Enables the platform, lists
// routes with their ingest URL (secret redacted), toggles and deletes them, and
// creates a new one — surfacing the generated HMAC secret exactly once.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, RefreshCw, Trash2, Webhook, X } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { ConfirmDialog } from '../../components/ui/dialog';
import { toast } from '../../components/ui/toast';
import { brandColor, screenStyle } from '../../theme';
import { writeClipboard } from '../../services/clipboard';
import {
  createWebhook,
  deleteWebhook,
  enableWebhooks,
  getWebhooks,
  setWebhookEnabled,
  type WebhookRoute,
} from '../../services/webhooks';

const DELIVER_OPTIONS = ['log', 'telegram', 'discord', 'slack', 'local'] as const;

export function WebhooksScreen() {
  const { authed, opsGet, opsMut, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);

  const [enabled, setEnabled] = useState(false);
  const [routes, setRoutes] = useState<WebhookRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => void } | null>(null);

  const loadEpoch = useRef(0);
  const load = useCallback(
    async (isRefresh = false) => {
      const scope = getAuthScope();
      const epoch = ++loadEpoch.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const state = await getWebhooks(opsGet);
        if (getAuthScope() !== scope || loadEpoch.current !== epoch) return;
        setEnabled(state.enabled);
        setRoutes(state.subscriptions);
      } catch (e) {
        if (getAuthScope() === scope && loadEpoch.current === epoch) setError(errMsg(e));
      } finally {
        if (getAuthScope() === scope && loadEpoch.current === epoch) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [getAuthScope, opsGet],
  );

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  const handleEnable = useCallback(async () => {
    const scope = getAuthScope();
    setEnabling(true);
    try {
      const { needRestart } = await enableWebhooks(opsMut);
      if (getAuthScope() !== scope) return;
      toast({
        title: 'Webhook platform enabled',
        description: needRestart ? 'A gateway restart is required to go live.' : undefined,
      });
      await load(true);
    } catch (e) {
      if (getAuthScope() === scope) toast({ title: 'Enable failed', description: errMsg(e), variant: 'destructive' });
    } finally {
      if (getAuthScope() === scope) setEnabling(false);
    }
  }, [getAuthScope, load, opsMut]);

  const handleToggle = useCallback(
    async (route: WebhookRoute, next: boolean) => {
      const scope = getAuthScope();
      setToggling(route.name);
      setRoutes((prev) => prev.map((r) => (r.name === route.name ? { ...r, enabled: next } : r)));
      try {
        await setWebhookEnabled(opsMut, route.name, next);
        if (getAuthScope() !== scope) return;
      } catch (e) {
        if (getAuthScope() !== scope) return;
        setRoutes((prev) => prev.map((r) => (r.name === route.name ? { ...r, enabled: !next } : r)));
        toast({ title: 'Toggle failed', description: errMsg(e), variant: 'destructive' });
      } finally {
        if (getAuthScope() === scope) setToggling(null);
      }
    },
    [getAuthScope, opsMut],
  );

  const handleDelete = useCallback(
    (route: WebhookRoute) => {
      setConfirm({
        title: 'Delete webhook',
        body: `Delete "${route.name}"? Its ingest URL stops working immediately.`,
        run: async () => {
          const scope = getAuthScope();
          try {
            await deleteWebhook(opsMut, route.name);
            if (getAuthScope() !== scope) return;
            toast({ title: 'Webhook deleted', description: route.name });
            await load(true);
          } catch (e) {
            if (getAuthScope() === scope)
              toast({ title: 'Delete failed', description: errMsg(e), variant: 'destructive' });
          }
        },
      });
    },
    [getAuthScope, load, opsMut],
  );

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
      <ScreenScaffold
        header={
          <ScreenHeader
            title="Webhooks"
            subtitle={`${routes.length} route(s) · ${enabled ? 'enabled' : 'disabled'}`}
            actions={
              <div className="flex items-center gap-1">
                {enabled && (
                  <HeaderIconButton aria-label="New webhook" onClick={() => setCreateOpen(true)}>
                    <Webhook size={20} color={dark ? '#e5e5e5' : '#333'} />
                  </HeaderIconButton>
                )}
                <HeaderIconButton aria-label="Refresh webhooks" onClick={() => void load(true)}>
                  <RefreshCw size={20} color={dark ? '#e5e5e5' : '#333'} className={refreshing ? 'animate-spin' : ''} />
                </HeaderIconButton>
              </div>
            }
          />
        }
        contentClassName="px-4 py-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          {loading && !refreshing ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={24} color={brand} />
            </div>
          ) : error ? (
            <ErrorRetry error={error} onRetry={() => void load()} />
          ) : !enabled ? (
            <Card>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Webhook size={17} color={brand} />
                  <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Webhook platform is disabled
                  </div>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Enable it so GitHub, GitLab and other services can deliver events to the agent.
                </p>
                <Button
                  aria-label="Enable webhooks"
                  onClick={() => void handleEnable()}
                  disabled={enabling}
                  className="h-auto sm:h-auto self-start rounded-xl px-4 py-2.5">
                  {enabling ? <Spinner size={14} color="#fff" /> : <Check size={14} color="#fff" />}
                  <span className="text-sm font-semibold text-white">Enable webhooks</span>
                </Button>
              </div>
            </Card>
          ) : routes.length === 0 ? (
            <Card>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                No webhook routes yet. Tap the icon above to create one.
              </div>
            </Card>
          ) : (
            routes.map((route) => (
              <Card key={route.name}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-mono text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        {route.name}
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-neutral-600 dark:text-neutral-300">
                        {route.deliver}
                        {route.deliverOnly ? ' (direct)' : ''}
                      </span>
                      {route.secretSet && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-neutral-500">
                          secret set
                        </span>
                      )}
                    </div>
                    {!!route.description && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">
                        {route.description}
                      </div>
                    )}
                    {!!route.url && (
                      <button
                        type="button"
                        aria-label={`Copy ${route.name} URL`}
                        onClick={() => void writeClipboard(route.url).catch(() => {})}
                        className="mt-1 block max-w-full truncate text-left font-mono text-[11px] text-brand">
                        {route.url}
                      </button>
                    )}
                    {route.events.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {route.events.slice(0, 6).map((ev) => (
                          <span
                            key={ev}
                            className="rounded-md border border-border px-1.5 py-px font-mono text-[10px] text-neutral-500">
                            {ev}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {toggling === route.name ? (
                    <Spinner size={14} color={brand} />
                  ) : (
                    <Switch
                      checked={route.enabled}
                      onCheckedChange={(v) => void handleToggle(route, v)}
                      aria-label={`${route.enabled ? 'Disable' : 'Enable'} ${route.name}`}
                    />
                  )}
                </div>
                <div className="mt-2.5 flex items-center justify-end border-t border-border pt-2.5">
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={`Delete ${route.name}`}
                    onClick={() => handleDelete(route)}
                    className="rounded-lg">
                    <Trash2 size={15} color="#ef4444" />
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
      </ScreenScaffold>

      {createOpen && (
        <CreateWebhookSheet
          dark={dark}
          opsMut={opsMut}
          getAuthScope={getAuthScope}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void load(true);
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        description={confirm?.body}
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirm?.run()}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
      />
    </div>
  );
}

function CreateWebhookSheet({
  dark,
  opsMut,
  getAuthScope,
  onClose,
  onCreated,
}: {
  dark: boolean;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;
  getAuthScope: () => unknown;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState('');
  const [prompt, setPrompt] = useState('');
  const [deliver, setDeliver] = useState<string>('log');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!name.trim()) {
      setErr('Name is required.');
      return;
    }
    const scope = getAuthScope();
    setSaving(true);
    setErr(null);
    try {
      const res = await createWebhook(opsMut, {
        name: name.trim().toLowerCase().replace(/\s+/g, '-'),
        description: description.trim() || undefined,
        events: events.trim()
          ? events
              .trim()
              .split(/[\s,]+/)
              .filter(Boolean)
          : [],
        prompt: prompt.trim() || undefined,
        deliver,
      });
      if (getAuthScope() !== scope) return;
      if (res.secret) {
        // Surface the one-time secret; the route summary on disk redacts it.
        setSecret(res.secret);
        toast({ title: 'Webhook created', description: 'Copy the secret now — it is shown once.' });
      } else {
        onCreated();
      }
    } catch (e) {
      if (getAuthScope() === scope) setErr(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setSaving(false);
    }
  }, [deliver, description, events, getAuthScope, name, onCreated, opsMut, prompt]);

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">New webhook</DialogPrimitive.Title>
          <div className="flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close webhook"
                onClick={onClose}
                className="h-11 w-11 shrink-0 sm:h-11 sm:w-11">
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Button>
              <div className="min-w-0 flex-1 text-sm font-bold text-neutral-900 dark:text-white">New webhook</div>
              {!secret && (
                <Button
                  aria-label="Create webhook"
                  onClick={() => void save()}
                  disabled={saving}
                  className="h-auto sm:h-auto shrink-0 rounded-xl px-4 py-2.5">
                  {saving ? <Spinner size={14} color="#fff" /> : <Check size={14} color="#fff" />}
                  <span className="text-sm font-semibold text-white">Create</span>
                </Button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {secret ? (
                <div className="flex flex-col gap-2">
                  <div className="rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    Copy this signing secret now — it is shown exactly once and stored redacted.
                  </div>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={secret} className="flex-1 rounded-xl font-mono text-xs" />
                    <Button
                      aria-label="Copy secret"
                      onClick={() => void writeClipboard(secret).catch(() => {})}
                      className="h-auto sm:h-auto rounded-xl px-3 py-2">
                      <span className="text-xs font-semibold text-white">Copy</span>
                    </Button>
                  </div>
                  <Button
                    aria-label="Done"
                    onClick={onCreated}
                    className="h-auto sm:h-auto mt-2 self-start rounded-xl px-4 py-2.5">
                    <span className="text-sm font-semibold text-white">Done</span>
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div>
                    <Label className="mb-1 text-xs font-semibold">Name *</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoCapitalize="none"
                      placeholder="github-push"
                      className="rounded-xl"
                    />
                  </div>
                  <div>
                    <Label className="mb-1 text-xs font-semibold">Description</Label>
                    <Input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What this route does"
                      className="rounded-xl"
                    />
                  </div>
                  <div>
                    <Label className="mb-1 text-xs font-semibold">Events (space or comma separated)</Label>
                    <Input
                      value={events}
                      onChange={(e) => setEvents(e.target.value)}
                      autoCapitalize="none"
                      placeholder="push pull_request"
                      className="rounded-xl font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label className="mb-1 text-xs font-semibold">Prompt</Label>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Instructions for the agent when an event arrives…"
                      className="min-h-24 w-full rounded-xl border border-border px-3 py-2 text-sm text-neutral-950 dark:bg-input/30 dark:text-neutral-100"
                    />
                  </div>
                  <div>
                    <Label className="mb-1 text-xs font-semibold">Deliver</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {DELIVER_OPTIONS.map((d) => (
                        <Button
                          key={d}
                          variant="ghost"
                          aria-pressed={deliver === d}
                          onClick={() => setDeliver(d)}
                          className={`h-auto sm:h-auto rounded-lg border px-3 py-1.5 ${deliver === d ? 'border-brand bg-brand/10' : 'border-border'}`}>
                          <span
                            className={`text-xs font-semibold ${deliver === d ? 'text-brand' : 'text-neutral-600 dark:text-neutral-300'}`}>
                            {d}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                  {err && <div className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{err}</div>}
                </div>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
