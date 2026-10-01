// Markdown rendering for chat bubbles.
//
// react-markdown with a `components` map keyed by tag name. The theme argument
// is only *which bubble* (assistant ink vs the user's blue chip); light/dark is
// handled by `dark:` variants keyed off the `.dark` class the store puts on
// <html>. Because react-markdown has a real styles channel there is no factory
// over `dark`, so `mdComponents` depends only on the bubble role.
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { ChatImage, FileChip } from './media';
import { CODE_SURFACE, MARKDOWN_INK, brandColor } from '../../theme';

/**
 * Which bubble the markdown sits in. This is the only styling axis left: the
 * scheme is handled by `dark:` variants, so there is no `dark` parameter and no
 * reason for these to be objects built per render.
 */
export type MdTheme = 'ai' | 'user';

/** Pull the plain text out of a React node, for the code-block copy button. */
function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in (node as any)) {
    return textOf((node as any).props?.children);
  }
  return '';
}

/** GFM tables, task lists and strikethrough are all cheap to enable and the
 *  agent emits them; without remark-gfm they render as literal `|`. */
const REMARK = [remarkGfm];

/**
 * Class strings per theme. Kept as one object per element rather than a cva
 * call so the light/dark pair sits on a single line where they are compared.
 */
const C = {
  ai: {
    body: 'text-[15px] leading-[21px] text-[#111] dark:text-[#e8e8ea]',
    h1: 'my-1.5 text-[20px] font-bold leading-tight text-[#111] dark:text-[#e8e8ea]',
    h2: 'my-1.5 text-[18px] font-bold leading-tight text-[#111] dark:text-[#e8e8ea]',
    h3: 'my-1 text-[16px] font-bold leading-snug text-[#111] dark:text-[#e8e8ea]',
    p: 'my-1',
    list: 'my-1 pl-5',
    li: 'my-0.5',
    link: 'text-[#1a73e8] underline underline-offset-2 dark:text-[#7aa7ff]',
    quote:
      'my-1 border-l-[3px] border-l-[#1a73e8] bg-[#e8eef7] px-2 py-1 dark:border-l-[#7aa7ff] dark:bg-[#232a3a]',
    code: 'rounded bg-[#e4e4e8] px-1 py-0.5 text-[13px] dark:bg-[#2b2b31]',
    fence: 'my-1 overflow-hidden rounded-lg',
    fenceHead: 'flex items-center justify-between px-2 pb-0.5 pt-1.5',
    fenceLang: 'text-[11px] text-[#8a8a8a] dark:text-[#9aa0a6]',
    hr: 'my-2 border-t border-[#ddd] dark:border-[#333]',
    table: 'my-2 w-full border-collapse overflow-hidden rounded-md border border-[#ddd] text-[13px] dark:border-[#333]',
    th: 'border-b border-[#eee] px-1.5 py-1.5 text-left font-bold dark:border-[#222]',
    td: 'px-1.5 py-1.5',
  },
  user: {
    body: 'text-[15px] leading-[21px] text-[#041e49] dark:text-[#f3f4f6]',
    h1: 'my-1.5 text-[20px] font-bold leading-tight text-[#041e49] dark:text-[#f3f4f6]',
    h2: 'my-1.5 text-[18px] font-bold leading-tight text-[#041e49] dark:text-[#f3f4f6]',
    h3: 'my-1 text-[16px] font-bold leading-snug text-[#041e49] dark:text-[#f3f4f6]',
    p: 'my-1',
    list: 'my-1 pl-5',
    li: 'my-0.5',
    link: 'text-[#0b57d0] underline underline-offset-2 dark:text-[#93c5fd]',
    quote:
      'my-1 border-l-[3px] border-l-[#0b57d0] bg-[rgba(4,30,73,.08)] px-2 py-1 dark:border-l-[#93c5fd] dark:bg-[rgba(147,197,253,.12)]',
    code: 'rounded bg-[rgba(4,30,73,.1)] px-1 py-0.5 text-[13px] dark:bg-[rgba(255,255,255,.1)]',
    fence: 'my-1 overflow-hidden rounded-lg',
    fenceHead: 'flex items-center justify-between px-2 pb-0.5 pt-1.5',
    fenceLang: 'text-[11px] text-[#8a8a8a] dark:text-[#9aa0a6]',
    hr: 'my-2 border-t border-[rgba(4,30,73,.2)] dark:border-t-[rgba(255,255,255,.2)]',
    table: 'my-2 w-full border-collapse overflow-hidden rounded-md border border-[#ddd] text-[13px] dark:border-[#333]',
    th: 'border-b border-[#eee] px-1.5 py-1.5 text-left font-bold dark:border-[#222]',
    td: 'px-1.5 py-1.5',
  },
} as const;

