// Full configuration surface for one toolset's backends — the mobile
// counterpart of the desktop ToolsetConfigDrawer and the `hermes tools` curses
// picker: toggle the toolset, pick a provider, enter API keys, and run a
// provider's post-setup install hook with a live log tail.
//
// Rendered as a full-screen dialog (the app's established pattern for these
// editors) so the action row stays reachable on a phone.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, ExternalLink, Loader2, Terminal, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Switch } from '../../../components/ui/switch';
import { Spinner } from '../../../components/ui/bits';
import { errMsg } from '../../../utils/messages';
import { brandColor } from '../../../theme';
import { useApp, useThemeValue } from '../../../hooks/app-store';
import * as api from '../../../services/api';
import { normalizeActionStatus } from '../../../services/hermes-update';
import {
  getToolsetConfig,
  runToolsetPostSetup,
  saveToolsetEnv,
  selectToolsetProvider,
  type ToolsetConfigResult,
  type ToolsetInfo,
  type ToolsetProviderRow,
} from '../../../services/toolsets';

const POLL_MS = 1200;
const LOG_LINES = 300;

export function ToolsetConfigSheet({ toolset, onClose }: { toolset: ToolsetInfo; onClose: () => void }) {
  const { opsGet, opsMut, getAuthScope, activeProfile } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);
  const name = String(toolset.name ?? '');
  const profile = activeProfile;

  const [config, setConfig] = useState<ToolsetConfigResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(toolset.enabled);
  const [toggling, setToggling] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [isSet, setIsSet] = useState<Record<string, boolean>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);

  const [postSetupRunning, setPostSetupRunning] = useState(false);
  const [postSetupLog, setPostSetupLog] = useState<string[]>([]);
  const [postSetupKey, setPostSetupKey] = useState<string | null>(null);
  const [postSetupTrigger, setPostSetupTrigger] = useState(0);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await getToolsetConfig(opsGet, name, profile);
      if (!aliveRef.current) return;
      setConfig(cfg);
      setActiveProvider(cfg.activeProvider);
      const seed: Record<string, boolean> = {};
      for (const p of cfg.providers) for (const e of p.envVars) seed[e.key] = e.isSet;
      setIsSet(seed);
    } catch {
      // leave the drawer minimal; the toggle above still works.
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [name, opsGet, profile]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // Poll the post-setup action until it exits.
  useEffect(() => {
    if (postSetupTrigger === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const raw = await opsGet(api.actionStatus('tools-post-setup', LOG_LINES));
        if (cancelled) return;
        const st = normalizeActionStatus(raw);
        setPostSetupLog(st.lines);
        if (st.running) {
          timer = setTimeout(() => void poll(), POLL_MS);
        } else {
          setPostSetupRunning(false);
          void loadConfig();
        }
      } catch {
        if (!cancelled) setPostSetupRunning(false);
      }
    };
    timer = setTimeout(() => void poll(), 800);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [postSetupTrigger, opsGet, loadConfig]);

  const handleToggle = useCallback(
    async (next: boolean) => {
      const scope = getAuthScope();
      setToggling(true);
      try {
        await opsMut(api.toolsetToggle(name, profile), 'PUT', { enabled: next });
        if (getAuthScope() !== scope) return;
        setEnabled(next);
      } finally {
        if (getAuthScope() === scope) setToggling(false);
      }
    },
    [getAuthScope, name, opsMut, profile],
  );

  const handleSelectProvider = useCallback(
    async (provider: ToolsetProviderRow) => {
      const scope = getAuthScope();
      setSelecting(provider.name);
      try {
        await selectToolsetProvider(opsMut, name, provider.name, profile);
        if (getAuthScope() !== scope) return;
        setActiveProvider(provider.name);
      } finally {
        if (getAuthScope() === scope) setSelecting(null);
      }
    },
    [getAuthScope, name, opsMut, profile],
  );

  const handleSaveKeys = useCallback(
    async (provider: ToolsetProviderRow) => {
      const env: Record<string, string> = {};
      for (const e of provider.envVars) {
        const v = drafts[e.key];
        if (v && v.trim()) env[e.key] = v.trim();
      }
      if (Object.keys(env).length === 0) return;
      const scope = getAuthScope();
      setSavingProvider(provider.name);
      try {
        const res = await saveToolsetEnv(opsMut, name, env, profile);
        if (getAuthScope() !== scope) return;
        setIsSet((prev) => ({ ...prev, ...res.isSet }));
        setDrafts((prev) => {
          const next = { ...prev };
          for (const k of res.saved) delete next[k];
          return next;
        });
      } finally {
        if (getAuthScope() === scope) setSavingProvider(null);
      }
    },
    [drafts, getAuthScope, name, opsMut, profile],
  );

  const handleRunPostSetup = useCallback(
    async (provider: ToolsetProviderRow) => {
      if (!provider.postSetup) return;
      setPostSetupRunning(true);
      setPostSetupLog([]);
      setPostSetupKey(provider.postSetup);
      try {
        await runToolsetPostSetup(opsMut, name, provider.postSetup, profile);
        setPostSetupTrigger((n) => n + 1);
      } catch (e) {
        setPostSetupRunning(false);
        setPostSetupLog([errMsg(e)]);
      }
    },
    [name, opsMut, profile],
  );

  const label = toolset.label?.trim() || name;

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">{label} configuration</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Toggle the toolset, choose a backend provider, save API keys, and run one-time installs.
          </DialogPrimitive.Description>
          <div className="flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close toolset config"
                onClick={onClose}
                className="h-11 w-11 shrink-0 rounded-md sm:h-11 sm:w-11">
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Button>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-sm font-bold text-neutral-900 dark:text-white">{label}</div>
                <div className="mt-0.5 text-[11px] text-neutral-400">
                  {toolset.platform_label?.trim() || toolset.platform || 'backend configuration'}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {toggling ? (
                  <Spinner size={14} color={brand} />
                ) : (
                  <Switch checked={enabled} onCheckedChange={(v) => void handleToggle(v)} aria-label={`Enable ${label}`} />
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
              {!!toolset.description && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{toolset.description}</p>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Spinner size={20} color={brand} />
                </div>
              ) : !config?.hasCategory ? (
                <p className="py-8 text-center text-sm text-neutral-500">
                  This toolset has no configurable backends — just the on/off switch above.
                </p>
              ) : config.providers.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-500">
                  No providers are available for this toolset in this install.
                </p>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  {config.providers.map((provider) => {
                    const active = provider.name === activeProvider;
                    return (
                      <div
                        key={provider.name}
                        className={`rounded-xl border p-3 ${
                          active ? 'border-emerald-400 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20' : 'border-border'
                        }`}>
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                            {provider.name}
                          </span>
                          {provider.isActive && (
                            <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                              Active
                            </span>
                          )}
                          {active ? (
                            <span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                              <Check size={11} /> Selected
                            </span>
                          ) : (
                            <Button
                              aria-label={`Select ${provider.name}`}
                              onClick={() => void handleSelectProvider(provider)}
                              disabled={selecting !== null}
                              variant="outline"
                              className="h-auto sm:h-auto shrink-0 rounded-lg px-3 py-1.5">
                              {selecting === provider.name ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <span className="text-xs font-semibold">Select</span>
                              )}
                            </Button>
                          )}
                        </div>
                        {!!provider.badge && (
                          <div className="mt-1 text-[11px] text-neutral-400">{provider.badge}</div>
                        )}
                        {!!provider.tag && (
                          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{provider.tag}</p>
                        )}

                        {provider.envVars.length > 0 && (
                          <div className="mt-3 flex flex-col gap-2.5">
                            {provider.envVars.map((ev) => (
                              <div key={ev.key} className="flex flex-col gap-1">
                                <div className="flex items-center justify-between gap-2">
                                  <Label className="font-mono text-[11px] text-neutral-600 dark:text-neutral-300">
                                    {ev.key}
                                  </Label>
                                  {isSet[ev.key] && (
                                    <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                      Saved
                                    </span>
                                  )}
                                </div>
                                <Input
                                  type="password"
                                  autoCapitalize="none"
                                  spellCheck={false}
                                  placeholder={isSet[ev.key] ? '•••••••• (saved — leave blank to keep)' : ev.prompt}
                                  value={drafts[ev.key] ?? ''}
                                  onChange={(e) => setDrafts((prev) => ({ ...prev, [ev.key]: e.target.value }))}
                                  className="rounded-xl border border-border px-3.5 py-2.5 font-mono text-sm text-neutral-950 dark:bg-input/30 dark:text-neutral-100"
                                />
                                {ev.url && (
                                  <a
                                    href={ev.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[11px] text-brand">
                                    <ExternalLink size={11} /> Get a key
                                  </a>
                                )}
                              </div>
                            ))}
                            <Button
                              aria-label={`Save keys for ${provider.name}`}
                              onClick={() => void handleSaveKeys(provider)}
                              disabled={savingProvider !== null}
                              className="h-auto sm:h-auto self-start rounded-xl px-3 py-2">
                              {savingProvider === provider.name ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <span className="text-xs font-semibold text-white">Save keys</span>
                              )}
                            </Button>
                          </div>
                        )}

                        {provider.postSetup && (
                          <div className="mt-3 border-t border-border pt-3">
                            <p className="mb-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                              Needs a one-time install <span className="font-mono">({provider.postSetup})</span>. Runs on
                              the gateway host.
                            </p>
                            <Button
                              aria-label={`Run setup for ${provider.name}`}
                              variant="outline"
                              onClick={() => void handleRunPostSetup(provider)}
                              disabled={postSetupRunning}
                              className="h-auto sm:h-auto rounded-xl px-3 py-2">
                              {postSetupRunning && postSetupKey === provider.postSetup ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <Terminal size={13} />
                              )}
                              <span className="text-xs font-semibold">
                                {postSetupRunning && postSetupKey === provider.postSetup ? 'Installing…' : 'Run setup'}
                              </span>
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {(postSetupRunning || postSetupLog.length > 0) && (
                <div className="mt-3 rounded-xl border border-border">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
                    <Terminal size={13} color={brand} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-500">
                      post-setup: {postSetupKey}
                    </span>
                    {postSetupRunning && <Loader2 size={12} className="animate-spin" />}
                  </div>
                  <pre className="max-h-48 overflow-y-auto p-3 font-mono text-[11px] whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">
                    {postSetupLog.length ? postSetupLog.join('\n') : 'Starting…'}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
