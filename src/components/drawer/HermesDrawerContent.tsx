import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Ellipsis,
  Search,
  Settings,
  SquarePen,
  X,
} from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { navigate } from '../../store/nav';
import { useLongPress } from '../../hooks/use-long-press';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../ui/popover';
import { ConfirmDialog } from '../ui/dialog';
import { Spinner } from '../ui/bits';
import { Text as UIText } from '../ui/text';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { MORE_NAV_ITEMS, NAV_ITEMS, PROFILE_NAV_ITEMS } from './nav-config';
import { brandColor, screenBg } from '../../theme';
import { formatRelative, formatSessionSource } from '../../utils/format';
import { profileSessionKey } from '../../store/helpers';
import type { LiveStatus } from '../../store/live-sessions';
import type { ScopedSessionSummary } from '../../store/types';

// Memoized recents row: the session list is already windowed to 50 rendered
// rows (visibleCount) with server pagination, so a virtualised list inside the
// drawer's scroll view would fight the scroll — memo + stable callbacks keep
// re-renders to the row that actually changed instead.
//
// `preview`/`startedAt` come from `session.list` and were fetched all along but
// never rendered, which made every row look identical. The preview answers
// "which one of these five same-titled chats was that?"; the stamp answers
// "is the one I want recent?".
// `session.active_list` reports one status per live session; these two decide how
// a row says so. `waiting` is a turn blocked on the user, so it is the one that
// gets the warmer colour — a spinner alone would read as "busy, fine".
function liveHint(status: LiveStatus): string {
  if (status === 'waiting') return 'Waiting for your answer';
  if (status === 'starting') return 'Starting';
  return 'Working';
}

function liveColor(status: LiveStatus, dark: boolean): string {
  if (status === 'waiting') return dark ? '#f0b429' : '#b45309';
  return dark ? '#7aa7ff' : '#1a73e8';
}

