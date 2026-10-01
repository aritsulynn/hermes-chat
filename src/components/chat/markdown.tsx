// Markdown rendering for chat bubbles.
//
// react-markdown with a `components` map keyed by tag name. The theme argument
// is only *which bubble* (assistant ink vs the user's blue chip); light/dark is
// handled by `dark:` variants keyed off the `.dark` class the store puts on
// <html>. Because react-markdown has a real styles channel there is no factory
// over `dark`, so `mdComponents` depends only on the bubble role.
import Markdown from 'react-markdown';
import { memo } from 'react';
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
 *
 * The metrics are tuned for Thai, which is what this transcript is mostly in:
 * tone marks stack above the line and vowel signs hang below it, so a leading
 * that reads as comfortable for Latin (1.4) crowds the glyphs together and makes
 * a paragraph look like a solid block. 24px on 15px is 1.6, which gives the
 * marks room without looking airy.
 *
 * Paragraph and list spacing is deliberately looser than the 4px this used to
 * have: the agent answers in short labelled paragraphs, and 4px between them
 * reads as one run-on block rather than an answer you can scan.
 */
const C = {
  ai: {
    body: 'text-[15px] leading-[24px] text-[#111] dark:text-[#e8e8ea]',
    h1: 'my-3 text-[20px] font-bold leading-snug text-[#111] dark:text-[#e8e8ea]',
    h2: 'my-3 text-[18px] font-bold leading-snug text-[#111] dark:text-[#e8e8ea]',
    h3: 'my-2.5 text-[16px] font-bold leading-snug text-[#111] dark:text-[#e8e8ea]',
    p: 'my-2',
    list: 'my-2 pl-5',
    li: 'my-1 [&>p]:my-0 has-[>input]:list-none',
    link: 'text-[#1a73e8] underline underline-offset-2 dark:text-[#7aa7ff]',
    quote:
      'my-2 border-l-[3px] border-l-[#1a73e8] bg-[#e8eef7] px-2.5 py-1.5 dark:border-l-[#7aa7ff] dark:bg-[#232a3a]',
    code: 'rounded bg-[#e4e4e8] px-1 py-0.5 text-[13px] dark:bg-[#2b2b31]',
    fence: 'my-2 overflow-hidden rounded-lg',
    fenceHead: 'flex items-center justify-between px-2.5 pb-0.5 pt-1.5',
    fenceLang: 'text-[11px] text-[#8a8a8a] dark:text-[#9aa0a6]',
    hr: 'my-3 border-t border-[#ddd] dark:border-[#333]',
  },
  user: {
    body: 'text-[15px] leading-[24px] text-[#041e49] dark:text-[#f3f4f6]',
    h1: 'my-3 text-[20px] font-bold leading-snug text-[#041e49] dark:text-[#f3f4f6]',
    h2: 'my-3 text-[18px] font-bold leading-snug text-[#041e49] dark:text-[#f3f4f6]',
    h3: 'my-2.5 text-[16px] font-bold leading-snug text-[#041e49] dark:text-[#f3f4f6]',
    p: 'my-2',
    list: 'my-2 pl-5',
    li: 'my-1 [&>p]:my-0 has-[>input]:list-none',
    link: 'text-[#0b57d0] underline underline-offset-2 dark:text-[#93c5fd]',
    quote:
      'my-2 border-l-[3px] border-l-[#0b57d0] bg-[rgba(4,30,73,.08)] px-2.5 py-1.5 dark:border-l-[#93c5fd] dark:bg-[rgba(147,197,253,.12)]',
    code: 'rounded bg-[rgba(4,30,73,.1)] px-1 py-0.5 text-[13px] dark:bg-[rgba(255,255,255,.1)]',
    fence: 'my-2 overflow-hidden rounded-lg',
    fenceHead: 'flex items-center justify-between px-2.5 pb-0.5 pt-1.5',
    fenceLang: 'text-[11px] text-[#8a8a8a] dark:text-[#9aa0a6]',
    hr: 'my-3 border-t border-[rgba(4,30,73,.2)] dark:border-t-[rgba(255,255,255,.2)]',
  },
} as const;

/**
 * Table chrome.
 *
 * Not part of `C`, because a table rides on whatever surface its bubble has —
 * grey for the assistant, a darker grey for yours, and a different pair again in
 * dark mode. Rules are drawn with alpha rather than fixed hexes so they read on
 * all four instead of suiting one and vanishing on the rest.
 *
 * The three things that make a markdown table hard to read in a chat bubble, and
 * what each is for:
 *   - no rule between rows, so the eye loses the row crossing a wide table → a
 *     bottom border per row, and a hover tint to track one under the pointer
 *   - a header that looks like any other row → a tinted header band, and the
 *     header carries the only bold text in the table
 *   - `width: 100%`, which stretches three short columns across the whole bubble
 *     and leaves the value stranded from its header → auto width, so a small
 *     table stays small and only a genuinely wide one fills the row
 *
 * `overflow-x-auto` is the backstop: a table too wide for the bubble scrolls
 * inside its own frame rather than widening the transcript.
 *
 * `w-fit` is what keeps the frame around the table rather than around the row.
 * The wrapper is a block, so without it the frame stretches to the bubble's full
 * width and the border closes a couple of hundred pixels past the last column —
 * a table that reads as broken even though the table itself is the right size.
 * With it the frame hugs the table, and `max-w-full` still caps a genuinely wide
 * one so it scrolls instead of escaping.
 */
