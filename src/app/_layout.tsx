// Root layout — expo-router Drawer (https://docs.expo.dev/router/advanced/drawer/).
// Native drawer items (DrawerItemList/DrawerItem) instead of handmade buttons.
import '../../global.css';
import { useEffect, useState } from 'react';
import { Drawer, DrawerContentScrollView, useDrawerStatus } from 'expo-router/drawer';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import {
  Activity,
  ChevronRight,
  Clock,
  Ellipsis,
  Folder,
  Kanban,
  LogOut,
  MessageSquare,
  Moon,
  ScrollText,
  Search,
  Settings,
  SquarePen,
  Sun,
  X,
} from 'lucide-react-native';
import { AppProvider, useApp } from '../hooks/app-store';

// Hold the native splash until the silent reconnect finishes (booting).
SplashScreen.preventAutoHideAsync().catch(() => {});

// Module-level icon helper — used both in drawer content and screen options.
const drawerIcon = (C: any) => ({ color, size }: any) => <C size={size} color={color} />;

const NAV_ITEMS = [
  { name: 'cron', label: 'Cron Jobs', icon: Clock },
  { name: 'files', label: 'Files', icon: Folder },
] as const;

const MORE_NAV_ITEMS = [
  { name: 'kanban', label: 'Kanban', icon: Kanban },
] as const;

// Items shown inside the profile bar popover (above Settings / Log Out)
const PROFILE_NAV_ITEMS = [
  { name: 'logs', label: 'Logs', icon: ScrollText },
  { name: 'usage', label: 'Usage', icon: Activity },
] as const;

