// Chat media — the file/image side of a message.
//
// The gateway is text-only, so anything the agent "sends" arrives as text:
// a `MEDIA:<path>` tag, a bare path, a markdown image or a link.
// renderMediaTags() (utils/messages) rewrites the first two into markdown with
// a `#media:<encoded path>` href, and these components turn that into real UI.
// Every shape a source can take is resolved here:
//
//   data:image/png;base64,…        → used as-is
//   https://…                      → used as-is
//   /api/…  /static/…              → app host + path (cookie-gated, see below)
//   #media:… / ~/shot.png / /home/u/shot.png
//                                  → fetched with the app's cookie and shown
//                                    as a data URL (see readServerFile)
//
// Server files are cookie-gated, so the system browser can't open them — they
// are read in-app instead.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronRight, ImageOff, Share2, X } from 'lucide-react';
import { useApp } from '../../hooks/app-store';
import { base64ToUtf8, mediaPathFromHref } from '../../utils/messages';
import {
  getMediaCacheGeneration,
  mediaCacheKey,
  ratioCache,
  serverFileCache,
  serverFilePending,
} from '../../services/media-cache';
import { buildImageSource, shouldAttachDashboardCookie } from '../../services/media-policy';
import { cn } from '../../utils/cn';
import { Button } from '../ui/button';
import { Spinner } from '../ui/bits';
import * as api from '../../services/api';
import { MEDIA_FETCH_TIMEOUT_MS, PREVIEW_MAX_CHARS } from '../../services/constants';

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

/** True when `url` points at a different origin than the page. */
const isCrossOrigin = (url: string) => {
  try {
    return (
      new URL(url, globalThis.location?.href ?? 'http://localhost/').origin !==
      (globalThis.location?.origin ?? 'http://localhost')
    );
  } catch {
    return false;
  }
};

