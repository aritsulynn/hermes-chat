import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Redirect } from 'expo-router';
import {
  AlertCircle,
  ArrowUp,
  Check,
  Code2,
  Copy,
  File,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../../hooks/app-store';
import { base64ToUtf8, errMsg, utf8ToBase64 } from '../../utils/messages';
import { placeholderColor, screenStyle } from '../../theme';
import { HamburgerBtn } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Alert as UIAlert, AlertDescription } from '../../components/ui/alert';
import { Text as UIText } from '../../components/ui/text';
import * as api from '../../services/api';
import { formatBytes } from '../../utils/format';
import { FileRow } from './components/FileRow';
import { isTextReadable, joinPath } from './helpers';
import type { ManagedFileEntry, ManagedFilesResponse, ManagedFileReadResponse } from './types';

export function FilesScreen() {
  const { authed, opsGet, opsMut, theme, getAuthScope } = useApp();
  const dark = theme === 'dark';
  const insets = useSafeAreaInsets();
  // Resolved once per scheme: the list re-renders on every search keystroke
  // and each value below feeds several rows of the (virtualized) tree.
  const screen = useMemo(() => screenStyle(dark), [dark]);
  const placeholder = useMemo(() => placeholderColor(dark, 'file'), [dark]);

  const [currentPath, setCurrentPath] = useState<string>('~');
  const [listing, setListing] = useState<ManagedFilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Jump to Path Modal
  const [pathModalOpen, setPathModalOpen] = useState(false);
  const [pathInput, setPathInput] = useState('~');

  // File Preview / View Modal
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<ManagedFileReadResponse | null>(null);
  const [fileTextContent, setFileTextContent] = useState<string>('');
  const [readingFile, setReadingFile] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);

  // New Folder Modal
  const [newFolderModalOpen, setNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  // New Text File Modal
  const [newFileModalOpen, setNewFileModalOpen] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');
  const [creatingFile, setCreatingFile] = useState(false);

  // Uploading
  const [uploading, setUploading] = useState(false);
  // Debounced search — typing shouldn't refilter + rebuild every row per keystroke.
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    if (authed) return;
    setListing(null);
    setCurrentPath('~');
    setSearchInput('');
    setSelectedFile(null);
    setFileTextContent('');
    setPreviewModalOpen(false);
    setPathModalOpen(false);
    setNewFolderModalOpen(false);
    setNewFileModalOpen(false);
    setNewFolderName('');
    setNewFileName('');
    setNewFileContent('');
    setError(null);
  }, [authed]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchInput.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [searchInput]);
  const searchQuery = searchInput;
  const setSearchQuery = setSearchInput;
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  // Stale-load guard — rapid breadcrumb/up/jump shouldn't let an old listing win.
  const loadSeq = useRef(0);

  const activeDirectory = listing?.path ?? currentPath;
  const currentPathRef = useRef<string>('~');
  const initialLoadedRef = useRef<boolean>(false);

  const load = useCallback(
    async (path?: string, isRefresh = false) => {
      const seq = ++loadSeq.current;
      const scope = getAuthScope();
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const targetPath = (path !== undefined ? path : currentPathRef.current || '~').trim();
        const res = (await opsGet(
          targetPath ? api.files(targetPath) : api.filesRoot(),
        )) as unknown as ManagedFilesResponse;
        if (seq !== loadSeq.current || getAuthScope() !== scope) return;
        setListing(res);
        setCurrentPath(res.path);
        currentPathRef.current = res.path;
        setPathInput(res.path);
      } catch (e) {
        if (seq !== loadSeq.current || getAuthScope() !== scope) return;
        setError(errMsg(e));
      } finally {
        if (seq !== loadSeq.current || getAuthScope() !== scope) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [getAuthScope, opsGet],
  );

  useEffect(() => {
    if (authed && !initialLoadedRef.current) {
      initialLoadedRef.current = true;
      void load('~');
    } else if (!authed) {
      initialLoadedRef.current = false;
    }
  }, [authed, load]);

  const breadcrumbs = useMemo(() => {
    const raw = (activeDirectory || '~').trim();
    if (!raw || raw === '~') return [{ label: '~', path: '~' }];
    const parts = raw.split('/').filter(Boolean);
    const crumbs: { label: string; path: string }[] = [];
    const startsWithTilde = raw.startsWith('~');
    let accum = '';
    crumbs.push({ label: '/', path: '/' });
    for (const part of parts) {
      if (accum === '') {
        accum = startsWithTilde && part === '~' ? '~' : '/' + part;
      } else if (accum === '~') {
        accum = `~/${part}`;
      } else {
        accum += '/' + part;
      }
      crumbs.push({ label: part, path: accum });
    }
    return crumbs;
  }, [activeDirectory]);

  const handleDeleteEntry = useCallback(
    (targetPath: string, isDir: boolean, name: string) => {
      Alert.alert(
        isDir ? 'Delete Folder' : 'Delete File',
        `Are you sure you want to delete "${name}"? This action cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              const scope = getAuthScope();
              try {
                await opsMut(api.filesRoot(), 'DELETE', {
                  path: targetPath,
                  recursive: isDir,
                });
                if (getAuthScope() !== scope) return;
                if (previewModalOpen) {
                  setPreviewModalOpen(false);
                  setSelectedFile(null);
                }
                await load(activeDirectory);
              } catch (e) {
                if (getAuthScope() === scope) Alert.alert('Delete Failed', errMsg(e));
              }
            },
          },
        ],
      );
    },
    [getAuthScope, opsMut, previewModalOpen, load, activeDirectory],
  );

  const handleOpenEntry = useCallback(
    async (entry: ManagedFileEntry) => {
      const scope = getAuthScope();
      if (entry.is_directory) {
        setSearchQuery('');
        await load(entry.path);
      } else {
        setReadingFile(true);
        setError(null);
        try {
          const res = (await opsGet(api.fileRead(entry.path))) as unknown as ManagedFileReadResponse;
          if (getAuthScope() !== scope) return;
          setSelectedFile(res);
          setIsEditingFile(false);
          if (res.data_url && res.data_url.includes(';base64,')) {
            const b64 = res.data_url.split(';base64,')[1];
            setFileTextContent(isTextReadable(res.mime_type, res.name) ? base64ToUtf8(b64) : '');
          } else {
            setFileTextContent('');
          }
          setPreviewModalOpen(true);
        } catch (e) {
          if (getAuthScope() === scope) Alert.alert('Cannot Open File', errMsg(e));
        } finally {
          if (getAuthScope() === scope) setReadingFile(false);
        }
      }
    },
    [getAuthScope, load, opsGet],
  );

  // Stable identity for the FlashList header: `load` and `listing.parent` are
  // the only things `handleGoUp` reads, so depending on it (instead of on a
  // hand-picked subset) is exactly the closure the memoized element needs.
  const handleGoUp = useCallback(async () => {
    if (listing?.parent) {
      setSearchQuery('');
      await load(listing.parent);
    }
  }, [listing?.parent, load, setSearchQuery]);

  const handleJumpToPath = async () => {
    const p = pathInput.trim();
    if (!p) return;
    setPathModalOpen(false);
    setSearchQuery('');
    await load(p);
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const scope = getAuthScope();
    setCreatingFolder(true);
    try {
      const target = joinPath(activeDirectory, name);
      await opsMut(api.filesMkdir(), 'POST', { path: target });
      if (getAuthScope() !== scope) return;
      setNewFolderName('');
      setNewFolderModalOpen(false);
      await load(activeDirectory);
    } catch (e) {
      if (getAuthScope() === scope) Alert.alert('Create Folder Failed', errMsg(e));
    } finally {
      if (getAuthScope() === scope) setCreatingFolder(false);
    }
  };

  const handleCreateFile = async () => {
    const name = newFileName.trim();
    if (!name) return;
    const scope = getAuthScope();
    setCreatingFile(true);
    try {
      const target = joinPath(activeDirectory, name);
      const b64 = utf8ToBase64(newFileContent);
      const dataUrl = `data:text/plain;charset=utf-8;base64,${b64}`;
      await opsMut(api.filesUpload(), 'POST', {
        path: target,
        data_url: dataUrl,
        overwrite: true,
      });
      if (getAuthScope() !== scope) return;
      setNewFileName('');
      setNewFileContent('');
      setNewFileModalOpen(false);
      await load(activeDirectory);
    } catch (e) {
      if (getAuthScope() === scope) Alert.alert('Create File Failed', errMsg(e));
    } finally {
      if (getAuthScope() === scope) setCreatingFile(false);
    }
  };

  const handleSaveEditedFile = async () => {
    if (!selectedFile) return;
    const scope = getAuthScope();
    setSavingFile(true);
    try {
      const b64 = utf8ToBase64(fileTextContent);
      const mime = selectedFile.mime_type || 'text/plain';
      const dataUrl = `data:${mime};charset=utf-8;base64,${b64}`;
      await opsMut(api.filesUpload(), 'POST', {
        path: selectedFile.path,
        data_url: dataUrl,
        overwrite: true,
      });
      if (getAuthScope() !== scope) return;
      setIsEditingFile(false);
      Alert.alert('Saved', 'File saved successfully.');
      await load(activeDirectory);
    } catch (e) {
      if (getAuthScope() === scope) Alert.alert('Save Failed', errMsg(e));
    } finally {
      if (getAuthScope() === scope) setSavingFile(false);
    }
  };

  const handlePickAndUploadImage = async () => {
    const scope = getAuthScope();
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.8,
      });

      if (!res.canceled && res.assets && res.assets[0] && res.assets[0].base64) {
        setUploading(true);
        const asset = res.assets[0];
        const filename = asset.fileName || `photo_${Date.now()}.jpg`;
        const mime = asset.mimeType || 'image/jpeg';
        const target = joinPath(activeDirectory, filename);
        const dataUrl = `data:${mime};base64,${asset.base64}`;

        await opsMut(api.filesUpload(), 'POST', {
          path: target,
          data_url: dataUrl,
          overwrite: true,
        });
        if (getAuthScope() !== scope) return;

        await load(activeDirectory);
      }
    } catch (e) {
      if (getAuthScope() === scope) Alert.alert('Upload Failed', errMsg(e));
    } finally {
      if (getAuthScope() === scope) setUploading(false);
    }
  };

  const handleCopyText = async () => {
    if (!fileTextContent) return;
    await Clipboard.setStringAsync(fileTextContent);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  // Filter entries — single pass for filter + counts.
  const { filteredEntries, folderCount, fileCount } = useMemo(() => {
    const entries = listing?.entries ?? [];
    let folders = 0;
    let files = 0;
    for (const e of entries) {
      if (e.is_directory) folders++;
      else files++;
    }
    if (!debouncedQuery)
      return {
        filteredEntries: entries,
        folderCount: folders,
        fileCount: files,
      };
    const filtered = entries.filter((item) => item.name.toLowerCase().includes(debouncedQuery));
    return {
      filteredEntries: filtered,
      folderCount: folders,
      fileCount: files,
    };
  }, [listing?.entries, debouncedQuery]);

  const handleOpenEntryStable = useCallback(
    (entry: ManagedFileEntry) => {
      void handleOpenEntry(entry);
    },
    [handleOpenEntry],
  );
  const fileKeyExtractor = useCallback((item: ManagedFileEntry) => item.path, []);
  const renderFileRow = useCallback(
    ({ item }: { item: ManagedFileEntry }) => (
      <FileRow entry={item} dark={dark} onOpen={handleOpenEntryStable} onDelete={handleDeleteEntry} />
    ),
    [dark, handleOpenEntryStable, handleDeleteEntry],
  );
  const closePreview = useCallback(() => {
    // Release the base64 payload — keeping data_url retains the whole file in JS memory.
    setPreviewModalOpen(false);
    setSelectedFile(null);
    setFileTextContent('');
    setIsEditingFile(false);
  }, []);

  // Stable list chrome — inline elements would remount header/empty/content on
  // every keystroke. Memoize so typing in search only refilters data.
  const fileListContentStyle = useMemo(
    () => ({
      paddingBottom: insets.bottom + 24,
      flexGrow: 1,
    }),
    [insets.bottom],
  );
  const fileListRefreshControl = useMemo(
    () => <RefreshControl refreshing={refreshing} onRefresh={() => void load(activeDirectory, true)} />,
    [refreshing, load, activeDirectory],
  );
  const fileListHeader = useMemo(
    () =>
      listing?.parent ? (
        <Pressable
          onPress={handleGoUp}
          className="flex-row items-center gap-3 border-b border-neutral-100 px-4 py-3 active:bg-neutral-100 dark:border-neutral-900 dark:active:bg-neutral-900"
        >
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15">
            <ArrowUp size={18} color="#f59e0b" />
          </View>
          <View className="flex-1">
            <Text className="font-mono text-sm font-semibold text-neutral-900 dark:text-neutral-100">..</Text>
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">Parent directory</Text>
          </View>
        </Pressable>
      ) : null,
    [handleGoUp, listing?.parent],
  );
  const fileListEmpty = useMemo(
    () =>
      loading && !refreshing ? (
        <View className="items-center justify-center py-16">
          <ActivityIndicator size="large" color="#1a73e8" />
          <Text className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Loading files...</Text>
        </View>
      ) : !loading ? (
        <View className="items-center justify-center py-20 px-6">
          <View className="h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-900">
            <Folder size={28} color={dark ? '#666' : '#999'} />
          </View>
          <Text className="mt-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {searchInput ? 'No matching files' : 'Folder is empty'}
          </Text>
          <Text className="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
            {searchInput
              ? `No files or folders matching "${searchInput}"`
              : 'Upload files or create folders using the top buttons.'}
          </Text>
        </View>
      ) : null,
    [loading, refreshing, searchInput, dark],
  );

  if (!authed) return <Redirect href="/login" />;

  return (
    <View style={screen}>
      {/* No 'bottom' edge: file list content pads insets.bottom + 24 itself. */}
      <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['left', 'right']}>
        <StatusBar style="auto" />

        {/* Header Bar */}
        <View
          className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-4 dark:border-neutral-800"
          style={{ paddingTop: insets.top + 10 }}
        >
          <View className="flex-row items-center gap-3">
            <HamburgerBtn />
            <View>
              <Text className="text-xl font-bold text-neutral-900 dark:text-white">Files</Text>
              <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                {loading ? 'Loading...' : `${folderCount} folders · ${fileCount} files`}
              </Text>
            </View>
          </View>

          <View className="flex-row items-center gap-1">
            <Pressable
              onPress={() => setNewFolderModalOpen(true)}
              hitSlop={8}
              className="rounded-lg p-2 active:bg-neutral-100 dark:active:bg-neutral-800"
            >
              <FolderPlus size={19} color={dark ? '#e5e5e5' : '#333'} />
            </Pressable>

            <Pressable
              onPress={() => setNewFileModalOpen(true)}
              hitSlop={8}
              className="rounded-lg p-2 active:bg-neutral-100 dark:active:bg-neutral-800"
            >
              <Plus size={19} color={dark ? '#e5e5e5' : '#333'} />
            </Pressable>

            <Pressable
              onPress={handlePickAndUploadImage}
              disabled={uploading}
              hitSlop={8}
              className="rounded-lg p-2 active:bg-neutral-100 dark:active:bg-neutral-800"
            >
              {uploading ? (
                <ActivityIndicator size="small" color="#1a73e8" />
              ) : (
                <Upload size={19} color={dark ? '#e5e5e5' : '#333'} />
              )}
            </Pressable>

            <Pressable
              onPress={() => void load(activeDirectory, true)}
              hitSlop={8}
              className="rounded-lg p-2 active:bg-neutral-100 dark:active:bg-neutral-800"
            >
              <RefreshCw size={18} color={dark ? '#e5e5e5' : '#333'} className={refreshing ? 'animate-spin' : ''} />
            </Pressable>
          </View>
        </View>

        {/* Path Bar & Breadcrumbs */}
        <View className="flex-row items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-900/50">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-1 mr-2"
            contentContainerStyle={{ alignItems: 'center' }}
          >
            <View className="flex-row items-center gap-1">
              <HardDrive size={14} color="#1a73e8" />
              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                return (
                  <View key={crumb.path} className="flex-row items-center">
                    <Pressable
                      disabled={isLast}
                      onPress={() => {
                        setSearchQuery('');
                        void load(crumb.path);
                      }}
                      className={`rounded px-1.5 py-0.5 ${
                        isLast
                          ? 'bg-neutral-200/60 dark:bg-neutral-800'
                          : 'active:bg-neutral-200 dark:active:bg-neutral-800'
                      }`}
                    >
                      <Text
                        numberOfLines={1}
                        className={`font-mono text-xs ${
                          isLast
                            ? 'font-bold text-neutral-900 dark:text-neutral-100'
                            : 'text-[#1a73e8] dark:text-blue-400'
                        }`}
                      >
                        {crumb.label}
                      </Text>
                    </Pressable>
                    {!isLast && <Text className="text-neutral-400 dark:text-neutral-600 text-xs mx-0.5">/</Text>}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <Pressable
            onPress={() => {
              setPathInput(activeDirectory);
              setPathModalOpen(true);
            }}
            className="rounded-md bg-neutral-200/70 px-2 py-1 dark:bg-neutral-800 active:opacity-70"
          >
            <Text className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">Change</Text>
          </Pressable>
        </View>

        {/* Search / Filter Bar */}
        <View className="border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <View className="flex-row items-center gap-2 rounded-xl bg-neutral-100 px-3 py-1.5 dark:bg-neutral-900">
            <Search size={15} color={dark ? '#888' : '#9ca3af'} />
            <Input
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search in this folder..."
              placeholderTextColor={placeholder}
              className="flex-1 text-sm text-neutral-900 dark:text-neutral-100"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <X size={14} color={dark ? '#888' : '#9ca3af'} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Error Alert */}
        {error && (
          <View className="m-3">
            <UIAlert icon={AlertCircle} variant="destructive">
              <AlertDescription className="text-xs text-red-600 dark:text-red-400">{error}</AlertDescription>
              <Button
                variant="destructive"
                size="sm"
                onPress={() => void load(activeDirectory)}
                className="ml-6 mt-1 self-start"
              >
                <UIText className="text-xs font-semibold">Retry</UIText>
              </Button>
            </UIAlert>
          </View>
        )}

        {/* File List — virtualized so large folders don't mount every row. */}
        {/* FlashList v2 sizes rows itself; drawDistance replaces the old
            windowSize/maxToRenderPerBatch overscan tuning. */}
        <FlashList
          style={{ flex: 1 }}
          data={filteredEntries}
          keyExtractor={fileKeyExtractor}
          renderItem={renderFileRow}
          contentContainerStyle={fileListContentStyle}
          refreshControl={fileListRefreshControl}
          drawDistance={800}
          ListHeaderComponent={fileListHeader}
          ListEmptyComponent={fileListEmpty}
        />

        {/* Reading File Overlay */}
        {readingFile && (
          <View className="absolute inset-0 z-50 items-center justify-center bg-black/40">
            <View className="items-center rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900">
              <ActivityIndicator size="large" color="#1a73e8" />
              <Text className="mt-3 text-sm font-medium text-neutral-800 dark:text-neutral-200">Opening file...</Text>
            </View>
          </View>
        )}

        {/* File Preview Modal */}
        <Modal
          visible={previewModalOpen}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={closePreview}
        >
          <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
            <View className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <View className="flex-1 pr-3">
                <Text numberOfLines={1} className="font-mono text-base font-bold text-neutral-900 dark:text-white">
                  {selectedFile?.name}
                </Text>
                <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                  {formatBytes(selectedFile?.size)} · {selectedFile?.mime_type || 'Unknown type'}
                </Text>
              </View>

              <View className="flex-row items-center gap-2">
                {fileTextContent && !isEditingFile ? (
                  <Pressable
                    onPress={handleCopyText}
                    className="flex-row items-center gap-1.5 rounded-lg bg-neutral-100 px-2.5 py-1.5 active:bg-neutral-200 dark:bg-neutral-800 dark:active:bg-neutral-700"
                  >
                    {copied ? (
                      <>
                        <Check size={14} color="#10b981" />
                        <Text className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Copied</Text>
                      </>
                    ) : (
                      <>
                        <Copy size={14} color={dark ? '#ccc' : '#444'} />
                        <Text className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Copy</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}

                {/* Edit Toggle for Text Files */}
                {fileTextContent && !selectedFile?.mime_type?.startsWith('image/') ? (
                  isEditingFile ? (
                    <Pressable
                      onPress={handleSaveEditedFile}
                      disabled={savingFile}
                      className="rounded-lg bg-[#1a73e8] px-3 py-1.5 active:opacity-80"
                    >
                      {savingFile ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text className="text-xs font-bold text-white">Save</Text>
                      )}
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => setIsEditingFile(true)}
                      className="rounded-lg bg-neutral-100 px-2.5 py-1.5 active:bg-neutral-200 dark:bg-neutral-800 dark:active:bg-neutral-700"
                    >
                      <Text className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Edit</Text>
                    </Pressable>
                  )
                ) : null}

                {selectedFile && !isEditingFile ? (
                  <Pressable
                    onPress={() => handleDeleteEntry(selectedFile.path, false, selectedFile.name)}
                    hitSlop={8}
                    className="rounded-lg p-1.5 active:bg-neutral-100 dark:active:bg-neutral-800"
                  >
                    <Trash2 size={18} color="#ef4444" />
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={closePreview}
                  hitSlop={8}
                  className="rounded-lg p-1.5 active:bg-neutral-100 dark:active:bg-neutral-800"
                >
                  <X size={20} color={dark ? '#eee' : '#333'} />
                </Pressable>
              </View>
            </View>

            {/* Preview Content */}
            <View className="flex-1 bg-neutral-50 dark:bg-black">
              {selectedFile?.mime_type?.startsWith('image/') && selectedFile.data_url ? (
                <View className="flex-1 items-center justify-center p-4">
                  <Image source={{ uri: selectedFile.data_url }} resizeMode="contain" className="h-full w-full" />
                </View>
              ) : isEditingFile ? (
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
                  <Textarea
                    value={fileTextContent}
                    onChangeText={setFileTextContent}
                    multiline
                    scrollEnabled
                    autoCapitalize="none"
                    autoCorrect={false}
                    textAlignVertical="top"
                    className="flex-1 p-4 font-mono text-xs leading-5 text-neutral-900 dark:text-neutral-100"
                  />
                </KeyboardAvoidingView>
              ) : fileTextContent ? (
                <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }} horizontal={false}>
                  <ScrollView horizontal showsHorizontalScrollIndicator>
                    <Text selectable className="font-mono text-xs leading-5 text-neutral-900 dark:text-neutral-100">
                      {fileTextContent}
                    </Text>
                  </ScrollView>
                </ScrollView>
              ) : (
                <View className="flex-1 items-center justify-center p-8">
                  <File size={48} color={dark ? '#555' : '#aaa'} />
                  <Text className="mt-4 text-center text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                    Binary or Unsupported File Preview
                  </Text>
                  <Text className="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
                    This file cannot be rendered as text or an image.
                  </Text>
                </View>
              )}
            </View>
          </SafeAreaView>
        </Modal>

        {/* Change / Jump to Path Modal */}
        <Modal visible={pathModalOpen} transparent animationType="none" onRequestClose={() => setPathModalOpen(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            className="flex-1 items-center justify-center bg-black/60 p-4"
          >
            <View className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900">
              <Text className="text-base font-bold text-neutral-900 dark:text-white">Navigate to Directory</Text>
              <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Enter absolute directory path on the server
              </Text>

              <Input
                value={pathInput}
                onChangeText={setPathInput}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={activeDirectory || '~'}
                placeholderTextColor={placeholder}
                className="mt-3.5 rounded-xl border border-neutral-300 p-3 font-mono text-sm text-neutral-900 dark:border-neutral-700 dark:text-white"
              />

              <View className="mt-4 flex-row items-center justify-end gap-2">
                <Pressable
                  onPress={() => setPathModalOpen(false)}
                  className="rounded-xl px-4 py-2.5 active:bg-neutral-100 dark:active:bg-neutral-800"
                >
                  <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Cancel</Text>
                </Pressable>
                <Pressable onPress={handleJumpToPath} className="rounded-xl bg-[#1a73e8] px-5 py-2.5 active:opacity-80">
                  <Text className="text-sm font-bold text-white">Go</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Create Folder Modal */}
        <Modal
          visible={newFolderModalOpen}
          transparent
          animationType="none"
          onRequestClose={() => setNewFolderModalOpen(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            className="flex-1 items-center justify-center bg-black/60 p-4"
          >
            <View className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900">
              <Text className="text-base font-bold text-neutral-900 dark:text-white">New Folder</Text>
              <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Create folder in: {activeDirectory || '~'}
              </Text>

              <Input
                value={newFolderName}
                onChangeText={setNewFolderName}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                placeholder="folder_name"
                placeholderTextColor={placeholder}
                className="mt-3.5 rounded-xl border border-neutral-300 p-3 text-sm text-neutral-900 dark:border-neutral-700 dark:text-white"
              />

              <View className="mt-4 flex-row items-center justify-end gap-2">
                <Pressable
                  onPress={() => {
                    setNewFolderName('');
                    setNewFolderModalOpen(false);
                  }}
                  className="rounded-xl px-4 py-2.5 active:bg-neutral-100 dark:active:bg-neutral-800"
                >
                  <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleCreateFolder}
                  disabled={creatingFolder || !newFolderName.trim()}
                  className={`rounded-xl bg-[#1a73e8] px-5 py-2.5 active:opacity-80 ${
                    !newFolderName.trim() ? 'opacity-50' : ''
                  }`}
                >
                  {creatingFolder ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-sm font-bold text-white">Create</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Create New File Modal */}
        <Modal
          visible={newFileModalOpen}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setNewFileModalOpen(false)}
        >
          <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
            <View className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <View>
                <Text className="text-base font-bold text-neutral-900 dark:text-white">Create New File</Text>
                <Text className="text-xs text-neutral-500 dark:text-neutral-400">in {activeDirectory || '~'}</Text>
              </View>

              <View className="flex-row items-center gap-2">
                <Pressable
                  onPress={() => setNewFileModalOpen(false)}
                  className="rounded-lg px-3 py-1.5 active:bg-neutral-100 dark:active:bg-neutral-800"
                >
                  <Text className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Cancel</Text>
                </Pressable>

                <Pressable
                  onPress={handleCreateFile}
                  disabled={creatingFile || !newFileName.trim()}
                  className={`rounded-lg bg-[#1a73e8] px-3.5 py-1.5 active:opacity-80 ${
                    !newFileName.trim() ? 'opacity-50' : ''
                  }`}
                >
                  {creatingFile ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text className="text-xs font-bold text-white">Save File</Text>
                  )}
                </Pressable>
              </View>
            </View>

            <View className="p-3 border-b border-neutral-200 dark:border-neutral-800">
              <Text className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                File Name (e.g. notes.txt, script.py, config.json)
              </Text>
              <Input
                value={newFileName}
                onChangeText={setNewFileName}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                placeholder="filename.txt"
                placeholderTextColor={placeholder}
                className="rounded-xl border border-neutral-300 dark:border-neutral-700 p-2.5 font-mono text-sm text-neutral-900 dark:text-white"
              />
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1 p-3">
              <Text className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">File Content</Text>
              <Textarea
                value={newFileContent}
                onChangeText={setNewFileContent}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                textAlignVertical="top"
                placeholder="Enter text or code here..."
                placeholderTextColor={placeholder}
                className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 p-3 font-mono text-xs leading-5 text-neutral-900 dark:text-neutral-100"
              />
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </View>
  );
}
