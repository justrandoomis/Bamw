import React, { useState } from "react";
import {
  Plus,
  Trash2,
  Layers,
  Link as LinkIcon,
  Sparkles,
  Check,
  Info,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeNintendoAccountPricing } from "@/lib/nintendoPricing";
import {
  resolveOptionStandardDescription,
  resolveTypeStandardDescription,
  STANDARD_OPTION_DESCRIPTIONS,
  STANDARD_TYPE_DESCRIPTIONS,
} from "@/lib/productOptionDescriptions";

export interface ProductOption {
  id: string;
  name: string;
  /** Compare-at price shown crossed out when it is greater than `price`. */
  originalPrice?: number | string;
  price?: number | string;
  cost?: number | string;
  /** Stock for this option; ignored while `isInfiniteStock` is set. */
  stock?: number | string;
  isInfiniteStock?: boolean;
  description?: string;
}

export interface ProductTypeVariant {
  id: string;
  name: string;
  optionId?: string; // Empty or "all" = applies to all options, otherwise specific option ID
  /** Compare-at price shown crossed out when it is greater than `price`. */
  originalPrice?: number | string;
  price: number | string;
  cost?: number | string;
  /** Overrides the stock of the option this type belongs to when present. */
  stock?: number | string;
  isInfiniteStock?: boolean;
  description?: string;
}

interface ProductOptionsEditorProps {
  options: ProductOption[];
  types: ProductTypeVariant[];
  onOptionsChange: (options: ProductOption[]) => void;
  onTypesChange: (types: ProductTypeVariant[]) => void;
  basePrice?: number | string;
  baseCost?: number | string;
}

