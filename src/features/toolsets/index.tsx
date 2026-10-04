// Toolsets route — user-facing capability groups ported from Hermes Desktop's
// Capabilities → Toolsets view. Toolsets control which groups of tools the
// agent can use (terminal, web, browser, vision, media generation, and more).
import { memo, useCallback, useMemo, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import { Boxes, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { useOpsMutation, useOpsQuery } from '../../store/ops-query';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold } from '../../components/ui/bits';
import { Switch } from '../../components/ui/switch';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { toast } from '../../components/ui/toast';
import { Spinner } from '../../components/ui/bits';
import { errMsg } from '../../utils/messages';
import { brandColor, screenStyle } from '../../theme';
import { getToolsets, setToolsetEnabled } from '../../services/toolsets';
import type { ToolsetInfo } from '../../services/toolsets';
import { ToolsetConfigSheet } from './components/ToolsetConfigSheet';

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
  onConfigure,
}: {
  toolset: ToolsetInfo;
  dark: boolean;
  toggling: boolean;
  onToggle: (name: string, enabled: boolean) => void;
  onConfigure: (toolset: ToolsetInfo) => void;
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
        enabled ? 'border-border bg-elevated dark:bg-elevated' : 'border-border bg-popover/70 dark:bg-input/30/60'
      }`}>
      <div className="flex items-center gap-3">
        <div
          className={`flex flex-col h-9 w-9 items-center justify-center rounded-xl ${
            enabled ? 'bg-brand/10' : 'bg-elevated'
          }`}>
          <Boxes size={17} color={enabled ? brandColor(dark) : dark ? '#666' : '#999'} />
        </div>
        <button
          type="button"
          className="flex min-w-0 flex-1 flex-col text-left"
          aria-label={`Configure ${label}`}
          onClick={() => onConfigure(toolset)}>
          <div
            className={`text-sm font-semibold ${
              enabled ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'
            } truncate`}>
            {label}
          </div>
          {!!description && (
            <div className="mt-0.5 text-xs leading-[17px] text-neutral-500 dark:text-neutral-400 line-clamp-2">
              {description}
            </div>
          )}
          <div className="mt-1 flex items-center gap-2">
            <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
              {toolCount} {toolCount === 1 ? 'tool' : 'tools'}
            </div>
            <Badge variant={toolset.configured ? 'outline' : 'secondary'}>
              <div className={`h-1.5 w-1.5 rounded-full ${toolset.configured ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span
                className={`text-[11px] font-medium ${
                  toolset.configured ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                }`}>
                {toolset.configured ? 'Ready' : 'Needs setup'}
              </span>
            </Badge>
            <ChevronRight size={14} color={dark ? '#777' : '#aaa'} />
          </div>
        </button>
        {/* Switch stays mounted while the write is in flight — swapping it for
            a spinner would hide the optimistic flip for the whole request. */}
        <Switch
          checked={enabled}
          disabled={toggling}
          onCheckedChange={(value) => void onToggle(name, value)}
          aria-label={`${enabled ? 'Disable' : 'Enable'} ${label} toolset`}
        />
      </div>
    </div>
  );
});

export function ToolsetsScreen() {
  const { authed, activeProfile } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';

  const [query, setQuery] = useState('');
  const [configuring, setConfiguring] = useState<ToolsetInfo | null>(null);

  // One query replaces the four useState slots + epoch-guarded load.
  const list = useOpsQuery<ToolsetInfo[]>({
    key: ['toolsets'],
    get: (get) => getToolsets(get, activeProfile),
    enabled: authed,
  });
  const toolsets = list.data ?? null;
  const loading = list.isPending;
  const refreshing = list.isRefetching;
  const error = list.error ? errMsg(list.error) : null;
  // A backend without `/api/toolsets` answers 404 — say so, not "no toolsets".
  const unsupported = !!error && /HTTP 404/.test(error);
  const refresh = useCallback(() => void list.refetch(), [list]);

  const toggle = useOpsMutation<{ post_setup_started?: boolean }, { name: string; enabled: boolean }, ToolsetInfo[]>({
    mutationFn: (mut, v) => setToolsetEnabled(mut, v.name, v.enabled, activeProfile),
    done: [['toolsets']],
    // Flip before the request leaves; the hook rolls the cache back on failure.
    optimistic: {
      key: ['toolsets'],
      patch: (current, v) => (current ?? []).map((row) => (row.name === v.name ? { ...row, enabled: v.enabled } : row)),
    },
    onSuccess: (result, v) => {
      if (result.post_setup_started) {
        toast({
          title: 'Setup started',
          description: `${v.name} was enabled. Hermes is preparing its required dependency in the background.`,
        });
      }
    },
    onError: (e) => toast({ title: 'Toolset update failed', description: errMsg(e), variant: 'destructive' }),
  });
  const toggling = toggle.isPending ? (toggle.variables?.name ?? null) : null;

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
      <ScreenScaffold
        header={
          <ScreenHeader
            title="Toolsets"
            subtitle={`${activeProfile} · ${loading ? 'Loading…' : `${enabledCount}/${visibleToolsets.length} enabled`}`}
            actions={
              <HeaderIconButton aria-label="Refresh toolsets" onClick={refresh}>
                <RefreshCw size={20} color={dark ? '#e5e5e5' : '#333'} className={refreshing ? 'animate-spin' : ''} />
              </HeaderIconButton>
            }
          />
        }
        contentClassName="px-4 py-4">
        <div className="mx-auto w-full max-w-4xl pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          <Card className="mb-3">
            <div className="flex items-start gap-2.5">
              <Boxes size={17} color={dark ? '#a3a3a3' : '#666'} />
              <div className="flex-1 text-xs leading-5 text-neutral-600 dark:text-neutral-300">
                Toolsets group the tools Hermes can use. Changes apply to new chats.
              </div>
            </div>
          </Card>

          {!loading && !unsupported && !error && (
            <div className="frame-focus mb-3 flex items-center rounded-xl border border-border bg-popover px-3 dark:bg-input/30">
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
              <div className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                Toolsets aren&apos;t available on this backend. Update the Hermes gateway to manage capability toolsets
                here.
              </div>
            </Card>
          ) : error ? (
            <ErrorRetry error={error} onRetry={refresh} />
          ) : filtered.length === 0 ? (
            <Card>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                {query ? `No toolsets match “${query.trim()}”.` : 'No configurable toolsets were returned.'}
              </div>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((toolset) => (
                <ToolsetRow
                  key={String(toolset.name ?? '')}
                  toolset={toolset}
                  dark={dark}
                  toggling={toggling === String(toolset.name ?? '')}
                  onToggle={(name, enabled) => toggle.mutate({ name, enabled })}
                  onConfigure={setConfiguring}
                />
              ))}
            </div>
          )}
        </div>
      </ScreenScaffold>

      {configuring && (
        <ToolsetConfigSheet
          toolset={configuring}
          onClose={() => {
            setConfiguring(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
