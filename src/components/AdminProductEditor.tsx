import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CanonicalGamePricing } from "./admin/CanonicalGameLink";

import { safeStringify } from "../utils/safeJson";
import { cdnImage } from "@/lib/img";
import { measureTrim } from "@/lib/imageTrim.browser";
import { isUsableImageUrl, TRIM_FIELDS } from "@/lib/nintendoImages";
import {
  CheckCircle2,
  CircleDashed,
  Plus,
  Trash2,
  Image as ImageIcon,
  ExternalLink,
  DollarSign,
  FileUp,
  Download,
  Gamepad2,
  Cpu,
  Sparkles,
  Headphones,
  CreditCard,
  RefreshCw,
  Layers,
  Package,
  ShieldCheck,
  Info,
  Calendar,
  Star,
  Tag,
  Tv,
  Check,
  Coins,
  Lock,
  Unlock,
  ArrowLeftRight,
  Search,
  Loader2,
  X,
  Link2,
} from "lucide-react";
import { toast } from "sonner";

import { boxContentsToText } from "@/lib/boxContentsText";
import { stepsToText, toStepList } from "@/lib/stepsText";
import AdminImportModal from "./admin/AdminImportModal";
import ProductImportModal from "./admin/ProductImportModal";
import { useTranslation } from "../i18n";
import { detectSchema, getSchema } from "../lib/productImport/registry";
import { applySchemaImportToForm } from "../lib/productImport/toProductForm";
import {
  SECTION_CATEGORY_ID,
  resolveCategoryType,
  schemaForSection,
  type CategoryType,
} from "../lib/productSection";

export { resolveCategoryType };
export type { CategoryType };
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../lib/utils";
import GlobalPriceTracker from "./GlobalPriceTracker";
import HubFields from "./admin/HubFields";
import { ImageUploadField } from "./admin/ImageUploadField";
import { StepsEditor } from "./admin/StepsEditor";
import {
  applyGameImportToForm,
  buildProductSavePayload,
  createBlankProductForm,
} from "@/lib/gameImportForm";
import {
  COVER_TEXTURE_FETCH_FAILED,
  COVER_TEXTURE_FIELD,
  COVER_TEXTURE_HELPER,
  mirrorCoverTextureSource,
  needsStorageMirror,
} from "@/lib/coverTexture";
import { ProductOptionsEditor } from "./admin/ProductOptionsEditor";
import { GamePerformanceEditor } from "./admin/GamePerformanceEditor";
import { HardwareAdminEditor } from "./admin/HardwareAdminEditor";
import { SchemaAdminEditor } from "./admin/SchemaAdminEditor";
import { useCurrency } from "../context/CurrencyContext";
import { productSupportsSwitch2, validateGameDevicePerformance } from "@/lib/devicePerformance";

export type CategoryDefinition = {
  type: CategoryType;
  labelAr: string;
  labelEn: string;
  icon: any;
  badgeBg: string;
  badgeText: string;
  borderColor: string;
  description: string;
};

// Non-empty tuple type so `CATEGORY_DEFINITIONS[0]` is a safe fallback.
export const CATEGORY_DEFINITIONS: [CategoryDefinition, ...CategoryDefinition[]] = [
  {
    type: "game",
    labelAr: "ألعاب نينتندو سويتش",
    labelEn: "Nintendo Switch Games",
    icon: Gamepad2,
    badgeBg: "bg-red-500/10 dark:bg-red-500/20",
    badgeText: "text-red-600 dark:text-red-400",
    borderColor: "border-red-500/30",
    description: "إضافة وتعديل ألعاب نينتندو مع المنصة، التقييم، الكارتلج والغلاف وتاريخ الإصدار",
  },
  {
    type: "hardware",
    labelAr: "قسم الهاردوير وملحقاتها",
    labelEn: "Hardware & Consoles",
    icon: Cpu,
    badgeBg: "bg-blue-500/10 dark:bg-blue-500/20",
    badgeText: "text-blue-600 dark:text-blue-400",
    borderColor: "border-blue-500/30",
    description: "إضافة وتعديل أجهزة سويتش وملحقات التشغيل، مواصفات الشاشة والبطارية والذاكرة",
  },
  {
    type: "amiibo",
    labelAr: "قسم المجسمات (Amiibo)",
    labelEn: "Amiibo & Collectibles",
    icon: Sparkles,
    badgeBg: "bg-purple-500/10 dark:bg-purple-500/20",
    badgeText: "text-purple-600 dark:text-purple-400",
    borderColor: "border-purple-500/30",
    description: "إضافة وتعديل مجسمات وبطاقات amiibo، بيانات الشخصية، السلسلة ومكافآت الألعاب",
  },
  {
    type: "accessory",
    labelAr: "قسم الإكسسوارات",
    labelEn: "Accessories",
    icon: Headphones,
    badgeBg: "bg-emerald-500/10 dark:bg-emerald-500/20",
    badgeText: "text-emerald-600 dark:text-emerald-400",
    borderColor: "border-emerald-500/30",
    description: "إضافة وتعديل إكسسوارات الحماية والشحن والتخزين وتوافق الأجهزة ومواد الصنع",
  },
  {
    type: "gift_card",
    labelAr: "قسم كروت التعبئة",
    labelEn: "Gift Cards & Top-up",
    icon: CreditCard,
    badgeBg: "bg-amber-500/10 dark:bg-amber-500/20",
    badgeText: "text-amber-600 dark:text-amber-400",
    borderColor: "border-amber-500/30",
    description: "إضافة وتعديل بطاقات نينتندو إي شوب واشتراكات الأونلاين وتحديد الريجون والتسليم",
  },
  {
    type: "used",
    labelAr: "قسم المستعمل",
    labelEn: "Used & Pre-owned",
    icon: RefreshCw,
    badgeBg: "bg-cyan-500/10 dark:bg-cyan-500/20",
    badgeText: "text-cyan-600 dark:text-cyan-400",
    borderColor: "border-cyan-500/30",
    description: "إضافة وتعديل القطع والأشرطة المستخدمة مع درجة النظافة، حالة العلبة والضمان",
  },
  {
    type: "bundle",
    labelAr: "قسم البندل",
    labelEn: "Account Bundles",
    icon: Layers,
    badgeBg: "bg-rose-500/10 dark:bg-rose-500/20",
    badgeText: "text-rose-600 dark:text-rose-400",
    borderColor: "border-rose-500/30",
    description: "إضافة وتعديل حزم وبندلات الحسابات مع تحديد نوع الوصول ونسبة التوفير المشمولة",
  },
];

