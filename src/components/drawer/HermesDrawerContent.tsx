// Custom drawer content, ChatGPT-style: New chat button, Recents list
// (opens straight into chat), History/Ops links, user footer with
// theme switch + logout. Extracted from app/_layout.tsx.
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { DrawerContentScrollView, useDrawerStatus } from 'expo-router/drawer';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Ellipsis,
  Search,
  Settings,
  SquarePen,
  X,
} from 'lucide-react-native';
import { useApp, useThemeValue } from '../../hooks/app-store';
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
import { brandColor, placeholderColor, screenBg } from '../../theme';
import { formatRelative, formatSessionSource } from '../../utils/format';
import { profileSessionKey } from '../../store/helpers';
import type { LiveStatus } from '../../store/live-sessions';
import type { ScopedSessionSummary } from '../../store/types';

// Memoized recents row: the session list is already windowed to 50 rendered
// rows (visibleCount) with server pagination, so a FlashList inside the
// drawer's scroll view would fight the drawer gesture/scroll — memo + stable
// callbacks keep re-renders to the row that actually changed instead.
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
  return (
    <Button
      variant="ghost"
      accessibilityRole="button"
      accessibilityLabel={`Open chat ${session.title || '(untitled)'}`}
      onPress={() => onOpen(session)}
      onLongPress={() => onDelete(session)}
      delayLongPress={400}
      className={`flex-row h-auto items-start justify-start gap-2 px-3 py-2.5 ${
        active ? 'rounded-xl bg-[#e8e8ec] dark:bg-[#272727]' : ''
      }`}
      // A turn running in this session is the one thing worth reading off the
      // list at a glance, so it is announced rather than only drawn.
      accessibilityHint={live ? liveHint(live) : undefined}
    >
      {live ? (
        <View className="pt-[3px]">
          <Spinner size={13} color={liveColor(live, dark)} />
        </View>
      ) : null}
      <View className="flex-1 min-w-0">
        <UIText
          numberOfLines={1}
          ellipsizeMode="tail"
          className={`text-[16px] ${
            active ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]' : 'text-neutral-950 dark:text-neutral-100'
          }`}
        >
          {session.title || '(untitled)'}
        </UIText>
        {live === 'waiting' ? (
          <UIText
            numberOfLines={1}
            className={`mt-0.5 text-[11px] font-medium ${
              dark ? 'text-amber-300' : 'text-amber-700'
            }`}
          >
            Waiting for your answer
          </UIText>
        ) : null}
        {(preview || when || tag) && (
          <View className="mt-0.5 flex-row items-center gap-2">
            {when ? (
              <UIText
                numberOfLines={1}
                className={`shrink-0 text-[11px] ${
                  active ? 'text-[#1a73e8] dark:text-[#7aa7ff]' : 'text-neutral-400 dark:text-neutral-500'
                }`}
              >
                {when}
              </UIText>
            ) : null}
            {tag ? (
              <Badge variant="secondary" className="border-neutral-300 px-1.5 py-0 dark:border-neutral-700">
                <UIText className="text-[10px] font-medium text-neutral-600 dark:text-neutral-300">
                  {tag}
                </UIText>
              </Badge>
            ) : null}
            {preview ? (
              <UIText
                numberOfLines={1}
                ellipsizeMode="tail"
                className="min-w-0 flex-1 text-[11px] text-neutral-500 dark:text-neutral-400"
              >
                {preview}
              </UIText>
            ) : null}
          </View>
        )}
      </View>
    </Button>
  );
});

