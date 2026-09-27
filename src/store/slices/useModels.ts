// Model picker / reasoning / fast / approval slice.
//
// Owns the provider inventory plus the session-scoped switches. The provider
// keeps direct access to the setters and refs because boot hydration, session
// resume and logout also touch them.
import { useCallback, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { getModelOptions } from '../../services/dashboard';
import type { ModelProviderOption } from '../../services/dashboard';
import { connectionScope, saveModel } from '../../services/connection';
import { errMsg, nid } from '../../utils/messages';
import type { StoreCtx } from '../ctx';

export interface ModelsSlice {
  model: string;
  modelProvider: string;
  effort: string;
  providers: ModelProviderOption[] | null;
  providersLoading: boolean;
  providersError: string | null;
  setModel: Dispatch<SetStateAction<string>>;
  setModelProvider: Dispatch<SetStateAction<string>>;
  setEffort: Dispatch<SetStateAction<string>>;
  setProviders: Dispatch<SetStateAction<ModelProviderOption[] | null>>;
  setProvidersLoading: Dispatch<SetStateAction<boolean>>;
  setProvidersError: Dispatch<SetStateAction<string | null>>;
  providersRef: MutableRefObject<ModelProviderOption[] | null>;
  providersLoadingRef: MutableRefObject<boolean>;
  providersAtRef: MutableRefObject<number>;
  loadProviders: () => Promise<void>;
  pickModel: (providerSlug: string, modelId: string) => Promise<void>;
  applyEffort: (level: string) => Promise<void>;
  applyFast: (on: boolean) => Promise<void>;
  applyApprovalMode: (mode: 'manual' | 'smart' | 'off') => Promise<void>;
}

export function useModelsSlice({
  host,
  username,
  activeProfile,
  sessionId,
  acceptRotatedCookie,
  setMessages,
  setToolLine,
  latest,
  gw,
  cookie,
  activeProfileRef,
  profileEpochRef,
  connectionEpochRef,
}: StoreCtx): ModelsSlice {
  const [model, setModel] = useState('Muse Spark 1.3 Free');
  const [modelProvider, setModelProvider] = useState('');
  const [effort, setEffort] = useState('Xhigh');
  const [providers, setProviders] = useState<ModelProviderOption[] | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);

  // ── Model picker inventory ─────────────────────────────────────────────
  // WS model.options first (same payload as REST), cookie REST as fallback.
  const providersRef = useRef<ModelProviderOption[] | null>(null);
  providersRef.current = providers;
  const providersLoadingRef = useRef(false);
  const providersAtRef = useRef(0);

  const loadProviders = useCallback(async () => {
    const g = gw.current;
    const profile = activeProfileRef.current;
    const epoch = profileEpochRef.current;
    const connectionEpoch = connectionEpochRef.current;
    const targetHost = host;
    const targetUser = username;
    if (!g || providersLoadingRef.current) return;
    // 30s TTL — the model popover opens often, don't refetch every open.
    if (providersRef.current && Date.now() - providersAtRef.current < 30000) return;
    providersLoadingRef.current = true;
    setProvidersLoading(true);
    setProvidersError(null);
    try {
      const raw = await g.modelOptions(sessionId ?? undefined, sessionId ? undefined : profile);
      const rows = Array.isArray(raw?.providers) ? raw.providers : [];
      if (rows.length > 0) {
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setProviders(
          rows.map((p: any) => ({
            slug: String(p?.slug ?? ''),
            name: String(p?.name ?? p?.slug ?? ''),
            ...(typeof p?.is_current === 'boolean' ? { isCurrent: p.is_current } : {}),
            models: Array.isArray(p?.models) ? p.models.map(String) : null,
            totalModels: Number(p?.total_models ?? (Array.isArray(p?.models) ? p.models.length : 0)),
            ...(typeof p?.authenticated === 'boolean' ? { authenticated: p.authenticated } : {}),
            ...(p?.capabilities && typeof p.capabilities === 'object' ? { capabilities: p.capabilities } : {}),
          })),
        );
        providersAtRef.current = Date.now();
        return;
      }
      throw new Error('empty provider list');
    } catch (eWs) {
      try {
        const next = await getModelOptions(targetHost, cookie.current, { profile }, async (nextCookie) => {
          if (activeProfileRef.current !== profile) return;
          await acceptRotatedCookie(nextCookie, targetHost, targetUser, connectionEpoch, epoch);
        });
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setProviders(next);
        providersAtRef.current = Date.now();
      } catch (eRest) {
        if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
          setProvidersError(errMsg(eRest) || errMsg(eWs));
        }
      }
    } finally {
      providersLoadingRef.current = false;
      setProvidersLoading(false);
    }
  }, [acceptRotatedCookie, host, sessionId, username]);

  // Session-scoped switch ("this chat") — /model WITHOUT --global.
  const pickModel = useCallback(
    async (providerSlug: string, modelId: string) => {
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      setModelProvider(providerSlug);
      setModel(modelId);
      void saveModel(providerSlug, modelId, profile, connectionScope(latest.current.host, latest.current.username));
      const g = gw.current;
      const sid = sessionId;
      if (!g || !sid) return; // applies to the next new session
      // The slash worker can take a while (cold start + provider probe).
      setToolLine('switching model…');
      try {
        await g.switchModel(sid, modelId, providerSlug || undefined);
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setMessages((prev) => [
          ...prev,
          {
            id: nid(),
            role: 'notice',
            text: `Model → ${providerSlug ? `${providerSlug}:` : ''}${modelId} (this chat)`,
          },
        ]);
      } catch (e: any) {
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        const code = e?.code !== undefined ? ` [${e.code}]` : '';
        const msg = errMsg(e);
        const hint = /timed?\s*out/i.test(msg) ? ' — try again, the worker is warm now' : '';
        setMessages((prev) => [
          ...prev,
          {
            id: nid(),
            role: 'notice',
            text: `Switch failed${code}: ${msg}${hint}`,
          },
        ]);
      } finally {
        if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
          setToolLine(null);
        }
      }
    },
    [activeProfile, sessionId],
  );

  // Composer thinking-effort pick: applies to the LIVE session via `config.set`
  // (session-scoped, mirrors onto the running agent) and to the next new session
  // through createSession's reasoning_effort. Falling back to the slash worker
  // only reaches config.yaml, so it's the legacy path.
  const applyEffort = useCallback(
    async (level: string) => {
      const v = level.trim().toLowerCase();
      if (!v) return;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      setEffort(v);
      const g = gw.current;
      const sid = sessionId;
      if (!g || !sid) return; // no live session yet — used at the next create
      try {
        await g.configSet('reasoning', v, sid);
      } catch {
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        try {
          await g.slashExec(sid, `/reasoning ${v}`);
        } catch (e2: any) {
          if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
          setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `reasoning: ${errMsg(e2)}` }]);
        }
      }
    },
    [activeProfile, sessionId],
  );

  // Fast mode (`/fast`) — session-scoped, same config.set path as reasoning.
  const applyFast = useCallback(
    async (on: boolean) => {
      const g = gw.current;
      const sid = sessionId;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      if (!g || !sid) return;
      try {
        await g.configSet('fast', on ? 'fast' : 'normal', sid);
      } catch (e: any) {
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `fast: ${errMsg(e)}` }]);
      }
    },
    [activeProfile, sessionId],
  );

  // Persistent dangerous-command approval mode (manual | smart | off).
  const applyApprovalMode = useCallback(
    async (mode: 'manual' | 'smart' | 'off') => {
      const g = gw.current;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      if (!g) return;
      try {
        await g.configSet('approvals.mode', mode, sessionId ?? undefined, undefined, sessionId ? undefined : profile);
      } catch (e: any) {
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `approvals: ${errMsg(e)}` }]);
      }
    },
    [activeProfile, sessionId],
  );

  return {
    model,
    modelProvider,
    effort,
    providers,
    providersLoading,
    providersError,
    setModel,
    setModelProvider,
    setEffort,
    setProviders,
    setProvidersLoading,
    setProvidersError,
    providersRef,
    providersLoadingRef,
    providersAtRef,
    loadProviders,
    pickModel,
    applyEffort,
    applyFast,
    applyApprovalMode,
  };
}
