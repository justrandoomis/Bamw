import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Image as ImageIcon,
  Receipt,
  RotateCcw,
  ShoppingBag,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useCurrency } from "@/context/CurrencyContext";
import { methodInfo } from "@/components/wallet/methods";
import { cn } from "@/lib/utils";

export interface Transaction {
  id: string;
  kind: "deposit" | "withdrawal" | "purchase" | "refund" | "admin_adjustment";
  amount: number;
  description: string;
  orderId?: string;
  referenceType?: string;
  referenceId?: string;
  createdAt: string;
  status?: "completed" | "pending" | "rejected";
}

export interface RechargeRequest {
  id: string;
  userId: string;
  amount: number;
  method: string;
  status: "pending" | "approved" | "rejected";
  proofUrl?: string;
  eshopCode?: string;
  bananCode?: string;
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
}

interface TransactionListProps {
  transactions: Transaction[];
  rechargeRequests?: RechargeRequest[];
  isLoading?: boolean;
  /** Controlled filter, so the balance card can open «قيد المراجعة» directly. */
  filter?: Filter;
  onFilterChange?: (filter: Filter) => void;
}

export type Filter = "all" | "pending" | "deposit" | "purchase";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "pending", label: "قيد المراجعة" },
  { key: "deposit", label: "إيداع" },
  { key: "purchase", label: "شراء" },
];

/** One line of the history: a ledger movement, or a top-up still with a person. */
interface Item {
  id: string;
  at: number;
  title: string;
  method?: string;
  amount: string;
  /** Money in (true), out (false). */
  incoming: boolean;
  status?: "pending" | "rejected";
  icon: typeof Clock;
  proofUrl?: string;
  notes?: string;
  orderId?: string;
}

function toMillis(value?: string | number): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value > 1e11 ? value : value * 1000;
  const parsed = new Date(String(value).replace(" ", "T")).getTime();
  if (!Number.isNaN(parsed)) return parsed;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? (num > 1e11 ? num : num * 1000) : 0;
}

