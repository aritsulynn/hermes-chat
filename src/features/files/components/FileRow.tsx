import { Text as UIText } from '../../../components/ui/text';
// Memoized file/folder row — the old ScrollView.map rebuilt every icon/date/bytes per keystroke.
import { memo, useCallback, useMemo } from 'react';
import { ChevronRight, Folder } from 'lucide-react';
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
  const handleLongPress = useCallback(
    () => onDelete(entry.path, entry.is_directory, entry.name),
    [onDelete, entry],
  );
  const iconStyle = useMemo(() => ({ backgroundColor: iconBg }), [iconBg]);
  return (
    <button type="button"
      onClick={handlePress}
      onLongPress={handleLongPress}
      className="flex items-center gap-3 border-b border-neutral-100 px-4 py-2.5 active:bg-neutral-100 dark:border-neutral-900 dark:active:bg-neutral-900"
    >
      <div className="h-10 w-10 items-center justify-center rounded-xl" style={iconStyle}>
        <Icon size={20} color={iconColor} />
      </div>
      <div className="flex-1 justify-center">
        <UIText numberOfLines={1} className="font-mono text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {entry.name}
        </UIText>
        <div className="mt-0.5 flex items-center gap-2">
          <UIText className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {isDir ? 'Folder' : formatBytes(entry.size)}
          </UIText>
          <UIText className="text-[11px] text-neutral-400 dark:text-neutral-600">·</UIText>
          <UIText className="text-[11px] text-neutral-500 dark:text-neutral-400">{formatDate(entry.mtime)}</UIText>
        </div>
      </div>
      {isDir ? <ChevronRight size={17} color={dark ? '#666' : '#aaa'} /> : null}
    </button>
  );
});
