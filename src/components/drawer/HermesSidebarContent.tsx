// The navigation panel's contents, expressed with the shadcn sidebar
// primitives. This replaced the hand-rolled `HermesDrawerContent`, which drew
// its own rows out of plain buttons.
//
// What actually moved: the *frame*. Collapsing, the icon rail, the breakpoint,
// the mobile sheet, Escape/backdrop dismissal and the cookie that remembers the
// state are all owned by `SidebarProvider` now (see components/ui/sidebar.tsx),
// and the old shell's `isWide`/`panelOpen` pair and the separate `NavRail`
// component are gone with them — the rail is just `collapsible="icon"`.
//
// What did NOT move: everything in here. The profile switcher, the recents list
// with its live statuses and long-press delete, the paging, the account footer
// and the delete confirmation are this app's, and the sidebar primitives have
// no opinion about any of them.
//
// Two consequences of adopting the frame that are worth knowing:
//
//  - Rows are `SidebarMenuButton`, which is a fixed-height button that
//    truncates to one line and collapses to an icon. The recents rows are
//    deliberately NOT built on it — they carry a title, a stamp, a source tag,
//    a preview and a live spinner, and none of that survives being squeezed
//    into a 32px square. So the Recents group hides itself when the sidebar
//    collapses, and the rail is nav-only. That is what ChatGPT and VS Code do
//    too: a collapsed rail is a directory of screens, not a session list.
//  - `size="lg"` (48px) rather than the default 32px on the nav rows. The
//    default is a desktop density; this app is driven with a thumb.
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, CircleUserRound, Ellipsis, Search, Settings, SquarePen, X } from 'lucide-react';
import { useApp } from '../../hooks/app-store';
import { navigate } from '../../store/nav';
import { useLongPress } from '../../hooks/use-long-press';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../ui/popover';
import { ConfirmDialog } from '../ui/dialog';
import { Spinner } from '../ui/bits';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Badge } from '../ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarTrigger,
  useSidebar,
} from '../ui/sidebar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { MORE_NAV_ITEMS, NAV_ITEMS, PROFILE_NAV_ITEMS } from './nav-config';
import { formatRelative, formatSessionSource } from '../../utils/format';
import { profileSessionKey } from '../../store/helpers';
import type { LiveStatus } from '../../store/live-sessions';
import type { ScopedSessionSummary } from '../../store/types';

// Icon colours are classes, not a `color` prop computed from the theme. A lucide
// icon strokes `currentColor`, so `text-*` plus a `dark:text-*` variant is all
// it takes — and it buys two things: the colour lives in CSS, and the theme
// switch stops being a React re-render of this panel. That last part matters
// here specifically, because this panel re-renders on every streamed token.
const ICON_DIM = 'text-[#555] dark:text-[#a3a3a3]';
const ICON_BRAND = 'text-[#1a73e8] dark:text-[#7aa7ff]';
// The account footer's glyphs, one step darker than `ICON_DIM` in each scheme.
const ICON_MUTED = 'text-[#444] dark:text-[#ccc]';
// `waiting` is a turn blocked on the user, so it is the one that gets the
// warmer colour — a spinner alone would read as "busy, fine".
const ICON_WAITING = 'text-[#b45309] dark:text-[#f0b429]';

function liveHint(status: LiveStatus): string {
  if (status === 'waiting') return 'Waiting for your answer';
  if (status === 'starting') return 'Starting';
  return 'Working';
}

function liveColorClass(status: LiveStatus | undefined): string {
  return status === 'waiting' ? ICON_WAITING : ICON_BRAND;
}

// Rail rows are `size="lg"` — 40px, this app's density rather than shadcn's 48
// (see the note next to SIDEBAR_WIDTH in sidebar.tsx). That choice has two
// consequences, both of which have to be corrected by hand:
//
//  - the `lg` variant collapses with `p-0!` where the default collapses with
//    `p-2!`, so the label is not pushed out for you. Left alone it is clipped by
//    the button's `overflow-hidden` into a sliver of its first letter beside the
//    icon — "N" for New chat.
//  - shadcn sizes the collapsed rail for a 32px button in a 48px rail, where
//    8px of group padding either side centres it (8 + 32 + 8 = 48). This app's
//    rail is 64px, carried over from the icon rail it replaced, so the same 8px
//    padding leaves the button hard against the left — 8px out of line with the
//    collapse trigger above it, which is centred by `mx-auto`.
//
// Hence `mx-auto` as well as `justify-center`: one centres the button in the
// rail, the other centres the icon in the button.
const RAIL_ROW = 'group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:justify-center';
const RAIL_LABEL = 'group-data-[collapsible=icon]:hidden';