const SessionRow = memo(function SessionRow({
  session,
  active,
  live,
  dark,
  onOpen,
  onDelete,
}: {
  session: ScopedSessionSummary;
  active: boolean;
  live: LiveStatus | undefined;
  dark: boolean;
  onOpen: (s: ScopedSessionSummary) => void;
  onDelete: (s: ScopedSessionSummary) => void;
}) {
  const preview = (session.preview || '').trim();
  const when = formatRelative(session.startedAt);
  // null for the interactive defaults (`tui`/`desktop`/`mobile`) — see
  // formatSessionSource for where this vocabulary comes from.
  const tag = formatSessionSource(session.source);
  // Long-press to delete, as before. The 400ms delay is the native
  // `delayLongPress` this row used to pass.
  const longPress = useLongPress(() => onDelete(session), { delay: 400 });
  return (
    <Button
      variant="ghost"
      aria-label={`Open chat ${session.title || '(untitled)'}`}
      // A turn running in this session is the one thing worth reading off the
      // list at a glance, so it is announced rather than only drawn.
      aria-description={live ? liveHint(live) : undefined}
      onClick={() => onOpen(session)}
      {...longPress}
      className={`h-auto w-full items-start justify-start gap-2 px-3 py-2.5 text-left ${
        active ? 'rounded-xl bg-[#e8e8ec] dark:bg-[#272727]' : ''
      }`}>
      {live ? (
        <span className="pt-[3px]">
          <Spinner size={13} color={liveColor(live, dark)} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <UIText
          numberOfLines={1}
          className={`text-left text-[16px] ${
            active ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]' : 'text-neutral-950 dark:text-neutral-100'
          }`}>
          {session.title || '(untitled)'}
        </UIText>
        {live === 'waiting' ? (
          <UIText
            numberOfLines={1}
            className={`mt-0.5 text-[11px] font-medium ${dark ? 'text-amber-300' : 'text-amber-700'}`}>
            Waiting for your answer
          </UIText>
        ) : null}
        {(preview || when || tag) && (
          <span className="mt-0.5 flex items-center gap-2">
            {when ? (
              <UIText
                numberOfLines={1}
                className={`shrink-0 text-[11px] ${
                  active ? 'text-[#1a73e8] dark:text-[#7aa7ff]' : 'text-neutral-400 dark:text-neutral-500'
                }`}>
                {when}
              </UIText>
            ) : null}
            {tag ? (
              <Badge variant="secondary" className="border-neutral-300 px-1.5 py-0 dark:border-neutral-700">
                <UIText className="text-[10px] font-medium text-neutral-600 dark:text-neutral-300">{tag}</UIText>
              </Badge>
            ) : null}
            {preview ? (
              <UIText
                numberOfLines={1}
                className="min-w-0 flex-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                {preview}
              </UIText>
            ) : null}
          </span>
        )}
      </span>
    </Button>
  );
});

export function HermesDrawerContent({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { pathname } = useLocation();
  const {
    authed,
    username,
    host,
    busy,
    activeProfile,
    profiles,
    refreshProfiles,
    switchProfile,
    sessionId,
    sessionKey,
    openingId,
    sessions,
    messages,
    pendingAskCount,
    newSession,
    openSession,
    refreshSessions,
    loadMoreSessions,
    sessionsHasMore,
    sessionsLoadingMore,
    deleteSessionById,
    liveSessions,
    liveSessionsKnown,
    refreshLiveSessions,
  } = useApp();
  const { theme } = useThemeValue();
  // Hooks FIRST — no early return above this line (authed flips at login;
  // returning early before hooks breaks hook order).
  const [showUserMenu, setShowUserMenu] = useState(false);
  // Themed replacement for the old Alert.alert delete confirm.
  const [confirmDelete, setConfirmDelete] = useState<{ title: string; body: string; run: () => void } | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  // Infinite scroll: render in pages of 50, grow on scroll-bottom. Network
  // fetch only when the local list is exhausted but the server may hold more.
  const [visibleCount, setVisibleCount] = useState(50);
  // Keep Recents fresh every time the drawer opens (replaces the old
  // manual Refresh item).
  useEffect(() => {
    if (open) {
      void refreshProfiles();
      void refreshSessions();
      // Live statuses are polled by the store; opening the drawer is the moment
      // they become visible, so re-read rather than show whatever was last known.
      void refreshLiveSessions();
      if (MORE_NAV_ITEMS.some((item) => pathname === `/${item.name}`)) {
        setShowMoreMenu(true);
      }
    } else {
      // Closing the drawer dismisses the account popover. On the web this is
      // just state, because the Popover root is controlled — the native build
      // had to remount it with a `key` to get the same effect.
      setShowUserMenu(false);
    }
  }, [open, pathname, refreshProfiles, refreshSessions, refreshLiveSessions]);

  // Inline filter replaces the removed /sessions page (drawer is the list now).
  // Memoized so every streamed token doesn't refilter + rebuild rows.
  // MUST stay above the `!authed` early return — hooks can't run after one.
  const ql = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      ql
        ? sessions.filter(
            (s) =>
              (s.title || '').toLowerCase().includes(ql) || (s.preview || '').toLowerCase().includes(ql),
          )
        : sessions,
    [sessions, ql],
  );
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  // New search starts from the top again.
  useEffect(() => {
    setVisibleCount(50);
  }, [ql]);
  // Bottom reached: first reveal more of what's already fetched, else ask the
  // server for the next 100 (session.list is newest-first, limit-based).
  // A DOM scroller fires `scroll` continuously, so the threshold check is
  // enough here — the native build needed momentum/drag-end handlers as a
  // backstop because RN throttles onScroll.
  const handleRecentsScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight > 240) return;
      if (sessionsLoadingMore) return;
      if (visibleCount < filtered.length) {
        setVisibleCount((c) => Math.min(c + 50, filtered.length));
      } else if (!ql && sessionsHasMore) {
        void loadMoreSessions().then((s) => {
          // New rows arrived — reveal the next page immediately.
          if (s.length > filtered.length) setVisibleCount((c) => c + 50);
        });
      }
    },
    [filtered.length, loadMoreSessions, ql, sessionsHasMore, sessionsLoadingMore, visibleCount],
  );
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const handleOpenRecent = useCallback(
    (s: ScopedSessionSummary) => {
      close();
      void openSession(s);
    },
    [close, openSession],
  );
  const handleDeleteRecent = useCallback(
    (s: ScopedSessionSummary) => {
      setConfirmDelete({
        title: 'Delete chat',
        body: `Delete "${s.title || '(untitled)'}"? This can't be undone.`,
        run: () => {
          void deleteSessionById(s.id).then(() => refreshSessions());
        },
      });
    },
    [deleteSessionById, refreshSessions],
  );
  // Theme tokens resolved once per scheme: this panel re-renders on every
  // streamed token and each value feeds several icon/style props below.
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);
  const screen = useMemo(() => screenBg(dark), [dark]);
  if (!authed) return null;
  const dimColor = dark ? '#a3a3a3' : '#555';
  const activeItemClass = 'rounded-xl bg-[#e8e8ec] dark:bg-[#272727]';
  const onChat = pathname === '/chat';
  // session.list ids are STORED ids (sessionKey) while sessionId is the live
  // runtime id minted by resume/create — comparing stored vs live never
  // matches, so highlight must use the stored key.
  const activeId = sessionKey ?? sessionId;
  const hasActiveRecent = sessions.some(
    (s) => onChat && (s.profile ?? activeProfile) === activeProfile && s.id === activeId,
  );
  const isNewChat = onChat && !hasActiveRecent && messages.length === 0;
  const isMoreActive = MORE_NAV_ITEMS.some((item) => pathname === `/${item.name}`);
  const go = (name: string) => {
    close();
    navigate(`/${name}`);
  };
  return (
    <div className="flex h-full flex-col" style={{ background: screen }}>
      <div className="flex-1 overflow-y-auto overscroll-contain pb-4" onScroll={handleRecentsScroll}>
        {searchOpen ? (
          <div className="flex items-center gap-1 px-4 pt-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search chats…"
              autoFocus
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-2.5 text-[16px] text-neutral-950 dark:border-neutral-700 dark:text-neutral-100"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSearchOpen(false);
                setQ('');
              }}>
              <X size={20} color={dimColor} />
            </Button>
          </div>
        ) : (
          /* Uncontrolled on purpose: mounting the root only while the drawer is
             open is what tears its portal down on close. */
          open && (
            <div className="flex items-center px-4 pt-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    data-testid="profile-selector"
                    aria-label={`Switch profile. Active profile: ${activeProfile}`}
                    className="h-auto min-w-0 flex-1 shrink items-center justify-start gap-2 px-1 py-1">
                    <UIText className="text-[26px] font-extrabold text-neutral-950 dark:text-neutral-100">
                      Hermes
                    </UIText>
                    <ChevronDown size={17} color={dimColor} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="start" className="w-72 p-2">
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <div>
                      <UIText className="text-base font-bold text-neutral-950 dark:text-neutral-100">
                        Switch profile
                      </UIText>
                      <UIText className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                        Chat and toolsets use this profile
                      </UIText>
                    </div>
                    <PopoverClose asChild>
                      <Button variant="ghost" size="icon" aria-label="Close profile picker">
                        <X size={18} color={dimColor} />
                      </Button>
                    </PopoverClose>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto">
                    {profiles.length === 0 ? (
                      <div className="rounded-xl bg-neutral-100 px-3 py-3 dark:bg-neutral-900">
                        <UIText className="text-sm text-neutral-600 dark:text-neutral-300">{activeProfile}</UIText>
                      </div>
                    ) : (
                      profiles.map((profile) => {
                        const selected = profile.name === activeProfile;
                        const row = (
                          <Button
                            variant="ghost"
                            data-testid={`profile-option-${profile.name}`}
                            aria-pressed={selected}
                            disabled={busy || selected}
                            onClick={() => {
                              close();
                              void switchProfile(profile.name);
                            }}
                            className={`h-auto w-full items-center justify-start gap-3 px-3 py-3 ${
                              selected ? 'bg-sky-50 dark:bg-sky-950/50' : ''
                            } ${busy && !selected ? 'opacity-50' : ''}`}>
                            <span
                              className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                                selected ? 'bg-sky-100 dark:bg-sky-950' : 'bg-neutral-100 dark:bg-neutral-900'
                              }`}>
                              <CircleUserRound
                                size={17}
                                color={selected ? (dark ? '#7dd3fc' : '#0284c7') : dimColor}
                              />
                            </span>
                            <span className="min-w-0 flex-1 text-left">
                              <UIText
                                numberOfLines={1}
                                className={`min-w-0 text-left text-sm font-semibold ${
                                  selected ? 'text-sky-700 dark:text-sky-300' : 'text-neutral-900 dark:text-neutral-100'
                                }`}>
                                {profile.display_name || profile.name}
                              </UIText>
                              {!!profile.description && (
                                <UIText
                                  numberOfLines={1}
                                  className="min-w-0 text-xs text-neutral-500 dark:text-neutral-400">
                                  {profile.description}
                                </UIText>
                              )}
                            </span>
                            {selected && (
                              <UIText className="text-xs font-semibold text-sky-700 dark:text-sky-300">
                                Active
                              </UIText>
                            )}
                          </Button>
                        );
                        // A disabled row can't run PopoverClose's click handler,
                        // so the active row stays a plain Button (tapping it
                        // does nothing, same as before).
                        return selected || busy ? (
                          <div key={profile.name}>{row}</div>
                        ) : (
                          <PopoverClose asChild key={profile.name}>
                            {row}
                          </PopoverClose>
                        );
                      })
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              <Button variant="ghost" size="icon" aria-label="Search chats" onClick={() => setSearchOpen(true)}>
                <Search size={20} color={dimColor} />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Close menu" onClick={close}>
                <X size={20} color={dimColor} />
              </Button>
            </div>
          )
        )}
        <div className="flex flex-col gap-1 px-3 pt-2">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (busy) return;
              close();
              void newSession();
            }}
            className={`h-auto items-center justify-start gap-3 px-3 py-3 ${isNewChat ? activeItemClass : ''} ${
              busy ? 'opacity-50' : ''
            }`}>
            <SquarePen size={20} color={isNewChat ? brand : dimColor} />
            <UIText
              numberOfLines={1}
              className={`min-w-0 flex-1 text-left text-[17px] ${
                isNewChat
                  ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                  : 'font-normal text-neutral-950 dark:text-neutral-100'
              }`}>
              New chat
            </UIText>
          </Button>

          {NAV_ITEMS.map((item) => {
            const active = pathname === `/${item.name}`;
            const Icon = item.icon;
            return (
              <Button
                key={item.name}
                variant="ghost"
                onClick={() => go(item.name)}
                className={`h-auto items-center justify-start gap-3 px-3 py-3 ${active ? activeItemClass : ''}`}>
                <Icon size={20} color={active ? brand : dimColor} />
                <UIText
                  numberOfLines={1}
                  className={`min-w-0 flex-1 text-left text-[17px] ${
                    active
                      ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                      : 'font-normal text-neutral-950 dark:text-neutral-100'
                  }`}>
                  {item.label}
                </UIText>
              </Button>
            );
          })}

          {/* Meatball (More) Button under Files */}
          <Button
            variant="ghost"
            onClick={() => setShowMoreMenu((v) => !v)}
            className={`h-auto items-center justify-start gap-3 px-3 py-3 ${
              showMoreMenu || isMoreActive ? activeItemClass : ''
            }`}>
            <Ellipsis size={20} color={showMoreMenu || isMoreActive ? brand : dimColor} />
            <UIText
              numberOfLines={1}
              className={`min-w-0 flex-1 text-left text-[17px] ${
                showMoreMenu || isMoreActive
                  ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                  : 'font-normal text-neutral-950 dark:text-neutral-100'
              }`}>
              More
            </UIText>
            {pendingAskCount > 0 && (
              <Badge variant="destructive">
                <UIText className="text-[11px] font-bold text-white">
                  {pendingAskCount > 99 ? '99+' : pendingAskCount}
                </UIText>
              </Badge>
            )}
          </Button>

          {/* Submenu for More */}
          {showMoreMenu && (
            <div className="my-0.5 ml-4 flex flex-col gap-1 border-l-2 border-neutral-200 pl-3 dark:border-neutral-800">
              {MORE_NAV_ITEMS.map((item) => {
                const active = pathname === `/${item.name}`;
                const Icon = item.icon;
                return (
                  <Button
                    key={item.name}
                    variant="ghost"
                    onClick={() => go(item.name)}
                    className={`h-auto items-center justify-start gap-3 px-3 py-2.5 ${active ? activeItemClass : ''}`}>
                    <Icon size={18} color={active ? brand : dimColor} />
                    <UIText
                      numberOfLines={1}
                      className={`min-w-0 flex-1 text-left text-[15px] ${
                        active
                          ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                          : 'font-normal text-neutral-800 dark:text-neutral-200'
                      }`}>
                      {item.label}
                    </UIText>
                  </Button>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-3 pt-3">
          <UIText className="px-3 pb-1 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
            {ql ? `Results (${visible.length})` : 'Recents'}
          </UIText>
          {visible.length === 0 && (
            <UIText className="px-3 py-2 text-[15px] text-neutral-500 dark:text-neutral-400">
              {ql ? 'No matches' : 'No sessions yet'}
            </UIText>
          )}
          {visible.map((s) => {
            const active =
              onChat && (s.profile ?? activeProfile) === activeProfile && (s.id === activeId || s.id === openingId);
            // Keyed exactly like the row above, so a live status attaches to the
            // same row the runtime→stored bridge wrote it for.
            // The map is scoped by profile+stored id, matching profileSessionKey.
            // An empty map means the gateway has no `session.active_list`, so
            // every row stays bare rather than claiming to know a status.
            const live = liveSessionsKnown
              ? liveSessions[profileSessionKey(s.profile ?? activeProfile, s.id)]
              : undefined;
            return (
              <SessionRow
                key={`${s.profile ?? activeProfile}:${s.id}`}
                session={s}
                active={active}
                live={live}
                dark={dark}
                onOpen={handleOpenRecent}
                onDelete={handleDeleteRecent}
              />
            );
          })}
          {/* Infinite-scroll footer: spinner while the next 100 loads. */}
          {!ql && sessionsLoadingMore && (
            <div className="flex items-center justify-center gap-2 py-3">
              <Spinner size={14} color={dimColor} />
              <UIText className="text-[13px] text-neutral-500 dark:text-neutral-400">Loading more…</UIText>
            </div>
          )}
        </div>
      </div>

      {/* Sticky footer: Account bar */}
      <div
        className="border-t border-neutral-200 dark:border-neutral-800"
        style={{
          background: screen,
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)',
        }}>
        <Popover open={showUserMenu} onOpenChange={setShowUserMenu}>
          <PopoverTrigger asChild>
            <Button variant="ghost" className="h-auto w-full items-center justify-start gap-3 px-4 py-4">
              <Avatar className="size-11">
                <AvatarFallback className="bg-[#1a73e8]">
                  <UIText className="text-lg font-bold text-white">
                    {(username || 'H').slice(0, 1).toUpperCase()}
                  </UIText>
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 text-left">
                <UIText
                  numberOfLines={1}
                  className="min-w-0 text-left text-[16px] font-semibold text-neutral-950 dark:text-neutral-100">
                  {username || 'Hermes'}
                </UIText>
                <UIText className="min-w-0 text-sm text-neutral-500 dark:text-neutral-400">{host || ''}</UIText>
              </span>
              <ChevronRight
                size={18}
                color={dimColor}
                className={showUserMenu ? '-rotate-90 transition-transform' : 'transition-transform'}
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-72 p-1.5">
            {/* Logs & Usage quick nav */}
            {PROFILE_NAV_ITEMS.map((item) => {
              const active = pathname === `/${item.name}`;
              const Icon = item.icon;
              return (
                <PopoverClose asChild key={item.name}>
                  <Button
                    variant="ghost"
                    onClick={() => go(item.name)}
                    className={`h-auto w-full items-center justify-start gap-3 px-3.5 py-3 ${
                      active ? 'bg-[#1a73e8]/10 dark:bg-[#1a73e8]/20' : ''
                    }`}>
                    <Icon size={19} color={active ? brand : dark ? '#ccc' : '#444'} />
                    <UIText
                      numberOfLines={1}
                      className={`min-w-0 flex-1 text-left text-[15px] font-medium ${
                        active ? 'text-[#1a73e8] dark:text-[#7aa7ff]' : 'text-neutral-900 dark:text-neutral-100'
                      }`}>
                      {item.label}
                    </UIText>
                  </Button>
                </PopoverClose>
              );
            })}

            <Separator className="my-0.5 bg-neutral-100 dark:bg-neutral-800" />

            <PopoverClose asChild>
              <Button
                variant="ghost"
                onClick={() => go('settings')}
                className="h-auto w-full items-center justify-start gap-3 px-3.5 py-3">
                <Settings size={19} color={dark ? '#ccc' : '#444'} />
                <UIText
                  numberOfLines={1}
                  className="min-w-0 flex-1 text-left text-[15px] font-medium text-neutral-900 dark:text-neutral-100">
                  Settings
                </UIText>
              </Button>
            </PopoverClose>
          </PopoverContent>
        </Popover>
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
