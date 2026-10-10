import { Link } from "@tanstack/react-router";
import { ExternalLink, Menu, PanelRightClose, PanelRightOpen, Search, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import mascot from "@/assets/bananto_logo.webp.asset.json";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

import {
  ADMIN_NAV,
  navEntryFor,
  paletteEntries,
  type AdminBadge,
  type AdminNavItem,
  type PaletteEntry,
} from "./adminNav";
import { CommandPalette } from "./CommandPalette";

const COLLAPSE_KEY = "bananto:admin-nav-collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, value ? "1" : "0");
  } catch {
    /* a private window keeps the default */
  }
}

const isMac = () =>
  typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || "");

/**
 * The admin's frame: a sidebar grouped by job on the right, a top bar that
 * says where you are, a search that reaches every screen, and on a phone the
 * same sidebar as a drawer.
 *
 * It owns no data. The dashboard tells it which section is open, the counts
 * that need a badge, and the categories the search can jump to; it tells the
 * dashboard which section was picked.
 */
export function AdminShell({
  active,
  onNavigate,
  badges,
  categories,
  fullBleed = false,
  banner,
  children,
}: {
  active: string;
  onNavigate: (tab: string) => void;
  badges: Partial<Record<AdminBadge, number>>;
  categories: { id: string; title: string }[];
  /** The inbox fills the whole area and scrolls itself. */
  fullBleed?: boolean;
  /** A notice above the content — the database banner. */
  banner?: ReactNode;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => setCollapsed(readCollapsed()), []);

  /* Ctrl/⌘ K from anywhere in the admin. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* The drawer holds the page still while it is open, and Escape closes it. */
  useEffect(() => {
    if (!drawerOpen) return;
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  const go = useCallback(
    (tab: string) => {
      setDrawerOpen(false);
      onNavigate(tab);
    },
    [onNavigate],
  );

  const entry = navEntryFor(active);
  const categoryTitle = active.startsWith("listings_")
    ? categories.find((category) => `listings_${category.id}` === active)?.title
    : undefined;
  const entries = useMemo(() => paletteEntries(categories), [categories]);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      writeCollapsed(!value);
      return !value;
    });
  };

  const pickFromPalette = (picked: PaletteEntry) => {
    if (picked.href) {
      window.location.assign(picked.href);
      return;
    }
    go(picked.tab);
  };

  return (
    <div
      className="clay-canvas flex h-[100dvh] w-full overflow-hidden font-sans text-foreground"
      dir="rtl"
    >
      {/* ─────────────────────────── Sidebar (desktop) ─────────────────────────── */}
      <aside
        aria-label="أقسام الإدارة"
        className={cn(
          "hidden shrink-0 flex-col border-l border-border bg-card transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex",
          collapsed ? "w-[76px]" : "w-[264px]",
        )}
      >
        <div
          className={cn("flex h-14 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}
        >
          <img src={mascot.url} alt="" className="h-8 w-8 shrink-0 object-contain" />
          {!collapsed ? (
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[15px] font-black tracking-[-0.01em]">بنانتو</p>
              <p className="text-[11px] font-bold text-muted-foreground">لوحة الإدارة</p>
            </div>
          ) : null}
          {!collapsed ? (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="طيّ القائمة"
              title="طيّ القائمة"
              className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-banana/70"
            >
              <PanelRightClose className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className={cn("px-3 pb-2", collapsed && "px-2")}>
          {collapsed ? (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="فتح القائمة"
              title="فتح القائمة"
              className="mb-1 grid h-10 w-full place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-banana/70"
            >
              <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <SearchButton compact={collapsed} onOpen={() => setPaletteOpen(true)} />
        </div>

        <NavList
          active={active}
          badges={badges}
          collapsed={collapsed}
          onNavigate={go}
          className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4 no-scrollbar"
        />

        <div className={cn("border-t border-border p-3", collapsed && "px-2")}>
          <Link
            to="/"
            className={cn(
              "flex min-h-10 items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-banana/70",
              collapsed && "justify-center px-0",
            )}
            title="عرض المتجر"
          >
            <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!collapsed ? "عرض المتجر" : <span className="sr-only">عرض المتجر</span>}
          </Link>
        </div>
      </aside>

      {/* ─────────────────────────── Main column ─────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-[var(--page)]/85 px-3 backdrop-blur-xl supports-[backdrop-filter]:bg-[var(--page)]/70 sm:px-5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="فتح أقسام الإدارة"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-banana/70 lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <nav aria-label="موقعك" className="min-w-0 flex-1">
            <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
              {entry && entry.item.id !== "dashboard" ? (
                <li className="hidden shrink-0 font-bold text-muted-foreground sm:block">
                  {entry.group.label}
                  <span className="ms-1.5 text-muted-foreground/60" aria-hidden="true">
                    ‹
                  </span>
                </li>
              ) : null}
              <li
                className="truncate text-[15px] font-black tracking-[-0.01em]"
                aria-current="page"
              >
                {entry?.item.label ?? "لوحة الإدارة"}
                {categoryTitle ? (
                  <span className="font-bold text-muted-foreground"> — {categoryTitle}</span>
                ) : null}
              </li>
            </ol>
          </nav>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="بحث"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-banana/70 lg:hidden"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
          <Link
            to="/"
            className="hidden min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-[12.5px] font-bold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-banana/70 sm:inline-flex"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            عرض المتجر
          </Link>
          <Link
            to="/profile"
            aria-label="حسابي"
            title={user?.name || "حسابي"}
            className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-foreground text-[13px] font-black text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-banana/70"
          >
            {user?.avatar ? (
              <img src={user.avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              (user?.name?.trim()?.charAt(0) ?? "") || "؟"
            )}
          </Link>
        </header>

        <main
          id="admin-main"
          className={cn(
            "relative min-h-0 flex-1",
            fullBleed ? "flex flex-col overflow-hidden" : "overflow-y-auto overscroll-contain",
          )}
        >
          {fullBleed ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {banner ? <div className="p-2">{banner}</div> : null}
              {children}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-5 sm:px-6 lg:px-8">
              {banner ? <div className="mb-4">{banner}</div> : null}
              {children}
            </div>
          )}
        </main>
      </div>

      {/* ─────────────────────────── Drawer (phone) ─────────────────────────── */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
          <img src={mascot.url} alt="" className="h-8 w-8 object-contain" />
          <p className="min-w-0 flex-1 truncate text-[15px] font-black">لوحة الإدارة</p>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="إغلاق"
            className="grid h-10 w-10 place-items-center rounded-xl text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-banana/70"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="px-3 pt-3">
          <SearchButton
            compact={false}
            onOpen={() => {
              setDrawerOpen(false);
              setPaletteOpen(true);
            }}
          />
        </div>
        <NavList
          active={active}
          badges={badges}
          collapsed={false}
          onNavigate={go}
          className="flex-1 overflow-y-auto overscroll-contain px-3 pb-6"
        />
        <div className="border-t border-border p-3">
          <Link
            to="/"
            className="flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 text-[13.5px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            عرض المتجر
          </Link>
        </div>
      </Drawer>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        entries={entries}
        onPick={pickFromPalette}
      />
    </div>
  );
}

function SearchButton({ compact, onOpen }: { compact: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="بحث في الإدارة"
      title="بحث (Ctrl K)"
      className={cn(
        "flex min-h-10 w-full items-center gap-2 rounded-xl border border-border bg-[var(--page)] px-3 text-[13px] font-bold text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-banana/70",
        compact && "justify-center px-0",
      )}
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!compact ? (
        <>
          <span className="flex-1 text-start">بحث…</span>
          <kbd
            dir="ltr"
            className="rounded-md border border-border bg-card px-1.5 py-0.5 font-sans text-[10.5px] font-bold"
          >
            {isMac() ? "⌘K" : "Ctrl K"}
          </kbd>
        </>
      ) : null}
    </button>
  );
}

function NavList({
  active,
  badges,
  collapsed,
  onNavigate,
  className,
}: {
  active: string;
  badges: Partial<Record<AdminBadge, number>>;
  collapsed: boolean;
  onNavigate: (tab: string) => void;
  className?: string;
}) {
  const activeId = navEntryFor(active)?.item.id ?? active;
  return (
    <nav aria-label="الأقسام" className={className}>
      {ADMIN_NAV.map((group) => (
        <div key={group.id} className="mt-4 first:mt-1">
          {collapsed ? (
            <div className="mx-auto mb-1.5 h-px w-8 bg-border" aria-hidden="true" />
          ) : (
            <p className="mb-1 px-2.5 text-[11px] font-black text-muted-foreground">
              {group.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.id}>
                <NavButton
                  item={item}
                  active={activeId === item.id}
                  count={item.badge ? (badges[item.badge] ?? 0) : 0}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NavButton({
  item,
  active,
  count,
  collapsed,
  onNavigate,
}: {
  item: AdminNavItem;
  active: boolean;
  count: number;
  collapsed: boolean;
  onNavigate: (tab: string) => void;
}) {
  const content = (
    <>
      <item.icon
        className={cn(
          "h-[18px] w-[18px] shrink-0",
          active ? "text-foreground" : "text-muted-foreground",
        )}
        strokeWidth={active ? 2.25 : 1.75}
        aria-hidden="true"
      />
      {!collapsed ? <span className="min-w-0 flex-1 truncate text-start">{item.label}</span> : null}
      {count > 0 ? (
        <span
          className={cn(
            "grid min-w-[20px] place-items-center rounded-full px-1.5 text-[10.5px] font-black tabular-nums",
            item.badge === "chats" || item.badge === "orders"
              ? "bg-[var(--brand-red)] text-white"
              : "bg-foreground/10 text-foreground",
            collapsed && "absolute -top-0.5 start-1 min-w-[18px] px-1 text-[9.5px]",
          )}
          aria-label={`${count} بانتظارك`}
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </>
  );
  const classes = cn(
    "relative flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-banana/70",
    active
      ? "bg-banana/20 font-black text-foreground before:absolute before:inset-y-2 before:start-0 before:w-[3px] before:rounded-full before:bg-banana"
      : "font-bold text-foreground/80 hover:bg-muted hover:text-foreground",
    collapsed && "justify-center px-0",
  );
  if (item.href) {
    return (
      <a href={item.href} className={classes} title={collapsed ? item.label : undefined}>
        {content}
        {collapsed ? <span className="sr-only">{item.label}</span> : null}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onNavigate(item.id)}
      aria-current={active ? "page" : undefined}
      className={classes}
      title={collapsed ? item.label : undefined}
    >
      {content}
      {collapsed ? <span className="sr-only">{item.label}</span> : null}
    </button>
  );
}

function Drawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="drawer"
          className="fixed inset-0 z-[60] lg:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
        >
          <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="أقسام الإدارة"
            dir="rtl"
            className="absolute inset-y-0 right-0 flex w-[86vw] max-w-[320px] flex-col bg-card shadow-2xl"
            initial={reduceMotion ? false : { x: "100%" }}
            animate={{ x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: "100%" }}
            transition={{ type: "spring", bounce: 0, duration: 0.3 }}
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
