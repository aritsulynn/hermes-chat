// Root layout — expo-router Drawer (https://docs.expo.dev/router/advanced/drawer/).
// Native drawer items (DrawerItemList/DrawerItem) instead of handmade buttons.
import '../global.css';
import { useEffect } from 'react';
import { Drawer, DrawerContentScrollView, DrawerItem } from 'expo-router/drawer';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { usePathname } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { Platform, Text, View } from 'react-native';
import { LayoutGrid, LayoutList, LogOut, MessageSquare, Moon, RefreshCw, Sun } from 'lucide-react-native';
import { AppProvider, useApp } from '../src/store';
import { BUILD_ID } from '../src/build';
import type { ConnState } from '../src/gateway-ws';

// Hold the native splash until the silent reconnect finishes (booting).
SplashScreen.preventAutoHideAsync().catch(() => {});

function SplashGate() {
  const { booting } = useApp();
  useEffect(() => {
    if (!booting) SplashScreen.hideAsync().catch(() => {});
  }, [booting]);
  return null;
}

function connLabel(conn: ConnState): string {
  return conn === 'ready'
    ? 'Connected'
    : conn === 'connecting' || conn === 'reconnecting'
      ? 'Connecting…'
      : conn === 'auth-expired'
        ? 'Session expired'
        : 'Offline';
}

// Module-level icon helper — used both in drawer content and screen options.
const drawerIcon = (C: any) => ({ color, size }: any) => <C size={size} color={color} />;

// Custom drawer content — identity header + nav items (Chat is home,
// History lists past sessions, Ops opens the ops screens) + action
// items (theme switch / Refresh / Logout).
function HermesDrawerContent(props: DrawerContentComponentProps) {
  const pathname = usePathname();
  const { authed, conn, host, username, busy, sessionId, newSession, refreshSessions, logout, theme, toggleTheme } = useApp();
  if (!authed) return null;
  const dark = theme === 'dark';
  const labelColor = dark ? '#f5f5f5' : '#111';
  const close = () => props.navigation.closeDrawer();
  const onSessions = pathname === '/sessions';
  const onChat = pathname === '/chat';
  const onOps = pathname === '/ops';
  const icon = drawerIcon;
  return (
    <DrawerContentScrollView {...props} contentContainerStyle={{ flex: 1 }}>
      <View className="px-4 pt-2">
        <Text className="text-[22px] font-extrabold text-neutral-950 dark:text-neutral-100">Hermes</Text>
        {!!username && (
          <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={1} ellipsizeMode="tail">
            {username}@{host}
          </Text>
        )}
        <Text className="mb-1 mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{connLabel(conn)}</Text>
      </View>
      <View className="px-2">
        <DrawerItem
          label="Chat"
          icon={icon(MessageSquare)}
          focused={onChat}
          activeTintColor="#1a73e8"
          inactiveTintColor={labelColor}
          labelStyle={{ color: onChat ? '#1a73e8' : labelColor }}
          onPress={() => {
            if (busy) return;
            close();
            // Chat is home: return to the open session, or start a fresh
            // one when there is none.
            if (sessionId) props.navigation.navigate('chat');
            else void newSession();
          }}
        />
        <DrawerItem
          label="History"
          icon={icon(LayoutList)}
          focused={onSessions}
          activeTintColor="#1a73e8"
          inactiveTintColor={labelColor}
          labelStyle={{ color: onSessions ? '#1a73e8' : labelColor }}
          onPress={() => {
            close();
            props.navigation.navigate('sessions');
            void refreshSessions();
          }}
        />
        <DrawerItem
          label="Ops"
          icon={icon(LayoutGrid)}
          focused={onOps}
          activeTintColor="#1a73e8"
          inactiveTintColor={labelColor}
          labelStyle={{ color: onOps ? '#1a73e8' : labelColor }}
          onPress={() => {
            close();
            props.navigation.navigate('ops');
          }}
        />
      </View>
      <View className="px-2">
        <DrawerItem
          label={dark ? 'Light mode' : 'Dark mode'}
          icon={icon(dark ? Sun : Moon)}
          inactiveTintColor={labelColor}
          labelStyle={{ color: labelColor }}
          onPress={() => {
            toggleTheme();
          }}
        />
        {onSessions && (
          <DrawerItem
            label="Refresh sessions"
            icon={icon(RefreshCw)}
            inactiveTintColor={labelColor}
            labelStyle={{ color: labelColor }}
            onPress={() => {
              close();
              void refreshSessions();
            }}
          />
        )}
      </View>
      <View className="px-2 pb-3">
        <DrawerItem
          label="Logout"
          icon={icon(LogOut)}
          inactiveTintColor="#c5221f"
          onPress={() => {
            close();
            void logout();
          }}
        />
        <Text className="mt-2 text-center text-[10px] text-neutral-400">
          build {BUILD_ID}
        </Text>
      </View>
    </DrawerContentScrollView>
  );
}

function ThemedStatusBar() {
  const { theme } = useApp();
  const dark = theme === 'dark';
  // Android 15 is edge-to-edge: paint the system nav bar to match the theme
  // (black like YouTube in dark mode) so it never flashes white below the app.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void NavigationBar.setBackgroundColorAsync(dark ? '#000000' : '#ffffff').catch(() => {});
    void NavigationBar.setButtonStyleAsync(dark ? 'light' : 'dark').catch(() => {});
  }, [dark]);
  return <StatusBar style={dark ? 'light' : 'auto'} />;
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
        name="sessions"
        options={{
          headerShown: true,
          title: 'History',
          drawerLabel: 'History',
          drawerIcon: drawerIcon(LayoutList),
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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
          <ThemedStatusBar />
          <SplashGate />
          <BottomSheetModalProvider>
            <ThemedDrawer />
          </BottomSheetModalProvider>
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
