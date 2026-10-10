import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bell, Check, Info, TriangleAlert, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/hub/utils/cn";

export type NotificationType = "info" | "success" | "warning" | "price";

export interface NotificationInput {
  title: string;
  message?: string;
  type?: NotificationType;
  /** Milliseconds before auto-dismiss. `0` keeps it until dismissed. */
  duration?: number;
  /** Custom destination on click (defaults to /cart for cart additions) */
  href?: string;
}

interface NotificationItem extends Required<Omit<NotificationInput, "message" | "href">> {
  id: string;
  message?: string;
  href?: string;
}

interface NotificationValue {
  notifications: NotificationItem[];
  addNotification: (input: NotificationInput) => string;
  dismiss: (id: string) => void;
}

const NotificationContext = createContext<NotificationValue | null>(null);

const ICONS: Record<NotificationType, typeof Info> = {
  info: Info,
  success: Check,
  warning: TriangleAlert,
  price: Bell,
};

const TONE: Record<NotificationType, string> = {
  info: "text-sky-300",
  success: "text-good",
  warning: "text-warn",
  price: "text-warn",
};

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setNotifications((current) => current.filter((n) => n.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const addNotification = useCallback(
    (input: NotificationInput) => {
      const isCart =
        input.title.includes("سلة") ||
        input.title.includes("Cart") ||
        input.title.includes("أضف") ||
        input.title.includes("أُضيف");

      const id = isCart
        ? "cart-hub-notification"
        : `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

      const item: NotificationItem = {
        id,
        title: input.title,
        ...(input.message !== undefined ? { message: input.message } : {}),
        ...(input.href !== undefined ? { href: input.href } : {}),
        type: input.type ?? "info",
        duration: input.duration ?? 4200,
      };

      // Clear timer for any previous instance with same id
      const existingTimer = timers.current.get(id);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
        timers.current.delete(id);
      }

      // Deduplicate: If adding a cart notification or same id, replace previous so user gets only 1 toast
      setNotifications((current) => {
        const filtered = current.filter((n) => n.id !== id);
        return [item, ...filtered].slice(0, 4);
      });

      if (item.duration > 0) {
        timers.current.set(
          id,
          window.setTimeout(() => dismiss(id), item.duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ notifications, addNotification, dismiss }),
    [notifications, addNotification, dismiss],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NotificationViewport items={notifications} onDismiss={dismiss} />
    </NotificationContext.Provider>
  );
}

function NotificationViewport({
  items,
  onDismiss,
}: {
  items: NotificationItem[];
  onDismiss: (id: string) => void;
}) {
  const navigate = useNavigate();

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:end-4 sm:top-4 sm:items-end sm:px-0"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {items.map((item) => {
          const Icon = ICONS[item.type];
          const isCartAction =
            item.href === "/cart" ||
            item.id.includes("cart") ||
            item.title.includes("سلة") ||
            item.title.includes("Cart") ||
            item.title.includes("أضف") ||
            item.title.includes("أُضيف");

          const handleCardClick = () => {
            onDismiss(item.id);
            if (item.href) {
              void navigate({ to: item.href as never });
            } else if (isCartAction) {
              void navigate({ to: "/cart" });
            }
          };

          return (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              onClick={handleCardClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCardClick();
                }
              }}
              style={{ cursor: isCartAction || item.href ? "pointer" : "default" }}
              className={cn(
                "pointer-events-auto group relative flex w-full max-w-sm select-none items-center justify-between gap-3 overflow-hidden rounded-2xl border border-border/70 bg-ink-850/95 p-3.5 backdrop-blur-xl shadow-2xl transition-all duration-150 active:scale-[0.98]",
                (isCartAction || item.href) && "cursor-pointer hover:bg-ink-850",
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/70",
                    TONE[item.type],
                  )}
                >
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-snug text-white">{item.title}</p>
                  {item.message && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground truncate">
                      {item.message}
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onDismiss(item.id);
                }}
                className="-me-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:scale-90"
                aria-label="Close notification"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function useNotifications(): NotificationValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within <NotificationProvider>");
  return ctx;
}
