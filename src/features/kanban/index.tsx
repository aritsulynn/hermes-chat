// Kanban board screen — parity with the desktop kanban plugin, phone-sized:
// board switcher, collapsible columns, cards, create/move/edit/delete tasks.
// Talks to the plugin's own REST router (see hermes-agent
// plugins/kanban/dashboard/plugin_api.py + apps/desktop/src/plugins/kanban).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { connectionScope, getKanbanBoard, saveKanbanBoard } from '../../services/connection';
import * as api from '../../services/api';
import { errMsg } from '../../utils/messages';
import { HamburgerBtn } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Input } from '../../components/ui/input';
import { Alert as UIAlert, AlertDescription } from '../../components/ui/alert';
import { ConfirmDialog } from '../../components/ui/dialog';
import { FormSheet } from '../../components/ui/sheets';
import { Spinner } from '../../components/ui/bits';
import { CardChips } from './components/CardChips';
import { placeholderColor, screenStyle } from '../../theme';
import { asTask, dotOf } from './helpers';
import type { BoardMeta, KanbanBoardData, KanbanTask } from './types';

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
      className="h-auto sm:h-auto flex-col items-stretch justify-start gap-0 rounded-xl border-neutral-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-[#1c1c1c]"
>
      <span
        className="text-[14px] font-medium leading-[19px] text-neutral-950 dark:text-neutral-100 line-clamp-2"
>
        {task.title}
      </span>
      {!!task.body && (
        <span
          className="mt-0.5 text-[12px] leading-[17px] text-neutral-500 dark:text-neutral-400 line-clamp-2"
>
          {task.body}
        </span>
      )}
      <CardChips t={task} dark={dark} />
    </Button>
  );
});