export function ProductOptionsEditor({
  options = [],
  types = [],
  onOptionsChange,
  onTypesChange,
  basePrice = 0,
  baseCost = 0,
}: ProductOptionsEditorProps) {
  const [activeTab, setActiveTab] = useState<"structure" | "preview">("structure");

  /*
   * Legacy catalogues called Offline/Online “shared/private”. Convert those
   * labels and links once when the editor opens, retaining every numeric value.
   */
  React.useEffect(() => {
    const normalized = normalizeNintendoAccountPricing({ options, types });
    const normalizedOptions = normalized.options || [];
    const normalizedTypes = normalized.types || [];
    if (JSON.stringify(normalizedOptions) !== JSON.stringify(options)) {
      onOptionsChange(normalizedOptions);
    }
    if (JSON.stringify(normalizedTypes) !== JSON.stringify(types)) {
      onTypesChange(normalizedTypes);
    }
  }, [options, types, onOptionsChange, onTypesChange]);

  // Options handlers
  const addOption = (
    name = "",
    description = "",
    price: number | string = "",
    cost: number | string = "",
  ) => {
    const newId =
      "opt_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 6);
    onOptionsChange([...options, { id: newId, name, description, price, cost }]);
  };

  const updateOption = (index: number, field: keyof ProductOption, value: any) => {
    const next = [...options];
    if (next[index]) {
      const current = next[index]!;
      next[index] = {
        ...current,
        id:
          current.id && String(current.id).trim()
            ? String(current.id).trim()
            : `opt_${Date.now()}_${index}`,
        [field]: value,
      };
      onOptionsChange(next);
    }
  };

  const removeOption = (index: number) => {
    const targetOpt = options[index];
    const targetId = targetOpt?.id;
    const next = options.filter((_, i) => i !== index);
    onOptionsChange(next);
    // Clear optionId from types referencing this option
    if (targetId) {
      onTypesChange(types.map((t) => (t.optionId === targetId ? { ...t, optionId: "" } : t)));
    }
  };

  // Types / Variants handlers
  const addType = (
    name = "",
    optionId = "",
    price: number | string = "",
    cost: number | string = "",
  ) => {
    const newId =
      "typ_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 6);
    onTypesChange([
      ...types,
      {
        id: newId,
        name,
        optionId,
        price: price ?? "",
        cost: cost ?? "",
        description: "",
      },
    ]);
  };

  const updateType = (index: number, field: keyof ProductTypeVariant, value: any) => {
    const next = [...types];
    if (next[index]) {
      const current = next[index]!;
      next[index] = {
        ...current,
        id:
          current.id && String(current.id).trim()
            ? String(current.id).trim()
            : `typ_${Date.now()}_${index}`,
        [field]: value,
      };
      onTypesChange(next);
    }
  };

  const removeType = (index: number) => {
    const next = types.filter((_, i) => i !== index);
    onTypesChange(next);
  };

  // Quick preset loader with standardized descriptions
  const applyAccountsPreset = () => {
    const optOfflineId = "opt_offline_" + Date.now().toString(36);
    const optOnlineId = "opt_online_" + Date.now().toString(36);

    const newOptions: ProductOption[] = [
      {
        id: optOfflineId,
        name: "حساب أوفلاين (Offline)",
        description: STANDARD_OPTION_DESCRIPTIONS.OFFLINE,
        originalPrice: "",
        price: "",
        cost: "",
      },
      {
        id: optOnlineId,
        name: "حساب أونلاين (Online)",
        description: STANDARD_OPTION_DESCRIPTIONS.ONLINE,
        originalPrice: "",
        price: Number(basePrice || 25000) > 0 ? Number(basePrice || 25000) + 5000 : "",
        cost: Number(baseCost || 18000) > 0 ? Number(baseCost || 18000) + 3000 : "",
      },
    ];

    const newTypes: ProductTypeVariant[] = [
      {
        id: "typ_std_" + Date.now(),
        name: "النسخة القياسية Standard",
        optionId: "",
        originalPrice: "",
        price: "",
        cost: "",
        description: STANDARD_TYPE_DESCRIPTIONS.BASE,
      },
      {
        id: "typ_dlx_" + Date.now(),
        name: "نسخة مع الإضافات Deluxe",
        optionId: "",
        originalPrice: "",
        price: Number(basePrice || 25000) + 10000,
        cost: Number(baseCost || 18000) + 7000,
        description: STANDARD_TYPE_DESCRIPTIONS.DLC,
      },
      {
        id: "typ_ult_" + Date.now(),
        name: "النسخة الفاخرة Ultimate (خاص بالأوفلاين)",
        optionId: optOfflineId,
        originalPrice: "",
        price: Number(basePrice || 25000) + 15000,
        cost: Number(baseCost || 18000) + 10000,
        description: STANDARD_TYPE_DESCRIPTIONS.DLC,
      },
    ];

    onOptionsChange(newOptions);
    onTypesChange(newTypes);
  };

  const standardizeAllDescriptions = () => {
    const newOptions = options.map((opt) => ({
      ...opt,
      description:
        resolveOptionStandardDescription(opt.name || opt.id, opt.description) || opt.description,
    }));
    const newTypes = types.map((t) => ({
      ...t,
      description: resolveTypeStandardDescription(t.name || t.id, t.description) || t.description,
    }));
    onOptionsChange(newOptions);
    onTypesChange(newTypes);
  };

  const applyColorsPreset = () => {
    const optRedBlue = "opt_neon_" + Date.now().toString(36);
    const optGrey = "opt_grey_" + Date.now().toString(36);
    const optOledWhite = "opt_white_" + Date.now().toString(36);

    const newOptions: ProductOption[] = [
      {
        id: optRedBlue,
        name: "نيون أحمر وأزرق (Neon Red/Blue)",
        description: "الإصدار الكلاسيكي الملون",
        price: "",
        cost: "",
      },
      {
        id: optGrey,
        name: "رمادي (Grey)",
        description: "الإصدار الكلاسيكي الرمادي",
        price: "",
        cost: "",
      },
      {
        id: optOledWhite,
        name: "أبيض أوليد (OLED White)",
        description: "إصدار شاشة OLED الفاخر",
        price: Number(basePrice || 350000) + 20000,
        cost: Number(baseCost || 310000) + 15000,
      },
    ];

    const newTypes: ProductTypeVariant[] = [
      {
        id: "typ_64_" + Date.now(),
        name: "سعة 64GB",
        optionId: "",
        price: "",
        cost: "",
      },
      {
        id: "typ_128_" + Date.now(),
        name: "سعة 128GB",
        optionId: "",
        price: Number(basePrice || 350000) + 40000,
        cost: Number(baseCost || 310000) + 30000,
      },
      {
        id: "typ_oled_bundle_" + Date.now(),
        name: "باقة OLED مع ملحقات فاخرة (خاص بالأبيض)",
        optionId: optOledWhite,
        price: Number(basePrice || 350000) + 90000,
        cost: Number(baseCost || 310000) + 70000,
      },
    ];

    onOptionsChange(newOptions);
    onTypesChange(newTypes);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-6">
      {/* Header with Presets */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-500" />
            نظام الخيارات والأنواع / الإصدارات المتقدم (Options & Types)
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            تحديد الخيار الرئيسي (مثل: نوع الحساب أو اللون) والأنواع الفرعية (مثل: النسخة القياسية
            أو الفاخرة) مع تخصيص السعر والتكلفة، أو ترك الحقول فارغة لاستخدام السعر الأساسي.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Standardize Descriptions Action */}
          {(options.length > 0 || types.length > 0) && (
            <button
              type="button"
              onClick={standardizeAllDescriptions}
              className="text-[11px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-2.5 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1 border border-emerald-500/20"
              title="تطبيق الأوصاف الموحدة لجميع الخيارات والأنواع تلقائياً"
            >
              <ShieldCheck className="w-3 h-3" /> توحيد الأوصاف القياسية
            </button>
          )}

          {/* Quick Presets Menu */}
          <button
            type="button"
            onClick={applyAccountsPreset}
            className="text-[11px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 px-2.5 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1 border border-amber-500/20"
            title="إضافة خيارات أوفلاين/أونلاين مع إصدارات قياسية وفاخرة"
          >
            <Sparkles className="w-3 h-3" /> قالب حسابات (أوفلاين / أونلاين)
          </button>
          <button
            type="button"
            onClick={applyColorsPreset}
            className="text-[11px] bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 px-2.5 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1 border border-blue-500/20"
            title="إضافة خيارات الألوان وسعات التخزين"
          >
            <Sparkles className="w-3 h-3" /> قالب الألوان والسعات
          </button>
        </div>
      </div>

      {/* SECTION 1: MAIN OPTIONS (الخيارات الأساسية) */}
      <div className="space-y-3 bg-muted/20 p-4 rounded-xl border border-border/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-foreground text-background text-[11px] font-bold flex items-center justify-center">
              1
            </span>
            <div>
              <h3 className="text-xs font-bold text-foreground">
                الخيارات الرئيسية (مثل: حساب أوفلاين، حساب أونلاين، اللون، إلخ)
              </h3>
              <p className="text-[11px] text-muted-foreground">
                لكل خيار سعر وتكلفة مخصصة. إذا ترك فارغاً، يتم استخدام السعر الأساسي للمنتج
                تلقائياً.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => addOption()}
            className="text-xs bg-foreground text-background px-3 py-1 rounded-lg font-bold flex items-center gap-1 hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" /> إضافة خيار رئيسي
          </button>
        </div>

        {options.length === 0 ? (
          <div className="p-3 bg-background border border-dashed border-border rounded-lg text-center">
            <p className="text-xs text-muted-foreground">
              لم تتم إضافة خيارات رئيسية بعد. يمكنك إضافة خيارات (مثل "حساب أوفلاين" و "حساب
              أونلاين") مع سعر وتكلفة مخصصة أو تركها لتستخدم السعر الأساسي (
              {Number(basePrice).toLocaleString()} د.ع).
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {options.map((opt, idx) => {
              const hasOriginalPrice = opt.originalPrice !== "" && opt.originalPrice != null;
              const hasCustomPrice = opt.price !== "" && opt.price != null;
              const hasCustomCost = opt.cost !== "" && opt.cost != null;
              return (
                <div
                  key={opt.id}
                  className="p-3.5 bg-background border border-border rounded-xl space-y-2.5 shadow-2xs"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-[11px] font-bold text-muted-foreground w-6 text-center">
                      #{idx + 1}
                    </span>

                    {/* Option Name */}
                    <div className="flex-1 min-w-[170px]">
                      <label className="block text-[10px] text-muted-foreground mb-0.5 font-bold">
                        اسم الخيار الرئيسي
                      </label>
                      <input
                        type="text"
                        value={opt.name}
                        onChange={(e) => updateOption(idx, "name", e.target.value)}
                        placeholder="مثال: حساب أوفلاين، حساب أونلاين، لون أسود..."
                        className="w-full border border-border focus:border-foreground rounded-lg px-2.5 py-1.5 text-xs outline-none bg-background font-bold"
                      />
                    </div>

                    {/* Compare-at price in IQD */}
                    <div className="w-32">
                      <label className="block text-[10px] text-muted-foreground mb-0.5 font-bold">
                        قبل الخصم (د.ع)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={opt.originalPrice ?? ""}
                        onChange={(e) => updateOption(idx, "originalPrice", e.target.value)}
                        placeholder="اختياري"
                        className={cn(
                          "w-full border rounded-lg px-2.5 py-1.5 text-xs outline-none bg-background font-bold",
                          hasOriginalPrice
                            ? "border-muted-foreground/40 text-muted-foreground"
                            : "border-border text-foreground focus:border-foreground",
                        )}
                        dir="ltr"
                        title="يظهر مشطوباً فقط عندما يكون أكبر من سعر البيع"
                      />
                    </div>

                    {/* Price in IQD */}
                    <div className="w-32">
                      <label className="block text-[10px] text-muted-foreground mb-0.5 font-bold flex items-center justify-between">
                        <span>بعد الخصم (د.ع)</span>
                        {!hasCustomPrice && (
                          <span className="text-[9px] text-muted-foreground/80 font-normal">
                            افتراضي
                          </span>
                        )}
                      </label>
                      <input
                        type="number"
                        value={opt.price ?? ""}
                        onChange={(e) => updateOption(idx, "price", e.target.value)}
                        placeholder={String(basePrice || 0)}
                        className={cn(
                          "w-full border rounded-lg px-2.5 py-1.5 text-xs outline-none bg-background font-black",
                          hasCustomPrice
                            ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                            : "border-border text-foreground focus:border-foreground",
                        )}
                        dir="ltr"
                        title="اتركه فارغاً لاستخدام السعر الأساسي للمنتج"
                      />
                    </div>

                    {/* Cost in IQD */}
                    <div className="w-32">
                      <label className="block text-[10px] text-muted-foreground mb-0.5 font-bold flex items-center justify-between">
                        <span>التكلفة (د.ع)</span>
                        {!hasCustomCost && (
                          <span className="text-[9px] text-muted-foreground/80 font-normal">
                            افتراضي
                          </span>
                        )}
                      </label>
                      <input
                        type="number"
                        value={opt.cost ?? ""}
                        onChange={(e) => updateOption(idx, "cost", e.target.value)}
                        placeholder={String(baseCost || 0)}
                        className="w-full border border-border focus:border-foreground rounded-lg px-2.5 py-1.5 text-xs outline-none bg-background text-muted-foreground"
                        dir="ltr"
                        title="اتركه فارغاً لاستخدام التكلفة الأساسية للمنتج"
                      />
                    </div>

                    {/* Delete */}
                    <div className="pt-4">
                      <button
                        type="button"
                        onClick={() => removeOption(idx)}
                        className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="حذف هذا الخيار"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Description & Price Status Pill */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
                    <input
                      type="text"
                      value={opt.description || ""}
                      onChange={(e) => updateOption(idx, "description", e.target.value)}
                      placeholder="الوصف (مثال: حساب مشترك أو حساب خاص بك)..."
                      className="flex-1 min-w-[200px] border border-border/60 focus:border-foreground rounded-md px-2 py-1 text-[11px] outline-none bg-muted/30 text-muted-foreground"
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          updateOption(idx, "description", STANDARD_OPTION_DESCRIPTIONS.OFFLINE)
                        }
                        className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors font-medium"
                      >
                        حساب مشترك
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateOption(idx, "description", STANDARD_OPTION_DESCRIPTIONS.ONLINE)
                        }
                        className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors font-medium"
                      >
                        حساب خاص بك
                      </button>
                    </div>
                    <span
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0",
                        hasCustomPrice
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {hasCustomPrice
                        ? `سعر مخصص: ${Number(opt.price).toLocaleString()} د.ع`
                        : `سعر أساسي: ${Number(basePrice || 0).toLocaleString()} د.ع`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 2: SUB-TYPES / VARIANTS / EDITIONS (الأنواع والإصدارات) */}
      <div className="space-y-3 bg-muted/20 p-4 rounded-xl border border-border/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-foreground text-background text-[11px] font-bold flex items-center justify-center">
              2
            </span>
            <div>
              <h3 className="text-xs font-bold text-foreground">
                الأنواع والإصدارات والأسعار (Sub-Types & Linked Editions)
              </h3>
              <p className="text-[11px] text-muted-foreground">
                حدد اسم النوع وسعره واربطه بخيار محدد (مثال: النسخة الفاخرة خاصة بالأوفلاين فقط) أو
                اتركه لجميع الخيارات. إذا ترك السعر فارغاً، سيتم استخدام سعر الخيار أو السعر
                الأساسي.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => addType()}
            className="text-xs bg-foreground text-background px-3 py-1 rounded-lg font-bold flex items-center gap-1 hover:opacity-90 transition-opacity"
          >
            <Plus className="w-3.5 h-3.5" /> إضافة نوع / إصدار
          </button>
        </div>

        {types.length === 0 ? (
          <div className="p-3 bg-background border border-dashed border-border rounded-lg text-center">
            <p className="text-xs text-muted-foreground">
              لا توجد أنواع/إصدارات محددة. سيتم بيع الخيار بالسعر المحدد له أو السعر الأساسي للمنتج.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {types.map((typeItem, idx) => {
              const linkedOption = options.find((o) => o.id === typeItem.optionId);
              const fallbackPrice =
                linkedOption && linkedOption.price !== "" && linkedOption.price != null
                  ? linkedOption.price
                  : basePrice;
              const fallbackCost =
                linkedOption && linkedOption.cost !== "" && linkedOption.cost != null
                  ? linkedOption.cost
                  : baseCost;
              const hasOriginalPrice =
                typeItem.originalPrice !== "" && typeItem.originalPrice != null;
              const hasCustomPrice = typeItem.price !== "" && typeItem.price != null;
              const hasCustomCost = typeItem.cost !== "" && typeItem.cost != null;

              return (
                <div
                  key={typeItem.id}
                  className="p-3.5 bg-background border border-border rounded-xl space-y-2.5 shadow-2xs"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-[11px] font-bold text-muted-foreground w-6 text-center">
                      #{idx + 1}
                    </span>

                    {/* Name */}
                    <div className="flex-1 min-w-[170px]">
                      <label className="block text-[10px] text-muted-foreground mb-0.5 font-bold">
                        اسم النوع / الإصدار
                      </label>
                      <input
                        type="text"
                        value={typeItem.name}
                        onChange={(e) => updateType(idx, "name", e.target.value)}
                        placeholder="مثال: النسخة القياسية Standard / فاخر Deluxe"
                        className="w-full border border-border focus:border-foreground rounded-lg px-2.5 py-1.5 text-xs outline-none bg-background font-bold"
                      />
                    </div>

                    {/* Option Association Dropdown */}
                    <div className="min-w-[190px]">
                      <label className="block text-[10px] text-muted-foreground mb-0.5 font-bold flex items-center gap-1">
                        <LinkIcon className="w-3 h-3 text-amber-500" /> الارتباط بالخيار
                      </label>
                      <select
                        value={typeItem.optionId || ""}
                        onChange={(e) => updateType(idx, "optionId", e.target.value)}
                        className="w-full border border-border focus:border-foreground rounded-lg px-2.5 py-1.5 text-xs outline-none bg-background font-medium"
                      >
                        <option value="">🌐 متاح لجميع الخيارات (الكل)</option>
                        {options.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            🔒 خاص بـ: {opt.name || "خيار بدون اسم"}{" "}
                            {opt.price ? `(${Number(opt.price).toLocaleString()} د.ع)` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Compare-at price in IQD */}
                    <div className="w-32">
                      <label className="block text-[10px] text-muted-foreground mb-0.5 font-bold">
                        قبل الخصم (د.ع)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={typeItem.originalPrice ?? ""}
                        onChange={(e) => updateType(idx, "originalPrice", e.target.value)}
                        placeholder="اختياري"
                        className={cn(
                          "w-full border rounded-lg px-2.5 py-1.5 text-xs outline-none bg-background font-bold",
                          hasOriginalPrice
                            ? "border-muted-foreground/40 text-muted-foreground"
                            : "border-border text-foreground focus:border-foreground",
                        )}
                        dir="ltr"
                        title="يظهر مشطوباً فقط عندما يكون أكبر من سعر البيع"
                      />
                    </div>

                    {/* Price in IQD */}
                    <div className="w-32">
                      <label className="block text-[10px] text-muted-foreground mb-0.5 font-bold flex items-center justify-between">
                        <span>بعد الخصم (د.ع)</span>
                        {!hasCustomPrice && (
                          <span className="text-[9px] text-muted-foreground/80 font-normal">
                            افتراضي
                          </span>
                        )}
                      </label>
                      <input
                        type="number"
                        value={typeItem.price ?? ""}
                        onChange={(e) => updateType(idx, "price", e.target.value)}
                        placeholder={String(fallbackPrice || 0)}
                        className={cn(
                          "w-full border rounded-lg px-2.5 py-1.5 text-xs outline-none bg-background font-black",
                          hasCustomPrice
                            ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                            : "border-border text-foreground focus:border-foreground",
                        )}
                        dir="ltr"
                        title="اتركه فارغاً لاستخدام سعر الخيار المرتبط أو السعر الأساسي"
                      />
                    </div>

                    {/* Cost in IQD */}
                    <div className="w-32">
                      <label className="block text-[10px] text-muted-foreground mb-0.5 font-bold flex items-center justify-between">
                        <span>التكلفة (د.ع)</span>
                        {!hasCustomCost && (
                          <span className="text-[9px] text-muted-foreground/80 font-normal">
                            افتراضي
                          </span>
                        )}
                      </label>
                      <input
                        type="number"
                        value={typeItem.cost ?? ""}
                        onChange={(e) => updateType(idx, "cost", e.target.value)}
                        placeholder={String(fallbackCost || 0)}
                        className="w-full border border-border focus:border-foreground rounded-lg px-2.5 py-1.5 text-xs outline-none bg-background text-muted-foreground"
                        dir="ltr"
                        title="اتركه فارغاً لاستخدام تكلفة الخيار المرتبط أو التكلفة الأساسية"
                      />
                    </div>

                    {/* Delete */}
                    <div className="pt-4">
                      <button
                        type="button"
                        onClick={() => removeType(idx)}
                        className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="حذف هذا النوع"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Optional Description / Content Notes */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
                    <input
                      type="text"
                      value={typeItem.description || ""}
                      onChange={(e) => updateType(idx, "description", e.target.value)}
                      placeholder="الوصف (مثال: اللعبة الأساسية أو اللعبة مع الإضافات)..."
                      className="flex-1 min-w-[200px] border border-border/60 focus:border-foreground rounded-md px-2 py-1 text-[11px] outline-none bg-muted/30 text-muted-foreground"
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          updateType(idx, "description", STANDARD_TYPE_DESCRIPTIONS.BASE)
                        }
                        className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors font-medium"
                      >
                        اللعبة الأساسية
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateType(idx, "description", STANDARD_TYPE_DESCRIPTIONS.DLC)
                        }
                        className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors font-medium"
                      >
                        اللعبة مع الإضافات
                      </button>
                    </div>
                    {linkedOption && (
                      <span className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-bold shrink-0">
                        مرتبط فقط بـ: {linkedOption.name}
                      </span>
                    )}
                    <span
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0",
                        hasCustomPrice
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {hasCustomPrice
                        ? `سعر مخصص: ${Number(typeItem.price).toLocaleString()} د.ع`
                        : `سعر افتراضي: ${Number(fallbackPrice || 0).toLocaleString()} د.ع`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Visual Live Preview of Buyer Selector Experience */}
      {(options.length > 0 || types.length > 0) && (
        <div className="p-4 bg-muted/40 rounded-xl border border-border space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Info className="w-4 h-4 text-blue-500" />
            معاينة تجربة اختيار العميل في المتجر (Customer Live Preview):
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-background p-4 rounded-lg border border-border">
            {/* Step 1 Preview */}
            <div className="space-y-2">
              <label className="block text-[11px] font-bold text-muted-foreground">
                الخطوة 1: اختيار الخيار الرئيسي
              </label>
              <div className="flex flex-wrap gap-1.5">
                {options.length > 0 ? (
                  options.map((opt, i) => {
                    const price =
                      opt.price !== "" && opt.price != null
                        ? Number(opt.price)
                        : Number(basePrice || 0);
                    const originalPrice = Number(opt.originalPrice) || 0;
                    return (
                      <span
                        key={opt.id}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5",
                          i === 0
                            ? "bg-foreground text-background border-foreground"
                            : "bg-muted text-foreground border-border",
                        )}
                      >
                        <span>{opt.name || `خيار ${i + 1}`}</span>
                        <span className="flex items-center gap-1 font-mono text-[11px]">
                          {originalPrice > price ? (
                            <span className="line-through opacity-60">
                              {originalPrice.toLocaleString()}
                            </span>
                          ) : null}
                          <span
                            className={
                              i === 0
                                ? "text-emerald-300"
                                : "text-emerald-600 dark:text-emerald-400"
                            }
                          >
                            ({price.toLocaleString()} د.ع)
                          </span>
                        </span>
                      </span>
                    );
                  })
                ) : (
                  <span className="text-xs text-muted-foreground">
                    الافتراضي ({Number(basePrice || 0).toLocaleString()} د.ع)
                  </span>
                )}
              </div>
            </div>

            {/* Step 2 Preview */}
            <div className="space-y-2">
              <label className="block text-[11px] font-bold text-muted-foreground">
                الخطوة 2: الأنواع المتاحة بناءً على الخيار المحدد
              </label>
              <div className="flex flex-wrap gap-1.5">
                {types.length > 0 ? (
                  types.map((t, i) => {
                    const linked = options.find((o) => o.id === t.optionId);
                    const optPrice =
                      linked && linked.price !== "" && linked.price != null
                        ? Number(linked.price)
                        : Number(basePrice || 0);
                    const finalPrice =
                      t.price !== "" && t.price != null ? Number(t.price) : optPrice;
                    const originalPrice = Number(t.originalPrice) || 0;
                    return (
                      <span
                        key={t.id}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-muted/80 text-foreground border border-border flex items-center gap-1"
                      >
                        <span>{t.name || `نوع ${i + 1}`}</span>
                        <span className="flex items-center gap-1 font-mono">
                          {originalPrice > finalPrice ? (
                            <span className="text-muted-foreground line-through">
                              {originalPrice.toLocaleString()}
                            </span>
                          ) : null}
                          <span className="text-emerald-600 dark:text-emerald-400">
                            ({finalPrice.toLocaleString()} د.ع)
                          </span>
                        </span>
                      </span>
                    );
                  })
                ) : (
                  <span className="text-xs text-muted-foreground">السعر الأساسي</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
