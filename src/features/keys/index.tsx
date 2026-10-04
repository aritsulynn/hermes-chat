// Keys / Env route — manage the `.env` credentials the agent authenticates with.
//
// Ported from Hermes Desktop's `EnvPage.tsx`, scoped to what a phone drives
// well: a searchable, category-grouped list of env vars with set/unset state,
// inline edit + save (with a live provider probe), a reveal-on-demand for
// saved secrets, delete, and add-a-custom-key. The desktop's custom
// provider-endpoints flow is a separate surface and is not ported here.
import { useCallback, useMemo, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Eye, EyeOff, KeyRound, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { useOpsMutation, useOpsQuery } from '../../store/ops-query';
import { errMsg } from '../../utils/messages';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ConfirmDialog } from '../../components/ui/dialog';
import { toast } from '../../components/ui/toast';
import { writeClipboard } from '../../services/clipboard';
import { brandColor, screenStyle } from '../../theme';
import {
  deleteEnvVar,
  getEnvVars,
  groupEnvVars,
  revealEnvVar,
  setEnvVar,
  validateProviderKey,
  type EnvVarInfo,
} from '../../services/env';

const CATEGORY_LABELS: Record<string, string> = {
  provider: 'Providers',
  custom: 'Custom keys',
  gateway: 'Gateway',
  api: 'API',
  proxy: 'Proxy',
};

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1);
}

// Stable empty map, so `?? EMPTY_VARS` doesn't hand the filter memos a fresh
// object on every render while the query is pending.
const EMPTY_VARS: Record<string, EnvVarInfo> = {};