export function HermesDrawerContent(props: DrawerContentComponentProps) {
  const pathname = usePathname();
  const drawerOpen = useDrawerStatus() === 'open';
  const {
    authed, username, host, busy, activeProfile, profiles, refreshProfiles, switchProfile, sessionId, sessionKey, openingId, sessions, messages, pendingAskCount,
    newSession, openSession, refreshSessions, loadMoreSessions, sessionsHasMore, sessionsLoadingMore, deleteSessionById,
    liveSessions, liveSessionsKnown, refreshLiveSessions,
  } = useApp();
  const { theme } = useThemeValue();
  // Hooks FIRST — no early return above this line (authed flips at
  // login; returning early before hooks breaks hook order).
  const insets = useSafeAreaInsets();
  const [showUserMenu, setShowUserMenu] = useState(false);
  // Themed replacement for the old Alert.alert delete confirm.
  const [confirmDelete, setConfirmDelete] = useState<{ title: string; body: string; run: () => void } | null>(null);
  // Bumped to force the user-menu Popover closed when the drawer closes (its
  // root is uncontrolled, so remounting is the only way to dismiss it).
  const [userMenuKey, setUserMenuKey] = useState(0);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  // Infinite scroll: render in pages of 50, grow on scroll-bottom. Network
  // fetch only when the local list is exhausted but the server may hold more.
  const [visibleCount, setVisibleCount] = useState(50);
  // Keep Recents fresh every time the drawer opens (replaces the old
  // manual Refresh item).
  useEffect(() => {
    if (drawerOpen) {
      void refreshProfiles();
      void refreshSessions();
      // Live statuses are polled by the store; opening the drawer is the moment
      // they become visible, so re-read rather than show whatever was last known.
      void refreshLiveSessions();
      if (MORE_NAV_ITEMS.some((item) => pathname === `/${item.name}`)) {
        setShowMoreMenu(true);
      }
    } else {
      setShowUserMenu(false);
      setUserMenuKey((k) => k + 1);
    }
  }, [drawerOpen, pathname, refreshProfiles, refreshSessions, refreshLiveSessions]);
  // Inline filter replaces the removed /sessions page (drawer is the list now).
  // Memoized so every streamed token doesn't refilter + rebuild rows.
  // MUST stay above the `!authed` early return — hooks can't run after one.
  const ql = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      ql
        ? sessions.filter(
            (s) =>
              (s.title || '').toLowerCase().includes(ql) ||
              (s.preview || '').toLowerCase().includes(ql),
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
  // Fired from onScroll + momentum/drag end: a fast fling can jump past the
  // threshold between throttled onScroll ticks, so the end events are the
  // backstop.
  const handleRecentsScroll = ({ nativeEvent }: any) => {
    if (!nativeEvent) return;
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    if (!layoutMeasurement || !contentOffset || !contentSize) return;
    const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 240;
    if (!nearBottom || sessionsLoadingMore) return;
    if (visibleCount < filtered.length) {
      setVisibleCount((c) => Math.min(c + 50, filtered.length));
    } else if (!ql && sessionsHasMore) {
      void loadMoreSessions().then((s) => {
        // New rows arrived — reveal the next page immediately.
        if (s.length > filtered.length) setVisibleCount((c) => c + 50);
      });
    }
  };
  const handleOpenRecent = useCallback(
    (s: ScopedSessionSummary) => {
      props.navigation.closeDrawer();
      void openSession(s);
    },
    [openSession, props.navigation],
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
  const placeholder = useMemo(() => placeholderColor(dark), [dark]);
  if (!authed) return null;
  const dimColor = dark ? '#a3a3a3' : '#555';
  const activeItemClass = 'rounded-xl bg-[#e8e8ec] dark:bg-[#272727]';
  const close = () => props.navigation.closeDrawer();
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
  return (
    <View className="flex-1" style={{ backgroundColor: screen }}>
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={{ paddingBottom: 16 }}
        onScroll={handleRecentsScroll}
        onMomentumScrollEnd={handleRecentsScroll}
        onScrollEndDrag={handleRecentsScroll}
        scrollEventThrottle={16}
      >
        {searchOpen ? (
          <View className="flex-row items-center gap-1 px-4 pt-2">
            <Input
              value={q}
              onChangeText={setQ}
              placeholder="Search chats…"
              placeholderTextColor={placeholder}
              autoFocus
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-2.5 text-[16px] text-neutral-950 dark:border-neutral-700 dark:text-neutral-100"
            />
            <Button
              variant="ghost"
              size="icon"
              onPress={() => {
                setSearchOpen(false);
                setQ('');
              }}
              hitSlop={10}
            >
              <X size={20} color={dimColor} />
            </Button>
          </View>
        ) : (
          /* The native Popover root keeps `open` in its own state (no controlled
             `open` prop), so the root is unmounted with the drawer instead —
             that is what tears the portal down when the drawer closes. */
          drawerOpen && (
            <Popover className="flex-row items-center px-4 pt-2">
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  testID="profile-selector"
                  accessibilityRole="button"
                  accessibilityLabel={`Switch profile. Active profile: ${activeProfile}`}
                  hitSlop={8}
                  className="min-w-0 h-auto flex-1 shrink flex-row items-center justify-start gap-2 px-1 py-1"
                >
                  <UIText className="text-[26px] font-extrabold text-neutral-950 dark:text-neutral-100">Hermes</UIText>
                  <ChevronDown size={17} color={dimColor} />
                </Button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start" className="w-72 p-2">
                <View className="flex-row items-center justify-between px-3 py-2.5">
                  <View>
                    <Text className="text-base font-bold text-neutral-950 dark:text-neutral-100">Switch profile</Text>
                    <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                      Chat and toolsets use this profile
                    </Text>
                  </View>
                  <PopoverClose asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      accessibilityRole="button"
                      accessibilityLabel="Close profile picker"
                      hitSlop={8}
                    >
                      <X size={18} color={dimColor} />
                    </Button>
                  </PopoverClose>
                </View>
                <ScrollView
                  className="max-h-[420px]"
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                >
                  {profiles.length === 0 ? (
                    <View className="rounded-xl bg-neutral-100 px-3 py-3 dark:bg-neutral-900">
                      <Text className="text-sm text-neutral-600 dark:text-neutral-300">{activeProfile}</Text>
                    </View>
                  ) : (
                    profiles.map((profile) => {
                      const selected = profile.name === activeProfile;
                      const row = (
                        <Button
                          variant="ghost"
                          testID={`profile-option-${profile.name}`}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          disabled={busy || selected}
                          onPress={() => {
                            close();
                            void switchProfile(profile.name);
                          }}
                          className={`h-auto w-full flex-row items-center justify-start gap-3 px-3 py-3 ${
                            selected ? 'bg-sky-50 dark:bg-sky-950/50' : ''
                          } ${busy && !selected ? 'opacity-50' : ''}`}
                        >
                          <View
                            className={`h-9 w-9 items-center justify-center rounded-xl ${
                              selected ? 'bg-sky-100 dark:bg-sky-950' : 'bg-neutral-100 dark:bg-neutral-900'
                            }`}
                          >
                            <CircleUserRound
                              size={17}
                              color={selected ? (dark ? '#7dd3fc' : '#0284c7') : dimColor}
                            />
                          </View>
                          <View className="min-w-0 flex-1">
                            <UIText
                              numberOfLines={1}
                              className={`min-w-0 text-sm font-semibold ${
                                selected
                                  ? 'text-sky-700 dark:text-sky-300'
                                  : 'text-neutral-900 dark:text-neutral-100'
                              }`}
                            >
                              {profile.display_name || profile.name}
                            </UIText>
                            {!!profile.description && (
                              <UIText
                                numberOfLines={1}
                                className="min-w-0 text-xs text-neutral-500 dark:text-neutral-400"
                              >
                                {profile.description}
                              </UIText>
                            )}
                          </View>
                          {selected && (
                            <UIText className="text-xs font-semibold text-sky-700 dark:text-sky-300">Active</UIText>
                          )}
                        </Button>
                      );
                      // A disabled row can't run PopoverClose's onPress, so the
                      // active row stays a plain Button (tapping it does nothing,
                      // same as before).
                      return selected || busy ? (
                        <View key={profile.name}>{row}</View>
                      ) : (
                        <PopoverClose asChild key={profile.name}>
                          {row}
                        </PopoverClose>
                      );
                    })
                  )}
                </ScrollView>
              </PopoverContent>
              <Button variant="ghost" size="icon" onPress={() => setSearchOpen(true)} hitSlop={10}>
                <Search size={20} color={dimColor} />
              </Button>
              <Button variant="ghost" size="icon" onPress={close} hitSlop={10}>
                <X size={20} color={dimColor} />
              </Button>
            </Popover>
          )
        )}
        <View className="px-3 pt-2 gap-1">
          <Button
            variant="ghost"
            disabled={busy}
            onPress={() => {
              if (busy) return;
              close();
              void newSession();
            }}
            className={`flex-row h-auto items-center justify-start gap-3 px-3 py-3 ${
              isNewChat ? activeItemClass : ''
            } ${busy ? 'opacity-50' : ''}`}
          >
            <SquarePen size={20} color={isNewChat ? brand : dimColor} />
            <UIText
              numberOfLines={1}
              className={`flex-1 min-w-0 text-[17px] ${
                isNewChat
                  ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                  : 'font-normal text-neutral-950 dark:text-neutral-100'
              }`}
            >
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
                onPress={() => {
                  close();
                  props.navigation.navigate(item.name);
                }}
                className={`flex-row h-auto items-center justify-start gap-3 px-3 py-3 ${
                  active ? activeItemClass : ''
                }`}
              >
                <Icon size={20} color={active ? brand : dimColor} />
                <UIText
                  numberOfLines={1}
                  className={`flex-1 min-w-0 text-[17px] ${
                    active
                      ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                      : 'font-normal text-neutral-950 dark:text-neutral-100'
                  }`}
                >
                  {item.label}
                </UIText>
              </Button>
            );
          })}

          {/* Meatball (More) Button under Files */}
          <Button
            variant="ghost"
            onPress={() => setShowMoreMenu(!showMoreMenu)}
            className={`flex-row h-auto items-center justify-start gap-3 px-3 py-3 ${
              showMoreMenu || isMoreActive ? activeItemClass : ''
            }`}
          >
            <Ellipsis
              size={20}
              color={(showMoreMenu || isMoreActive) ? brand : dimColor}
            />
            <UIText
              numberOfLines={1}
              className={`flex-1 min-w-0 text-[17px] ${
                (showMoreMenu || isMoreActive)
                  ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                  : 'font-normal text-neutral-950 dark:text-neutral-100'
              }`}
            >
              More
            </UIText>
            {pendingAskCount > 0 && (
              <Badge variant="destructive">
                <UIText className="text-[11px] font-bold text-white">{pendingAskCount > 99 ? '99+' : pendingAskCount}</UIText>
              </Badge>
            )}
          </Button>

          {/* Submenu for More */}
          {showMoreMenu && (
            <View className="ml-4 pl-3 border-l-2 border-neutral-200 dark:border-neutral-800 gap-1 my-0.5">
              {MORE_NAV_ITEMS.map((item) => {
                const active = pathname === `/${item.name}`;
                const Icon = item.icon;
                return (
                  <Button
                    key={item.name}
                    variant="ghost"
                    onPress={() => {
                      close();
                      props.navigation.navigate(item.name);
                    }}
                    className={`flex-row h-auto items-center justify-start gap-3 px-3 py-2.5 ${
                      active ? activeItemClass : ''
                    }`}
                  >
                    <Icon size={18} color={active ? brand : dimColor} />
                    <UIText
                      numberOfLines={1}
                      className={`flex-1 min-w-0 text-[15px] ${
                        active
                          ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                          : 'font-normal text-neutral-800 dark:text-neutral-200'
                      }`}
                    >
                      {item.label}
                    </UIText>
                  </Button>
                );
              })}
            </View>
          )}
        </View>
        <View className="px-3 pt-3">
          <Text className="px-3 pb-1 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
            {ql ? `Results (${visible.length})` : 'Recents'}
          </Text>
          {visible.length === 0 && (
            <Text className="px-3 py-2 text-[15px] text-neutral-500 dark:text-neutral-400">
              {ql ? 'No matches' : 'No sessions yet'}
            </Text>
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
            <View className="flex-row items-center justify-center gap-2 py-3">
              <ActivityIndicator size="small" />
              <Text className="text-[13px] text-neutral-500 dark:text-neutral-400">Loading more…</Text>
            </View>
          )}
        </View>
      </DrawerContentScrollView>

      {/* Sticky footer: Account bar */}
      <View
        className="border-t border-neutral-200 dark:border-neutral-800"
        style={{
          backgroundColor: screen,
          paddingBottom: Math.max(insets.bottom, 8),
        }}
      >
        {/* `key` force-closes the popover when the drawer closes: the native
            root keeps `open` in its own state, so there is no controlled prop
            to flip, and a portal survives the drawer being dismissed. */}
        <Popover key={userMenuKey} onOpenChange={setShowUserMenu}>
          <PopoverTrigger asChild>
            <Button variant="ghost" className="flex-row h-auto w-full items-center justify-start gap-3 px-4 py-4">
              <Avatar alt={username || 'Profile'} className="size-11 bg-[#1a73e8]">
                <AvatarFallback className="bg-[#1a73e8]">
                  <UIText className="text-lg font-bold text-white">{(username || 'H').slice(0, 1).toUpperCase()}</UIText>
                </AvatarFallback>
              </Avatar>
              <View className="flex-1">
                <UIText
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  className="min-w-0 text-[16px] font-semibold text-neutral-950 dark:text-neutral-100"
                >
                  {username || 'Hermes'}
                </UIText>
                <UIText className="min-w-0 text-sm text-neutral-500 dark:text-neutral-400">{host || ''}</UIText>
              </View>
              <ChevronRight
                size={18}
                color={dimColor}
                style={{ transform: [{ rotate: showUserMenu ? '-90deg' : '0deg' }] }}
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
                    onPress={() => {
                      close();
                      props.navigation.navigate(item.name);
                    }}
                    className={`h-auto w-full flex-row items-center justify-start gap-3 px-3.5 py-3 ${
                      active ? 'bg-[#1a73e8]/10 dark:bg-[#1a73e8]/20' : ''
                    }`}
                  >
                    <Icon size={19} color={active ? brand : dark ? '#ccc' : '#444'} />
                    <UIText
                      numberOfLines={1}
                      className={`flex-1 min-w-0 text-[15px] font-medium ${
                        active
                          ? 'text-[#1a73e8] dark:text-[#7aa7ff]'
                          : 'text-neutral-900 dark:text-neutral-100'
                      }`}
                    >
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
                onPress={() => {
                  close();
                  props.navigation.navigate('settings');
                }}
                className="h-auto w-full flex-row items-center justify-start gap-3 px-3.5 py-3"
              >
                <Settings size={19} color={dark ? '#ccc' : '#444'} />
                <UIText
                  numberOfLines={1}
                  className="flex-1 min-w-0 text-[15px] font-medium text-neutral-900 dark:text-neutral-100"
                >
                  Settings
                </UIText>
              </Button>
            </PopoverClose>
          </PopoverContent>
        </Popover>
      </View>

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
    </View>
  );
}