// Custom drawer content, ChatGPT-style: New chat button, Recents list
// (opens straight into chat), History/Ops links, user footer with
// theme switch + logout.
function HermesDrawerContent(props: DrawerContentComponentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const drawerOpen = useDrawerStatus() === 'open';
  const {
    authed, username, host, busy, sessionId, sessions, messages,
    newSession, openSession, refreshSessions, logout, theme,
  } = useApp();
  // Hooks FIRST — no early return above this line (authed flips at
  // login; returning early before hooks breaks hook order).
  const insets = useSafeAreaInsets();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  // Keep Recents fresh every time the drawer opens (replaces the old
  // manual Refresh item).
  useEffect(() => {
    if (drawerOpen) {
      void refreshSessions();
      if (MORE_NAV_ITEMS.some((item) => pathname === `/${item.name}`)) {
        setShowMoreMenu(true);
      }
    } else {
      setShowUserMenu(false);
    }
  }, [drawerOpen, pathname, refreshSessions]);
  if (!authed) return null;
  const dark = theme === 'dark';
  const dimColor = dark ? '#a3a3a3' : '#555';
  const rowBg = dark ? '#272727' : '#e8e8ec';
  const close = () => props.navigation.closeDrawer();
  const onChat = pathname === '/chat';
  const hasActiveRecent = sessions.some((s) => onChat && s.id === sessionId);
  const isNewChat = onChat && !hasActiveRecent && messages.length === 0;
  const isMoreActive = MORE_NAV_ITEMS.some((item) => pathname === `/${item.name}`);
  // Inline filter replaces the removed /sessions page (drawer is the list now).
  const ql = q.trim().toLowerCase();
  const visible = (ql
    ? sessions.filter((s) => (s.title || '').toLowerCase().includes(ql))
    : sessions
  ).slice(0, 50);
  return (
    <View className="flex-1" style={{ backgroundColor: dark ? '#000' : '#fff' }}>
      <DrawerContentScrollView {...props} contentContainerStyle={{ paddingBottom: 16 }}>
        {searchOpen ? (
          <View className="flex-row items-center gap-1 px-4 pt-2">
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search chats…"
              placeholderTextColor={dark ? '#888' : '#9ca3af'}
              autoFocus
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-[15px] text-neutral-950 dark:border-neutral-700 dark:text-neutral-100"
            />
            <Pressable
              onPress={() => {
                setSearchOpen(false);
                setQ('');
              }}
              hitSlop={10}
              className="p-2"
            >
              <X size={20} color={dimColor} />
            </Pressable>
          </View>
        ) : (
          <View className="flex-row items-center px-4 pt-2">
            <Text className="flex-1 text-[22px] font-extrabold text-neutral-950 dark:text-neutral-100">Hermes</Text>
            <Pressable onPress={() => setSearchOpen(true)} hitSlop={10} className="p-2">
              <Search size={20} color={dimColor} />
            </Pressable>
            <Pressable onPress={close} hitSlop={10} className="p-2">
              <X size={20} color={dimColor} />
            </Pressable>
          </View>
        )}
        <View className="px-3 pt-2 gap-1">
          <Pressable
            disabled={busy}
            onPress={() => {
              if (busy) return;
              close();
              void newSession();
            }}
            className="flex-row items-center gap-2.5 rounded-xl px-3 py-2.5"
            style={({ pressed }) => [
              (isNewChat || pressed) ? { backgroundColor: rowBg } : undefined,
              { opacity: busy ? 0.5 : 1 },
            ]}
          >
            <SquarePen size={18} color={isNewChat ? '#1a73e8' : dimColor} />
            <Text
              className={`text-[15px] ${
                isNewChat
                  ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                  : 'text-neutral-950 dark:text-neutral-100'
              }`}
            >
              New chat
            </Text>
          </Pressable>
          {NAV_ITEMS.map((item) => {
            const active = pathname === `/${item.name}`;
            const Icon = item.icon;
            return (
              <Pressable
                key={item.name}
                onPress={() => {
                  close();
                  props.navigation.navigate(item.name);
                }}
                className="flex-row items-center gap-2.5 rounded-xl px-3 py-2.5"
                style={({ pressed }) => [
                  (active || pressed) ? { backgroundColor: rowBg } : undefined,
                ]}
              >
                <Icon size={18} color={active ? '#1a73e8' : dimColor} />
                <Text
                  className={`text-[15px] ${
                    active
                      ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                      : 'text-neutral-950 dark:text-neutral-100'
                  }`}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}

          {/* Meatball (More) Button under Files */}
          <Pressable
            onPress={() => setShowMoreMenu(!showMoreMenu)}
            className="flex-row items-center gap-2.5 rounded-xl px-3 py-2.5"
            style={({ pressed }) => [
              (showMoreMenu || isMoreActive || pressed)
                ? { backgroundColor: rowBg }
                : undefined,
            ]}
          >
            <Ellipsis
              size={18}
              color={(showMoreMenu || isMoreActive) ? '#1a73e8' : dimColor}
            />
            <Text
              className={`text-[15px] ${
                (showMoreMenu || isMoreActive)
                  ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                  : 'text-neutral-950 dark:text-neutral-100'
              }`}
            >
              More
            </Text>
          </Pressable>

          {/* Submenu for More */}
          {showMoreMenu && (
            <View className="ml-4 pl-3 border-l-2 border-neutral-200 dark:border-neutral-800 gap-1 my-0.5">
              {MORE_NAV_ITEMS.map((item) => {
                const active = pathname === `/${item.name}`;
                const Icon = item.icon;
                return (
                  <Pressable
                    key={item.name}
                    onPress={() => {
                      close();
                      props.navigation.navigate(item.name);
                    }}
                    className="flex-row items-center gap-2.5 rounded-xl px-3 py-2"
                    style={active ? { backgroundColor: rowBg } : undefined}
                  >
                    <Icon size={16} color={active ? '#1a73e8' : dimColor} />
                    <Text
                      className={`text-sm ${
                        active
                          ? 'font-semibold text-[#1a73e8] dark:text-[#7aa7ff]'
                          : 'text-neutral-800 dark:text-neutral-200'
                      }`}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
        <View className="px-3 pt-3">
          <Text className="px-3 pb-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
            {ql ? `Results (${visible.length})` : 'Recents'}
          </Text>
          {visible.length === 0 && (
            <Text className="px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400">
              {ql ? 'No matches' : 'No sessions yet'}
            </Text>
          )}
          {visible.map((s) => {
            const active = onChat && s.id === sessionId;
            return (
              <Pressable
                key={s.id}
                onPress={() => {
                  close();
                  void openSession(s);
                }}
                className="rounded-xl px-3 py-2.5"
                style={({ pressed }) => [
                  (active || pressed) ? { backgroundColor: rowBg } : undefined,
                ]}
              >
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  className="text-[15px] text-neutral-950 dark:text-neutral-100"
                >
                  {s.title || '(untitled)'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </DrawerContentScrollView>

      {/* Sticky footer: Profile Bar */}
      <View
        className="border-t border-neutral-200 dark:border-neutral-800"
        style={{
          backgroundColor: dark ? '#000' : '#fff',
          paddingBottom: Math.max(insets.bottom, 8),
        }}
      >
        <Pressable
          onPress={() => setShowUserMenu(!showUserMenu)}
          className="flex-row items-center gap-3 px-4 py-4 active:opacity-75"
        >
          <View className="h-10 w-10 items-center justify-center rounded-full bg-[#1a73e8]">
            <Text className="text-base font-bold text-white">{(username || 'H').slice(0, 1).toUpperCase()}</Text>
          </View>
          <View className="flex-1">
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              className="text-[15px] font-semibold text-neutral-950 dark:text-neutral-100"
            >
              {username || 'Hermes'}
            </Text>
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">{host || ''}</Text>
          </View>
          <ChevronRight
            size={16}
            color={dimColor}
            style={{ transform: [{ rotate: showUserMenu ? '-90deg' : '0deg' }] }}
          />
        </Pressable>
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
              bottom: Math.max(insets.bottom, 8) + 66,
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
                <Pressable
                  key={item.name}
                  onPress={() => {
                    setShowUserMenu(false);
                    close();
                    props.navigation.navigate(item.name);
                  }}
                  className={`flex-row items-center gap-3 rounded-xl px-3.5 py-2.5 ${
                    active
                      ? 'bg-[#1a73e8]/10 dark:bg-[#1a73e8]/20'
                      : 'active:bg-neutral-100 dark:active:bg-neutral-800'
                  }`}
                >
                  <Icon size={17} color={active ? '#1a73e8' : dark ? '#ccc' : '#444'} />
                  <Text
                    className={`text-sm font-medium ${
                      active
                        ? 'text-[#1a73e8] dark:text-[#7aa7ff]'
                        : 'text-neutral-900 dark:text-neutral-100'
                    }`}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}

            <View className="my-0.5 h-[1px] bg-neutral-100 dark:bg-neutral-800" />

            <Pressable
              onPress={() => {
                setShowUserMenu(false);
                close();
                props.navigation.navigate('settings');
              }}
              className="flex-row items-center gap-3 rounded-xl px-3.5 py-2.5 active:bg-neutral-100 dark:active:bg-neutral-800"
            >
              <Settings size={17} color={dark ? '#ccc' : '#444'} />
              <Text className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                Settings
              </Text>
            </Pressable>

            <View className="my-0.5 h-[1px] bg-neutral-100 dark:bg-neutral-800" />

            <Pressable
              onPress={() => {
                setShowUserMenu(false);
                close();
                void logout();
              }}
              className="flex-row items-center gap-3 rounded-xl px-3.5 py-2.5 active:bg-red-50 dark:active:bg-red-950/40"
            >
              <LogOut size={17} color="#dc2626" />
              <Text className="text-sm font-medium text-red-600 dark:text-red-400">
                Log Out
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}


function ThemedStatusBar() {
  const { theme } = useApp();
  const dark = theme === 'dark';
  // Android 15 is edge-to-edge: tell the OS which button contrast to use.
  // NOTE: `style` names the *button* colour, not the bar: 'light' = lighter
  // buttons (for a dark bar), 'dark' = darker buttons (for a light bar).
  // (See expo-navigation-bar's own `auto`: light scheme -> 'dark'.)
  // Only affects the 3-button nav bar; gesture nav ignores it entirely.
  return (
    <>
      <StatusBar style={dark ? 'light' : 'auto'} />
      {Platform.OS === 'android' && <NavigationBar style={dark ? 'light' : 'dark'} />}
    </>
  );
}

function ThemedDrawer() {
  const { theme } = useApp();
  const dark = theme === 'dark';
  const bg = dark ? '#000' : '#fff';
  const fg = dark ? '#f5f5f5' : '#111';
  return (
    <Drawer
      initialRouteName="login"
      drawerContent={(p) => <HermesDrawerContent {...p} />}
      screenOptions={{
        swipeEnabled: true,
        drawerActiveTintColor: '#1a73e8',
        headerStyle: { backgroundColor: bg },
        headerShadowVisible: false,
        headerTintColor: fg,
        headerTitleStyle: { color: fg },
        drawerStyle: { backgroundColor: bg },
        // Force the navigator's scene container to the theme color so the
        // Android 15 edge-to-edge nav-bar region never shows the default
        // white window background in gesture mode.
        sceneStyle: { backgroundColor: bg },
      }}
    >
      <Drawer.Screen
        name="login"
        options={{ headerShown: false, drawerItemStyle: { display: 'none' }, swipeEnabled: false, title: 'Login' }}
      />
      <Drawer.Screen
        name="index"
        options={{ headerShown: false, drawerItemStyle: { display: 'none' }, swipeEnabled: false, title: 'Index' }}
      />
      <Drawer.Screen
        name="chat"
        options={{
          // Title + header buttons are set live from chat.tsx
          // (session title, hamburger, kebab) via navigation.setOptions.
          headerShown: true,
          title: 'Chat',
          drawerLabel: 'Chat',
          drawerIcon: drawerIcon(MessageSquare),
        }}
      />
      <Drawer.Screen
        name="cron"
        options={{
          headerShown: false,
          title: 'Cron Jobs',
          drawerLabel: 'Cron Jobs',
          drawerIcon: drawerIcon(Clock),
        }}
      />
      <Drawer.Screen
        name="kanban"
        options={{
          headerShown: true,
          title: 'Kanban',
          drawerLabel: 'Kanban',
          drawerIcon: drawerIcon(Kanban),
        }}
      />
      <Drawer.Screen
        name="logs"
        options={{
          headerShown: false,
          title: 'Logs',
          drawerLabel: 'Logs',
          drawerIcon: drawerIcon(ScrollText),
        }}
      />
      <Drawer.Screen
        name="usage"
        options={{
          headerShown: false,
          title: 'Usage',
          drawerLabel: 'Usage',
          drawerIcon: drawerIcon(Activity),
        }}
      />
      <Drawer.Screen
        name="files"
        options={{
          headerShown: false,
          title: 'Files',
          drawerLabel: 'Files',
          drawerIcon: drawerIcon(Folder),
        }}
      />
      <Drawer.Screen
        name="settings"
        options={{
          headerShown: false,
          drawerItemStyle: { display: 'none' },
          title: 'Settings',
        }}
      />
    </Drawer>
  );
}

function SplashGate() {
  const { booting } = useApp();
  useEffect(() => {
    if (!booting) SplashScreen.hideAsync().catch(() => {});
  }, [booting]);
  return null;
}

export default function RootLayout() {
  return (
    <AppProvider>
      <ThemedRoot />
    </AppProvider>
  );
}

// Root view painted with the theme color so the Android 15 edge-to-edge
// system areas (nav bar region) never show the white window background.
// SafeAreaProvider is placed here (inside AppProvider) so the theme is
// available when we need it.
function ThemedRoot() {
  const { theme } = useApp();
  const bg = theme === 'dark' ? '#000' : '#fff';
  // Paint the Android *window* background (DecorView), not just the React
  // root. On edge-to-edge Android the gesture-nav region sits outside the
  // React tree, so a themed window background is what stops the default white
  // `windowBackground` from showing as a strip under the gesture pill.
  // No-op-ish elsewhere (sets the iOS root view colour too).
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(bg).catch(() => {});
  }, [bg]);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: bg }}>
      <SafeAreaProvider style={{ backgroundColor: bg }}>
        <ThemedStatusBar />
        <SplashGate />
        <BottomSheetModalProvider>
          <ThemedDrawer />
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
