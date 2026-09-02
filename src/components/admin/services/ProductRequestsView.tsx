import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package,
  Search,
  ExternalLink,
  MessageCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Link as LinkIcon,
  Save,
  Edit3,
  Loader2,
  Sliders,
  ListFilter,
} from "lucide-react";
import { useI18n } from "@/i18n";
import type { ProductRequest } from "@/lib/types";
import { AddGamePageEditor } from "./editors/AddGamePageEditor";

export default function ProductRequestsView() {
  const t = useI18n((s) => s.t);
  const lang = useI18n((s) => s.lang);
  const dir = lang === "ar" ? "rtl" : "ltr";
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<"requests" | "settings">("requests");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin_product_requests"],
    queryFn: async () => {
      const res = await fetch("/api/game-requests");
      const json = await res.json();
      return json.requests as ProductRequest[];
    },
  });

  const updateRequest = useMutation({
    mutationFn: async (vars: {
      id: string;
      status?: string;
      adminNote?: string;
      linkedProductId?: string;
      userVisibleNote?: string;
    }) => {
      const res = await fetch("/api/game-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_product_requests"] });
      setEditingId(null);
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "submitted":
        return "bg-blue-100 text-blue-700";
      case "under_review":
        return "bg-amber-100 text-amber-700";
      case "accepted":
        return "bg-emerald-100 text-emerald-700";
      case "sourcing":
        return "bg-purple-100 text-purple-700";
      case "available":
        return "bg-indigo-100 text-indigo-700";
      case "added":
        return "bg-emerald-100 text-emerald-700";
      case "rejected":
        return "bg-rose-100 text-rose-700";
      case "cancelled":
        return "bg-zinc-100 text-zinc-700";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getStatusLabel = (status: string) => {
    const m: Record<string, string> = {
      submitted: t("تم الإرسال"),
      under_review: t("قيد المراجعة"),
      accepted: t("مقبول"),
      sourcing: t("جارٍ البحث"),
      available: t("متوفر"),
      added: t("تمت الإضافة للمتجر"),
      rejected: t("مرفوض"),
      cancelled: t("ملغي"),
    };
    return m[status] || status;
  };

  const requests = data || [];
  const filtered = requests.filter((r) => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return (
        // Optional-chained like the clauses below it: a request that somehow
        // reaches the list without a name must not throw during render. The
        // only boundary above this screen is the root route's, so an uncaught
        // TypeError here replaced the whole admin panel with the error page.
        r.productName?.toLowerCase().includes(s) ||
        r.contactMethod?.toLowerCase().includes(s) ||
        r.gameId?.toLowerCase().includes(s) ||
        r.id.toLowerCase().includes(s)
      );
    }
    return true;
  });

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Package className="w-6 h-6 text-primary" /> {t("خدمة طلب إضافة منتج / لعبة")}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {t("إدارة طلبات العملاء وتعديل إعدادات وتخصيص واجهة صفحة إضافة لعبة.")}
          </p>
        </div>

        <div className="flex items-center gap-2 bg-muted p-1 rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setViewMode("requests")}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              viewMode === "requests"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ListFilter className="w-4 h-4" />
            {t("قائمة الطلبات")} ({requests.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode("settings")}
            className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              viewMode === "settings"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sliders className="w-4 h-4 text-primary" />
            {t("تخصيص وإعدادات الصفحة")}
          </button>
        </div>
      </div>

      {viewMode === "settings" ? (
        <AddGamePageEditor />
      ) : (
        <div className="space-y-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search
                className={`absolute ${dir === "rtl" ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground`}
              />
              <input
                type="text"
                placeholder={t("بحث باسم المنتج، رقم الهاتف، المعرف...")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`w-full bg-card border border-border rounded-lg py-2 ${dir === "rtl" ? "pr-10 pl-4" : "pl-10 pr-4"} text-sm focus:border-primary focus:outline-none`}
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="bg-card border border-border rounded-lg px-4 py-2 text-sm focus:border-primary focus:outline-none"
            >
              {/*
                Every status the list can hold. Three of them — sourcing,
                available and cancelled — had no option at all, and the one
                that named sourcing filtered on "accepted", so an admin
                checking what was in progress got an empty list and concluded
                nothing was.
              */}
              <option value="all">{t("كل الحالات")}</option>
              <option value="submitted">{t("طلبات جديدة")}</option>
              <option value="under_review">{t("قيد المراجعة")}</option>
              <option value="accepted">{t("مقبول")}</option>
              <option value="sourcing">{t("جارٍ البحث عن مورد")}</option>
              <option value="available">{t("متوفر")}</option>
              <option value="added">{t("تمت الإضافة للمتجر")}</option>
              <option value="rejected">{t("مرفوض")}</option>
              <option value="cancelled">{t("ملغي")}</option>
            </select>
          </div>

          {isLoading ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-4">
              {filtered.map((req) => (
                <RequestCard
                  key={req.id}
                  req={req}
                  isEditing={editingId === req.id}
                  onEdit={() => setEditingId(req.id)}
                  onCancel={() => setEditingId(null)}
                  onSave={(updates: Record<string, unknown>) =>
                    updateRequest.mutate({ id: req.id, ...updates })
                  }
                  isSaving={updateRequest.isPending}
                  t={t}
                  getStatusColor={getStatusColor}
                  getStatusLabel={getStatusLabel}
                  lang={lang}
                />
              ))}
              {filtered.length === 0 && (
                <div className="text-center py-16 text-muted-foreground bg-card border border-border rounded-xl">
                  {t("لا توجد طلبات تطابق بحثك.")}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RequestCard({
  req,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  isSaving,
  t,
  getStatusColor,
  getStatusLabel,
  lang,
}: any) {
  const [status, setStatus] = useState(req.status);
  const [adminNote, setAdminNote] = useState(req.adminNote || "");
  const [userVisibleNote, setUserVisibleNote] = useState(req.userVisibleNote || "");
  const [linkedProductId, setLinkedProductId] = useState(req.linkedProductId || "");

  /*
    The card is keyed by request id, so a refetch re-renders it without
    remounting and these initialisers never run again. After a quick "قبول
    الطلب" — which stores a canned message for the customer — the form still
    held the values from page load, and opening "تعديل كامل" and saving wrote
    them back over the newer ones. Re-seeding whenever the stored request
    changes keeps the form showing what is actually saved.
  */
  React.useEffect(() => {
    setStatus(req.status);
    setAdminNote(req.adminNote || "");
    setUserVisibleNote(req.userVisibleNote || "");
    setLinkedProductId(req.linkedProductId || "");
  }, [req.updatedAt, req.status, req.adminNote, req.userVisibleNote, req.linkedProductId]);

  const handleSave = () => {
    onSave({ status, adminNote, userVisibleNote, linkedProductId });
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-bold text-lg">{req.productName}</h3>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${getStatusColor(req.status)}`}
            >
              {getStatusLabel(req.status)}
            </span>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono">
              {req.requestType}
            </span>
          </div>
          <div className="text-sm text-muted-foreground flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" /> {new Date(req.createdAt).toLocaleString()}
            </span>
            {req.gameId && (
              <span className="flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> {t("معرف اللعبة:")} {req.gameId}
              </span>
            )}
          </div>
        </div>
        {!isEditing && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onSave({
                  status: "accepted",
                  userVisibleNote: "تم قبول طلب اللعبة وجارٍ تجهيزها وإضافتها للمتجر قريباً.",
                });
              }}
              disabled={isSaving || req.status === "accepted" || req.status === "added"}
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
              title="قبول الطلب"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t("قبول الطلب")}
            </button>

            <div className="relative group">
              <button
                type="button"
                disabled={isSaving || req.status === "rejected"}
                className="bg-rose-500 hover:bg-rose-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />
                {t("رفض الطلب")}
              </button>
              <div className="hidden group-hover:block absolute left-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl p-1.5 z-20 min-w-[220px] space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    onSave({
                      status: "rejected",
                      userVisibleNote:
                        "نعتذر، اللعبة متوفرة مسبقاً في المتجر، يمكنك البحث عنها وطلبها مباشرة.",
                    });
                  }}
                  className="w-full text-right px-3 py-2 text-xs font-semibold rounded-lg hover:bg-muted transition-colors text-foreground block"
                >
                  📌 اللعبة متوفرة مسبقاً في المتجر
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSave({
                      status: "rejected",
                      userVisibleNote: "نعتذر، اللعبة غير متوفرة حالياً أو غير متوافقة رقمياً.",
                    });
                  }}
                  className="w-full text-right px-3 py-2 text-xs font-semibold rounded-lg hover:bg-muted transition-colors text-foreground block"
                >
                  ⚠️ غير متوافقة أو غير متاحة رقمياً
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSave({
                      status: "rejected",
                      userVisibleNote: "نعتذر، معلومات اللعبة غير كافية للتحقق منها.",
                    });
                  }}
                  className="w-full text-right px-3 py-2 text-xs font-semibold rounded-lg hover:bg-muted transition-colors text-foreground block"
                >
                  ❓ معلومات غير كافية
                </button>
              </div>
            </div>

            <button
              onClick={onEdit}
              className="text-primary hover:bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" /> {t("تعديل كامل")}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4 border-y border-border mb-4">
        <div>
          <span className="block text-xs font-bold text-muted-foreground mb-1">
            {t("المنصة / الإصدار")}
          </span>
          <div className="text-sm">
            {req.platform || "-"} / {req.preferredVersion || "-"}
          </div>
        </div>
        <div>
          <span className="block text-xs font-bold text-muted-foreground mb-1">
            {t("وسيلة التواصل")}
          </span>
          <div className="text-sm font-mono">{req.contactMethod || "-"}</div>
        </div>
        {/*
          The customer picks a region on the request form and it is stored, but
          the admin sourcing the game could not see it — after the title it is
          the field that decides price and availability. The reference link the
          customer supplied was likewise collected and never shown.
        */}
        <div>
          <span className="block text-xs font-bold text-muted-foreground mb-1">
            {t("المنطقة المطلوبة")}
          </span>
          <div className="text-sm">{req.preferredRegion || "-"}</div>
        </div>
        <div>
          <span className="block text-xs font-bold text-muted-foreground mb-1">
            {t("رابط مرجعي")}
          </span>
          <div className="text-sm truncate">
            {req.referenceUrl ? (
              <a
                href={req.referenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3 shrink-0" />
                <span className="truncate">{req.referenceUrl}</span>
              </a>
            ) : (
              "-"
            )}
          </div>
        </div>
        <div className="md:col-span-2">
          <span className="block text-xs font-bold text-muted-foreground mb-1">
            {t("ملاحظات العميل")}
          </span>
          <div className="text-sm bg-muted p-3 rounded-lg whitespace-pre-wrap">
            {req.notes || "-"}
          </div>
        </div>
      </div>

      {isEditing ? (
        <div className="bg-muted p-4 rounded-xl space-y-4 animate-in fade-in slide-in-from-top-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold mb-1">{t("الحالة الجديدة")}</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:border-primary outline-none"
              >
                <option value="submitted">{t("جديد (تم الإرسال)")}</option>
                <option value="under_review">{t("قيد المراجعة")}</option>
                <option value="accepted">{t("مقبول")}</option>
                <option value="sourcing">{t("جارٍ البحث عن مورد")}</option>
                <option value="available">{t("متوفر")}</option>
                <option value="added">{t("تمت الإضافة للمتجر")}</option>
                <option value="rejected">{t("مرفوض / غير متوفر")}</option>
                <option value="cancelled">{t("ملغي")}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">
                {t("ربط بمنتج في المتجر (ID)")}
              </label>
              <div className="relative">
                <LinkIcon
                  className={`absolute ${lang === "ar" ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground`}
                />
                <input
                  type="text"
                  value={linkedProductId}
                  onChange={(e) => setLinkedProductId(e.target.value)}
                  placeholder="product_xxx"
                  className={`w-full bg-background border border-border rounded-lg py-2 ${lang === "ar" ? "pr-9 pl-3" : "pl-9 pr-3"} text-sm font-mono focus:border-primary outline-none`}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold mb-1 text-primary">
              {t("رسالة للعميل (تظهر في سجله)")}
            </label>
            <textarea
              value={userVisibleNote}
              onChange={(e) => setUserVisibleNote(e.target.value)}
              placeholder={t("رسالة توضيحية للعميل...")}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:border-primary outline-none min-h-[60px]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold mb-1 text-amber-500">
              {t("ملاحظات إدارية (داخلية فقط)")}
            </label>
            <textarea
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder={t("ملاحظات للإدارة...")}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:border-primary outline-none min-h-[60px]"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-bold text-muted-foreground hover:bg-background rounded-lg transition-colors"
            >
              {t("إلغاء")}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-bold text-primary-foreground bg-primary rounded-lg hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}{" "}
              {t("حفظ التحديث")}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {req.userVisibleNote && (
            <div className="text-sm bg-primary/10 text-primary p-3 rounded-lg border border-primary/20">
              <strong className="block mb-1 text-xs">{t("الرسالة المرسلة للعميل:")}</strong>
              {req.userVisibleNote}
            </div>
          )}
          {req.adminNote && (
            <div className="text-sm bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 p-3 rounded-lg border border-amber-200 dark:border-amber-500/20">
              <strong className="block mb-1 text-xs">{t("ملاحظة إدارية:")}</strong>
              {req.adminNote}
            </div>
          )}
          {req.linkedProductId && (
            <div className="text-sm flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t("المنتج المرتبط:")}</span>
              <a
                href={`/product/${req.linkedProductId}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline font-mono"
              >
                {req.linkedProductId}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
