import { tr } from "@/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { walletApi, api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { CircleHelp, Clock, Plus } from "lucide-react";
import { toast } from "sonner";
import { TransactionList, type Filter } from "@/components/wallet/TransactionList";
import { TopUpModal } from "@/components/wallet/TopUpModal";
import { availableMethods, type TopUpMethod } from "@/components/wallet/methods";
import { Skeleton } from "@/components/ui/skeleton";
import RequireSignIn from "@/components/RequireSignIn";
import { useCurrency } from "@/context/CurrencyContext";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/wallet")({
  component: WalletRoute,
});

/*
  The wallet is one member's money. Rendered to a signed-out visitor it showed
  a balance card reading 0 د.ع and an empty history, and answered the first tap
  with the English word «unauthorised» — so the guard goes outside the page,
  not inside it, and the page below is never mounted without a session.
*/
function WalletRoute() {
  return (
    <RequireSignIn>
      <WalletPage />
    </RequireSignIn>
  );
}

/*
  Three things, in the order a member needs them: what they have, how to add
  to it — one button, and every method one tap away in the owner's order —
  and what happened to their money. Everything else waits behind a tap.

  It was a black card, a black button and a history of boxed rows, each
  carrying its full reference and a coloured badge; the copy was English
  words passed through a translator whose source language is Arabic, so an
  Arabic reader saw «Wallet» and «Add Balance». Every colour here is a theme
  token, so the page follows the light and the dark packs alike.
*/
function WalletPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { formatIQDPrice } = useCurrency();
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [initialMethod, setInitialMethod] = useState<TopUpMethod | undefined>(undefined);
  const [filter, setFilter] = useState<Filter>("all");
  const historyRef = useRef<HTMLDivElement>(null);

  const { data: store } = useQuery({
    queryKey: ["store"],
    queryFn: () => api.store(),
  });

  const settings = useMemo<Record<string, any>>(() => store?.settings || {}, [store?.settings]);
  const methods = useMemo(() => availableMethods(settings), [settings]);

  const transactions = useQuery({
    queryKey: ["wallet-transactions"],
    queryFn: () => walletApi.getTransactions(),
    refetchInterval: 5000, // Polls every 5s so status updates automatically (قيد المراجعة -> مكتمل / مرفوض)
    refetchOnWindowFocus: true,
  });

  const pendingCount = (transactions.data?.rechargeRequests || []).filter(
    (r: { status?: string }) => r.status === "pending",
  ).length;

  const openTopUp = (method?: TopUpMethod) => {
    setInitialMethod(method);
    setIsTopUpOpen(true);
  };

  const showPending = () => {
    setFilter("pending");
    historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const consumeBanan = useMutation({
    mutationFn: (code: string) => walletApi.consumeBanan(code),
    onSuccess: (res: any) => {
      if (res.success) {
        toast.success(
          `تم تفعيل الكود بنجاح وإضافة ${Number(res.amount).toLocaleString()} د.ع لرصيدك`,
        );
        queryClient.invalidateQueries({ queryKey: ["me"] });
        queryClient.invalidateQueries({ queryKey: ["wallet-transactions"] });
        transactions.refetch();
        setIsTopUpOpen(false);
      } else {
        toast.error(res.error || "كود غير صالح");
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || "فشل تفعيل الكود");
    },
  });

  const recharge = useMutation({
    mutationFn: (payload: any) => walletApi.recharge({ ...payload, action: "recharge" }),
    onSuccess: () => {
      toast.success("تم إرسال طلب الشحن للمراجعة");
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["wallet-transactions"] });
      transactions.refetch();
      setIsTopUpOpen(false);
      setFilter("all");
    },
    onError: (err: any) => {
      toast.error(err?.message || "فشل إرسال طلب الشحن");
    },
  });

  return (
    <AppShell currentView="profile">
      <div dir="rtl" className="mx-auto w-full max-w-xl space-y-6 px-4 pb-24 pt-4">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-black text-foreground">{tr("المحفظة")}</h1>
          <Link
            to="/support"
            className="grid size-10 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={tr("المساعدة")}
            title={tr("المساعدة")}
          >
            <CircleHelp className="size-5" />
          </Link>
        </header>

        {/* The balance, and the one thing to do about it. */}
        <section
          aria-label={tr("رصيدك")}
          className="relative overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-soft"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 -start-16 size-48 rounded-full bg-primary/10 blur-2xl"
          />
          <p className="relative text-sm font-bold text-muted-foreground">{tr("رصيدك المتاح")}</p>
          <p className="relative mt-1 text-4xl font-black tracking-tight text-foreground tabular-nums">
            <span dir="ltr">{formatIQDPrice(user?.walletBalance || 0)}</span>
          </p>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={showPending}
              className="relative mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-700 transition-colors hover:bg-amber-500/25 dark:text-amber-300"
            >
              <Clock className="size-3.5" />
              {pendingCount === 1
                ? tr("طلب شحن واحد قيد المراجعة")
                : `${pendingCount} ${tr("طلبات شحن قيد المراجعة")}`}
            </button>
          )}
          <button
            type="button"
            onClick={() => openTopUp()}
            className="relative mt-5 flex h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-primary text-base font-black text-primary-foreground shadow-soft transition-transform active:scale-[0.99]"
          >
            <Plus className="size-5" />
            {tr("شحن الرصيد")}
          </button>
        </section>

        {/* Every method one tap away, in the owner's order. */}
        <section aria-labelledby="wallet-methods-title" className="space-y-3">
          <h2 id="wallet-methods-title" className="px-1 text-base font-black text-foreground">
            {tr("اشحن عبر")}
          </h2>
          <div
            className="grid gap-1.5"
            style={{
              gridTemplateColumns: `repeat(${Math.max(methods.length, 1)}, minmax(0, 1fr))`,
            }}
          >
            {methods.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => openTopUp(m.key)}
                className="flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl px-1 py-2 transition-colors hover:bg-muted/60 active:bg-muted"
              >
                <span className={cn("grid size-12 place-items-center rounded-2xl", m.tint)}>
                  <m.icon className="size-5" />
                </span>
                <span className="text-center text-[11px] font-bold leading-tight text-foreground">
                  {m.short}
                </span>
              </button>
            ))}
          </div>
        </section>

        <div ref={historyRef} className="scroll-mt-24">
          {transactions.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-11 w-full rounded-2xl" />
              <Skeleton className="h-48 w-full rounded-3xl" />
            </div>
          ) : (
            <TransactionList
              transactions={transactions.data?.transactions || []}
              rechargeRequests={transactions.data?.rechargeRequests || []}
              filter={filter}
              onFilterChange={setFilter}
            />
          )}
        </div>

        <TopUpModal
          open={isTopUpOpen}
          onOpenChange={setIsTopUpOpen}
          initialMethod={initialMethod}
          onSuccess={() => {
            transactions.refetch();
            queryClient.invalidateQueries({ queryKey: ["me"] });
          }}
          settings={settings}
          onRecharge={(payload) => recharge.mutateAsync(payload)}
          onConsumeBanan={(code) => consumeBanan.mutateAsync(code)}
          isPending={recharge.isPending || consumeBanan.isPending}
        />
      </div>
    </AppShell>
  );
}
