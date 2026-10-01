// Chat top bar — a thin wrapper over the shared `ScreenHeader`.
//
// The bar was always the same shape as every other screen's: hamburger, title,
// right-hand actions. It stayed a separate component only because it predates
// `ScreenHeader` gaining an `actions` node. Now it just supplies chat's own
// controls (the context ring + the session menu) and drops the subtitle, which
// is the only real difference left.
//
// The chat screen wraps this in an absolute glass region so the transcript
// scrolls under it; see the overlay in chat/index.tsx. No `insetTop` prop: the
// safe area is a CSS variable now.
import { Info, PencilRuler } from 'lucide-react';
import { CtxRing, headerIconButtonClass, ScreenHeader } from '../../../components/ui/bits';
import { Button } from '../../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';

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
    <ScreenHeader
      title={title}
      actions={
        <div className="flex items-center gap-1">
          {contextPercent != null && (
            <CtxRing pct={contextPercent} tone={contextTone} dark={dark} onPress={onOpenInfo} />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="kebab-btn"
                  aria-label="Chat menu"
                  className={headerIconButtonClass}
                />
              }>
              <PencilRuler size={20} color={iconColor} />
            </DropdownMenuTrigger>
            {/* `w-44` because the content's default is `w-(--anchor-width)` —
                the menu matches its trigger, which is right for a text trigger
                and wrong for this one: the menu button is a 40px icon button, so
                the menu came out clamped to `min-w-32` (128px) and "Session
                info" wrapped onto two lines. */}
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
      }
    />
  );
}
