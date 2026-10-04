// Pairing route — approve or revoke channel access requests.
//
// Ported from Hermes Desktop's `PairingPage.tsx`. Two sections: pending
// requests (approve by request id) and approved users (revoke).
import { useCallback, useMemo, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import { Check, RefreshCw, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';

import { useOpsMutation, useOpsQuery } from '../../store/ops-query';
import { errMsg } from '../../utils/messages';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import { toast } from '../../components/ui/toast';
import { brandColor, screenStyle } from '../../theme';
import {
  approvePairing,
  clearPendingPairing,
  getPairing,
  revokePairing,
  type PairingUser,
  type PairingState,
} from '../../services/pairing';

function keyOf(u: PairingUser): string {
  return `${u.platform}:${u.user_id}`;
}

export function PairingScreen() {
  const { authed } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);

  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => void } | null>(null);

  // Connection-scoped cache entry replaces the hand-rolled load/epoch pair.
  const list = useOpsQuery<PairingState>({
    key: ['pairing'],
    get: (get) => getPairing(get),
    enabled: authed,
  });
  const pending = useMemo(() => list.data?.pending ?? [], [list.data]);
  const approved = useMemo(() => list.data?.approved ?? [], [list.data]);
  const loading = list.isPending;
  const refreshing = list.isRefetching;
  const error = list.error ? errMsg(list.error) : null;
  const refresh = () => void list.refetch();

  const approve = useOpsMutation<void, { platform: string; requestId: string; userId: string; name: string }>({
    mutationFn: (mut, v) => approvePairing(mut, v.platform, v.requestId),
    done: [['pairing']],
    onSuccess: (_d, v) => { toast({ title: 'Approved', description: v.name }); },
    onError: (e) => toast({ title: 'Approve failed', description: errMsg(e), variant: 'destructive' }),
  });
  // Which row's Approve button is in flight — keyed off the mutation variables.
  const approving =
    approve.isPending && approve.variables ? `${approve.variables.platform}:${approve.variables.userId}` : null;

  const revoke = useOpsMutation<void, { platform: string; userId: string; name: string }>({
    mutationFn: (mut, v) => revokePairing(mut, v.platform, v.userId),
    done: [['pairing']],
    onSuccess: (_d, v) => { toast({ title: 'Revoked', description: v.name }); },
    onError: (e) => toast({ title: 'Revoke failed', description: errMsg(e), variant: 'destructive' }),
  });

  const clear = useOpsMutation<number, void>({
    mutationFn: (mut) => clearPendingPairing(mut),
    done: [['pairing']],
    onSuccess: (cleared) => { toast({ title: `Cleared ${cleared} pending request(s)` }); },
    onError: (e) => toast({ title: 'Clear failed', description: errMsg(e), variant: 'destructive' }),
  });

  const handleApprove = useCallback(
    (user: PairingUser) => {
      if (!user.request_id) {
        toast({ title: 'Missing pairing request', variant: 'destructive' });
        return;
      }
      approve.mutate({ platform: user.platform, requestId: user.request_id, userId: user.user_id, name: user.user_name || user.user_id });
    },
    [approve],
  );

  const handleRevoke = useCallback(
    (user: PairingUser) => {
      setConfirm({
        title: 'Revoke access',
        body: `"${user.user_name || user.user_id}" will lose access. This cannot be undone.`,
        run: () => revoke.mutate({ platform: user.platform, userId: user.user_id, name: user.user_name || user.user_id }),
      });
    },
    [revoke],
  );

  const handleClearPending = useCallback(() => {
    if (pending.length === 0) return;
    setConfirm({
      title: 'Clear pending',
      body: `Clear all ${pending.length} pending pairing request(s)?`,
      run: () => clear.mutate(),
    });
  }, [clear, pending.length]);

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
      <ScreenScaffold
        header={
          <ScreenHeader
            title="Pairing"
            subtitle={`${pending.length} pending · ${approved.length} approved`}
            actions={
              <div className="flex items-center gap-1">
                {pending.length > 0 && (
                  <HeaderIconButton aria-label="Clear pending" onClick={handleClearPending}>
                    <Trash2 size={20} color={dark ? '#e5e5e5' : '#333'} />
                  </HeaderIconButton>
                )}
                <HeaderIconButton aria-label="Refresh pairing" onClick={refresh}>
                  <RefreshCw size={20} color={dark ? '#e5e5e5' : '#333'} className={refreshing ? 'animate-spin' : ''} />
                </HeaderIconButton>
              </div>
            }
          />
        }
        contentClassName="px-4 py-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          {loading && !refreshing ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={24} color={brand} />
            </div>
          ) : error ? (
            <ErrorRetry error={error} onRetry={refresh} />
          ) : (
            <>
              <div className="flex items-center gap-2 px-1">
                <Users size={15} color={brand} />
                <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                  Pending requests ({pending.length})
                </span>
              </div>
              {pending.length === 0 ? (
                <Card>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">No pending pairing requests.</div>
                </Card>
              ) : (
                pending.map((user) => {
                  const key = keyOf(user);
                  return (
                    <Card key={key}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-neutral-600 dark:text-neutral-300">
                              {user.platform}
                            </span>
                            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                              {user.user_name || user.user_id}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-neutral-400">
                            {user.user_name && <span className="truncate font-mono">{user.user_id}</span>}
                            {user.ageMinutes != null && <span>{user.ageMinutes}m ago</span>}
                          </div>
                        </div>
                        <Button
                          aria-label={`Approve ${user.user_name || user.user_id}`}
                          onClick={() => void handleApprove(user)}
                          disabled={approving === key || !user.request_id}
                          className="h-auto sm:h-auto shrink-0 rounded-xl px-3 py-2">
                          {approving === key ? <Spinner size={14} color="#fff" /> : <Check size={14} color="#fff" />}
                          <span className="text-xs font-semibold text-white">Approve</span>
                        </Button>
                      </div>
                    </Card>
                  );
                })
              )}

              <div className="mt-2 flex items-center gap-2 px-1">
                <ShieldCheck size={15} color={brand} />
                <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                  Approved users ({approved.length})
                </span>
              </div>
              {approved.length === 0 ? (
                <Card>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">No approved users.</div>
                </Card>
              ) : (
                approved.map((user) => (
                  <Card key={keyOf(user)}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-neutral-600 dark:text-neutral-300">
                            {user.platform}
                          </span>
                          <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                            {user.user_id}
                          </span>
                        </div>
                        {user.user_name && (
                          <div className="mt-0.5 truncate text-[11px] text-neutral-400">{user.user_name}</div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={`Revoke ${user.user_name || user.user_id}`}
                        onClick={() => handleRevoke(user)}
                        className="shrink-0 rounded-lg">
                        <X size={16} color="#ef4444" />
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </>
          )}
        </div>
      </ScreenScaffold>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        description={confirm?.body}
        confirmLabel={confirm?.title === 'Revoke access' ? 'Revoke' : 'Clear'}
        destructive
        onConfirm={() => confirm?.run()}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
      />
    </div>
  );
}
