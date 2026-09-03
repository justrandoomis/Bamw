/**
 * The single-game import pipeline, factored out of the product editor.
 *
 * The editor screen and the ZIP batch importer must produce byte-identical
 * products from the same template file, so the three steps between "the parser
 * returned this" and "the save endpoint receives that" live here rather than
 * inside a component: the blank form a new product starts from, the mapping of
 * parsed fields onto it, and the payload assembled at save time. The parser
 * itself is untouched — this module never reads a template.
 */
import { boxContentsToText } from "./boxContentsText";
import { toStepList } from "./stepsText";
import { safeRandomUUID } from "./polyfills";
import { parseGameImport } from "./gameImportParser";
import { normalizeGameDevicePerformance } from "./devicePerformance";
import { parseProductImport } from "./productImport/parser";
import { buildQualityReport, type QualityReport } from "./productImport/quality";
import { applySchemaImportToForm } from "./productImport/toProductForm";
import type { ProductSchema } from "./productImport/types";
import { demandTierFor } from "./nintendoDemandTiers";
import {
  customerOptionName,
  customerTypeName,
  mapSupplierCosts,
  normalizeNintendoAccountPricing,
  priceGame,
  type AccountKind,
  type ContentKind,
  type Platform,
} from "./nintendoPricing";

/** The state a brand new product form starts with. */
export function createBlankProductForm(defaultCategoryId: string): Record<string, any> {
  return {
    title: "",
    titleEn: "",
    titleKu: "",
    slug: "",
    description: "",
    descriptionEn: "",
    descriptionKu: "",
    cartridgeImage: "",
    nintendoCardImage: "",
    coverHiResImage: "",
    coverImage: "",
    bannerImages: [""],
    gallery: [],
    youtubeTrailer: "",
    releaseDate: new Date().toISOString().split("T")[0],
    ageRating: "PEGI 7",
    metacriticRating: "85",
    genres: ["Adventure", "Action"],
    platform: "switch1",
    size: "8.5 GB",
    numberOfPlayers: "1 Player",
    supportedLanguages: "English, Japanese, French, Spanish, German",
    // Hardware — intentionally blank: these are real product specs, never demo text.
    hardwareModel: "",
    colorEdition: "",
    storageCapacity: "",
    screenSpecs: "",
    batteryLife: "",
    boxContents: [],
    boxContentsText: "",
    warrantyCondition: "",
    connectivity: "",
    // Amiibo
    characterName: "Link",
    amiiboSeries: "The Legend of Zelda",
    figureType: "figure",
    inGameUnlock: "فتح زي أسطوري وأسلحة نادرة داخل لعبة Tears of the Kingdom",
    compatibleGames: "Super Smash Bros. Ultimate, Zelda: Tears of the Kingdom, Mario Kart 8",
    boxCondition: "mib",
    releaseWave: "Wave 2 (Restock)",
    rarity: "standard",
    // Accessory
    accessoryType: "حقيبة حماية وتنقل Carry Case",
    compatibleDevices: "Nintendo Switch OLED / Switch V2 / Switch Lite",
    brand: "Nintendo Official",
    material: "Hard EVA Shockproof Shell",
    availableColors: "Black, Neon Red/Blue, White",
    keyFeatures: "مقاوم للصدمات والماء، يتسع لـ 10 أشرطة ألعاب، مقبض مريح",
    // Gift Card
    cardValue: "$20 eShop Balance",
    region: "US",
    cardType: "eshop",
    deliveryMethod: "instant_code",
    redemptionGuide: "",
    redemptionSteps: [],
    validity: "no_expiry",
    // Used
    usedType: "cartridge",
    conditionGrade: "like_new",
    packaging: "cib",
    guaranteeStatus: "tested_30days",
    conditionNotes: "تم الفحص والتعقيم 100%، عمل مثالي بدون أي خدوش أو مشاكل",
    // Bundle
    accountType: "primary",
    badge: "وفر 40%",
    bundleGamesSummary: "حزمة ألعاب مختارة بحساب كامل وجاهز",
    // Common
    price: 25000,
    cost: 18000,
    stock: 5,
    isInfiniteStock: false,
    // Visible to customers unless an admin (or the batch importer) hides it.
    isHidden: false,
    displayOrder: 0,
    category: defaultCategoryId,
    categoryId: defaultCategoryId,
    categoryEn: "",
    categoryKu: "",
    options: [],
    types: [],
    editions: [],
    dlcs: [],
    isActive: true,
    status: "نشط",
    kind: "account",
    // Trade & Store Bonus
    trade_value_iqd: 0,
    store_offer_bonus_iqd: 0,
    trade_enabled: true,
    trade_value_locked: false,
    id: `prd_${safeRandomUUID().replace(/-/g, "").slice(0, 16)}`,
  };
}

