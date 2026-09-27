// Themed modal dialog + the confirmation helper every destructive action in the
// app used to fire through React Native's `Alert.alert`.
//
// Structure mirrors popover.tsx: the primitive Overlay is the full-screen
// Pressable that dismisses on outside tap, and the content is nested inside it.
// DialogPrimitive.Content claims the responder (onStartShouldSetResponder), so
// taps on the card never reach the backdrop. Dialog.Root takes a controlled
// `open`, which is what lets callers await a choice instead of getting a
// fire-and-forget callback.
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { Button } from '@/components/ui/button';
import { Text as UIText } from '@/components/ui/text';
import { cn } from '@/utils/cn';
import * as DialogPrimitive from '@rn-primitives/dialog';
import * as React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogClose = DialogPrimitive.Close;

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : React.Fragment;

function DialogPortal({
  forceMount,
  children,
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return (
    <DialogPrimitive.Portal forceMount={forceMount}>
      <FullWindowOverlay>
        <DialogPrimitive.Overlay
          className={cn('bg-black/60', Platform.select({ web: 'fixed inset-0 z-50' }))}
          style={Platform.select({ native: StyleSheet.absoluteFill })}
          asChild={Platform.OS !== 'web'}>
          <NativeOnlyAnimatedView
            entering={FadeIn.duration(200).reduceMotion(ReduceMotion.System)}
            exiting={FadeOut.duration(150).reduceMotion(ReduceMotion.System)}
            as="Pressable">
            <View className="flex-1 items-center justify-center p-6">{children}</View>
          </NativeOnlyAnimatedView>
        </DialogPrimitive.Overlay>
      </FullWindowOverlay>
    </DialogPrimitive.Portal>
  );
}

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Content
      className={cn(
        'bg-popover border-border w-full max-w-[320px] gap-3 rounded-2xl border p-5 shadow-lg shadow-black/10',
        className
      )}
      {...props}>
      {children}
    </DialogPrimitive.Content>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-[17px] font-semibold', className)} {...props} />;
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-[15px] leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<typeof View>) {
  return <View className={cn('mt-1 flex-row justify-end gap-2', className)} {...props} />;
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
                <UIText className="text-[15px]">{cancelLabel}</UIText>
              </Button>
            </DialogClose>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              size="sm"
              className="h-10 rounded-xl px-4"
              onPress={() => {
                // Close first: the work behind onConfirm is async, and leaving
                // the dialog up would block the screen it is reporting on.
                onOpenChange(false);
                onConfirm();
              }}
            >
              <UIText className="text-[15px] font-semibold">{confirmLabel}</UIText>
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
