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
import { Activity, BellRing, ChevronDown, CircleUserRound, MessageSquare, Plus, ScrollText, Settings, X } from 'lucide-react';
import { useApp } from '../../hooks/app-store';
import { navigate } from '../../store/nav';
import { useLongPress } from '../../hooks/use-long-press';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../ui/popover';
import { ConfirmDialog } from '../ui/dialog';
import { Spinner } from '../ui/bits';
import { Avatar, AvatarFallback } from '../ui/avatar';
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
  SidebarTrigger,
  useSidebar,
} from '../ui/sidebar';
import { MORE_NAV_ITEMS, NAV_ITEMS } from './nav-config';
import { formatRelative } from '../../utils/format';
import { profileSessionKey } from '../../store/helpers';
import { searchSessions } from '../../services/session-search';
import type { SessionSearchHit } from '../../services/session-search';
import type { LiveStatus } from '../../store/live-sessions';
import type { ScopedSessionSummary } from '../../store/types';

// Icon colours are classes, not a `color` prop computed from the theme. A lucide
// icon strokes `currentColor`, so `text-*` plus a `dark:text-*` variant is all
// it takes — and it buys two things: the colour lives in CSS, and the theme
// switch stops being a React re-render of this panel. That last part matters
// here specifically, because this panel re-renders on every streamed token.
const ICON_DIM = 'text-[#555] dark:text-[#a3a3a3]';
const ICON_BRAND = 'text-brand';
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
  const when = formatRelative(session.startedAt);
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
      className={`h-auto sm:h-auto w-full items-center justify-start gap-2 rounded-xl px-3 py-2.5 text-left ${
        active ? 'bg-brand/10' : ''
      }`}>
      {live ? (
        <span className="shrink-0">
          <Spinner size={13} className={liveColorClass(live)} />
        </span>
      ) : null}
      <span
        className={`min-w-0 flex-1 text-left text-[14px] ${
          active ? 'font-semibold text-brand' : 'text-neutral-950 dark:text-neutral-100'
        } truncate`}>
        {session.title || '(untitled)'}
      </span>
      {when ? (
        <span
          className={`shrink-0 text-[12px] ${
            active ? 'text-brand' : 'text-neutral-400 dark:text-neutral-500'
          } truncate`}>
          {when}
        </span>
      ) : null}
    </Button>
  );
});

// A deep content-match row: opens the session and shows the matched snippet so
// the user can tell why it matched. Stored ids may carry a profile that differs
// from the active one, so the profile is passed to openSession explicitly.
const SearchHitRow = memo(function SearchHitRow({
  hit,
  onOpen,
}: {
  hit: SessionSearchHit;
  onOpen: (hit: SessionSearchHit) => void;
}) {
  return (
    <Button
      variant="ghost"
      aria-label={`Open match in ${hit.title || '(untitled)'}`}
      onClick={() => onOpen(hit)}
      className="h-auto sm:h-auto w-full flex-col items-start gap-1 rounded-xl px-3 py-2.5 text-left">
      <span className="flex w-full items-center gap-2">
        <MessageSquare size={13} className={ICON_DIM} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-neutral-950 dark:text-neutral-100">
          {hit.title || '(untitled)'}
        </span>
      </span>
      <span className="line-clamp-2 w-full text-[12px] text-neutral-500 dark:text-neutral-400">
        {hit.snippet || hit.preview}
      </span>
    </Button>
  );
});