export function KanbanScreen() {
  const { booting, authed, host, username, opsGet, opsMut, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  // One placeholder colour per scheme — the create/edit sheets pass it to
  // four inputs, so it must not be recomputed on every render.
  const placeholder = useMemo(() => placeholderColor(dark), [dark]);

  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [slug, setSlug] = useState('');
  const [board, setBoard] = useState<KanbanBoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-column collapse overrides; absence = auto (empty + archived collapse).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Detail sheet task + its editable fields.
  const [detail, setDetail] = useState<KanbanTask | null>(null);
  // Themed replacement for the old Alert.alert delete confirm.
  const [confirmDelete, setConfirmDelete] = useState<{ title: string; body: string; run: () => void } | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);
  // Create sheet fields.
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newStatus, setNewStatus] = useState('');
  // Bottom sheets. Plain controlled booleans: the sheets are Radix dialogs,
  // so there is no imperative present/dismiss to marshal.
  useEffect(() => {
    if (authed) return;
    setBoards([]);
    setSlug('');
    setBoard(null);
    setCollapsed({});
    setDetail(null);
    setError(null);
  }, [authed]);

  useEffect(() => {
    (navigation as any).setOptions?.({
      headerLeft: () => <HamburgerBtn />,
      headerTintColor: dark ? '#f5f5f5' : '#111',
      title: 'Kanban',
    });
  }, [navigation, dark]);

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

  const loadBoards = useCallback(async (): Promise<BoardMeta[]> => {
    const scope = getAuthScope();
    try {
      const r: any = await opsGet(api.kanbanBoards());
      if (getAuthScope() !== scope) return [];
      const rows = Array.isArray(r?.boards) ? r.boards : [];
      const list: BoardMeta[] = rows.map((b: any) => ({
        slug: String(b?.slug ?? ''),
        ...(typeof b?.name === 'string' ? { name: b.name } : {}),
        ...(typeof b?.is_current === 'boolean' ? { is_current: b.is_current } : {}),
        ...(typeof b?.total === 'number' ? { total: b.total } : {}),
      }));
      setBoards(list);
      return list;
    } catch {
      if (getAuthScope() === scope) setBoards([]);
      return [];
    }
  }, [getAuthScope, opsGet]);

  const loadBoard = useCallback(async (): Promise<KanbanBoardData | null> => {
    const scope = getAuthScope();
    try {
      const r: any = await opsGet(api.kanbanBoard(boardQuery('include_archived=true')));
      if (getAuthScope() !== scope) return null;
      const cols = Array.isArray(r?.columns) ? r.columns : [];
      const data: KanbanBoardData = {
        columns: cols.map((c: any) => ({
          name: String(c?.name ?? '(col)'),
          tasks: Array.isArray(c?.tasks) ? c.tasks.map(asTask) : [],
        })),
      };
      setBoard(data);
      setError(null);
      return data;
    } catch (e) {
      if (getAuthScope() === scope) {
        setError(errMsg(e));
        setBoard(null);
      }
      return null;
    }
  }, [getAuthScope, opsGet, boardQuery]);

  const reload = useCallback(
    async (pull = false) => {
      if (pull) setRefreshing(true);
      else setLoading(true);
      try {
        const list = await loadBoards();
        // First run: restore the saved board, else the server current.
        if (!slug) {
          const saved = await getKanbanBoard(connectionScope(host, username)).catch(() => null);
          const pick =
            (saved && list.some((b) => b.slug === saved) && saved) ||
            list.find((b) => b.is_current)?.slug ||
            list[0]?.slug ||
            '';
          if (pick && pick !== slug) {
            setSlug(pick);
            return; // boardQuery changes → effect below reloads the board
          }
        }
        await loadBoard();
      } finally {
        if (pull) setRefreshing(false);
        else setLoading(false);
      }
    },
    [loadBoards, loadBoard, slug, host, username],
  );

  // Board body follows the selected slug.
  useEffect(() => {
    if (!authed) return;
    setCollapsed({});
    setDetail(null);
    setLoading(true);
    void loadBoard().finally(() => setLoading(false));
  }, [authed, slug, loadBoard]);

  useEffect(() => {
    if (authed) void reload();
  }, [authed, reload]);

  const pickSlug = useCallback(
    (s: string) => {
      setSlug(s);
      void saveKanbanBoard(s, connectionScope(host, username));
    },
    [host, username],
  );

  const isCollapsed = (name: string, count: number) =>
    collapsed[name] ?? (name === 'archived' || count === 0);

  const totalTasks = useMemo(
    () => (board?.columns ?? []).reduce((n, c) => n + c.tasks.length, 0),
    [board],
  );
  const activeBoard = boards.find((b) => b.slug === slug);

  const openDetail = useCallback((t: KanbanTask) => {
    setDetail(t);
    setEditTitle(t.title);
    setEditBody(t.body ?? '');
  }, []);

  const toggleColumn = useCallback((name: string, next: boolean) => {
    setCollapsed((p) => ({ ...p, [name]: next }));
  }, []);

  const mutate = async (fn: () => Promise<unknown>, after?: () => void) => {
    const scope = getAuthScope();
    setSaving(true);
    try {
      await fn();
      if (getAuthScope() !== scope) return;
      const b = await loadBoard();
      after?.();
      // Keep the detail sheet on the fresh row so consecutive moves work.
      if (detail && b) {
        const fresh = b.columns.flatMap((c) => c.tasks).find((t) => t.id === detail.id);
        if (fresh) {
          setDetail(fresh);
          setEditTitle(fresh.title);
          setEditBody(fresh.body ?? '');
        } else {
          setDetail(null);
        }
      }
    } catch (e) {
      if (getAuthScope() === scope) setError(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setSaving(false);
    }
  };

  const moveTask = (t: KanbanTask, status: string) => {
    if (!t.id || t.status === status) return;
    void mutate(() => opsMut(api.kanbanTask(t.id, boardQuery()), 'PATCH', { status }));
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
    void mutate(() => opsMut(api.kanbanTask(detail.id, boardQuery()), 'PATCH', patch));
  };

  const deleteDetail = () => {
    if (!detail) return;
    const t = detail;
    setConfirmDelete({
      title: 'Delete task',
      body: `"${t.title}"? This can't be undone.`,
      run: () => void mutate(() => opsMut(api.kanbanTask(t.id, boardQuery()), 'DELETE')),
    });
  };

  const createTask = () => {
    const title = newTitle.trim();
    if (!title) return;
    const cols = board?.columns.map((c) => c.name) ?? [];
    const status = (newStatus || cols.find((c) => c === 'todo') || cols.find((c) => c !== 'archived') || cols[0] || '').trim();
    void mutate(
      () =>
        opsMut(api.kanbanTasks(boardQuery()), 'POST', {
          title,
          ...(newBody.trim() ? { body: newBody.trim() } : {}),
          ...(status ? { status } : {}),
        }),
      () => {
        setShowCreate(false);
        setNewTitle('');
        setNewBody('');
        setNewStatus('');
      },
    );
  };

  if (booting) {
    return (
      <div className="flex flex-col flex-1 bg-white dark:bg-black items-center justify-center gap-3">
        
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
      <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-black">
        
        {/* Board switcher + new-task button */}
        <div className="flex items-center gap-2 px-3 pt-2">
          <div className="overflow-x-auto"><div className="gap-2 grow">
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
                  className="rounded-full px-3 py-1.5"
>
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
          </div></div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh board"
            onClick={() => void reload(true)}
            className="h-9 w-9 shrink-0"
          >
            <RefreshCw size={18} color={dark ? '#e5e5e5' : '#333'} className={refreshing ? 'animate-spin' : ''} />
          </Button>
          <Button
            onClick={() => setShowCreate(true)}
            role="button"
            aria-label="New task"
            variant="default"
            size="icon"
            className="h-9 w-9 rounded-full"
          >
            <span className="text-[20px] leading-[20px]">+</span>
          </Button>
        </div>
        {!!error && (
          <div className="px-3.5 pt-2">
            <UIAlert icon={TriangleAlert} variant="destructive">
              <AlertDescription className="text-[#c5221f] dark:text-[#ff7b72]">{error}</AlertDescription>
            </UIAlert>
          </div>
        )}
        <div className="overflow-y-auto"><div className="mx-auto w-full max-w-4xl p-3 gap-2.5 pb-6">
          {loading && <Spinner size={14} color="currentColor" />}
          {!loading && !board && !error && (
            <div className="text-sm text-neutral-500 dark:text-neutral-400">No board data.</div>
          )}
          {!loading && board && totalTasks === 0 && (
            <div className="text-sm text-neutral-500 dark:text-neutral-400">
              No tasks yet — tap + to create one.
            </div>
          )}
          {(board?.columns ?? []).map((col) => {
            const shut = isCollapsed(col.name, col.tasks.length);
            return (
              <div
                key={col.name}
                className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800"
>
                <Button
                  onClick={() => toggleColumn(col.name, !shut)}
                  variant="ghost"
                  className="justify-start gap-2 rounded-none bg-[#f4f4f6] px-3 py-2.5 dark:bg-[#161616]"
>
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
        </div></div>

        {/* Task detail sheet. */}
        <FormSheet
          open={!!detail}
          onOpenChange={(o) => !o && setDetail(null)}
>
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
                {statusOptions.filter((s) => s !== 'archived').map((s) => {
                  const on = detail?.status === s;
                  return (
                    <Button
                      key={s}

                      aria-pressed={on}
                      aria-label={`Move to ${s}`}
                      onClick={() => detail && moveTask(detail, s)}
                      variant={on ? 'default' : 'outline'}
                      size="sm"
                      className="rounded-full px-3 py-1.5"
>
                      <span className="text-[13px] font-medium capitalize">
                        {s}
                      </span>
                    </Button>
                  );
                })}
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Notes
              </div>
              <Textarea
                aria-label="Notes"
                className="min-h-[90px] rounded-xl border border-neutral-300 px-3 py-2 text-[14px] leading-[20px] text-neutral-950 dark:border-neutral-700 dark:text-neutral-100"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                placeholder="Details…"

              />
              <CardChips t={detail} dark={dark} />
              <div className="flex gap-2 pt-1">
                <Button
                  onClick={saveDetail}
                  variant="default"
                  className="flex-1 rounded-xl px-4 py-3"
                  disabled={saving}
>
                  <span className="text-[15px] font-semibold">{saving ? 'Saving…' : 'Save'}</span>
                </Button>
                <Button
                  onClick={deleteDetail}
                  variant="destructive"
                  className="rounded-xl px-4 py-3"
                  disabled={saving}
>
                  <span className="text-[15px] font-semibold">Delete</span>
                </Button>
              </div>
            </>
          )}
        </FormSheet>

        {/* New task sheet */}
        <FormSheet
          open={showCreate}
          onOpenChange={setShowCreate}
>
          <div className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">New task</div>
          <Input
            aria-label="Title"
            className="rounded-xl border border-neutral-300 px-3 py-2.5 text-[15px] text-neutral-950 dark:border-neutral-700 dark:text-neutral-100"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title"
          />
          <Textarea
            className="min-h-[80px] rounded-xl border border-neutral-300 px-3 py-2.5 text-[14px] text-neutral-950 dark:border-neutral-700 dark:text-neutral-100"
            aria-label="Notes"
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Details (optional)"

          />
          <div className="flex flex-wrap gap-1.5">
            {statusOptions.filter((s) => s !== 'archived').map((s) => {
              const on = createStatus === s;
              return (
                <Button
                  key={s}

                  aria-pressed={on}
                  aria-label={`Create in ${s}`}
                  onClick={() => setNewStatus(s)}
                  variant={on ? 'default' : 'outline'}
                  size="sm"
                  className="px-3 py-1.5"
>
                  <span className="text-[13px] font-medium capitalize">
                    {s}
                  </span>
                </Button>
              );
            })}
          </div>
          <Button
            onClick={createTask}
            variant="default"
            className="rounded-xl px-4 py-3"
            disabled={!newTitle.trim() || saving}
>
            <span className="text-[15px] font-semibold">{saving ? 'Creating…' : 'Create task'}</span>
          </Button>
        </FormSheet>
      </div>

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
