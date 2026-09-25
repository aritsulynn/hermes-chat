// Root layout — expo-router Drawer (https://docs.expo.dev/router/advanced/drawer/).
// Native drawer items (DrawerItemList/DrawerItem) instead of handmade buttons.
// The custom drawer content lives in components/drawer/.
import '../../global.css';
import { useEffect } from 'react';
import { Drawer } from 'expo-router/drawer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { Platform } from 'react-native';
import {
  Activity,
  BellRing,
  Boxes,
  Clock,
  Folder,
  Kanban,
  MessageSquare,
  ScrollText,
  Wrench,
} from 'lucide-react-native';
import { AppProvider, useApp } from '../hooks/app-store';
import { FilePreviewHost } from '../components';
import { HermesDrawerContent } from '../components/drawer/HermesDrawerContent';
import { drawerIcon } from '../components/drawer/nav-config';

// Hold the native splash until the silent reconnect finishes (booting).
SplashScreen.preventAutoHideAsync().catch(() => {});

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
        name="asks"
        options={{
          headerShown: false,
          title: 'Ask Inbox',
          drawerLabel: 'Ask Inbox',
          drawerIcon: drawerIcon(BellRing),
        }}
      />
      <Drawer.Screen
        name="skills"
        options={{
          headerShown: false,
          title: 'Skills',
          drawerLabel: 'Skills',
          drawerIcon: drawerIcon(Wrench),
        }}
      />
      <Drawer.Screen
        name="toolsets"
        options={{
          headerShown: false,
          title: 'Toolsets',
          drawerLabel: 'Toolsets',
          drawerIcon: drawerIcon(Boxes),
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
          {/* File links inside markdown preview through this host (a Modal
              can't live inside the <Text> the markdown pipeline builds). */}
          <FilePreviewHost />
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