const T = {
  wrap: 'my-3 w-fit max-w-full overflow-x-auto rounded-lg border border-black/[0.12] dark:border-white/[0.14]',
  table: 'border-collapse text-[13px]',
  head: 'bg-black/[0.045] dark:bg-white/[0.06]',
  row: 'border-b border-black/[0.08] hover:bg-black/[0.02] dark:border-white/[0.1] dark:hover:bg-white/[0.03]',
  body: '[&>tr:last-child]:border-0',
  // 20px on 13px text: cells inherit the body's 24px otherwise, which is a
  // reading measure for 15px prose and makes a table's rows airy and slow to
  // scan.
  th: 'px-3 py-2 text-left align-middle leading-[20px] font-semibold',
  td: 'px-3 py-2 align-middle leading-[20px]',
};

/**
 * GFM's column alignment reaches a `<th>`/`<td>` as the deprecated `align`
 * attribute, whose React type also carries HTML-only values (`char`, `justify`)
 * that are not CSS `text-align` keywords. Only the three GFM can emit are passed
 * through; anything else falls back to the cell's own `text-left`.
 */
function textAlignOf(align: string | undefined): 'left' | 'center' | 'right' | undefined {
  return align === 'left' || align === 'center' || align === 'right' ? align : undefined;
}

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
    // The `has-[>input]` case is a GFM task item: hiding the bullet leaves the
    // checkbox as the marker rather than drawing both side by side.
    li: ({ children }) => <li className={`${c.li} [&>input]:mr-1.5 [&>input]:align-middle`}>{children}</li>,
    blockquote: ({ children }) => <blockquote className={c.quote}>{children}</blockquote>,
    hr: () => <hr className={c.hr} />,
    // Wrapped, because `border-radius` on the table itself is ignored under
    // `border-collapse` — the frame needs an ancestor that clips.
    table: ({ children }) => (
      <div className={T.wrap}>
        <table className={T.table}>{children}</table>
      </div>
    ),
    // `last:border-0` lives on the body, not on `tr`: the head's single row is
    // also a last child, and dropping its border would remove the header rule.
    thead: ({ children }) => <thead className={T.head}>{children}</thead>,
    tbody: ({ children }) => <tbody className={T.body}>{children}</tbody>,
    tr: ({ children }) => <tr className={T.row}>{children}</tr>,
    // GFM column alignment (`|:---:|`) arrives as the deprecated `align`
    // attribute, whose React type also carries HTML-only values (`char`,
    // `justify`) that are not CSS `text-align` keywords — so only the three GFM
    // can actually emit are passed through. These overrides drop extra props, so
    // it is carried to `style` rather than spread (the alternative is leaking
    // react-markdown's own `node` prop onto a DOM element).
    th: ({ children, align }) => (
      <th className={T.th} style={{ textAlign: textAlignOf(align) }}>
        {children}
      </th>
    ),
    td: ({ children, align }) => (
      <td className={T.td} style={{ textAlign: textAlignOf(align) }}>
        {children}
      </td>
    ),

    // Inline code. Block code never reaches here — it is intercepted in `pre`.
    code: ({ children, className: codeClass }) => (codeClass ? null : <code className={c.code}>{children}</code>),

    pre: ({ children }) => {
      // react-markdown hands `pre` the <code> element; the language lives in its
      // className as `language-xxx`.
      const child = Array.isArray(children) ? children[0] : children;
      const codeEl = child as React.ReactElement<{ className?: string; children?: React.ReactNode }> | undefined;
      const lang = String(codeEl?.props?.className ?? '')
        .replace(/^language-/, '')
        .trim();
      return (
        <CodeBlock theme={theme} lang={lang || 'code'} code={textOf(codeEl?.props?.children).replace(/\n$/, '')} />
      );
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

/**
 * A markdown body, memoised on its body string.
 *
 * The streaming bubble is re-rendered on every reveal tick. `splitSettled`
 * divides a streaming reply at its last blank line and hands each half here;
 * because the split is a block boundary, each half is a complete markdown
 * document and the pair renders exactly as the whole would. The completed half
 * keeps the same `body`, so memo lets it skip the re-parse and only the block
 * still being written is parsed per frame.
 */
export const ChatMarkdown = memo(function ChatMarkdown({
  body,
  theme,
  dark,
}: {
  body: string;
  theme: MdTheme;
  dark: boolean;
}) {
  return (
    // The wrapper carries the body ink; the elements below only override
    // margins and the few things that need their own colour (code, links).
    <div className={C[theme].body}>
      <Markdown remarkPlugins={REMARK} components={mdComponents(theme, dark)}>
        {body}
      </Markdown>
    </div>
  );
});

export { MARKDOWN_INK };
