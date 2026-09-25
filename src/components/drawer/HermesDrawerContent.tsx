// Custom drawer content, ChatGPT-style: New chat button, Recents list
// (opens straight into chat), History/Ops links, user footer with
// theme switch + logout. Extracted from app/_layout.tsx.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { DrawerContentScrollView, useDrawerStatus } from 'expo-router/drawer';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Ellipsis,
  LogOut,
  Search,
  Settings,
  SquarePen,
  X,
} from 'lucide-react-native';
import { useApp } from '../../hooks/app-store';
import { Tap } from '../ui/bits';
import { MORE_NAV_ITEMS, NAV_ITEMS, PROFILE_NAV_ITEMS } from './nav-config';

export function HermesDrawerContent(props: DrawerContentComponentProps) {
  const pathname = usePathname();
  const drawerOpen = useDrawerStatus() === 'open';
  const {
    authed, username, host, busy, activeProfile, profiles, refreshProfiles, switchProfile, sessionId, sessionKey, openingId, sessions, messages, pendingAskCount,
    newSession, openSession, refreshSessions, loadMoreSessions, sessionsHasMore, sessionsLoadingMore, logout, theme, deleteSessionById,
  } = useApp();
  // Hooks FIRST — no early return above this line (authed flips at
  // login; returning early before hooks breaks hook order).
  const insets = useSafeAreaInsets();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);
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
      if (MORE_NAV_ITEMS.some((item) => pathname === `/${item.name}`)) {
        setShowMoreMenu(true);
      }
    } else {
      setShowUserMenu(false);
    }
  }, [drawerOpen, pathname, refreshProfiles, refreshSessions]);
  // Inline filter replaces the removed /sessions page (drawer is the list now).
  // Memoized so every streamed token doesn't refilter + rebuild rows.
  // MUST stay above the `!authed` early return — hooks can't run after one.
  const ql = q.trim().toLowerCase();
  const filtered = useMemo(
    () => (ql ? sessions.filter((s) => (s.title || '').toLowerCase().includes(ql)) : sessions),
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
  if (!authed) return null;
  const dark = theme === 'dark';
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
    <View className="flex-1" style={{ backgroundColor: dark ? '#000' : '#fff' }}>
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
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search chats…"
              placeholderTextColor={dark ? '#888' : '#9ca3af'}
              autoFocus
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-2.5 text-[16px] text-neutral-950 dark:border-neutral-700 dark:text-neutral-100"
            />
            <Tap
              onPress={() => {
                setSearchOpen(false);
                setQ('');
              }}
              hitSlop={10}
              radius={18}
              className="p-2"
            >
              <X size={20} color={dimColor} />
            </Tap>
          </View>
        ) : (
          <View className="flex-row items-center px-4 pt-2">
            <Tap
              testID="profile-selector"
              accessibilityRole="button"
              accessibilityLabel={`Switch profile. Active profile: ${activeProfile}`}
              onPress={() => setProfilePickerOpen(true)}
              hitSlop={8}
              radius={12}
              className="min-w-0 flex-1 flex-row items-center gap-2 px-1 py-1"
            >
              <Text className="text-[26px] font-extrabold text-neutral-950 dark:text-neutral-100">Hermes</Text>
              <ChevronDown size={17} color={dimColor} />
            </Tap>
            <Tap onPress={() => setSearchOpen(true)} hitSlop={10} radius={18} className="p-2">
              <Search size={20} color={dimColor} />
            </Tap>
            <Tap onPress={close} hitSlop={10} radius={18} className="p-2">
              <X size={20} color={dimColor} />
            </Tap>
          </View>
        )}
        <View className="px-3 pt-2 gap-1">
          <Tap
            disabled={busy}
            onPress={() => {
              if (busy) return;
              close();
              void newSession();
            }}
            radius={12}
            className={`flex-row items-center gap-3 px-3 py-3 ${
              isNewChat ? activeItemClass : ''
            } ${busy ? 'opacity-50' : ''}`}
          >
            <SquarePen size={20} color={isNewChat ? '#1a73e8' : dimColor} />
            <Text
              className={`text-[17px] ${
                isNewChat
                  ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                  : 'text-neutral-950 dark:text-neutral-100'
              }`}
            >
              New chat
            </Text>
          </Tap>
          {NAV_ITEMS.map((item) => {
            const active = pathname === `/${item.name}`;
            const Icon = item.icon;
            return (
              <Tap
                key={item.name}
                onPress={() => {
                  close();
                  props.navigation.navigate(item.name);
                }}
                radius={12}
                className={`flex-row items-center gap-3 px-3 py-3 ${
                  active ? activeItemClass : ''
                }`}
              >
                <Icon size={20} color={active ? '#1a73e8' : dimColor} />
                <Text
                  className={`text-[17px] ${
                    active
                      ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                      : 'text-neutral-950 dark:text-neutral-100'
                  }`}
                >
                  {item.label}
                </Text>
              </Tap>
            );
          })}

          {/* Meatball (More) Button under Files */}
          <Tap
            onPress={() => setShowMoreMenu(!showMoreMenu)}
            radius={12}
            className={`flex-row items-center gap-3 px-3 py-3 ${
              showMoreMenu || isMoreActive ? activeItemClass : ''
            }`}
          >
            <Ellipsis
              size={20}
              color={(showMoreMenu || isMoreActive) ? '#1a73e8' : dimColor}
            />
            <Text
              className={`flex-1 text-[17px] ${
                (showMoreMenu || isMoreActive)
                  ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                  : 'text-neutral-950 dark:text-neutral-100'
              }`}
            >
              More
            </Text>
            {pendingAskCount > 0 && (
              <View className="min-w-5 items-center rounded-full bg-red-500 px-1.5 py-0.5">
                <Text className="text-[11px] font-bold text-white">{pendingAskCount > 99 ? '99+' : pendingAskCount}</Text>
              </View>
            )}
          </Tap>

          {/* Submenu for More */}
          {showMoreMenu && (
            <View className="ml-4 pl-3 border-l-2 border-neutral-200 dark:border-neutral-800 gap-1 my-0.5">
              {MORE_NAV_ITEMS.map((item) => {
                const active = pathname === `/${item.name}`;
                const Icon = item.icon;
                return (
                  <Tap
                    key={item.name}
                    onPress={() => {
                      close();
                      props.navigation.navigate(item.name);
                    }}
                    radius={12}
                    className={`flex-row items-center gap-3 px-3 py-2.5 ${
                      active ? activeItemClass : ''
                    }`}
                  >
                    <Icon size={18} color={active ? '#1a73e8' : dimColor} />
                    <Text
                      className={`text-[15px] ${
                        active
                          ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                          : 'text-neutral-800 dark:text-neutral-200'
                      }`}
                    >
                      {item.label}
                    </Text>
                  </Tap>
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
              onChat &&
              (s.profile ?? activeProfile) === activeProfile &&
              (s.id === activeId || s.id === openingId);
            return (
              <Tap
                key={`${s.profile ?? activeProfile}:${s.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Open chat ${s.title || '(untitled)'}`}
                onPress={() => {
                  close();
                  void openSession(s);
                }}
                onLongPress={() => {
                  Alert.alert(
                    'Delete chat',
                    `Delete "${s.title || '(untitled)'}"? This can't be undone.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => {
                          void deleteSessionById(s.id).then(() => refreshSessions());
                        },
                      },
                    ],
                    { cancelable: true },
                  );
                }}
                delayLongPress={400}
                radius={12}
                className={`px-3 py-3 ${
                  active ? activeItemClass : ''
                }`}
              >
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  className={`text-[16px] ${
                    active
                      ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                      : 'text-neutral-950 dark:text-neutral-100'
                  }`}
                >
                  {s.title || '(untitled)'}
                </Text>
              </Tap>
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

      <Modal
        visible={profilePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setProfilePickerOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: dark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.28)' }}
          onPress={() => setProfilePickerOpen(false)}
        >
          <Pressable
            className="mx-4 mt-14 rounded-2xl border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-[#1c1c1e]"
            onPress={(event) => event.stopPropagation()}
          >
            <View className="flex-row items-center justify-between px-3 py-2.5">
              <View>
                <Text className="text-base font-bold text-neutral-950 dark:text-neutral-100">Switch profile</Text>
                <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  Chat and toolsets use this profile
                </Text>
              </View>
              <Tap
                accessibilityRole="button"
                accessibilityLabel="Close profile picker"
                onPress={() => setProfilePickerOpen(false)}
                hitSlop={8}
                radius={16}
                className="p-2"
              >
                <X size={18} color={dimColor} />
              </Tap>
            </View>
            <ScrollView className="max-h-[420px]" nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {profiles.length === 0 ? (
                <View className="rounded-xl bg-neutral-100 px-3 py-3 dark:bg-neutral-900">
                  <Text className="text-sm text-neutral-600 dark:text-neutral-300">{activeProfile}</Text>
                </View>
              ) : (
                profiles.map((profile) => {
                  const selected = profile.name === activeProfile;
                  return (
                    <Tap
                      key={profile.name}
                      testID={`profile-option-${profile.name}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      disabled={busy || selected}
                      onPress={() => {
                        setProfilePickerOpen(false);
                        close();
                        void switchProfile(profile.name);
                      }}
                      radius={12}
                      className={`flex-row items-center gap-3 px-3 py-3 ${
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
                        <Text
                          numberOfLines={1}
                          className={`text-sm font-semibold ${
                            selected ? 'text-sky-700 dark:text-sky-300' : 'text-neutral-900 dark:text-neutral-100'
                          }`}
                        >
                          {profile.display_name || profile.name}
                        </Text>
                        {!!profile.description && (
                          <Text numberOfLines={1} className="text-xs text-neutral-500 dark:text-neutral-400">
                            {profile.description}
                          </Text>
                        )}
                      </View>
                      {selected && <Text className="text-xs font-semibold text-sky-700 dark:text-sky-300">Active</Text>}
                    </Tap>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Sticky footer: Account bar */}
      <View
        className="border-t border-neutral-200 dark:border-neutral-800"
        style={{
          backgroundColor: dark ? '#000' : '#fff',
          paddingBottom: Math.max(insets.bottom, 8),
        }}
      >
        <Tap
          onPress={() => setShowUserMenu(!showUserMenu)}
          radius={0}
          className="flex-row items-center gap-3 px-4 py-4"
        >
          <View className="h-11 w-11 items-center justify-center rounded-full bg-[#1a73e8]">
            <Text className="text-lg font-bold text-white">{(username || 'H').slice(0, 1).toUpperCase()}</Text>
          </View>
          <View className="flex-1">
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              className="text-[16px] font-semibold text-neutral-950 dark:text-neutral-100"
            >
              {username || 'Hermes'}
            </Text>
            <Text className="text-sm text-neutral-500 dark:text-neutral-400">{host || ''}</Text>
          </View>
          <ChevronRight
            size={18}
            color={dimColor}
            style={{ transform: [{ rotate: showUserMenu ? '-90deg' : '0deg' }] }}
          />
        </Tap>
      </View>

      {/* Floating Popover Menu right above the profile bar */}
      {showUserMenu && (
        <>
          {/* Backdrop to dismiss when clicking anywhere outside */}
          <Pressable
            onPress={() => setShowUserMenu(false)}
            className="absolute inset-0 z-40 bg-black/20 dark:bg-black/40"
          />

          {/* Floating Menu Card */}
          <View
            className="absolute left-3 right-3 z-50 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
            style={{
              bottom: Math.max(insets.bottom, 8) + 72,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: dark ? 0.5 : 0.15,
              shadowRadius: 12,
              elevation: 12,
            }}
          >
            {/* Logs & Usage quick nav */}
            {PROFILE_NAV_ITEMS.map((item) => {
              const active = pathname === `/${item.name}`;
              const Icon = item.icon;
              return (
                <Tap
                  key={item.name}
                  onPress={() => {
                    setShowUserMenu(false);
                    close();
                    props.navigation.navigate(item.name);
                  }}
                  radius={12}
                  className={`flex-row items-center gap-3 px-3.5 py-3 ${
                    active ? 'bg-[#1a73e8]/10 dark:bg-[#1a73e8]/20' : ''
                  }`}
                >
                  <Icon size={19} color={active ? '#1a73e8' : dark ? '#ccc' : '#444'} />
                  <Text
                    className={`text-[15px] font-medium ${
                      active
                        ? 'text-[#1a73e8] dark:text-[#7aa7ff]'
                        : 'text-neutral-900 dark:text-neutral-100'
                    }`}
                  >
                    {item.label}
                  </Text>
                </Tap>
              );
            })}

            <View className="my-0.5 h-[1px] bg-neutral-100 dark:bg-neutral-800" />

            <Tap
              onPress={() => {
                setShowUserMenu(false);
                close();
                props.navigation.navigate('settings');
              }}
              radius={12}
              className="flex-row items-center gap-3 px-3.5 py-3"
            >
              <Settings size={19} color={dark ? '#ccc' : '#444'} />
              <Text className="text-[15px] font-medium text-neutral-900 dark:text-neutral-100">
                Settings
              </Text>
            </Tap>

            <View className="my-0.5 h-[1px] bg-neutral-100 dark:bg-neutral-800" />

            <Tap
              onPress={() => {
                setShowUserMenu(false);
                close();
                void logout();
              }}
              radius={12}
              highlight="rgba(220,38,38,0.14)"
              className="flex-row items-center gap-3 px-3.5 py-3"
            >
              <LogOut size={19} color="#dc2626" />
              <Text className="text-[15px] font-medium text-red-600 dark:text-red-400">
                Log Out
              </Text>
            </Tap>
          </View>
        </>
      )}
    </View>
  );
}