function formatDate(ms: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("ar-IQ", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The wallet's history as one list, newest first: top-ups still being checked
 * or turned down, and every movement of the balance. A row says what happened,
 * when and for how much; tapping it shows the rest — the reference to quote
 * to support, the proof sent, the reason for a refusal.
 */
export function TransactionList({
  transactions = [],
  rechargeRequests = [],
  filter: controlledFilter,
  onFilterChange,
}: TransactionListProps) {
  const [ownFilter, setOwnFilter] = useState<Filter>("all");
  const filter = controlledFilter ?? ownFilter;
  const setFilter = onFilterChange ?? setOwnFilter;
  const [openId, setOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedProof, setSelectedProof] = useState<string | null>(null);
  const { formatIQDPrice } = useCurrency();

  const pendingCount = rechargeRequests.filter((r) => r.status === "pending").length;

  const items = useMemo(() => {
    const requestItems: Item[] = rechargeRequests
      .filter((req) => {
        if (req.status === "approved") return false; // credited: it is in the ledger now
        if (filter === "purchase") return false;
        if (filter === "pending" || filter === "deposit") return req.status === "pending";
        return true;
      })
      .map((req) => {
        const info = methodInfo(req.method);
        const dollars = info?.dollars ?? false;
        return {
          id: req.id,
          at: toMillis(req.createdAt),
          title: req.status === "pending" ? "طلب شحن قيد المراجعة" : "طلب شحن مرفوض",
          method: info?.label ?? req.method,
          amount: `+${dollars ? `$${Number(req.amount).toFixed(2)}` : formatIQDPrice(Number(req.amount))}`,
          incoming: true,
          status: req.status === "pending" ? "pending" : "rejected",
          icon: req.status === "pending" ? Clock : XCircle,
          proofUrl: req.proofUrl,
          notes: req.adminNotes,
        };
      });

    const ledgerItems: Item[] =
      filter === "pending"
        ? []
        : transactions
            .filter((tx) => {
              const incoming = tx.kind === "deposit" || tx.kind === "refund" || tx.amount > 0;
              if (filter === "deposit") return incoming;
              if (filter === "purchase") return !incoming;
              return true;
            })
            .map((tx) => {
              const incoming = tx.kind === "deposit" || tx.kind === "refund" || tx.amount > 0;
              return {
                id: tx.id,
                at: toMillis(tx.createdAt),
                title:
                  tx.description ||
                  (tx.kind === "refund" ? "استرجاع" : incoming ? "إيداع رصيد" : "شراء"),
                amount: `${incoming ? "+" : "−"}${formatIQDPrice(Math.abs(tx.amount))}`,
                incoming,
                icon: tx.kind === "refund" ? RotateCcw : incoming ? ArrowDownToLine : ShoppingBag,
                orderId: tx.orderId,
              };
            });

    return [...requestItems, ...ledgerItems].sort((a, b) => b.at - a.at);
  }, [transactions, rechargeRequests, filter, formatIQDPrice]);

  const handleCopy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      toast.success("تم نسخ رقم العملية");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("تعذّر النسخ");
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="wallet-history-title">
      <h2 id="wallet-history-title" className="px-1 text-base font-black text-foreground">
        سجل المحفظة
      </h2>

      {/* One row of choices; the active one is filled. */}
      <div
        role="tablist"
        aria-label="تصفية السجل"
        className="flex gap-1 rounded-2xl bg-muted/70 p-1"
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "flex h-9 flex-auto cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-xl px-2.5 text-xs font-bold transition-colors",
              filter === f.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{f.label}</span>
            {f.key === "pending" && pendingCount > 0 && (
              <span className="grid min-w-5 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-black leading-5 text-white">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-border px-6 py-12 text-center">
          <Receipt className="size-9 text-muted-foreground/50" />
          <p className="text-sm font-bold text-muted-foreground">
            {filter === "pending"
              ? "لا توجد طلبات شحن قيد المراجعة"
              : filter === "deposit"
                ? "لا توجد عمليات إيداع بعد"
                : filter === "purchase"
                  ? "لا توجد مشتريات بعد"
                  : "لا توجد حركات في محفظتك بعد"}
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-3xl border border-border bg-card">
          {items.map((item, index) => {
            const open = openId === item.id;
            const Icon = item.icon;
            return (
              <li
                key={`${item.status ? "req" : "tx"}-${item.id}`}
                className={cn(index > 0 && "border-t border-border")}
              >
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : item.id)}
                  aria-expanded={open}
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-start transition-colors hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-2xl",
                      item.status === "pending"
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : item.status === "rejected"
                          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                          : item.incoming
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {[formatDate(item.at), item.method].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      dir="ltr"
                      className={cn(
                        "text-sm font-black tabular-nums",
                        item.status === "rejected"
                          ? "text-muted-foreground line-through"
                          : item.status === "pending"
                            ? "text-amber-600 dark:text-amber-400"
                            : item.incoming
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-foreground",
                      )}
                    >
                      {item.amount}
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-3.5 text-muted-foreground transition-transform",
                        open && "rotate-180",
                      )}
                    />
                  </span>
                </button>

                {open && (
                  <div className="space-y-2.5 px-4 pb-4 ps-[4.25rem] text-xs">
                    {item.status === "rejected" && item.notes && (
                      <p className="rounded-xl bg-rose-500/10 p-2.5 font-medium leading-relaxed text-rose-700 dark:text-rose-300">
                        <span className="font-bold">سبب الرفض: </span>
                        {item.notes}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCopy(item.id)}
                        className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 font-mono text-[11px] text-foreground/80 hover:text-foreground"
                        title="نسخ رقم العملية"
                      >
                        {copiedId === item.id ? (
                          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                        <span dir="ltr">{item.id}</span>
                      </button>
                      {item.proofUrl && (
                        <button
                          type="button"
                          onClick={() => setSelectedProof(item.proofUrl ?? null)}
                          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 font-bold text-foreground hover:bg-muted/70"
                        >
                          <ImageIcon className="size-3.5" />
                          صورة الإثبات
                        </button>
                      )}
                      {item.orderId && (
                        <span className="rounded-lg bg-muted px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                          طلب #{item.orderId.slice(-6)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={Boolean(selectedProof)} onOpenChange={(o) => !o && setSelectedProof(null)}>
        <DialogContent className="max-w-lg rounded-3xl p-3" aria-describedby={undefined}>
          <DialogTitle className="sr-only">صورة الإثبات</DialogTitle>
          {selectedProof && (
            <img
              src={selectedProof}
              alt="صورة الإثبات"
              className="max-h-[80vh] w-full rounded-2xl object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
