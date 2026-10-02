// Themed modal dialog + the confirmation helper every destructive action in the
// app used to fire through React Native's `Alert.alert`.
//
// `ConfirmDialog` is the reason this file exists and the reason it is worth
// keeping as its own component: it is the single place a destructive action is
// confirmed, and every one of them routes through it.
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogClose = DialogPrimitive.Close;

function DialogPortal({ children }: { children?: React.ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      {/*
        The Overlay is the full-screen backdrop that dismisses on outside click.
        Radix handles the outside-press itself and stops clicks on the content
        from reaching it.
      */}
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
        {children}
      </DialogPrimitive.Overlay>
    </DialogPrimitive.Portal>
  );
}

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Content
      className={cn(
        'bg-popover border-border data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 w-full max-w-[320px] gap-3 rounded-2xl border p-5 shadow-lg shadow-black/10',
        className,
      )}
      {...props}>
      {children}
    </DialogPrimitive.Content>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-[17px] font-semibold', className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-[15px] leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mt-1 flex justify-end gap-2', className)} {...props} />;
}

/**
 * Drop-in replacement for `Alert.alert(title, message, [Cancel, Confirm])`.
 * Renders nothing while closed, so callers only need the `open` state:
 *
 *   const [confirm, setConfirm] = useState<{ title: string; body?: string; run: () => void } | null>(null);
 *   ...
 *   <ConfirmDialog
 *     open={!!confirm}
 *     title={confirm?.title}
 *     description={confirm?.body}
 *     destructive
 *     onConfirm={() => confirm?.run()}
 *     onOpenChange={(o) => !o && setConfirm(null)}
 *   />
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogContent>
          <DialogTitle>{title}</DialogTitle>
          {!!description && <DialogDescription>{description}</DialogDescription>}
          {children}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm" className="h-10 rounded-xl px-4">
                <span className="text-[15px]">{cancelLabel}</span>
              </Button>
            </DialogClose>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              size="sm"
              className="h-10 rounded-xl px-4"
              onClick={() => {
                // Close first: the work behind onConfirm is async, and leaving
                // the dialog up would block the screen it is reporting on.
                onOpenChange(false);
                onConfirm();
              }}>
              <span className="text-[15px] font-semibold">{confirmLabel}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export {
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
