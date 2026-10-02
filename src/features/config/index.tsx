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
import { errMsg } from '../../utils/messages';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { ConfirmDialog } from '../../components/ui/dialog';
import { toast } from '../../components/ui/toast';
import { brandColor, screenStyle } from '../../theme';
import { getRawConfig, saveRawConfig } from '../../services/config';

export function ConfigScreen() {
  const { authed, activeProfile, opsGet, opsMut, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);

  const [yaml, setYaml] = useState('');
  const [savedYaml, setSavedYaml] = useState('');
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);

  const loadEpoch = useRef(0);
  const load = useCallback(async () => {
    const profile = activeProfile;
    const scope = getAuthScope();
    const epoch = ++loadEpoch.current;
    setLoading(true);
    setError(null);
    try {
      const res = await getRawConfig(opsGet, profile);
      if (getAuthScope() !== scope || activeProfile !== profile || loadEpoch.current !== epoch) return;
      setYaml(res.yaml);
      setSavedYaml(res.yaml);
      setPath(res.path);
    } catch (e) {
      if (getAuthScope() === scope && activeProfile === profile && loadEpoch.current === epoch) setError(errMsg(e));
    } finally {
      if (getAuthScope() === scope && activeProfile === profile && loadEpoch.current === epoch) setLoading(false);
    }
  }, [activeProfile, getAuthScope, opsGet]);

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  const dirty = yaml !== savedYaml;

  const save = useCallback(async () => {
    const scope = getAuthScope();
    setSaving(true);
    try {
      await saveRawConfig(opsMut, yaml, activeProfile);
      if (getAuthScope() !== scope) return;
      setSavedYaml(yaml);
      toast({ title: 'Config saved' });
    } catch (e) {
      if (getAuthScope() === scope) toast({ title: 'Save failed', description: errMsg(e), variant: 'destructive' });
    } finally {
      if (getAuthScope() === scope) setSaving(false);
    }
  }, [activeProfile, getAuthScope, opsMut, yaml]);

  const doReload = useCallback(() => {
    if (dirty) setReloadConfirm(true);
    else void load();
  }, [dirty, load]);

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
                  <HeaderIconButton aria-label="Save config" onClick={() => void save()} disabled={saving || !dirty}>
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
            <ErrorRetry error={error} onRetry={() => void load()} />
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
                  onClick={() => void save()}
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
        onConfirm={() => void load()}
        onOpenChange={(o) => {
          if (!o) setReloadConfirm(false);
        }}
      />
    </div>
  );
}
