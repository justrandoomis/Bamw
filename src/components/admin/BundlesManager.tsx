import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import NintendoCover from "@/components/NintendoCover";
import {
  Layers,
  Plus,
  Edit2,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  Search,
  Check,
  X,
  Gamepad2,
  DollarSign,
  Package,
  Upload,
  Image as ImageIcon,
  ShieldCheck,
  Zap,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import type { AccountBundle, Product } from "@/lib/types";
import { adminApi, fileToDataUrl } from "@/lib/api";
import { getBundleGames } from "@/lib/bundles";
import { isProductHidden } from "@/lib/purchasable";
import { buildProductIndex, searchProducts } from "@/lib/search/products";

/** How many picker rows are rendered at once. */
const PICKER_ROWS = 60;
/*
  How many hits the search may return, which is deliberately larger.

  The count printed under the box is the number of matches, so it must be the
  real one: searching at the render cap would print "60 نتيجة" for a query that
  matched a hundred, which is a cap wearing a count's clothes.
*/
const PICKER_SEARCH_LIMIT = 500;

interface BundlesManagerProps {
  bundles: AccountBundle[];
  products: Product[];
  onSaveBundles: (updated: AccountBundle[]) => void;
}

export default function BundlesManager({
  bundles = [],
  products = [],
  onSaveBundles,
}: BundlesManagerProps) {
  const [search, setSearch] = useState("");
  const [editingBundle, setEditingBundle] = useState<AccountBundle | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [gameSearch, setGameSearch] = useState("");

  // Filtered bundle list
  const filteredBundles = useMemo(() => {
    if (!search.trim()) return bundles;
    const q = search.toLowerCase().trim();
    return bundles.filter(
      (b) =>
        (b.title || "").toLowerCase().includes(q) ||
        (b.titleEn || "").toLowerCase().includes(q) ||
        (b.description || "").toLowerCase().includes(q),
    );
  }, [bundles, search]);

  /*
    The whole catalogue, not the page the products table happens to be on.

    `products` is what AdminDashboard holds, and that is one page of fifty rows
    from `/api/admin/products` (AdminDashboard.tsx:192, :520-560). The shop has
    around 150 products, so two thirds of them were never in this component at
    all — which is why a game that had just been imported could not be found
    here, and why a bundle already containing such a game showed it as
    «لعبة #id» with no name.

    Fetched once, cached by React Query. `products` is still used as the first
    paint so the picker is never empty while this is in flight.
  */
  const {
    data: catalogueStore,
    isPending: catalogueLoading,
    isError: catalogueFailed,
  } = useQuery({
    queryKey: ["admin", "bundle-catalogue"],
    queryFn: ({ signal }) => adminApi.catalogue(signal),
    /*
      Re-read every time this tab is opened. The admin who opens it has usually
      just imported the games they came here to bundle, and a cached list is
      the same "the game I added is not here" with a different cause.
      `staleTime` still spares the keystrokes in between.
    */
    refetchOnMount: "always",
    staleTime: 60_000,
  });

  const catalogue: Product[] = useMemo(() => {
    const loaded = (catalogueStore?.products ?? []) as Product[];
    return loaded.length > 0 ? loaded : products;
  }, [catalogueStore?.products, products]);

  /*
    Everything that can go in a bundle — including what is hidden.

    A hidden product is not an ineligible one: the games an admin is building a
    bundle out of are frequently the ones just imported, and the importer saves
    them hidden on purpose. Excluding them hid exactly the products this picker
    exists to find. They are shown, and labelled, so the choice is informed
    rather than made for the admin.
  */
  const pickerGames = useMemo(
    () =>
      catalogue.filter(
        (p) => p.kind !== "hardware" && p.kind !== "accessory" && p.kind !== "device",
      ),
    [catalogue],
  );

  /* Built once per catalogue; folding 150 products on every keystroke stutters. */
  const pickerIndex = useMemo(
    () => buildProductIndex(pickerGames as unknown as Record<string, unknown>[]),
    [pickerGames],
  );

  const selectedIds = useMemo(
    () => new Set((editingBundle?.gameIds ?? []).map((id) => String(id))),
    [editingBundle?.gameIds],
  );

  /*
    What the admin sees in the list.

    The games already in the bundle come first and are never filtered out — a
    picker that hides what you have already chosen is a picker you cannot undo
    a choice in. Below them, the search results; and with an empty box, the
    rest of the catalogue rather than an arbitrary first thirty.

    The search is the storefront's own engine (src/lib/search/products.ts), so
    «زيلدا» finds the game here for the same reason it does on the shop.
  */
  const { searchHits, filteredPickerGames } = useMemo(() => {
    const chosen = pickerGames.filter((p) => selectedIds.has(String(p.id)));
    const query = gameSearch.trim();
    const hits = query
      ? searchProducts(pickerIndex, query, { limit: PICKER_SEARCH_LIMIT })
          .map((row) => row.product as unknown as Product)
          .filter((p) => !selectedIds.has(String(p.id)))
      : pickerGames.filter((p) => !selectedIds.has(String(p.id)));
    return {
      searchHits: hits,
      filteredPickerGames: [...chosen, ...hits],
    };
  }, [pickerGames, pickerIndex, gameSearch, selectedIds]);

  /*
    Rows are capped, the search is not.

    The search reads the whole catalogue and the chosen games are always at the
    front, so nothing the admin has picked can fall off the end. This cap only
    stops a hundred and forty cover images being requested at once, and the
    line under the box says both the true number of matches and when only some
    of them are drawn — the old cap of thirty was applied to the *search* and
    said nothing, which is how a game could be in the shop and unfindable here.
  */
  const visiblePickerGames = filteredPickerGames.slice(0, PICKER_ROWS);

  const handleStartCreate = () => {
    setEditingBundle({
      id: `bnd_${Date.now()}`,
      title: "",
      titleEn: "",
      description: "",
      price: 35000,
      originalPrice: 50000,
      image: "",
      gameIds: [],
      accountType: "primary",
      stock: 20,
      isActive: true,
      badge: "بندل جديد ✨",
      features: [
        "ألعاب كاملة بحساب رسمي واحد",
        "تفعيل رئيسي للعب بحسابك الخاص",
        "تحميل مباشر من Nintendo eShop",
        "تسليم فوري ومضمون مدى الحياة",
      ],
      deliveryTime: "فوري وتلقائي في محادثة الطلب",
    });
    setIsCreating(true);
    setGameSearch("");
  };

  const handleStartEdit = (bundle: AccountBundle) => {
    setEditingBundle(JSON.parse(JSON.stringify(bundle)));
    setIsCreating(false);
    setGameSearch("");
  };

  const handleDelete = (id: string) => {
    if (!confirm("هل أنت متأكد من رغبتك في حذف هذا البندل؟")) return;
    const next = bundles.filter((b) => b.id !== id);
    onSaveBundles(next);
    toast.success("تم حذف البندل بنجاح");
  };

  const handleToggleActive = (bundle: AccountBundle) => {
    const next = bundles.map((b) =>
      b.id === bundle.id ? { ...b, isActive: b.isActive === false ? true : false } : b,
    );
    onSaveBundles(next);
    toast.success(`تم ${bundle.isActive === false ? "تفعيل" : "تعطيل"} البندل`);
  };

  const handleDuplicate = (bundle: AccountBundle) => {
    const clone: AccountBundle = {
      ...JSON.parse(JSON.stringify(bundle)),
      id: `bnd_${Date.now()}`,
      title: `${bundle.title} (نسخة)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const next = [clone, ...bundles];
    onSaveBundles(next);
    toast.success("تم تكرار البندل بنجاح");
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBundle) return;

    if (!String(editingBundle.title || "").trim()) {
      toast.error("يرجى إدخال عنوان البندل");
      return;
    }

    if (!editingBundle.gameIds || editingBundle.gameIds.length === 0) {
      toast.error("يرجى اختيار لعبة واحدة على الأقل في البندل");
      return;
    }

    const now = new Date().toISOString();
    const updatedItem: AccountBundle = {
      ...editingBundle,
      price: Number(editingBundle.price) || 0,
      originalPrice: Number(editingBundle.originalPrice) || 0,
      stock: Number(editingBundle.stock) || 0,
      updatedAt: now,
      createdAt: editingBundle.createdAt || now,
    };

    let next: AccountBundle[];
    if (isCreating) {
      next = [updatedItem, ...bundles];
    } else {
      next = bundles.map((b) => (b.id === updatedItem.id ? updatedItem : b));
    }

    onSaveBundles(next);
    toast.success(isCreating ? "تم إنشاء البندل بنجاح!" : "تم حفظ تعديلات البندل!");
    setEditingBundle(null);
    setIsCreating(false);
  };

  const toggleGameSelection = (gameId: string | number) => {
    if (!editingBundle) return;
    const currentIds = editingBundle.gameIds || [];
    const exists = currentIds.some((id) => String(id) === String(gameId));
    let nextIds: (string | number)[];
    if (exists) {
      nextIds = currentIds.filter((id) => String(id) !== String(gameId));
    } else {
      nextIds = [...currentIds, gameId];
    }

    /*
      The "sum of the individual prices" hint, recomputed from the selection.

      This writes `originalPrice`, which is the number the customer sees struck
      through — commercial data. It used to be summed over `products`, the
      fifty-row page, so any selected game that was not on that page silently
      contributed nothing and the strike-through price fell by its price the
      next time the admin touched anything. Now it is summed over the whole
      catalogue, and if even one selected game cannot be resolved the figure is
      left exactly as the admin set it rather than replaced with a wrong one.
    */
    const resolved = catalogue.filter((p) => nextIds.some((id) => String(id) === String(p.id)));
    const everyGameResolved = resolved.length === nextIds.length;
    const totalOriginal = resolved.reduce((acc, g) => acc + (Number(g.price) || 0), 0);

    setEditingBundle({
      ...editingBundle,
      gameIds: nextIds,
      originalPrice:
        everyGameResolved && totalOriginal > 0 ? totalOriginal : editingBundle.originalPrice,
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingBundle) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setEditingBundle({ ...editingBundle, image: dataUrl });
      toast.success("تم رفع الصورة بنجاح");
    } catch {
      toast.error("فشل رفع الصورة");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-5 rounded-3xl border border-border shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 text-red-600 flex items-center justify-center">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-black text-foreground">
              إدارة حزم وبندلات الحسابات (Bundles)
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              دمج أكثر من لعبة في حساب ننتندو سويتش واحد جاهز للتحميل والتسليم الفوري
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleStartCreate}
            className="px-4 py-2.5 rounded-2xl bg-red-500 hover:bg-red-600 active:scale-95 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm hover:shadow-md transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة بندل جديد</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث في البندلات الحالية..."
          className="w-full pr-10 pl-4 py-2.5 text-xs bg-card rounded-2xl border border-border focus:border-red-500 focus:outline-none transition-colors"
        />
      </div>

      {/* Bundles Table / Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(filteredBundles || [])
          .filter((bundle) => bundle && typeof bundle === "object")
          .map((bundle) => {
            /*
              The same catalogue the editor picks from.

              Read against the fifty-row page, a bundle under-reported itself:
              a card said «3 ألعاب» for a bundle of five because two of them
              were not on the page this component happened to be handed.
            */
            const games = getBundleGames(bundle, catalogue);
            const isActive = bundle.isActive !== false;
            const gameCount = games.length || (Array.isArray(bundle.gameIds) ? bundle.gameIds.length : 0);

            return (
              <div
                key={bundle.id}
                className={`p-4 rounded-3xl bg-card border transition-all flex flex-col justify-between space-y-4 ${
                  isActive
                    ? "border-border shadow-xs hover:shadow-md"
                    : "border-border/50 opacity-60 bg-muted/20"
                }`}
              >
                {/* Top Row: Badges & Actions */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 border border-red-500/20 flex items-center gap-1">
                      <Layers className="w-3 h-3" />
                      {gameCount} ألعاب
                    </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      bundle.accountType === "primary"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : bundle.accountType === "secondary"
                          ? "bg-blue-500/10 text-blue-600"
                          : "bg-purple-500/10 text-purple-600"
                    }`}
                  >
                    {bundle.accountType === "primary"
                      ? "رئيسي"
                      : bundle.accountType === "secondary"
                        ? "فرعي"
                        : bundle.accountType === "full"
                          ? "كامل"
                          : "أوفلاين"}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggleActive(bundle)}
                    className={`p-1.5 rounded-xl text-xs transition-colors ${
                      isActive
                        ? "text-emerald-600 hover:bg-emerald-500/10"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                    title={isActive ? "تعطيل البندل" : "تفعيل البندل"}
                  >
                    {isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>

                  <button
                    onClick={() => handleDuplicate(bundle)}
                    className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="تكرار البندل"
                  >
                    <Copy className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleStartEdit(bundle)}
                    className="p-1.5 rounded-xl text-blue-600 hover:bg-blue-500/10 transition-colors"
                    title="تعديل البندل"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleDelete(bundle.id)}
                    className="p-1.5 rounded-xl text-red-600 hover:bg-red-500/10 transition-colors"
                    title="حذف البندل"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Middle: Image & Info */}
              <div className="flex gap-3 items-center">
                <div className="w-20 h-14 rounded-xl overflow-hidden bg-slate-900 shrink-0 border border-border/50">
                  {bundle.image ? (
                    <img
                      src={bundle.image}
                      alt={bundle.title}
                      className="w-full h-full object-cover"
                    />
                  ) : games[0]?.image ? (
                    <img
                      src={games[0].image}
                      alt={bundle.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <Gamepad2 className="w-5 h-5" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm text-foreground line-clamp-1">{bundle.title}</h4>
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                    {games.map((g) => g.title).join(", ") || "لا توجد ألعاب محددة"}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-black text-sm text-foreground">
                      {Number(bundle.price).toLocaleString()} د.ع
                    </span>
                    {bundle.originalPrice && bundle.originalPrice > bundle.price && (
                      <span className="text-[11px] line-through text-muted-foreground">
                        {Number(bundle.originalPrice).toLocaleString()} د.ع
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom: Stock & Fast Action */}
              <div className="pt-2 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground">
                <span>المخزون: {bundle.stock ?? 0}</span>
                {bundle.badge && (
                  <span className="text-[10px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-md">
                    {bundle.badge}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {filteredBundles.length === 0 && (
          <div className="col-span-full text-center py-12 bg-card rounded-3xl border border-border space-y-3">
            <Layers className="w-10 h-10 text-muted-foreground mx-auto" />
            <h3 className="font-bold text-sm text-foreground">لا توجد حزم حسابات مضافة</h3>
            <p className="text-xs text-muted-foreground">
              ابدأ بإنشاء أول بندل يضم مجموعة ألعاب بحساب واحد
            </p>
            <button
              onClick={handleStartCreate}
              className="px-4 py-2 rounded-xl bg-red-500 text-white font-bold text-xs hover:bg-red-600"
            >
              إنشاء بندل الآن
            </button>
          </div>
        )}
      </div>

      {/* Edit / Create Modal */}
      {editingBundle && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-card w-full max-w-3xl rounded-3xl border border-border shadow-2xl overflow-hidden my-8 max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-5 border-b border-border flex items-center justify-between bg-muted/20">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-red-500 text-white flex items-center justify-center">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-black text-base text-foreground">
                    {isCreating
                      ? "إنشاء بندل جديد"
                      : `تعديل البندل: ${editingBundle.titleEn || editingBundle.title}`}
                  </h3>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingBundle(null)}
                  className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Form Content */}
            <form
              onSubmit={handleSaveForm}
              className="p-6 overflow-y-auto space-y-5 flex-1 text-xs sm:text-sm"
            >
              <div>
                {/* Title EN */}
                <div className="space-y-1.5">
                  <label className="font-bold text-foreground block">
                    عنوان البندل (English) *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingBundle.titleEn || editingBundle.title || ""}
                    onChange={(e) =>
                      setEditingBundle({
                        ...editingBundle,
                        titleEn: e.target.value,
                        title: e.target.value,
                      })
                    }
                    placeholder="e.g. Mario Complete Bundle (3 Games)"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background focus:border-red-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Description EN */}
              <div className="space-y-1.5">
                <label className="font-bold text-foreground block">وصف البندل (English)</label>
                <textarea
                  rows={3}
                  value={editingBundle.descriptionEn || editingBundle.description || ""}
                  onChange={(e) =>
                    setEditingBundle({
                      ...editingBundle,
                      descriptionEn: e.target.value,
                      description: e.target.value,
                    })
                  }
                  placeholder="Enter bundle description in English..."
                  className="w-full px-3.5 py-2 rounded-xl border border-border bg-background focus:border-red-500 focus:outline-none resize-none"
                />
              </div>

              {/* Pricing & Stock & Account Type */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="font-bold text-foreground block">سعر البندل (د.ع) *</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={editingBundle.price}
                    onChange={(e) =>
                      setEditingBundle({ ...editingBundle, price: Number(e.target.value) })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background focus:border-red-500 focus:outline-none font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-foreground block">
                    السعر الأصلي (قبل الخصم)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editingBundle.originalPrice || ""}
                    onChange={(e) =>
                      setEditingBundle({ ...editingBundle, originalPrice: Number(e.target.value) })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background focus:border-red-500 focus:outline-none font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-foreground block">نوع الحساب</label>
                  <select
                    value={editingBundle.accountType || "primary"}
                    onChange={(e) =>
                      setEditingBundle({ ...editingBundle, accountType: e.target.value as any })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background focus:border-red-500 focus:outline-none"
                  >
                    <option value="primary">حساب رئيسي (Primary)</option>
                    <option value="secondary">حساب فرعي (Secondary)</option>
                    <option value="full">حساب كامل (Full Account)</option>
                    <option value="offline">حساب أوفلاين (Offline)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-foreground block">الكمية / المخزون</label>
                  <input
                    type="number"
                    min={0}
                    value={editingBundle.stock ?? 20}
                    onChange={(e) =>
                      setEditingBundle({ ...editingBundle, stock: Number(e.target.value) })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background focus:border-red-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Badge & Image */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="font-bold text-foreground block">شارة مميزة (Badge)</label>
                  <input
                    type="text"
                    value={editingBundle.badge || ""}
                    onChange={(e) => setEditingBundle({ ...editingBundle, badge: e.target.value })}
                    placeholder="مثال: الأكثر مبيعاً 🔥 أو توفير 40%"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background focus:border-red-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-foreground block">
                    رابط صورة البندل أو رفع صورة
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editingBundle.image || ""}
                      onChange={(e) =>
                        setEditingBundle({ ...editingBundle, image: e.target.value })
                      }
                      placeholder="https://..."
                      className="flex-1 px-3.5 py-2.5 rounded-xl border border-border bg-background focus:border-red-500 focus:outline-none"
                    />
                    <label className="p-2.5 rounded-xl bg-muted hover:bg-muted/80 cursor-pointer text-muted-foreground hover:text-foreground border border-border flex items-center justify-center shrink-0">
                      <Upload className="w-4 h-4" />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Interactive Game Picker (Crucial) */}
              <div className="p-4 rounded-2xl bg-muted/30 border border-border/80 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Gamepad2 className="w-5 h-5 text-red-500" />
                    <label className="font-bold text-foreground text-sm">
                      اختيار الألعاب المتضمنة في هذا البندل ({editingBundle.gameIds?.length || 0}{" "}
                      ألعاب مختارة)
                    </label>
                  </div>
                  {editingBundle.originalPrice ? (
                    <span className="text-xs text-muted-foreground">
                      مجموع أسعار الألعاب الفردية:{" "}
                      <strong className="text-foreground font-mono">
                        {Number(editingBundle.originalPrice).toLocaleString()} د.ع
                      </strong>
                    </span>
                  ) : null}
                </div>

                {/* Search in Games */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={gameSearch}
                    onChange={(e) => setGameSearch(e.target.value)}
                    placeholder="ابحث بالاسم العربي أو الإنجليزي — زيلدا، ماريو كارت، zelda..."
                    className="w-full pr-8 pl-3 py-1.5 text-xs bg-background rounded-xl border border-border focus:border-red-500 focus:outline-none"
                  />
                </div>

                {/*
                  What is actually being searched. An admin who could not find a
                  game had no way to tell whether it was missing from the shop or
                  merely missing from this list.
                */}
                <p
                  className={`text-[10px] ${catalogueFailed ? "font-bold text-amber-600" : "text-muted-foreground"}`}
                >
                  {/*
                    When the catalogue does not arrive this falls back to the
                    page it was handed, which is the reported bug again. It says
                    so rather than claiming to be searching the whole shop — an
                    admin who is told «not found» deserves to know which of the
                    two it means.
                  */}
                  {catalogueFailed
                    ? `تعذّر تحميل كامل الكتالوج — يُعرض ${pickerGames.length} منتجًا فقط من الصفحة المحمَّلة`
                    : catalogueLoading
                      ? "جارٍ تحميل كامل الكتالوج..."
                      : `البحث في ${pickerGames.length} منتجًا من كامل الكتالوج، بما فيها المخفية`}
                  {gameSearch.trim() ? ` — ${searchHits.length} نتيجة` : ""}
                  {filteredPickerGames.length > visiblePickerGames.length
                    ? ` (يُعرض أول ${visiblePickerGames.length}؛ اكتب للتضييق)`
                    : ""}
                </p>

                {/* Selected Games Chips */}
                {editingBundle.gameIds && editingBundle.gameIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 p-2 bg-background rounded-xl border border-border/60">
                    {editingBundle.gameIds.map((gameId) => {
                      const game = catalogue.find((p) => String(p.id) === String(gameId));
                      return (
                        <span
                          key={gameId}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/10 text-red-600 border border-red-500/20 text-xs font-bold"
                        >
                          <span>🎮 {game?.title || `لعبة #${gameId}`}</span>
                          <button
                            type="button"
                            onClick={() => toggleGameSelection(gameId)}
                            className="hover:text-red-800"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Available Games Scroll List */}
                {/* The scrollbar is kept: this list is now the whole catalogue,
                    and a hidden scrollbar on it reads as "that is all there is". */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto p-1">
                  {visiblePickerGames.map((game) => {
                    const isSelected = editingBundle.gameIds?.some(
                      (id) => String(id) === String(game.id),
                    );
                    return (
                      <div
                        key={game.id}
                        data-testid="picker-row"
                        data-id={String(game.id)}
                        onClick={() => toggleGameSelection(game.id)}
                        className={`p-2 rounded-xl border cursor-pointer flex items-center gap-2.5 transition-all ${
                          isSelected
                            ? "bg-red-500/10 border-red-500 text-foreground shadow-2xs"
                            : "bg-background hover:bg-muted/50 border-border text-muted-foreground"
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                            isSelected
                              ? "bg-red-500 border-red-500 text-white"
                              : "border-muted-foreground/40"
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>

                        <div className="w-8 h-10 rounded-md overflow-hidden bg-slate-800 shrink-0">
                          <NintendoCover
                            product={game as unknown as Record<string, unknown>}
                            usage="listing-card"
                            ratio={null}
                            alt={game.title}
                            className="w-full h-full"
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-xs truncate text-foreground">
                            {game.titleEn || game.title}
                          </p>
                          {/* The name the admin searched by, when it is not the one above. */}
                          {(game as { titleAr?: string }).titleAr &&
                          (game as { titleAr?: string }).titleAr !== (game.titleEn || game.title) ? (
                            <p className="text-[10px] text-muted-foreground truncate" dir="rtl">
                              {(game as { titleAr?: string }).titleAr}
                            </p>
                          ) : null}
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {game.price ? `${Number(game.price).toLocaleString()} د.ع` : "مجاني"}
                          </span>
                          {/* Shown, not hidden from the admin — but never as a surprise. */}
                          {isProductHidden(game) ? (
                            <span className="ms-1.5 inline-flex items-center rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                              مخفي
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {/*
                    About the search, not about the list: the games already in
                    the bundle stay pinned above, so counting them here would
                    turn "nothing matched" into silence.
                  */}
                  {gameSearch.trim() && searchHits.length === 0 && !catalogueLoading ? (
                    <p className="col-span-full py-6 text-center text-xs text-muted-foreground">
                      لا توجد لعبة تطابق «{gameSearch.trim()}»
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="pt-4 border-t border-border flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingBundle(null)}
                  className="px-4 py-2.5 rounded-xl border border-border font-bold text-xs hover:bg-muted text-muted-foreground transition-colors"
                >
                  إلغاء
                </button>

                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-xs shadow-sm hover:shadow-md transition-all cursor-pointer"
                >
                  {isCreating ? "إنشاء البندل وحفظه" : "حفظ التعديلات"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
