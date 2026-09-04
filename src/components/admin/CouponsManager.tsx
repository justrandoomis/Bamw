import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Edit,
  Tag,
  Gamepad2,
  Sparkles,
  Copy,
  Check,
  Calendar,
  Layers,
  ShieldAlert,
  Flame,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  XCircle,
  Ticket,
} from "lucide-react";
import { adminApi, api } from "@/lib/api";
import { getCouponRemainingTime } from "@/lib/coupons";
import type { Coupon, DiscountType, Product } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";


/**
 * An instant, as the wall-clock string `datetime-local` speaks.
 *
 * The input's value is *local* time with no zone, and both dates were being
 * written into it with `toISOString().slice(0, 16)` — which is UTC. An admin in
 * Baghdad who set a coupon to expire at 23:00 saw 20:00 when they reopened it,
 * and saving again wrote 20:00 as the new local time: every edit moved the
 * expiry three hours earlier. Writing back out is already correct — `new
 * Date("...T23:00")` reads a bare string as local — so only this direction was
 * wrong.
 */
function toDateTimeLocal(value?: string): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export default function CouponsManager() {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "active" | "single_item" | "expired">("all");

  const [form, setForm] = useState<Partial<Coupon>>({
    code: "",
    discountType: "percentage",
    discountValue: 10,
    perUserLimit: 1,
    minOrderAmount: 0,
    isActive: true,
    onlyDigitalProducts: false,
    isStackable: false,
    oncePerUserLifetime: false,
    offlineAccountOnly: false,
    eligibleProducts: [],
    eligibleUsers: [],
    startAt: "",
    expirationAt: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: () => adminApi.getCoupons(),
  });

  const { data: storeData } = useQuery({
    queryKey: ["store-products-list"],
    queryFn: () => api.store(),
  });

  /*
    The members list, for the "who may use this" picker.

    `eligible_users` holds account ids, which nobody knows by heart — the field
    existed in the row, in the mapper and in the rule that enforces it, and the
    only way to fill it was to call the API by hand. Searching a name, an email
    or a phone and storing the id is what makes the restriction usable.
  */
  const { data: usersData } = useQuery({
    queryKey: ["admin-users-for-coupons"],
    queryFn: () => adminApi.getUsers(),
  });
  const membersList = useMemo(
    () => (usersData?.users || []) as Array<Record<string, any>>,
    [usersData?.users],
  );
  const [productSearch, setProductSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");

  const productsList = useMemo(() => {
    return (storeData?.products || []) as Product[];
  }, [storeData]);

  const createMutation = useMutation({
    mutationFn: (payload: Partial<Coupon>) => adminApi.createCoupon(payload),
    onSuccess: async () => {
      toast.success("تم إنشاء الكوبون بنجاح وحفظه في السيرفر");
      await queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
      await queryClient.refetchQueries({ queryKey: ["admin-coupons"] });
      setIsAdding(false);
      resetForm();
    },
    onError: (err: any) => {
      const msg = err?.message || err?.error || "حدث خطأ أثناء حفظ الكوبون";
      toast.error(msg, { duration: 6000 });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<Coupon>) => adminApi.updateCoupon(payload),
    onSuccess: async () => {
      toast.success("تم تحديث الكوبون بنجاح في السيرفر");
      await queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
      await queryClient.refetchQueries({ queryKey: ["admin-coupons"] });
      setEditingId(null);
      setIsAdding(false);
      resetForm();
    },
    onError: (err: any) => {
      const msg = err?.message || err?.error || "حدث خطأ أثناء تحديث الكوبون";
      toast.error(msg, { duration: 6000 });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteCoupon(id),
    onSuccess: async () => {
      toast.success("تم حذف الكوبون نهائياً من السيرفر");
      await queryClient.invalidateQueries({ queryKey: ["admin-coupons"] });
      await queryClient.refetchQueries({ queryKey: ["admin-coupons"] });
    },
    onError: (err: any) => {
      const msg = err?.message || err?.error || "حدث خطأ أثناء الحذف";
      toast.error(msg, { duration: 6000 });
    },
  });

  const resetForm = () => {
    setEditingId(null);
    setForm({
      code: "",
      discountType: "percentage",
      discountValue: 10,
      perUserLimit: 1,
      minOrderAmount: 0,
      isActive: true,
      onlyDigitalProducts: false,
      isStackable: false,
      oncePerUserLifetime: false,
      offlineAccountOnly: false,
      eligibleProducts: [],
      eligibleUsers: [],
      startAt: "",
      expirationAt: "",
    });
  };

  const applyPreset = (preset: "single_50" | "offline_once" | "percent_10" | "fixed_5k") => {
    if (preset === "single_50") {
      setForm({
        ...form,
        code: `GAME50-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        discountType: "single_item_percent",
        discountValue: 50,
        perUserLimit: 1,
        oncePerUserLifetime: true,
        onlyDigitalProducts: true,
        isStackable: false,
        isActive: true,
      });
    } else if (preset === "offline_once") {
      setForm({
        ...form,
        code: `OFFLINE50-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        discountType: "single_item_percent",
        discountValue: 50,
        perUserLimit: 1,
        oncePerUserLifetime: true,
        onlyDigitalProducts: true,
        offlineAccountOnly: true,
        isStackable: false,
        isActive: true,
      });
    } else if (preset === "percent_10") {
      setForm({
        ...form,
        code: `DISCOUNT10`,
        discountType: "percentage",
        discountValue: 10,
        perUserLimit: 1,
        oncePerUserLifetime: false,
        isActive: true,
      });
    } else if (preset === "fixed_5k") {
      setForm({
        ...form,
        code: `SAVE5000`,
        discountType: "fixed",
        discountValue: 5000,
        minOrderAmount: 25000,
        perUserLimit: 1,
        oncePerUserLifetime: false,
        isActive: true,
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = (form.code || "").trim().toUpperCase();
    if (!cleanCode) {
      toast.error("يرجى إدخال كود الكوبون");
      return;
    }

    const payload = {
      ...form,
      code: cleanCode,
      discountValue: Number(form.discountValue || 0),
      perUserLimit: Number(form.perUserLimit || 1),
      minOrderAmount: Number(form.minOrderAmount || 0),
      maxDiscountAmount: form.maxDiscountAmount ? Number(form.maxDiscountAmount) : undefined,
      usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
      startAt: form.startAt || undefined,
      expirationAt: form.expirationAt || undefined,
    };

    if (editingId) {
      updateMutation.mutate({ ...payload, id: editingId });
    } else {
      createMutation.mutate(payload as any);
    }
  };

  const openEdit = (coupon: any) => {
    const dType = coupon.discount_type || coupon.discountType;
    setForm({
      id: coupon.id,
      code: coupon.code,
      discountType: dType,
      discountValue:
        coupon.discount_value !== undefined ? coupon.discount_value : coupon.discountValue,
      perUserLimit:
        coupon.per_user_limit !== undefined ? coupon.per_user_limit : coupon.perUserLimit,
      minOrderAmount:
        coupon.min_order_amount !== undefined ? coupon.min_order_amount : coupon.minOrderAmount,
      maxDiscountAmount: coupon.max_discount_amount || coupon.maxDiscountAmount,
      usageLimit: coupon.usage_limit || coupon.usageLimit,
      isActive: coupon.is_active !== undefined ? Boolean(coupon.is_active) : coupon.isActive,
      onlyDigitalProducts:
        coupon.only_digital_products !== undefined
          ? Boolean(coupon.only_digital_products)
          : coupon.onlyDigitalProducts,
      isStackable:
        coupon.is_stackable !== undefined ? Boolean(coupon.is_stackable) : coupon.isStackable,
      oncePerUserLifetime:
        coupon.once_per_user_lifetime !== undefined
          ? Boolean(coupon.once_per_user_lifetime)
          : coupon.oncePerUserLifetime,
      offlineAccountOnly:
        coupon.offline_account_only !== undefined
          ? Boolean(coupon.offline_account_only)
          : Boolean(coupon.offlineAccountOnly),
      startAt: coupon.start_at || coupon.startAt || "",
      expirationAt: coupon.expiration_at || coupon.expirationAt || "",
      eligibleProducts:
        typeof coupon.eligible_products === "string"
          ? (() => {
              try {
                return JSON.parse(coupon.eligible_products);
              } catch {
                return [];
              }
            })()
          : coupon.eligibleProducts || [],
      eligibleUsers:
        typeof coupon.eligible_users === "string"
          ? (() => {
              try {
                return JSON.parse(coupon.eligible_users);
              } catch {
                return [];
              }
            })()
          : coupon.eligibleUsers || [],
    });
    setEditingId(coupon.id);
    setIsAdding(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    toast.success(`تم نسخ الكود: ${text}`);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const rawCoupons = data?.coupons || [];

  const filteredCoupons = useMemo(() => {
    return rawCoupons.filter((c: any) => {
      const code = String(c.code || "").toUpperCase();
      const matchesSearch = !searchQuery || code.includes(searchQuery.toUpperCase());
      if (!matchesSearch) return false;

      const isActive = c.is_active !== undefined ? Boolean(c.is_active) : Boolean(c.isActive);
      const isSingle = (c.discount_type || c.discountType) === "single_item_percent";
      const isExpired = c.expiration_at && new Date(c.expiration_at).getTime() < Date.now();

      if (filterType === "active") return isActive && !isExpired;
      if (filterType === "single_item") return isSingle;
      if (filterType === "expired") return isExpired;
      return true;
    });
  }, [rawCoupons, searchQuery, filterType]);

  if (isLoading)
    return <div className="p-8 text-center text-muted-foreground">جاري تحميل الكوبونات...</div>;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-blue-900/20 via-card to-card border border-border p-6 rounded-3xl shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2.5 bg-brand-blue/10 text-brand-blue rounded-2xl">
              <Tag className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-black text-foreground tracking-tight">
              نظام إدارة الكوبونات والعروض
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            إنشاء وتعديل أكواد الخصم، وتحديد حدود الاستخدام، وتفعيل خصم 50% على لعبة واحدة لكل حساب.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              resetForm();
              setIsAdding(true);
            }}
            className="flex items-center gap-2 bg-brand-blue hover:bg-blue-600 text-white px-5 py-2.5 rounded-2xl text-sm font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            إضافة كوبون جديد
          </button>
        </div>
      </div>

      {/* Quick Creator Presets */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div
          onClick={() => {
            applyPreset("single_50");
            setIsAdding(true);
          }}
          className="group cursor-pointer p-4 bg-gradient-to-br from-amber-500/10 via-card to-card border border-amber-500/20 hover:border-amber-500/40 rounded-2xl transition-all shadow-sm flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 text-amber-500 rounded-xl">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-foreground flex items-center gap-1.5">
                خصم 50% على لعبة واحدة
                <span className="text-[10px] bg-amber-500/20 text-amber-500 px-1.5 py-0.5 rounded font-black">
                  جديد
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                مرة واحدة فقط لكل حساب طوال العمر
              </div>
            </div>
          </div>
          <Plus className="w-4 h-4 text-amber-500 group-hover:scale-110 transition-transform" />
        </div>

        <div
          onClick={() => {
            applyPreset("offline_once");
            setIsAdding(true);
          }}
          className="group cursor-pointer p-4 bg-gradient-to-br from-violet-500/10 via-card to-card border border-violet-500/20 hover:border-violet-500/40 rounded-2xl transition-all shadow-sm flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-500/20 text-violet-500 rounded-xl">
              <Ticket className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">خصم لعبة أوفلاين</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                50% على لعبة واحدة بحساب أوفلاين — مرة لكل حساب
              </div>
            </div>
          </div>
          <Plus className="w-4 h-4 text-violet-500 group-hover:scale-110 transition-transform" />
        </div>

        <div
          onClick={() => {
            applyPreset("percent_10");
            setIsAdding(true);
          }}
          className="group cursor-pointer p-4 bg-card border border-border hover:border-brand-blue/40 rounded-2xl transition-all shadow-sm flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 text-blue-500 rounded-xl">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-foreground">خصم نسبة مئوية (10%)</div>
              <div className="text-xs text-muted-foreground mt-0.5">يطبق على إجمالي السلة</div>
            </div>
          </div>
          <Plus className="w-4 h-4 text-blue-500 group-hover:scale-110 transition-transform" />
        </div>

        <div
          onClick={() => {
            applyPreset("fixed_5k");
            setIsAdding(true);
          }}
          className="group cursor-pointer p-4 bg-card border border-border hover:border-emerald-500/40 rounded-2xl transition-all shadow-sm flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-foreground">خصم مبلغ ثابت (5,000 د.ع)</div>
              <div className="text-xs text-muted-foreground mt-0.5">مع حد أدنى للطلب</div>
            </div>
          </div>
          <Plus className="w-4 h-4 text-emerald-500 group-hover:scale-110 transition-transform" />
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-card border border-border p-3 rounded-2xl">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="بحث بالكود..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-background border border-border rounded-xl pr-9 pl-3 py-2 text-xs focus:outline-none focus:border-brand-blue"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
          <button
            onClick={() => setFilterType("all")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              filterType === "all"
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            الكل ({rawCoupons.length})
          </button>
          <button
            onClick={() => setFilterType("single_item")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 ${
              filterType === "single_item"
                ? "bg-amber-500 text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            <Flame className="w-3 h-3" />
            عروض لعبة 50%
          </button>
          <button
            onClick={() => setFilterType("active")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              filterType === "active"
                ? "bg-green-600 text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            الفعالة فقط
          </button>
          <button
            onClick={() => setFilterType("expired")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              filterType === "expired"
                ? "bg-red-600 text-white"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            المنتهية
          </button>
        </div>
      </div>

      {/* Coupons Table */}
      <div className="bg-card border border-border rounded-3xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b border-border text-xs text-muted-foreground font-bold">
              <tr>
                <th className="px-5 py-4">كود الكوبون</th>
                <th className="px-5 py-4">النوع ومقدار الخصم</th>
                <th className="px-5 py-4">حدود الاستخدام</th>
                <th className="px-5 py-4">فترة الصلاحية</th>
                <th className="px-5 py-4">القيود والشروط</th>
                <th className="px-5 py-4">الحالة</th>
                <th className="px-5 py-4 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredCoupons.map((coupon: any) => {
                const isSingle =
                  (coupon.discount_type || coupon.discountType) === "single_item_percent";
                const isPercent = (coupon.discount_type || coupon.discountType) === "percentage";
                const val =
                  coupon.discount_value !== undefined
                    ? coupon.discount_value
                    : coupon.discountValue;
                const isActive =
                  coupon.is_active !== undefined
                    ? Boolean(Number(coupon.is_active))
                    : Boolean(coupon.isActive);
                const expDate = coupon.expiration_at || coupon.expirationAt || coupon.expires_at;
                const remInfo = getCouponRemainingTime(expDate);
                const isExpired = remInfo.isExpired;
                const isStarted =
                  !coupon.start_at || new Date(coupon.start_at).getTime() <= Date.now();

                return (
                  <tr key={coupon.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-4 font-mono font-black">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground tracking-wider uppercase bg-muted/70 px-2.5 py-1 rounded-lg border border-border/80">
                          {coupon.code}
                        </span>
                        <button
                          onClick={() => copyToClipboard(coupon.code)}
                          className="text-muted-foreground hover:text-foreground p-1 transition-colors"
                          title="نسخ الكود"
                        >
                          {copiedCode === coupon.code ? (
                            <Check className="w-3.5 h-3.5 text-green-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      {isSingle ? (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 font-black text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-md text-xs">
                            <Flame className="w-3 h-3" />
                            خصم {val}% على لعبة واحدة
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            تطبيق على نسخة 1 فقط
                          </span>
                        </div>
                      ) : isPercent ? (
                        <div className="font-bold text-foreground">
                          %{val}{" "}
                          <span className="text-xs text-muted-foreground font-normal">
                            من إجمالي السلة
                          </span>
                        </div>
                      ) : (
                        <div className="font-bold text-emerald-500 font-mono">
                          {Number(val || 0).toLocaleString("en-US")} د.ع
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-4 text-xs">
                      <div className="space-y-1">
                        <div>
                          <span className="text-muted-foreground">لكل مستخدم: </span>
                          <span className="font-bold text-foreground">
                            {coupon.once_per_user_lifetime || coupon.oncePerUserLifetime
                              ? "مرة واحدة مدى الحياة"
                              : `${coupon.per_user_limit || coupon.perUserLimit || 1} مرات`}
                          </span>
                        </div>
                        {(coupon.usage_limit || coupon.usageLimit) && (
                          <div>
                            <span className="text-muted-foreground">الحد الكلي: </span>
                            <span className="font-bold text-foreground">
                              {coupon.usage_limit || coupon.usageLimit}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>

                    <td className="px-5 py-4 text-xs">
                      {expDate || coupon.start_at ? (
                        <div className="space-y-1 text-muted-foreground">
                          {coupon.start_at && (
                            <div>من: {new Date(coupon.start_at).toLocaleDateString("ar-IQ")}</div>
                          )}
                          {expDate && (
                            <div className={isExpired ? "text-red-500 font-bold" : ""}>
                              إلى: {new Date(expDate).toLocaleDateString("ar-IQ")}
                            </div>
                          )}
                          <div
                            className={`font-semibold flex items-center gap-1 ${isExpired ? "text-red-500" : "text-amber-500"}`}
                          >
                            <Clock className="w-3 h-3" />
                            {remInfo.remainingText}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">دائم (بدون انتهاء)</span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-xs space-y-1">
                      {(coupon.only_digital_products || coupon.onlyDigitalProducts) && (
                        <span className="inline-block bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded text-[11px] font-bold ml-1">
                          ألعاب رقمية فقط
                        </span>
                      )}
                      {(coupon.min_order_amount || coupon.minOrderAmount) > 0 && (
                        <span className="block text-muted-foreground text-[11px]">
                          حد أدنى:{" "}
                          {Number(
                            coupon.min_order_amount || coupon.minOrderAmount,
                          ).toLocaleString()}{" "}
                          د.ع
                        </span>
                      )}
                      {(coupon.max_discount_amount || coupon.maxDiscountAmount) > 0 && (
                        <span className="block text-muted-foreground text-[11px]">
                          أقصى خصم:{" "}
                          {Number(
                            coupon.max_discount_amount || coupon.maxDiscountAmount,
                          ).toLocaleString()}{" "}
                          د.ع
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      {isExpired ? (
                        <span className="text-red-500 bg-red-500/10 px-2 py-1 rounded-lg text-xs font-bold inline-block">
                          منتهي الصلاحية
                        </span>
                      ) : !isStarted ? (
                        <span className="text-amber-500 bg-amber-500/10 px-2 py-1 rounded-lg text-xs font-bold inline-block">
                          لم يبدأ بعد
                        </span>
                      ) : isActive ? (
                        <span className="text-green-500 bg-green-500/10 px-2 py-1 rounded-lg text-xs font-bold inline-block">
                          فعال ومتاح
                        </span>
                      ) : (
                        <span className="text-muted-foreground bg-muted px-2 py-1 rounded-lg text-xs font-bold inline-block">
                          معطل
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => openEdit(coupon)}
                          className="p-2 text-blue-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-xl transition-colors"
                          title="تعديل الكوبون"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`هل أنت متأكد من رغبتك في حذف الكوبون "${coupon.code}"؟`)) {
                              deleteMutation.mutate(coupon.id);
                            }
                          }}
                          className="p-2 text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
                          title="حذف الكوبون"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredCoupons.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    لا يوجد كوبونات مطابقة للبحث أو الفلتر.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Dialog */}
      <Dialog
        open={isAdding}
        onOpenChange={(open) => {
          setIsAdding(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <Tag className="w-5 h-5 text-brand-blue" />
              {editingId ? "تعديل الكوبون" : "إضافة كوبون جديد"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            {/* Quick Template Switcher */}
            {!editingId && (
              <div className="bg-muted/40 p-3 rounded-2xl border border-border space-y-2">
                <div className="text-xs font-bold text-muted-foreground">نماذج جاهزة سريعة:</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => applyPreset("single_50")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 ${
                      form.discountType === "single_item_percent"
                        ? "bg-amber-500 text-white"
                        : "bg-background border border-border text-foreground hover:bg-muted"
                    }`}
                  >
                    <Flame className="w-3.5 h-3.5" />
                    خصم 50% على لعبة واحدة (1x لكل حساب)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("percent_10")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                      form.discountType === "percentage"
                        ? "bg-brand-blue text-white"
                        : "bg-background border border-border text-foreground hover:bg-muted"
                    }`}
                  >
                    نسبة 10% عامة
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("fixed_5k")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                      form.discountType === "fixed"
                        ? "bg-emerald-600 text-white"
                        : "bg-background border border-border text-foreground hover:bg-muted"
                    }`}
                  >
                    مبلغ ثابت 5,000 د.ع
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Code */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">كود الخصم (Code)</label>
                <div className="relative">
                  <input
                    required
                    type="text"
                    placeholder="مثال: GAME50"
                    className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm uppercase font-mono font-bold tracking-wider"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const prefix =
                        form.discountType === "single_item_percent" ? "GAME50" : "BANANA";
                      setForm({
                        ...form,
                        code: `${prefix}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
                      });
                    }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-brand-blue hover:underline font-bold"
                  >
                    توليد عشوائي
                  </button>
                </div>
              </div>

              {/* Discount Type */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">نوع الخصم</label>
                <select
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm font-bold"
                  value={form.discountType}
                  onChange={(e) => {
                    const newType = e.target.value as DiscountType;
                    setForm({
                      ...form,
                      discountType: newType,
                      discountValue:
                        newType === "single_item_percent" ? 50 : form.discountValue || 10,
                      oncePerUserLifetime:
                        newType === "single_item_percent" ? true : form.oncePerUserLifetime,
                      onlyDigitalProducts:
                        newType === "single_item_percent" ? true : form.onlyDigitalProducts,
                    });
                  }}
                >
                  <option value="single_item_percent">
                    خصم 50% على لعبة واحدة (1x لكل مستخدم)
                  </option>
                  <option value="percentage">نسبة مئوية على إجمالي الطلب (%)</option>
                  <option value="fixed">مبلغ ثابت مخصوم من الإجمالي (د.ع)</option>
                </select>
              </div>

              {/* Discount Value */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">
                  {form.discountType === "fixed" ? "قيمة الخصم (د.ع)" : "نسبة الخصم (%)"}
                </label>
                <input
                  required
                  type="number"
                  min="1"
                  max={
                    form.discountType === "percentage" ||
                    form.discountType === "single_item_percent"
                      ? 100
                      : undefined
                  }
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm font-mono"
                  value={form.discountValue}
                  onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })}
                />
              </div>

              {/* Max Discount (Cap) */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">
                  سقف أقصى مبلغ للخصم (د.ع - اختياري)
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="بدون سقف"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm font-mono"
                  value={form.maxDiscountAmount || ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      maxDiscountAmount: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                />
              </div>

              {/* Start Date */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">
                  تاريخ بدء الفعالية (اختياري)
                </label>
                <input
                  type="datetime-local"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs"
                  value={toDateTimeLocal(form.startAt)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      startAt: e.target.value ? new Date(e.target.value).toISOString() : "",
                    })
                  }
                />
              </div>

              {/* Expiration Date */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">
                  تاريخ انتهاء الصلاحية (اختياري)
                </label>
                <input
                  type="datetime-local"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs"
                  value={toDateTimeLocal(form.expirationAt)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      expirationAt: e.target.value ? new Date(e.target.value).toISOString() : "",
                    })
                  }
                />
              </div>

              {/* Min Order */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">الحد الأدنى للطلب (د.ع)</label>
                <input
                  type="number"
                  min="0"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm font-mono"
                  value={form.minOrderAmount}
                  onChange={(e) => setForm({ ...form, minOrderAmount: Number(e.target.value) })}
                />
              </div>

              {/* Per User Limit */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">الحد الأقصى لكل مستخدم</label>
                <input
                  required
                  type="number"
                  min="1"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm font-mono"
                  value={form.perUserLimit}
                  onChange={(e) => setForm({ ...form, perUserLimit: Number(e.target.value) })}
                />
              </div>

              {/* Global Usage Limit */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">
                  الحد الإجمالي للاستخدام (اختياري)
                </label>
                <input
                  type="number"
                  min="1"
                  placeholder="استخدام غير محدود"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm font-mono"
                  value={form.usageLimit || ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      usageLimit: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                />
              </div>
            </div>

            {/* Checkboxes / Toggles */}
            <div className="bg-muted/30 p-4 rounded-2xl border border-border space-y-3 pt-3">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded text-brand-blue"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <div>
                  <span className="text-sm font-bold text-foreground">تفعيل الكوبون الآن</span>
                  <p className="text-xs text-muted-foreground">
                    عند التعطيل لن يتمكن أي مستخدم من تطبيق هذا الكوبون.
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded text-amber-500"
                  checked={form.oncePerUserLifetime}
                  onChange={(e) => setForm({ ...form, oncePerUserLifetime: e.target.checked })}
                />
                <div>
                  <span className="text-sm font-bold text-foreground">
                    مرة واحدة فقط لكل حساب طوال العمر
                  </span>
                  <p className="text-xs text-muted-foreground">
                    التحقق يتم من الـ Backend عبر سجلات قاعدة البيانات وليس LocalStorage لمنع
                    التكرار.
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded text-brand-blue"
                  checked={form.onlyDigitalProducts}
                  onChange={(e) => setForm({ ...form, onlyDigitalProducts: e.target.checked })}
                />
                <div>
                  <span className="text-sm font-bold text-foreground">
                    صالح للألعاب والمنتجات الرقمية فقط
                  </span>
                  <p className="text-xs text-muted-foreground">
                    يرفض السلة إذا كانت تحتوي على أجهزة أو إكسسوارات ملموسة.
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-border"
                  checked={form.offlineAccountOnly}
                  onChange={(e) => setForm({ ...form, offlineAccountOnly: e.target.checked })}
                />
                <div>
                  <span className="text-sm font-bold text-foreground">
                    خاص بحساب أوفلاين فقط (نسخة واحدة)
                  </span>
                  <p className="text-xs text-muted-foreground">
                    يُطبَّق الخصم على لعبة واحدة مشتراة بخيار «حساب أوفلاين» وبكمية 1 فقط. الألعاب
                    بخيار أونلاين والأجهزة والبندلات لا تحصل على الخصم.
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded text-brand-blue"
                  checked={form.isStackable}
                  onChange={(e) => setForm({ ...form, isStackable: e.target.checked })}
                />
                <div>
                  <span className="text-sm font-bold text-foreground">
                    السماح بالدمج مع عروض أخرى
                  </span>
                  <p className="text-xs text-muted-foreground">
                    يسمح بجمع خصم الكوبون مع خصم دعوة صديق في نفس الطلب. إذا كان غير مفعل، يُطبَّق
                    الأكبر منهما فقط ولا يُستهلك الآخر.
                  </p>
                </div>
              </label>

              {/*
                Which products the coupon covers.

                The field was in the form's state, in the row and in the rule —
                and had no control anywhere in this dialog, so the only way to
                scope a coupon to a product was to call the API by hand. It
                also used to be a pass/fail gate: one eligible line let the
                coupon through and the percentage was then taken off the whole
                basket. It is now taken off the covered lines only, which is
                what makes this picker safe to hand an admin.
              */}
              <div className="space-y-2 pt-2 border-t border-border">
                <label className="text-xs font-bold text-foreground">
                  المنتجات المشمولة (اختياري — اتركه فارغاً ليشمل كل السلة)
                </label>
                <input
                  type="text"
                  placeholder="ابحث عن منتج…"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
                {(form.eligibleProducts?.length ?? 0) > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    الخصم يُحتسب على قيمة هذه المنتجات وحدها، لا على مجموع السلة.
                  </p>
                )}
                <div className="max-h-40 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                  {productsList
                    .filter((product) => {
                      const needle = productSearch.trim().toLowerCase();
                      if (!needle) return (form.eligibleProducts ?? []).some(
                        (id) => String(id) === String(product.id),
                      );
                      return `${product.title ?? ""} ${(product as any).titleEn ?? ""} ${product.id}`
                        .toLowerCase()
                        .includes(needle);
                    })
                    .slice(0, 40)
                    .map((product) => {
                      const chosen = (form.eligibleProducts ?? []).some(
                        (id) => String(id) === String(product.id),
                      );
                      return (
                        <label
                          key={String(product.id)}
                          className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-border"
                            checked={chosen}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                eligibleProducts: e.target.checked
                                  ? [...(form.eligibleProducts ?? []), String(product.id)]
                                  : (form.eligibleProducts ?? []).filter(
                                      (id) => String(id) !== String(product.id),
                                    ),
                              })
                            }
                          />
                          <span className="text-xs text-foreground truncate">
                            {product.title || (product as any).titleEn || String(product.id)}
                          </span>
                        </label>
                      );
                    })}
                  {productSearch.trim() === "" && (form.eligibleProducts?.length ?? 0) === 0 && (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground">
                      اكتب للبحث. بدون اختيار، الكوبون يشمل كل السلة.
                    </p>
                  )}
                </div>
              </div>

              {/*
                Which accounts may use it. `checkCoupon` has always refused a
                member outside this list; nothing could put anyone into it.
              */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-foreground">
                  الحسابات المسموح لها (اختياري — اتركه فارغاً ليكون متاحاً للجميع)
                </label>
                <input
                  type="text"
                  placeholder="ابحث بالاسم أو البريد أو رقم الهاتف…"
                  className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
                <div className="max-h-40 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                  {membersList
                    .filter((member) => {
                      const needle = memberSearch.trim().toLowerCase();
                      if (!needle)
                        return (form.eligibleUsers ?? []).some(
                          (id) => String(id) === String(member.id),
                        );
                      return `${member.name ?? ""} ${member.email ?? ""} ${member.phone ?? ""} ${member.id}`
                        .toLowerCase()
                        .includes(needle);
                    })
                    .slice(0, 40)
                    .map((member) => {
                      const chosen = (form.eligibleUsers ?? []).some(
                        (id) => String(id) === String(member.id),
                      );
                      return (
                        <label
                          key={String(member.id)}
                          className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-border"
                            checked={chosen}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                eligibleUsers: e.target.checked
                                  ? [...(form.eligibleUsers ?? []), String(member.id)]
                                  : (form.eligibleUsers ?? []).filter(
                                      (id) => String(id) !== String(member.id),
                                    ),
                              })
                            }
                          />
                          <span className="text-xs text-foreground truncate">
                            {member.name || member.email || member.phone || String(member.id)}
                          </span>
                        </label>
                      );
                    })}
                  {memberSearch.trim() === "" && (form.eligibleUsers?.length ?? 0) === 0 && (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground">
                      اكتب للبحث. بدون اختيار، الكوبون متاح لكل الأعضاء.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter className="pt-4 flex items-center justify-between sm:justify-between gap-3">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-4 py-2 rounded-xl text-sm font-bold bg-muted hover:bg-muted/80 text-foreground transition-colors"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="bg-brand-blue hover:bg-blue-600 text-white px-6 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50 shadow-lg shadow-blue-500/20"
              >
                {editingId ? "حفظ التعديلات" : "إنشاء الكوبون"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
