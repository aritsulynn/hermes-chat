// Memoized file/folder row — the old list rebuilt every icon/date/bytes per keystroke.
import { memo, useCallback, useMemo } from 'react';
import { ChevronRight, Download, Folder } from 'lucide-react';
import { useLongPress } from '../../../hooks/use-long-press';
import { formatBytes, formatDate } from '../../../utils/format';
import { getFileCategory } from '../helpers';
import type { ManagedFileEntry } from '../types';

export const FileRow = memo(function FileRow({
  entry,
  dark,
  onOpen,
  onDelete,
  onDownload,
}: {
  entry: ManagedFileEntry;
  dark: boolean;
  onOpen: (e: ManagedFileEntry) => void;
  onDelete: (path: string, isDir: boolean, name: string) => void;
  onDownload: (e: ManagedFileEntry) => void;
}) {
  const category = getFileCategory(entry.name, entry.mime_type);
  const isDir = entry.is_directory;
  const Icon = isDir ? Folder : category.icon;
  // Folders follow the theme brand (icon + tint) so a future accent applies
  // here with no code change. Per-file-type colours below stay fixed — they
  // encode the kind of file, like the trust badges, not the theme.
  const iconColor = isDir ? 'var(--brand-hex)' : category.color;
  const iconBg = isDir ? undefined : category.bgColor;
  // Stable handlers + memoized style: inline arrows/objects here would defeat
  // memo() and re-render every row on each parent render.
  const handlePress = useCallback(() => onOpen(entry), [onOpen, entry]);
  const handleLongPress = useCallback(() => onDelete(entry.path, entry.is_directory, entry.name), [onDelete, entry]);
  const longPress = useLongPress(handleLongPress);
  const iconStyle = useMemo(() => ({ backgroundColor: iconBg }), [iconBg]);
  return (
    // A div with role="button", not a <button>: this is a row in a list, and a
    // real <button> would make the whole row one giant tab stop containing
    // interactive children. The keydown handler supplies the activation a div
    // otherwise lacks.
    <div
      role="button"
      tabIndex={0}
      onClick={handlePress}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handlePress();
        }
      }}
      {...longPress}
      className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 hover:bg-muted dark:hover:bg-muted">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-xl ${isDir ? 'bg-brand/10' : ''}`}
        style={iconStyle}>
        <Icon size={20} color={iconColor} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="block truncate font-mono text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {entry.name}
        </span>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {isDir ? 'Folder' : formatBytes(entry.size)}
          </span>
          <span className="text-[11px] text-neutral-400 dark:text-neutral-600">·</span>
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{formatDate(entry.mtime)}</span>
        </div>
      </div>
      {isDir ? (
        <ChevronRight size={17} color={dark ? '#666' : '#aaa'} />
      ) : (
        <button
          type="button"
          aria-label={`Download ${entry.name}`}
          // Stop the row's onClick from also opening the preview when the tap
          // was meant for the download control.
          onClick={(e) => {
            e.stopPropagation();
            onDownload(entry);
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-accent dark:hover:bg-accent/50">
          <Download size={17} color={dark ? '#a3a3a3' : '#555'} />
        </button>
      )}
    </div>
  );
});
