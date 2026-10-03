// Kanban board screen — parity with the desktop kanban plugin, phone-sized:
// board switcher, collapsible columns, cards, create/move/edit/delete tasks.
// Talks to the plugin's own REST router (see hermes-agent
// plugins/kanban/dashboard/plugin_api.py + apps/desktop/src/plugins/kanban).
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { connectionScope, getKanbanBoard, saveKanbanBoard } from '../../services/connection';
import * as api from '../../services/api';
import { opsKey, useOpsMutation, useOpsQuery } from '../../store/ops-query';
import { errMsg } from '../../utils/messages';
import { HeaderIconButton, ScreenHeader, ScreenScaffold, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Input } from '../../components/ui/input';
import { Alert as UIAlert, AlertDescription } from '../../components/ui/alert';
import { ConfirmDialog } from '../../components/ui/dialog';
import { FormSheet } from '../../components/ui/sheets';
import { CardChips } from './components/CardChips';
import { screenStyle } from '../../theme';
import { asBoard, asBoardList, dotOf, pickBoardSlug } from './helpers';
import type { KanbanBoardData, KanbanTask } from './types';

// Memoized task row: opening/editing one card must not re-render every card
// on the board. The press binding closes over the row's own task, so the
// parent only passes the stable onOpen callback.
const KanbanTaskRow = memo(function KanbanTaskRow({
  task,
  dark,
  onOpen,
}: {
  task: KanbanTask;
  dark: boolean;
  onOpen: (t: KanbanTask) => void;
}) {
  return (
    <Button
      onClick={() => onOpen(task)}
      variant="outline"
      className="h-auto sm:h-auto flex-col items-stretch justify-start gap-0 rounded-xl border-border bg-popover p-2.5 ">
      <span className="text-[14px] font-medium leading-[19px] text-neutral-950 dark:text-neutral-100 line-clamp-2">
        {task.title}
      </span>
      {!!task.body && (
        <span className="mt-0.5 text-[12px] leading-[17px] text-neutral-500 dark:text-neutral-400 line-clamp-2">
          {task.body}
        </span>
      )}
      <CardChips t={task} dark={dark} />
    </Button>
  );
});

