import { tr } from "@/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import AppShell from "@/components/AppShell";
import { walletApi, api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Plus, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { BalanceCard } from "@/components/wallet/BalanceCard";
import { TransactionList } from "@/components/wallet/TransactionList";
import { TopUpModal } from "@/components/wallet/TopUpModal";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/wallet")({
  component: WalletPage,
});

function WalletPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);

  const { data: store } = useQuery({
    queryKey: ["store"],
    queryFn: () => api.store(),
  });

  const settings: Record<string, any> = store?.settings || {};

  const transactions = useQuery({
    queryKey: ["wallet-transactions"],
    queryFn: () => walletApi.getTransactions(),
    refetchInterval: 5000, // Polls every 5s so status updates automatically (قيد المراجعة -> مكتمل / مرفوض)
    refetchOnWindowFocus: true,
  });

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
      toast.success("تم إرسال طلب الشحن للمراجعة بنجاح");
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["wallet-transactions"] });
      transactions.refetch();
      setIsTopUpOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || "فشل إرسال طلب الشحن");
    },
  });

  return (
    <AppShell currentView="profile">
      <div className="max-w-xl mx-auto px-4 py-8 space-y-8 animate-in fade-in duration-500">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black">{tr("Wallet")}</h1>
            <p className="text-xs text-muted-foreground font-bold">
              {tr("Manage your balance and transactions")}
            </p>
          </div>

          <button
            className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground cursor-pointer"
            onClick={() => window.open("/support", "_self")}
          >
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Balance Card Section */}
        <div className="space-y-4">
          <BalanceCard balance={user?.walletBalance || 0} reserved={0} />

          <button
            onClick={() => setIsTopUpOpen(true)}
            className="w-full flex items-center justify-center gap-2 bg-zinc-900 text-white font-black py-4 rounded-2xl shadow-lg active:scale-[0.98] transition-all cursor-pointer"
          >
            <Plus className="w-5 h-5" />
            {tr("Add Balance")}
          </button>
        </div>

        {/* Transactions Section */}
        <div className="pt-2">
          {transactions.isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-32" />
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-2xl" />
              ))}
            </div>
          ) : (
            <TransactionList
              transactions={transactions.data?.transactions || []}
              rechargeRequests={transactions.data?.rechargeRequests || []}
            />
          )}
        </div>

        {/* TopUp Modal / Bottom Sheet */}
        <TopUpModal
          open={isTopUpOpen}
          onOpenChange={setIsTopUpOpen}
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
