import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

/**
 * A picture from the conversation, at the size of the screen.
 *
 * The shop sends screenshots — where to tap, which code goes where — and a
 * member sends the sign-in proof. In the thread each is a 256px thumbnail,
 * cropped to fit, and tapping it did nothing, so the one thing the picture was
 * sent to show was often too small to read. Tap it and it opens whole; tap
 * anywhere, press Escape or the close button, and it goes.
 */
export function ImageViewer({
  src,
  onClose,
  label,
  closeLabel,
}: {
  src: string | null;
  onClose: () => void;
  label: string;
  closeLabel: string;
}) {
  return (
    <DialogPrimitive.Root open={Boolean(src)} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/90 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onClick={onClose}
          className="fixed inset-0 z-[80] flex items-center justify-center p-3 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          {src && (
            <img
              src={src}
              alt={label}
              className="max-h-[calc(100dvh-6rem)] max-w-full rounded-xl object-contain shadow-2xl"
            />
          )}
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="absolute end-3 top-[max(0.75rem,env(safe-area-inset-top))] flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