export function KanbanScreen() {
  const { booting, authed, host, username, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';

  const [slug, setSlug] = useState('');
  // Per-column collapse overrides; absence = auto (empty + archived collapse).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Detail sheet task + its editable fields.
  const [detail, setDetail] = useState<KanbanTask | null>(null);
  // Themed replacement for the old Alert.alert delete confirm.
  const [confirmDelete, setConfirmDelete] = useState<{ title: string; body: string; run: () => void } | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  // Create sheet fields.
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newStatus, setNewStatus] = useState('');

  // A `navigation.setOptions({ headerLeft, title })` effect used to live here.
  // Under React Navigation the *navigator* drew the screen's title bar, so this
  // screen never rendered one of its own — and `navigation` does not exist in
  // the web build, so nothing drew it there either. Kanban had no header at all,
  // which meant no title and, on a phone, no way to open the sidebar.
  // It is a `ScreenHeader` now, like every other screen.

  const boardQuery = useCallback(
    (extra = '') => {
      const q = new URLSearchParams();
      if (slug) q.set('board', slug);
      if (extra) {
        for (const [k, v] of new URLSearchParams(extra)) q.set(k, v);
      }
      const qs = q.toString();
      return qs ? `?${qs}` : '';
    },
    [slug],
  );

  // Two separate queries, and that is the point. The old screen ran both loads
  // concurrently inside one `reload` and wrote both into one pair of useState,
  // with no guard at all: switch boards quickly and the previous board's
  // response could land after the new one's and repaint the wrong board. Here
  // the slug is part of the board query's key, so a stale response belongs to a
  // key nobody is reading any more, and the scope in both keys means a
  // superseded fetch cannot render under a new connection either.
  const boardsQ = useOpsQuery({
    key: ['kanban', 'boards'],
    get: (get) => get(api.kanbanBoards()),
    select: asBoardList,
    enabled: authed,
  });
  const boardQ = useOpsQuery({
    key: ['kanban', 'board', slug],
    get: (get) => get(api.kanbanBoard(slug ? `?board=${encodeURIComponent(slug)}&include_archived=true` : '')),
    select: asBoard,
    enabled: authed,
  });

  const boards = boardsQ.data ?? [];
  const board = boardQ.data ?? null;
  const loading = boardsQ.isPending || boardQ.isPending;
  const refreshing = boardsQ.isRefetching || boardQ.isRefetching;
  const failed = boardsQ.error ?? boardQ.error;
  const error = failed ? errMsg(failed) : null;

  const reload = () => {
    void boardsQ.refetch();
    void boardQ.refetch();
  };

  // First run picks the board: this account's last one, else the server's
  // current, else the first. Reads the saved slug from storage rather than
  // storing it in state, so it cannot drift out of step with the query cache.
  useEffect(() => {
    if (slug || !boardsQ.data) return;
    let live = true;
    void getKanbanBoard(connectionScope(host, username))
      .catch(() => null)
      .then((saved) => {
        if (live) setSlug(pickBoardSlug(boardsQ.data!, saved));
      });
    return () => {
      live = false;
    };
  }, [slug, boardsQ.data, host, username]);

  // Per-board view state resets when the board changes.
  useEffect(() => {
    setCollapsed({});
    setDetail(null);
  }, [slug]);

  const pickSlug = useCallback(
    (s: string) => {
      setSlug(s);
      void saveKanbanBoard(s, connectionScope(host, username));
    },
    [host, username],
  );

  const isCollapsed = (name: string, count: number) => collapsed[name] ?? (name === 'archived' || count === 0);

  const totalTasks = useMemo(() => (board?.columns ?? []).reduce((n, c) => n + c.tasks.length, 0), [board]);
  const activeBoard = boards.find((b) => b.slug === slug);

  const openDetail = useCallback((t: KanbanTask) => {
    setDetail(t);
    setEditTitle(t.title);
    setEditBody(t.body ?? '');
  }, []);

  const toggleColumn = useCallback((name: string, next: boolean) => {
    setCollapsed((p) => ({ ...p, [name]: next }));
  }, []);

  // One mutation for every task write (move / edit / delete / create). `done`
  // invalidates the board key, which is the old `await loadBoard()` tail — and
  // `onSuccess` runs after that refetch settles so the open detail sheet can be
  // re-anchored on the fresh row, which is what lets two consecutive moves work
  // from the same sheet.
  const taskWrite = useOpsMutation({
    mutationFn: (opsMut, vars: { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) =>
      opsMut(vars.path, vars.method, vars.body),
    done: [['kanban', 'board', slug]],
    onSuccess: (_data, _vars, client) => {
      if (!detail) return;
      const fresh = client
        .getQueryData<KanbanBoardData>([...opsKey('kanban', 'board', slug), getAuthScope()])
        ?.columns.flatMap((c) => c.tasks)
        .find((t) => t.id === detail.id);
      if (fresh) {
        setDetail(fresh);
        setEditTitle(fresh.title);
        setEditBody(fresh.body ?? '');
      } else {
        setDetail(null);
      }
    },
  });
  const saving = taskWrite.isPending;

  const moveTask = (t: KanbanTask, status: string) => {
    if (!t.id || t.status === status) return;
    taskWrite.mutate({ path: api.kanbanTask(t.id, boardQuery()), method: 'PATCH', body: { status } });
  };

  const saveDetail = () => {
    if (!detail || !editTitle.trim()) return;
    const patch: Record<string, unknown> = {};
    if (editTitle.trim() !== detail.title) patch.title = editTitle.trim();
    if (editBody !== (detail.body ?? '')) patch.body = editBody;
    if (!Object.keys(patch).length) {
      setDetail(null);
      return;
    }
    taskWrite.mutate({ path: api.kanbanTask(detail.id, boardQuery()), method: 'PATCH', body: patch });
  };

  const deleteDetail = () => {
    if (!detail) return;
    const t = detail;
    setConfirmDelete({
      title: 'Delete task',
      body: `"${t.title}"? This can't be undone.`,
      run: () => taskWrite.mutate({ path: api.kanbanTask(t.id, boardQuery()), method: 'DELETE' }),
    });
  };

  const createTask = () => {
    const title = newTitle.trim();
    if (!title) return;
    const cols = board?.columns.map((c) => c.name) ?? [];
    const status = (
      newStatus ||
      cols.find((c) => c === 'todo') ||
      cols.find((c) => c !== 'archived') ||
      cols[0] ||
      ''
    ).trim();
    taskWrite.mutate(
      {
        path: api.kanbanTasks(boardQuery()),
        method: 'POST',
        body: {
          title,
          ...(newBody.trim() ? { body: newBody.trim() } : {}),
          ...(status ? { status } : {}),
        },
      },
      {
        onSuccess: () => {
          setShowCreate(false);
          setNewTitle('');
          setNewBody('');
          setNewStatus('');
        },
      },
    );
  };

  if (booting) {
    return (
      <div className="flex flex-col flex-1 bg-background items-center justify-center gap-3">
        <Spinner size={24} color="currentColor" />
      </div>
    );
  }
  if (!authed) return <Redirect to="/login" replace />;

  const statusOptions = board?.columns.map((c) => c.name) ?? [];
  const createStatus =
    newStatus || statusOptions.find((c) => c === 'todo') || statusOptions.find((c) => c !== 'archived') || '';

  return (
    <div style={screenStyle(dark)}>
      <ScreenScaffold
        header={
          <>
            <ScreenHeader
              title="Kanban"
              subtitle={activeBoard?.name}
              actions={
                <div className="flex items-center gap-0.5">
                  <HeaderIconButton aria-label="Refresh board" onClick={reload}>
                    <RefreshCw
                      size={20}
                      color={dark ? '#e5e5e5' : '#333'}
                      className={refreshing ? 'animate-spin' : ''}
                    />
                  </HeaderIconButton>
                  <HeaderIconButton onClick={() => setShowCreate(true)} role="button" aria-label="New task">
                    <span className="text-[20px] leading-[20px]">+</span>
                  </HeaderIconButton>
                </div>
              }
            />
            {/* Board switcher. The refresh and new-task buttons moved up into the
                header, so this row is chips only and can scroll the full width. */}
            <div className="flex items-center gap-2 px-3 pt-2">
              <div className="overflow-x-auto">
                <div className="grow flex gap-2">
                  {boards.map((b) => {
                    const active = b.slug === slug || (!slug && b.is_current);
                    return (
                      <Button
                        key={b.slug}

                        aria-pressed={active}
                        aria-label={b.name || b.slug}
                        onClick={() => pickSlug(b.slug)}
                        variant={active ? 'default' : 'outline'}
                        size="sm"
                        className="rounded-full px-3 py-1.5">
                        <span className="text-[13px] font-semibold">
                          {b.name || b.slug}
                          {typeof b.total === 'number' ? ` · ${b.total}` : ''}
                        </span>
                      </Button>
                    );
                  })}
                  {boards.length === 0 && !loading && (
                    <div className="py-1.5 text-[13px] text-neutral-500 dark:text-neutral-400">
                      {activeBoard?.name || 'default board'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        }>
        {!!error && (
          <div className="px-3.5 pt-2">
            <UIAlert icon={TriangleAlert} variant="destructive">
              <AlertDescription className="text-[#c5221f] dark:text-[#ff7b72]">{error}</AlertDescription>
            </UIAlert>
          </div>
        )}
        {/* `flex flex-col` because `gap-2.5` is inert on a block box — this is
            the same trap the old drawer's recents list carried a note about.
            As a block container the gap did nothing and the column cards sat
            flush against each other, border to border, reading as one tall
            striped object rather than a list. */}
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2.5 p-3 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          {loading && <Spinner size={14} color="currentColor" />}
          {!loading && !board && !error && (
            <div className="text-sm text-neutral-500 dark:text-neutral-400">No board data.</div>
          )}
          {!loading && board && totalTasks === 0 && (
            <div className="text-sm text-neutral-500 dark:text-neutral-400">No tasks yet — tap + to create one.</div>
          )}
          {(board?.columns ?? []).map((col) => {
            const shut = isCollapsed(col.name, col.tasks.length);
            return (
              <div key={col.name} className="overflow-hidden rounded-2xl border border-border">
                <Button
                  onClick={() => toggleColumn(col.name, !shut)}
                  variant="ghost"
                  className="justify-start gap-2 rounded-none bg-elevated px-3 py-2.5">
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dotOf(col.name) }} />
                  <span className="flex-1 text-[14px] font-bold capitalize text-neutral-900 dark:text-neutral-100">
                    {col.name}
                  </span>
                  <span className="text-[12px] font-semibold text-neutral-500 dark:text-neutral-400">
                    {col.tasks.length}
                  </span>
                  <span className="text-[12px] text-neutral-400 dark:text-neutral-500">{shut ? '▸' : '▾'}</span>
                </Button>
                {!shut && (
                  <div className="flex flex-col gap-2 p-2.5">
                    {col.tasks.length === 0 && (
                      <div className="px-1 py-1 text-[13px] text-neutral-400 dark:text-neutral-500">empty</div>
                    )}
                    {col.tasks.map((t) => (
                      <KanbanTaskRow key={t.id} task={t} dark={dark} onOpen={openDetail} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScreenScaffold>

      {/* Task detail sheet. */}
      <FormSheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        {detail && (
          <>
            <Input
              aria-label="Title"
              // Input is a fixed 40px single-line field; a title long enough
              // to wrap has to grow the box and hang from the top, or the
              // second line spills over the label below.
              className="h-auto sm:h-auto min-h-10 items-start py-2 text-[17px] font-bold text-neutral-950 dark:text-neutral-100"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Title"
            />
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Move to
            </div>
            <div className="flex flex-wrap gap-1.5">
              {statusOptions
                .filter((s) => s !== 'archived')
                .map((s) => {
                  const on = detail?.status === s;
                  return (
                    <Button
                      key={s}

                      aria-pressed={on}
                      aria-label={`Move to ${s}`}
                      onClick={() => detail && moveTask(detail, s)}
                      variant={on ? 'default' : 'outline'}
                      size="sm"
                      className="rounded-full px-3 py-1.5">
                      <span className="text-[13px] font-medium capitalize">{s}</span>
                    </Button>
                  );
                })}
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Notes
            </div>
            <Textarea
              aria-label="Notes"
              className="min-h-[90px] rounded-xl border border-border px-3 py-2 text-[14px] leading-[20px] text-neutral-950 dark:text-neutral-100"
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              placeholder="Details…"
            />
            <CardChips t={detail} dark={dark} />
            <div className="flex gap-2 pt-1">
              <Button onClick={saveDetail} variant="default" className="flex-1 rounded-xl px-4 py-3" disabled={saving}>
                <span className="text-[15px] font-semibold">{saving ? 'Saving…' : 'Save'}</span>
              </Button>
              <Button onClick={deleteDetail} variant="destructive" className="rounded-xl px-4 py-3" disabled={saving}>
                <span className="text-[15px] font-semibold">Delete</span>
              </Button>
            </div>
          </>
        )}
      </FormSheet>

      {/* New task sheet */}
      <FormSheet open={showCreate} onOpenChange={setShowCreate}>
        <div className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">New task</div>
        <Input
          aria-label="Title"
          className="rounded-xl border border-border px-3 py-2.5 text-[15px] text-neutral-950 dark:text-neutral-100"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Title"
        />
        <Textarea
          className="min-h-[80px] rounded-xl border border-border px-3 py-2.5 text-[14px] text-neutral-950 dark:text-neutral-100"
          aria-label="Notes"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder="Details (optional)"
        />
        <div className="flex flex-wrap gap-1.5">
          {statusOptions
            .filter((s) => s !== 'archived')
            .map((s) => {
              const on = createStatus === s;
              return (
                <Button
                  key={s}

                  aria-pressed={on}
                  aria-label={`Create in ${s}`}
                  onClick={() => setNewStatus(s)}
                  variant={on ? 'default' : 'outline'}
                  size="sm"
                  className="px-3 py-1.5">
                  <span className="text-[13px] font-medium capitalize">{s}</span>
                </Button>
              );
            })}
        </div>
        <Button
          onClick={createTask}
          variant="default"
          className="rounded-xl px-4 py-3"
          disabled={!newTitle.trim() || saving}>
          <span className="text-[15px] font-semibold">{saving ? 'Creating…' : 'Create task'}</span>
        </Button>
      </FormSheet>

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete?.title ?? ''}
        description={confirmDelete?.body}
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirmDelete?.run()}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
      />
    </div>
  );
}
