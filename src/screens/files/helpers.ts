// Pure helpers for the Files screen (icon/category mapping, path joining,
// text-readability checks). No React/JSX.
import { File, FileArchive, FileCode, FileImage, FileText, Music, Video } from 'lucide-react-native';

export function getFileCategory(
  name: string,
  mime?: string | null,
): {
  icon: typeof File;
  color: string;
  bgColor: string;
  isImage: boolean;
  isText: boolean;
} {
  const lower = name.toLowerCase();
  const ext = lower.split('.').pop() || '';

  if (mime?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) {
    return {
      icon: FileImage,
      color: '#10b981',
      bgColor: '#10b98118',
      isImage: true,
      isText: false,
    };
  }
  if (
    [
      'js',
      'jsx',
      'ts',
      'tsx',
      'py',
      'json',
      'html',
      'css',
      'scss',
      'sh',
      'bash',
      'yml',
      'yaml',
      'toml',
      'sql',
      'rs',
      'go',
      'c',
      'cpp',
      'java',
      'kt',
    ].includes(ext)
  ) {
    return {
      icon: FileCode,
      color: '#3b82f6',
      bgColor: '#3b82f618',
      isImage: false,
      isText: true,
    };
  }
  if (mime?.startsWith('video/') || ['mp4', 'mov', 'mkv', 'webm', 'avi'].includes(ext)) {
    return {
      icon: Video,
      color: '#f59e0b',
      bgColor: '#f59e0b18',
      isImage: false,
      isText: false,
    };
  }
  if (mime?.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) {
    return {
      icon: Music,
      color: '#8b5cf6',
      bgColor: '#8b5cf618',
      isImage: false,
      isText: false,
    };
  }
  if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz'].includes(ext)) {
    return {
      icon: FileArchive,
      color: '#ec4899',
      bgColor: '#ec489918',
      isImage: false,
      isText: false,
    };
  }
  if (
    mime?.startsWith('text/') ||
    ['txt', 'md', 'log', 'env', 'csv', 'tsv', 'xml', 'conf', 'ini', 'cfg'].includes(ext)
  ) {
    return {
      icon: FileText,
      color: '#6366f1',
      bgColor: '#6366f118',
      isImage: false,
      isText: true,
    };
  }
  return {
    icon: File,
    color: '#6b7280',
    bgColor: '#6b728018',
    isImage: false,
    isText: false,
  };
}

export function joinPath(dir: string, name: string): string {
  if (!dir || dir === '/') return `/${name}`;
  return `${dir.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`;
}

const TEXT_MIME_RE = /^(text\/|application\/(json|xml|yaml|x-yaml|javascript|csv|toml|x-sh))/i;
const TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'log',
  'env',
  'csv',
  'tsv',
  'json',
  'xml',
  'yaml',
  'yml',
  'ini',
  'cfg',
  'conf',
  'toml',
  'sh',
  'bash',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'html',
  'htm',
  'css',
  'scss',
  'sql',
  'rs',
  'go',
  'c',
  'cpp',
  'h',
  'java',
  'kt',
  'rb',
  'php',
  'svg',
]);
export function isTextReadable(mime: string | null | undefined, name: string): boolean {
  if (mime && TEXT_MIME_RE.test(mime)) return true;
  const ext = (name.split('.').pop() || '').toLowerCase();
  return TEXT_EXTS.has(ext);
}
