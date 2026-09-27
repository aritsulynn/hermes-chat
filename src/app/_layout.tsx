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
import { Platform, View } from 'react-native';
import { PortalHost } from '@rn-primitives/portal';
import { ToastHost } from '../components/ui/toast';
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
import { AppProvider, useApp, useThemeValue } from '../hooks/app-store';
import { FilePreviewHost } from '../components/chat/media';
import { ConnectionBanner } from '../components/connection-banner';
import { HermesDrawerContent } from '../components/drawer/HermesDrawerContent';
import { drawerIcon } from '../components/drawer/nav-config';
import { THEME } from '../theme';

// Hold the native splash until the silent reconnect finishes (booting).
SplashScreen.preventAutoHideAsync().catch(() => {});

function ThemedStatusBar() {
  const { theme } = useThemeValue();
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
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const bg = dark ? THEME.dark.background : THEME.light.background;
  const fg = dark ? THEME.dark.foreground : THEME.light.foreground;
  return (
    <Drawer
      initialRouteName="login"
      drawerContent={(p) => <HermesDrawerContent {...p} />}
      screenOptions={{
        swipeEnabled: true,
        drawerActiveTintColor: dark ? THEME.dark.primary : THEME.light.primary,
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
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const bg = dark ? THEME.dark.background : THEME.light.background;
  // Paint the Android *window* background (DecorView), not just the React
  // root. On edge-to-edge Android the gesture-nav region sits outside the
  // React tree, so a themed window background is what stops the default white
  // `windowBackground` from showing as a strip under the gesture pill.
  // No-op-ish elsewhere (sets the iOS root view colour too).
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(bg).catch(() => {});
  }, [bg]);
  // No <ThemeProvider> here: NativeWind v4 has none, and this Drawer builds
  // its own navigation container. The reusables tokens switch on `.dark:root`,
  // which the store already drives through NativeWind's setColorScheme.
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: bg }}>
      <SafeAreaProvider style={{ backgroundColor: bg }}>
        <View style={{ flex: 1 }}>
          <ThemedStatusBar />
          <SplashGate />
          <BottomSheetModalProvider>
            <ThemedDrawer />
            {/* File links inside markdown preview through this host (a Modal
                can't live inside the <Text> the markdown pipeline builds). */}
            <FilePreviewHost />
            {/* Renders the reusables portal components (Dialog, DropdownMenu,
                Tooltip, ...) on native. Must stay last in the tree. */}
            <PortalHost />
            {/* App-wide toasts (replaces the old Alert.alert error popups). */}
            <ToastHost />
          </BottomSheetModalProvider>
          {/* Overlays every screen, so a dropped socket is visible from chat,
              files or logs alike. Renders null while the connection is ready. */}
          <ConnectionBanner />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
