// Chat media — the file/image side of a message.
//
// The gateway is text-only, so anything the agent "sends" arrives as text:
// a `MEDIA:<path>` tag, a bare path, a markdown image or a link.
// renderMediaTags() (utils/messages) rewrites the first two into markdown with
// a `#media:<encoded path>` href, and these components turn that into real UI.
// Every shape a source can take is resolved here:
//
//   data:image/png;base64,…        → used as-is
//   https://…                      → used as-is (+ session cookie when ours)
//   /api/…  /static/…              → app host + path (+ session cookie)
//   #media:… / ~/shot.png / /home/u/shot.png
//                                  → fetched with the app's cookie and shown
//                                    as a data URL (see readServerFile)
//
// Server files are cookie-gated, so the system browser can't open them — they
// are read in-app instead.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, ImageOff, Share2, X } from 'lucide-react-native';
import { useApp } from '../hooks/app-store';
import { base64ToUtf8, mediaPathFromHref } from '../utils/messages';
import {
  getMediaCacheGeneration,
  mediaCacheKey,
  ratioCache,
  serverFileCache,
  serverFilePending,
} from '../lib/media-cache';
import { buildImageSource, shouldAttachDashboardCookie } from '../lib/media-policy';
import { deleteAsync, writeAsStringAsync, cacheDirectory } from 'expo-file-system/legacy';
import * as api from '../lib/api';
import { MEDIA_FETCH_TIMEOUT_MS, PREVIEW_MAX_CHARS } from '../lib/constants';

const REMOTE = /^(https?:|data:|blob:)/i;
// Routes the dashboard serves itself (cookie auth) — no files read needed.
const WEB_PATH = /^\/(api|static|assets|files)\//i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i;

const isRemote = (s: string) => REMOTE.test(s);
const isWebPath = (s: string) => WEB_PATH.test(s);
// `#media:<path>` hrefs are produced by renderMediaTags() (utils/messages).
const serverPath = (s: string) => mediaPathFromHref(s) ?? s;
// A server-side path the agent wrote: ~/x, /home/u/x, C:\x or a bare file name.
const looksLikeFilePath = (s: string) => {
  const p = serverPath(s);
  return !!p && !isRemote(p) && !isWebPath(p) && (/^~?\//.test(p) || /^[A-Za-z]:[\\/]/.test(p) || IMG_EXT.test(p));
};

const base = (host: string) => host.replace(/\/+$/, '');
const basename = (s: string) => s.split(/[\\/]/).pop()?.split('?')[0] || s;

// Text-ish payloads get an in-app preview; anything else (pdf, zip, video…)
// says so rather than dumping mojibake into a <Text>.
const TEXT_MIME = /^(text\/|application\/(json|xml|yaml|x-yaml|javascript|csv)|image\/svg)/i;

// `#media:` href, the `?path=` of a /api/files/read link, or a bare path.
function pathOfHref(href: string): string | null {
  const viaMedia = mediaPathFromHref(href);
  if (viaMedia) return viaMedia;
  const m = href.match(/[?&]path=([^&]+)/);
  if (/\/api\/files\/read/.test(href) && m) return decodeURIComponent(m[1]);
  if (looksLikeFilePath(href)) return href;
  return null;
}

// Server-side files sit behind three different gates: /api/media (the agent's
// media roots — images only), /api/fs/read-data-url (any path) and
// /api/files/read (the managed root the Files tab browses). Try in that order.
// Results are memoized per authenticated scope + path so scrolling an
// image-heavy transcript doesn't refetch the same file per bubble mount.
async function readServerFile(
  opsGet: (path: string) => Promise<any>,
  path: string,
  cacheScope: string,
): Promise<string> {
  const cacheKey = mediaCacheKey(cacheScope, path);
  const generation = getMediaCacheGeneration();
  const hit = serverFileCache.get(cacheKey);
  if (hit !== undefined) return hit;
  const inflight = serverFilePending.get(cacheKey);
  if (inflight) return inflight;
  const attempts: [string, (r: any) => unknown][] = [
    [api.media(path), (r) => r?.data_url],
    [api.mediaReadDataUrl(path), (r) => r?.dataUrl],
    [api.mediaViaFiles(path), (r) => r?.data_url],
  ];
  const p = (async () => {
    for (const [url, pick] of attempts) {
      try {
        // 15s ceiling per endpoint so a wedged server can't hang the thumbnail forever.
        const v = pick(
          await Promise.race([
            opsGet(url),
            new Promise((_, rej) =>
              setTimeout(() => rej(new Error('media timeout')), MEDIA_FETCH_TIMEOUT_MS),
            ),
          ]),
        );
        if (typeof v === 'string' && v.startsWith('data:')) {
          // Bound the cache — image data URLs are large. A logout/host switch
          // invalidates the generation so an old in-flight response cannot
          // repopulate the new authenticated scope.
          if (getMediaCacheGeneration() !== generation) return v;
          if (serverFileCache.size > 40) {
            const oldest = serverFileCache.keys().next().value;
            if (oldest !== undefined) serverFileCache.delete(oldest);
          }
          serverFileCache.set(cacheKey, v);
          return v;
        }
      } catch {}
    }
    return '';
  })().finally(() => {
    serverFilePending.delete(cacheKey);
  });
  serverFilePending.set(cacheKey, p);
  return p;
}

/** Share or download a resolved media URI. Remote/relative sources share the URL;
 *  an embedded data URL is written to a cache file first; web uses the Web Share
 *  API, falling back to an <a download>. */
async function shareUri(uri: string, name?: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      const nav: any = (globalThis as any).navigator;
      if (nav?.share) {
        await nav.share({ url: uri });
        return;
      }
      const a = (globalThis as any).document?.createElement('a');
      if (a) {
        a.href = uri;
        a.download = name || 'hermes-download';
        a.rel = 'noopener';
        a.click();
      }
      return;
    }
    if (/^data:/i.test(uri)) {
      const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(uri);
      const mime = m?.[1] || 'application/octet-stream';
      const isB64 = !!m?.[2];
      const data = m?.[3] ?? '';
      const ext = (mime.split('/')[1] || 'bin').split('+')[0];
      const path = `${cacheDirectory ?? ''}hermes-${Date.now()}.${ext}`;
      try {
        if (isB64) await writeAsStringAsync(path, data, { encoding: 'base64' });
        else await writeAsStringAsync(path, decodeURIComponent(data));
        await Share.share({ url: path });
      } finally {
        await deleteAsync(path, { idempotent: true }).catch(() => {});
      }
      return;
    }
    await Share.share({ url: uri, message: uri });
  } catch {}
}

