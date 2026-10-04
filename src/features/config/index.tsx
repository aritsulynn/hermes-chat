// Config route — view and edit `config.yaml`.
//
// Ported from Hermes Desktop's `ConfigPage.tsx`, scoped to its raw-YAML mode:
// a full-document editor with the resolved file path, a reload, and a
// save that surfaces the backend's YAML validation error. The desktop's
// schema-driven form (category tabs, per-field renderer, scoped reset) is a
// large separate renderer and is not ported here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import { Check, FileCode2, RefreshCw, RotateCcw } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { useOpsMutation, useOpsQuery } from '../../store/ops-query';
import { errMsg } from '../../utils/messages';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { ConfirmDialog } from '../../components/ui/dialog';
import { toast } from '../../components/ui/toast';
import { brandColor, screenStyle } from '../../theme';
import { getRawConfig, saveRawConfig } from '../../services/config';
import type { RawConfig } from '../../services/config';

export function ConfigScreen() {
  const { authed, activeProfile } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);

  const [yaml, setYaml] = useState('');
  const [savedYaml, setSavedYaml] = useState('');
  const [reloadConfirm, setReloadConfirm] = useState(false);

  // One query replaces the old four `useState` slots + epoch-guarded `load`.
  const cfg = useOpsQuery<RawConfig>({
    key: ['config'],
    get: (get) => getRawConfig(get, activeProfile),
    enabled: authed,
  });
  const loading = cfg.isPending;
  const error = cfg.error ? errMsg(cfg.error) : null;
  const path = cfg.data?.path ?? '';

  // Seed the editor from the fetched document — first load, a scope switch,
  // and a save whose response changed the file all land here. A refetch that
  // returns identical content keeps its reference (structural sharing), so
  // in-progress edits survive a post-save invalidation.
  const seeded = useRef<RawConfig | null>(null);
  useEffect(() => {
    if (cfg.data && cfg.data !== seeded.current) {
      seeded.current = cfg.data;
      setYaml(cfg.data.yaml);
      setSavedYaml(cfg.data.yaml);
    }
  }, [cfg.data]);

  const dirty = yaml !== savedYaml;

  // Reload always pulls fresh content and resets the editor, even when the
  // file is unchanged — that is the "discard edits" path.
  const reload = useCallback(async () => {
    const fresh = await cfg.refetch();
    if (fresh) {
      seeded.current = fresh;
      setYaml(fresh.yaml);
      setSavedYaml(fresh.yaml);
    }
  }, [cfg]);

  const save = useOpsMutation<void, string>({
    mutationFn: (mut, yamlText) => saveRawConfig(mut, yamlText, activeProfile),
    done: [['config']],
    onSuccess: (_data, yamlText) => {
      setSavedYaml(yamlText);
      toast({ title: 'Config saved' });
    },
    onError: (e) => toast({ title: 'Save failed', description: errMsg(e), variant: 'destructive' }),
  });
  const saving = save.isPending;

  const doReload = useCallback(() => {
    if (dirty) setReloadConfirm(true);
    else void reload();
  }, [dirty, reload]);

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
      <ScreenScaffold
        header={
          <>
            <ScreenHeader
              title="Config"
              subtitle={loading ? 'Loading…' : dirty ? 'Unsaved changes' : 'config.yaml'}
              actions={
                <div className="flex items-center gap-1">
                  <HeaderIconButton aria-label="Reload config" onClick={doReload}>
                    <RefreshCw size={20} color={dark ? '#e5e5e5' : '#333'} />
                  </HeaderIconButton>
                  <HeaderIconButton aria-label="Save config" onClick={() => save.mutate(yaml)} disabled={saving || !dirty}>
                    {saving ? (
                      <Spinner size={18} color={brand} />
                    ) : (
                      <Check size={20} color={dirty ? brand : dark ? '#555' : '#bbb'} />
                    )}
                  </HeaderIconButton>
                </div>
              }
            />
            {!!path && (
              <div className="flex items-center gap-1.5 truncate border-b border-border px-4 py-1.5 font-mono text-[10px] text-neutral-400">
                <FileCode2 size={12} className="shrink-0" />
                <span className="truncate">{path}</span>
              </div>
            )}
          </>
        }
        contentClassName="px-4 py-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={24} color={brand} />
            </div>
          ) : error ? (
            <ErrorRetry error={error} onRetry={() => void reload()} />
          ) : (
            <>
              <Card>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Edit the raw YAML. The backend validates on save — an invalid mapping is rejected and nothing changes.
                </div>
              </Card>
              <Textarea
                value={yaml}
                onChange={(e) => setYaml(e.target.value)}
                spellCheck={false}
                aria-label="config.yaml"
                className="min-h-[64vh] rounded-xl font-mono text-[12px] leading-relaxed"
                placeholder="# config.yaml is empty"
              />
              <div className="flex items-center gap-2">
                <Button
                  aria-label="Save config"
                  onClick={() => save.mutate(yaml)}
                  disabled={saving || !dirty}
                  className="h-auto sm:h-auto flex-1 rounded-xl px-4 py-2.5">
                  {saving ? <Spinner size={14} color="#fff" /> : <Check size={14} color="#fff" />}
                  <span className="text-sm font-semibold text-white">{dirty ? 'Save' : 'Saved'}</span>
                </Button>
                <Button
                  aria-label="Discard changes"
                  variant="outline"
                  onClick={() => setYaml(savedYaml)}
                  disabled={!dirty}
                  className="h-auto sm:h-auto rounded-xl px-4 py-2.5">
                  <RotateCcw size={14} color={brand} />
                  <span className="text-sm font-semibold">Discard</span>
                </Button>
              </div>
            </>
          )}
        </div>
      </ScreenScaffold>

      <ConfirmDialog
        open={reloadConfirm}
        title="Discard changes?"
        description="Reloading replaces your unsaved edits with the file on disk."
        confirmLabel="Reload"
        destructive
        onConfirm={() => void reload()}
        onOpenChange={(o) => {
          if (!o) setReloadConfirm(false);
        }}
      />
    </div>
  );
}