function CodeBlock({ theme, code, lang }: { theme: MdTheme; code: string; lang: string }) {
  const c = C[theme];
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(code);
    } catch {}
  };
  return (
    <div className={c.fence} style={{ background: CODE_SURFACE }}>
      <div className={c.fenceHead}>
        <span className={c.fenceLang}>{lang}</span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy code block"
          className="rounded px-1 py-0.5 text-[11px] font-semibold hover:bg-white/10"
          style={{ color: brandColor(false) }}>
          Copy
        </button>
      </div>
      <pre className="overflow-x-auto px-2.5 pb-2.5 text-[13px] leading-[19px] text-[#e8e8ea]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * The react-markdown component map for one bubble theme.
 *
 * Memoised per theme by the caller, or not: this object is small and stable, so
 * building it on each render costs less than remembering to. The heavy work
 * (parsing) is memoised one level up in MessageBubble.
 */
export function mdComponents(theme: MdTheme, dark: boolean): Components {
  const c = C[theme];
  return {
    p: ({ children }) => <p className={c.p}>{children}</p>,
    h1: ({ children }) => <h1 className={c.h1}>{children}</h1>,
    h2: ({ children }) => <h2 className={c.h2}>{children}</h2>,
    h3: ({ children }) => <h3 className={c.h3}>{children}</h3>,
    h4: ({ children }) => <h4 className="my-1 text-[15px] font-bold">{children}</h4>,
    ul: ({ children }) => <ul className={`list-disc ${c.list}`}>{children}</ul>,
    ol: ({ children }) => <ol className={`list-decimal ${c.list}`}>{children}</ol>,
    li: ({ children }) => <li className={c.li}>{children}</li>,
    blockquote: ({ children }) => <blockquote className={c.quote}>{children}</blockquote>,
    hr: () => <hr className={c.hr} />,
    table: ({ children }) => <table className={c.table}>{children}</table>,
    th: ({ children }) => <th className={c.th}>{children}</th>,
    td: ({ children }) => <td className={c.td}>{children}</td>,

    // Inline code. Block code never reaches here — it is intercepted in `pre`.
    code: ({ children, className: codeClass }) =>
      codeClass ? null : <code className={c.code}>{children}</code>,

    pre: ({ children }) => {
      // react-markdown hands `pre` the <code> element; the language lives in its
      // className as `language-xxx`.
      const child = Array.isArray(children) ? children[0] : children;
      const codeEl = child as React.ReactElement<{ className?: string; children?: React.ReactNode }> | undefined;
      const lang = String(codeEl?.props?.className ?? '')
        .replace(/^language-/, '')
        .trim();
      return <CodeBlock theme={theme} lang={lang || 'code'} code={textOf(codeEl?.props?.children).replace(/\n$/, '')} />;
    },

    // The library default renders a plain <img>, which cannot carry the
    // dashboard session or open the in-app viewer — see media.tsx.
    img: ({ src, alt }) => {
      const s = typeof src === 'string' ? src : '';
      if (!s) return null;
      return <ChatImage src={s} alt={alt || undefined} dark={dark} />;
    },

    // Web links keep the normal look and open in a new tab; anything pointing
    // at a file on the server becomes a chip that previews it in-app, because
    // those are cookie-gated and a plain link would just 401.
    a: ({ href, children }) => {
      const h = typeof href === 'string' ? href : '';
      if (/^(https?|mailto|tel):/i.test(h)) {
        return (
          <a href={h} target="_blank" rel="noopener noreferrer" className={c.link}>
            {children}
          </a>
        );
      }
      if (!h) return <>{children}</>;
      return <FileChip href={h} label={textOf(children).trim() || h} className={c.link} />;
    },
  };
}

export function ChatMarkdown({ body, theme, dark }: { body: string; theme: MdTheme; dark: boolean }) {
  return (
    // The wrapper carries the body ink; the elements below only override
    // margins and the few things that need their own colour (code, links).
    <div className={C[theme].body}>
      <Markdown remarkPlugins={REMARK} components={mdComponents(theme, dark)}>
        {body}
      </Markdown>
    </div>
  );
}

export { MARKDOWN_INK };
