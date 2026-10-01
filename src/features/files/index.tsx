import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUp,
  Check,
  Copy,
  File,
  Folder,
  FolderPlus,
  HardDrive,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { pickFile } from '../../services/file-picker';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { base64ToUtf8, errMsg, utf8ToBase64 } from '../../utils/messages';
import { screenStyle } from '../../theme';
import { ScreenHeader } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Alert as UIAlert, AlertDescription } from '../../components/ui/alert';
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogPortal,
  DialogTitle,
} from '../../components/ui/dialog';
import { toast } from '../../components/ui/toast';
import { Spinner } from '../../components/ui/bits';
import * as api from '../../services/api';
import { formatBytes } from '../../utils/format';
import { FileRow } from './components/FileRow';
import { isTextReadable, joinPath } from './helpers';
import type { ManagedFileEntry, ManagedFilesResponse, ManagedFileReadResponse } from './types';
import { writeClipboard } from '../../services/clipboard';

export function FilesScreen() {
  const { authed, opsGet, opsMut, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  // Resolved once per scheme: the list re-renders on every search keystroke
  // and each value below feeds several rows of the (virtualized) tree.
  const screen = useMemo(() => screenStyle(dark), [dark]);

  const [currentPath, setCurrentPath] = useState<string>('~');
  const [listing, setListing] = useState<ManagedFilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Themed replacement for the old Alert.alert delete confirm.
  const [confirmDelete, setConfirmDelete] = useState<{ title: string; body: string; run: () => void } | null>(null);

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
        // No `return` in a finally: it would swallow the try's outcome. Guard
        // the two writes instead.
        if (seq === loadSeq.current && getAuthScope() === scope) {
          setLoading(false);
          setRefreshing(false);
        }
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
      setConfirmDelete({
        title: isDir ? 'Delete Folder' : 'Delete File',
        body: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
        run: async () => {
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
            if (getAuthScope() === scope)
              toast({ title: 'Delete Failed', description: errMsg(e), variant: 'destructive' });
          }
        },
      });
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
          if (getAuthScope() === scope)
            toast({ title: 'Cannot Open File', description: errMsg(e), variant: 'destructive' });
        } finally {
          if (getAuthScope() === scope) setReadingFile(false);
        }
      }
    },
    [getAuthScope, load, opsGet],
  );

  // Stable identity for the list header: `load` and `listing.parent` are
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
      if (getAuthScope() === scope)
        toast({ title: 'Create Folder Failed', description: errMsg(e), variant: 'destructive' });
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
      if (getAuthScope() === scope)
        toast({ title: 'Create File Failed', description: errMsg(e), variant: 'destructive' });
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
      toast({ title: 'Saved', description: 'File saved successfully.', variant: 'success' });
      await load(activeDirectory);
    } catch (e) {
      if (getAuthScope() === scope) toast({ title: 'Save Failed', description: errMsg(e), variant: 'destructive' });
    } finally {
      if (getAuthScope() === scope) setSavingFile(false);
    }
  };

  const handlePickAndUploadImage = async () => {
    const scope = getAuthScope();
    try {
      const asset = await pickFile({ accept: 'image/*' });
      if (asset) {
        setUploading(true);
        const filename = asset.name || `photo_${Date.now()}.jpg`;
        const target = joinPath(activeDirectory, filename);
        const dataUrl = asset.dataUrl;

        await opsMut(api.filesUpload(), 'POST', {
          path: target,
          data_url: dataUrl,
          overwrite: true,
        });
        if (getAuthScope() !== scope) return;

        await load(activeDirectory);
      }
    } catch (e) {
      if (getAuthScope() === scope) toast({ title: 'Upload Failed', description: errMsg(e), variant: 'destructive' });
    } finally {
      if (getAuthScope() === scope) setUploading(false);
    }
  };

  const handleCopyText = async () => {
    if (!fileTextContent) return;
    await writeClipboard(fileTextContent);
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
  const closePreview = useCallback(() => {
    // Release the base64 payload — keeping data_url retains the whole file in JS memory.
    setPreviewModalOpen(false);
    setSelectedFile(null);
    setFileTextContent('');
    setIsEditingFile(false);
  }, []);

  // The scroller is its own box now, so the content is just padding. The
  // bottom pad clears the home indicator, which the browser reports via env().
  const fileListContentClass = 'pb-[calc(env(safe-area-inset-bottom,0px)+24px)] grow';
  const fileListHeader = useMemo(
    () =>
      listing?.parent ? (
        <Button
          variant="ghost"
          onClick={handleGoUp}
          aria-label="Parent directory"
          className="h-auto sm:h-auto w-full justify-start gap-3 border-b border-neutral-100 px-4 py-3 active:bg-neutral-100 dark:border-neutral-900 dark:active:bg-neutral-900">
          <div className="flex flex-col h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15">
            <ArrowUp size={18} color="#f59e0b" />
          </div>
          <div className="flex flex-col flex-1 items-start">
            <div className="font-mono text-sm font-semibold text-neutral-900 dark:text-neutral-100">..</div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">Parent directory</div>
          </div>
        </Button>
      ) : null,
    [handleGoUp, listing?.parent],
  );
  const fileListEmpty = useMemo(
    () =>
      loading && !refreshing ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Spinner size={24} color="#1a73e8" />
          <div className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Loading files...</div>
        </div>
      ) : !loading ? (
        <div className="flex flex-col items-center justify-center py-20 px-6">
          <div className="flex flex-col h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-900">
            <Folder size={28} color={dark ? '#666' : '#999'} />
          </div>
          <div className="mt-3 text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {searchInput ? 'No matching files' : 'Folder is empty'}
          </div>
          <div className="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
            {searchInput
              ? `No files or folders matching "${searchInput}"`
              : 'Upload files or create folders using the top buttons.'}
          </div>
        </div>
      ) : null,
    [loading, refreshing, searchInput, dark],
  );

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screen}>
      {/* No 'bottom' edge: file list content pads insets.bottom + 24 itself. */}
      <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-black">
        {/* Header Bar */}
        <ScreenHeader
          title="Files"

          subtitle={loading ? 'Loading...' : `${folderCount} folders · ${fileCount} files`}
          actions={
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                aria-label="New folder"
                onClick={() => setNewFolderModalOpen(true)}
                className="h-9 w-9 rounded-lg">
                <FolderPlus size={19} color={dark ? '#e5e5e5' : '#333'} />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                aria-label="New file"
                onClick={() => setNewFileModalOpen(true)}
                className="h-9 w-9 rounded-lg">
                <Plus size={19} color={dark ? '#e5e5e5' : '#333'} />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                aria-label="Upload image"
                onClick={handlePickAndUploadImage}
                disabled={uploading}
                className="h-9 w-9 rounded-lg">
                {uploading ? (
                  <Spinner size={14} color="#1a73e8" />
                ) : (
                  <Upload size={19} color={dark ? '#e5e5e5' : '#333'} />
                )}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh"
                onClick={() => void load(activeDirectory, true)}
                className="h-9 w-9 rounded-lg">
                <RefreshCw size={18} color={dark ? '#e5e5e5' : '#333'} className={refreshing ? 'animate-spin' : ''} />
              </Button>
            </div>
          }
        />

        {/* Path Bar & Breadcrumbs */}
        <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 dark:border-neutral-800 dark:bg-neutral-900/50">
          <div className="overflow-x-auto flex-1 mr-2">
            <div className="items-center">
              <div className="flex items-center gap-1">
                <HardDrive size={14} color="#1a73e8" />
                {breadcrumbs.map((crumb, idx) => {
                  const isLast = idx === breadcrumbs.length - 1;
                  return (
                    <div key={crumb.path} className="flex items-center">
                      <Button
                        variant="ghost"
                        disabled={isLast}
                        aria-label={isLast ? crumb.label : `Go to ${crumb.label}`}
                        onClick={() => {
                          setSearchQuery('');
                          void load(crumb.path);
                        }}
                        className={`h-auto sm:h-auto rounded px-1.5 py-0.5 ${
                          isLast
                            ? 'bg-neutral-200/60 dark:bg-neutral-800'
                            : 'active:bg-neutral-200 dark:active:bg-neutral-800'
                        }`}>
                        <span
                          className={`font-mono text-xs ${
                            isLast
                              ? 'font-bold text-neutral-900 dark:text-neutral-100'
                              : 'text-[#1a73e8] dark:text-blue-400'
                          } truncate`}>
                          {crumb.label}
                        </span>
                      </Button>
                      {!isLast && <div className="text-neutral-400 dark:text-neutral-600 text-xs mx-0.5">/</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <Button
            variant="ghost"
            onClick={() => {
              setPathInput(activeDirectory);
              setPathModalOpen(true);
            }}
            aria-label="Change directory"
            className="h-auto sm:h-auto rounded-md bg-neutral-200/70 px-2 py-1 dark:bg-neutral-800 active:opacity-70">
            <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">Change</span>
          </Button>
        </div>

        {/* Search / Filter Bar */}
        <div className="border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <div className="frame-focus flex items-center gap-2 rounded-xl bg-neutral-100 px-3 py-1.5 dark:bg-neutral-900">
            <Search size={15} color={dark ? '#888' : '#9ca3af'} />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in this folder..."
              // The pill around this draws the field; a second border and the
              // base background inside it read as a frame within a frame.
              // dark:bg-transparent is required — the base sets
              // dark:bg-input/30, which a plain bg-transparent does not cancel.
              className="flex-1 border-0 bg-transparent text-sm text-neutral-900 focus-visible:ring-0 dark:bg-transparent dark:text-neutral-100"
              autoCapitalize="none"
            />
            {searchQuery ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="h-6 w-6 rounded-md">
                <X size={14} color={dark ? '#888' : '#9ca3af'} />
              </Button>
            ) : null}
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="m-3">
            <UIAlert icon={AlertCircle} variant="destructive">
              <AlertDescription className="text-xs text-red-600 dark:text-red-400">{error}</AlertDescription>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void load(activeDirectory)}
                className="ml-6 mt-1 self-start">
                <span className="text-xs font-semibold">Retry</span>
              </Button>
            </UIAlert>
          </div>
        )}

        {/* File list. Keyed by path; the scroller is the box below. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className={`mx-auto flex min-h-full w-full max-w-4xl flex-col ${fileListContentClass}`}>
            {fileListHeader}
            {filteredEntries.length === 0
              ? fileListEmpty
              : filteredEntries.map((item) => (
                  <FileRow
                    key={item.path}
                    entry={item}
                    dark={dark}
                    onOpen={handleOpenEntryStable}
                    onDelete={handleDeleteEntry}
                  />
                ))}
          </div>
        </div>

        {/* Reading File Overlay */}
        {readingFile && (
          <div className="flex flex-col absolute inset-0 z-50 items-center justify-center bg-black/40">
            <div className="flex flex-col items-center rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900">
              <Spinner size={24} color="#1a73e8" />
              <div className="mt-3 text-sm font-medium text-neutral-800 dark:text-neutral-200">Opening file...</div>
            </div>
          </div>
        )}

        {/* File Preview Modal */}
        <DialogPrimitive.Root open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
            <DialogPrimitive.Content className="fixed inset-0 z-50 flex flex-col bg-white outline-hidden dark:bg-neutral-950">
              <DialogPrimitive.Title className="sr-only">File preview</DialogPrimitive.Title>
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                  <div className="flex-1 pr-3">
                    <div className="font-mono text-base font-bold text-neutral-900 dark:text-white truncate">
                      {selectedFile?.name}
                    </div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">
                      {formatBytes(selectedFile?.size)} · {selectedFile?.mime_type || 'Unknown type'}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {fileTextContent && !isEditingFile ? (
                      <Button
                        variant="ghost"
                        onClick={handleCopyText}
                        aria-label="Copy file contents"
                        className="h-auto sm:h-auto rounded-lg bg-neutral-100 px-2.5 py-1.5 active:bg-neutral-200 dark:bg-neutral-800 dark:active:bg-neutral-700">
                        {copied ? (
                          <>
                            <Check size={14} color="#10b981" />
                            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy size={14} color={dark ? '#ccc' : '#444'} />
                            <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Copy</span>
                          </>
                        )}
                      </Button>
                    ) : null}

                    {/* Edit Toggle for Text Files */}
                    {fileTextContent && !selectedFile?.mime_type?.startsWith('image/') ? (
                      isEditingFile ? (
                        <Button
                          variant="ghost"
                          onClick={handleSaveEditedFile}
                          disabled={savingFile}
                          aria-label="Save file"
                          className="h-auto sm:h-auto rounded-lg bg-[#1a73e8] px-3 py-1.5 active:opacity-80">
                          {savingFile ? (
                            <Spinner size={14} color="#fff" />
                          ) : (
                            <span className="text-xs font-bold text-white">Save</span>
                          )}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() => setIsEditingFile(true)}
                          aria-label="Edit file"
                          className="h-auto sm:h-auto rounded-lg bg-neutral-100 px-2.5 py-1.5 active:bg-neutral-200 dark:bg-neutral-800 dark:active:bg-neutral-700">
                          <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Edit</span>
                        </Button>
                      )
                    ) : null}

                    {selectedFile && !isEditingFile ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteEntry(selectedFile.path, false, selectedFile.name)}
                        aria-label="Delete file"
                        className="h-8 w-8 rounded-lg active:bg-neutral-100 dark:active:bg-neutral-800">
                        <Trash2 size={18} color="#ef4444" />
                      </Button>
                    ) : null}

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={closePreview}
                      aria-label="Close preview"
                      className="h-8 w-8 rounded-lg active:bg-neutral-100 dark:active:bg-neutral-800">
                      <X size={20} color={dark ? '#eee' : '#333'} />
                    </Button>
                  </div>
                </div>

                {/* Preview Content */}
                <div className="flex-1 bg-neutral-50 dark:bg-black">
                  {selectedFile?.mime_type?.startsWith('image/') && selectedFile.data_url ? (
                    <div className="flex flex-col flex-1 items-center justify-center p-4">
                      <img src={selectedFile.data_url} alt={selectedFile.name} className="size-full object-contain" />
                    </div>
                  ) : isEditingFile ? (
                    <div className="flex-1">
                      <Textarea
                        value={fileTextContent}
                        onChange={(e) => setFileTextContent(e.target.value)}

                        autoCapitalize="none"
                        className="flex-1 p-4 font-mono text-xs leading-5 text-neutral-900 dark:text-neutral-100"
                      />
                    </div>
                  ) : fileTextContent ? (
                    <div className="overflow-y-auto flex-1">
                      <div className="p-4">
                        <div className="overflow-x-auto">
                          <div>
                            <div className="font-mono text-xs leading-5 text-neutral-900 dark:text-neutral-100">
                              {fileTextContent}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col flex-1 items-center justify-center p-8">
                      <File size={48} color={dark ? '#555' : '#aaa'} />
                      <div className="mt-4 text-center text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                        Binary or Unsupported File Preview
                      </div>
                      <div className="mt-1 text-center text-xs text-neutral-500 dark:text-neutral-400">
                        This file cannot be rendered as text or an image.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        {/* Change / Jump to Path Modal */}
        <Dialog open={pathModalOpen} onOpenChange={setPathModalOpen}>
          <DialogPortal>
            <div className="w-full">
              <DialogContent className="max-w-sm p-5">
                <DialogTitle className="text-base font-bold text-neutral-900 dark:text-white">
                  Navigate to Directory
                </DialogTitle>
                <DialogDescription className="text-xs text-neutral-500 dark:text-neutral-400">
                  Enter absolute directory path on the server
                </DialogDescription>

                <Input
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  autoCapitalize="none"
                  aria-label="Directory path"
                  placeholder={activeDirectory || '~'}
                  className="mt-1 rounded-xl border border-neutral-300 p-3 font-mono text-sm text-neutral-900 dark:border-neutral-700 dark:text-white"
                />

                <DialogFooter>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-xl px-4"
                    onClick={() => setPathModalOpen(false)}>
                    <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Cancel</span>
                  </Button>
                  <Button size="sm" className="h-10 rounded-xl bg-[#1a73e8] px-5" onClick={handleJumpToPath}>
                    <span className="text-sm font-bold text-white">Go</span>
                  </Button>
                </DialogFooter>
              </DialogContent>
            </div>
          </DialogPortal>
        </Dialog>

        {/* Create Folder Modal */}
        <Dialog open={newFolderModalOpen} onOpenChange={setNewFolderModalOpen}>
          <DialogPortal>
            <div className="w-full">
              <DialogContent className="max-w-sm p-5">
                <DialogTitle className="text-base font-bold text-neutral-900 dark:text-white">New Folder</DialogTitle>
                <DialogDescription className="text-xs text-neutral-500 dark:text-neutral-400">
                  Create folder in: {activeDirectory || '~'}
                </DialogDescription>

                <Input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoCapitalize="none"
                  autoFocus
                  aria-label="Folder name"
                  placeholder="folder_name"
                  className="mt-1 rounded-xl border border-neutral-300 p-3 text-sm text-neutral-900 dark:border-neutral-700 dark:text-white"
                />

                <DialogFooter>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-xl px-4"
                    onClick={() => {
                      setNewFolderName('');
                      setNewFolderModalOpen(false);
                    }}>
                    <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Cancel</span>
                  </Button>
                  <Button
                    size="sm"
                    className="h-10 rounded-xl bg-[#1a73e8] px-5"
                    disabled={creatingFolder || !newFolderName.trim()}
                    onClick={handleCreateFolder}>
                    {creatingFolder ? (
                      <Spinner size={14} color="#fff" />
                    ) : (
                      <span className="text-sm font-bold text-white">Create</span>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </div>
          </DialogPortal>
        </Dialog>

        {/* Create New File Modal */}
        <DialogPrimitive.Root open={newFileModalOpen} onOpenChange={setNewFileModalOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
            <DialogPrimitive.Content className="fixed inset-0 z-50 flex flex-col bg-white outline-hidden dark:bg-neutral-950">
              <DialogPrimitive.Title className="sr-only">New file</DialogPrimitive.Title>
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
                  <div>
                    <div className="text-base font-bold text-neutral-900 dark:text-white">Create New File</div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">in {activeDirectory || '~'}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setNewFileModalOpen(false)}
                      aria-label="Cancel"
                      className="h-auto sm:h-auto rounded-lg px-3 py-1.5 active:bg-neutral-100 dark:active:bg-neutral-800">
                      <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">Cancel</span>
                    </Button>

                    <Button
                      variant="ghost"
                      onClick={handleCreateFile}
                      disabled={creatingFile || !newFileName.trim()}
                      aria-label="Create file"
                      className="h-auto sm:h-auto rounded-lg bg-[#1a73e8] px-3.5 py-1.5 active:opacity-80">
                      {creatingFile ? (
                        <Spinner size={14} color="#fff" />
                      ) : (
                        <span className="text-xs font-bold text-white">Save File</span>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="p-3 border-b border-neutral-200 dark:border-neutral-800">
                  <Label className="mb-1 text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                    File Name (e.g. notes.txt, script.py, config.json)
                  </Label>
                  <Input
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    autoCapitalize="none"
                    autoFocus
                    placeholder="filename.txt"
                    aria-label="File name"
                    className="rounded-xl border border-neutral-300 dark:border-neutral-700 p-2.5 font-mono text-sm text-neutral-900 dark:text-white"
                  />
                </div>

                <div className="flex-1 p-3">
                  <Label className="mb-1 text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                    File Content
                  </Label>
                  <Textarea
                    value={newFileContent}
                    onChange={(e) => setNewFileContent(e.target.value)}
                    aria-label="File content"

                    autoCapitalize="none"
                    placeholder="Enter text or code here..."
                    className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 p-3 font-mono text-xs leading-5 text-neutral-900 dark:text-neutral-100"
                  />
                </div>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete?.title ?? ''}
        description={confirmDelete?.body}
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirmDelete?.run()}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
      />
    </div>
  );
}
