// Root layout — expo-router Drawer (https://docs.expo.dev/router/advanced/drawer/).
// Native drawer items (DrawerItemList/DrawerItem) instead of handmade buttons.
import { useEffect } from 'react';
import { Drawer, DrawerContentScrollView, DrawerItem, DrawerItemList } from 'expo-router/drawer';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { usePathname } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import { Info, LayoutList, LogOut, MessageSquare, Plus, RefreshCw } from 'lucide-react-native';
import { AppProvider, useApp } from '../src/store';
import { styles } from '../src/ui';
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

// Custom drawer content — identity header + the standard DrawerItemList
// (Sessions / Chat come from Drawer.Screen options below, with native
// active highlight) + action items (New / Refresh / Logout).
function HermesDrawerContent(props: DrawerContentComponentProps) {
  const pathname = usePathname();
  const { authed, conn, host, username, busy, newSession, refreshSessions, logout, openInfo } = useApp();
  if (!authed) return null;
  const close = () => props.navigation.closeDrawer();
  const onSessions = pathname === '/sessions';
  const onChat = pathname === '/chat';
  const icon = drawerIcon;
  return (
    <DrawerContentScrollView {...props} contentContainerStyle={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <Text style={styles.drawerTitle}>Hermes</Text>
        {!!username && (
          <Text style={styles.drawerSub} numberOfLines={1} ellipsizeMode="tail">
            {username}@{host}
          </Text>
        )}
        <Text style={styles.drawerConn}>{connLabel(conn)}</Text>
      </View>
      <DrawerItemList {...props} />
      <View style={{ paddingHorizontal: 8 }}>
        <DrawerItem
          label="New session"
          icon={icon(Plus)}
          onPress={() => {
            if (busy) return;
            close();
            void newSession();
          }}
        />
        {onSessions && (
          <DrawerItem
            label="Refresh sessions"
            icon={icon(RefreshCw)}
            onPress={() => {
              close();
              void refreshSessions();
            }}
          />
        )}
        {onChat && (
          <DrawerItem
            label="Session info"
            icon={icon(Info)}
            onPress={() => {
              close();
              void openInfo();
            }}
          />
        )}
      </View>
      <View style={styles.flex} />
      <View style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
        <DrawerItem
          label="Logout"
          icon={icon(LogOut)}
          inactiveTintColor="#c5221f"
          onPress={() => {
            close();
            void logout();
          }}
        />
        <Text style={{ fontSize: 10, color: '#999', textAlign: 'center', marginTop: 8 }}>
          build {BUILD_ID}
        </Text>
      </View>
    </DrawerContentScrollView>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
          <StatusBar style="auto" />
          <SplashGate />
          <BottomSheetModalProvider>
          <Drawer
            initialRouteName="login"
            drawerContent={(p) => <HermesDrawerContent {...p} />}
            screenOptions={{
              swipeEnabled: true,
              drawerActiveTintColor: '#1a73e8',
            }}
          >
            <Drawer.Screen
              name="login"
              options={{ headerShown: false, drawerItemStyle: { display: 'none' }, swipeEnabled: false, title: 'Login' }}
            />
            <Drawer.Screen
              name="sessions"
              options={{
                headerShown: true,
                title: 'Sessions',
                drawerLabel: 'All sessions',
                drawerIcon: drawerIcon(LayoutList),
              }}
            />
            <Drawer.Screen
              name="chat"
              options={{
                // Title + header buttons are set live from chat.tsx
                // (session title, back, info) via navigation.setOptions.
                headerShown: true,
                title: 'Chat',
                drawerLabel: 'Current chat',
                drawerIcon: drawerIcon(MessageSquare),
              }}
            />
          </Drawer>
          </BottomSheetModalProvider>
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
