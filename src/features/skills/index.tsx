// Skills route — agent skill inventory ported from Hermes Desktop's
// Capabilities pane (`apps/desktop/src/api/skills.ts` + `store/agent-plugins.ts`).
// Same backend REST contract over the mobile app's authed ops helpers.
import { memo, useMemo, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import { RefreshCw, Plus, X } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { useOpsMutation, useOpsQuery } from '../../store/ops-query';
import { errMsg } from '../../utils/messages';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold } from '../../components/ui/bits';
import { Switch } from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { toast } from '../../components/ui/toast';
import { Spinner } from '../../components/ui/bits';
import { brandColor, screenStyle } from '../../theme';
import { getSkills, setSkillEnabled } from '../../services/skills';
import type { SkillInfo } from '../../services/skills';
import { SkillEditor } from './components/SkillEditor';

// Stable empty list, so the `?? []` below does not hand the filter memo a fresh
// array on every render while the query is still pending.
const NO_SKILLS: SkillInfo[] = [];

// Memoized row: the installed-skills list is small and bounded, so no
// virtualized list is needed — but toggling one switch must not re-render
// every row. Press/switch bindings close over the row's own skill.
const SkillRow = memo(function SkillRow({
  skill,
  disabling,
  onToggle,
  onOpen,
}: {
  skill: SkillInfo;
  /** True while this row's own toggle is in flight. */
  disabling: boolean;
  onToggle: (name: string, enabled: boolean) => void;
  onOpen: (name: string) => void;
}) {
  const name = String(skill.name ?? '(unnamed)');
  const enabled = skill.enabled !== false;
  const canToggle = typeof skill.enabled === 'boolean';
  return (
    <Card>
      <div className="flex items-center gap-2">
        {/* text-left: buttons centre their text by UA default, which is why
            every row read centred despite the stretched column. */}
        <button
          type="button"
          aria-label={`Edit ${name}`}
          className="flex min-w-0 flex-1 flex-col text-left"
          onClick={() => void onOpen(name)}>
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">{name}</span>
          {!!skill.description && (
            <span className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">
              {String(skill.description)}
            </span>
          )}
          <span className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">
            {[skill.origin ? String(skill.origin) : '', typeof skill.usage === 'number' ? `${skill.usage} uses` : '']
              .filter(Boolean)
              .join(' · ') || 'Tap to edit SKILL.md'}
          </span>
        </button>
        {/* Kept mounted while the write is in flight, only disabled: swapping it
            for a spinner is what used to hide the optimistic flip for the whole
            request. */}
        {canToggle && <Switch checked={enabled} disabled={disabling} onCheckedChange={(v) => void onToggle(name, v)} />}
      </div>
    </Card>
  );
});