// Memoized recents row: the session list is windowed to 50 rendered rows
// (visibleCount) with server pagination, so a virtualised list inside the
// sidebar's scroll view would fight the scroll — memo + stable callbacks keep
// re-renders to the row that actually changed instead.
//
// This stays a plain button rather than a `SidebarMenuButton`: see the note at
// the top of this file about why the recents rows do not collapse.
const SessionRow = memo(function SessionRow({
  session,
  active,
  live,
  onOpen,
  onDelete,
}: {
  session: ScopedSessionSummary;
  active: boolean;
  live: LiveStatus | undefined;
  onOpen: (s: ScopedSessionSummary) => void;
  onDelete: (s: ScopedSessionSummary) => void;
}) {
  const preview = (session.preview || '').trim();
  const when = formatRelative(session.startedAt);
  // null for the interactive defaults (`tui`/`desktop`/`mobile`) — see
  // formatSessionSource for where this vocabulary comes from.
  const tag = formatSessionSource(session.source);
  // Long-press to delete. A 400ms delay sets it apart from a normal tap.
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
      className={`h-auto sm:h-auto w-full items-start justify-start gap-2 px-3 py-2.5 text-left ${
        active ? 'rounded-xl bg-[#e8e8ec] dark:bg-[#272727]' : ''
      }`}>
      {live ? (
        <span className="pt-[3px]">
          <Spinner size={13} className={liveColorClass(live)} />
        </span>
      ) : null}
      {/* `flex flex-col` is the whole row's layout: it puts the title on one
          line and the time/tag/preview on the next. A plain inline `<span>`
          would run all three together on a single line. */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`text-left text-[14px] ${
            active ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]' : 'text-neutral-950 dark:text-neutral-100'
          } truncate`}>
          {session.title || '(untitled)'}
        </span>
        {live === 'waiting' ? (
          <span className="mt-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 truncate">
            Waiting for your answer
          </span>
        ) : null}
        {(preview || when || tag) && (
          <span className="mt-0.5 flex items-center gap-2">
            {when ? (
              <span
                className={`shrink-0 text-[10px] ${
                  active ? 'text-[#1a73e8] dark:text-[#7aa7ff]' : 'text-neutral-400 dark:text-neutral-500'
                } truncate`}>
                {when}
              </span>
            ) : null}
            {tag ? (
              <Badge variant="secondary" className="border-neutral-300 px-1.5 py-0 dark:border-neutral-700">
                <span className="text-[10px] font-medium text-neutral-600 dark:text-neutral-300">{tag}</span>
              </Badge>
            ) : null}
            {preview ? (
              <span className="min-w-0 flex-1 text-[10px] text-neutral-500 dark:text-neutral-400 truncate">
                {preview}
              </span>
            ) : null}
          </span>
        )}
      </span>
    </Button>
  );
});

