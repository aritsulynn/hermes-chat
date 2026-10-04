// Profiles route — create, rename, delete, and edit agent profiles.
//
// Ported from Hermes Desktop's `ProfilesPage.tsx`, scoped to the pieces that
// need no separate builder: the profile list with model/description editing,
// the SOUL.md editor, rename/delete/export, and switching the sticky active
// profile. (The desktop's ProfileBuilderPage is a separate surface.)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Bot, Check, Download, FileText, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { useOpsMutation, useOpsQuery } from '../../store/ops-query';
import { errMsg } from '../../utils/messages';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { ConfirmDialog } from '../../components/ui/dialog';
import { toast } from '../../components/ui/toast';
import { brandColor, screenStyle } from '../../theme';
import {
  createProfile,
  deleteProfile,
  describeProfileAuto,
  exportProfile,
  getProfileSoul,
  getProfiles,
  renameProfile,
  setActiveProfile,
  updateProfileDescription,
  updateProfileSoul,
  type ProfileInfo,
} from '../../services/profiles';

export function ProfilesScreen() {
  const { authed, activeProfile, opsGet, opsMut, getAuthScope, refreshProfiles, switchProfile } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);

  const [editing, setEditing] = useState<ProfileInfo | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => void } | null>(null);

  // One scoped query replaces the four useState slots + epoch-guarded load.
  const list = useOpsQuery<ProfileInfo[]>({
    key: ['profiles'],
    get: (get) => getProfiles(get),
    enabled: authed,
  });
  const profiles = list.data ?? [];
  const loading = list.isPending;
  const refreshing = list.isRefetching;
  const error = list.error ? errMsg(list.error) : null;
  const refresh = useCallback(() => void list.refetch(), [list]);

  const useProfileMut = useOpsMutation<void, { name: string }>({
    mutationFn: async (mut, v) => {
      await setActiveProfile(mut, v.name);
      // Retarget the live client too — the list and everything scoped follow.
      await switchProfile(v.name);
    },
    done: [['profiles']],
    onSuccess: (_d, v) => {
      toast({ title: 'Switched profile', description: v.name });
    },
    onError: (e) => toast({ title: 'Switch failed', description: errMsg(e), variant: 'destructive' }),
  });

  const exporter = useOpsMutation<string, { name: string }>({
    mutationFn: (mut, v) => exportProfile(mut, v.name),
    onSuccess: (archive) => {
      toast({ title: 'Profile exported', description: archive || undefined });
    },
    onError: (e) => toast({ title: 'Export failed', description: errMsg(e), variant: 'destructive' }),
  });

  const del = useOpsMutation<void, { name: string }>({
    mutationFn: (mut, v) => deleteProfile(mut, v.name),
    done: [['profiles']],
    onSuccess: (_d, v) => {
      toast({ title: 'Profile deleted', description: v.name });
    },
    onError: (e) => toast({ title: 'Delete failed', description: errMsg(e), variant: 'destructive' }),
  });

  // Which row's Use/Export button is in flight.
  const busyName =
    (useProfileMut.isPending && useProfileMut.variables?.name) ||
    (exporter.isPending && exporter.variables?.name) ||
    null;

  const doUseProfile = useCallback((p: ProfileInfo) => useProfileMut.mutate({ name: p.name }), [useProfileMut]);

  const doExport = useCallback((p: ProfileInfo) => exporter.mutate({ name: p.name }), [exporter]);

  const handleDelete = useCallback(
    (p: ProfileInfo) => {
      setConfirm({
        title: 'Delete profile',
        body: `Delete profile "${p.name}"? Its directory and stored state are removed. This cannot be undone.`,
        run: () => del.mutate({ name: p.name }),
      });
    },
    [del],
  );

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
      <ScreenScaffold
        header={
          <ScreenHeader
            title="Profiles"
            subtitle={`${profiles.length} profile(s)`}
            actions={
              <div className="flex items-center gap-1">
                <HeaderIconButton aria-label="New profile" onClick={() => setCreating(true)}>
                  <Plus size={20} color={dark ? '#e5e5e5' : '#333'} />
                </HeaderIconButton>
                <HeaderIconButton aria-label="Refresh profiles" onClick={refresh}>
                  <RefreshCw size={20} color={dark ? '#e5e5e5' : '#333'} className={refreshing ? 'animate-spin' : ''} />
                </HeaderIconButton>
              </div>
            }
          />
        }
        contentClassName="px-4 py-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          {loading && !refreshing ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={24} color={brand} />
            </div>
          ) : error ? (
            <ErrorRetry error={error} onRetry={() => refresh()} />
          ) : profiles.length === 0 ? (
            <Card>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">No profiles found.</div>
            </Card>
          ) : (
            profiles.map((p) => {
              const isActive = p.name === activeProfile;
              return (
                <Card key={p.name}>
                  <div className="flex items-start gap-2">
                    <Bot size={17} color={p.gatewayRunning ? '#0284c7' : dark ? '#888' : '#666'} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                          {p.displayName || p.name}
                        </span>
                        {p.isDefault && (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-neutral-500">
                            default
                          </span>
                        )}
                        {isActive && (
                          <span className="rounded-full border border-brand bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                            Active
                          </span>
                        )}
                        {p.gatewayRunning && (
                          <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                            gateway
                          </span>
                        )}
                      </div>
                      {!!p.description && (
                        <div className="mt-0.5 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">
                          {p.description}
                        </div>
                      )}
                      <div className="mt-0.5 text-[11px] text-neutral-400">
                        {[p.provider && p.model ? `${p.provider}/${p.model}` : p.model || '', `${p.skillCount} skills`]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
                    <Button
                      aria-label={`Edit ${p.name}`}
                      variant="outline"
                      onClick={() => setEditing(p)}
                      className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
                      <Pencil size={13} color={brand} />
                      <span className="text-xs font-semibold">Edit</span>
                    </Button>
                    {!isActive && (
                      <Button
                        aria-label={`Use ${p.name}`}
                        onClick={() => void doUseProfile(p)}
                        disabled={busyName === p.name}
                        className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
                        {busyName === p.name ? <Spinner size={13} color="#fff" /> : <Check size={13} color="#fff" />}
                        <span className="text-xs font-semibold text-white">Use</span>
                      </Button>
                    )}
                    <Button
                      aria-label={`Export ${p.name}`}
                      variant="outline"
                      onClick={() => void doExport(p)}
                      disabled={busyName === p.name}
                      className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
                      <Download size={13} color={brand} />
                      <span className="text-xs font-semibold">Export</span>
                    </Button>
                    {!p.isDefault && (
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={`Delete ${p.name}`}
                        onClick={() => handleDelete(p)}
                        className="ml-auto rounded-lg">
                        <Trash2 size={15} color="#ef4444" />
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </ScreenScaffold>

      {editing && (
        <ProfileEditorSheet
          profile={editing}
          dark={dark}
          opsGet={opsGet}
          opsMut={opsMut}
          getAuthScope={getAuthScope}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {creating && (
        <CreateProfileSheet
          dark={dark}
          opsMut={opsMut}
          getAuthScope={getAuthScope}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
            void refreshProfiles();
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

function ProfileEditorSheet({
  profile,
  dark,
  opsGet,
  opsMut,
  getAuthScope,
  onClose,
  onChanged,
}: {
  profile: ProfileInfo;
  dark: boolean;
  opsGet: (path: string) => Promise<unknown>;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;
  getAuthScope: () => unknown;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<'general' | 'soul'>('general');
  const [name, setName] = useState(profile.name);
  const [description, setDescription] = useState(profile.description);
  const [soul, setSoul] = useState('');
  const [soulLoaded, setSoulLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getProfileSoul(opsGet, profile.name)
      .then((res) => {
        if (cancelled) return;
        setSoul(res.content);
        setSoulLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setSoulLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [opsGet, profile.name]);

  const saveGeneral = useCallback(async () => {
    const scope = getAuthScope();
    setBusy(true);
    setErr(null);
    try {
      if (description.trim() !== profile.description) {
        await updateProfileDescription(opsMut, profile.name, description.trim());
      }
      if (name.trim() && name.trim() !== profile.name) {
        await renameProfile(opsMut, profile.name, name.trim());
      }
      if (getAuthScope() !== scope) return;
      toast({ title: 'Profile updated' });
      onChanged();
    } catch (e) {
      if (getAuthScope() === scope) setErr(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setBusy(false);
    }
  }, [description, getAuthScope, name, onChanged, opsMut, profile.description, profile.name]);

  const autoDescribe = useCallback(async () => {
    const scope = getAuthScope();
    setBusy(true);
    setErr(null);
    try {
      const res = await describeProfileAuto(opsMut, profile.name, true);
      if (getAuthScope() !== scope) return;
      if (res.ok && res.description) setDescription(res.description);
      else setErr(res.reason || 'Auto-describe returned no text.');
    } catch (e) {
      if (getAuthScope() === scope) setErr(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setBusy(false);
    }
  }, [getAuthScope, opsMut, profile.name]);

  const saveSoul = useCallback(async () => {
    const scope = getAuthScope();
    setBusy(true);
    setErr(null);
    try {
      await updateProfileSoul(opsMut, profile.name, soul);
      if (getAuthScope() !== scope) return;
      toast({ title: 'SOUL.md saved' });
      onChanged();
    } catch (e) {
      if (getAuthScope() === scope) setErr(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setBusy(false);
    }
  }, [getAuthScope, onChanged, opsMut, profile.name, soul]);

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">Edit profile {profile.name}</DialogPrimitive.Title>
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
              <div className="min-w-0 flex-1 text-sm font-bold text-neutral-900 dark:text-white">{profile.name}</div>
              <Button
                aria-label="Save profile"
                onClick={() => void (tab === 'general' ? saveGeneral() : saveSoul())}
                disabled={busy || (tab === 'soul' && !soulLoaded)}
                className="h-auto sm:h-auto shrink-0 rounded-xl px-4 py-2.5">
                {busy ? <Spinner size={14} color="#fff" /> : <Check size={14} color="#fff" />}
                <span className="text-sm font-semibold text-white">Save</span>
              </Button>
            </div>

            <div className="flex gap-1.5 border-b border-border px-4 py-2">
              {(
                [
                  ['general', 'General'],
                  ['soul', 'SOUL.md'],
                ] as const
              ).map(([t, label]) => (
                <Button
                  key={t}
                  variant="ghost"
                  aria-pressed={tab === t}
                  onClick={() => setTab(t)}
                  className={`h-auto sm:h-auto rounded-lg border px-3 py-1.5 ${tab === t ? 'border-brand bg-brand/10' : 'border-border'}`}>
                  <span
                    className={`text-xs font-semibold ${tab === t ? 'text-brand' : 'text-neutral-600 dark:text-neutral-300'}`}>
                    {label}
                  </span>
                </Button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {tab === 'general' ? (
                <div className="flex flex-col gap-3">
                  <div>
                    <Label className="mb-1 text-xs font-semibold">Name</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoCapitalize="none"
                      className="rounded-xl"
                    />
                    {profile.isDefault && (
                      <div className="mt-0.5 text-[10px] text-neutral-400">
                        Renaming the default profile only changes its display name.
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <Label className="text-xs font-semibold">Description</Label>
                      <Button
                        variant="ghost"
                        aria-label="Auto-describe"
                        onClick={() => void autoDescribe()}
                        disabled={busy}
                        className="h-auto sm:h-auto rounded-lg px-2 py-1">
                        <span className="text-[11px] font-semibold text-brand">Auto</span>
                      </Button>
                    </div>
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What this profile is for"
                      className="min-h-20 rounded-xl"
                    />
                  </div>
                  {err && <div className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{err}</div>}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                    <FileText size={12} /> SOUL.md — this profile's persona / system instructions
                  </div>
                  {soulLoaded ? (
                    <Textarea
                      value={soul}
                      onChange={(e) => setSoul(e.target.value)}
                      spellCheck={false}
                      className="min-h-[46vh] rounded-xl font-mono text-xs leading-relaxed"
                      placeholder="(empty — write the profile's persona here)"
                    />
                  ) : (
                    <div className="flex items-center justify-center py-16">
                      <Spinner size={20} color={brandColor(dark)} />
                    </div>
                  )}
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

function CreateProfileSheet({
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
  const [clone, setClone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setErr('Name is required.');
      return;
    }
    const scope = getAuthScope();
    setBusy(true);
    setErr(null);
    try {
      await createProfile(opsMut, {
        name: trimmed,
        cloneFromDefault: clone,
        description: description.trim() || undefined,
      });
      if (getAuthScope() !== scope) return;
      toast({ title: 'Profile created', description: trimmed });
      onCreated();
    } catch (e) {
      if (getAuthScope() === scope) setErr(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setBusy(false);
    }
  }, [clone, description, getAuthScope, name, onCreated, opsMut]);

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">New profile</DialogPrimitive.Title>
          <div className="flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close new profile"
                onClick={onClose}
                className="h-11 w-11 shrink-0 sm:h-11 sm:w-11">
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Button>
              <div className="min-w-0 flex-1 text-sm font-bold text-neutral-900 dark:text-white">New profile</div>
              <Button
                aria-label="Create profile"
                onClick={() => void create()}
                disabled={busy}
                className="h-auto sm:h-auto shrink-0 rounded-xl px-4 py-2.5">
                {busy ? <Spinner size={14} color="#fff" /> : <Check size={14} color="#fff" />}
                <span className="text-sm font-semibold text-white">Create</span>
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="flex flex-col gap-3">
                <div>
                  <Label className="mb-1 text-xs font-semibold">Name *</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoCapitalize="none"
                    placeholder="work"
                    className="rounded-xl"
                  />
                  <div className="mt-0.5 text-[10px] text-neutral-400">
                    Lowercase, no spaces — becomes the profile id.
                  </div>
                </div>
                <div>
                  <Label className="mb-1 text-xs font-semibold">Description</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What this profile is for"
                    className="min-h-20 rounded-xl"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setClone((v) => !v)}
                  aria-pressed={clone}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left ${clone ? 'border-brand bg-brand/10' : 'border-border'}`}>
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-md border ${clone ? 'border-brand bg-brand' : 'border-border'}`}>
                    {clone && <Check size={12} color="#fff" />}
                  </span>
                  <span className="text-xs text-neutral-700 dark:text-neutral-300">
                    Clone config & skills from the default profile
                  </span>
                </button>
                {err && <div className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{err}</div>}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
