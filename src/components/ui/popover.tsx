// Popover, on Base UI. This is the Base UI counterpart of the Radix `popover`
// shadcn used to ship, matching the `dropdown-menu` migration (see
// ui/dropdown-menu.tsx for why that split exists).
//
// The two libraries compose differently, and that bites when porting call
// sites: Radix composes with `asChild`, Base UI composes with `render`.
//
//   Radix:   <PopoverTrigger asChild><Button /></PopoverTrigger>
//   Base UI: <PopoverTrigger render={<Button />}>…</PopoverTrigger>
//
// Animation states are `data-open` / `data-closed` (and the trigger's open
// state `data-popup-open`), where Radix said `data-[state=open]`. Positioning
// is split in two: `align` / `side` / offsets live on the Positioner, while
// the visual panel is the Popup.
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from '@/utils/cn';

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

function PopoverContent({
  align = 'center',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  className,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50 outline-none">
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'bg-popover text-popover-foreground border-border data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--transform-origin) cursor-auto rounded-md border p-4 shadow-md shadow-black/5 outline-hidden',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverClose, PopoverContent, PopoverTrigger };