// Resolve a markdown image src into something <Image> can actually load.
function useResolvedImage(src: string) {
  const { host, username, activeProfile, opsGet, getCookie } = useApp();
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const cacheScope = JSON.stringify([host, username, activeProfile, getCookie()]);

  useEffect(() => {
    let alive = true;
    setUri(null);
    setError(false);
    const done = (u: string) => {
      if (alive) setUri(u);
    };
    const fail = () => {
      if (alive) setError(true);
    };

    const p = serverPath(src);
    if (isRemote(p)) return done(p);
    if (isWebPath(p)) return done(`${base(host)}${p}`);
    if (!looksLikeFilePath(p)) return fail();

    void readServerFile(opsGet, p, cacheScope).then((d) => {
      if (!d) return fail();
      if (!/^data:image\//i.test(d)) return fail();
      done(d);
    });
    return () => {
      alive = false;
    };
  }, [src, host, opsGet, cacheScope]);

  // Do not even read/passthrough the cookie for external images. React Native's
  // Image loader does not share the app's fetch cookie jar, but a custom header
  // on an arbitrary URI would disclose the dashboard session to that host.
  const cookie = uri && shouldAttachDashboardCookie(uri, host) ? getCookie() : '';
  return { uri, error, cookie, cacheScope };
}

// ── Image ───────────────────────────────────────────────────────────────────

function BrokenImage({ src, alt, dark }: { src: string; alt?: string; dark: boolean }) {
  const { host } = useApp();
  const p = serverPath(src);
  // Last resort: hand web-reachable sources to the browser (server paths are
  // cookie-gated, so there is nothing useful to open for those).
  const openable = isRemote(p) || isWebPath(p);
  const url = openable ? (isWebPath(p) ? `${base(host)}${p}` : p) : '';
  return (
    <Pressable
      disabled={!openable}
      onPress={() => void Linking.openURL(url).catch(() => {})}
      className="my-1 flex-row items-center gap-2 rounded-[10px] border border-neutral-200 px-2.5 py-2 dark:border-neutral-700"
    >
      <ImageOff size={15} color={dark ? '#aaa' : '#777'} />
      <Text className="flex-1 text-[13px] text-neutral-600 dark:text-neutral-300" numberOfLines={1}>
        {alt || basename(p) || 'image'}
      </Text>
      {openable && <ChevronRight size={14} color={dark ? '#aaa' : '#777'} />}
    </Pressable>
  );
}

export function ChatImage({ src, alt, dark }: { src: string; alt?: string; dark: boolean }) {
  const { host } = useApp();
  const { uri, error, cookie, cacheScope } = useResolvedImage(src);
  const [ratio, setRatio] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const { width: winW } = useWindowDimensions();
  // Pixel box, not `width: '100%'`: markdown renders inline content inside a
  // textgroup <Text>, where percentages are unreliable.
  let boxW = Math.min(Math.round(winW * 0.62), 320);
  let boxH = ratio ? Math.round(boxW / ratio) : Math.round(boxW * 0.75);
  if (boxH > 340) {
    boxH = 340;
    if (ratio) boxW = Math.round(boxH * ratio);
  }
  const imgSource = useMemo(() => buildImageSource(uri ?? '', host, cookie), [uri, host, cookie]);
  const boxStyle = useMemo(
    () => ({
      width: boxW,
      height: boxH,
      borderRadius: 10,
      backgroundColor: dark ? '#1b1b1b' : '#e9e9ee',
    }),
    [boxW, boxH, dark],
  );

  // Cached aspect ratios so thumbnail + preview of the same URI cost one native call.
  useEffect(() => {
    if (!uri) return;
    const ratioKey = mediaCacheKey(cacheScope, uri);
    const cached = ratioCache.get(ratioKey);
    if (cached) {
      setRatio(cached);
      return;
    }
    let alive = true;
    try {
      // No headers here (getSize has none) — authed sources just keep the
      // default ratio instead of reporting a false error.
      Image.getSize(
        uri,
        (w, h) => {
          if (alive && w > 0 && h > 0) {
            const r = w / h;
            if (ratioCache.size > 200) {
              const oldest = ratioCache.keys().next().value;
              if (oldest !== undefined) ratioCache.delete(oldest);
            }
            ratioCache.set(ratioKey, r);
            setRatio(r);
          }
        },
        () => {},
      );
    } catch {}
    return () => {
      alive = false;
    };
  }, [uri, cacheScope]);

  // Falls back to the file name so the viewer always has a caption.
  const caption = alt || basename(serverPath(src));

  if (error || broken) return <BrokenImage src={src} alt={alt} dark={dark} />;
  if (!uri) {
    return (
      <View
        className="my-1 items-center justify-center rounded-[10px]"
        style={{
          width: boxW,
          height: 120,
          backgroundColor: dark ? '#1b1b1b' : '#e9e9ee',
        }}
      >
        <ActivityIndicator size="small" color={dark ? '#888' : '#666'} />
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => showPreview({ kind: 'image', uri, caption })}
      className="my-1"
      style={{ width: boxW, height: boxH }}
    >
      <Image source={imgSource} resizeMode="contain" onError={() => setBroken(true)} style={boxStyle} />
    </Pressable>
  );
}

// ── File link / preview ─────────────────────────────────────────────────────

type Preview = { kind: 'image'; uri: string; caption?: string } | { kind: 'text'; text: string } | { kind: 'other' };

// Markdown groups inline tokens inside a <Text>, so the link rule must return
// text (a Modal nested in a Text is not a thing). The preview therefore lives
// in one host mounted at the app root and is driven through this tiny store.
let previewListener: ((p: Preview | null) => void) | null = null;
const showPreview = (p: Preview | null) => previewListener?.(p);

export function FilePreviewHost() {
  const { authed } = useApp();
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    if (!authed) setPreview(null);
  }, [authed]);
  useEffect(() => {
    previewListener = setPreview;
    return () => {
      previewListener = null;
    };
  }, []);
  return <FilePreviewModal preview={preview} onClose={() => setPreview(null)} />;
}