export function HermesSidebarContent() {
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
  // The frame's own state. On a phone the panel lives in a sheet and
  // `openMobile` is whether that sheet is up; on desktop it is the in-flow
  // panel and `open` is whether it is expanded rather than collapsed to the rail.
  const { isMobile, open: expanded, openMobile, setOpenMobile } = useSidebar();
  const frameVisible = isMobile ? openMobile : expanded;
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

  // Keep Recents fresh every time the panel is opened (replaces the old
  // manual Refresh item).
  useEffect(() => {
    if (frameVisible) {
      void refreshProfiles();
      void refreshSessions();
      // Live statuses are polled by the store; opening the panel is the moment
      // they become visible, so re-read rather than show whatever was last known.
      void refreshLiveSessions();
      if (MORE_NAV_ITEMS.some((item) => pathname === `/${item.name}`)) {
        setShowMoreMenu(true);
      }
    } else {
      // Closing the panel dismisses the account popover. The Popover root is
      // controlled, so this is just state.
      setShowUserMenu(false);
    }
  }, [frameVisible, pathname, refreshProfiles, refreshSessions, refreshLiveSessions]);

  // Inline filter replaces the removed /sessions page (the panel is the list now).
  // Memoized so every streamed token doesn't refilter + rebuild rows.
  // MUST stay above the `!authed` early return — hooks can't run after one.
  const ql = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      ql
        ? sessions.filter(
            (s) => (s.title || '').toLowerCase().includes(ql) || (s.preview || '').toLowerCase().includes(ql),
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
  // enough here.
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
  // On a phone the panel is a modal sheet: any action that moves you somewhere
  // has to take the sheet down, or it sits on top of what you just navigated
  // to. The desktop panel is furniture and stays put. This is the same split the
  // old drawer expressed with its `persistent` prop, now driven by `isMobile`.
  const dismissIfOverlay = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);
  const handleOpenRecent = useCallback(
    (s: ScopedSessionSummary) => {
      dismissIfOverlay();
      void openSession(s);
    },
    [dismissIfOverlay, openSession],
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
  if (!authed) return null;
  const onChat = pathname === '/chat';
  // session.list ids are STORED ids (sessionKey) while sessionId is the live
  // runtime id minted by resume/create — comparing stored vs live never
  // matches, so highlight must use the stored key.
  const activeId = sessionKey ?? sessionId;
  const hasActiveRecent = sessions.some(
    (s) => onChat && (s.profile ?? activeProfile) === activeProfile && s.id === activeId,
  );
  const isNewChat = onChat && !hasActiveRecent && messages.length === 0;
  const go = (name: string) => {
    dismissIfOverlay();
    navigate(`/${name}`);
  };

  return (
    <>
      <SidebarHeader className="gap-1 px-3 pt-[max(env(safe-area-inset-top,0px),8px)]">
        {searchOpen ? (
          <div className="flex items-center gap-1">
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
              <X size={20} className={ICON_DIM} />
            </Button>
          </div>
        ) : (
          <div className="flex items-center">
            {/* Uncontrolled on purpose: mounting the root only while the panel
                is open is what tears its portal down on close. The trigger and
                the search button below are NOT gated on that — in the icon rail
                the trigger is the only way back out. */}
            {frameVisible && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    data-testid="profile-selector"
                    aria-label={`Switch profile. Active profile: ${activeProfile}`}
                    // In the icon rail there is no room for the wordmark, so it
                    // is dropped rather than truncated to a stray letter.
                    className="h-auto sm:h-auto min-w-0 flex-1 shrink items-center justify-start gap-2 px-1 py-1 group-data-[collapsible=icon]:hidden">
                    <span className="text-[22px] font-extrabold text-neutral-950 dark:text-neutral-100">Hermes</span>
                    <ChevronDown size={17} className={ICON_DIM} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="start" className="w-72 p-2">
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <div>
                      <div className="text-[14px] font-bold text-neutral-950 dark:text-neutral-100">Switch profile</div>
                      <div className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                        Chat and toolsets use this profile
                      </div>
                    </div>
                    <PopoverClose asChild>
                      <Button variant="ghost" size="icon" aria-label="Close profile picker">
                        <X size={18} className={ICON_DIM} />
                      </Button>
                    </PopoverClose>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto">
                    {profiles.length === 0 ? (
                      <div className="rounded-xl bg-neutral-100 px-3 py-3 dark:bg-neutral-900">
                        <div className="text-[13px] text-neutral-600 dark:text-neutral-300">{activeProfile}</div>
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
                              dismissIfOverlay();
                              void switchProfile(profile.name);
                            }}
                            className={`h-auto sm:h-auto w-full items-center justify-start gap-3 px-3 py-3 ${
                              selected ? 'bg-sky-50 dark:bg-sky-950/50' : ''
                            } ${busy && !selected ? 'opacity-50' : ''}`}>
                            <span
                              className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                                selected ? 'bg-sky-100 dark:bg-sky-950' : 'bg-neutral-100 dark:bg-neutral-900'
                              }`}>
                              <CircleUserRound
                                size={17}
                                className={selected ? 'text-[#0284c7] dark:text-[#7dd3fc]' : ICON_DIM}
                              />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col text-left">
                              <span
                                className={`min-w-0 text-left text-[13px] font-semibold ${
                                  selected ? 'text-sky-700 dark:text-sky-300' : 'text-neutral-900 dark:text-neutral-100'
                                } truncate`}>
                                {profile.display_name || profile.name}
                              </span>
                              {!!profile.description && (
                                <span className="min-w-0 text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                                  {profile.description}
                                </span>
                              )}
                            </span>
                            {selected && (
                              <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">Active</span>
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
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search chats"
              onClick={() => setSearchOpen(true)}
              className="group-data-[collapsible=icon]:hidden">
              <Search size={20} className={ICON_DIM} />
            </Button>
            {/* The collapse toggle. Always visible — in the icon rail it is
                the only way back out, so it must not be hidden with the rest
                of the header. Inside the mobile sheet it collapses the sheet,
                and shadcn's own close button is hidden by the sidebar. */}
            <SidebarTrigger className="group-data-[collapsible=icon]:mx-auto" />
          </div>
        )}
      </SidebarHeader>

      {/* The sidebar's own scroller. The recents paging hangs off its `scroll`
          event, so this element is the one that has to hear it. */}
      <SidebarContent onScroll={handleRecentsScroll}>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  isActive={isNewChat}
                  tooltip="New chat"
                  disabled={busy}
                  onClick={() => {
                    if (busy) return;
                    dismissIfOverlay();
                    void newSession();
                  }}
                  className={`${RAIL_ROW} ${busy ? 'opacity-50' : ''}`}>
                  <SquarePen className={isNewChat ? ICON_BRAND : ICON_DIM} />
                  <span className={RAIL_LABEL}>New chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {NAV_ITEMS.map((item) => {
                const active = pathname === `/${item.name}`;
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.name}>
                    <SidebarMenuButton
                      size="lg"
                      isActive={active}
                      tooltip={item.label}
                      onClick={() => go(item.name)}
                      className={RAIL_ROW}>
                      <Icon className={active ? ICON_BRAND : ICON_DIM} />
                      <span className={RAIL_LABEL}>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}

              <Collapsible
                open={showMoreMenu}
                onOpenChange={setShowMoreMenu}
                className="group/collapsible"
                render={<SidebarMenuItem />}>
                <CollapsibleTrigger render={<SidebarMenuButton size="lg" tooltip="More" className={RAIL_ROW} />}>
                  {/* Deliberately never "active". More is a door, not a
                      destination: pressing it used to tint the label and the
                      ellipsis brand-blue and paint the row `sidebar-accent`,
                      and leaving that on made the row read as a place you had
                      navigated to. What says "open" is the panel below and the
                      chevron; what says "you are here" is the child row — the
                      highlight belongs on Kanban when you are on Kanban, and
                      having it in two places at once was the noise. */}
                  <Ellipsis className={ICON_DIM} />
                  <span className={RAIL_LABEL}>More</span>
                  {pendingAskCount > 0 && (
                    <Badge variant="destructive" className="ml-auto">
                      <span className="text-[10px] font-bold text-white">
                        {pendingAskCount > 99 ? '99+' : pendingAskCount}
                      </span>
                    </Badge>
                  )}
                  {/* The chevron is the affordance that says "this opens"; it
                      rotates when it does. `ml-auto` only when there is no
                      badge already doing the pushing, or the two would split
                      the free space between them and leave the chevron floating
                      in the middle. */}
                  <ChevronRight
                    className={`size-4 shrink-0 transition-transform duration-200 group-data-open/collapsible:rotate-90 group-data-[collapsible=icon]:hidden ${
                      pendingAskCount > 0 ? '' : 'ml-auto'
                    } ${ICON_DIM}`}
                  />
                </CollapsibleTrigger>
                {/* The vertical rule and the indent are `SidebarMenuSub`'s own
                    `border-l border-sidebar-border` — see the note below. */}
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {MORE_NAV_ITEMS.map((item) => {
                      const active = pathname === `/${item.name}`;
                      const Icon = item.icon;
                      return (
                        <SidebarMenuSubItem key={item.name}>
                          {/* `SidebarMenuSubButton` renders an `<a>` by default
                              — shadcn assumes these are real links. Ours route
                              through `navigate()`, so an `<a>` with no `href`
                              would drop out of the tab order entirely: a
                              keyboard user could reach every top-level row and
                              none of these. Rendering a real button restores
                              that, and matches the rows above. */}
                          <SidebarMenuSubButton
                            render={<button type="button" />}
                            isActive={active}
                            onClick={() => go(item.name)}
                            // `w-full` because a `<button>` sizes to its content
                            // where the `<a>` it replaced stretched to fill the
                            // row. Without it the hit area shrinks to the label.
                            className="w-full">
                            {' '}
                            <Icon className={active ? ICON_BRAND : ICON_DIM} />
                            <span>{item.label}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Hidden in the icon rail: a session list is not a thing that
            collapses to icons. See the note at the top of the file. */}
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="text-[13px] font-semibold">
            {ql ? `Results (${visible.length})` : 'Recents'}
          </SidebarGroupLabel>
          <SidebarGroupContent className="flex flex-col gap-1">
            {visible.length === 0 && (
              <div className="px-3 py-2 text-[13px] text-neutral-500 dark:text-neutral-400">
                {ql ? 'No matches' : 'No sessions yet'}
              </div>
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
                  onOpen={handleOpenRecent}
                  onDelete={handleDeleteRecent}
                />
              );
            })}
            {/* Infinite-scroll footer: spinner while the next 100 loads. */}
            {!ql && sessionsLoadingMore && (
              <div className="flex items-center justify-center gap-2 py-3">
                <Spinner size={14} className={ICON_DIM} />
                <div className="text-[12px] text-neutral-500 dark:text-neutral-400">Loading more…</div>
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-0 pb-[max(env(safe-area-inset-bottom,0px),8px)]">
        {/* A Base UI dropdown menu rather than the Radix popover this used to
            be. The content was always a menu — three destinations, a separator,
            then Settings — and a popover only approximated that: no arrow-key
            roving, no typeahead, no `role="menu"`, and every row had to wrap
            itself in a `PopoverClose` to dismiss on select. A dropdown menu
            does all four by itself, so the `PopoverClose` wrappers are gone and
            the rows below are plain `DropdownMenuItem`s.
            Controlled via `showUserMenu` to keep the existing behaviour where
            collapsing the sidebar dismisses the menu. */}
        <DropdownMenu open={showUserMenu} onOpenChange={setShowUserMenu}>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="h-auto sm:h-auto w-full items-center justify-start gap-3 px-4 py-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2"
              />
            }>
            <Avatar className="size-11 group-data-[collapsible=icon]:size-9">
              <AvatarFallback className="bg-[#1a73e8]">
                <span className="text-base font-bold text-white">{(username || 'H').slice(0, 1).toUpperCase()}</span>
              </AvatarFallback>
            </Avatar>
            {/* Stacks the username over the host (`flex flex-col`); a plain
                inline span would run them together on one line. */}
            <span className="flex flex-1 flex-col text-left group-data-[collapsible=icon]:hidden">
              <span className="min-w-0 text-left text-[14px] font-semibold text-neutral-950 dark:text-neutral-100 truncate">
                {username || 'Hermes'}
              </span>
              <span className="min-w-0 text-[13px] text-neutral-500 dark:text-neutral-400">{host || ''}</span>
            </span>
            {/* No chevron. The row is already the widest thing in the panel and
                reads as a button; the arrow was one more mark competing with
                the avatar and the two lines of text for the same 300px. */}
          </DropdownMenuTrigger>
          {/* `w-72` beats the content's own `w-(--anchor-width)` because both are
              single-class utilities and Tailwind emits the arbitrary-value
              form first — so this is source order, not specificity. It holds,
              but it is the kind of thing that looks removable and is not. A
              menu as wide as the footer button (the anchor default) is wider
              than the labels need. */}
          <DropdownMenuContent side="top" align="start" className="w-72">
            {/* Logs & Usage quick nav */}
            {PROFILE_NAV_ITEMS.map((item) => {
              const active = pathname === `/${item.name}`;
              const Icon = item.icon;
              return (
                <DropdownMenuItem
                  key={item.name}
                  onClick={() => go(item.name)}
                  className={`gap-3 px-3.5 py-3 ${active ? 'bg-[#1a73e8]/10 dark:bg-[#1a73e8]/20' : ''}`}>
                  <Icon size={19} className={active ? ICON_BRAND : ICON_MUTED} />
                  <span
                    className={`min-w-0 flex-1 text-left text-[13px] font-medium ${
                      active ? 'text-[#1a73e8] dark:text-[#7aa7ff]' : 'text-neutral-900 dark:text-neutral-100'
                    } truncate`}>
                    {item.label}
                  </span>
                </DropdownMenuItem>
              );
            })}

            <DropdownMenuSeparator className="my-0.5 bg-neutral-100 dark:bg-neutral-800" />

            <DropdownMenuItem onClick={() => go('settings')} className="gap-3 px-3.5 py-3">
              <Settings size={19} className={ICON_MUTED} />
              <span className="min-w-0 flex-1 text-left text-[13px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                Settings
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>

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
    </>
  );
}
