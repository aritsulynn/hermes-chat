// Memoized file/folder row — the old ScrollView.map rebuilt every icon/date/bytes per keystroke.
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronRight, Folder } from 'lucide-react-native';
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
  return (
    <Pressable
      onPress={() => onOpen(entry)}
      onLongPress={() => onDelete(entry.path, entry.is_directory, entry.name)}
      className="flex-row items-center gap-3 border-b border-neutral-100 px-4 py-2.5 active:bg-neutral-100 dark:border-neutral-900 dark:active:bg-neutral-900"
    >
      <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: iconBg }}>
        <Icon size={20} color={iconColor} />
      </View>
      <View className="flex-1 justify-center">
        <Text numberOfLines={1} className="font-mono text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {entry.name}
        </Text>
        <View className="mt-0.5 flex-row items-center gap-2">
          <Text className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {isDir ? 'Folder' : formatBytes(entry.size)}
          </Text>
          <Text className="text-[11px] text-neutral-400 dark:text-neutral-600">·</Text>
          <Text className="text-[11px] text-neutral-500 dark:text-neutral-400">{formatDate(entry.mtime)}</Text>
        </View>
      </View>
      {isDir ? <ChevronRight size={17} color={dark ? '#666' : '#aaa'} /> : null}
    </Pressable>
  );
});