// Text-ish payloads get an in-app preview; anything else (pdf, zip, video…)
// says so rather than dumping mojibake into the transcript.
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
  opsGet: (path: string) => Promise<unknown>,
  path: string,
  cacheScope: string,
): Promise<string> {
  const cacheKey = mediaCacheKey(cacheScope, path);
  const generation = getMediaCacheGeneration();
  const hit = serverFileCache.get(cacheKey);
  if (hit !== undefined) return hit;
  const inflight = serverFilePending.get(cacheKey);
  if (inflight) return inflight;
  const fieldOf = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const attempts: [string, (r: unknown) => unknown][] = [
    [api.media(path), (r) => fieldOf(r).data_url],
    [api.mediaReadDataUrl(path), (r) => fieldOf(r).dataUrl],
    [api.mediaViaFiles(path), (r) => fieldOf(r).data_url],
  ];
  const p = (async () => {
    for (const [url, pick] of attempts) {
      try {
        // 15s ceiling per endpoint so a wedged server can't hang the thumbnail forever.
        const v = pick(
          await Promise.race([
            opsGet(url),
            new Promise((_, rej) => setTimeout(() => rej(new Error('media timeout')), MEDIA_FETCH_TIMEOUT_MS)),
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
      } catch (e) {
        console.warn('[media] server file fetch failed', e);
      }
    }
    return '';
  })().finally(() => {
    serverFilePending.delete(cacheKey);
  });
  serverFilePending.set(cacheKey, p);
  return p;
}

/** Share or download a resolved media URI. */
async function shareUri(uri: string, name?: string): Promise<void> {
  try {
    if (navigator.share) {
      await navigator.share({ url: uri });
      return;
    }
    const a = document.createElement('a');
    a.href = uri;
    a.download = name || 'hermes-download';
    a.rel = 'noopener';
    a.click();
  } catch {}
}

/**
 * Resolve a markdown image src into something `<img>` can load.
 *
 * A browser `<img>` has no header channel at all — the only credential it can
 * send is the cookie jar, and only if the request is same-origin or explicitly
 * opted into credentials.
 *
 * So: same-origin URLs are handed straight to `<img>` and the browser's own
 * cookie handling applies. Cross-origin ones are fetched with
 * `credentials: 'include'` and turned into a blob URL, because a
 * `SameSite=Lax` session cookie is not attached to a cross-site subresource
 * request and the image would otherwise render as broken.
 */
function useResolvedImage(src: string) {
  const { host, username, activeProfile, opsGet, getCookie } = useApp();
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const cacheScope = JSON.stringify([host, username, activeProfile, getCookie()]);
  // Object URLs handed out by the cross-origin branch, revoked when the src
  // changes — otherwise every scrolled-past bubble leaks its blob.
  const objectUrl = useRef<string | null>(null);

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
    if (isWebPath(p)) {
      const url = `${base(host)}${p}`;
      if (!isCrossOrigin(url)) return done(url);
      void fetch(url, { credentials: 'include' })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((blob) => {
          if (!alive) return;
          if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
          objectUrl.current = URL.createObjectURL(blob);
          done(objectUrl.current);
        })
        .catch(fail);
      return () => {
        alive = false;
      };
    }
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

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  // Kept for the cookie-leak guard: an external image must never receive the
  // dashboard session. The web path relies on the browser not offering a
  // header channel, but the decision is still worth making explicitly.
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
    <Button
      variant="outline"
      disabled={!openable}
      onClick={() => {
        if (url) window.open(url, '_blank', 'noopener');
      }}
      aria-label={alt || basename(p) || 'Open link'}
      className="my-1 h-auto sm:h-auto w-full justify-start gap-2 rounded-[10px] border border-border px-2.5 py-2">
      <ImageOff size={15} color={dark ? '#aaa' : '#777'} />
      <span className="flex-1 text-left text-[13px] text-neutral-600 dark:text-neutral-300 truncate">
        {alt || basename(p) || 'image'}
      </span>
      {openable && <ChevronRight size={14} color={dark ? '#aaa' : '#777'} />}
    </Button>
  );
}

/** Viewport width, tracked live. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() => globalThis.innerWidth || 1024);
  useEffect(() => {
    const onResize = () => setWidth(globalThis.innerWidth || 1024);
    globalThis.addEventListener('resize', onResize);
    return () => globalThis.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export function ChatImage({ src, alt, dark }: { src: string; alt?: string; dark: boolean }) {
  const { host } = useApp();
  const { uri, error, cookie, cacheScope } = useResolvedImage(src);
  const [ratio, setRatio] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const [decoded, setDecoded] = useState(false);
  const winW = useViewportWidth();
  // Pixel box, not `width: 100%`: markdown renders inline content inside a
  // paragraph, and a fixed width keeps a screenshot from filling the column.
  let boxW = Math.min(Math.round(winW * 0.62), 320);
  let boxH = ratio ? Math.round(boxW / ratio) : Math.round(boxW * 0.75);
  if (boxH > 340) {
    boxH = 340;
    if (ratio) boxW = Math.round(boxH * ratio);
  }
  // A DOM <img> takes a plain URL; the cookie is delivered by the browser's jar
  // (see useResolvedImage), so this only reads `uri`.
  const imgUri = useMemo(() => buildImageSource(uri ?? '', host, cookie).uri, [uri, host, cookie]);
  const boxStyle = useMemo(
    () => ({
      width: boxW,
      height: boxH,
      borderRadius: 10,
      backgroundColor: dark ? '#1b1b1b' : '#e9e9ee',
    }),
    [boxW, boxH, dark],
  );

  // Cached aspect ratios, so a re-visited image lays out at its true height on
  // the first frame instead of after the load lands. The <img> load event
  // carries the rendered pixel size, so this costs no extra probe.
  const rememberRatio = useCallback(
    (w: number, h: number) => {
      if (!uri || w <= 0 || h <= 0) return;
      const r = w / h;
      if (ratioCache.size > 200) {
        const oldest = ratioCache.keys().next().value;
        if (oldest !== undefined) ratioCache.delete(oldest);
      }
      ratioCache.set(mediaCacheKey(cacheScope, uri), r);
      setRatio(r);
    },
    [uri, cacheScope],
  );

  useEffect(() => {
    if (!uri) return;
    setDecoded(false);
    const cached = ratioCache.get(mediaCacheKey(cacheScope, uri));
    if (cached) setRatio(cached);
  }, [uri, cacheScope]);

  // Falls back to the file name so the viewer always has a caption.
  const caption = alt || basename(serverPath(src));

  if (error || broken) return <BrokenImage src={src} alt={alt} dark={dark} />;
  if (!uri) {
    return (
      <div
        className="flex flex-col my-1 items-center justify-center rounded-[10px]"
        style={{ width: boxW, height: 120, backgroundColor: dark ? '#1b1b1b' : '#e9e9ee', display: 'flex' }}>
        <Spinner size={14} color={dark ? '#888' : '#666'} />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => showPreview({ kind: 'image', uri, caption })}
      className="my-1 block"
      style={boxStyle}>
      <img
        src={imgUri}
        alt={caption}
        onLoad={(e) => {
          rememberRatio(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
          setDecoded(true);
        }}
        onError={() => setBroken(true)}
        // The box's own themed fill is the placeholder — no blurhash ships with
        // these sources — and the frame fades in over it once decoded.
        className={cn(
          'size-full object-contain transition-opacity duration-200',
          decoded ? 'opacity-100' : 'opacity-0',
        )}
        loading="lazy"
        decoding="async"
      />
    </button>
  );
}

// ── File link / preview ─────────────────────────────────────────────────────

type Preview = { kind: 'image'; uri: string; caption?: string } | { kind: 'text'; text: string } | { kind: 'other' };

// Markdown renders link tokens inline, so a modal cannot be nested inside them.
// The preview therefore lives in one host mounted at the app root and is driven
// through this tiny store.
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
  const { host, getCookie } = useApp();
  const previewCookie = preview?.kind === 'image' && shouldAttachDashboardCookie(preview.uri, host) ? getCookie() : '';
  return (
    <DialogPrimitive.Root open={!!preview} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col outline-hidden"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 44px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
          }}>
          <DialogPrimitive.Title className="sr-only">File preview</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Preview of the selected file. Click outside the content to close.
          </DialogPrimitive.Description>
          {preview?.kind === 'image' ? (
            <>
              <button type="button" className="flex flex-1 items-center justify-center p-3" onClick={onClose}>
                <img
                  src={buildImageSource(preview.uri, host, previewCookie).uri}
                  alt={preview.caption ?? ''}
                  className="size-full object-contain"
                />
              </button>
              {!!preview.caption && (
                <div className="px-4 pb-1 text-center text-xs text-white/70 line-clamp-3">{preview.caption}</div>
              )}
            </>
          ) : preview?.kind === 'text' ? (
            <div className="mx-3 overflow-y-auto rounded-xl bg-popover/5 p-3">
              <div className="select-text whitespace-pre-wrap text-[13px] leading-[19px] text-white/90">
                {preview.text || '(empty file)'}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
              <ImageOff size={28} color="#888" />
              <div className="text-center text-sm text-white/70">Can’t preview this file type in the app.</div>
              <div className="text-center text-xs text-white/40">Open it from the Files tab instead.</div>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close preview"
            className="absolute right-3 h-10 w-10 rounded-full bg-popover/15"
            style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
            <X size={20} color="#fff" />
          </Button>
          {(preview?.kind === 'image' || preview?.kind === 'text') && (
            <Button
              variant="ghost"
              onClick={() => {
                if (preview.kind === 'image') void shareUri(preview.uri, preview.caption);
                else if (preview.kind === 'text') void navigator.share?.({ text: preview.text });
              }}
              aria-label="Share"
              className="absolute left-3 h-auto sm:h-auto gap-1.5 rounded-full bg-popover/15 px-3 py-2"
              style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
              <Share2 size={16} color="#fff" />
              <span className="text-[12px] font-semibold text-white">Share</span>
            </Button>
          )}
          <div className="pt-2 text-center text-[11px] text-white/30">tap to close</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function FileChip({ href, label, className }: { href: string; label: string; className?: string }) {
  const { host, username, activeProfile, opsGet, getCookie } = useApp();
  const [busy, setBusy] = useState(false);

  const open = useCallback(async () => {
    const path = pathOfHref(href);
    if (!path) {
      const url = isRemote(href) ? href : `${base(host)}${href}`;
      window.open(url, '_blank', 'noopener');
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

  // Inline element: markdown puts link tokens inside a paragraph, so this must
  // stay inline and must not introduce a block box.
  return (
    <button type="button" onClick={() => void open()} className={`inline ${className ?? ''}`}>
      {busy ? '… ' : '📎 '}
      {label}
    </button>
  );
}