/**
 * Folds parsed template data onto a product form.
 *
 * Values the template did not carry are left alone, so importing into a
 * half-filled form only ever adds to it.
 */
export function applyGameImportToForm(
  prev: Record<string, any>,
  importedData: Record<string, any>,
): Record<string, any> {
  const newData: Record<string, any> = { ...prev };
  Object.entries(importedData).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      newData[key] = value;
    }
  });

  // Ensure options have unique ids
  if (Array.isArray(newData.options)) {
    newData.options = newData.options.filter(Boolean).map((opt: any, idx: number) => ({
      ...opt,
      id: opt.id && String(opt.id).trim() ? String(opt.id).trim() : `opt_${Date.now()}_${idx}`,
    }));
  }

  // An imported template fills `variants`; the panel edits `types`.
  if (
    (!Array.isArray(newData.types) || newData.types.length === 0) &&
    Array.isArray(newData.variants) &&
    newData.variants.length > 0
  ) {
    newData.types = newData.variants;
  }

  // Ensure types have unique ids
  if (Array.isArray(newData.types)) {
    newData.types = newData.types.filter(Boolean).map((t: any, idx: number) => ({
      ...t,
      id: t.id && String(t.id).trim() ? String(t.id).trim() : `typ_${Date.now()}_${idx}`,
    }));
  } else if (Array.isArray(newData.variants)) {
    newData.types = newData.variants.filter(Boolean).map((t: any, idx: number) => ({
      ...t,
      id: t.id && String(t.id).trim() ? String(t.id).trim() : `typ_${Date.now()}_${idx}`,
    }));
  }

  if (!newData.category || newData.category === "nintendo_switch_games") {
    newData.category = "cat_nintendo";
  }

  if (newData.boxContents !== undefined) {
    if (Array.isArray(newData.boxContents)) newData.boxContentsList = newData.boxContents;
    newData.boxContentsText = boxContentsToText(newData.boxContents);
  }
  const importedSteps = toStepList(newData.redemptionSteps ?? newData.redemptionGuide);
  if (importedSteps.length) {
    newData.redemptionSteps = importedSteps;
    newData.redemptionGuide = importedSteps.join("\n");
  }

  if (!newData.coverImage) {
    newData.coverImage = newData.cardArtwork || newData.mainImage || prev.coverImage || "";
  }
  // Front-cover sources only. A banner is never promoted here.
  if (!newData.cartridgeImage) {
    newData.cartridgeImage =
      newData.packagingFrontImage || newData.boxImage || prev.cartridgeImage || "";
  }

  return newData;
}

