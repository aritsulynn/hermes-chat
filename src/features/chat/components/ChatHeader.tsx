// Chat top bar — a thin wrapper over the shared `ScreenHeader`.
//
// The bar was always the same shape as every other screen's: hamburger, title,
// right-hand actions. It stayed a separate component only because it predates
// `ScreenHeader` gaining an `actions` node. Now it just supplies chat's own
// control (the context ring) and drops the subtitle, which is the only real
// difference left.
//
// No `insetTop` prop: the safe area is a CSS variable now.
import { CtxRingBody, ScreenHeader } from '../../../components/ui/bits';
import { compactNumber } from '../../../utils/format';
import { Button } from '../../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { Download } from 'lucide-react';

export function ChatNormalHeader({
  dark,
  title,
  contextPercent,
  contextTone,
  contextUsed,
  contextMax,
  input,
  output,
  costUsd,
  subagents,
  onExport,
}: {
  dark: boolean;
  title: string;
  contextPercent: number | null;
  contextTone: 'ok' | 'warn' | 'hot';
  /** The token/cost figures for the dropdown; absent on an older gateway. */
  contextUsed?: number | null;
  contextMax?: number | null;
  input?: number | null;
  output?: number | null;
  costUsd?: number | null;
  subagents?: number | null;
  /** Download the open session as JSON. */
  onExport?: () => void;
}) {
  // The ring is a menu: a header badge is a one-tap summary, and the numbers
  // behind it are four separate fields that have no other home in the UI.
  const headerIcon = dark ? '#a3a3a3' : '#555';
  const ctxLabel = contextPercent != null ? `${parseFloat(contextPercent.toFixed(1))}%` : '';
  const ctxRow = (k: string, v: string) => (
    <div className="flex items-center justify-between gap-4 px-3 py-1.5">
      <span className="text-[13px] text-neutral-500 dark:text-neutral-400">{k}</span>
      <span className="font-mono text-[13px] font-medium text-neutral-950 dark:text-neutral-100">{v}</span>
    </div>
  );
  return (
    <ScreenHeader
      title={title}
      actions={
        <div className="flex items-center gap-1">
          {contextPercent != null && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    data-testid="ctx-ring"
                    aria-label={`Context ${ctxLabel} — open usage`}
                    className="h-9 rounded-full px-2"
                    style={{ width: 'auto', height: 36 }}
                  />
                }>
                <CtxRingBody pct={contextPercent} tone={contextTone} dark={dark} />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="end" className="w-60 p-1.5">
                <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Context
                </div>
                {ctxRow('Used', contextUsed != null ? compactNumber(contextUsed) : '—')}
                {ctxRow('Window', contextMax != null ? compactNumber(contextMax) : '—')}
                {input != null && ctxRow('Input', compactNumber(input))}
                {output != null && ctxRow('Output', compactNumber(output))}
                {costUsd != null && costUsd > 0 && ctxRow('Cost', `$${costUsd.toFixed(2)}`)}
                {subagents != null && subagents > 0 && ctxRow('Subagents', String(subagents))}
                {onExport && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onExport} className="gap-2">
                      <Download size={15} color={headerIcon} />
                      <span className="text-[13px] text-neutral-800 dark:text-neutral-200">Export session</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      }
    />
  );
}
