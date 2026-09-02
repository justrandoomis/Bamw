import { tr } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import AppShell from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import OrderList from "@/components/orders/OrderList";
import PageHeader from "@/components/PageHeader";

export const Route = createFileRoute("/orders/")({
  head: () => ({
    meta: [
      { title: "طلباتي ومحادثات الدعم — بنانا ستور" },
      {
        name: "description",
        content: "تابع كل طلب في محادثة خاصة مع الدعم لتسليم الحسابات ومتابعة الشحن.",
      },
      { property: "og:title", content: "طلباتي ومحادثات الدعم — بنانا ستور" },
      {
        property: "og:description",
        content: "محادثة لكل طلب: الدفع، تسليم الحساب، وتتبع التوصيل.",
      },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const navigate = useNavigate();
  const { user, isLoading: isAuthLoading } = useAuth();

  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: () => api.orders(),
    enabled: Boolean(user),
    refetchInterval: 15_000,
  });

  if (!isAuthLoading && !user) {
    return (
      <AppShell currentView="orders">
        <div className="mx-auto max-w-md space-y-3 px-6 py-20 text-center">
          <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6 opacity-20">
            <Package className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-black text-foreground">{tr("سجل الدخول")}</h2>
          <p className="text-muted-foreground text-sm mb-8">
            {tr("سجّل الدخول لعرض طلباتك ومحادثاتك مع الدعم.")}
          </p>
          <button
            onClick={() => void navigate({ to: "/auth" })}
            className="w-full rounded-2xl bg-[var(--brand-red)] py-4 text-sm font-black text-white shadow-lg shadow-rose-500/20 active:scale-98 transition-all"
          >
            {tr("تسجيل الدخول")}
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell currentView="orders">
      <div className="mx-auto max-w-2xl px-4 pt-20 pb-10">
        <div className="mb-8">
          <h1 className="text-3xl font-black text-foreground mb-2">{tr("طلباتي")}</h1>
          <p className="text-sm text-muted-foreground font-bold">
            {tr("إدارة طلباتك ومتابعة تسليم الحسابات")}
          </p>
        </div>

        <OrderList
          orders={ordersQuery.data?.orders ?? []}
          isLoading={ordersQuery.isLoading || isAuthLoading}
        />
      </div>
    </AppShell>
  );
}

import { Package } from "lucide-react";