/** The product body the save endpoint expects, assembled from a filled form. */
export function buildProductSavePayload(
  formData: Record<string, any>,
  activeSchema?: { id?: string; kind?: string },
): Record<string, any> {
  const normalizedFormData = normalizeNintendoAccountPricing(formData);
  const stableId =
    normalizedFormData.id || `prd_${safeRandomUUID().replace(/-/g, "").slice(0, 16)}`;
  const selectedCategoryId =
    normalizedFormData.categoryId || normalizedFormData.category || "cat_nintendo";

  const cleanedData = { ...normalizedFormData };

  // Remove UI state and massive fields
  const ignoreKeys = ["files", "previewData", "blob", "blobs", "file", "dataUrl"];
  for (const key of Object.keys(cleanedData)) {
    if (
      ignoreKeys.includes(key) ||
      typeof cleanedData[key] === "function" ||
      cleanedData[key] instanceof File
    ) {
      delete cleanedData[key];
    } else if (
      typeof cleanedData[key] === "string" &&
      (cleanedData[key].startsWith("data:image/") || cleanedData[key].startsWith("blob:"))
    ) {
      delete cleanedData[key]; // Do not send base64 or blob strings!
    }
  }

  // Clean nested images in gallery or bannerImages
  if (Array.isArray(cleanedData.gallery)) {
    cleanedData.gallery = cleanedData.gallery.filter(
      (img: any) =>
        typeof img === "string" && !img.startsWith("data:image/") && !img.startsWith("blob:"),
    );
  }
  if (Array.isArray(cleanedData.bannerImages)) {
    cleanedData.bannerImages = cleanedData.bannerImages.filter(
      (img: any) =>
        typeof img === "string" && !img.startsWith("data:image/") && !img.startsWith("blob:"),
    );
  }

  /*
    One performance record, owned by the platform's device. Import templates
    can carry two legacy device blocks; the save payload never does. The
    hardware link resolves again server-side against the live catalogue.
  */
  if (cleanedData.devicePerformance || cleanedData.device_performance) {
    cleanedData.devicePerformance = normalizeGameDevicePerformance(cleanedData);
    delete cleanedData.device_performance;
  }

  return {
    ...cleanedData,
    id: stableId,
    category: selectedCategoryId,
    categoryId: selectedCategoryId,
    title: normalizedFormData.titleEn || normalizedFormData.title,
    titleEn: normalizedFormData.titleEn || normalizedFormData.title,
    description: normalizedFormData.descriptionEn || normalizedFormData.description || "",
    descriptionEn: normalizedFormData.descriptionEn || normalizedFormData.description || "",
    price: Number(normalizedFormData.price) || 0,
    cost: Number(normalizedFormData.cost) || 0,
    stock: normalizedFormData.isInfiniteStock ? 999999 : Number(normalizedFormData.stock) || 0,
    displayOrder: Number(normalizedFormData.displayOrder) || 0,
    image:
      normalizedFormData.coverImage ||
      normalizedFormData.cartridgeImage ||
      normalizedFormData.image ||
      "",
    banner: normalizedFormData.bannerImages?.[0] || normalizedFormData.banner || "",
    nintendoCardImage: normalizedFormData.nintendoCardImage || "",
    coverHiResImage: normalizedFormData.coverHiResImage || "",
    // Records the section explicitly, so the storefront renders this product's
    // own details page instead of guessing from the category name.
    schemaId: activeSchema?.id ?? "",
    kind: normalizedFormData.kind || activeSchema?.kind || "account",
  };
}

export type BatchGameImport =
  | {
      ok: true;
      payload: Record<string, any>;
      /**
       * The Chinese supplier name, carried beside the payload and never
       * inside it — the payload is what reaches `saveProduct` and therefore
       * every public response.
       */
      supplierNameZh: { name: string; sourceUrl: string };
    }
  | { ok: false; reason: string };

/**
 * One template file from a batch archive, ready for the save endpoint.
 *
 * Exactly the single-game import — same parser, same field mapping, same
 * payload — with two flags on top: the product is stored hidden, and the
 * endpoint is told this is a batch run so a taken slug produces a flagged copy
 * instead of a refusal.
 */
/**
 * Take the Chinese supplier name off a parsed form.
 *
 * Deletes as it reads. A value left on the form is a value that reaches
 * `saveProduct`, and from there every public serializer — the exact leak the
 * separate `product_admin_metadata` table exists to make impossible. It has to
 * travel through the form because that is how the parser hands anything over;
 * it must not stay there.
 */
export function extractSupplierNameZh(form: Record<string, unknown>): {
  name: string;
  sourceUrl: string;
} {
  const name = String(form["supplierNameZhCn"] ?? "").trim();
  const sourceUrl = String(form["supplierNameZhSourceUrl"] ?? "").trim();
  delete form["supplierNameZhCn"];
  delete form["supplierNameZhSourceUrl"];
  return { name, sourceUrl };
}

