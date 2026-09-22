import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { formatPrice, roundPrice } from "@/lib/banana-price";
import { LOSING_LABEL, oddsBreakdown, tierCounts } from "@/lib/wheel-odds";
import {
  Sparkles,
  Gift,
  ShoppingBag,
  Coins,
  TrendingUp,
  Settings,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  Search,
  Phone,
  MessageSquare,
  Check,
  X,
  Tag,
  Package,
  Eye,
  EyeOff,
  Copy,
  ExternalLink,
  Percent,
  Sliders,
  DollarSign,
  UserCheck,
  Award,
  Ticket,
} from "lucide-react";

const MARKET_FIELDS = [
  { key: "basePrice", label: "السعر الأساسي (د.ع)" },
  { key: "minPrice", label: "أدنى سعر" },
  { key: "maxPrice", label: "أعلى سعر" },
  { key: "commissionPercent", label: "عمولة المتجر %" },
  { key: "volatilityPercent", label: "نسبة التذبذب %" },
  { key: "botCount", label: "عدد عروض البوتات" },
  { key: "botMinQuantity", label: "أقل كمية لعرض البوت" },
  { key: "botMaxQuantity", label: "أكبر كمية لعرض البوت" },
  { key: "minListingQuantity", label: "أقل كمية لعرض المستخدم" },
  { key: "maxListingQuantity", label: "أكبر كمية لعرض المستخدم" },
  { key: "promoRatePerMinute", label: "سعر التمييز/دقيقة" },
] as const;

const DEFAULT_MARKET = {
  basePrice: 0.24,
  minPrice: 0.05,
  maxPrice: 5,
  commissionPercent: 2,
  volatilityPercent: 6,
  botsEnabled: true,
  botCount: 6,
  botMinQuantity: 500,
  botMaxQuantity: 25000,
  minListingQuantity: 100,
  maxListingQuantity: 1000000,
  promoRatePerMinute: 2,
};

function toBotPayload(bot: any) {
  return {
    id: bot.id,
    name: bot.name,
    budgetIqd: bot.budget_iqd ?? 0,
    maxTradeBanana: bot.max_trade_banana ?? null,
    dailyLimitBanana: bot.daily_limit_banana ?? null,
    maxTotalBanana: bot.max_total_banana ?? null,
    minPriceIqd: bot.min_price_iqd ?? null,
    maxPurchasePriceIqd: bot.max_purchase_price_iqd ?? null,
    isActive: Boolean(bot.is_active),
  };
}

/**
 * A chance, as the owner reads it.
 *
 * `toFixed(1)` alone prints `0.0%` for a band that a member can still land on,
 * which reads as "never" — and the rarest band in this catalogue is one game
 * at weight 1 out of a pool of 115,969. A floor of «أقل من 0.1%» says small
 * without saying impossible.
 */
function pct(chance: number): string {
  const value = Number(chance);
  if (!Number.isFinite(value) || value <= 0) return "0%";
  if (value < 0.001) return "أقل من 0.1%";
  return `${(value * 100).toFixed(1)}%`;
}

