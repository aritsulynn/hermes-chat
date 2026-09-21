// Root layout — expo-router Drawer (https://docs.expo.dev/router/advanced/drawer/).
// Native drawer items (DrawerItemList/DrawerItem) instead of handmade buttons.
import '../../global.css';
import { useEffect, useState } from 'react';
import { Drawer, DrawerContentScrollView, useDrawerStatus } from 'expo-router/drawer';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { usePathname } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { LayoutGrid, LogOut, MessageSquare, Moon, Search, SquarePen, Sun, X } from 'lucide-react-native';
import { AppProvider, useApp } from '../hooks/app-store';
import { BUILD_ID } from '../build';

// Hold the native splash until the silent reconnect finishes (booting).
SplashScreen.preventAutoHideAsync().catch(() => {});

function SplashGate() {
  const { booting } = useApp();
  useEffect(() => {
    if (!booting) SplashScreen.hideAsync().catch(() => {});
  }, [booting]);
  return null;
}

// Module-level icon helper — used both in drawer content and screen options.
const drawerIcon = (C: any) => ({ color, size }: any) => <C size={size} color={color} />;

// Custom drawer content, ChatGPT-style: New chat button, Recents list
// (opens straight into chat), History/Ops links, user footer with
// theme switch + logout.
function HermesDrawerContent(props: DrawerContentComponentProps) {
  const pathname = usePathname();
  const drawerOpen = useDrawerStatus() === 'open';
  const {
    authed, username, host, busy, sessionId, sessions,
    newSession, openSession, refreshSessions, logout, theme, toggleTheme,
  } = useApp();
  // Hooks FIRST — no early return above this line (authed flips at
  // login; returning early before hooks breaks hook order).
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  // Keep Recents fresh every time the drawer opens (replaces the old
  // manual Refresh item).
  useEffect(() => {
    if (drawerOpen) void refreshSessions();
  }, [drawerOpen, refreshSessions]);
  if (!authed) return null;
  const dark = theme === 'dark';
  const dimColor = dark ? '#a3a3a3' : '#555';
  const rowBg = dark ? '#272727' : '#e8e8ec';
  const close = () => props.navigation.closeDrawer();
  const onChat = pathname === '/chat';
  const onOps = pathname === '/ops';
  // Inline filter replaces the removed /sessions page (drawer is the list now).
  const ql = q.trim().toLowerCase();
  const visible = (ql
    ? sessions.filter((s) => (s.title || '').toLowerCase().includes(ql))
    : sessions
  ).slice(0, 50);
  return (
    <DrawerContentScrollView {...props} contentContainerStyle={{ flex: 1 }}>
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
      <View className="px-3 pt-2">
        <Pressable
          disabled={busy}
          onPress={() => {
            if (busy) return;
            close();
            void newSession();
          }}
          className="flex-row items-center gap-2.5 rounded-xl px-3 py-2.5"
          style={{ backgroundColor: rowBg, opacity: busy ? 0.5 : 1 }}
        >
          <SquarePen size={18} color={dark ? '#f5f5f5' : '#111'} />
          <Text className="text-[15px] font-semibold text-neutral-950 dark:text-neutral-100">New chat</Text>
        </Pressable>
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
              style={active ? { backgroundColor: rowBg } : undefined}
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
      <View className="flex-1" />
      <View className="px-3">
        <Pressable
          onPress={() => {
            close();
            props.navigation.navigate('ops');
          }}
          className="flex-row items-center gap-2.5 rounded-xl px-3 py-2.5"
          style={onOps ? { backgroundColor: rowBg } : undefined}
        >
          <LayoutGrid size={18} color={onOps ? '#1a73e8' : dimColor} />
          <Text
            className={`text-[15px] ${onOps ? 'text-[#1a73e8] dark:text-[#7aa7ff]' : 'text-neutral-950 dark:text-neutral-100'}`}
          >
            Ops
          </Text>
        </Pressable>
      </View>
      <View className="flex-row items-center gap-2 px-4 py-3">
        <View className="h-8 w-8 items-center justify-center rounded-full bg-[#1a73e8]">
          <Text className="text-sm font-bold text-white">{(username || 'H').slice(0, 1).toUpperCase()}</Text>
        </View>
        <View className="flex-1">
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            className="text-sm font-semibold text-neutral-950 dark:text-neutral-100"
          >
            {username || 'Hermes'}
          </Text>
          {!!host && (
            <Text numberOfLines={1} ellipsizeMode="tail" className="text-xs text-neutral-500 dark:text-neutral-400">
              {host}
            </Text>
          )}
        </View>
        <Pressable onPress={() => toggleTheme()} hitSlop={10} className="p-2">
          {dark ? <Sun size={18} color={dimColor} /> : <Moon size={18} color={dimColor} />}
        </Pressable>
        <Pressable
          onPress={() => {
            close();
            void logout();
          }}
          hitSlop={10}
          className="p-2"
        >
          <LogOut size={18} color="#c5221f" />
        </Pressable>
      </View>
      <Text className="pb-3 text-center text-[10px] text-neutral-400">
        build {BUILD_ID}
      </Text>
    </DrawerContentScrollView>
  );
}

function ThemedStatusBar() {
  const { theme } = useApp();
  const dark = theme === 'dark';
  // Android 15 is edge-to-edge (transparent system bar over our themed
  // background); tell the OS which button contrast to use. No-op on iOS/web.
  return (
    <>
      <StatusBar style={dark ? 'light' : 'auto'} />
      {Platform.OS === 'android' && <NavigationBar style={dark ? 'dark' : 'light'} />}
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
        name="ops"
        options={{
          headerShown: true,
          title: 'Ops',
          drawerLabel: 'Ops (cron/kanban/logs)',
          drawerIcon: drawerIcon(LayoutGrid),
        }}
      />
    </Drawer>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <ThemedRoot />
      </AppProvider>
    </SafeAreaProvider>
  );
}

// Root view painted with the theme color so the Android 15 edge-to-edge
// system areas (nav bar region) never show the white window background.
function ThemedRoot() {
  const { theme } = useApp();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme === 'dark' ? '#000' : '#fff' }}>
      <ThemedStatusBar />
      <SplashGate />
      <BottomSheetModalProvider>
        <ThemedDrawer />
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
