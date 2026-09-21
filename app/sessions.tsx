// Sessions route — session list + new session (was the 'sessions' screen).
// Header (title + hamburger) comes from the native Drawer navigator;
// edge-swipe opens the drawer, so the old EdgeSwipe strip is gone.
import { useEffect, useState } from 'react';
import { Redirect, useNavigation } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { History, Pencil, Plus, Trash2 } from 'lucide-react-native';
import { useApp } from '../src/store';
import { HamburgerBtn } from '../src/ui';

export default function SessionsScreen() {
  const {
    booting,
    authed,
    sessions,
    openingId,
    busy,
    error,
    openSession,
    newSession,
    refreshSessions,
    deleteSessionById,
    jumpToRecent,
    getGw,
    theme,
  } = useApp();
  const dark = theme === 'dark';
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  // Compact native header on Android (64→52 content) — closer to the old
  // slim header; iOS is already 44. Total height must include the live
  // status-bar inset, so it is set at runtime, not in _layout options.
  useEffect(() => {
    (navigation as any).setOptions?.({
      headerLeft: () => <HamburgerBtn />,
      ...(Platform.OS === 'android'
        ? { headerStyle: { height: insets.top + 52, backgroundColor: dark ? '#000' : '#fff' } }
        : null),
      headerTintColor: dark ? '#f5f5f5' : '#111',
    });
  }, [navigation, insets.top, dark]);

  if (booting) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-black items-center justify-center gap-3" edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="auto" />
        <ActivityIndicator size="large" />
        <Text className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">connecting…</Text>
      </SafeAreaView>
    );
  }
  if (!authed) return <Redirect href="/login" />;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sessions.filter(
        (s) =>
          (s.title || '').toLowerCase().includes(q) ||
          (s.preview || '').toLowerCase().includes(q) ||
          (s.source || '').toLowerCase().includes(q),
      )
    : sessions;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshSessions();
    } finally {
      setRefreshing(false);
    }
  };

  const confirmDelete = (id: string, title: string) => {
    Alert.alert('Delete session?', `"${title || '(untitled)'}" จะหายถาวร`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteSessionById(id) },
    ]);
  };

  const submitRename = async (id: string) => {
    const t = renameText.trim();
    if (!t) {
      setRenamingId(null);
      return;
    }
    try {
      await getGw()?.rename(id, t);
    } catch {}
    setRenamingId(null);
    void refreshSessions();
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['left', 'right', 'bottom']}>
      <StatusBar style="auto" />
      {error && <Text className="p-3.5 text-[#c5221f] dark:text-[#ff7b72]">{error}</Text>}
      <View className="flex-row gap-2 p-3.5 pb-1">
        <TextInput
          className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm text-neutral-950 dark:text-neutral-100"
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${sessions.length} sessions…`}
          placeholderTextColor={dark ? '#888' : '#9ca3af'}
          keyboardAppearance={dark ? 'dark' : 'light'}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable onPress={() => void jumpToRecent()} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5" hitSlop={8} disabled={busy}>
          <View className="flex-row items-center gap-2">
            <History size={14} color={dark ? '#f5f5f5' : '#111'} />
            <Text className="dark:text-neutral-100">Recent</Text>
          </View>
        </Pressable>
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        ListEmptyComponent={<Text className="mb-4 p-3.5 text-sm text-neutral-500 dark:text-neutral-400">{q ? 'no matches' : 'no sessions yet'}</Text>}
        renderItem={({ item }) => {
          const opening = openingId === item.id;
          const renaming = renamingId === item.id;
          return (
            <Pressable
              onPress={() => void openSession(item)}
              className="rounded-xl border border-[#e3e3e6] dark:border-neutral-800 p-3"
              disabled={openingId !== null || renaming}
            >
              <View className="flex-row items-center gap-2.5">
                <View className="flex-1">
                  {renaming ? (
                    <TextInput
                      className="rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm text-neutral-950 dark:text-neutral-100"
                      value={renameText}
                      onChangeText={setRenameText}
                      autoFocus
                      onSubmitEditing={() => void submitRename(item.id)}
                      keyboardAppearance={dark ? 'dark' : 'light'}
                      placeholder="New title…"
                      placeholderTextColor={dark ? '#888' : '#9ca3af'}
                    />
                  ) : (
                    <Text className="text-[15px] font-semibold text-neutral-950 dark:text-neutral-100" numberOfLines={1}>
                      {item.title || '(untitled)'}
                    </Text>
                  )}
                  <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
                    {item.source} · {item.messageCount} msgs
                  </Text>
                  {!!item.preview && (
                    <Text className="mt-1 text-[13px] text-neutral-600 dark:text-neutral-400" numberOfLines={2}>
                      {item.preview}
                    </Text>
                  )}
                </View>
                {opening && <ActivityIndicator />}
              </View>
              <View className="mt-2 flex-row gap-2">
                {renaming ? (
                  <>
                    <Pressable onPress={() => void submitRename(item.id)} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5">
                      <Text className="dark:text-neutral-100">Save</Text>
                    </Pressable>
                    <Pressable onPress={() => setRenamingId(null)} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5">
                      <Text className="dark:text-neutral-100">Cancel</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable
                      onPress={() => {
                        setRenamingId(item.id);
                        setRenameText(item.title || '');
                      }}
                      className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5"
                      hitSlop={8}
                    >
                      <View className="flex-row items-center gap-2">
                        <Pencil size={13} color={dark ? '#a3a3a3' : '#333'} />
                        <Text className="dark:text-neutral-100">Rename</Text>
                      </View>
                    </Pressable>
                    <Pressable onPress={() => confirmDelete(item.id, item.title)} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5" hitSlop={8}>
                      <View className="flex-row items-center gap-2">
                        <Trash2 size={13} color="#c5221f" />
                        <Text className="text-[#c5221f] dark:text-[#ff7b72]">Delete</Text>
                      </View>
                    </Pressable>
                  </>
                )}
              </View>
            </Pressable>
          );
        }}
      />
      <View className="p-3.5">
        <Pressable onPress={() => void newSession()} className="mt-2 items-center rounded-lg bg-[#1a73e8] px-[18px] py-[11px]" disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View className="flex-row items-center gap-2">
              <Plus size={16} color="#fff" />
              <Text className="text-[15px] font-semibold text-white">New session</Text>
            </View>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
