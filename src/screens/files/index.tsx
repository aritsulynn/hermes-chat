import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronRight,
  Code2,
  Copy,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Music,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { HamburgerBtn } from '../../components';

export interface ManagedFileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number | null;
  mtime: number;
  mime_type: string | null;
}

export interface ManagedFilesResponse {
  root: string | null;
  path: string;
  parent: string | null;
  locked_root: string | null;
  can_change_path: boolean;
  entries: ManagedFileEntry[];
}

export interface ManagedFileReadResponse {
  name: string;
  path: string;
  size: number;
  mime_type: string;
  data_url: string;
  root: string | null;
  locked_root: string | null;
  can_change_path: boolean;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(mtime: number): string {
  if (!Number.isFinite(mtime) || mtime <= 0) return '-';
  const d = new Date(mtime * 1000);
  const now = new Date();
  const isThisYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(isThisYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getFileCategory(name: string, mime?: string | null): {
  icon: typeof File;
  color: string;
  bgColor: string;
  isImage: boolean;
  isText: boolean;
} {
  const lower = name.toLowerCase();
  const ext = lower.split('.').pop() || '';

  if (
    mime?.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)
  ) {
    return { icon: FileImage, color: '#10b981', bgColor: '#10b98118', isImage: true, isText: false };
  }
  if (
    ['js', 'jsx', 'ts', 'tsx', 'py', 'json', 'html', 'css', 'scss', 'sh', 'bash', 'yml', 'yaml', 'toml', 'sql', 'rs', 'go', 'c', 'cpp', 'java', 'kt'].includes(ext)
  ) {
    return { icon: FileCode, color: '#3b82f6', bgColor: '#3b82f618', isImage: false, isText: true };
  }
  if (
    mime?.startsWith('video/') ||
    ['mp4', 'mov', 'mkv', 'webm', 'avi'].includes(ext)
  ) {
    return { icon: Video, color: '#f59e0b', bgColor: '#f59e0b18', isImage: false, isText: false };
  }
  if (
    mime?.startsWith('audio/') ||
    ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)
  ) {
    return { icon: Music, color: '#8b5cf6', bgColor: '#8b5cf618', isImage: false, isText: false };
  }
  if (
    ['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz'].includes(ext)
  ) {
    return { icon: FileArchive, color: '#ec4899', bgColor: '#ec489918', isImage: false, isText: false };
  }
  if (
    mime?.startsWith('text/') ||
    ['txt', 'md', 'log', 'env', 'csv', 'tsv', 'xml', 'conf', 'ini', 'cfg'].includes(ext)
  ) {
    return { icon: FileText, color: '#6366f1', bgColor: '#6366f118', isImage: false, isText: true };
  }
  return { icon: File, color: '#6b7280', bgColor: '#6b728018', isImage: false, isText: false };
}

function base64ToUtf8(base64: string): string {
  try {
    if (typeof atob === 'function') {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder('utf-8').decode(bytes);
    }
  } catch {}
  return '';
}

function utf8ToBase64(text: string): string {
  try {
    if (typeof btoa === 'function') {
      const bytes = new TextEncoder().encode(text);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
  } catch {}
  return '';
}

function joinPath(dir: string, name: string): string {
  if (!dir || dir === '/') return `/${name}`;
  return `${dir.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`;
}

export function FilesScreen() {
  const { authed, opsGet, opsMut, theme } = useApp();
  const dark = theme === 'dark';
  const insets = useSafeAreaInsets();

  const [currentPath, setCurrentPath] = useState<string>('~');
  const [listing, setListing] = useState<ManagedFilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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

  const activeDirectory = listing?.path ?? currentPath;
  const currentPathRef = useRef<string>('~');
  const initialLoadedRef = useRef<boolean>(false);

  const load = useCallback(
    async (path?: string, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const targetPath = (path !== undefined ? path : currentPathRef.current || '~').trim();
        const query = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
        const res: ManagedFilesResponse = await opsGet(`/api/files${query}`);
        setListing(res);
        setCurrentPath(res.path);
        currentPathRef.current = res.path;
        setPathInput(res.path);
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [opsGet],
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
    let accum = '';
    crumbs.push({ label: '/', path: '/' });
    for (const part of parts) {
      accum += '/' + part;
      crumbs.push({ label: part, path: accum });
    }
    return crumbs;
  }, [activeDirectory]);

  const handleDeleteEntry = (targetPath: string, isDir: boolean, name: string) => {
    Alert.alert(
      isDir ? 'Delete Folder' : 'Delete File',
      `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await opsMut('/api/files', 'DELETE', { path: targetPath, recursive: isDir });
              if (previewModalOpen) {
                setPreviewModalOpen(false);
                setSelectedFile(null);
              }
              await load(activeDirectory);
            } catch (e) {
              Alert.alert('Delete Failed', errMsg(e));
            }
          },
        },
      ],
    );
  };

  const handleOpenEntry = async (entry: ManagedFileEntry) => {
    if (entry.is_directory) {
      setSearchQuery('');
      await load(entry.path);
    } else {
      setReadingFile(true);
      setError(null);
      try {
        const res: ManagedFileReadResponse = await opsGet(
          `/api/files/read?path=${encodeURIComponent(entry.path)}`,
        );
        setSelectedFile(res);
        setIsEditingFile(false);
        if (res.data_url && res.data_url.includes(';base64,')) {
          const b64 = res.data_url.split(';base64,')[1];
          setFileTextContent(base64ToUtf8(b64));
        } else {
          setFileTextContent('');
        }
        setPreviewModalOpen(true);
      } catch (e) {
        Alert.alert('Cannot Open File', errMsg(e));
      } finally {
        setReadingFile(false);
      }
    }
  };

  const handleGoUp = async () => {
    if (listing?.parent) {
      setSearchQuery('');
      await load(listing.parent);
    }
  };

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
    setCreatingFolder(true);
    try {
      const target = joinPath(activeDirectory, name);
      await opsMut('/api/files/mkdir', 'POST', { path: target });
      setNewFolderName('');
      setNewFolderModalOpen(false);
      await load(activeDirectory);
    } catch (e) {
      Alert.alert('Create Folder Failed', errMsg(e));
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleCreateFile = async () => {
    const name = newFileName.trim();
    if (!name) return;
    setCreatingFile(true);
    try {
      const target = joinPath(activeDirectory, name);
      const b64 = utf8ToBase64(newFileContent);
      const dataUrl = `data:text/plain;charset=utf-8;base64,${b64}`;
      await opsMut('/api/files/upload', 'POST', {
        path: target,
        data_url: dataUrl,
        overwrite: true,
      });
      setNewFileName('');
      setNewFileContent('');
      setNewFileModalOpen(false);
      await load(activeDirectory);
    } catch (e) {
      Alert.alert('Create File Failed', errMsg(e));
    } finally {
      setCreatingFile(false);
    }
  };

  const handleSaveEditedFile = async () => {
    if (!selectedFile) return;
    setSavingFile(true);
    try {
      const b64 = utf8ToBase64(fileTextContent);
      const mime = selectedFile.mime_type || 'text/plain';
      const dataUrl = `data:${mime};charset=utf-8;base64,${b64}`;
      await opsMut('/api/files/upload', 'POST', {
        path: selectedFile.path,
        data_url: dataUrl,
        overwrite: true,
      });
      setIsEditingFile(false);
      Alert.alert('Saved', 'File saved successfully.');
      await load(activeDirectory);
    } catch (e) {
      Alert.alert('Save Failed', errMsg(e));
    } finally {
      setSavingFile(false);
    }
  };


  const handlePickAndUploadImage = async () => {
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

        await opsMut('/api/files/upload', 'POST', {
          path: target,
          data_url: dataUrl,
          overwrite: true,
        });

        await load(activeDirectory);
      }
    } catch (e) {
      Alert.alert('Upload Failed', errMsg(e));
    } finally {
      setUploading(false);
    }
  };

  const handleCopyText = async () => {
    if (!fileTextContent) return;
    await Clipboard.setStringAsync(fileTextContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Filter entries
  const filteredEntries = useMemo(() => {
    if (!listing?.entries) return [];
    if (!searchQuery.trim()) return listing.entries;
    const q = searchQuery.trim().toLowerCase();
    return listing.entries.filter((item) => item.name.toLowerCase().includes(q));
  }, [listing?.entries, searchQuery]);

  const folderCount = useMemo(
    () => (listing?.entries || []).filter((e) => e.is_directory).length,
    [listing?.entries],
  );
  const fileCount = useMemo(
    () => (listing?.entries || []).filter((e) => !e.is_directory).length,
    [listing?.entries],
  );

  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#000' : '#fff' }}>
    <SafeAreaView className="flex-1 bg-white dark:bg-black" edges={['left', 'right', 'bottom']}>
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
              {loading
                ? 'Loading...'
                : `${folderCount} folders · ${fileCount} files`}
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
            <RefreshCw
              size={18}
              color={dark ? '#e5e5e5' : '#333'}
              className={refreshing ? 'animate-spin' : ''}
            />
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
                  {!isLast && (
                    <Text className="text-neutral-400 dark:text-neutral-600 text-xs mx-0.5">/</Text>
                  )}
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
          <Text className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
            Change
          </Text>
        </Pressable>
      </View>

      {/* Search / Filter Bar */}
      <View className="border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <View className="flex-row items-center gap-2 rounded-xl bg-neutral-100 px-3 py-1.5 dark:bg-neutral-900">
          <Search size={15} color={dark ? '#888' : '#9ca3af'} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search in this folder..."
            placeholderTextColor={dark ? '#777' : '#9ca3af'}
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
        <View className="m-3 flex-row items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-950 dark:bg-red-950/30">
          <AlertCircle size={17} color="#dc2626" />
          <Text className="flex-1 text-xs text-red-600 dark:text-red-400">{error}</Text>
          <Pressable onPress={() => void load(activeDirectory)}>
            <Text className="text-xs font-semibold text-red-700 dark:text-red-300">Retry</Text>
          </Pressable>
        </View>
      )}

      {/* File List */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(activeDirectory, true)}
          />
        }
      >
        {/* Parent Directory Link (..) */}
        {listing?.parent && (
          <Pressable
            onPress={handleGoUp}
            className="flex-row items-center gap-3 border-b border-neutral-100 px-4 py-3 active:bg-neutral-100 dark:border-neutral-900 dark:active:bg-neutral-900"
          >
            <View className="h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15">
              <ArrowUp size={18} color="#f59e0b" />
            </View>
            <View className="flex-1">
              <Text className="font-mono text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                ..
              </Text>
              <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                Parent directory
              </Text>
            </View>
          </Pressable>
        )}

        {/* Loading Spinner */}
        {loading && !refreshing && (
          <View className="items-center justify-center py-16">
            <ActivityIndicator size="large" color="#1a73e8" />
            <Text className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
              Loading files...
            </Text>
          </View>
        )}

        {/* Empty State */}
        {!loading && filteredEntries.length === 0 && (
          <View className="items-center justify-center py-20 px-6">
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-900">
              <Folder size={28} color={dark ? '#666' : '#999'} />
            </View>
            <Text className="mt-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {searchQuery ? 'No matching files' : 'Folder is empty'}
            </Text>
            <Text className="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
              {searchQuery
                ? `No files or folders matching "${searchQuery}"`
                : 'Upload files or create folders using the top buttons.'}
            </Text>
          </View>
        )}

        {/* Items */}
        {!loading &&
          filteredEntries.map((entry) => {
            const isDir = entry.is_directory;
            const category = getFileCategory(entry.name, entry.mime_type);
            const Icon = isDir ? Folder : category.icon;
            const iconColor = isDir ? '#f59e0b' : category.color;
            const iconBg = isDir ? '#f59e0b18' : category.bgColor;

            return (
              <Pressable
                key={entry.path}
                onPress={() => void handleOpenEntry(entry)}
                onLongPress={() => handleDeleteEntry(entry.path, entry.is_directory, entry.name)}
                className="flex-row items-center gap-3 border-b border-neutral-100 px-4 py-2.5 active:bg-neutral-100 dark:border-neutral-900 dark:active:bg-neutral-900"
              >
                {/* Icon */}
                <View
                  className="h-10 w-10 items-center justify-center rounded-xl"
                  style={{ backgroundColor: iconBg }}
                >
                  <Icon size={20} color={iconColor} />
                </View>

                {/* Details */}
                <View className="flex-1 justify-center">
                  <Text
                    numberOfLines={1}
                    className="font-mono text-sm font-medium text-neutral-900 dark:text-neutral-100"
                  >
                    {entry.name}
                  </Text>
                  <View className="mt-0.5 flex-row items-center gap-2">
                    <Text className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      {isDir ? 'Folder' : formatBytes(entry.size)}
                    </Text>
                    <Text className="text-[11px] text-neutral-400 dark:text-neutral-600">·</Text>
                    <Text className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      {formatDate(entry.mtime)}
                    </Text>
                  </View>
                </View>

                {/* Actions */}
                {isDir ? (
                  <ChevronRight size={17} color={dark ? '#666' : '#aaa'} />
                ) : null}
              </Pressable>
            );
          })}
      </ScrollView>

      {/* Reading File Overlay */}
      {readingFile && (
        <View className="absolute inset-0 z-50 items-center justify-center bg-black/40">
          <View className="items-center rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900">
            <ActivityIndicator size="large" color="#1a73e8" />
            <Text className="mt-3 text-sm font-medium text-neutral-800 dark:text-neutral-200">
              Opening file...
            </Text>
          </View>
        </View>
      )}

      {/* File Preview Modal */}
      <Modal
        visible={previewModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPreviewModalOpen(false)}
      >
        <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
          <View className="flex-row items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <View className="flex-1 pr-3">
              <Text
                numberOfLines={1}
                className="font-mono text-base font-bold text-neutral-900 dark:text-white"
              >
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
                      <Text className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        Copied
                      </Text>
                    </>
                  ) : (
                    <>
                      <Copy size={14} color={dark ? '#ccc' : '#444'} />
                      <Text className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        Copy
                      </Text>
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
                    <Text className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                      Edit
                    </Text>
                  </Pressable>
                )
              ) : null}

              {selectedFile && !isEditingFile ? (
                <Pressable
                  onPress={() =>
                    handleDeleteEntry(selectedFile.path, false, selectedFile.name)
                  }
                  hitSlop={8}
                  className="rounded-lg p-1.5 active:bg-neutral-100 dark:active:bg-neutral-800"
                >
                  <Trash2 size={18} color="#ef4444" />
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => {
                  setPreviewModalOpen(false);
                  setIsEditingFile(false);
                }}
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
                <Image
                  source={{ uri: selectedFile.data_url }}
                  resizeMode="contain"
                  className="h-full w-full"
                />
              </View>
            ) : isEditingFile ? (
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                className="flex-1"
              >
                <TextInput
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
              <ScrollView
                className="flex-1"
                contentContainerStyle={{ padding: 16 }}
                horizontal={false}
              >
                <ScrollView horizontal showsHorizontalScrollIndicator>
                  <Text
                    selectable
                    className="font-mono text-xs leading-5 text-neutral-900 dark:text-neutral-100"
                  >
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
      <Modal
        visible={pathModalOpen}
        transparent
        animationType="none"
        onRequestClose={() => setPathModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1 items-center justify-center bg-black/60 p-4"
        >
          <View className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900">
            <Text className="text-base font-bold text-neutral-900 dark:text-white">
              Navigate to Directory
            </Text>
            <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Enter absolute directory path on the server
            </Text>

            <TextInput
              value={pathInput}
              onChangeText={setPathInput}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={activeDirectory || '~'}
              placeholderTextColor={dark ? '#777' : '#9ca3af'}
              className="mt-3.5 rounded-xl border border-neutral-300 p-3 font-mono text-sm text-neutral-900 dark:border-neutral-700 dark:text-white"
            />

            <View className="mt-4 flex-row items-center justify-end gap-2">
              <Pressable
                onPress={() => setPathModalOpen(false)}
                className="rounded-xl px-4 py-2.5 active:bg-neutral-100 dark:active:bg-neutral-800"
              >
                <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleJumpToPath}
                className="rounded-xl bg-[#1a73e8] px-5 py-2.5 active:opacity-80"
              >
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
            <Text className="text-base font-bold text-neutral-900 dark:text-white">
              New Folder
            </Text>
            <Text className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Create folder in: {activeDirectory || '~'}
            </Text>

            <TextInput
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              placeholder="folder_name"
              placeholderTextColor={dark ? '#777' : '#9ca3af'}
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
                <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  Cancel
                </Text>
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
              <Text className="text-base font-bold text-neutral-900 dark:text-white">
                Create New File
              </Text>
              <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                in {activeDirectory || '~'}
              </Text>
            </View>

            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => setNewFileModalOpen(false)}
                className="rounded-lg px-3 py-1.5 active:bg-neutral-100 dark:active:bg-neutral-800"
              >
                <Text className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  Cancel
                </Text>
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
            <TextInput
              value={newFileName}
              onChangeText={setNewFileName}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              placeholder="filename.txt"
              placeholderTextColor={dark ? '#777' : '#9ca3af'}
              className="rounded-xl border border-neutral-300 dark:border-neutral-700 p-2.5 font-mono text-sm text-neutral-900 dark:text-white"
            />
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            className="flex-1 p-3"
          >
            <Text className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
              File Content
            </Text>
            <TextInput
              value={newFileContent}
              onChangeText={setNewFileContent}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              textAlignVertical="top"
              placeholder="Enter text or code here..."
              placeholderTextColor={dark ? '#777' : '#9ca3af'}
              className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 p-3 font-mono text-xs leading-5 text-neutral-900 dark:text-neutral-100"
            />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
    </View>
  );
}
