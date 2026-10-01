// Toolsets route — user-facing capability groups ported from Hermes Desktop's
// Capabilities → Toolsets view. Toolsets control which groups of tools the
// agent can use (terminal, web, browser, vision, media generation, and more).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import { AlertCircle, Boxes, RefreshCw, Search } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { Card, ErrorRetry, ScreenHeader } from '../../components/ui/bits';
import { Switch } from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Alert as UIAlert, AlertDescription } from '../../components/ui/alert';
import { toast } from '../../components/ui/toast';
import { Text as UIText } from '../../components/ui/text';
import { Spinner } from '../../components/ui/bits';
import { errMsg } from '../../utils/messages';
import { brandColor, placeholderColor, screenStyle } from '../../theme';
import { getToolsets, setToolsetEnabled } from '../../services/toolsets';
import type { ToolsetInfo } from '../../services/toolsets';
import { ScrollArea } from '../../components/ui/scroll';

// Same presentation-only curation as Hermes Desktop's Toolsets tab.
const HIDDEN_TOOLSETS = new Set(['discord', 'discord_admin', 'yuanbao', 'context_engine', 'moa']);
function displayLabel(toolset: ToolsetInfo): string {
  const raw = typeof toolset.label === 'string' ? toolset.label : typeof toolset.name === 'string' ? toolset.name : '';
  // Backend labels may include a leading emoji. Keep the mobile list text-only.
  const text = raw.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  if (text) return text;
  return String(toolset.name ?? '(unnamed)')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Memoized row: the toolset inventory is backend-bounded (<30 rows), so a
// virtualized list isn't warranted — but toggling one switch must not
// re-render every row. The switch binding closes over the row's own name.
const ToolsetRow = memo(function ToolsetRow({
  toolset,
  dark,
  toggling,
  onToggle,
}: {
  toolset: ToolsetInfo;
  dark: boolean;
  toggling: boolean;
  onToggle: (name: string, enabled: boolean) => void;
}) {
  const name = String(toolset.name ?? '');
  const enabled = toolset.enabled;
  const label = displayLabel(toolset);
  const description = String(toolset.description ?? '').trim();
  const toolCount = toolset.tools.length;
  if (!name) return null;
  return (
    <div
      className={`rounded-2xl border p-3.5 ${
        enabled
          ? 'border-neutral-300 bg-neutral-50/70 dark:border-neutral-700 dark:bg-neutral-900/60'
          : 'border-neutral-200 bg-white/70 dark:border-neutral-800 dark:bg-neutral-950/60'
      }`}
>
      <div className="flex items-center gap-3">
        <div
          className={`flex flex-col h-9 w-9 items-center justify-center rounded-xl ${
            enabled ? 'bg-sky-100 dark:bg-sky-950/70' : 'bg-neutral-100 dark:bg-neutral-900'
          }`}
>
          <Boxes size={17} color={enabled ? (dark ? '#7dd3fc' : '#0284c7') : dark ? '#666' : '#999'} />
        </div>
        <div className="min-w-0 flex-1">
          <UIText
            numberOfLines={1}
            className={`text-sm font-semibold ${
              enabled ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'
            }`}
>
            {label}
          </UIText>
          {!!description && (
            <UIText numberOfLines={2} className="mt-0.5 text-xs leading-[17px] text-neutral-500 dark:text-neutral-400">
              {description}
            </UIText>
          )}
          <div className="mt-1 flex items-center gap-2">
            <UIText className="text-[11px] text-neutral-400 dark:text-neutral-500">
              {toolCount} {toolCount === 1 ? 'tool' : 'tools'}
            </UIText>
            <Badge variant={toolset.configured ? 'outline' : 'secondary'}>
              <div
                className={`h-1.5 w-1.5 rounded-full ${toolset.configured ? 'bg-emerald-500' : 'bg-amber-500'}`}
              />
              <UIText
                className={`text-[11px] font-medium ${
                  toolset.configured ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                }`}
>
                {toolset.configured ? 'Ready' : 'Needs setup'}
              </UIText>
            </Badge>
          </div>
        </div>
        {toggling ? (
          <Spinner size={14} color={brandColor(dark)} />
        ) : (
          <Switch
            checked={enabled}
            onCheckedChange={(value) => void onToggle(name, value)}
            aria-label={`${enabled ? 'Disable' : 'Enable'} ${label} toolset`}
          />
        )}
      </div>
    </div>
  );
});

export function ToolsetsScreen() {
  const { authed, activeProfile, opsGet, opsMut, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';

  const [toolsets, setToolsets] = useState<ToolsetInfo[] | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const loadEpoch = useRef(0);

  const load = useCallback(
    async (isRefresh = false) => {
      const profile = activeProfile;
      const scope = getAuthScope();
      const epoch = ++loadEpoch.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const next = await getToolsets(opsGet, profile);
        if (getAuthScope() !== scope || activeProfile !== profile || loadEpoch.current !== epoch) return;
        setToolsets(next);
        setUnsupported(false);
      } catch (e) {
        if (getAuthScope() !== scope || activeProfile !== profile || loadEpoch.current !== epoch) return;
        const msg = errMsg(e);
        if (/HTTP 404/.test(msg)) {
          setUnsupported(true);
          setToolsets([]);
        } else {
          setError(msg);
        }
      } finally {
        if (getAuthScope() === scope && activeProfile === profile && loadEpoch.current === epoch) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [activeProfile, getAuthScope, opsGet],
  );

  useEffect(() => {
    if (authed) void load();
    else {
      setToolsets(null);
      setError(null);
      setLoading(true);
    }
  }, [authed, load]);

  const toggle = useCallback(
    async (name: string, enabled: boolean) => {
      const profile = activeProfile;
      const scope = getAuthScope();
      setToggling(name);
      setToolsets((prev) => (prev ?? []).map((row) => (row.name === name ? { ...row, enabled } : row)));
      try {
        const result = await setToolsetEnabled(opsMut, name, enabled, profile);
        if (getAuthScope() !== scope || activeProfile !== profile) return;
        if (result.post_setup_started) {
          toast({
            title: 'Setup started',
            description: `${name} was enabled. Hermes is preparing its required dependency in the background.`,
          });
        }
      } catch (e) {
        if (getAuthScope() !== scope || activeProfile !== profile) return;
        setToolsets((prev) => (prev ?? []).map((row) => (row.name === name ? { ...row, enabled: !enabled } : row)));
        toast({ title: 'Toolset update failed', description: errMsg(e), variant: 'destructive' });
      } finally {
        if (getAuthScope() === scope && activeProfile === profile) setToggling(null);
      }
    },
    [activeProfile, getAuthScope, opsMut],
  );

  const visibleToolsets = useMemo(
    () => (toolsets ?? []).filter((row) => !HIDDEN_TOOLSETS.has(String(row.name))),
    [toolsets],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visibleToolsets;
    return visibleToolsets.filter((row) =>
      [row.name, row.label, row.description, ...(row.tools ?? [])].some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(q),
      ),
    );
  }, [query, visibleToolsets]);
  const enabledCount = visibleToolsets.filter((row) => row.enabled).length;

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
      <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-black">
        

        <ScreenHeader
          title="Toolsets"

          subtitle={`${activeProfile} · ${loading ? 'Loading…' : `${enabledCount}/${visibleToolsets.length} enabled`}`}
          actions={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh toolsets"
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
          <Card className="mb-3">
            <div className="flex items-start gap-2.5">
              <Boxes size={17} color={dark ? '#a3a3a3' : '#666'} />
              <UIText className="flex-1 text-xs leading-5 text-neutral-600 dark:text-neutral-300">
                Toolsets group the tools Hermes can use. Changes apply to new chats.
              </UIText>
            </div>
          </Card>

          {!loading && !unsupported && !error && (
            <div className="frame-focus mb-3 flex items-center rounded-xl border border-neutral-200 bg-white px-3 dark:border-neutral-700 dark:bg-neutral-950">
              <Search size={16} color={dark ? '#888' : '#777'} />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search toolsets…"
                autoCapitalize="none"
                aria-label="Search toolsets"
                // The wrapper draws the field; the base border + background
                // inside it would read as a frame within a frame. dark: is
                // needed too — the base sets dark:bg-input/30, which a plain
                // bg-transparent does not cancel in dark mode.
                className="min-h-11 min-w-0 flex-1 border-0 bg-transparent px-2.5 text-[15px] text-neutral-950 focus-visible:ring-0 dark:bg-transparent dark:text-neutral-100"
              />
            </div>
          )}

          {loading && !refreshing ? (
            <div className="flex flex-col items-center py-16">
              <Spinner size={24} color={brandColor(dark)} />
            </div>
          ) : unsupported ? (
            <Card>
              <UIText className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                Toolsets aren&apos;t available on this backend. Update the Hermes gateway to manage capability toolsets
                here.
              </UIText>
            </Card>
          ) : error ? (
            <ErrorRetry error={error} onRetry={() => void load()} />
          ) : filtered.length === 0 ? (
            <Card>
              <UIText className="text-xs text-neutral-500 dark:text-neutral-400">
                {query ? `No toolsets match “${query.trim()}”.` : 'No configurable toolsets were returned.'}
              </UIText>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((toolset) => (
                <ToolsetRow
                  key={String(toolset.name ?? '')}
                  toolset={toolset}
                  dark={dark}
                  toggling={toggling === String(toolset.name ?? '')}
                  onToggle={toggle}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
