// Memoized file/folder row — the old list rebuilt every icon/date/bytes per keystroke.
import { memo, useCallback, useMemo } from 'react';
import { ChevronRight, Folder } from 'lucide-react';
import { useLongPress } from '../../../hooks/use-long-press';
import { formatBytes, formatDate } from '../../../utils/format';
import { getFileCategory } from '../helpers';
import type { ManagedFileEntry } from '../types';

export const FileRow = memo(function FileRow({
  entry,
  dark,
  onOpen,
  onDelete,
}: {
  entry: ManagedFileEntry;
  dark: boolean;
  onOpen: (e: ManagedFileEntry) => void;
  onDelete: (path: string, isDir: boolean, name: string) => void;
}) {
  const category = getFileCategory(entry.name, entry.mime_type);
  const isDir = entry.is_directory;
  const Icon = isDir ? Folder : category.icon;
  const iconColor = isDir ? '#f59e0b' : category.color;
  const iconBg = isDir ? '#f59e0b18' : category.bgColor;
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
      className="flex cursor-pointer items-center gap-3 border-b border-neutral-100 px-4 py-2.5 hover:bg-neutral-100 dark:border-neutral-900 dark:hover:bg-neutral-900">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={iconStyle}>
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
      {isDir ? <ChevronRight size={17} color={dark ? '#666' : '#aaa'} /> : null}
    </div>
  );
});
