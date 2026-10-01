// Chat top bar.
// Extracted from index.tsx to keep the screen focused on orchestration.
//
// No `insetTop` prop: the browser knows the safe area, so the bar reads
// `env(safe-area-inset-top)` directly.
//
// This used to hold a second export, `ChatSearchHeader` — an in-conversation
// search bar with next/prev match controls. It, and the state behind it, are
// gone: the feature was unused, and it was the only caller of the store's
// `searchTranscript`/`findHitIndex` pair and of `messageMatchesSearch`.
import { Info, MoreVertical } from 'lucide-react';
import { CtxRing, HamburgerBtn } from '../../../components/ui/bits';
import { Button } from '../../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';

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
  onSelectInfo,
  onOpenInfo,
}: {
  dark: boolean;
  iconColor: string;
  title: string;
  contextPercent: number | null;
  contextTone: 'ok' | 'warn' | 'hot';
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
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" data-testid="kebab-btn" aria-label="Chat menu" />}>
              <MoreVertical size={20} color={iconColor} />
            </DropdownMenuTrigger>
            {/* `w-44` because the content's default is `w-(--anchor-width)` —
                the menu matches its trigger, which is right for a text trigger
                and wrong for this one: the kebab is a 36px icon button, so the
                menu came out clamped to `min-w-32` (128px) and "Session info"
                wrapped onto two lines. */}
            <DropdownMenuContent side="bottom" align="end" className="w-44">
              <DropdownMenuItem
                data-testid="menu-info"
                onClick={onSelectInfo}
                className="w-full items-center justify-start gap-2.5 px-3 py-2.5">
                <Info size={17} color={iconColor} />
                <span className="text-left text-[15px]">Session info</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
