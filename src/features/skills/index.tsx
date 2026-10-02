// Skills route — agent skill inventory ported from Hermes Desktop's
// Capabilities pane (`apps/desktop/src/api/skills.ts` + `store/agent-plugins.ts`).
// Same backend REST contract over the mobile app's authed ops helpers.
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import { RefreshCw, Plus, X } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
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

// Memoized row: the installed-skills list is small and bounded, so no
// virtualized list is needed — but toggling one switch must not re-render
// every row. Press/switch bindings close over the row's own skill.
const SkillRow = memo(function SkillRow({
  skill,
  dark,
  toggling,
  onToggle,
  onOpen,
}: {
  skill: SkillInfo;
  dark: boolean;
  toggling: boolean;
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
        {canToggle &&
          (toggling ? (
            <Spinner size={14} color={brandColor(dark)} />
          ) : (
            <Switch checked={enabled} onCheckedChange={(v) => void onToggle(name, v)} />
          ))}
      </div>
    </Card>
  );
});

export function SkillsScreen() {
  const { authed, opsGet, opsMut, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  // Two spinners on this screen (list load + SKILL.md viewer) — resolve once.
  const brand = useMemo(() => brandColor(dark), [dark]);

  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  // Editor: `null` while closed, `{ name: string | null }` while open — `name:
  // null` means create mode, matching the desktop dialog's `editName` contract.
  const [editor, setEditor] = useState<{ name: string | null } | null>(null);
  // Filter-as-you-type over name + description + origin. Memoized so a toggle
  // (which rewrites one row) doesn't refilter the whole inventory.
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      ql
        ? (skills ?? []).filter((s) =>
            [s.name, s.description, s.origin].some((f) =>
              String(f ?? '')
                .toLowerCase()
                .includes(ql),
            ),
          )
        : (skills ?? []),
    [skills, ql],
  );

  useEffect(() => {
    if (authed) return;
    setSkills(null);
    setEditor(null);
    setError(null);
  }, [authed]);

  const load = useCallback(
    async (isRefresh = false) => {
      const scope = getAuthScope();
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const next = await getSkills(opsGet);
        if (getAuthScope() !== scope) return;
        setSkills(next);
        setUnsupported(false);
      } catch (e) {
        if (getAuthScope() !== scope) return;
        const msg = errMsg(e);
        if (/HTTP 404/.test(msg)) {
          setUnsupported(true);
          setSkills([]);
        } else {
          setError(msg);
        }
      } finally {
        if (getAuthScope() === scope) {
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

  const toggle = useCallback(
    async (name: string, enabled: boolean) => {
      const scope = getAuthScope();
      setToggling(name);
      setSkills((prev) => (prev ?? []).map((s) => (s.name === name ? { ...s, enabled } : s)));
      try {
        await setSkillEnabled(opsMut, name, enabled);
        if (getAuthScope() !== scope) return;
      } catch (e) {
        if (getAuthScope() !== scope) return;
        setSkills((prev) => (prev ?? []).map((s) => (s.name === name ? { ...s, enabled: !enabled } : s)));
        toast({ title: 'Toggle failed', description: errMsg(e), variant: 'destructive' });
      } finally {
        if (getAuthScope() === scope) setToggling(null);
      }
    },
    [getAuthScope, opsMut],
  );

  const openEditor = useCallback((name: string) => {
    setEditor({ name });
  }, []);

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
                  ? `${filtered.length} of ${skills?.length ?? 0} installed`
                  : `${skills?.length ?? 0} installed`
            }
            actions={
              <div className="flex items-center gap-1">
                <HeaderIconButton
                  aria-label="New skill"
                  onClick={() => setEditor({ name: null })}
>
                  <Plus size={20} color={dark ? '#e5e5e5' : '#333'} />
                </HeaderIconButton>
                <HeaderIconButton aria-label="Refresh skills" onClick={() => void load(true)}>
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
            <ErrorRetry error={error} onRetry={() => void load()} />
          ) : !skills?.length ? (
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
                    dark={dark}
                    toggling={toggling === String(s.name)}
                    onToggle={toggle}
                    onOpen={openEditor}
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
            void load(true);
          }}
        />
      )}
    </div>
  );
}
