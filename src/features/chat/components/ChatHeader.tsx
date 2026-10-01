// Chat top bar — the normal header and the in-transcript search header.
// Extracted from index.tsx to keep the screen focused on orchestration.
//
// No `insetTop` prop: the browser knows the safe area, so the bar reads
// `env(safe-area-inset-top)` directly.
import { ChevronDown, ChevronUp, Info, MoreVertical, Search, X } from 'lucide-react';
import { CtxRing, HamburgerBtn } from '../../../components/ui/bits';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';

/** The 52px bar plus whatever the OS inset wants above it. */
const barStyle = {
  height: 'calc(env(safe-area-inset-top, 0px) + 52px)',
  paddingTop: 'env(safe-area-inset-top, 0px)',
} as const;

export function ChatNormalHeader({
  dark,
  iconColor,
  title,
  contextPercent,
  contextTone,
  onOpenSearch,
  onSelectInfo,
  onOpenInfo,
}: {
  dark: boolean;
  iconColor: string;
  title: string;
  contextPercent: number | null;
  contextTone: 'ok' | 'warn' | 'hot';
  onOpenSearch: () => void;
  onSelectInfo: () => void;
  onOpenInfo: () => void;
}) {
  return (
    <header className={`shrink-0 ${dark ? 'bg-black' : 'bg-white'}`} style={barStyle}>
      <div className="flex h-[52px] items-center gap-1 px-2">
        <div className="w-11 shrink-0">
          <HamburgerBtn />
        </div>
        <h1 className="min-w-0 flex-1 truncate px-1 text-[17px] font-semibold text-neutral-950 dark:text-neutral-100">
          {title}
        </h1>
        <div className="flex items-center gap-1">
          {contextPercent != null && (
            <CtxRing pct={contextPercent} tone={contextTone} dark={dark} onPress={onOpenInfo} />
          )}
          <Button
            variant="ghost"
            size="icon"
            data-testid="search-open"
            aria-label="Search conversation"
            onClick={onOpenSearch}>
            <Search size={20} color={iconColor} />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="kebab-btn" aria-label="Chat menu">
                <MoreVertical size={20} color={iconColor} />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="p-1.5">
              <PopoverClose asChild>
                <Button
                  variant="ghost"
                  data-testid="menu-info"
                  onClick={onSelectInfo}
                  className="w-full items-center justify-start gap-2.5 px-3 py-2.5">
                  <Info size={17} color={iconColor} />
                  <span className="text-left text-[15px]">Session info</span>
                </Button>
              </PopoverClose>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  );
}

export function ChatSearchHeader({
  dark,
  iconColor,
  query,
  matchIndex,
  matchCount,
  onChangeQuery,
  onPrevious,
  onNext,
  onClose,
}: {
  dark: boolean;
  iconColor: string;
  query: string;
  matchIndex: number;
  matchCount: number;
  onChangeQuery: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const hasQuery = query.trim().length > 0;
  const disabledColor = dark ? '#666' : '#aaa';
  return (
    <header className={`shrink-0 ${dark ? 'bg-black' : 'bg-white'}`} style={barStyle}>
      <div className="flex h-[52px] items-center gap-1 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="frame-focus flex h-11 min-w-0 flex-1 items-center gap-1 rounded-xl border border-neutral-200 bg-[#f4f4f6] px-3 dark:border-neutral-700 dark:bg-[#212121]">
            <Search size={18} color={dark ? '#aaa' : '#666'} />
            <Input
              data-testid="conversation-search"
              aria-label="Search conversation"
              // The pill around this draws the field; the base border inside it
              // would read as a frame within a frame, and dark:bg-transparent is
              // needed because the base sets dark:bg-input/30.
              className="ml-2 min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-[16px] text-neutral-950 shadow-none focus-visible:ring-0 dark:bg-transparent dark:text-neutral-100"
              value={query}
              onChange={(e) => onChangeQuery(e.target.value)}
              placeholder="Search conversation…"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
              enterKeyHint="search"
              style={{ caretColor: '#1a73e8', colorScheme: dark ? 'dark' : 'light' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onNext();
                }
              }}
            />
            {hasQuery && (
              <span className="ml-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                {matchCount ? matchIndex + 1 : 0}/{matchCount}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            data-testid="search-prev"
            aria-label="Previous search match"
            onClick={onPrevious}
            disabled={!matchCount}
            className="h-11 w-10">
            <ChevronUp size={20} color={matchCount ? iconColor : disabledColor} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            data-testid="search-next"
            aria-label="Next search match"
            onClick={onNext}
            disabled={!matchCount}
            className="h-11 w-10">
            <ChevronDown size={20} color={matchCount ? iconColor : disabledColor} />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          data-testid="search-close"
          aria-label="Close conversation search"
          onClick={onClose}
          className="h-11 w-10">
          <X size={22} color={iconColor} />
        </Button>
      </div>
    </header>
  );
}