export function buildBatchGameImport(rawText: string, categoryId: string): BatchGameImport {
  const parsed = parseGameImport(rawText);
  const form = applyGameImportToForm(createBlankProductForm(categoryId), parsed.data);
  const supplierNameZh = extractSupplierNameZh(form);

  /*
    The name comes first. A file with no name is not a game, and every other
    rule then fires about a record that does not exist — an operator importing
    a truncated or wrong file was told its performance record was incomplete,
    which is true and useless. Once there is a name, the parser's own errors
    are what matters and are reported as before.
  */
  if (!form["titleEn"] && !form["title"]) {
    return { ok: false, reason: "الملف لا يحتوي اسم اللعبة (name=)" };
  }

  const blocking = parsed.errors.filter((issue) => issue.severity === "error");
  if (blocking.length > 0) {
    const first = blocking[0]!;
    return { ok: false, reason: `${first.key}: ${first.message}` };
  }

  const slug = String(form.slug ?? "").trim();
  const demand = demandTierFor(slug);
  if (!slug || demand.defaulted) {
    return { ok: false, reason: `لا توجد فئة طلب موثقة للعبة: ${slug || form.title}` };
  }

  const platform: Platform | null =
    form.platform === "switch1" ? "switch1" : form.platform === "switch2" ? "switch2" : null;
  if (!platform) {
    return { ok: false, reason: `منصة غير صالحة للتسعير: ${String(form.platform ?? "")}` };
  }

  const sourceTypes = Array.isArray(form.types) ? form.types : [];
  const costs = mapSupplierCosts(sourceTypes);
  const pricing = priceGame(costs, platform, demand.tier);
  if (
    pricing.needsReview.length > 0 ||
    pricing.productPrice === undefined ||
    pricing.productCost === undefined
  ) {
    return { ok: false, reason: `التكاليف تحتاج مراجعة: ${pricing.needsReview.join("؛ ")}` };
  }

  const sourceTier = (account: AccountKind, content: ContentKind) => {
    const rows = sourceTypes.filter((row: any) => row?.optionId === `${account}_account`);
    return rows[content === "base" ? 0 : 1];
  };

  const options = (["offline", "online"] as const).map((account) => {
    const current = Array.isArray(form.options)
      ? form.options.find((option: any) => option?.id === `${account}_account`)
      : undefined;
    return {
      ...current,
      id: `${account}_account`,
      name: customerOptionName(account),
      description:
        account === "offline"
          ? "حساب مخصص للعب دون اتصال بعد إكمال خطوات التفعيل."
          : "حساب يدعم تشغيل اللعبة مع الاتصال والميزات المتاحة أونلاين.",
      stock: Number(current?.stock) || 9999,
      isInfiniteStock: current?.isInfiniteStock !== false,
    };
  });

  const types = pricing.tiers.map((tier) => {
    const current = sourceTier(tier.account, tier.content);
    return {
      ...current,
      id: `${tier.account}_${tier.content}`,
      name: customerTypeName(tier.account, tier.content),
      optionId: `${tier.account}_account`,
      price: tier.price,
      cost: tier.cost,
      description:
        tier.content === "extras"
          ? "تشمل اللعبة الأساسية والمحتوى الإضافي المثبت في هذا الإصدار."
          : "تشمل الإصدار العادي من اللعبة.",
      internalNote: tier.reason,
      stock: Number(current?.stock) || 9999,
      isInfiniteStock: current?.isInfiniteStock !== false,
    };
  });

  form.options = options;
  form.types = types;
  form.variants = types;
  form.price = pricing.productPrice;
  form.cost = pricing.productCost;

  return {
    ok: true,
    payload: {
      ...buildProductSavePayload(form),
      isHidden: true,
      batchImport: true,
    },
    /*
      Carried beside the payload, never inside it. The caller writes this to
      `product_admin_metadata`; nothing that reaches `saveProduct` knows it
      exists.
    */
    supplierNameZh,
  };
}

/**
 * One template file from a batch archive, for any schema in the registry.
 *
 * The Nintendo path above is left exactly as it was — it has its own long
 * standing parser and its own field mapping. This is the same three steps for
 * everything else: parse against the schema, run the file through the very
 * normalisation the product editor runs, and assemble the same save payload.
 * Both share the two batch flags, so a taken slug produces a flagged hidden
 * copy rather than a refusal, and nothing a batch creates is ever visible
 * before someone looks at it.
 */
export function buildBatchSchemaImport(
  rawText: string,
  categoryId: string,
  schema: ProductSchema,
): BatchGameImport & { quality?: QualityReport } {
  const parsed = parseProductImport(rawText, schema);
  const blocking = parsed.errors.filter((issue) => issue.severity === "error");
  if (blocking.length > 0) {
    const first = blocking[0]!;
    return { ok: false, reason: `${first.key}: ${first.message}` };
  }

  const blank = createBlankProductForm(categoryId);
  const form = applySchemaImportToForm(blank, parsed, schema);
  if (!form["titleEn"] && !form["title"]) {
    return { ok: false, reason: "الملف لا يحتوي اسم المنتج (name=)" };
  }

  /*
    Hardware, amiibo and the rest do not carry a Chinese supplier name today —
    but the strip runs here too, so the day a schema gains the field it cannot
    ride into the product payload unnoticed.
  */
  const supplierNameZh = extractSupplierNameZh(form);

  return {
    ok: true,
    supplierNameZh,
    payload: {
      ...buildProductSavePayload(form, schema),
      isHidden: true,
      batchImport: true,
    },
    /*
      A file that parses is not a file worth publishing: a template with only a
      name filled in parses exactly as cleanly as a researched one. The report
      rides along so the dry run can say which is which before anything is
      written.
    */
    quality: buildQualityReport(parsed.data, schema),
  };
}
