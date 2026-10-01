// Skills route — agent skill inventory ported from Hermes Desktop's
// Capabilities pane (`apps/desktop/src/api/skills.ts` + `store/agent-plugins.ts`).
// Same backend REST contract over the mobile app's authed ops helpers.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import { AlertCircle, RefreshCw, X } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { Card, ErrorRetry, ScreenHeader } from '../../components/ui/bits';
import { Switch } from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { Alert as UIAlert, AlertDescription } from '../../components/ui/alert';
import { toast } from '../../components/ui/toast';
import { Text as UIText } from '../../components/ui/text';
import { Spinner } from '../../components/ui/bits';
import { brandColor, screenStyle } from '../../theme';
import { getSkillContent, getSkills, setSkillEnabled } from '../../services/skills';
import type { SkillInfo } from '../../services/skills';
import { ScrollArea } from '../../components/ui/scroll';
import { writeClipboard } from '../../services/clipboard';

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
        <button type="button" className="min-w-0 flex-1" onClick={() => void onOpen(name)}>
          <UIText className="text-sm font-semibold text-neutral-900 dark:text-neutral-100" numberOfLines={1}>
            {name}
          </UIText>
          {!!skill.description && (
            <UIText className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={2}>
              {String(skill.description)}
            </UIText>
          )}
          <UIText className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">
            {[skill.origin ? String(skill.origin) : '', typeof skill.usage === 'number' ? `${skill.usage} uses` : '']
              .filter(Boolean)
              .join(' · ') || 'Tap to view SKILL.md'}
          </UIText>
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
  const [viewing, setViewing] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [contentLoading, setContentLoading] = useState(false);

  useEffect(() => {
    if (authed) return;
    setSkills(null);
    setViewing(null);
    setContent('');
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

  const openContent = useCallback(
    async (name: string) => {
      const scope = getAuthScope();
      setViewing(name);
      setContent('');
      setContentLoading(true);
      try {
        const res = await getSkillContent(opsGet, name);
        if (getAuthScope() === scope) setContent(res.content || '(empty)');
      } catch (e) {
        if (getAuthScope() === scope) setContent(`Couldn't load SKILL.md: ${errMsg(e)}`);
      } finally {
        if (getAuthScope() === scope) setContentLoading(false);
      }
    },
    [getAuthScope, opsGet],
  );

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
      <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-black">
        

        {/* Header */}
        <ScreenHeader
          title="Skills"

          subtitle={loading ? 'Loading...' : `${skills?.length ?? 0} installed`}
          actions={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh skills"
              onClick={() => void load(true)}
              className="h-9 w-9 rounded-lg"
>
              <RefreshCw size={18} color={dark ? '#e5e5e5' : '#333'} className={refreshing ? 'animate-spin' : ''} />
            </Button>
          }
        />

        <ScrollArea
          className="flex-1 px-4 py-4"
          contentClassName="pb-[calc(env(safe-area-inset-bottom,0px)+24px)]"

>
          {loading && !refreshing ? (
            <div className="flex flex-col items-center py-16">
              <Spinner size={24} color={brand} />
            </div>
          ) : unsupported ? (
            <Card>
              <UIText className="text-xs text-neutral-500 dark:text-neutral-400">
                Skills aren&apos;t available on this backend — run skills from the chat with /name instead.
              </UIText>
            </Card>
          ) : error ? (
            <ErrorRetry error={error} onRetry={() => void load()} />
          ) : !skills?.length ? (
            <Card>
              <UIText className="text-xs text-neutral-500 dark:text-neutral-400">No skills installed.</UIText>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {skills.map((s) => (
                <SkillRow
                  key={String(s.name ?? '(unnamed)')}
                  skill={s}
                  dark={dark}
                  toggling={toggling === String(s.name)}
                  onToggle={toggle}
                  onOpen={openContent}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* SKILL.md viewer */}
        <DialogPrimitive.Root open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
            <DialogPrimitive.Content className="fixed inset-0 z-50 flex flex-col bg-white outline-none dark:bg-neutral-950">
              <DialogPrimitive.Title className="sr-only">Skill file</DialogPrimitive.Title>
              <div className="flex-1" style={{ paddingTop: 48 }}>
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <UIText className="flex-1 font-mono text-sm font-bold text-neutral-900 dark:text-white" numberOfLines={1}>
                {viewing ?? ''}
              </UIText>
              <Button
                variant="ghost"
                onClick={() => void writeClipboard(content).catch(() => {})}
                aria-label="Copy skill file"
                className="h-auto sm:h-auto px-2 py-1.5"
>
                <UIText className="text-xs font-semibold text-[#1a73e8] dark:text-[#7aa7ff]">Copy</UIText>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setViewing(null)}
                aria-label="Close skill file"
                className="h-8 w-8 rounded-md"
>
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Button>
            </div>
            <ScrollArea className="flex-1" contentClassName="p-4">
              {contentLoading ? (
                <Spinner size={14} color={brand} />
              ) : (
                <UIText className="font-mono text-xs leading-5 text-neutral-900 dark:text-neutral-100">
                  {content}
                </UIText>
              )}
            </ScrollArea>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </div>
    </div>
  );
}