export function BananaManagementView() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<
    "rewards" | "redemptions" | "listings" | "settings" | "wallets" | "market" | "wheel"
  >("rewards");

  /*
    The wheel's bands, its losing chance and what a ticket costs.

    Seeded empty and filled from the server once the query lands — never from a
    local default. The market form's own defaults taught that lesson: pressing
    save before the GET resolves writes the component's guesses over the shop's
    real numbers.
  */
  const [wheelForm, setWheelForm] = useState<{
    tiers: { upTo: number | null; weight: number; label: string }[];
    losingPercent: number;
    ticketPriceBananas: number;
  } | null>(null);
  const [wheelError, setWheelError] = useState("");

  const [marketForm, setMarketForm] = useState<Record<string, any>>(DEFAULT_MARKET);

  // Query full banana data
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin_banana_data"],
    queryFn: () => adminApi.getBananaData(),
    refetchInterval: 15000,
  });

  // Settings State
  const [settingsForm, setSettingsForm] = useState({
    rewardRatePerIqd: 6.8,
    dinarPerBanana: 1000,
    openingPrice: 0.24,
    promoRatePerMinute: 2,
    signupGrant: 500,
  });

  // Sync settings when loaded
  React.useEffect(() => {
    if (data?.settings) {
      setSettingsForm({
        rewardRatePerIqd: data.settings.rewardRatePerIqd ?? 6.8,
        dinarPerBanana: data.settings.dinarPerBanana ?? 1000,
        openingPrice: data.settings.openingPrice ?? 0.24,
        promoRatePerMinute: data.settings.promoRatePerMinute ?? 2,
        signupGrant: data.settings.signupGrant ?? 500,
      });
    }
  }, [data?.settings]);

  React.useEffect(() => {
    if (data?.marketConfig) setMarketForm({ ...DEFAULT_MARKET, ...data.marketConfig });
  }, [data?.marketConfig]);

  /*
    Filled from the server, never from a local default, and only once — an
    admin mid-edit must not have their typing replaced by a refetch.
  */
  React.useEffect(() => {
    const odds = (data as Record<string, any> | undefined)?.["wheelOdds"];
    if (odds && !wheelForm) {
      setWheelForm({
        tiers: (odds.tiers ?? []).map((tier: any) => ({
          upTo: tier.upTo ?? null,
          weight: Number(tier.weight ?? 0),
          label: String(tier.label ?? ""),
        })),
        losingPercent: Number(odds.losingPercent ?? 0),
        ticketPriceBananas: Number(odds.ticketPriceBananas ?? 0),
      });
    }
  }, [data, wheelForm]);

  /*
    What the owner is actually setting, as percentages, while they type.

    A weight is not a chance: a band's chance is its weight times the number of
    games in it, and that multiplier runs from one game to nine hundred and
    eighty-four across this catalogue. Typing 100 into the cheapest band and
    120 into «حظ أوفر» reads as "a little more likely" and produces a
    thousandth of it. «يستطيع تحديد النسب يدويا» is not served by a screen that
    shows only weights, however carefully it is labelled.

    Computed from the pool's prices with the wheel's own `tierCounts` and
    `oddsBreakdown` — the same two functions `/api/wheel` serves the member
    screen from — so what the owner reads here is what a member will read
    there, for the bands as they are being typed rather than as they were last
    saved.
  */
  const wheelPreview = useMemo(() => {
    const prices = ((data as Record<string, any> | undefined)?.["wheelPoolPrices"] ??
      []) as number[];
    if (!wheelForm) return null;
    const odds = {
      tiers: wheelForm.tiers,
      losingPercent: wheelForm.losingPercent,
      ticketPriceBananas: wheelForm.ticketPriceBananas,
    };
    const rows = oddsBreakdown(odds, tierCounts(wheelForm.tiers, prices));
    return {
      poolSize: prices.length,
      rows,
      byTier: rows.slice(0, wheelForm.tiers.length),
      losing: rows.find((row) => row.label === LOSING_LABEL) ?? null,
    };
  }, [data, wheelForm]);

  // Reward Modal State
  const [rewardModalOpen, setRewardModalOpen] = useState(false);
  const [editingReward, setEditingReward] = useState<any | null>(null);
  const [rewardForm, setRewardForm] = useState({
    id: "",
    title: "",
    cost: 1000,
    stock: -1,
    icon: "🍌",
    category: "vouchers",
    description: "",
    couponValue: 0,
    couponType: "fixed",
    rewardCode: "",
    isActive: true,
    sortOrder: 0,
    /* Wheel tickets this reward hands over. 0 means it is not a ticket offer. */
    ticketQuantity: 0,
  });

  // Grant-tickets Modal State
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [ticketUser, setTicketUser] = useState<any | null>(null);
  const [ticketCount, setTicketCount] = useState("1");
  const [ticketReason, setTicketReason] = useState("");
  /*
    One value per opening of the dialog, so the reference identifies THIS
    press and not "a grant that looks like this one".

    It was built from the member, the count and the reason, which makes a
    double-click harmless and also makes the second deliberate grant
    impossible: one ticket with no reason typed produces the same reference
    for the rest of that member's life, and the ledger refuses it forever
    with "already granted". A count and a note are not an identity.
  */
  const [ticketPress, setTicketPress] = useState("");

  // Redemption Details Modal State
  const [selectedRedemption, setSelectedRedemption] = useState<any | null>(null);
  const [redemptionNotes, setRedemptionNotes] = useState("");
  const [redemptionCode, setRedemptionCode] = useState("");
  const [redemptionStatus, setRedemptionStatus] = useState<string>("completed");

  // Search and Filter states
  const [rewardsCategoryFilter, setRewardsCategoryFilter] = useState("all");
  const [rewardsSearch, setRewardsSearch] = useState("");
  const [redemptionsSearch, setRedemptionsSearch] = useState("");
  const [redemptionsStatusFilter, setRedemptionsStatusFilter] = useState("all");
  const [listingsSearch, setListingsSearch] = useState("");
  const [walletsSearch, setWalletsSearch] = useState("");

  // User balance adjustment modal
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustUser, setAdjustUser] = useState<any | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  // Notification / Feedback toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  /**
   * The reason this band cannot produce a usable price, if there is one.
   *
   * Mirrors what the server refuses on save — a base outside its own bounds,
   * and a band that rounds to nothing at the market's precision — so the admin
   * reads the same sentence before pressing the button that they would have
   * read after.
   */
  const marketPriceWarning = (() => {
    const base = Number(marketForm.basePrice);
    const min = Number(marketForm.minPrice);
    const max = Number(marketForm.maxPrice);
    if (![base, min, max].every((n) => Number.isFinite(n))) return null;

    if (min > max) {
      return `أدنى سعر (${min}) أكبر من أعلى سعر (${max}) — لا يوجد نطاق يمكن التسعير داخله.`;
    }
    if (base < min || base > max) {
      return `السعر الأساسي (${base}) خارج حدوده: أدنى ${min} وأعلى ${max}. المحرك يحصر كل سعر داخل الحدين، فالقيمة خارجهما لا أثر لها — وهذا سبب بقاء السعر كما هو بعد الحفظ.`;
    }
    const roundsToZero = [base, min, max].find((n) => !(Math.round(n * 1000) / 1000 > 0));
    if (roundsToZero !== undefined) {
      return `القيمة ${roundsToZero} تُقرَّب إلى صفر عند دقة السوق (٣ خانات) — لذلك يظهر «موزة واحدة 0.000 د.ع». أصغر قيمة قابلة للعرض هي 0.001.`;
    }
    return null;
  })();

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  /**
   * Says why a save did not happen.
   *
   * Not one mutation on this screen had an `onError`. The server refuses a
   * market band it cannot price — a base outside its own floor and ceiling, or
   * a band that rounds to nothing — and every one of those refusals arrived
   * here and vanished: no toast, no message, the form still showing what was
   * typed. From the admin's side the button did nothing, which is exactly how
   * «إعدادات الادمن لا تعمل» looks from the outside.
   *
   * The server's own Arabic message is shown when there is one, because it
   * names the field and the number rather than saying something went wrong.
   */
  const showFailure = (error: unknown) => {
    const message =
      error instanceof Error && error.message ? error.message : "تعذّر الحفظ — حاول مرة أخرى";
    setToastMessage(`⚠️ ${message}`);
    setTimeout(() => setToastMessage(null), 8000);
  };

  // Mutations
  const saveSettingsMutation = useMutation({
    mutationFn: (settings: typeof settingsForm) => adminApi.saveBananaSettings(settings),
    onError: showFailure,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_banana_data"] });
      showToast("تم حفظ إعدادات الاقتصاد وسوق الموز بنجاح");
    },
  });

  const saveMarketConfigMutation = useMutation({
    mutationFn: (config: Record<string, any>) => adminApi.saveBananaMarketConfig(config),
    onError: showFailure,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_banana_data"] });
      showToast("تم تحديث محرك تسعير السوق");
    },
  });

  const saveWheelOddsMutation = useMutation({
    mutationFn: (odds: NonNullable<typeof wheelForm>) => adminApi.saveWheelOdds(odds),
    onError: (error: unknown) => {
      /*
        The server's own sentence, not a generic one. Every refusal names which
        number is wrong and why — «حدود الفئات يجب أن تكون تصاعدية», «نسبة حظ
        أوفر يجب أن تكون بين 0 و 95» — and replacing that with "failed" would
        throw away the only thing that tells the owner what to change.
      */
      setWheelError(
        error instanceof Error && error.message ? error.message : "تعذّر الحفظ — حاول مرة أخرى",
      );
    },
    onSuccess: () => {
      setWheelError("");
      queryClient.invalidateQueries({ queryKey: ["admin_banana_data"] });
      showToast("تم حفظ نسب عجلة الحظ وسعر التذكرة");
    },
  });

  const saveBotMutation = useMutation({
    mutationFn: (bot: any) => adminApi.saveBananaBot(bot),
    onError: showFailure,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_banana_data"] });
      showToast("تم حفظ البوت");
    },
  });

  const deleteBotMutation = useMutation({
    mutationFn: (botId: string) => adminApi.deleteBananaBot(botId),
    onError: showFailure,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_banana_data"] });
      showToast("تم حذف البوت");
    },
  });

  const saveRewardMutation = useMutation({
    mutationFn: async (reward: any) => {
      const result = await adminApi.saveBananaReward(reward);
      /*
        The ticket count lives in its own table, so it is its own write — and
        it goes second deliberately: if the reward did not save there is no
        offer for a ticket count to belong to.

        Only when it actually changed. A blind write would send 0 for any
        reward whose card was opened before the screen learned to read the
        number, and 0 removes the offer from the wheel.
      */
      const offerId = String((result as any)?.reward?.id ?? reward.id ?? "").trim();
      const before = Number(
        (data?.rewards || []).find((r: any) => r.id === offerId)?.ticketQuantity ?? 0,
      );
      const after = Math.max(0, Math.floor(Number(reward.ticketQuantity) || 0));
      if (offerId && after !== before) await adminApi.setBananaRewardTickets(offerId, after);
      return result;
    },
    onError: showFailure,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_banana_data"] });
      setRewardModalOpen(false);
      setEditingReward(null);
      showToast("تم حفظ الجائزة بنجاح في قاعدة البيانات");
    },
  });

  /*
    «أو تعطى عن طريق الأدمن للمستخدمين». The reply says whether anything
    actually moved: a repeat with the same reference is refused by the
    ledger's unique index, and saying "done" to that would be a lie.
  */
  const grantTicketsMutation = useMutation({
    mutationFn: ({ userId, quantity, reason, referenceId }: any) =>
      adminApi.grantWheelTickets({ userId, quantity, reason, referenceId }),
    onError: showFailure,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin_banana_data"] });
      setTicketModalOpen(false);
      setTicketCount("1");
      setTicketReason("");
      setTicketPress("");
      showToast(
        result?.note
          ? result.note
          : `تم منح التذاكر — الرصيد الآن ${Number(result?.tickets ?? 0)} تذكرة`,
      );
    },
  });

  const deleteRewardMutation = useMutation({
    mutationFn: (rewardId: string) => adminApi.deleteBananaReward(rewardId),
    onError: showFailure,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_banana_data"] });
      showToast("تم حذف الجائزة");
    },
  });

  const toggleRewardMutation = useMutation({
    mutationFn: ({ rewardId, isActive }: { rewardId: string; isActive: boolean }) =>
      adminApi.toggleBananaReward(rewardId, isActive),
    onError: showFailure,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_banana_data"] });
    },
  });

  const updateRedemptionMutation = useMutation({
    mutationFn: ({ id, status, adminNotes, deliveryCode }: any) =>
      adminApi.updateBananaRedemption(id, { status, adminNotes, deliveryCode }),
    onError: showFailure,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_banana_data"] });
      setSelectedRedemption(null);
      showToast("تم تحديث حالة طلب الاستبدال بنجاح");
    },
  });

  const cancelListingMutation = useMutation({
    mutationFn: (listingId: string) => adminApi.cancelBananaListing(listingId),
    onError: showFailure,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin_banana_data"] });
      showToast(`تم إلغاء العرض وإرجاع ${res.refundedBananas} موزة لحساب البائع`);
    },
  });

  const adjustBalanceMutation = useMutation({
    mutationFn: ({ userId, amount, reason }: any) =>
      adminApi.adjustUserBanana(userId, amount, reason),
    onError: showFailure,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_banana_data"] });
      setAdjustModalOpen(false);
      setAdjustAmount("");
      setAdjustReason("");
      showToast("تم تعديل رصيد الموز للمستخدم بنجاح");
    },
  });

  // Filtered Rewards
  const filteredRewards = useMemo(() => {
    return (data?.rewards || []).filter((r: any) => {
      const matchCat = rewardsCategoryFilter === "all" || r.category === rewardsCategoryFilter;
      const matchSearch =
        !rewardsSearch ||
        r.title?.toLowerCase().includes(rewardsSearch.toLowerCase()) ||
        r.description?.toLowerCase().includes(rewardsSearch.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [data?.rewards, rewardsCategoryFilter, rewardsSearch]);

  // Filtered Redemptions
  const filteredRedemptions = useMemo(() => {
    return (data?.redemptions || []).filter((rd: any) => {
      const matchStatus =
        redemptionsStatusFilter === "all" || rd.status === redemptionsStatusFilter;
      const matchSearch =
        !redemptionsSearch ||
        rd.userName?.toLowerCase().includes(redemptionsSearch.toLowerCase()) ||
        rd.userPhone?.includes(redemptionsSearch) ||
        rd.rewardTitle?.toLowerCase().includes(redemptionsSearch.toLowerCase()) ||
        rd.deliveryCode?.toLowerCase().includes(redemptionsSearch.toLowerCase());
      return matchStatus && matchSearch;
    });
  }, [data?.redemptions, redemptionsStatusFilter, redemptionsSearch]);

  // Filtered Listings
  const filteredListings = useMemo(() => {
    return (data?.listings || []).filter((l: any) => {
      if (!listingsSearch) return true;
      const q = listingsSearch.toLowerCase();
      return (
        l.user_name?.toLowerCase().includes(q) ||
        l.user_phone?.includes(q) ||
        l.id?.toLowerCase().includes(q) ||
        l.status?.toLowerCase().includes(q)
      );
    });
  }, [data?.listings, listingsSearch]);

  // Filtered Top Users
  const filteredUsers = useMemo(() => {
    return (data?.topUsers || []).filter((u: any) => {
      if (!walletsSearch) return true;
      const q = walletsSearch.toLowerCase();
      return (
        u.name?.toLowerCase().includes(q) ||
        u.phone?.includes(q) ||
        u.userId?.toLowerCase().includes(q)
      );
    });
  }, [data?.topUsers, walletsSearch]);

  const handleOpenEditReward = (r?: any) => {
    if (r) {
      setEditingReward(r);
      setRewardForm({
        id: r.id,
        title: r.title,
        cost: r.cost,
        stock: r.stock,
        icon: r.icon,
        category: r.category,
        description: r.description || "",
        couponValue: r.couponValue || 0,
        couponType: r.couponType || "fixed",
        rewardCode: r.rewardCode || "",
        isActive: r.isActive !== false,
        sortOrder: r.sortOrder || 0,
        ticketQuantity: Number(r.ticketQuantity ?? 0),
      });
    } else {
      setEditingReward(null);
      setRewardForm({
        id: `rw-${Math.random().toString(36).substring(2, 8)}`,
        title: "",
        cost: 2000,
        stock: 50,
        icon: "🎁",
        category: "vouchers",
        description: "",
        couponValue: 5000,
        couponType: "fixed",
        rewardCode: "",
        isActive: true,
        sortOrder: (data?.rewards?.length || 0) + 1,
        ticketQuantity: 0,
      });
    }
    setRewardModalOpen(true);
  };

  const handleOpenRedemptionDetails = (rd: any) => {
    setSelectedRedemption(rd);
    setRedemptionStatus(rd.status || "completed");
    setRedemptionNotes(rd.adminNotes || "");
    setRedemptionCode(rd.deliveryCode || "");
  };

  return (
    <div
      className="w-full p-4 md:p-8 space-y-8 animate-in fade-in duration-300 font-sans"
      dir="rtl"
    >
      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 left-6 z-50 bg-black text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-amber-500/30 animate-in slide-in-from-bottom-4 duration-200">
          <CheckCircle2 className="w-5 h-5 text-amber-400" />
          <span className="text-sm font-bold">{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-3xl">🍌</span>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">
              إدارة واقتصاد سوق الموز بالكامل
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 font-medium">
            التحكم الكامل بجوائز الاستبدال، طلبات المستخدمين، تداولات السوق P2P، ومعدلات الاقتصاد.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card hover:bg-muted font-bold text-xs transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? "animate-spin" : ""}`} />
            تحديث البيانات
          </button>
          <button
            onClick={() => handleOpenEditReward()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-black text-xs transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            إضافة جائزة جديدة
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl border border-border/70 bg-card/60 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">إجمالي الموز المتداول</span>
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold">
              🍌
            </div>
          </div>
          <div className="mt-3 text-2xl font-black tracking-tight">
            {isLoading ? "..." : (data?.stats?.circulatingBananas ?? 0).toLocaleString("en-US")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground font-semibold flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>موزع على {data?.stats?.userWalletsCount ?? 0} محفظة مستخدم</span>
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-border/70 bg-card/60 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">
              عمليات الاستبدال المنجزة
            </span>
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center font-bold">
              <Gift className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black tracking-tight">
            {isLoading ? "..." : (data?.stats?.totalRedemptionsCount ?? 0).toLocaleString("en-US")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground font-semibold flex items-center gap-1.5">
            <span>
              تم حرق {(data?.stats?.totalBananasRedeemed ?? 0).toLocaleString("en-US")} 🍌 كمكافآت
            </span>
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-border/70 bg-card/60 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">عروض السوق النشطة (P2P)</span>
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black tracking-tight">
            {isLoading ? "..." : (data?.stats?.activeListingsCount ?? 0).toLocaleString("en-US")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground font-semibold flex items-center gap-1.5">
            <span>
              حجم المعروض: {(data?.stats?.activeListingsVolume ?? 0).toLocaleString("en-US")} 🍌
            </span>
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-border/70 bg-card/60 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">
              معدل كسب الموز لكل دينار
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 text-2xl font-black tracking-tight">
            {isLoading ? "..." : `${data?.settings?.rewardRatePerIqd ?? 6.8} 🍌`}
          </div>
          <div className="mt-1 text-xs text-muted-foreground font-semibold">
            <span>
              كل 1,000 د.ع مشتريات = {Math.round((data?.settings?.rewardRatePerIqd ?? 6.8) * 1000)}{" "}
              🍌
            </span>
          </div>
        </div>
      </div>

      {/* Main Sub Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-border overflow-x-auto no-scrollbar pb-2">
        <button
          onClick={() => setActiveTab("rewards")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all shrink-0 ${
            activeTab === "rewards"
              ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
              : "bg-muted/40 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Gift className="w-4 h-4" />
          جوائز الاستبدال ({data?.rewards?.length || 0})
        </button>

        <button
          onClick={() => setActiveTab("redemptions")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all shrink-0 ${
            activeTab === "redemptions"
              ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
              : "bg-muted/40 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Award className="w-4 h-4" />
          سجل وطلبات الاستبدال ({data?.redemptions?.length || 0})
        </button>

        <button
          onClick={() => setActiveTab("listings")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all shrink-0 ${
            activeTab === "listings"
              ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
              : "bg-muted/40 text-muted-foreground hover:text-foreground"
          }`}
        >
          <ShoppingBag className="w-4 h-4" />
          عروض وتداولات السوق ({data?.listings?.length || 0})
        </button>

        <button
          onClick={() => setActiveTab("wallets")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all shrink-0 ${
            activeTab === "wallets"
              ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
              : "bg-muted/40 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Coins className="w-4 h-4" />
          أرصدة المستخدمين والمحافظ
        </button>

        <button
          onClick={() => setActiveTab("market")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all shrink-0 ${
            activeTab === "market"
              ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
              : "bg-muted/40 text-muted-foreground hover:text-foreground"
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          محرك السوق والبوتات ({data?.bots?.length || 0})
        </button>

        <button
          onClick={() => setActiveTab("settings")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all shrink-0 ${
            activeTab === "settings"
              ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
              : "bg-muted/40 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sliders className="w-4 h-4" />
          إعدادات الاقتصاد وقواعد السوق
        </button>
        <button
          onClick={() => setActiveTab("wheel")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all shrink-0 ${
            activeTab === "wheel"
              ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
              : "bg-muted/40 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Ticket className="w-4 h-4" />
          عجلة الحظ — النسب وسعر التذكرة
        </button>
      </div>

      {/* TAB: MARKET ENGINE + BOTS */}
      {activeTab === "market" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> محرك تسعير سوق الموز
              </h3>
              <span className="text-xs font-bold text-muted-foreground">
                السعر الحالي: {formatPrice(data?.livePrice ?? 0)} د.ع
              </span>
            </div>

            {/*
              Why the price is what it is.

              «السعر الحالي: 0.000 د.ع» sat above these boxes with nothing to
              explain it, and the reason is not visible in any single field: the
              engine clamps every price between the floor and the ceiling and
              then rounds to three decimals, so a base of 250 under a ceiling of
              0.0003 is priced at the ceiling and shown as zero. The admin sets
              the base, sees no change, and concludes the settings do not work.

              Checked against the numbers in the form rather than the saved
              ones, so it answers before the save rather than after it.
            */}
            {marketPriceWarning && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[11px] font-bold leading-relaxed text-amber-700 dark:text-amber-300">
                {marketPriceWarning}
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {MARKET_FIELDS.map((f) => (
                <label key={f.key} className="text-xs font-bold space-y-1">
                  <span className="text-muted-foreground">{f.label}</span>
                  <input
                    type="number"
                    step="any"
                    value={(marketForm as any)[f.key] ?? 0}
                    onChange={(e) =>
                      setMarketForm((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-muted/40 border border-border outline-none"
                  />
                </label>
              ))}
              <label className="text-xs font-bold flex items-center gap-2 mt-5">
                <input
                  type="checkbox"
                  checked={Boolean(marketForm.botsEnabled)}
                  onChange={(e) =>
                    setMarketForm((prev) => ({ ...prev, botsEnabled: e.target.checked }))
                  }
                />
                تفعيل عروض البوتات في السوق
              </label>
            </div>

            <button
              onClick={() => saveMarketConfigMutation.mutate(marketForm)}
              disabled={saveMarketConfigMutation.isPending}
              className="px-5 py-2.5 rounded-xl bg-black text-white dark:bg-white dark:text-black font-black text-xs"
            >
              {saveMarketConfigMutation.isPending ? "جارٍ الحفظ..." : "حفظ إعدادات المحرك"}
            </button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> بوتات صناعة السوق
              </h3>
              <button
                onClick={() => {
                  const rand = (min: number, max: number, step = 1) =>
                    Math.round((min + Math.random() * (max - min)) / step) * step;
                  const base = Number(data?.livePrice ?? marketForm.basePrice ?? 1) || 1;
                  /*
                    Rounded the way the engine rounds, not to three decimals.
                    A base of 0.0004 through `toFixed(3)` gives a floor and a
                    ceiling of 0.000, which is a band no price can sit inside.
                  */
                  const minPrice = roundPrice(base * (0.6 + Math.random() * 0.25));
                  const maxPrice = roundPrice(base * (1.1 + Math.random() * 0.45));
                  const maxTrade = rand(1000, 20000, 500);
                  saveBotMutation.mutate({
                    name: `بوت ${(data?.bots?.length || 0) + 1}`,
                    budgetIqd: rand(250000, 3000000, 50000),
                    maxTradeBanana: maxTrade,
                    dailyLimitBanana: maxTrade * rand(2, 6),
                    maxTotalBanana: maxTrade * rand(8, 25),
                    minPriceIqd: minPrice,
                    maxPurchasePriceIqd: maxPrice,
                    isActive: true,
                  });
                }}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-muted/50 font-bold text-xs"
              >
                <Plus className="w-4 h-4" /> إضافة بوت
              </button>
            </div>

            <div className="space-y-2">
              {(data?.bots || []).map((bot: any) => (
                <div
                  key={bot.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3"
                >
                  <input
                    defaultValue={bot.name}
                    onBlur={(e) =>
                      saveBotMutation.mutate({ ...toBotPayload(bot), name: e.target.value })
                    }
                    className="px-3 py-2 rounded-lg bg-muted/40 text-xs font-bold flex-1 min-w-[140px]"
                  />
                  <input
                    type="number"
                    defaultValue={bot.budget_iqd ?? 0}
                    onBlur={(e) =>
                      saveBotMutation.mutate({
                        ...toBotPayload(bot),
                        budgetIqd: Number(e.target.value),
                      })
                    }
                    className="px-3 py-2 rounded-lg bg-muted/40 text-xs font-bold w-32"
                    title="الميزانية بالدينار"
                  />
                  <input
                    type="number"
                    defaultValue={bot.max_trade_banana ?? 0}
                    onBlur={(e) =>
                      saveBotMutation.mutate({
                        ...toBotPayload(bot),
                        maxTradeBanana: Number(e.target.value),
                      })
                    }
                    className="px-3 py-2 rounded-lg bg-muted/40 text-xs font-bold w-32"
                    title="أقصى كمية موز للصفقة"
                  />
                  <label className="flex items-center gap-1 text-xs font-bold">
                    <input
                      type="checkbox"
                      checked={Boolean(bot.is_active)}
                      onChange={(e) =>
                        saveBotMutation.mutate({
                          ...toBotPayload(bot),
                          isActive: e.target.checked,
                        })
                      }
                    />
                    نشط
                  </label>
                  <button
                    onClick={() => deleteBotMutation.mutate(bot.id)}
                    className="p-2 rounded-lg bg-red-500/10 text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {!data?.bots?.length && (
                <p className="text-xs text-muted-foreground font-bold">لا توجد بوتات بعد.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: REWARDS CATALOG */}
      {activeTab === "rewards" && (
        <div className="space-y-6">
          {/* Controls bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-72">
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="بحث في الجوائز والمكافآت..."
                  value={rewardsSearch}
                  onChange={(e) => setRewardsSearch(e.target.value)}
                  className="w-full pl-3 pr-9 py-2 rounded-xl border border-border bg-card text-xs font-medium focus:border-amber-500 outline-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar w-full sm:w-auto pb-1">
              {[
                { id: "all", label: "الكل" },
                { id: "vouchers", label: "🎟️ قسائم وخصومات" },
                { id: "digital", label: "🎮 بطاقات وشحن" },
                { id: "physical", label: "🕹️ هدايا واكسسوارات" },
                { id: "perks", label: "⭐ مزايا وعضويات" },
              ].map((c) => (
                <button
                  key={c.id}
                  onClick={() => setRewardsCategoryFilter(c.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors ${
                    rewardsCategoryFilter === c.id
                      ? "bg-amber-500/20 text-amber-600 border border-amber-500/40"
                      : "bg-muted/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Grid of Rewards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRewards.map((reward: any) => (
              <div
                key={reward.id}
                className={`p-5 rounded-2xl border transition-all relative flex flex-col justify-between ${
                  reward.isActive === false
                    ? "bg-muted/20 border-border/40 opacity-70"
                    : "bg-card border-border/80 hover:border-amber-500/50 shadow-sm"
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl p-2 rounded-xl bg-muted/60">
                        {reward.icon || "🎁"}
                      </span>
                      <div>
                        <h3 className="font-bold text-sm leading-snug">{reward.title}</h3>
                        <span className="inline-block px-2 py-0.5 mt-1 rounded-md text-[10px] font-bold bg-muted text-muted-foreground uppercase tracking-wider">
                          {reward.category === "vouchers"
                            ? "قسيمة خصم"
                            : reward.category === "digital"
                              ? "بطاقة رقمية"
                              : reward.category === "physical"
                                ? "منتج حقيقي"
                                : "ميزة حساب"}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() =>
                        toggleRewardMutation.mutate({
                          rewardId: reward.id,
                          isActive: reward.isActive === false,
                        })
                      }
                      title={reward.isActive === false ? "تفعيل الجائزة" : "إيقاف مؤقت"}
                      className={`p-1.5 rounded-lg text-xs transition-colors ${
                        reward.isActive === false
                          ? "bg-muted text-muted-foreground hover:text-foreground"
                          : "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                      }`}
                    >
                      {reward.isActive === false ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {reward.description && (
                    <p className="mt-3 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {reward.description}
                    </p>
                  )}

                  <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                    <div className="font-black text-amber-500 text-sm">
                      🍌 {Number(reward.cost).toLocaleString("en-US")}
                    </div>
                    <div className="font-semibold text-muted-foreground">
                      المخزون:{" "}
                      <span className="text-foreground font-bold">
                        {reward.stock === -1 ? "غير محدود (∞)" : `${reward.stock} قطعة`}
                      </span>
                    </div>
                  </div>

                  {reward.couponValue > 0 && (
                    <div className="mt-2 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                      <Tag className="w-3 h-3" />
                      <span>
                        تنشئ كود خصم بقيمة {reward.couponValue.toLocaleString("en-US")} د.ع
                      </span>
                    </div>
                  )}

                  {Number(reward.ticketQuantity) > 0 && (
                    <div className="mt-2 text-[11px] font-semibold text-violet-600 dark:text-violet-400 bg-violet-500/10 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
                      <Ticket className="w-3 h-3" />
                      <span>تعطي {Number(reward.ticketQuantity)} تذكرة لعجلة الحظ</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-end gap-2">
                  <button
                    onClick={() => handleOpenEditReward(reward)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-xs font-bold transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    تعديل
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`هل أنت متأكد من حذف جائزة "${reward.title}"؟`)) {
                        deleteRewardMutation.mutate(reward.id);
                      }
                    }}
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 text-xs transition-colors"
                    title="حذف"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {filteredRewards.length === 0 && (
            <div className="text-center py-16 bg-card rounded-2xl border border-dashed border-border text-muted-foreground text-sm">
              لا توجد جوائز مطابقة لبحثك.
            </div>
          )}
        </div>
      )}

      {/* TAB 2: REDEMPTIONS LOG */}
      {activeTab === "redemptions" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="بحث بالمستخدم، الهاتف، كود التسليم..."
                value={redemptionsSearch}
                onChange={(e) => setRedemptionsSearch(e.target.value)}
                className="w-full pl-3 pr-9 py-2 rounded-xl border border-border bg-card text-xs font-medium focus:border-amber-500 outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar w-full sm:w-auto pb-1">
              {[
                { id: "all", label: "الكل" },
                { id: "completed", label: "مكتمل" },
                { id: "processing", label: "قيد المعالجة" },
                { id: "delivered", label: "تم التسليم" },
                { id: "cancelled", label: "ملغي" },
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setRedemptionsStatusFilter(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors ${
                    redemptionsStatusFilter === s.id
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "bg-muted/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-muted/50 border-b border-border text-muted-foreground font-bold">
                  <tr>
                    <th className="p-3.5">المستخدم</th>
                    <th className="p-3.5">الجائزة المستبدلة</th>
                    <th className="p-3.5">التكلفة</th>
                    <th className="p-3.5">كود التسليم / القسيمة</th>
                    <th className="p-3.5">الحالة</th>
                    <th className="p-3.5">التاريخ</th>
                    <th className="p-3.5 text-left">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 font-medium">
                  {filteredRedemptions.map((rd: any) => (
                    <tr key={rd.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3.5">
                        <div className="font-bold text-foreground">{rd.userName || "مستخدم"}</div>
                        {rd.userPhone && (
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Phone className="w-3 h-3 text-emerald-500" />
                            <span dir="ltr">{rd.userPhone}</span>
                          </div>
                        )}
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{rd.rewardIcon || "🎁"}</span>
                          <span className="font-bold">{rd.rewardTitle || rd.rewardId}</span>
                        </div>
                      </td>
                      <td className="p-3.5 font-bold text-amber-500">
                        🍌 {Number(rd.cost).toLocaleString("en-US")}
                      </td>
                      <td className="p-3.5">
                        {rd.deliveryCode ? (
                          <span
                            className="font-mono px-2 py-1 rounded bg-muted font-bold text-[11px] text-foreground inline-block"
                            dir="ltr"
                          >
                            {rd.deliveryCode}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            rd.status === "completed"
                              ? "bg-emerald-500/10 text-emerald-600"
                              : rd.status === "processing"
                                ? "bg-amber-500/10 text-amber-600"
                                : rd.status === "delivered"
                                  ? "bg-blue-500/10 text-blue-600"
                                  : "bg-rose-500/10 text-rose-600"
                          }`}
                        >
                          {rd.status === "completed"
                            ? "مكتمل"
                            : rd.status === "processing"
                              ? "قيد المعالجة"
                              : rd.status === "delivered"
                                ? "تم التسليم"
                                : "ملغي"}
                        </span>
                      </td>
                      <td className="p-3.5 text-muted-foreground text-[11px]">
                        {new Date(rd.createdAt).toLocaleDateString("ar-IQ", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="p-3.5 text-left">
                        <button
                          onClick={() => handleOpenRedemptionDetails(rd)}
                          className="px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-xs font-bold transition-colors"
                        >
                          إدارة الطلب
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredRedemptions.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-xs">
                لا توجد عمليات استبدال مسجلة حتى الآن.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: MARKET LISTINGS P2P */}
      {activeTab === "listings" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="بحث بالبائع أو السعر أو المعرف..."
                value={listingsSearch}
                onChange={(e) => setListingsSearch(e.target.value)}
                className="w-full pl-3 pr-9 py-2 rounded-xl border border-border bg-card text-xs font-medium focus:border-amber-500 outline-none"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-muted/50 border-b border-border text-muted-foreground font-bold">
                  <tr>
                    <th className="p-3.5">البائع</th>
                    <th className="p-3.5">الكمية المعروضة</th>
                    <th className="p-3.5">سعر الموزة (د.ع)</th>
                    <th className="p-3.5">الإجمالي (د.ع)</th>
                    <th className="p-3.5">النوع / الترويج</th>
                    <th className="p-3.5">الحالة</th>
                    <th className="p-3.5 text-left">إجراءات الإدارة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 font-medium">
                  {filteredListings.map((listing: any) => (
                    <tr key={listing.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3.5">
                        <div className="font-bold text-foreground">
                          {listing.user_name || "مستخدم"}
                        </div>
                        {listing.user_phone && (
                          <div className="text-[11px] text-muted-foreground" dir="ltr">
                            {listing.userPhone}
                          </div>
                        )}
                      </td>
                      <td className="p-3.5 font-bold text-amber-500 text-sm">
                        🍌 {Number(listing.quantity).toLocaleString("en-US")}
                      </td>
                      {/*
                        `price_per` is a column this table does not have, so
                        both of these printed «NaN د.ع» on every row. The stored
                        column is `price_iqd` and it is the TOTAL; the server
                        divides the unit price out of it now and sends both.
                      */}
                      <td className="p-3.5 font-semibold text-foreground">
                        {Number(listing.pricePer).toLocaleString("en-US", {
                          maximumFractionDigits: 6,
                        })}{" "}
                        د.ع
                      </td>
                      <td className="p-3.5 font-bold text-emerald-600">
                        {Math.round(Number(listing.priceIqd)).toLocaleString("en-US")} د.ع
                      </td>
                      <td className="p-3.5">
                        {/*
                          `is_promoted` and `is_private` are columns the table
                          does not have either, so this could only ever print
                          «عادي». The listing's own status is the thing that is
                          actually recorded, so that is what is shown until the
                          two flags are either stored or dropped.
                        */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-muted-foreground text-[11px]">
                            {listing.status === "sold"
                              ? "مُباع"
                              : listing.status === "cancelled"
                                ? "ملغى"
                                : listing.status === "processing"
                                  ? "قيد البيع"
                                  : "معروض"}
                          </span>
                          {listing.buyerId ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-bold text-[10px]">
                              اشتراه {listing.buyerId.slice(-6)}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            listing.status === "active"
                              ? "bg-emerald-500/10 text-emerald-600"
                              : listing.status === "sold"
                                ? "bg-blue-500/10 text-blue-600"
                                : "bg-rose-500/10 text-rose-600"
                          }`}
                        >
                          {listing.status === "active"
                            ? "نشط"
                            : listing.status === "sold"
                              ? "تم البيع"
                              : "ملغي"}
                        </span>
                      </td>
                      <td className="p-3.5 text-left">
                        {listing.status === "active" && (
                          <button
                            onClick={() => {
                              if (confirm("هل تريد إلغاء هذا العرض وإرجاع الموز لحساب البائع؟")) {
                                cancelListingMutation.mutate(listing.id);
                              }
                            }}
                            className="px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 text-xs font-bold transition-colors"
                          >
                            إلغاء وإرجاع الموز
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredListings.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-xs">
                لا توجد عروض في السوق حالياً.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: WALLETS & USER ADJUSTMENTS */}
      {activeTab === "wallets" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="بحث باسم المستخدم أو الهاتف..."
                value={walletsSearch}
                onChange={(e) => setWalletsSearch(e.target.value)}
                className="w-full pl-3 pr-9 py-2 rounded-xl border border-border bg-card text-xs font-medium focus:border-amber-500 outline-none"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-muted/50 border-b border-border text-muted-foreground font-bold">
                  <tr>
                    <th className="p-3.5">المستخدم</th>
                    <th className="p-3.5">رقم الهاتف</th>
                    <th className="p-3.5">معرف الحساب</th>
                    <th className="p-3.5">رصيد الموز</th>
                    <th className="p-3.5 text-left">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 font-medium">
                  {filteredUsers.map((user: any) => (
                    <tr key={user.userId} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3.5 font-bold text-foreground">{user.name || "مستخدم"}</td>
                      <td className="p-3.5 text-muted-foreground font-mono" dir="ltr">
                        {user.phone || "—"}
                      </td>
                      <td className="p-3.5 text-muted-foreground font-mono text-[11px]">
                        {user.userId}
                      </td>
                      <td className="p-3.5 font-black text-amber-500 text-sm">
                        🍌 {Number(user.balance).toLocaleString("en-US")}
                      </td>
                      <td className="p-3.5 text-left">
                        <button
                          onClick={() => {
                            setAdjustUser(user);
                            setAdjustAmount("");
                            setAdjustReason("");
                            setAdjustModalOpen(true);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 text-xs font-bold transition-colors"
                        >
                          تعديل الرصيد
                        </button>
                        <button
                          onClick={() => {
                            setTicketUser(user);
                            setTicketCount("1");
                            setTicketReason("");
                            setTicketPress(
                              `press_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
                            );
                            setTicketModalOpen(true);
                          }}
                          className="ms-2 px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-400 hover:bg-violet-500/20 text-xs font-bold transition-colors"
                        >
                          منح تذاكر
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredUsers.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-xs">
                لا توجد محافظ مستخدمين مطابقة.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: ECONOMY & MARKET SETTINGS */}
      {/* TAB: THE WHEEL — bands, the losing chance, and what a ticket costs */}
      {activeTab === "wheel" && (
        <div className="w-full bg-card border border-border rounded-2xl p-6 space-y-6 shadow-sm">
          <div>
            <h2 className="text-lg font-bold">عجلة الحظ — النسب والتقسيمات</h2>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              فئات الأسعار، وزن كل فئة، نسبة «حظ أوفر»، وسعر التذكرة بالموز.
            </p>
          </div>

          {!wheelForm ? (
            <p className="text-xs text-muted-foreground">جارِ التحميل…</p>
          ) : (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold mb-1.5">
                  سعر التذكرة الواحدة (🍌 موزة):
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={wheelForm.ticketPriceBananas}
                  onChange={(e) =>
                    setWheelForm({
                      ...wheelForm,
                      ticketPriceBananas: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full p-3 rounded-xl border border-border bg-muted/40 font-bold text-sm outline-none focus:border-amber-500 transition-colors"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {wheelForm.ticketPriceBananas > 0 ? (
                    <>
                      الزبون يدفع{" "}
                      <span className="font-bold text-amber-500">
                        {wheelForm.ticketPriceBananas.toLocaleString("en-US")} موزة
                      </span>{" "}
                      مقابل دورة واحدة.
                    </>
                  ) : (
                    <span className="font-bold text-amber-600">
                      صفر يعني أن التذاكر غير معروضة للبيع — لن يتمكن أحد من الشراء حتى تحدد سعرًا.
                    </span>
                  )}
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5">
                  نسبة «حظ أوفر» — الدورة التي لا تربح شيئًا (%):
                </label>
                <input
                  type="number"
                  min={0}
                  max={95}
                  step={1}
                  value={wheelForm.losingPercent}
                  onChange={(e) =>
                    setWheelForm({ ...wheelForm, losingPercent: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full p-3 rounded-xl border border-border bg-muted/40 font-bold text-sm outline-none focus:border-amber-500 transition-colors"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  من كل 100 دورة،{" "}
                  <span className="font-bold text-amber-500">
                    {Math.round(wheelForm.losingPercent)}
                  </span>{" "}
                  لا تربح لعبة. التذكرة تُخصم في كل الحالات.
                </p>
                {wheelPreview?.losing && wheelPreview.byTier[0] ? (
                  <p
                    className={`text-[11px] font-bold mt-1 ${
                      wheelPreview.losing.chance > wheelPreview.byTier[0].chance
                        ? "text-emerald-600"
                        : "text-amber-600"
                    }`}
                  >
                    {wheelPreview.losing.chance > wheelPreview.byTier[0].chance
                      ? `«حظ أوفر» ${pct(wheelPreview.losing.chance)} — أعلى من «${wheelPreview.byTier[0].label}» (${pct(wheelPreview.byTier[0].chance)}).`
                      : `«حظ أوفر» ${pct(wheelPreview.losing.chance)} — ما زالت أقل من «${wheelPreview.byTier[0].label}» (${pct(wheelPreview.byTier[0].chance)}).`}
                  </p>
                ) : null}
              </div>

              <div>
                <label className="block text-xs font-bold mb-2">فئات الأسعار وأوزانها:</label>
                <div className="space-y-2">
                  {wheelForm.tiers.map((tier, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[1fr_auto_auto] gap-2 items-center bg-muted/30 rounded-xl p-2"
                    >
                      <input
                        value={tier.label}
                        onChange={(e) => {
                          const tiers = [...wheelForm.tiers];
                          tiers[index] = { ...tier, label: e.target.value };
                          setWheelForm({ ...wheelForm, tiers });
                        }}
                        placeholder="الاسم"
                        className="p-2 rounded-lg border border-border bg-background font-bold text-xs outline-none focus:border-amber-500"
                      />
                      <input
                        type="number"
                        value={tier.upTo ?? ""}
                        onChange={(e) => {
                          const tiers = [...wheelForm.tiers];
                          tiers[index] = {
                            ...tier,
                            upTo: e.target.value === "" ? null : parseInt(e.target.value) || 0,
                          };
                          setWheelForm({ ...wheelForm, tiers });
                        }}
                        placeholder="بلا حد"
                        title="أعلى سعر في هذه الفئة — اتركه فارغًا للفئة الأخيرة"
                        className="w-28 p-2 rounded-lg border border-border bg-background font-bold text-xs outline-none focus:border-amber-500"
                      />
                      <input
                        type="number"
                        min={0}
                        value={tier.weight}
                        onChange={(e) => {
                          const tiers = [...wheelForm.tiers];
                          tiers[index] = { ...tier, weight: parseFloat(e.target.value) || 0 };
                          setWheelForm({ ...wheelForm, tiers });
                        }}
                        title="الوزن — كلما زاد زادت فرصة كل لعبة في هذه الفئة"
                        className="w-20 p-2 rounded-lg border border-border bg-background font-bold text-xs outline-none focus:border-amber-500"
                      />
                      {wheelPreview?.byTier[index] ? (
                        <p className="col-span-3 text-[11px] text-muted-foreground -mt-0.5">
                          <span className="font-bold text-amber-500">
                            {pct(wheelPreview.byTier[index].chance)}
                          </span>{" "}
                          من الدورات · {wheelPreview.byTier[index].games.toLocaleString("en-US")}{" "}
                          لعبة في هذه الفئة
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  الوزن لكل <span className="font-bold">لعبة</span> وليس للفئة: فرصة الفئة = وزنها ×
                  عدد ألعابها. اترك الحد الأعلى فارغًا في الفئة الأخيرة لتشمل كل ما فوقها.
                </p>

                {wheelPreview && wheelPreview.poolSize > 0 ? (
                  <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3">
                    <p className="text-[11px] font-bold mb-2">
                      النتيجة على {wheelPreview.poolSize.toLocaleString("en-US")} لعبة في العجلة
                      الآن:
                    </p>
                    <div className="space-y-1">
                      {wheelPreview.rows.map((row, index) => (
                        <div
                          key={`${index}-${row.label}`}
                          className="flex items-center justify-between gap-2 text-[11px]"
                        >
                          <span
                            className={row.label === LOSING_LABEL ? "font-bold" : "text-foreground"}
                          >
                            {row.label}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              {row.games ? `${row.games.toLocaleString("en-US")} لعبة` : "—"}
                            </span>
                            <span className="font-bold text-amber-500 w-14 text-left">
                              {pct(row.chance)}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-amber-600 font-bold mt-3">
                    لا توجد ألعاب في العجلة الآن، فلا يمكن حساب النسب.
                  </p>
                )}
              </div>

              {wheelError && (
                <p className="text-xs font-bold text-red-500 bg-red-500/10 rounded-xl p-3">
                  {wheelError}
                </p>
              )}

              <button
                onClick={() => saveWheelOddsMutation.mutate(wheelForm)}
                disabled={saveWheelOddsMutation.isPending}
                className="w-full bg-black dark:bg-white text-white dark:text-black rounded-xl p-3.5 font-bold text-sm disabled:opacity-60"
              >
                {saveWheelOddsMutation.isPending ? "…" : "✓ حفظ نسب العجلة وسعر التذكرة"}
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === "settings" && (
        <div className="w-full bg-card border border-border rounded-2xl p-6 space-y-6 shadow-sm">
          <div>
            <h2 className="text-lg font-bold">قواعد الاقتصاد وسعر الصرف</h2>
            <p className="text-xs text-muted-foreground mt-1 font-medium">
              التحكم في سرعة كسب الموز، قيمة الاستبدال، وسعر الافتتاح في السوق.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold mb-1.5">
                معدل كسب الموز لكل 1 دينار عراقي مشتريات:
              </label>
              <input
                type="number"
                step="0.1"
                value={settingsForm.rewardRatePerIqd}
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    rewardRatePerIqd: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full p-3 rounded-xl border border-border bg-muted/40 font-bold text-sm outline-none focus:border-amber-500 transition-colors"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                مثال: عند شراء لعبة بـ 50,000 دينار، يحصل الزبون على{" "}
                <span className="font-bold text-amber-500">
                  {Math.round(50000 * settingsForm.rewardRatePerIqd).toLocaleString("en-US")} موزة
                </span>
                .
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1.5">
                سعر الافتتاح المرجعي للموز (د.ع):
              </label>
              <input
                type="number"
                step="0.01"
                value={settingsForm.openingPrice}
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    openingPrice: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full p-3 rounded-xl border border-border bg-muted/40 font-bold text-sm outline-none focus:border-amber-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-bold mb-1.5">
                تكلفة تمييز العروض في سوق الموز (موزة لكل دقيقة):
              </label>
              <input
                type="number"
                value={settingsForm.promoRatePerMinute}
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    promoRatePerMinute: parseInt(e.target.value) || 0,
                  })
                }
                className="w-full p-3 rounded-xl border border-border bg-muted/40 font-bold text-sm outline-none focus:border-amber-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-bold mb-1.5">
                منحة التسجيل المجانية للمستخدم الجديد (🍌 موزة):
              </label>
              <input
                type="number"
                value={settingsForm.signupGrant}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, signupGrant: parseInt(e.target.value) || 0 })
                }
                className="w-full p-3 rounded-xl border border-border bg-muted/40 font-bold text-sm outline-none focus:border-amber-500 transition-colors"
              />
            </div>
          </div>

          <button
            onClick={() => saveSettingsMutation.mutate(settingsForm)}
            disabled={saveSettingsMutation.isPending}
            className="w-full py-3.5 rounded-xl bg-black hover:bg-zinc-800 text-white dark:bg-white dark:text-black font-black text-sm transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
          >
            {saveSettingsMutation.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            حفظ إعدادات الاقتصاد
          </button>
        </div>
      )}

      {/* MODAL: ADD / EDIT REWARD */}
      {rewardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <h3 className="font-black text-lg">
                {editingReward ? "تعديل جائزة الاستبدال" : "إضافة جائزة استبدال جديدة"}
              </h3>
              <button
                onClick={() => setRewardModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs font-bold">
              <div>
                <label className="block mb-1">اسم الجائزة / المكافأة *</label>
                <input
                  type="text"
                  placeholder="مثال: كوبون خصم 10,000 د.ع"
                  value={rewardForm.title}
                  onChange={(e) => setRewardForm({ ...rewardForm, title: e.target.value })}
                  className="w-full p-3 rounded-xl border border-border bg-muted/40 font-medium text-sm outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1">التكلفة بالموز (🍌) *</label>
                  <input
                    type="number"
                    value={rewardForm.cost}
                    onChange={(e) =>
                      setRewardForm({ ...rewardForm, cost: parseInt(e.target.value) || 0 })
                    }
                    className="w-full p-3 rounded-xl border border-border bg-muted/40 font-black text-sm outline-none focus:border-amber-500 text-amber-500"
                  />
                </div>

                <div>
                  <label className="block mb-1">الرمز التعبيري / الأيقونة</label>
                  <input
                    type="text"
                    value={rewardForm.icon}
                    onChange={(e) => setRewardForm({ ...rewardForm, icon: e.target.value })}
                    className="w-full p-3 rounded-xl border border-border bg-muted/40 text-center text-lg outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block mb-1">التصنيف</label>
                  <select
                    value={rewardForm.category}
                    onChange={(e) => setRewardForm({ ...rewardForm, category: e.target.value })}
                    className="w-full p-3 rounded-xl border border-border bg-muted/40 font-bold text-xs outline-none focus:border-amber-500"
                  >
                    <option value="vouchers">🎟️ قسائم وكوبونات المتجر</option>
                    <option value="digital">🎮 بطاقات وشحن ألعاب</option>
                    <option value="physical">🕹️ هدايا واكسسوارات حقيقية</option>
                    <option value="perks">⭐ مزايا وعضويات الحساب</option>
                  </select>
                </div>

                <div>
                  <label className="block mb-1">المخزون (-1 لغير المحدود)</label>
                  <input
                    type="number"
                    value={rewardForm.stock}
                    onChange={(e) =>
                      setRewardForm({ ...rewardForm, stock: parseInt(e.target.value) || 0 })
                    }
                    className="w-full p-3 rounded-xl border border-border bg-muted/40 font-medium text-xs outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block mb-1">وصف الجائزة وشروطها</label>
                <textarea
                  rows={2}
                  placeholder="اكتب شرحاً مختصراً يوضح فائدة المكافأة للمستخدم..."
                  value={rewardForm.description}
                  onChange={(e) => setRewardForm({ ...rewardForm, description: e.target.value })}
                  className="w-full p-3 rounded-xl border border-border bg-muted/40 font-medium text-xs outline-none focus:border-amber-500 resize-none"
                />
              </div>

              {/* Special settings for vouchers */}
              {rewardForm.category === "vouchers" && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-3">
                  <div className="text-amber-700 dark:text-amber-400 font-bold flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5" />
                    <span>إعدادات التوليد التلقائي للكوبون في المتجر</span>
                  </div>
                  <div>
                    <label className="block mb-1 text-muted-foreground">
                      قيمة الخصم بالدينار العراقي:
                    </label>
                    <input
                      type="number"
                      step="500"
                      value={rewardForm.couponValue}
                      onChange={(e) =>
                        setRewardForm({ ...rewardForm, couponValue: parseInt(e.target.value) || 0 })
                      }
                      className="w-full p-2.5 rounded-lg border border-border bg-card font-bold text-xs outline-none"
                    />
                  </div>
                </div>
              )}

              {/*
                Tickets, on every category rather than behind one.
                A ticket offer is not a coupon and not a digital code — it is
                whatever the owner decides to call it, and hiding the field
                behind a category would mean the reward's name has to be
                chosen before the thing it sells can be.
              */}
              <div className="p-3.5 rounded-xl bg-violet-500/10 border border-violet-500/20 space-y-2">
                <div className="text-violet-700 dark:text-violet-400 font-bold flex items-center gap-1.5">
                  <Ticket className="w-3.5 h-3.5" />
                  <span>تذاكر عجلة الحظ</span>
                </div>
                <div>
                  <label className="block mb-1 text-muted-foreground">
                    كم تذكرة يحصل عليها المستخدم عند استبدال هذه الجائزة:
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="1"
                    value={rewardForm.ticketQuantity}
                    onChange={(e) =>
                      setRewardForm({
                        ...rewardForm,
                        ticketQuantity: Math.max(0, parseInt(e.target.value) || 0),
                      })
                    }
                    className="w-full p-2.5 rounded-lg border border-border bg-card font-bold text-xs outline-none"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1 font-normal">
                    اتركها صفراً إذا لم تكن هذه الجائزة تذاكر. سعر التذكرة بالموز هو سعر الجائزة
                    نفسه في الأعلى.
                  </p>
                </div>
              </div>

              {/* Special settings for digital codes */}
              {rewardForm.category === "digital" && (
                <div>
                  <label className="block mb-1">كود/مفتاح البطاقة الافتراضي (اختياري)</label>
                  <input
                    type="text"
                    placeholder="مثال: XXXX-YYYY-ZZZZ"
                    value={rewardForm.rewardCode}
                    onChange={(e) => setRewardForm({ ...rewardForm, rewardCode: e.target.value })}
                    className="w-full p-3 rounded-xl border border-border bg-muted/40 font-mono text-xs outline-none"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1 font-normal">
                    إذا تركته فارغاً، سيتعين عليك إدخاله يدوياً في سجل الطلبات عند تسليم البطاقة.
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="reward_is_active"
                  checked={rewardForm.isActive}
                  onChange={(e) => setRewardForm({ ...rewardForm, isActive: e.target.checked })}
                  className="rounded w-4 h-4 text-amber-500"
                />
                <label htmlFor="reward_is_active" className="cursor-pointer">
                  تفعيل الجائزة وظهورها للمستخدمين فوراً
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <button
                onClick={() => setRewardModalOpen(false)}
                className="px-4 py-2.5 rounded-xl border border-border text-xs font-bold hover:bg-muted"
              >
                إلغاء
              </button>
              <button
                onClick={() => saveRewardMutation.mutate(rewardForm)}
                disabled={!rewardForm.title || saveRewardMutation.isPending}
                className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-black text-xs transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {saveRewardMutation.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                حفظ الجائزة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: REDEMPTION ORDER MANAGEMENT */}
      {selectedRedemption && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <h3 className="font-black text-lg">إدارة طلب الاستبدال</h3>
              <button
                onClick={() => setSelectedRedemption(null)}
                className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs font-bold">
              <div className="p-3.5 rounded-2xl bg-muted/40 border border-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">المستخدم:</span>
                  <span className="text-foreground">{selectedRedemption.userName || "مستخدم"}</span>
                </div>
                {selectedRedemption.userPhone && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">الهاتف:</span>
                    <a
                      href={`https://wa.me/${selectedRedemption.userPhone.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-500 flex items-center gap-1 hover:underline"
                    >
                      <MessageSquare className="w-3 h-3" />
                      <span dir="ltr">{selectedRedemption.userPhone}</span>
                    </a>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">الجائزة:</span>
                  <span>{selectedRedemption.rewardTitle}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">الموز المستبدل:</span>
                  <span className="text-amber-500 font-black">
                    🍌 {Number(selectedRedemption.cost).toLocaleString("en-US")}
                  </span>
                </div>
              </div>

              <div>
                <label className="block mb-1">حالة الطلب</label>
                <select
                  value={redemptionStatus}
                  onChange={(e) => setRedemptionStatus(e.target.value)}
                  className="w-full p-3 rounded-xl border border-border bg-card font-bold text-xs outline-none focus:border-amber-500"
                >
                  <option value="completed">✅ مكتمل ومسلم</option>
                  <option value="processing">⏳ قيد المعالجة والتجهيز</option>
                  <option value="delivered">🚚 تم التسليم للشحن</option>
                  <option value="cancelled">❌ ملغي</option>
                </select>
              </div>

              <div>
                <label className="block mb-1">كود التسليم / القسيمة الرقمية</label>
                <input
                  type="text"
                  placeholder="مثال: BNN-5K-XXXXXX أو كود الكارت"
                  value={redemptionCode}
                  onChange={(e) => setRedemptionCode(e.target.value)}
                  className="w-full p-3 rounded-xl border border-border bg-card font-mono text-xs outline-none focus:border-amber-500"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block mb-1">ملاحظات الإدارة الداخلية</label>
                <textarea
                  rows={2}
                  placeholder="ملاحظات تتبع، رقم بوليصة الشحن، إلخ..."
                  value={redemptionNotes}
                  onChange={(e) => setRedemptionNotes(e.target.value)}
                  className="w-full p-3 rounded-xl border border-border bg-card font-medium text-xs outline-none focus:border-amber-500 resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <button
                onClick={() => setSelectedRedemption(null)}
                className="px-4 py-2.5 rounded-xl border border-border text-xs font-bold hover:bg-muted"
              >
                إغلاق
              </button>
              <button
                onClick={() =>
                  updateRedemptionMutation.mutate({
                    id: selectedRedemption.id,
                    status: redemptionStatus,
                    adminNotes: redemptionNotes,
                    deliveryCode: redemptionCode,
                  })
                }
                disabled={updateRedemptionMutation.isPending}
                className="px-6 py-2.5 rounded-xl bg-black hover:bg-zinc-800 text-white dark:bg-white dark:text-black font-black text-xs transition-colors flex items-center gap-2"
              >
                {updateRedemptionMutation.isPending ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                حفظ التحديثات
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADJUST USER BANANA BALANCE */}
      {adjustModalOpen && adjustUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-black text-base">تعديل رصيد الموز</h3>
              <button
                onClick={() => setAdjustModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-bold">
              <div className="p-3 rounded-xl bg-muted/40 border border-border">
                <div className="text-muted-foreground">المستخدم:</div>
                <div className="text-sm font-black text-foreground">
                  {adjustUser.name || "مستخدم"}
                </div>
                <div className="mt-1 text-xs text-amber-500 font-black">
                  الرصيد الحالي: 🍌 {Number(adjustUser.balance).toLocaleString("en-US")}
                </div>
              </div>

              <div>
                <label className="block mb-1">المبلغ المراد إضافته أو خصمه (🍌):</label>
                <input
                  type="number"
                  placeholder="مثال: 500 للإضافة، أو -500 للخصم"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  className="w-full p-3 rounded-xl border border-border bg-card font-black text-sm outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block mb-1">السبب / ملاحظة العملية:</label>
                <input
                  type="text"
                  placeholder="مثال: مكافأة مسابقة، تعويض، إلخ..."
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-border bg-card font-medium text-xs outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                onClick={() => setAdjustModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-bold hover:bg-muted"
              >
                إلغاء
              </button>
              <button
                onClick={() =>
                  adjustBalanceMutation.mutate({
                    userId: adjustUser.userId,
                    amount: Number(adjustAmount),
                    reason: adjustReason || "Admin adjustment",
                  })
                }
                disabled={!adjustAmount || adjustBalanceMutation.isPending}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-black text-xs transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {adjustBalanceMutation.isPending ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Check className="w-3 h-3" />
                )}
                تأكيد التعديل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: GRANT WHEEL TICKETS */}
      {ticketModalOpen && ticketUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-3xl p-6 md:p-8 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-black text-base">منح تذاكر عجلة الحظ</h3>
              <button
                onClick={() => setTicketModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-bold">
              <div className="p-3 rounded-xl bg-muted/40 border border-border">
                <div className="text-muted-foreground">المستخدم:</div>
                <div className="text-sm font-black text-foreground">
                  {ticketUser.name || "مستخدم"}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground font-mono">
                  {ticketUser.userId}
                </div>
              </div>

              <div>
                <label className="block mb-1">عدد التذاكر (من 1 إلى 100):</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  step="1"
                  value={ticketCount}
                  onChange={(e) => setTicketCount(e.target.value)}
                  className="w-full p-3 rounded-xl border border-border bg-card font-black text-sm outline-none focus:border-violet-500"
                />
              </div>

              <div>
                <label className="block mb-1">السبب / ملاحظة العملية:</label>
                <input
                  type="text"
                  placeholder="مثال: مكافأة مسابقة، تعويض، إلخ..."
                  value={ticketReason}
                  onChange={(e) => setTicketReason(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-border bg-card font-medium text-xs outline-none focus:border-violet-500"
                />
              </div>

              <p className="text-[10px] text-muted-foreground font-normal leading-relaxed">
                التذاكر تُمنح مرة واحدة لكل ضغطة. إذا ضغطت مرتين بالخطأ، الضغطة الثانية لن تضيف
                شيئاً وسيظهر لك ذلك.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                onClick={() => setTicketModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-bold hover:bg-muted"
              >
                إلغاء
              </button>
              <button
                onClick={() =>
                  grantTicketsMutation.mutate({
                    userId: ticketUser.userId,
                    quantity: Math.floor(Number(ticketCount) || 0),
                    reason: ticketReason || "منح إداري",
                    /*
                      This opening of the dialog. Two clicks on the button
                      below share it and grant once; closing and opening the
                      dialog again is a new intention and grants again.
                    */
                    referenceId: `admin:${ticketUser.userId}:${ticketPress}`,
                  })
                }
                disabled={
                  !(Number(ticketCount) >= 1 && Number(ticketCount) <= 100) ||
                  grantTicketsMutation.isPending
                }
                className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-black text-xs transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {grantTicketsMutation.isPending ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Ticket className="w-3 h-3" />
                )}
                منح التذاكر
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