function FilePreviewModal({ preview, onClose }: { preview: Preview | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { host, getCookie } = useApp();
  if (!preview) return null;
  const previewCookie = preview.kind === 'image' && shouldAttachDashboardCookie(preview.uri, host) ? getCookie() : '';
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View
        className="flex-1 bg-black/95"
        style={{
          paddingTop: insets.top + 44,
          paddingBottom: insets.bottom + 12,
        }}
      >
        {preview.kind === 'image' ? (
          <>
            <Pressable className="flex-1 items-center justify-center p-3" onPress={onClose}>
              <Image
                source={buildImageSource(preview.uri, host, previewCookie)}
                resizeMode="contain"
                style={{ width: '100%', height: '100%' }}
              />
            </Pressable>
            {!!preview.caption && (
              <Text className="px-4 pb-1 text-center text-xs text-white/70" numberOfLines={3}>
                {preview.caption}
              </Text>
            )}
          </>
        ) : preview.kind === 'text' ? (
          <ScrollView className="mx-3 rounded-xl bg-white/5 p-3">
            <Text selectable className="text-[13px] leading-[19px] text-white/90">
              {preview.text || '(empty file)'}
            </Text>
          </ScrollView>
        ) : (
          <View className="flex-1 items-center justify-center gap-2 p-6">
            <ImageOff size={28} color="#888" />
            <Text className="text-sm text-white/70">Can’t preview this file type in the app.</Text>
            <Text className="text-xs text-white/40">Open it from the Files tab instead.</Text>
          </View>
        )}
        <Pressable
          onPress={onClose}
          hitSlop={12}
          className="absolute right-3 rounded-full bg-white/15 p-2"
          style={{ top: insets.top + 8 }}
        >
          <X size={20} color="#fff" />
        </Pressable>
        {(preview.kind === 'image' || preview.kind === 'text') && (
          <Pressable
            onPress={() => {
              if (preview.kind === 'image') void shareUri(preview.uri, preview.caption);
              else if (preview.kind === 'text') void Share.share({ message: preview.text }).catch(() => {});
            }}
            hitSlop={12}
            className="absolute left-3 flex-row items-center gap-1.5 rounded-full bg-white/15 px-3 py-2"
            style={{ top: insets.top + 8 }}
          >
            <Share2 size={16} color="#fff" />
            <Text className="text-[12px] font-semibold text-white">Share</Text>
          </Pressable>
        )}
        <Text className="pt-2 text-center text-[11px] text-white/30">tap to close</Text>
      </View>
    </Modal>
  );
}