export default function AdminProductEditor({
  product,
  categories = [],
  onSave,
  onCancel,
  initialCategoryId,
  hardwareProducts = [],
}: any) {
  const { convertFromIQD, usdIqdRate } = useCurrency();
  const { t } = useTranslation();

  const [formData, setFormData] = useState(() => {
    const generateId = () => "prd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    if (product) {
      const data = {
        id: product.id || generateId(),
        ...product,
        titleEn: product.titleEn || product.title || "",
        titleKu: product.titleKu || "",
        descriptionEn: product.descriptionEn || product.description || "",
        descriptionKu: product.descriptionKu || "",
        youtubeTrailer:
          product.youtubeTrailer || product.trailer_url || product.trailer?.youtubeUrl || "",
        releaseDate: product.releaseDate || product.release_date || "",
        ageRating: product.ageRating || product.age_rating || "",
        metacriticRating:
          product.metacriticRating || product.metacritic_rating || product.metacriticScore || "",
        category: product.category || product.categoryId,
        categoryId: product.category || product.categoryId,
        genres: product.genres || [],
        platform:
          product.platform ||
          product.switch_version ||
          (product.switch2?.isSwitch2Edition ? "switch2" : "switch1"),
        size:
          product.size ||
          (product.file_size_gb
            ? `${product.file_size_gb} GB`
            : product.gameSizeGb
              ? `${product.gameSizeGb} GB`
              : ""),
        numberOfPlayers:
          product.numberOfPlayers || product.number_of_players_text || product.players || "",
        supportedLanguages:
          product.supportedLanguages ||
          product.supported_languages_details ||
          (Array.isArray(product.supportedLanguages)
            ? product.supportedLanguages.join(", ")
            : product.supportedLanguages) ||
          "",
        // Hardware Specific
        hardwareModel: product.hardwareModel || product.model || "",
        colorEdition: product.colorEdition || product.color || "",
        storageCapacity: product.storageCapacity || product.storage || "",
        screenSpecs: product.screenSpecs || product.screen || "",
        batteryLife: product.batteryLife || product.battery || "",
        boxContents: Array.isArray(product.boxContents) ? product.boxContents : [],
        boxContentsText:
          boxContentsToText(product.boxContentsText) ||
          boxContentsToText(product.boxContents) ||
          boxContentsToText(product.includedItems) ||
          "",

        warrantyCondition:
          product.warrantyCondition ||
          [product.warranty, product.warrantyType].filter(Boolean).join(" — ") ||
          "",
        connectivity: product.connectivity || "",
        // Amiibo Specific
        characterName: product.characterName || product.character || "",
        amiiboSeries: product.amiiboSeries || product.series || "",
        figureType: product.figureType || "figure",
        inGameUnlock: product.inGameUnlock || product.unlockRewards || "",
        compatibleGames: product.compatibleGames || "",
        boxCondition: product.boxCondition || "mib",
        releaseWave: product.releaseWave || "",
        rarity: product.rarity || "standard",
        // Accessory Specific
        accessoryType: product.accessoryType || "",
        compatibleDevices: product.compatibleDevices || "",
        brand: product.brand || "Nintendo Official",
        material: product.material || "",
        availableColors: product.availableColors || "",
        keyFeatures: product.keyFeatures || "",
        // Gift Card Specific
        cardValue: product.cardValue || "",
        region: product.region || "US",
        cardType: product.cardType || "eshop",
        deliveryMethod: product.deliveryMethod || "instant_code",
        redemptionGuide:
          stepsToText(product.redemptionSteps) || stepsToText(product.redemptionGuide),
        redemptionSteps: toStepList(product.redemptionSteps ?? product.redemptionGuide),
        validity: product.validity || "no_expiry",
        // Used Specific
        usedType: product.usedType || "cartridge",
        conditionGrade: product.conditionGrade || "like_new",
        packaging: product.packaging || "cib",
        guaranteeStatus: product.guaranteeStatus || "tested_30days",
        conditionNotes: product.conditionNotes || "",
        // Bundle Specific
        accountType: product.accountType || "primary",
        badge: product.badge || "",
        bundleGamesSummary: product.bundleGamesSummary || "",
        // Common Options & Pricing
        options: (product.options || []).map((o: any, idx: number) => ({
          ...o,
          id: o.id && String(o.id).trim() ? String(o.id).trim() : `opt_${Date.now()}_${idx}`,
        })),
        types: (product.types || product.variants || []).map((t: any, idx: number) => ({
          ...t,
          id: t.id && String(t.id).trim() ? String(t.id).trim() : `typ_${Date.now()}_${idx}`,
        })),
        editions: product.editions || [],
        dlcs: product.dlcs || [],
        price: Number(product.price) || 0,
        cost: Number(product.cost) || 0,
        stock: Number(product.stock) || 0,
        isInfiniteStock: product.isInfiniteStock === true,
        // Absent on every product saved before hiding existed — those stay visible.
        isHidden: product.isHidden === true,
        displayOrder: Number(product.displayOrder) || 0,
        isActive: product.isActive !== false,
        status: product.status || "نشط",
        kind: product.kind || "account",
        // Trade & Store Bonus
        trade_value_iqd: Number(product.trade_value_iqd ?? product.tradePrice ?? 0),
        store_offer_bonus_iqd: Number(product.store_offer_bonus_iqd ?? product.storeBonus ?? 0),
        trade_enabled: product.trade_enabled !== undefined ? Boolean(product.trade_enabled) : true,
        trade_value_locked: Boolean(product.trade_value_locked),
        // Media
        /*
          The front-cover field only ever accepts front-cover sources. It used
          to fall back to `regionBanner`/`bannerImage`, so simply opening and
          saving a product wrote a wide banner into the canonical cover column
          — a data corruption that then propagated to every surface reading it.
        */
        cartridgeImage:
          product.cartridgeImage ||
          product.packagingFrontImage ||
          product.boxImage ||
          product.image ||
          "",
        cartridgeImageTrim: product.cartridgeImageTrim,
        /** Square artwork for compact cards. Never a cover; no cover fallback. */
        nintendoCardImage: product.nintendoCardImage || product.squareGameImage || "",
        /** Print-resolution cover for the 3D sleeve only. */
        coverHiResImage: product.coverHiResImage || "",
        coverImage:
          product.coverImage || product.cardArtwork || product.mainImage || product.image || "",
        bannerImages:
          Array.isArray(product.bannerImages) && product.bannerImages.length > 0
            ? product.bannerImages
            : product.banner
              ? [product.banner]
              : [""],
        gallery: Array.isArray(product.gallery) ? product.gallery : [],
        // Spread rawData to ensure all hub fields are available in state
        ...(product.rawData || {}),
      };
      return data;
    }

    const defaultCat = initialCategoryId || (categories[0] ? categories[0].id : "cat_nintendo");

    const blank = createBlankProductForm(defaultCat);
    if (!blank.id) blank.id = generateId();
    return blank;
  });

  const [isSaving, setIsSaving] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSchemaImport, setShowSchemaImport] = useState(false);
  /** Set when an imported wrap could not be pulled off its source host. */
  const [coverTextureError, setCoverTextureError] = useState<{ url: string } | null>(null);

  /*
    An imported "3D Texture Source" is a link to somebody else's server, and
    the archives that host printable wraps refuse plain server-side requests.
    Copy the file into our own storage right after the import, through the same
    endpoint the upload button uses, and keep the stored URL in the same field.

    A failure is reported at the field and the link is dropped: a URL the host
    will not serve is not a texture, and storing it produces the empty box this
    replaces. Nothing else about the imported game is affected.
  */
  const adoptCoverTextureSource = useCallback(async (sourceUrl: string) => {
    if (!needsStorageMirror(sourceUrl)) return;
    setCoverTextureError(null);
    const result = await mirrorCoverTextureSource(sourceUrl);
    setFormData((prev: any) => {
      if (prev[COVER_TEXTURE_FIELD] !== sourceUrl) return prev;
      return { ...prev, [COVER_TEXTURE_FIELD]: result.ok ? result.url : sourceUrl };
    });
    if (result.ok) {
      toast.success("تم تنزيل صورة 3D Texture Source وتخزينها");
    } else {
      setCoverTextureError({ url: sourceUrl });
      toast.error(`${COVER_TEXTURE_FETCH_FAILED} (${result.reason})`);
    }
  }, []);

  // Determine current active category
  const selectedCategoryObj = categories.find((c: any) => c.id === formData.category);
  const categoryType = resolveCategoryType(
    formData.category,
    selectedCategoryObj?.title,
    formData.kind,
  );

  const activeCategoryDef =
    CATEGORY_DEFINITIONS.find((def) => def.type === categoryType) || CATEGORY_DEFINITIONS[0];

  const isGameCategory = categoryType === "game";
  // The prior compact editor is retained below for compatibility/reference,
  // while the schema-driven tabbed editor is the active hardware surface.
  const showLegacyHardwareEditor = false;

  /*
    The Device Performance selector needs the hardware catalogue, but the
    dashboard hands over the paginated rows of whichever section is open —
    inside the games section that page holds no hardware at all, so the
    selector claimed no Hardware Product exists. When the passed list is
    empty, ask the endpoint for the hardware section directly.
  */
  const [fetchedHardware, setFetchedHardware] = useState<any[]>([]);
  const passedHardwareCount = hardwareProducts.length;
  useEffect(() => {
    if (categoryType !== "game" || passedHardwareCount > 0) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/admin/products?category=hardware&limit=100", {
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data: any = await res.json().catch(() => null);
        const items = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data?.products)
            ? data.products
            : [];
        if (!controller.signal.aborted && items.length) setFetchedHardware(items);
      } catch {
        // The selector keeps its "add a hardware product" hint as the fallback.
      }
    })();
    return () => controller.abort();
  }, [categoryType, passedHardwareCount]);
  const availableHardware = passedHardwareCount > 0 ? hardwareProducts : fetchedHardware;

  const activeSchema = schemaForSection(categoryType) || detectSchema(formData);

  /*
    Every section is always offered, even before the store has created its
    category row: picking one must switch the form, so the list is driven by the
    section definitions and only *matched* against the store's categories.
  */
  const sectionOptions = CATEGORY_DEFINITIONS.map((def) => {
    const existing = categories.find(
      (cat: any) => resolveCategoryType(cat.id, cat.title) === def.type,
    );
    let title = existing?.title ?? def.labelAr;
    if (def.type === "game" && (title.includes("الأكثر مبيع") || title.includes("Best Sellers"))) {
      title = def.labelEn;
    }
    return {
      def,
      id: existing?.id ?? SECTION_CATEGORY_ID[def.type],
      title,
    };
  });

  // Instruction fields are edited as an ordered list but stored both ways: the
  // array feeds the details page, the joined text keeps legacy readers working.
  const redemptionSteps = toStepList(formData.redemptionSteps ?? formData.redemptionGuide);
  const setRedemptionSteps = (steps: string[]) =>
    setFormData((prev: any) => ({
      ...prev,
      redemptionSteps: steps,
      redemptionGuide: steps.filter(Boolean).join("\n"),
    }));

  const handleChange = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  const [titleSuggestions, setTitleSuggestions] = useState<any[]>([]);
  const [titleSearching, setTitleSearching] = useState(false);
  const [showTitleDropdown, setShowTitleDropdown] = useState(false);
  const titleSearchTimeoutRef = useRef<any>(null);
  const titleDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (titleDropdownRef.current && !titleDropdownRef.current.contains(e.target as Node)) {
        setShowTitleDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (titleSearchTimeoutRef.current) clearTimeout(titleSearchTimeoutRef.current);
    };
  }, []);

  const handleTitleInputChange = (val: string) => {
    handleChange("titleEn", val);
    handleChange("title", val);

    if (titleSearchTimeoutRef.current) {
      clearTimeout(titleSearchTimeoutRef.current);
    }

    const term = val.trim();
    if (term.length < 2) {
      setTitleSuggestions([]);
      setShowTitleDropdown(false);
      return;
    }

    setShowTitleDropdown(true);
    setTitleSearching(true);
    titleSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/game-catalog?mode=search&q=${encodeURIComponent(term)}&limit=8`,
        );
        const data = await res.json();
        setTitleSuggestions(data.items || []);
      } catch {
        setTitleSuggestions([]);
      } finally {
        setTitleSearching(false);
      }
    }, 220);
  };

  const handleSelectGameSuggestion = (item: any) => {
    const canonicalTitle = item.canonical_name || item.title || "";
    handleChange("titleEn", canonicalTitle);
    handleChange("title", canonicalTitle);
    handleChange("game_id", item.game_id);

    if (item.trade_value_iqd !== undefined && item.trade_value_iqd !== null) {
      handleChange("trade_value_iqd", Number(item.trade_value_iqd) || 0);
    }
    if (item.store_offer_bonus_iqd !== undefined && item.store_offer_bonus_iqd !== null) {
      handleChange("store_offer_bonus_iqd", Number(item.store_offer_bonus_iqd) || 0);
    }
    if (item.trade_enabled !== undefined) {
      handleChange("trade_enabled", Boolean(item.trade_enabled));
    }
    if (item.trade_value_locked !== undefined) {
      handleChange("trade_value_locked", Boolean(item.trade_value_locked));
    }

    setShowTitleDropdown(false);
    toast.success(`تم ربط اللعبة "${canonicalTitle}" واعتماد أسعار المقايضة الرسمية`);
  };

  /** Links the product to a canonical game and pulls its live trade pricing. */
  const handleCanonicalLink = useCallback((game: CanonicalGamePricing) => {
    setFormData((prev: any) => ({
      ...prev,
      game_id: game.game_id,
      trade_value_iqd: game.trade_value_iqd,
      store_offer_bonus_iqd: game.store_offer_bonus_iqd,
      store_offer_total_iqd: game.trade_value_iqd + game.store_offer_bonus_iqd,
      trade_enabled: game.trade_enabled,
      trade_value_locked: game.trade_value_locked,
    }));
  }, []);

  const handleCanonicalUnlink = useCallback(() => {
    setFormData((prev: any) => ({ ...prev, game_id: "" }));
    toast.info("تم إلغاء الربط بالفهرس الرسمي");
  }, []);

  /** Persists trade pricing to the canonical catalog (shared across products). */
  const saveCanonicalPricing = async (data: any) => {
    if (!data.game_id) return;
    try {
      const res = await fetch("/api/game-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_price",
          game_id: data.game_id,
          trade_value_iqd: Number(data.trade_value_iqd) || 0,
          store_offer_bonus_iqd: Number(data.store_offer_bonus_iqd) || 0,
          trade_value_locked: Boolean(data.trade_value_locked),
          trade_enabled: data.trade_enabled !== false,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success("تم تحديث سعر المقايضة في الفهرس الرسمي");
    } catch {
      toast.error("تعذر حفظ سعر المقايضة في الفهرس الرسمي");
    }
  };

  const handleCategorySwitch = (catId: string) => {
    const catObj = categories.find((c: any) => c.id === catId);
    const newType = resolveCategoryType(catId, catObj?.title, formData.kind);

    let defaultKind = "account";
    if (newType === "hardware") defaultKind = "hardware";
    if (newType === "amiibo") defaultKind = "collectible";
    if (newType === "accessory") defaultKind = "accessory";
    if (newType === "gift_card") defaultKind = "digital_code";
    if (newType === "used") defaultKind = "used";
    if (newType === "bundle") defaultKind = "bundle";

    setFormData((prev: any) => ({
      ...prev,
      category: catId,
      categoryId: catId,
      kind: defaultKind,
    }));
  };

  const handleBannerImageChange = (index: number, value: string) => {
    const updated = [...(formData.bannerImages || [""])];
    updated[index] = value;
    setFormData((prev: any) => ({ ...prev, bannerImages: updated }));
  };

  const addBannerImage = () => {
    setFormData((prev: any) => ({
      ...prev,
      bannerImages: [...(prev.bannerImages || [""]), ""],
    }));
  };

  const removeBannerImage = (index: number) => {
    const updated = formData.bannerImages.filter((_: any, i: number) => i !== index);
    setFormData((prev: any) => ({
      ...prev,
      bannerImages: updated.length > 0 ? updated : [""],
    }));
  };

  const toggleGenre = (genre: string) => {
    const current = formData.genres || [];
    const updated = current.includes(genre)
      ? current.filter((g: string) => g !== genre)
      : [...current, genre];
    handleChange("genres", updated);
  };

  // Options Handlers
  const addOption = () => {
    const newOption = {
      id: "opt_" + Date.now(),
      name: "",
      price: "",
      cost: "",
    };
    setFormData((prev: any) => ({
      ...prev,
      options: [...(prev.options || []), newOption],
    }));
  };

  const updateOption = (id: string, field: string, value: any) => {
    setFormData((prev: any) => ({
      ...prev,
      options: (prev.options || []).map((o: any) => (o.id === id ? { ...o, [field]: value } : o)),
    }));
  };

  const removeOption = (id: string) => {
    setFormData((prev: any) => ({
      ...prev,
      options: (prev.options || []).map((o: any) => o.id !== id),
    }));
  };

  // Types Handlers
  const addType = () => {
    const newType = {
      id: "typ_" + Date.now(),
      name: "",
      optionId: "",
      price: "",
      cost: "",
    };
    setFormData((prev: any) => ({
      ...prev,
      types: [...(prev.types || []), newType],
    }));
  };

  const updateType = (id: string, field: string, value: any) => {
    setFormData((prev: any) => ({
      ...prev,
      types: (prev.types || []).map((t: any) => (t.id === id ? { ...t, [field]: value } : t)),
    }));
  };

  const removeType = (id: string) => {
    setFormData((prev: any) => ({
      ...prev,
      types: (prev.types || []).map((t: any) => t.id !== id),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    if (!formData.titleEn && !formData.title) {
      toast.error("يرجى إدخال اسم المنتج باللغة الإنجليزية");
      return;
    }

    if (isGameCategory) {
      const performanceIssues = validateGameDevicePerformance(formData);
      const blockingIssues = performanceIssues.filter((i) => i.severity === "error");
      if (blockingIssues.length) {
        toast.error(blockingIssues.map((issue) => issue.message).join("\n"), {
          duration: 9000,
        });
        return;
      }
    }

    const cleanedData: Record<string, any> = buildProductSavePayload(formData, activeSchema);

    /*
      Measure the cover once, here, and store the crop with the record.

      This is the import-time half of the normalisation: with
      `cartridgeImageTrim` present, every visitor gets the tight framing from
      the server-rendered HTML and no browser ever decodes the file to work it
      out. Products saved before this existed still render correctly — the
      storefront falls back to a cached client-side measurement.

      Failure here is not failure to save. Artwork framing is a presentation
      detail; losing the product edit over it would be absurd.
    */
    try {
      for (const [field, trimField] of Object.entries(TRIM_FIELDS)) {
        const url = cleanedData[field];
        if (!isUsableImageUrl(url)) {
          delete cleanedData[trimField];
          continue;
        }
        const record = await measureTrim(cdnImage(url));
        if (record?.trim) cleanedData[trimField] = record.trim;
        else delete cleanedData[trimField];
      }
    } catch (err) {
      console.warn("[AdminProductEditor] cover normalisation skipped", err);
    }

    try {
      setIsSaving(true);
      void saveCanonicalPricing(cleanedData);
      await onSave(cleanedData);
    } catch (err) {
      // onSave catches and toasts specific server error
      console.error("[AdminProductEditor:handleSubmit]", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-background min-h-screen pb-20 max-w-6xl mx-auto animate-in fade-in duration-300">
      {/* Top Header Bar */}
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur-md border-b border-border py-4 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center border",
              activeCategoryDef.badgeBg,
              activeCategoryDef.badgeText,
              activeCategoryDef.borderColor,
            )}
          >
            <activeCategoryDef.icon className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {product ? "تعديل المنتج / اللعبة" : "إضافة منتج جديد"}
            </h1>
            <p className="text-xs text-muted-foreground">{activeCategoryDef.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick Import Buttons */}
          <button
            type="button"
            onClick={() => {
              if (isGameCategory) {
                setShowImportModal(true);
              } else {
                setShowSchemaImport(true);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-lg border border-border transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>استيراد بيانات القسم ({activeCategoryDef.labelAr})</span>
          </button>

          {isGameCategory && (
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/10 hover:bg-red-600/20 text-red-600 dark:text-red-400 text-xs font-semibold rounded-lg border border-red-500/20 transition-colors"
            >
              <FileUp className="w-3.5 h-3.5" />
              <span>استيراد Nintendo eShop / قالب اللعبة</span>
            </button>
          )}

          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground bg-muted rounded-lg transition-colors"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className={cn(
              "px-5 py-1.5 text-xs font-bold rounded-lg transition-opacity flex items-center gap-1.5 shadow-sm",
              isSaving
                ? "opacity-60 cursor-not-allowed bg-muted text-muted-foreground"
                : "text-white bg-foreground text-background hover:opacity-90 cursor-pointer",
            )}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>جاري الحفظ...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>حفظ المنتج</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Category Selector Pills */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm mb-6">
        <label className="block text-xs font-bold text-foreground mb-2.5">
          حدد القسم المطلوب (يتغير نموذج الإضافة والحقول المطلوبة تلقائياً حسب القسم):
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
          {sectionOptions.map(({ def, id, title }) => {
            const isSelected = categoryType === def.type;

            return (
              <button
                key={id}
                type="button"
                onClick={() => handleCategorySwitch(id)}
                className={cn(
                  "flex flex-col items-center text-center p-2.5 rounded-xl border transition-all relative",
                  isSelected
                    ? cn(def.badgeBg, def.badgeText, "border-current shadow-sm ring-1 ring-current")
                    : "bg-muted/40 hover:bg-muted text-muted-foreground border-border",
                )}
              >
                <def.icon className="w-4 h-4 mb-1" />
                <span className="text-xs font-bold leading-tight">{title}</span>
                <span className="text-[10px] opacity-75 mt-0.5">{def.labelEn}</span>
                {isSelected && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-current" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic English Product Information */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Tag className="w-4 h-4 text-primary" />
              البيانات الأساسية للمنتج (Basic Information)
            </h2>
            <span className="text-xs bg-muted text-muted-foreground px-2.5 py-1 rounded-full font-medium">
              اللغة الإنجليزية القياسية
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2 relative" ref={titleDropdownRef}>
              <label className="block text-xs font-bold text-foreground mb-1">
                اسم المنتج / العنوان باللغة الإنجليزية (Product Title - English):
                <span className="text-red-500 mr-1">*</span>
              </label>
              <div className="relative">
                <input
                  required
                  type="text"
                  className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background font-medium pl-8"
                  value={formData.titleEn || formData.title || ""}
                  onChange={(e) => handleTitleInputChange(e.target.value)}
                  onFocus={() => {
                    if (titleSuggestions.length > 0) setShowTitleDropdown(true);
                  }}
                  placeholder={
                    categoryType === "hardware"
                      ? "e.g., Nintendo Switch - OLED Model White Set"
                      : categoryType === "amiibo"
                        ? "e.g., amiibo Link (Tears of the Kingdom)"
                        : categoryType === "accessory"
                          ? "e.g., SanDisk 256GB microSDXC-Card for Nintendo Switch"
                          : categoryType === "gift_card"
                            ? "e.g., Nintendo eShop $50 Gift Card [Digital Code]"
                            : categoryType === "used"
                              ? "e.g., Super Mario Odyssey (Pre-owned Game Cartridge)"
                              : categoryType === "bundle"
                                ? "e.g., Ultimate Zelda & Mario 4-in-1 Account Bundle"
                                : "e.g., The Legend of Zelda: Tears of the Kingdom"
                  }
                />
                {titleSearching && (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground absolute left-3 top-2.5" />
                )}
              </div>

              {/* Autocomplete Dropdown */}
              {showTitleDropdown && (titleSuggestions.length > 0 || titleSearching) && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-xl overflow-hidden max-h-72 overflow-y-auto">
                  <div className="p-2 bg-muted/40 border-b border-border text-[11px] font-bold text-muted-foreground flex items-center justify-between">
                    <span>نتائج الفهرس الرسمي لألعاب نينتندو ({titleSuggestions.length})</span>
                    <button
                      type="button"
                      onClick={() => setShowTitleDropdown(false)}
                      className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {titleSuggestions.map((item) => (
                    <button
                      key={item.game_id || item.title}
                      type="button"
                      onClick={() => handleSelectGameSuggestion(item)}
                      className="w-full text-start p-3 hover:bg-muted/60 transition-colors border-b border-border/50 last:border-0 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-foreground truncate">
                          {item.canonical_name || item.title}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                          {item.switch_version && (
                            <span className="bg-primary/10 text-primary px-1.5 py-0.2 rounded font-medium">
                              {item.switch_version}
                            </span>
                          )}
                          <span>ID: {item.game_id}</span>
                        </div>
                      </div>

                      <div className="text-end shrink-0">
                        <div className="text-xs font-bold text-amber-600 dark:text-amber-400">
                          {Number(item.trade_value_iqd || 0).toLocaleString()} د.ع
                        </div>
                        {Number(item.store_offer_bonus_iqd || 0) > 0 && (
                          <div className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                            +{Number(item.store_offer_bonus_iqd).toLocaleString()} مكافأة متجر
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Connected Game Status Banner */}
              {formData.game_id ? (
                <div className="mt-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div>
                      <span className="font-bold text-emerald-800 dark:text-emerald-300">
                        مرتبط بفهرس اللعبة الرسمي:
                      </span>{" "}
                      <span className="font-semibold text-foreground">
                        {formData.titleEn || formData.title}
                      </span>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                        <span>
                          المقايضة:{" "}
                          <strong className="text-foreground">
                            {Number(formData.trade_value_iqd || 0).toLocaleString()} د.ع
                          </strong>
                        </span>
                        <span>
                          مكافأة المتجر:{" "}
                          <strong className="text-emerald-600 dark:text-emerald-400">
                            +{Number(formData.store_offer_bonus_iqd || 0).toLocaleString()} د.ع
                          </strong>
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCanonicalUnlink}
                    className="text-[11px] font-bold text-red-500 hover:bg-red-500/10 px-2 py-1 rounded-lg border border-red-500/20 transition-colors"
                  >
                    إلغاء الربط
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-1">
                  عند كتابة اسم اللعبة، سيظهر لك اقتراح للربط المباشر مع الفهرس الرسمي وتطبيق أسعار
                  المقايضة ورصيد المتجر تلقائياً.
                </p>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-foreground mb-1">
                Slug / الرابط المختصر
              </label>
              <input
                type="text"
                dir="ltr"
                className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background font-mono"
                value={formData.slug || ""}
                onChange={(e) => handleChange("slug", e.target.value)}
                placeholder="سيتم إنشاؤه تلقائيًا من الاسم إذا ترك فارغًا..."
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                يستخدم في الرابط (مثل /product/the-legend-of-zelda). استخدم حروف إنجليزية وشرطات (-)
                فقط.
              </p>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-foreground mb-1">
                الوصف باللغة الإنجليزية (Description - English):
              </label>
              <textarea
                rows={4}
                className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                value={formData.descriptionEn || formData.description || ""}
                onChange={(e) => {
                  handleChange("descriptionEn", e.target.value);
                  handleChange("description", e.target.value);
                }}
                placeholder="Enter detailed English product description, features, and key specifications..."
              />
            </div>
          </div>
        </div>

        {/* Dynamic Category Specific Sections */}
        {/* ========================================================================= */}
        {/* 1. NINTENDO SWITCH GAMES SECTION */}
        {/* ========================================================================= */}
        {categoryType === "game" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Game Specs */}
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Gamepad2 className="w-4 h-4 text-red-500" />
                  مواصفات وتفاصيل اللعبة (Game & Platform Details)
                </h2>
                <span className="text-xs bg-red-500/10 text-red-600 dark:text-red-400 px-2.5 py-0.5 rounded-full font-bold">
                  Nintendo Switch Game
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Platform */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    المنصة المدعومة (Platform):
                  </label>
                  <select
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.platform}
                    onChange={(e) => handleChange("platform", e.target.value)}
                  >
                    <option value="switch1">Nintendo Switch 1</option>
                    <option value="switch2">Nintendo Switch 2 (Switch 2 Edition)</option>
                    <option value="both">Switch 1 & Switch 2 (Dual Edition)</option>
                  </select>
                </div>

                {/* Release Date */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-red-500" />
                    تاريخ الإصدار (Release Date):
                    <span className="text-[10px] text-muted-foreground font-normal">
                      (أساس ترتيب الأحدث)
                    </span>
                  </label>
                  <input
                    type="date"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background font-medium"
                    value={formData.releaseDate || ""}
                    onChange={(e) => handleChange("releaseDate", e.target.value)}
                  />
                </div>

                {/* Metacritic Rating */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1 flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 text-amber-500" />
                    تقييم ميتاكريتيك (Metacritic Score 0-100):
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background font-bold"
                    value={formData.metacriticRating || ""}
                    onChange={(e) => handleChange("metacriticRating", e.target.value)}
                    placeholder="92"
                  />
                </div>

                {/* Age Rating */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    التصنيف العمري (Age Rating):
                  </label>
                  <select
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.ageRating || "PEGI 7"}
                    onChange={(e) => handleChange("ageRating", e.target.value)}
                  >
                    <option value="PEGI 3">PEGI 3 (لجميع الأعمار)</option>
                    <option value="PEGI 7">PEGI 7 (+7 سنوات)</option>
                    <option value="PEGI 12">PEGI 12 (+12 سنة)</option>
                    <option value="PEGI 16">PEGI 16 (+16 سنة)</option>
                    <option value="PEGI 18">PEGI 18 (+18 للبالغين)</option>
                    <option value="ESRB E">ESRB E (Everyone)</option>
                    <option value="ESRB E10+">ESRB E10+ (+10)</option>
                    <option value="ESRB T">ESRB T (Teen +13)</option>
                    <option value="ESRB M">ESRB M (Mature +17)</option>
                  </select>
                </div>

                {/* Game Size */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    حجم اللعبة (Game Size):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.size || ""}
                    onChange={(e) => handleChange("size", e.target.value)}
                    placeholder="18.2 GB"
                  />
                </div>

                {/* Number of Players */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    عدد اللاعبين (Number of Players):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.numberOfPlayers || ""}
                    onChange={(e) => handleChange("numberOfPlayers", e.target.value)}
                    placeholder="1-4 Players Local / Online"
                  />
                </div>

                {/* Supported Languages */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-foreground mb-1">
                    اللغات المدعومة (Supported Languages):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.supportedLanguages || ""}
                    onChange={(e) => handleChange("supportedLanguages", e.target.value)}
                    placeholder="English, Japanese, French, Spanish, German, Italian, Traditional Chinese"
                  />
                </div>

                {/* YouTube Trailer */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    رابط فيديو التريلر (YouTube Trailer URL):
                  </label>
                  <input
                    type="url"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.youtubeTrailer || ""}
                    onChange={(e) => handleChange("youtubeTrailer", e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </div>
              </div>

              {/* Genres Multi-select */}
              <div className="pt-3 border-t border-border">
                <label className="block text-xs font-bold text-foreground mb-2">
                  تصنيفات ونوع اللعبة (Game Genres):
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Action",
                    "Adventure",
                    "RPG",
                    "Platformer",
                    "Puzzle",
                    "Racing",
                    "Sports",
                    "Fighting",
                    "Strategy",
                    "Family",
                    "Horror",
                    "Metroidvania",
                    "Roguelike",
                    "Visual Novel",
                    "Music / Rhythm",
                    "Simulation",
                  ].map((genre) => {
                    const isSelected = (formData.genres || []).includes(genre);
                    return (
                      <button
                        key={genre}
                        type="button"
                        onClick={() => toggleGenre(genre)}
                        className={cn(
                          "px-3 py-1 rounded-full text-xs font-semibold transition-all border",
                          isSelected
                            ? "bg-red-500 text-white border-red-500 shadow-sm"
                            : "bg-muted hover:bg-muted/80 text-muted-foreground border-border",
                        )}
                      >
                        {genre} {isSelected && "✓"}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Game Media */}
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2 border-b border-border pb-3">
                <ImageIcon className="w-4 h-4 text-red-500" />
                وسائط وصور اللعبة من التخزين والجهاز (Game Media & Graphics)
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/*
                  The canonical front cover. Same database column as before
                  (`cartridgeImage`), with its meaning pinned down: a clean
                  rectangular front box cover. Every Nintendo surface reads this
                  through `resolveNintendoImage` — see src/lib/nintendoImages.ts.
                */}
                <ImageUploadField
                  productId={formData.id}
                  imageType="front"
                  label="غلاف العلبة الأمامي (Front Box Cover)"
                  value={formData.cartridgeImage || ""}
                  onChange={(url) => handleChange("cartridgeImage", url)}
                  aspect="cartridge"
                  folder="cartridges"
                  helperText="الصورة الأساسية: علبة أمامية مستطيلة عمودية بدقة عالية. تظهر في الرئيسية، البندلات، السلة وصفحة المنتج. تُقصّ الهوامش البيضاء تلقائياً."
                />

                {/*
                  Separate field, separate meaning: square artwork for the
                  compact cartridge cards only. Never a substitute for the cover.
                */}
                <ImageUploadField
                  productId={formData.id}
                  imageType="square"
                  label="صورة مربعة للبطاقات المصغّرة (Square Card Image)"
                  value={formData.nintendoCardImage || ""}
                  onChange={(url) => handleChange("nintendoCardImage", url)}
                  aspect="square"
                  folder="cards"
                  helperText="اختيارية. تُستخدم فقط في بطاقات الكارتلج المربّعة، وليست بديلاً عن غلاف العلبة."
                />

                {/*
                  The full printable case wrap — Back Cover + Spine + Front
                  Cover in one image — sampled across the three faces of the 3D
                  sleeve. Stored whole, never cropped, never a front cover on
                  its own. See src/lib/coverTexture.ts.
                */}
                <ImageUploadField
                  productId={formData.id}
                  imageType="3d-texture"
                  label="غلاف بدقة عالية للمجسم ثلاثي الأبعاد (3D Texture Source)"
                  value={formData.coverHiResImage || ""}
                  onChange={(url) => {
                    setCoverTextureError(null);
                    handleChange("coverHiResImage", url);
                  }}
                  aspect="cartridge"
                  folder="cartridges"
                  helperText={`اختيارية. ${COVER_TEXTURE_HELPER}`}
                  error={coverTextureError ? COVER_TEXTURE_FETCH_FAILED : undefined}
                  errorDetail={coverTextureError?.url}
                />

                {/* Cover Image */}
                <ImageUploadField
                  productId={formData.id}
                  imageType="cover"
                  label="صورة الغلاف للتفاصيل (Cover Image)"
                  value={formData.coverImage || ""}
                  onChange={(url) => handleChange("coverImage", url)}
                  aspect="square"
                  folder="covers"
                  helperText="الغلاف الرئيسي الذي يظهر في صفحة تفاصيل اللعبة."
                />

                {/* Banner Images */}
                <div className="md:col-span-2 space-y-3 pt-2 border-t border-border/60">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-foreground">
                      صور البنر الترويجي والمعرض (Banner Images):
                    </label>
                    <button
                      type="button"
                      onClick={addBannerImage}
                      className="text-xs text-red-500 hover:text-red-600 font-bold flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> إضافة صورة بنر
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(formData.bannerImages || [""]).map((banner: string, idx: number) => (
                      <div
                        key={idx}
                        className="relative bg-muted/20 p-2.5 rounded-xl border border-border"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-bold text-muted-foreground">
                            بنر #{idx + 1}
                          </span>
                          {formData.bannerImages.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeBannerImage(idx)}
                              className="text-red-500 hover:text-red-600 p-1"
                              title="حذف هذا البنر"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <ImageUploadField
                          productId={formData.id}
                          imageType={"banner-" + idx}
                          label=""
                          value={banner}
                          onChange={(url) => handleBannerImageChange(idx, url)}
                          aspect="banner"
                          folder="banners"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Trade-In Valuation & Store Credit Card */}
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Coins className="w-4 h-4 text-amber-500" />
                  تسعير المقايضة ورصيد المتجر (Nintendo Trade-In & Store Bonus)
                </h2>
                <span className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2.5 py-0.5 rounded-full font-bold">
                  نظام المقايضة في العراق
                </span>
              </div>

              {formData.game_id ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex items-start gap-3">
                  <Coins className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <p className="font-bold text-foreground">
                      مرتبط رسمياً بالفهرس المعتمد عبر حقل العنوان الأساسي
                    </p>
                    <p className="text-muted-foreground text-[11px]">
                      تُطبَّق هذه الأسعار على كل المنتجات المرتبطة بنفس اللعبة وصفحة استبدال
                      الأقراص.
                      {formData.trade_value_source && (
                        <span>
                          {" "}
                          (المصدر: {String(formData.trade_value_source)}
                          {formData.trade_value_updated_at
                            ? ` — آخر تحديث: ${String(formData.trade_value_updated_at).slice(0, 10)}`
                            : ""}
                          )
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-muted/40 border border-border rounded-xl p-3.5 flex items-start gap-3 text-xs text-muted-foreground">
                  <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  <p>
                    يمكنك ربط اللعبة تلقائياً بكتابة اسمها في الحقل الأساسي{" "}
                    <strong className="text-foreground">
                      اسم المنتج / العنوان باللغة الإنجليزية
                    </strong>{" "}
                    أعلاه، أو إدخال أسعار المقايضة ورصيد المتجر يدوياً هنا.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Base Trade Value */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    القيمة الأساسية للمقايضة (د.ع):
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background font-bold"
                    value={formData.trade_value_iqd ?? ""}
                    onChange={(e) => handleChange("trade_value_iqd", Number(e.target.value))}
                    placeholder="25000"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    القيمة النقدية المعتمدة لاستبدال هذا الشريط.
                  </p>
                </div>

                {/* Store Offer Bonus */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1 flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <Sparkles className="w-3.5 h-3.5" />
                    مكافأة رصيد المتجر الإضافية (د.ع):
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="500"
                    className="w-full border border-emerald-500/40 focus:border-emerald-500 rounded-lg px-3 py-2 text-sm outline-none bg-background font-bold text-emerald-600 dark:text-emerald-400"
                    value={formData.store_offer_bonus_iqd ?? ""}
                    onChange={(e) => handleChange("store_offer_bonus_iqd", Number(e.target.value))}
                    placeholder="5000"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    رصيد إضافي يحصل عليه العميل عند شراء منتجات من المتجر.
                  </p>
                </div>

                {/* Total Store Credit Summary */}
                <div className="bg-muted/30 border border-border rounded-xl p-3 flex flex-col justify-center">
                  <span className="text-[11px] text-muted-foreground font-bold">
                    إجمالي رصيد المتجر للعميل:
                  </span>
                  <div className="text-lg font-black text-foreground mt-0.5">
                    {(
                      Number(formData.trade_value_iqd || 0) +
                      Number(formData.store_offer_bonus_iqd || 0)
                    ).toLocaleString()}{" "}
                    <span className="text-xs text-muted-foreground">د.ع</span>
                  </div>
                </div>
              </div>

              {/* Switches: Lock & Enabled */}
              <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-border">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.trade_enabled !== false}
                    onChange={(e) => handleChange("trade_enabled", e.target.checked)}
                    className="w-4 h-4 rounded text-primary"
                  />
                  <span className="text-xs font-bold text-foreground">
                    تفعيل المقايضة لهذه اللعبة (Enable Trade-In)
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(formData.trade_value_locked)}
                    onChange={(e) => handleChange("trade_value_locked", e.target.checked)}
                    className="w-4 h-4 rounded text-primary"
                  />
                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5" />
                    قفل السعر وتثبيته ضد التحديث التلقائي (Lock Valuation)
                  </span>
                </label>
              </div>
            </div>
          </motion.div>
        )}

        {categoryType === "game" && (
          <GamePerformanceEditor
            value={formData.devicePerformance}
            platform={formData.platform}
            requiresSwitch2={productSupportsSwitch2(formData)}
            hardwareProducts={availableHardware}
            onChange={(records) => handleChange("devicePerformance", records)}
          />
        )}

        {/* ========================================================================= */}
        {/* 2. HARDWARE & CONSOLES SECTION */}
        {/* ========================================================================= */}
        {categoryType === "hardware" && (
          <HardwareAdminEditor value={formData} onChange={setFormData} />
        )}

        {/*
          Every non-game section gets the full schema as a collapsible form.

          The curated blocks above stay: they are the fields an admin edits
          daily, laid out by hand. This is the rest of the template — the two
          hundred fields the import file can carry — grouped by the schema's own
          headings, filtered to the product's own type, and badged so it is
          visible which groups still need work without opening all of them.
          Hardware keeps its dedicated editor above rather than getting two.
        */}
        {categoryType !== "game" && categoryType !== "hardware" && activeSchema && (
          <SchemaAdminEditor schema={activeSchema} value={formData} onChange={setFormData} />
        )}

        {categoryType === "hardware" && showLegacyHardwareEditor && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-blue-500" />
                  مواصفات جهاز الهاردوير ومحتويات العلبة (Hardware Specifications)
                </h2>
                <span className="text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2.5 py-0.5 rounded-full font-bold">
                  Hardware & Consoles
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Model */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    موديل الجهاز (Console / Model):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.hardwareModel || ""}
                    onChange={(e) => handleChange("hardwareModel", e.target.value)}
                    placeholder="Nintendo Switch OLED Model"
                  />
                </div>

                {/* Color & Edition */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    اللون أو طبعة الإصدار (Color / Special Edition):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.colorEdition || ""}
                    onChange={(e) => handleChange("colorEdition", e.target.value)}
                    placeholder="White OLED / Neon Red & Blue / Mario Red"
                  />
                </div>

                {/* Storage Capacity */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    سعة التخزين الداخلية (Internal Storage):
                  </label>
                  <select
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.storageCapacity || ""}
                    onChange={(e) => handleChange("storageCapacity", e.target.value)}
                  >
                    <option value="">— غير محدد —</option>
                    <option value="32 GB">32 GB (Switch Standard / Lite)</option>
                    <option value="64 GB">64 GB (Switch OLED)</option>
                    <option value="256 GB">256 GB (Switch 2 / Extended)</option>
                    <option value="512 GB">512 GB (High Capacity)</option>
                    <option value="1 TB">1 TB (Max Storage)</option>
                    {formData.storageCapacity &&
                    !["32 GB", "64 GB", "256 GB", "512 GB", "1 TB"].includes(
                      formData.storageCapacity,
                    ) ? (
                      <option value={formData.storageCapacity}>{formData.storageCapacity}</option>
                    ) : null}
                  </select>
                </div>

                {/* Screen Specs */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    مواصفات الشاشة (Screen Specs):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.screenSpecs || ""}
                    onChange={(e) => handleChange("screenSpecs", e.target.value)}
                    placeholder="7.0-inch OLED (1280x720) Touchscreen"
                  />
                </div>

                {/* Battery Life */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    عمر وسعة البطارية (Battery Life & Capacity):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.batteryLife || ""}
                    onChange={(e) => handleChange("batteryLife", e.target.value)}
                    placeholder="4.5 – 9.0 Hours (4310 mAh)"
                  />
                </div>

                {/* Warranty & Condition */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    الضمان والحالة (Warranty & Guarantee):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.warrantyCondition || ""}
                    onChange={(e) => handleChange("warrantyCondition", e.target.value)}
                    placeholder="جديد 100% بالكرتون مع ضمان سنة كاملة"
                  />
                </div>

                {/* Included in Box */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-foreground mb-1">
                    محتويات العلبة (Included In Box):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={boxContentsToText(formData.boxContents)}
                    onChange={(e) => handleChange("boxContents", e.target.value)}
                    placeholder="Nintendo Switch Console, Joy-Con (L/R), Dock, Joy-Con Grip, AC Adapter, HDMI Cable"
                  />
                </div>

                {/* Connectivity & Ports */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    المنافذ والاتصال (Ports & Connectivity):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.connectivity || ""}
                    onChange={(e) => handleChange("connectivity", e.target.value)}
                    placeholder="Wi-Fi 6, Bluetooth 5.0, LAN Port, HDMI 2.0, USB Type-C"
                  />
                </div>
              </div>
            </div>

            {/* Hardware Media */}
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2 border-b border-border pb-3">
                <ImageIcon className="w-4 h-4 text-blue-500" />
                صور جهاز الهاردوير والكرتون (Hardware Media)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ImageUploadField
                  productId={formData.id}
                  imageType="hardware-main"
                  label="صورة الجهاز الأساسية (Main Console Image)"
                  value={formData.coverImage || ""}
                  onChange={(url) => handleChange("coverImage", url)}
                  aspect="square"
                  folder="hardware"
                  helperText="الصورة الأساسية للجهاز في صفحة المنتج."
                />
                <ImageUploadField
                  productId={formData.id}
                  imageType="hardware-box"
                  label="صورة كرتون التغليف أو الملحقات (Box Package Art)"
                  value={formData.cartridgeImage || ""}
                  onChange={(url) => handleChange("cartridgeImage", url)}
                  aspect="square"
                  folder="hardware"
                  helperText="صورة علبة التغليف أو ملحقات العلبة."
                />
              </div>
            </div>
          </motion.div>
        )}

        {/* ========================================================================= */}
        {/* 3. AMIIBO & COLLECTIBLES SECTION */}
        {/* ========================================================================= */}
        {categoryType === "amiibo" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-500" />
                  بيانات ومواصفات مجسم Amiibo (Amiibo Details & Rewards)
                </h2>
                <span className="text-xs bg-purple-500/10 text-purple-600 dark:text-purple-400 px-2.5 py-0.5 rounded-full font-bold">
                  Amiibo & Collectibles
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Character Name */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    اسم الشخصية (Character Name):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.characterName || ""}
                    onChange={(e) => handleChange("characterName", e.target.value)}
                    placeholder="Link / Mario / Zelda / Samus / Sephiroth"
                  />
                </div>

                {/* Series */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    سلسلة المجسم (Amiibo Series):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.amiiboSeries || ""}
                    onChange={(e) => handleChange("amiiboSeries", e.target.value)}
                    placeholder="Super Smash Bros. / The Legend of Zelda / Super Mario"
                  />
                </div>

                {/* Figure Type */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    نوع المنتج (Item Type):
                  </label>
                  <select
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.figureType || "figure"}
                    onChange={(e) => handleChange("figureType", e.target.value)}
                  >
                    <option value="figure">مجسم ثلاثي الأبعاد (Figure)</option>
                    <option value="card">بطاقة NFC مدمجة (Amiibo Card)</option>
                    <option value="yarn">مجسم صوفي ناعم (Yarn Plush Amiibo)</option>
                    <option value="band">سوار ذكي (Power-Up Band)</option>
                  </select>
                </div>

                {/* Packaging Condition */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    حالة التغليف (Box Condition):
                  </label>
                  <select
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.boxCondition || "mib"}
                    onChange={(e) => handleChange("boxCondition", e.target.value)}
                  >
                    <option value="mib">مغلف أصلي جديد بالكرتون (Mint In Box - MIB)</option>
                    <option value="loose">مفتوح بدون كرتون (Loose Mint Condition)</option>
                  </select>
                </div>

                {/* Release Wave */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    موجة الإصدار (Release Wave / Year):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.releaseWave || ""}
                    onChange={(e) => handleChange("releaseWave", e.target.value)}
                    placeholder="Wave 1 / Official 2024 Restock"
                  />
                </div>

                {/* Rarity */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    مستوى الندرة (Rarity Level):
                  </label>
                  <select
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.rarity || "standard"}
                    onChange={(e) => handleChange("rarity", e.target.value)}
                  >
                    <option value="standard">إصدار قياسي متوفر (Standard)</option>
                    <option value="rare">نادر ومطلوب (Rare / Hard to Find)</option>
                    <option value="limited">إصدار محدود / حصري (Limited Edition)</option>
                  </select>
                </div>

                {/* In-Game Unlock Rewards */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-foreground mb-1">
                    المكافآت داخل الألعاب (In-Game Unlocks & Rewards):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.inGameUnlock || ""}
                    onChange={(e) => handleChange("inGameUnlock", e.target.value)}
                    placeholder="فتح ملابس وأسلحة حصرية، شخصية تدريب ذكاء اصطناعي، باراشوت وأزياء نادرة"
                  />
                </div>

                {/* Compatible Games */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    الألعاب المتوافقة (Compatible Games):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.compatibleGames || ""}
                    onChange={(e) => handleChange("compatibleGames", e.target.value)}
                    placeholder="Smash Ultimate, Tears of the Kingdom, Mario Kart 8"
                  />
                </div>
              </div>
            </div>

            {/* Amiibo Media */}
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2 border-b border-border pb-3">
                <ImageIcon className="w-4 h-4 text-purple-500" />
                صور مجسم Amiibo والتغليف (Amiibo Media)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ImageUploadField
                  productId={formData.id}
                  imageType="amiibo-main"
                  label="صورة المجسم الأساسية (Main Figure Image)"
                  value={formData.coverImage || ""}
                  onChange={(url) => handleChange("coverImage", url)}
                  aspect="square"
                  folder="amiibo"
                  helperText="صورة مجسم Amiibo عالية الدقة."
                />
                <ImageUploadField
                  productId={formData.id}
                  imageType="amiibo-box"
                  label="صورة المكافأة داخل اللعبة أو العلبة (In-Game Reward / Box)"
                  value={formData.cartridgeImage || ""}
                  onChange={(url) => handleChange("cartridgeImage", url)}
                  aspect="square"
                  folder="amiibo"
                  helperText="صورة كرتون Amiibo أو معاينة المكافأة."
                />
              </div>
            </div>
          </motion.div>
        )}

        {/* ========================================================================= */}
        {/* 4. ACCESSORIES SECTION */}
        {/* ========================================================================= */}
        {categoryType === "accessory" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Headphones className="w-4 h-4 text-emerald-500" />
                  مواصفات وتوافق الإكسسوار (Accessory Details)
                </h2>
                <span className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2.5 py-0.5 rounded-full font-bold">
                  Accessories
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Accessory Type */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    نوع الإكسسوار (Accessory Type):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.accessoryType || ""}
                    onChange={(e) => handleChange("accessoryType", e.target.value)}
                    placeholder="حقيبة حماية / قاعدة شحن / حامي شاشة / بطاقة ذاكرة"
                  />
                </div>

                {/* Compatible Devices */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    الأجهزة المتوافقة (Compatible Devices):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.compatibleDevices || ""}
                    onChange={(e) => handleChange("compatibleDevices", e.target.value)}
                    placeholder="Nintendo Switch OLED / Switch V2 / Switch Lite / Switch 2"
                  />
                </div>

                {/* Brand / Manufacturer */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    الشركة المصنعة / الماركة (Brand):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.brand || ""}
                    onChange={(e) => handleChange("brand", e.target.value)}
                    placeholder="Nintendo Official / 8BitDo / HORI / PowerA / SanDisk"
                  />
                </div>

                {/* Material & Protection */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    مادة الصنع ومستوى الحماية (Material & Build):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.material || ""}
                    onChange={(e) => handleChange("material", e.target.value)}
                    placeholder="Hard EVA Shockproof Shell / 9H Tempered Glass"
                  />
                </div>

                {/* Available Colors */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    الألوان المتوفرة (Available Colors):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.availableColors || ""}
                    onChange={(e) => handleChange("availableColors", e.target.value)}
                    placeholder="Black, White, Neon Blue/Red, Clear Transparent"
                  />
                </div>

                {/* Key Features */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    المزايا البارزة (Key Highlights):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.keyFeatures || ""}
                    onChange={(e) => handleChange("keyFeatures", e.target.value)}
                    placeholder="مقاوم للصدمات والماء، يتسع لـ 10 أشرطة، سرعة قراءة 150MB/s"
                  />
                </div>
              </div>
            </div>

            {/* Accessory Media */}
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2 border-b border-border pb-3">
                <ImageIcon className="w-4 h-4 text-emerald-500" />
                صور الإكسسوار (Accessory Media)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ImageUploadField
                  productId={formData.id}
                  imageType="accessory-main"
                  label="الصورة الأساسية للإكسسوار (Main Product Image)"
                  value={formData.coverImage || ""}
                  onChange={(url) => handleChange("coverImage", url)}
                  aspect="square"
                  folder="accessories"
                  helperText="الصورة الأساسية للإكسسوار في العرض والبطاقة."
                />
                <ImageUploadField
                  productId={formData.id}
                  imageType="accessory-fitted"
                  label="صورة الزوايا أو أثناء الاستخدام (Fitted / In-Use Image)"
                  value={formData.cartridgeImage || ""}
                  onChange={(url) => handleChange("cartridgeImage", url)}
                  aspect="square"
                  folder="accessories"
                  helperText="صورة للإكسسوار بزاوية أخرى أو وهو مستخدم."
                />
              </div>
            </div>
          </motion.div>
        )}

        {/* ========================================================================= */}
        {/* 5. GIFT CARDS & DIGITAL CODE SECTION */}
        {/* ========================================================================= */}
        {categoryType === "gift_card" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-amber-500" />
                  مواصفات بطاقة التعبئة والاشتراك (Gift Card & eShop Details)
                </h2>
                <span className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2.5 py-0.5 rounded-full font-bold">
                  Gift Cards & Top-up
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Denomination / Value */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    قيمة الرصيد / البطاقة (Card Value / Denomination):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background font-bold"
                    value={formData.cardValue || ""}
                    onChange={(e) => handleChange("cardValue", e.target.value)}
                    placeholder="$10 / $20 / $50 / 12 Months NSO"
                  />
                </div>

                {/* Region */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    ريجون المتجر (Store Region):
                  </label>
                  <select
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.region || "US"}
                    onChange={(e) => handleChange("region", e.target.value)}
                  >
                    <option value="US">🇺🇸 المتجر الأمريكي (US eShop)</option>
                    <option value="UK">🇬🇧 المتجر البريطاني (UK eShop)</option>
                    <option value="JP">🇯🇵 المتجر الياباني (JP eShop)</option>
                    <option value="EU">🇪🇺 المتجر الأوروبي (EU eShop)</option>
                    <option value="Global">🌐 عالمي (Global / Multi-region)</option>
                  </select>
                </div>

                {/* Card Type */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    نوع الخدمة (Card Type):
                  </label>
                  <select
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.cardType || "eshop"}
                    onChange={(e) => handleChange("cardType", e.target.value)}
                  >
                    <option value="eshop">رصيد محفظة eShop Balance</option>
                    <option value="nso_individual">اشتراك Nintendo Switch Online (فردي)</option>
                    <option value="nso_family">اشتراك Nintendo Switch Online (عائلي)</option>
                    <option value="nso_expansion">حزمة التوسعة Expansion Pack</option>
                  </select>
                </div>

                {/* Delivery Method */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    طريقة التسليم (Delivery Method):
                  </label>
                  <select
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.deliveryMethod || "instant_code"}
                    onChange={(e) => handleChange("deliveryMethod", e.target.value)}
                  >
                    <option value="instant_code">كود رقمي فوري (Instant Digital Code)</option>
                    <option value="direct_recharge">شحن مباشر في الحساب</option>
                  </select>
                </div>

                {/* Validity */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    الصلاحية (Validity & Expiry):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.validity || "no_expiry"}
                    onChange={(e) => handleChange("validity", e.target.value)}
                    placeholder="لا تنتهي الصلاحية (No Expiration Date)"
                  />
                </div>

                {/* How to Redeem Steps */}
                <div className="sm:col-span-3">
                  <label className="block text-xs font-bold text-foreground mb-2">
                    خطوات التفعيل والشحن للمستخدم (How to Redeem Instructions):
                  </label>
                  <StepsEditor
                    steps={redemptionSteps}
                    onChange={setRedemptionSteps}
                    placeholder="مثال: افتح متجر Nintendo eShop"
                  />
                </div>
              </div>
            </div>

            {/* Gift Card Media */}
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2 border-b border-border pb-3">
                <ImageIcon className="w-4 h-4 text-amber-500" />
                صورة كرت التعبئة والبانر (Gift Card Artwork)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ImageUploadField
                  productId={formData.id}
                  imageType="giftcard-main"
                  label="صورة بطاقة الشحن (Card Artwork)"
                  value={formData.coverImage || formData.cardArtwork || formData.mainImage || ""}
                  onChange={(url) => handleChange("coverImage", url)}
                  aspect="square"
                  folder="giftcards"
                  helperText="صورة بطاقة التعبئة والقيمة المالية."
                />
                {/*
                  A wide region banner, which is not a front box cover — it used
                  to be written into `cartridgeImage` and so appeared wherever a
                  cover was expected. It has its own key now; the read still
                  falls back to the old column so existing gift cards keep
                  rendering.
                */}
                <ImageUploadField
                  productId={formData.id}
                  imageType="giftcard-banner"
                  label="بانر الريجون التوضيحي (Region Banner)"
                  value={
                    formData.regionBanner || formData.bannerImage || formData.cartridgeImage || ""
                  }
                  onChange={(url) => handleChange("regionBanner", url)}
                  aspect="banner"
                  folder="giftcards"
                  helperText="شعار الدولة أو الريجون التابع للبطاقة."
                />
              </div>
            </div>
          </motion.div>
        )}

        {/* ========================================================================= */}
        {/* 6. USED & PRE-OWNED SECTION */}
        {/* ========================================================================= */}
        {categoryType === "used" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-cyan-500" />
                  تفاصيل وحالة القطعة المستخدمة (Used & Pre-owned Details)
                </h2>
                <span className="text-xs bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 px-2.5 py-0.5 rounded-full font-bold">
                  Used & Pre-owned
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Item Type */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    نوع القطعة المستخدمة (Item Type):
                  </label>
                  <select
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.usedType || "cartridge"}
                    onChange={(e) => handleChange("usedType", e.target.value)}
                  >
                    <option value="cartridge">شريط لعبة مستعمل (Used Game Cartridge)</option>
                    <option value="console">جهاز سويتش مستعمل (Used Console)</option>
                    <option value="controller">
                      يد تحكم جوي كون / برو مستعملة (Used Controller)
                    </option>
                    <option value="dock_accessory">
                      دوك أو ملحق مستعمل (Used Accessory / Dock)
                    </option>
                  </select>
                </div>

                {/* Condition Grade */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    درجة النظافة والحالة (Condition Grade):
                  </label>
                  <select
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background font-semibold"
                    value={formData.conditionGrade || "like_new"}
                    onChange={(e) => handleChange("conditionGrade", e.target.value)}
                  >
                    <option value="like_new">10/10 كالجديد تماماً بدون أي خدش (Like New)</option>
                    <option value="excellent">9/10 ممتاز مع استخدام طفيف جداً (Excellent)</option>
                    <option value="very_good">8/10 جيد جداً يعمل بكفاءة 100% (Very Good)</option>
                    <option value="acceptable">
                      7/10 مقبول مع آثار استخدام واضحة (Acceptable)
                    </option>
                  </select>
                </div>

                {/* Packaging & Box */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    حالة العلبة والملحقات (Box & Packaging):
                  </label>
                  <select
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.packaging || "cib"}
                    onChange={(e) => handleChange("packaging", e.target.value)}
                  >
                    <option value="cib">كامل مع العلبة والغلاف الأصلي (Complete In Box)</option>
                    <option value="cartridge_only">الشريط فقط بدون علبة (Cartridge Only)</option>
                    <option value="generic_case">علبة حماية بديلة</option>
                  </select>
                </div>

                {/* Testing & Guarantee */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    الفحص والضمان (Testing & Guarantee):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.guaranteeStatus || ""}
                    onChange={(e) => handleChange("guaranteeStatus", e.target.value)}
                    placeholder="تم الفحص والاختبار 100% مع ضمان استبدال 30 يوم"
                  />
                </div>

                {/* Inspection Notes */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-foreground mb-1">
                    ملاحظات الفحص الفيزيائي (Physical Inspection Notes):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.conditionNotes || ""}
                    onChange={(e) => handleChange("conditionNotes", e.target.value)}
                    placeholder="تم تنظيف ونفخ منافذ التوصيل، اختبار البطارية ومفاتيح التحكم، لا يوجد انجراف للأنالوج"
                  />
                </div>
              </div>
            </div>

            {/* Used Item Real Photos */}
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2 border-b border-border pb-3">
                <ImageIcon className="w-4 h-4 text-cyan-500" />
                الصور الحقيقية للقطعة المستخدمة (Real Product Photos)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ImageUploadField
                  productId={formData.id}
                  imageType="used-front"
                  label="صورة حقيقية للشريط أو الجهاز من الأمام (Real Front Photo)"
                  value={formData.coverImage || ""}
                  onChange={(url) => handleChange("coverImage", url)}
                  aspect="square"
                  folder="used"
                  helperText="صورة حقيقية تبرز النظافة والواجهة الأمامية للقطعة."
                />
                <ImageUploadField
                  productId={formData.id}
                  imageType="used-back"
                  label="صورة حقيقية للعلبة أو الخلف (Real Back / Box Photo)"
                  value={formData.cartridgeImage || ""}
                  onChange={(url) => handleChange("cartridgeImage", url)}
                  aspect="square"
                  folder="used"
                  helperText="صورة العلبة أو ظهر الشريط أو السيريال."
                />
              </div>
            </div>
          </motion.div>
        )}

        {/* ========================================================================= */}
        {/* 7. ACCOUNT BUNDLES SECTION */}
        {/* ========================================================================= */}
        {categoryType === "bundle" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Layers className="w-4 h-4 text-rose-500" />
                  مواصفات حزمة وبندل الحسابات (Bundle Details)
                </h2>
                <span className="text-xs bg-rose-500/10 text-rose-600 dark:text-rose-400 px-2.5 py-0.5 rounded-full font-bold">
                  Account Bundles
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Account Access Type */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    نوع الحساب (Account Access Type):
                  </label>
                  <select
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background font-semibold"
                    value={formData.accountType || "primary"}
                    onChange={(e) => handleChange("accountType", e.target.value)}
                  >
                    <option value="primary">حساب رئيسي (Primary Account - Full Play)</option>
                    <option value="secondary">حساب فرعي (Secondary Account)</option>
                    <option value="offline">حساب أوفلاين (Offline Account)</option>
                    <option value="full_access">وصول كامل مع الإيميل (Full Access)</option>
                  </select>
                </div>

                {/* Savings Badge */}
                <div>
                  <label className="block text-xs font-bold text-foreground mb-1">
                    بادج التوفير الترويجي (Savings Badge):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background font-bold text-rose-500"
                    value={formData.badge || ""}
                    onChange={(e) => handleChange("badge", e.target.value)}
                    placeholder="وفر 40% / أفضل قيمة"
                  />
                </div>

                {/* Included Games Summary */}
                <div className="sm:col-span-3">
                  <label className="block text-xs font-bold text-foreground mb-1">
                    الألعاب المشمولة في الحزمة (Included Games Summary):
                  </label>
                  <input
                    type="text"
                    className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                    value={formData.bundleGamesSummary || ""}
                    onChange={(e) => handleChange("bundleGamesSummary", e.target.value)}
                    placeholder="Mario Odyssey + Zelda Breath of the Wild + Mario Kart 8 Deluxe"
                  />
                </div>
              </div>
            </div>

            {/* Bundle Media */}
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2 border-b border-border pb-3">
                <ImageIcon className="w-4 h-4 text-rose-500" />
                صور وبانر البندل (Bundle Media)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ImageUploadField
                  productId={formData.id}
                  imageType="bundle-main"
                  label="بانر البندل الرئيسي (Main Bundle Poster)"
                  value={formData.coverImage || ""}
                  onChange={(url) => handleChange("coverImage", url)}
                  aspect="banner"
                  folder="bundles"
                  helperText="بانر عريض يوضح بوستر الحزمة وتشكيلة الألعاب."
                />
                <ImageUploadField
                  productId={formData.id}
                  imageType="bundle-thumb"
                  label="صورة الغلاف المصغر (Bundle Thumbnail)"
                  value={formData.cartridgeImage || ""}
                  onChange={(url) => handleChange("cartridgeImage", url)}
                  aspect="square"
                  folder="bundles"
                  helperText="صورة المربع أو الغلاف المصغر للأيقونة."
                />
              </div>
            </div>
          </motion.div>
        )}

        {/* ========================================================================= */}
        {/* COMMON PRICING, STOCK, & FINANCIALS */}
        {/* ========================================================================= */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              التسعير، التكلفة والمخزون (Pricing & Inventory)
            </h2>
            <span className="text-xs text-muted-foreground font-medium">
              1 USD = {usdIqdRate.toLocaleString()} د.ع
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Price IQD */}
            <div>
              <label className="block text-xs font-bold text-foreground mb-1">
                سعر البيع بالدينار العراقي (د.ع):
                <span className="text-red-500 mr-1">*</span>
              </label>
              <div className="relative">
                <input
                  required
                  type="number"
                  step="250"
                  className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background font-bold text-emerald-600 dark:text-emerald-400"
                  value={formData.price || ""}
                  onChange={(e) => handleChange("price", parseFloat(e.target.value) || 0)}
                  placeholder="25000"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                  د.ع
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                <DollarSign className="w-3 h-3 text-emerald-500" />
                <span>
                  يعادل: <b>${convertFromIQD(formData.price || 0, "USD").toFixed(2)} USD</b>
                </span>
              </p>
            </div>

            {/* Cost IQD */}
            <div>
              <label className="block text-xs font-bold text-foreground mb-1">
                تكلفة الشراء بالدينار (د.ع):
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="250"
                  className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                  value={formData.cost || ""}
                  onChange={(e) => handleChange("cost", parseFloat(e.target.value) || 0)}
                  placeholder="18000"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                  د.ع
                </span>
              </div>
              {formData.price > 0 && formData.cost > 0 && (
                <p className="text-[11px] text-emerald-600 font-semibold mt-1">
                  صافي الربح: {(formData.price - formData.cost).toLocaleString()} د.ع
                </p>
              )}
            </div>

            {/* Stock */}
            <div>
              <label className="block text-xs font-bold text-foreground mb-1">
                المخزون المتوفر:
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  disabled={formData.isInfiniteStock}
                  className="flex-1 border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background disabled:opacity-50"
                  value={
                    formData.isInfiniteStock
                      ? "∞"
                      : formData.stock === undefined || formData.stock === null
                        ? ""
                        : formData.stock
                  }
                  onChange={(e) =>
                    handleChange("stock", e.target.value === "" ? 0 : parseInt(e.target.value) || 0)
                  }
                  placeholder="5"
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.isInfiniteStock}
                    onChange={(e) => handleChange("isInfiniteStock", e.target.checked)}
                    className="rounded border-border"
                  />
                  غير نهائي
                </label>
              </div>
            </div>

            {/* Hidden from customers */}
            <div>
              <label className="block text-xs font-bold text-foreground mb-1">ظهور المنتج:</label>
              <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formData.isHidden === true}
                  onChange={(e) => handleChange("isHidden", e.target.checked)}
                  className="rounded border-border"
                />
                <span className="font-bold">إخفاء المنتج عن المستخدمين</span>
              </label>
              <p className="text-[11px] text-muted-foreground mt-1">
                {formData.isHidden
                  ? "المنتج ظاهر في لوحة الإدارة فقط. أزل الإخفاء واحفظ لنشره."
                  : "المنتج ظاهر لجميع المستخدمين."}
              </p>
              {/*
                Said before the save rather than after it. The server refuses
                the same four things; this is so an admin knows why before they
                spend a click finding out.
              */}
              {formData.isHidden && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  لن يُنشر بدون: اسم، سعر أعلى من التكلفة، صورة واحدة، ووصف لا يقل عن ٤٠ حرفاً.
                </p>
              )}
            </div>

            {/* Display Order */}
            <div>
              <label className="block text-xs font-bold text-foreground mb-1">
                ترتيب العرض (Order):
              </label>
              <input
                type="number"
                className="w-full border border-border focus:border-foreground rounded-lg px-3 py-2 text-sm outline-none bg-background"
                value={
                  formData.displayOrder === undefined || formData.displayOrder === null
                    ? 0
                    : formData.displayOrder
                }
                onChange={(e) =>
                  handleChange(
                    "displayOrder",
                    e.target.value === "" ? 0 : parseInt(e.target.value) || 0,
                  )
                }
              />
            </div>
          </div>
        </div>

        {/* Options & Variants Editor */}
        <ProductOptionsEditor
          options={formData.options || []}
          onOptionsChange={(newOptions) => handleChange("options", newOptions)}
          types={formData.types || []}
          onTypesChange={(newTypes) => handleChange("types", newTypes)}
          basePrice={Number(formData.price) || 0}
          baseCost={Number(formData.cost) || 0}
        />

        {/* Dynamic Hub Page Fields - Only for Nintendo Switch Games */}
        {isGameCategory && <HubFields formData={formData} onChange={handleChange} />}

        {/* PricesAPI.io Global Price Tracker for Games */}
        {formData.title && isGameCategory && (
          <div className="pt-2">
            <GlobalPriceTracker productTitle={formData.title} />
          </div>
        )}

        {/* Bottom Action Footer */}
        <div className="sticky bottom-0 z-20 bg-background/90 backdrop-blur-md border-t border-border py-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2 rounded-lg font-bold text-xs text-muted-foreground bg-muted hover:bg-muted/80 transition-colors"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className={cn(
              "px-8 py-2 rounded-lg font-bold text-xs transition-opacity flex items-center gap-1.5 shadow-md",
              isSaving
                ? "opacity-60 cursor-not-allowed bg-muted text-muted-foreground"
                : "text-white bg-foreground text-background hover:opacity-90 cursor-pointer",
            )}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>جاري الحفظ...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>حفظ المنتج في {activeCategoryDef.labelAr}</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Import Modals */}
      {showImportModal && (
        <AdminImportModal
          onClose={() => setShowImportModal(false)}
          onImport={(importedData) => {
            setFormData((prev: any) => applyGameImportToForm(prev, importedData));
            setShowImportModal(false);
            toast.success("تم استيراد بيانات اللعبة بنجاح");
            const wrap = (importedData as Record<string, unknown>)[COVER_TEXTURE_FIELD];
            if (typeof wrap === "string") void adoptCoverTextureSource(wrap);
          }}
        />
      )}

      {showSchemaImport && activeSchema && (
        <ProductImportModal
          schema={activeSchema}
          onClose={() => setShowSchemaImport(false)}
          onImport={(result) => {
            setFormData((prev: any) => applySchemaImportToForm(prev, result, activeSchema));
            setShowSchemaImport(false);
            toast.success(t("admin.import.success"));
          }}
        />
      )}
    </div>
  );
}
