// Slash-command catalog slice — fetches the live `commands.catalog` (the
// authority for each command's disposition/aliases) with a short TTL, and the
// counter that forces the "/" wheel to re-filter when it lands.
import { useCallback, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { rememberCommandsCatalog } from '../../utils/slash-commands';
import type { StoreRuntime } from '../runtime';

export interface CommandsSliceDeps {
  runtime: StoreRuntime;
  sessionId: string | null;
}

export interface CommandsSlice {
  catalogAtRef: MutableRefObject<number>;
  setCatalogVersion: Dispatch<SetStateAction<number>>;
  loadCommandsCatalog: () => Promise<void>;
}

export function useCommandsSlice({ runtime, sessionId }: CommandsSliceDeps): CommandsSlice {
  const { gw } = runtime;
  // `commands.catalog` dispositions live in ./slash-commands (module cache); this
  // counter only forces a re-render once the live table lands so the wheel re-filters.
  const [, setCatalogVersion] = useState(0);
  const catalogAtRef = useRef(0);

  // ── Slash command catalog ──────────────────────────────────────────────
  // `commands.catalog` is the live authority for each command's `desktop=`
  // disposition (offered / terminal-only / picker-owned) and the alias map, so
  // the "/" wheel curates itself from the backend with no code change. Failure
  // is fine — ./slash-commands keeps the shipped registry as the cold fallback.
  const loadCommandsCatalog = useCallback(async () => {
    const g = gw.current;
    if (!g) return;
    // 60s TTL — sessionId effect fires often, catalog barely changes.
    if (Date.now() - catalogAtRef.current < 60000) return;
    try {
      rememberCommandsCatalog(await g.commandsCatalog(sessionId ?? undefined));
      catalogAtRef.current = Date.now();
      setCatalogVersion((v) => v + 1);
    } catch {
      // Older backend without commands.catalog — keep the static registry.
    }
  }, [sessionId]);

  return { catalogAtRef, setCatalogVersion, loadCommandsCatalog };
}
