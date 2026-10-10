import { CornerDownLeft, Search } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { searchPalette, type PaletteEntry } from "./adminNav";

/**
 * «بحث» used to be a row in the sidebar that did nothing when pressed. This
 * is what it does now: every screen in the admin — and each product category
 * — one search away, from the keyboard (Ctrl/⌘ K) or the button.
 *
 * Arabic is folded before it is compared, so «اكواد» finds «أكواد الخصم», and
 * a screen can be found by what it is for: «3+1» finds the offers.
 */
export function CommandPalette({
  open,
  onClose,
  entries,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  entries: PaletteEntry[];
  onPick: (entry: PaletteEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const reduceMotion = useReducedMotion();
  const listId = useId();

  const results = useMemo(() => searchPalette(entries, query).slice(0, 40), [entries, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const restore = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      restore?.focus?.();
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    onPick(entry);
    onClose();
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="palette"
          className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.15 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="البحث في لوحة الإدارة"
            dir="rtl"
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            initial={reduceMotion ? false : { opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", bounce: 0, duration: 0.25 }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => Math.min(results.length - 1, i + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                pick(results[active]);
              }
            }}
          >
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
                aria-label="ابحث عن شاشة"
                placeholder="ابحث عن شاشة… مثل: الطلبات، كوبون، 3+1"
                autoComplete="off"
                spellCheck={false}
                className="h-14 min-w-0 flex-1 bg-transparent text-[15px] font-bold text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground"
              />
              <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground sm:inline">
                Esc
              </kbd>
            </div>
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="النتائج"
              className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain p-1.5"
            >
              {results.length ? (
                results.map((entry, index) => (
                  <li
                    key={entry.key}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={() => pick(entry)}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-[14px]",
                      index === active ? "bg-banana/20 text-foreground" : "text-foreground/90",
                    )}
                  >
                    <entry.icon
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate font-bold">{entry.label}</span>
                    <span className="shrink-0 text-[11.5px] font-medium text-muted-foreground">
                      {entry.group}
                    </span>
                    {index === active ? (
                      <CornerDownLeft
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    ) : null}
                  </li>
                ))
              ) : (
                <li className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                  لا شاشة بهذا الاسم. جرّب كلمة أخرى.
                </li>
              )}
            </ul>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