export function EnvScreen() {
  const { authed, activeProfile, opsMut, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);

  // One scoped query replaces the four useState slots + epoch-guarded load.
  const list = useOpsQuery<Record<string, EnvVarInfo>>({
    key: ['env'],
    get: (get) => getEnvVars(get, activeProfile),
    enabled: authed,
  });
  const vars = list.data ?? EMPTY_VARS;
  const loading = list.isPending;
  const refreshing = list.isRefetching;
  const error = list.error ? errMsg(list.error) : null;
  const refresh = useCallback(() => void list.refetch(), [list]);

  const [query, setQuery] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [editing, setEditing] = useState<{ key: string; info: EnvVarInfo } | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => void } | null>(null);

  const ql = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const all = groupEnvVars(vars);
    if (!ql) return all;
    return all
      .map((g) => ({
        category: g.category,
        entries: g.entries.filter(
          ([key, info]) =>
            key.toLowerCase().includes(ql) ||
            info.description.toLowerCase().includes(ql) ||
            info.providerLabel.toLowerCase().includes(ql),
        ),
      }))
      .filter((g) => g.entries.length > 0);
  }, [vars, ql]);

  const configured = useMemo(() => Object.values(vars).filter((v) => v.isSet && !v.channelManaged).length, [vars]);

  const del = useOpsMutation<void, string>({
    mutationFn: (mut, key) => deleteEnvVar(mut, key, activeProfile),
    done: [['env']],
    onSuccess: (_d, key) => {
      toast({ title: 'Key deleted', description: key });
    },
    onError: (e) => toast({ title: 'Delete failed', description: errMsg(e), variant: 'destructive' }),
  });

  const handleDelete = useCallback(
    (key: string) => {
      setConfirm({
        title: 'Delete key',
        body: `Remove ${key} from .env? Any credential mirror in config.yaml is cleared too.`,
        run: () => del.mutate(key),
      });
    },
    [del],
  );

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
      <ScreenScaffold
        header={
          <>
            <ScreenHeader
              title="Keys"
              subtitle={loading ? 'Loading…' : `${configured} configured`}
              actions={
                <div className="flex items-center gap-1">
                  <HeaderIconButton aria-label="Add custom key" onClick={() => setAdding(true)}>
                    <Plus size={20} color={dark ? '#e5e5e5' : '#333'} />
                  </HeaderIconButton>
                  <HeaderIconButton aria-label="Refresh keys" onClick={refresh}>
                    <RefreshCw
                      size={20}
                      color={dark ? '#e5e5e5' : '#333'}
                      className={refreshing ? 'animate-spin' : ''}
                    />
                  </HeaderIconButton>
                </div>
              }
            />
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search keys…"
                aria-label="Search keys"
                autoCapitalize="none"
                className="flex-1 rounded-xl border border-border px-3 py-2 text-[14px] text-neutral-950 dark:text-neutral-100"
              />
              <Button
                variant="ghost"
                aria-pressed={!showAdvanced}
                onClick={() => setShowAdvanced((v) => !v)}
                className="h-auto sm:h-auto shrink-0 rounded-lg border border-border px-3 py-2">
                <span className="text-xs font-semibold">{showAdvanced ? 'All' : 'Common'}</span>
              </Button>
            </div>
          </>
        }
        contentClassName="px-4 py-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          {loading && !refreshing ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={24} color={brand} />
            </div>
          ) : error ? (
            <ErrorRetry error={error} onRetry={refresh} />
          ) : groups.length === 0 ? (
            <Card>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">No matching keys.</div>
            </Card>
          ) : (
            groups.map((g) => {
              let entries = g.entries;
              if (!showAdvanced) entries = entries.filter(([, info]) => !info.advanced || info.isSet);
              if (entries.length === 0) return null;
              return (
                <div key={g.category} className="flex flex-col gap-2">
                  <div className="px-1 text-[11px] font-bold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                    {categoryLabel(g.category)} · {entries.filter(([, i]) => i.isSet).length}/{entries.length}
                  </div>
                  {entries.map(([key, info]) => (
                    <EnvRow
                      key={key}
                      name={key}
                      info={info}
                      dark={dark}
                      opsMut={opsMut}
                      getAuthScope={getAuthScope}
                      onEdit={() => setEditing({ key, info })}
                      onDelete={() => handleDelete(key)}
                    />
                  ))}
                </div>
              );
            })
          )}
        </div>
      </ScreenScaffold>

      {editing && (
        <EnvEditSheet
          name={editing.key}
          info={editing.info}
          dark={dark}
          opsMut={opsMut}
          profile={activeProfile}
          getAuthScope={getAuthScope}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {adding && (
        <AddKeySheet
          existing={Object.keys(vars)}
          dark={dark}
          opsMut={opsMut}
          profile={activeProfile}
          getAuthScope={getAuthScope}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            refresh();
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

function EnvRow({
  name,
  info,
  dark,
  opsMut,
  getAuthScope,
  onEdit,
  onDelete,
}: {
  name: string;
  info: EnvVarInfo;
  dark: boolean;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;
  getAuthScope: () => unknown;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  const toggleReveal = useCallback(async () => {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    const scope = getAuthScope();
    setRevealing(true);
    try {
      const value = await revealEnvVar(opsMut, name);
      if (getAuthScope() !== scope) return;
      setRevealed(value);
    } catch (e) {
      if (getAuthScope() === scope) toast({ title: 'Reveal failed', description: errMsg(e), variant: 'destructive' });
    } finally {
      if (getAuthScope() === scope) setRevealing(false);
    }
  }, [getAuthScope, name, opsMut, revealed]);

  return (
    <Card>
      <div className="flex items-start gap-2">
        <KeyRound
          size={16}
          color={info.isSet ? brandColor(dark) : dark ? '#888' : '#999'}
          className="mt-0.5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-mono text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
              {name}
            </span>
            <span
              className={`text-[10px] font-semibold ${info.isSet ? 'text-emerald-600 dark:text-emerald-400' : 'text-neutral-400'}`}>
              {info.isSet ? 'set' : 'not set'}
            </span>
            {!!info.providerLabel && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-neutral-500">
                {info.providerLabel}
              </span>
            )}
            {info.advanced && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-neutral-500">
                advanced
              </span>
            )}
          </div>
          {!!info.description && (
            <div className="mt-0.5 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">{info.description}</div>
          )}
          {info.isSet && info.isPassword && (
            <div className="mt-1 truncate font-mono text-[11px] text-neutral-400">
              {revealed !== null ? revealed : info.redactedValue}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
        <Button
          aria-label={`Edit ${name}`}
          variant="outline"
          onClick={onEdit}
          className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
          <span className="text-xs font-semibold">{info.isSet ? 'Replace' : 'Set'}</span>
        </Button>
        {info.isSet && info.isPassword && (
          <Button
            aria-label={`Reveal ${name}`}
            variant="outline"
            onClick={() => void toggleReveal()}
            disabled={revealing}
            className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
            {revealing ? (
              <Spinner size={13} color={brandColor(dark)} />
            ) : revealed !== null ? (
              <EyeOff size={13} color={brandColor(dark)} />
            ) : (
              <Eye size={13} color={brandColor(dark)} />
            )}
            <span className="text-xs font-semibold">{revealed !== null ? 'Hide' : 'Reveal'}</span>
          </Button>
        )}
        {revealed !== null && (
          <Button
            aria-label={`Copy ${name}`}
            variant="outline"
            onClick={() =>
              void writeClipboard(revealed)
                .then(() => toast({ title: 'Copied' }))
                .catch(() => {})
            }
            className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
            <span className="text-xs font-semibold">Copy</span>
          </Button>
        )}
        {info.isSet && (
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={`Delete ${name}`}
            onClick={onDelete}
            className="ml-auto rounded-lg">
            <Trash2 size={15} color="#ef4444" />
          </Button>
        )}
      </div>
    </Card>
  );
}

function EnvEditSheet({
  name,
  info,
  dark,
  opsMut,
  profile,
  getAuthScope,
  onClose,
  onSaved,
}: {
  name: string;
  info: EnvVarInfo;
  dark: boolean;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;
  profile: string | null;
  getAuthScope: () => unknown;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setErr('Enter a value first.');
      return;
    }
    const scope = getAuthScope();
    setBusy(true);
    setErr(null);
    try {
      // Probe recognised provider keys so a mistyped credential is caught
      // before it is persisted; an unreachable probe warns but does not block.
      if (info.category === 'provider') {
        const probe = await validateProviderKey(opsMut, name, trimmed);
        if (getAuthScope() !== scope) return;
        if (!probe.ok && probe.reachable) {
          setErr(probe.message || 'That key was rejected.');
          return;
        }
      }
      await setEnvVar(opsMut, name, trimmed, profile);
      if (getAuthScope() !== scope) return;
      toast({ title: 'Key saved', description: name });
      onSaved();
    } catch (e) {
      if (getAuthScope() === scope) setErr(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setBusy(false);
    }
  }, [getAuthScope, info.category, name, onSaved, opsMut, profile, value]);

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">Set {name}</DialogPrimitive.Title>
          <div className="flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close editor"
                onClick={onClose}
                className="h-11 w-11 shrink-0 sm:h-11 sm:w-11">
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Button>
              <div className="min-w-0 flex-1 truncate font-mono text-sm font-bold text-neutral-900 dark:text-white">
                {name}
              </div>
              <Button
                aria-label="Save key"
                onClick={() => void save()}
                disabled={busy}
                className="h-auto sm:h-auto shrink-0 rounded-xl px-4 py-2.5">
                {busy ? <Spinner size={14} color="#fff" /> : <Check size={14} color="#fff" />}
                <span className="text-sm font-semibold text-white">Save</span>
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="flex flex-col gap-3">
                {!!info.description && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">{info.description}</p>
                )}
                {!!info.url && (
                  <a href={info.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand">
                    Open provider page
                  </a>
                )}
                <div>
                  <Label className="mb-1 text-xs font-semibold">{info.isSet ? 'New value' : 'Value'}</Label>
                  <Input
                    type={info.isPassword ? 'password' : 'text'}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder={info.isSet ? '•••••••• (saved — enter to replace)' : name}
                    className="rounded-xl font-mono text-sm"
                  />
                  {info.category === 'provider' && (
                    <div className="mt-1 text-[10px] text-neutral-400">
                      The key is checked against the provider before it is saved.
                    </div>
                  )}
                </div>
                {err && <div className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{err}</div>}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function AddKeySheet({
  existing,
  dark,
  opsMut,
  profile,
  getAuthScope,
  onClose,
  onAdded,
}: {
  existing: string[];
  dark: boolean;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;
  profile: string | null;
  getAuthScope: () => unknown;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = useCallback(async () => {
    const k = key.trim();
    const v = value.trim();
    if (!k) {
      setErr('Key name is required.');
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      setErr('Use a shell-style name: letters, digits and underscores, not starting with a digit.');
      return;
    }
    if (!v) {
      setErr('Value is required.');
      return;
    }
    const scope = getAuthScope();
    setBusy(true);
    setErr(null);
    try {
      await setEnvVar(opsMut, k, v, profile);
      if (getAuthScope() !== scope) return;
      toast({ title: 'Key added', description: k });
      onAdded();
    } catch (e) {
      if (getAuthScope() === scope) setErr(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setBusy(false);
    }
  }, [getAuthScope, key, onAdded, opsMut, profile, value]);

  const duplicate = existing.includes(key.trim());

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">Add custom key</DialogPrimitive.Title>
          <div className="flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close add key"
                onClick={onClose}
                className="h-11 w-11 shrink-0 sm:h-11 sm:w-11">
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Button>
              <div className="min-w-0 flex-1 text-sm font-bold text-neutral-900 dark:text-white">Add custom key</div>
              <Button
                aria-label="Add key"
                onClick={() => void add()}
                disabled={busy}
                className="h-auto sm:h-auto shrink-0 rounded-xl px-4 py-2.5">
                {busy ? <Spinner size={14} color="#fff" /> : <Plus size={14} color="#fff" />}
                <span className="text-sm font-semibold text-white">Add</span>
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="flex flex-col gap-3">
                <div>
                  <Label className="mb-1 text-xs font-semibold">Key name *</Label>
                  <Input
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder="MY_API_KEY"
                    className="rounded-xl font-mono text-sm"
                  />
                  {duplicate && (
                    <div className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                      This key already exists — saving overwrites it.
                    </div>
                  )}
                </div>
                <div>
                  <Label className="mb-1 text-xs font-semibold">Value *</Label>
                  <Input
                    type="password"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="secret value"
                    className="rounded-xl font-mono text-sm"
                  />
                  <div className="mt-0.5 text-[10px] text-neutral-400">
                    Unknown keys are treated as secrets and redacted in the list.
                  </div>
                </div>
                {err && <div className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{err}</div>}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