export function HermesSidebarContent() {
  const { pathname } = useLocation();
  const {
    authed,
    busy,
    activeProfile,
    profiles,
    refreshProfiles,
    switchProfile,
    sessionId,
    sessionKey,
    openingId,
    sessions,
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
    opsGet,
    getAuthScope,
  } = useApp();
  // The frame's own state. On a phone the panel lives in a sheet and
  // `openMobile` is whether that sheet is up; on desktop it is the in-flow
  // panel and `open` is whether it is expanded rather than collapsed to the rail.
  const { isMobile, open: expanded, openMobile, setOpenMobile } = useSidebar();
  const frameVisible = isMobile ? openMobile : expanded;
  // Hooks FIRST — no early return above this line (authed flips at login;
  // returning early before hooks breaks hook order).
  // Themed replacement for the old Alert.alert delete confirm.
  const [confirmDelete, setConfirmDelete] = useState<{ title: string; body: string; run: () => void } | null>(null);
  const [q, setQ] = useState('');
  // Infinite scroll: render in pages of 50, grow on scroll-bottom. Network
  // fetch only when the local list is exhausted but the server may hold more.
  const [visibleCount, setVisibleCount] = useState(50);

  // Keep the list fresh every time the panel is opened (replaces the old
  // manual Refresh item).
  useEffect(() => {
    if (frameVisible) {
      void refreshProfiles();
      void refreshSessions();
      // Live statuses are polled by the store; opening the panel is the moment
      // they become visible, so re-read rather than show whatever was last known.
      void refreshLiveSessions();
    }
  }, [frameVisible, refreshProfiles, refreshSessions, refreshLiveSessions]);

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
  // Server-side content search (FTS5). Runs debounced for any non-empty query,
  // independently of the local title/preview filter above — a query can match
  // message text in a session whose title gives no hint. Results land in a
  // separate section so the local rows and the deep hits never interleave.
  const [contentHits, setContentHits] = useState<SessionSearchHit[]>([]);
  const [searchingContent, setSearchingContent] = useState(false);
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setContentHits([]);
      setSearchingContent(false);
      return;
    }
    const scope = getAuthScope();
    const profile = activeProfile;
    setSearchingContent(true);
    const timer = setTimeout(() => {
      searchSessions(opsGet, query, profile, 20)
        .then((hits) => {
          if (getAuthScope() !== scope || activeProfile !== profile) return;
          setContentHits(hits);
        })
        .catch(() => {
          if (getAuthScope() === scope && activeProfile === profile) setContentHits([]);
        })
        .finally(() => {
          if (getAuthScope() === scope && activeProfile === profile) setSearchingContent(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, opsGet, getAuthScope, activeProfile]);
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
  // A search hit carries a different shape than a session-list row; adapt it to
  // the summary openSession expects. `startedAt` falls back to 0 because the
  // opener only uses identity fields.
  const handleOpenHit = useCallback(
    (hit: SessionSearchHit) => {
      dismissIfOverlay();
      void openSession({
        id: hit.sessionId,
        title: hit.title,
        preview: hit.preview,
        messageCount: hit.messageCount,
        source: hit.source ?? '',
        startedAt: hit.startedAt ?? 0,
        ...(hit.profile ? { profile: hit.profile } : {}),
      });
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
  const go = (name: string) => {
    dismissIfOverlay();
    navigate(`/${name}`);
  };

  return (
    <>
      <SidebarHeader
        className="gap-1 px-3 pt-[max(env(safe-area-inset-top,0px),8px)] group-data-[collapsible=icon]:px-1.5">
        {/* Title + compose pill (mobile) or just the collapse toggle (desktop).
            New chat moves into Browse on desktop only — there it reads as a
            nav row alongside the places it navigates to, and it leaves the
            header carrying just the one control that can only live there. The
            mobile sheet keeps it in the header: its top row is the full-width
            title bar OpenChamber uses, and a nav-styled pill there would read
            as a stray item. */}
        <div className="flex items-center">
          {/* Full-screen sheet slides in from the left, so its dismiss lives
              at the same edge. The profile switcher moved to the footer. */}
          {isMobile && (
            <Button variant="ghost" size="icon" aria-label="Close menu" onClick={() => setOpenMobile(false)}>
              <X size={20} className={ICON_DIM} />
            </Button>
          )}
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="truncate px-1 text-[17px] font-bold text-neutral-950 dark:text-neutral-100">
              Sessions
            </div>
          </div>
          {/* Tinted compose pill, pinned right like theirs. Icon-only in
              the collapsed rail. */}
          {isMobile && (
            <Button
              variant="ghost"
              data-testid="new-chat"
              aria-label="New chat"
              disabled={busy}
              onClick={() => {
                if (busy) return;
                dismissIfOverlay();
                void newSession();
              }}
              className={`h-9 shrink-0 gap-1 rounded-full border border-brand/40 bg-brand/10 px-3 text-brand ${busy ? 'opacity-50' : ''}`}>
              <Plus size={16} />
              <span className="text-[13px] font-semibold">new chat</span>
            </Button>
          )}
          {/* Collapse toggle. Visible in both states: in the panel it collapses,
              and in the rail it expands — which is what makes the rail a control
              rather than a dead strip of icons, since the screen header has no
              hamburger on desktop to open it with. */}
          {!isMobile && <SidebarTrigger className="group-data-[collapsible=icon]:mx-auto" />}
        </div>
        {/* Search lives below the header row, not behind an icon toggle.
            Hidden in the collapsed rail where a full field cannot fit. */}
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:hidden">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sessions…"
            aria-label="Search chats"
            className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-[14px] text-neutral-950 dark:text-neutral-100"
          />
          {!!q && (
            <Button variant="ghost" size="icon" aria-label="Clear search" onClick={() => setQ('')}>
              <X size={18} className={ICON_DIM} />
            </Button>
          )}
        </div>
      </SidebarHeader>

      {/* The sidebar's own scroller. The recents paging hangs off its `scroll`
          event, so this element is the one that has to hear it. */}
      <SidebarContent onScroll={handleRecentsScroll}>
        {/* Nav — the one group that survives the icon rail. A collapsed rail is
            a directory of screens, not a session list, so Browse stays (as
            icons) while Chats below hides entirely. */}
        <SidebarGroup>
          {/* The label cannot fit a 64px rail; the group reads as nav without it. */}
          <SidebarGroupLabel className="text-[13px] font-semibold group-data-[collapsible=icon]:hidden">
            Browse
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {/* gap-1 like the Chats list below: active and hover paint the
                same rounded bg, so with the primitive's gap-0 the two rects
                touch and their corners merge into one thick blob. */}
            <SidebarMenu className="gap-1">
              {/* Desktop only: compose reads as the first nav row here, beside
                  the places it navigates to. The mobile sheet keeps it in its
                  header instead (see SidebarHeader above). In the rail it is the
                  top icon, which is why it precedes the config list. */}
              {!isMobile && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="lg"
                    data-testid="new-chat"
                    aria-label="New chat"
                    disabled={busy}
                    onClick={() => {
                      if (busy) return;
                      void newSession();
                    }}
                    className={`text-brand ${RAIL_ROW} ${busy ? 'opacity-50' : ''}`}>
                    <Plus className="text-brand" />
                    <span className={RAIL_LABEL}>New chat</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {[...NAV_ITEMS, ...MORE_NAV_ITEMS.filter((item) => item.name !== 'asks')].map((item) => {
                const active = pathname === `/${item.name}`;
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.name}>
                    {/* RAIL_ROW: the lg button collapses with p-0 and needs an
                        explicit mx-auto + justify-center to sit centred in the
                        rail — see the note on RAIL_ROW below. */}
                    <SidebarMenuButton
                      size="lg"
                      isActive={active}
                      tooltip={item.label}
                      onClick={() => go(item.name)}
                      // Hover matches the Chats rows below (ghost Button):
                      // same bg and ink, otherwise Browse hovers lighter.
                      className={`${RAIL_ROW} hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50`}>
                      <Icon className={active ? ICON_BRAND : ICON_DIM} />
                      <span className={RAIL_LABEL}>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Deep content matches (server FTS). Only while searching; sits above
            the local title/preview matches so the strongest hits come first. */}
        {!!ql && (contentHits.length > 0 || searchingContent) && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel className="text-[13px] font-semibold">
              In messages{contentHits.length > 0 ? ` (${contentHits.length})` : ''}
            </SidebarGroupLabel>
            <SidebarGroupContent className="flex flex-col gap-1">
              {searchingContent && contentHits.length === 0 && (
                <div className="flex items-center gap-2 px-3 py-2">
                  <Spinner size={13} className={ICON_DIM} />
                  <div className="text-[12px] text-neutral-500 dark:text-neutral-400">Searching…</div>
                </div>
              )}
              {contentHits.map((hit) => (
                <SearchHitRow key={`${hit.profile}:${hit.sessionId}`} hit={hit} onOpen={handleOpenHit} />
              ))}
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Hidden in the icon rail: a session list is not a thing that
            collapses to icons. See the note at the top of the file. */}
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="flex items-center justify-between text-[13px] font-semibold">
            <span>{ql ? `Results (${visible.length})` : 'Chats'}</span>
            {!ql && <span className="font-normal text-neutral-400 dark:text-neutral-500">{sessions.length}</span>}
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

      <SidebarFooter className="px-3 pb-[max(env(safe-area-inset-bottom,0px),8px)] group-data-[collapsible=icon]:px-2">
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center">
          {/* Profile switcher, bottom-left. Uncontrolled on purpose: mounting
              the root only while the panel is open is what tears its portal
              down on close. */}
          {frameVisible && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  data-testid="profile-selector"
                  aria-label={`Switch profile. Active profile: ${activeProfile}`}
                  className="h-auto min-w-0 flex-1 items-center justify-start gap-2 px-1 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
                  <Avatar className="size-9 shrink-0">
                    <AvatarFallback className="bg-brand">
                      <span className="text-sm font-bold text-white">
                        {activeProfile.slice(0, 1).toUpperCase()}
                      </span>
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 text-left text-[13px] font-semibold text-neutral-900 dark:text-neutral-100 group-data-[collapsible=icon]:hidden truncate">
                    {activeProfile}
                  </span>
                  <ChevronDown size={15} className={`${ICON_DIM} group-data-[collapsible=icon]:hidden`} />
                </Button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-72 p-2">
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
                    <div className="rounded-xl bg-muted px-3 py-3 dark:bg-muted">
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
                              selected ? 'bg-sky-100 dark:bg-sky-950' : 'bg-elevated'
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
          {/* Shortcuts to the places people go from here. Asks first: a
              pending approval is the one thing that should shout. */}
          <div className="flex shrink-0 items-center group-data-[collapsible=icon]:flex-col">
            <span className="relative">
              {/* size-5 is load-bearing, not decoration: ghost buttons shrink
                  any svg without a size-* class to 16px, which is why these
                  read smaller than the 20px rail rows above. */}
              <Button variant="ghost" size="icon" aria-label="Ask Inbox" onClick={() => go('asks')}>
                <BellRing size={20} className={`${pathname === '/asks' ? ICON_BRAND : ICON_DIM} size-5`} />
              </Button>
              {pendingAskCount > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                  {pendingAskCount > 99 ? '99+' : pendingAskCount}
                </span>
              )}
            </span>
            <Button variant="ghost" size="icon" aria-label="Logs" onClick={() => go('logs')}>
              <ScrollText size={20} className={`${pathname === '/logs' ? ICON_BRAND : ICON_DIM} size-5`} />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Usage" onClick={() => go('usage')}>
              <Activity size={20} className={`${pathname === '/usage' ? ICON_BRAND : ICON_DIM} size-5`} />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => go('settings')}>
              <Settings size={20} className={`${pathname === '/settings' ? ICON_BRAND : ICON_DIM} size-5`} />
            </Button>
          </div>
        </div>
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