export function FileChip({
  href,
  label,
  textStyle,
}: {
  href: string;
  label: string;
  textStyle?: StyleProp<TextStyle>;
}) {
  const { host, username, activeProfile, opsGet, getCookie } = useApp();
  const [busy, setBusy] = useState(false);

  const open = useCallback(async () => {
    const path = pathOfHref(href);
    if (!path) {
      const url = isRemote(href) ? href : `${base(host)}${href}`;
      await Linking.openURL(url).catch(() => showPreview({ kind: 'other' }));
      return;
    }
    setBusy(true);
    try {
      const cacheScope = JSON.stringify([host, username, activeProfile, getCookie()]);
      const d = await readServerFile(opsGet, path, cacheScope);
      const mime = d.match(/^data:([^;,]+)/)?.[1] ?? '';
      if (mime.startsWith('image/')) showPreview({ kind: 'image', uri: d });
      else if (TEXT_MIME.test(mime)) {
        const b64 = d.split(';base64,')[1] ?? '';
        // Slice BEFORE decode — decoding a multi-MB file just to show 20k chars spikes memory.
        showPreview({
          kind: 'text',
          text: base64ToUtf8(b64.slice(0, 30000)).slice(0, PREVIEW_MAX_CHARS),
        });
      } else showPreview({ kind: 'other' });
    } finally {
      setBusy(false);
    }
  }, [href, host, username, activeProfile, opsGet, getCookie]);

  // Inline <Text>: the markdown pipeline puts link tokens inside a textgroup
  // Text, so this must not be a View.
  return (
    <Text style={textStyle} onPress={() => void open()}>
      {busy ? '… ' : '📎 '}
      {label}
    </Text>
  );
}