export function SkillsScreen() {
  const { authed, opsGet, opsMut, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  // One spinner on this screen (the list itself) — resolve once.
  const brand = useMemo(() => brandColor(dark), [dark]);

  // Editor: `null` while closed, `{ name: string | null }` while open — `name:
  // null` means create mode, matching the desktop dialog's `editName` contract.
  const [editor, setEditor] = useState<{ name: string | null } | null>(null);
  // Filter-as-you-type over name + description + origin. Memoized so a toggle
  // (which rewrites one row) doesn't refilter the whole inventory.
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();

  // The connection scope is part of this key (see `store/ops-query`), so the
  // inventory cannot outlive the connection that fetched it, and two loads of
  // this screen cannot land out of order. This is what the four `useState`
  // slots and the `getAuthScope()` checks after each `await` used to do.
  const list = useOpsQuery<SkillInfo[]>({
    key: ['skills'],
    get: (get) => getSkills(get),
    enabled: authed,
  });
  const skills = list.data ?? NO_SKILLS;
  const loading = list.isPending;
  const refreshing = list.isRefetching;
  const error = list.error ? errMsg(list.error) : null;
  // A backend without `/api/skills` answers 404 rather than an empty list. Say so
  // instead of claiming no skills are installed.
  const unsupported = !!error && /HTTP 404/.test(error);

  const filtered = useMemo(
    () =>
      ql
        ? skills.filter((s) =>
            [s.name, s.description, s.origin].some((f) =>
              String(f ?? '')
                .toLowerCase()
                .includes(ql),
            ),
          )
        : skills,
    [skills, ql],
  );

  const refresh = () => void list.refetch();

  // The switch flips before the request goes out and rolls back if it fails —
  // the `optimistic` patch and its rollback used to be a hand-written
  // `setSkills` / `setSkills(flip back)` pair around every toggle.
  const toggle = useOpsMutation<void, { name: string; enabled: boolean }, SkillInfo[]>({
    mutationFn: (mut, v) => setSkillEnabled(mut, v.name, v.enabled),
    done: [['skills']],
    optimistic: {
      key: ['skills'],
      patch: (current, v) => (current ?? []).map((s) => (s.name === v.name ? { ...s, enabled: v.enabled } : s)),
    },
    onError: (e) => toast({ title: 'Toggle failed', description: errMsg(e), variant: 'destructive' }),
  });
  const toggling = toggle.isPending ? toggle.variables?.name : undefined;

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
      <ScreenScaffold
        header={
          <ScreenHeader
            title="Skills"
            subtitle={
              loading
                ? 'Loading...'
                : ql
                  ? `${filtered.length} of ${skills.length} installed`
                  : `${skills.length} installed`
            }
            actions={
              <div className="flex items-center gap-1">
                <HeaderIconButton aria-label="New skill" onClick={() => setEditor({ name: null })}>
                  <Plus size={20} color={dark ? '#e5e5e5' : '#333'} />
                </HeaderIconButton>
                <HeaderIconButton aria-label="Refresh skills" onClick={refresh}>
                  <RefreshCw size={20} color={dark ? '#e5e5e5' : '#333'} className={refreshing ? 'animate-spin' : ''} />
                </HeaderIconButton>
              </div>
            }
          />
        }
        contentClassName="px-4 py-4">
        <div className="mx-auto w-full max-w-4xl pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          {loading && !refreshing ? (
            <div className="flex flex-col items-center py-16">
              <Spinner size={24} color={brand} />
            </div>
          ) : unsupported ? (
            <Card>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                Skills aren&apos;t available on this backend — run skills from the chat with /name instead.
              </div>
            </Card>
          ) : error ? (
            <ErrorRetry error={error} onRetry={refresh} />
          ) : !skills.length ? (
            <Card>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">No skills installed.</div>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search skills…"
                  aria-label="Search skills"
                  className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-[14px] text-neutral-950 dark:text-neutral-100"
                />
                {!!q && (
                  <Button variant="ghost" size="icon" aria-label="Clear search" onClick={() => setQ('')}>
                    <X size={18} color={dark ? '#a3a3a3' : '#555'} />
                  </Button>
                )}
              </div>
              {filtered.length === 0 ? (
                <Card>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">No matches.</div>
                </Card>
              ) : (
                filtered.map((s) => (
                  <SkillRow
                    key={String(s.name ?? '(unnamed)')}
                    skill={s}
                    disabling={toggling === String(s.name)}
                    onToggle={(name, enabled) => toggle.mutate({ name, enabled })}
                    onOpen={(name) => setEditor({ name })}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </ScreenScaffold>

      {/* Create/edit SKILL.md. Mounted only while open so React state resets on
          each fresh open (see SkillEditor's note on why it is not a `key`). */}
      {editor && (
        <SkillEditor
          open
          editName={editor.name}
          dark={dark}
          opsGet={opsGet}
          opsMut={opsMut}
          getAuthScope={getAuthScope}
          onClose={() => setEditor(null)}
          onSaved={(name) => {
            toast({ title: editor.name ? 'Skill saved' : 'Skill created', description: name });
            refresh();
          }}
        />
      )}
    </div>
  );
}
