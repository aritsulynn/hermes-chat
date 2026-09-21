// Sessions route — session list + new session (was the 'sessions' screen).
// Header (title + hamburger) comes from the native Drawer navigator;
// edge-swipe opens the drawer, so the old EdgeSwipe strip is gone.
import { useEffect } from 'react';
import { Redirect, useNavigation } from 'expo-router';
import { ActivityIndicator, FlatList, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Plus } from 'lucide-react-native';
import { useApp } from '../src/store';
import { styles } from '../src/ui';

export default function SessionsScreen() {
  const { booting, authed, sessions, openingId, busy, error, openSession, newSession } = useApp();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  // Compact native header on Android (64→52 content) — closer to the old
  // slim header; iOS is already 44. Total height must include the live
  // status-bar inset, so it is set at runtime, not in _layout options.
  useEffect(() => {
    if (Platform.OS === 'android') {
      navigation.setOptions({ headerStyle: { height: insets.top + 52 } });
    }
  }, [navigation, insets.top]);

  if (booting) {
    return (
      <SafeAreaView style={[styles.root, styles.boot]} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="auto" />
        <ActivityIndicator size="large" />
        <Text style={styles.sub}>connecting…</Text>
      </SafeAreaView>
    );
  }
  if (!authed) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right', 'bottom']}>
      <StatusBar style="auto" />
      {error && <Text style={[styles.err, styles.pad]}>{error}</Text>}
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.listPad}
        renderItem={({ item }) => {
          const opening = openingId === item.id;
          return (
            <Pressable
              onPress={() => void openSession(item)}
              style={styles.sessCard}
              disabled={openingId !== null}
            >
              <View style={styles.sessRow}>
                <View style={styles.flex}>
                  <Text style={styles.sessTitle} numberOfLines={1}>
                    {item.title || '(untitled)'}
                  </Text>
                  <Text style={styles.sessMeta} numberOfLines={1}>
                    {item.source} · {item.messageCount} msgs
                  </Text>
                  {!!item.preview && (
                    <Text style={styles.sessPrev} numberOfLines={2}>
                      {item.preview}
                    </Text>
                  )}
                </View>
                {opening && <ActivityIndicator />}
              </View>
            </Pressable>
          );
        }}
      />
      <View style={styles.pad}>
        <Pressable onPress={() => void newSession()} style={styles.primary} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.titleRow}>
              <Plus size={16} color="#fff" />
              <Text style={styles.primaryText}>New session</Text>
            </View>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
