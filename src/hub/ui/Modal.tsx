import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/hub/utils/cn";
import { useI18n } from "@/hub/i18n";

/**
 * Dialog base: focus trap, escape-to-close, scroll lock, and a mobile sheet
 * presentation that becomes a centred dialog from `sm` upward.
 */
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "full";
  /** Removes the panel chrome — used by the lightbox and video player. */
  bare?: boolean;
}

const SIZES: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-3xl",
  full: "max-w-6xl",
};

export function Modal({ open, onClose, title, children, size = "md", bare }: ModalProps) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    // Defer so the panel exists before focus moves into it.
    const focusTimer = window.setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]");
      if (el) {
        el.focus();
      } else {
        panelRef.current?.focus();
      }
    }, 40);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.clearTimeout(focusTimer);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center overflow-x-hidden sm:items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            initial={{ opacity: 0, y: 24, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className={cn(
              "relative z-10 w-full",
              SIZES[size],
              bare
                ? "outline-none"
                : "max-h-[90dvh] max-w-full overflow-hidden rounded-t-3xl border border-border/70 bg-ink-850 p-4 sm:p-6 shadow-lift outline-none sm:rounded-2xl",
            )}
          >
            {!bare && (
              <div className="mb-4 flex items-start justify-between gap-4">
                {title && (
                  <h3 id={titleId} className="text-lg font-extrabold tracking-tight">
                    {title}
                  </h3>
                )}
                <button
                  onClick={onClose}
                  aria-label={t("common.close")}
                  className="-me-1 -mt-1 rounded-xl p-2 muted transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            )}
            {bare && (
              <button
                onClick={onClose}
                aria-label={t("common.close")}
                className="absolute -top-12 end-0 z-20 rounded-full bg-white/10 p-2.5 text-white backdrop-blur transition-colors hover:bg-nin sm:-top-11"
              >
                <X className="h-5 w-5" />
              </button>
            )}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
