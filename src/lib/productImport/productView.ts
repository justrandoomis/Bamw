/**
 * Turns a stored product record into a render-ready, already-localized view
 * model for the details page.
 *
 * Two things happen here that the page itself should not have to care about:
 *
 *  1. **Scalar fields become spec tables.** Every schema field carries a
 *     `group` (its template heading) and a `specKey` (its i18n key), so
 *     `bluetoothVersion: "5.3"` lands in the Connectivity table as
 *     "Bluetooth Sürümü — 5.3" with no per-field UI code. Dynamic
 *     `spec_group` entries from the import file are appended to the same list,
 *     which is why a brand new specification needs no code change at all.
 *
 *  2. **Empty things disappear.** Anything without data is dropped here rather
 *     than being handed to the page as an empty array, so a section that has
 *     nothing to say simply does not exist.
 */

import { translate, type Locale } from "../i18n";
import { isUsableImageUrl } from "../nintendoImages";
import { productGalleryImages } from "../productImages";
import { toAmount } from "../purchasable";
import { getTextValue } from "../utils";
import { detectSchema } from "./registry";
import { SPEC_GROUP_KEYS } from "./shared";
import { resolveSpecGroups, type ResolvedSpecGroup } from "./specLabels";
import {
  resolveOptionStandardDescription,
  resolveTypeStandardDescription,
} from "../productOptionDescriptions";
import type { FieldDef, ProductSchema } from "./types";

type Record_ = Record<string, unknown>;

const str = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object") {
    return getTextValue(v).trim();
  }
  return v == null ? "" : String(v).trim();
};
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]).filter(Boolean) : []);

export interface MediaItem {
  url: string;
  title?: string;
  description?: string;
}

export interface VideoItem {
  url: string;
  title?: string;
  thumbnail?: string;
  type?: string;
}

export interface DocumentItem {
  url: string;
  title?: string;
  type?: string;
}

export interface CompatibilityItem {
  name: string;
  status?: string;
  notes?: string;
  url?: string;
  productId?: string;
}

export interface GameCompatibilityItem {
  game: string;
  platform?: string;
  function?: string;
  reward?: string;
  description?: string;
  sourceUrl?: string;
}

export interface BoxContentItem {
  name: string;
  quantity?: number;
  image?: string;
  notes?: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface SourceItem {
  name: string;
  url: string;
  type?: string;
}

export interface UpdateItem {
  version?: string;
  date?: string;
  title?: string;
  changes?: string;
  url?: string;
}

export interface ExternalReviewItem {
  source: string;
  score?: string;
  quote?: string;
  url?: string;
}

export interface OptionItem {
  id: string;
  name: string;
  price?: number;
  cost?: number;
  stock?: number;
  image?: string;
  description?: string;
}

export interface VariantItem {
  /*
    The record's own id for this variant.

    It used to be dropped here, so the details page could show a variant's
    price but had nothing to name it with when the line reached the cart —
    checkout then priced that line at the product's headline price instead of
    the variant's. The id is what lets the server resolve the same row the
    buyer picked. Optional because older records were written without one.
  */
  id?: string;
  name: string;
  optionId?: string;
  price?: number;
  cost?: number;
  stock?: number;
  color?: string;
  image?: string;
  sku?: string;
  description?: string;
}

/* ------------------------- category-specific blocks ------------------------ */

/**
 * Why these are typed blocks rather than more rows in the spec table.
 *
 * "Condition: Good", "3 defects", "inspected on 2026-03-04" are the reasons
 * somebody buys — or does not buy — a second-hand console, and burying them in
 * an alphabetical specification list is how a page ends up technically
 * complete and practically useless. Each block below is the small set of facts
 * its category is actually sold on, so the page can give them a shape of their
 * own instead of a generic key/value row.
 *
 * Every block is `null` when its category's fields are absent, which is what
 * lets the section registry decide the page's shape from data alone.
 */
export interface ConditionView {
  usedType: string;
  grade: string;
  packaging: string;
  guarantee: string;
  tested: boolean | null;
  testedAt: string;
  cleaned: boolean | null;
  notes: string;
  defects: string[];
  inspectionPoints: string[];
  previousOwners: number | null;
  usagePeriodMonths: number | null;
  originalTitle: string;
  platform: string;
}

export interface BundleItemView {
  title: string;
  platform: string;
  edition: string;
  /** Standalone value in IQD, used for the savings maths. */
  value: number;
  /** Store product this item resolves to, when the import linked one. */
  productId: string;
  coverUrl: string;
}

export interface BundleView {
  items: BundleItemView[];
  gamesCount: number;
  /** Sum of the items' standalone values; 0 when none were priced. */
  totalValue: number;
  savingsAmount: number;
  savingsPercent: number;
  accountType: string;
  devicesLimit: number | null;
  onlinePlay: boolean | null;
  deliveryTime: string;
  includedServices: string[];
  summary: string;
  accountTerms: string;
  supportPolicy: string;
}

export interface GiftCardView {
  cardType: string;
  value: string;
  currency: string;
  region: string;
  regionLocked: boolean | null;
  platform: string;
  validity: string;
  expiryDate: string;
  deliveryMethod: string;
  deliveryTime: string;
  codeLength: string;
  artwork: string;
  regionBanner: string;
  requirements: string[];
  refundPolicy: string;
}

export interface AmiiboView {
  officialName: string;
  character: string;
  franchise: string;
  series: string;
  figureType: string;
  edition: string;
  rarity: string;
  productionStatus: string;
  functionality: string;
  nfcSupport: boolean | null;
  compatibleConsoles: string[];
  characterDescription: string;
  collectorNotes: string;
  collection: { label: string; value: string }[];
}

export interface ProductView {
  schema: ProductSchema;
  title: string;
  subtitle: string;
  brand: string;
  model: string;
  price: number;
  originalPrice: number;
  discountPercent: number;
  stock: number;
  isInfiniteStock: boolean;
  availability: string;
  images: string[];
  descriptionShort: string;
  descriptionFull: string;
  overview: string;
  identity: { label: string; value: string }[];
  features: string[];
  highlights: string[];
  pros: string[];
  cons: string[];
  specGroups: ResolvedSpecGroup[];
  compatibility: CompatibilityItem[];
  gameCompatibility: GameCompatibilityItem[];
  boxContents: BoxContentItem[];
  gallery: MediaItem[];
  videos: VideoItem[];
  documents: DocumentItem[];
  faq: FaqItem[];
  sources: SourceItem[];
  updates: UpdateItem[];
  externalReviews: ExternalReviewItem[];
  options: OptionItem[];
  variants: VariantItem[];
  /** Redemption / setup steps rendered as a numbered list (gift cards, bundles…). */
  usageSteps: string[];
  usageUrl: string;
  usageTerms: string;
  warranty: { label: string; value: string }[];
  seo: { title: string; description: string; image: string };
  /** Requirements to satisfy before buying (gift cards, bundles, accessories). */
  requirements: string[];
  refundPolicy: string;
  /** Populated only for the category that owns the block; null otherwise. */
  condition: ConditionView | null;
  bundle: BundleView | null;
  giftCard: GiftCardView | null;
  amiibo: AmiiboView | null;
  /** Drives which conditional spec groups an accessory page shows. */
  accessoryType: string;
}

/** Fields that belong in the identity strip under the title, not a spec table. */
const IDENTITY_FIELDS: { target: string; key: string }[] = [
  { target: "brand", key: "product.brand" },
  { target: "manufacturer", key: "product.manufacturer" },
  { target: "model", key: "product.model" },
  { target: "modelNumber", key: "product.modelNumber" },
  { target: "sku", key: "product.sku" },
  { target: "partNumber", key: "product.partNumber" },
  { target: "releaseDate", key: "product.releaseDate" },
  { target: "region", key: "product.region" },
  { target: "countryOfOrigin", key: "product.countryOfOrigin" },
];


/* ------------------------------- builders --------------------------------- */

const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const numOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};

/** True when at least one field of a block carries something. */
const populated = (block: Record<string, unknown>): boolean =>
  Object.values(block).some((value) => {
    if (value === null || value === undefined || value === "") return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });

/**
 * The one description a customer reads.
 *
 * The templates carry five description fields — `description_full`,
 * `description_ar`, `description_en`, `description_tr`, `overview` — because
 * they are *data sources*, filled by whoever researched the product. Rendering
 * all five stacked the same paragraph up to five times on one page. So the page
 * picks exactly one per language, and the store's default language is Arabic:
 * `description_ar` wins whenever it exists, and the rest are fallbacks in a
 * fixed order rather than extra paragraphs.
 */
function chooseDescription(p: Record_, locale: Locale): string {
  const ar = str(p["description_ar"]);
  const generic = str(p["description"]);
  const en = str(p["descriptionEn"]);
  const tr = str(p["descriptionTr"]);
  if (locale === "en") return en || generic || ar || tr;
  if (locale === "tr") return tr || en || generic || ar;
  return ar || generic || en || tr;
}

function buildCondition(p: Record_): ConditionView | null {
  const view: ConditionView = {
    usedType: str(p["usedType"]),
    grade: str(p["conditionGrade"]),
    packaging: str(p["packaging"]),
    guarantee: str(p["guaranteeStatus"]),
    tested: bool(p["tested"]),
    testedAt: str(p["testedAt"]),
    cleaned: bool(p["cleaned"]),
    notes: str(p["conditionNotes"]),
    defects: list<unknown>(p["defects"]).map(getTextValue).filter(Boolean),
    inspectionPoints: list<unknown>(p["inspectionPoints"]).map(getTextValue).filter(Boolean),
    previousOwners: numOrNull(p["previousOwners"]),
    usagePeriodMonths: numOrNull(p["usagePeriodMonths"]),
    originalTitle: str(p["originalTitle"]),
    platform: str(p["platform"]),
  };
  return populated(view as unknown as Record<string, unknown>) ? view : null;
}

function buildBundle(p: Record_): BundleView | null {
  const items: BundleItemView[] = list<Record_>(p["bundleItems"])
    .map((raw) => ({
      title: str(raw["title"]),
      platform: str(raw["platform"]),
      edition: str(raw["edition"]),
      value: toAmount(raw["valueIqd"] ?? raw["value"]),
      productId: str(raw["productId"]),
      coverUrl: str(raw["coverUrl"]),
    }))
    .filter((item) => item.title || item.productId);

  const totalValue = items.reduce((sum, item) => sum + (item.value || 0), 0);
  const price = toAmount(p["price"]);
  /*
    The saving is derived rather than trusted: `savings_percent` in the template
    is a marketing figure an editor typed, and it stops being true the moment
    the price changes. When the items carry real standalone values the maths
    wins; the declared percentage is the fallback for a bundle whose items were
    never priced.
  */
  const savingsAmount = totalValue > price && price > 0 ? totalValue - price : 0;
  const declaredPercent = numOrNull(p["savingsPercent"]) ?? 0;
  const savingsPercent =
    savingsAmount > 0 && totalValue > 0
      ? Math.round((savingsAmount / totalValue) * 100)
      : declaredPercent;

  const view: BundleView = {
    items,
    gamesCount: numOrNull(p["gamesCount"]) ?? items.length,
    totalValue,
    savingsAmount,
    savingsPercent,
    accountType: str(p["accountType"]),
    devicesLimit: numOrNull(p["devicesLimit"]),
    onlinePlay: bool(p["onlinePlay"]),
    deliveryTime: str(p["deliveryTime"]),
    includedServices: list<unknown>(p["includedServices"]).map(getTextValue).filter(Boolean),
    summary: str(p["bundleGamesSummary"]),
    accountTerms: str(p["accountTerms"]),
    supportPolicy: str(p["supportPolicy"]),
  };
  return items.length > 0 || view.accountType || view.gamesCount > 0 ? view : null;
}

function buildGiftCard(p: Record_): GiftCardView | null {
  const view: GiftCardView = {
    cardType: str(p["cardType"]),
    value: str(p["cardValue"]),
    currency: str(p["cardCurrency"]),
    region: str(p["cardRegion"]),
    regionLocked: bool(p["regionLocked"]),
    platform: str(p["platform"]),
    validity: str(p["validity"]),
    expiryDate: str(p["expiryDate"]),
    deliveryMethod: str(p["deliveryMethod"]),
    deliveryTime: str(p["deliveryTime"]),
    codeLength: str(p["codeLength"]),
    artwork: str(p["cardArtwork"]),
    regionBanner: str(p["regionBanner"]),
    requirements: list<unknown>(p["requirements"]).map(getTextValue).filter(Boolean),
    refundPolicy: str(p["refundPolicy"]),
  };
  return populated(view as unknown as Record<string, unknown>) ? view : null;
}

function buildAmiibo(p: Record_, t: (key: string) => string): AmiiboView | null {
  const collection = [
    { label: t("amiibo.collectionSeries"), value: str(p["collectionSeries"]) },
    { label: t("amiibo.collectionNumber"), value: str(p["collectionNumber"]) },
    { label: t("amiibo.releaseWave"), value: str(p["releaseWave"]) },
    { label: t("amiibo.exclusiveRetailer"), value: str(p["exclusiveRetailer"]) },
    { label: t("amiibo.packagingType"), value: str(p["packagingType"]) },
    { label: t("amiibo.reReleaseDate"), value: str(p["reReleaseDate"]) },
  ].filter((row) => row.value);

  const view: AmiiboView = {
    officialName: str(p["officialName"]),
    character: str(p["character"]),
    franchise: str(p["franchise"]),
    series: str(p["amiiboSeries"]) || str(p["figureSeries"]) || str(p["series"]),
    figureType: str(p["figureType"]),
    edition: str(p["edition"]),
    rarity: str(p["rarity"]),
    productionStatus: str(p["productionStatus"]),
    functionality: str(p["amiiboFunctionality"]),
    nfcSupport: bool(p["nfcSupport"]),
    compatibleConsoles: list<unknown>(p["compatibleConsoles"]).map(getTextValue).filter(Boolean),
    characterDescription: str(p["characterDescription"]) || str(p["characterBiography"]),
    collectorNotes: str(p["collectorNotes"]),
    collection,
  };
  return populated(view as unknown as Record<string, unknown>) ? view : null;
}

/**
 * Fields a category's own block already renders, and which must therefore not
 * also appear as generic specification rows.
 *
 * `spec_group` is an extension mechanism — the way a template adds a
 * specification nobody wrote code for — not a second home for fields the page
 * already understands. Without this, a gift card printed its region, validity
 * and delivery method inside "Card details" and then printed them again in a
 * "Specifications" table underneath, which reads as a rendering bug even
 * though both were correct.
 */
const BLOCK_OWNED_TARGETS: Record<string, readonly string[]> = {
  gift_card: [
    "cardType",
    "cardValue",
    "cardCurrency",
    "cardRegion",
    "regionLocked",
    "platform",
    "codeLength",
    "validity",
    "expiryDate",
    "deliveryMethod",
    "deliveryTime",
  ],
  used: [
    "usedType",
    "conditionGrade",
    "packaging",
    "guaranteeStatus",
    "tested",
    "testedAt",
    "cleaned",
    "previousOwners",
    "usagePeriodMonths",
    "platform",
  ],
  bundle: [
    "gamesCount",
    "savingsPercent",
    "accountType",
    "devicesLimit",
    "onlinePlay",
    "deliveryTime",
    "platform",
  ],
  amiibo: [
    "figureType",
    "edition",
    "rarity",
    "productionStatus",
    "nfcSupport",
    "character",
    "franchise",
    "amiiboSeries",
  ],
};

/** Normalized key for spec de-duplication: case and separators do not count. */
function specIdentity(label: string, value: string): string {
  return `${label}`.trim().toLowerCase().replace(/[\s_-]+/g, "") + "\u0000" + value.trim().toLowerCase();
}

export function buildProductView(
  productInput: Record_,
  locale: Locale,
  schemaInput?: ProductSchema,
): ProductView | null {
  const schema = schemaInput ?? detectSchema(productInput);
  if (!schema) return null;

  const p = productInput;
  const t = (key: string) => translate(locale, key);

  /* ------------------------------ spec tables ------------------------------ */

  // Scalar schema fields carrying a `specKey`, bucketed by their template group.
  const buckets = new Map<
    string,
    { label: string; specs: { label: string; value: string; unit?: string }[] }
  >();

  const pushSpec = (def: FieldDef, rawValue: unknown) => {
    const value = formatValue(rawValue, locale, t);
    if (!value) return;
    const groupName = def.group ?? "";
    let bucket = buckets.get(groupName);
    if (!bucket) {
      // The template heading is Arabic by design; render its localized name.
      const groupKey = SPEC_GROUP_KEYS[groupName];
      bucket = { label: groupKey ? t(`specs.groups.${groupKey}`) : groupName, specs: [] };
      buckets.set(groupName, bucket);
    }
    const entry: { label: string; value: string; unit?: string } = {
      label: def.specKey ? t(`specs.${def.specKey}`) : def.key,
      value,
    };
    if (def.unit) entry.unit = def.unit;
    bucket.specs.push(entry);
  };

  const blockOwned = new Set(BLOCK_OWNED_TARGETS[schema.id] ?? []);
  for (const def of schema.fields) {
    if (!def.specKey || def.type === "group" || def.repeatable) continue;
    if (IDENTITY_FIELDS.some((f) => f.target === def.target)) continue;
    // Internal fields are data sources for the team, never product-page rows.
    if (def.audience === "internal") continue;
    if (blockOwned.has(def.target)) continue;
    pushSpec(def, p[def.target]);
  }

  const scalarGroups: ResolvedSpecGroup[] = [...buckets.values()]
    .filter((b) => b.specs.length > 0)
    .map((b) => ({ label: b.label, specs: b.specs }));

  const dynamicGroups = resolveSpecGroups(locale, p["specGroups"] as never);

  // A schema field and a dynamic group can resolve to the same heading (both
  // "Connectivity", say). Rendering that twice looks like a bug, so same-named
  // groups are folded into one table, schema rows first.
  const mergedGroups: ResolvedSpecGroup[] = [];
  /*
    A dynamic `spec_group` row that repeats a schema field verbatim adds
    nothing, so identical label/value pairs are kept once — schema rows first,
    since those carry the localized label and the unit.
  */
  const seenSpecs = new Set<string>();
  for (const group of [...scalarGroups, ...dynamicGroups]) {
    const fresh = group.specs.filter((spec) => {
      const key = specIdentity(spec.label, spec.value);
      if (seenSpecs.has(key)) return false;
      seenSpecs.add(key);
      return true;
    });
    if (fresh.length === 0) continue;
    const existing = mergedGroups.find((g) => g.label === group.label);
    if (existing) existing.specs.push(...fresh);
    else mergedGroups.push({ label: group.label, specs: fresh });
  }

  /* -------------------------------- assembly -------------------------------- */

  /*
    One ordered list, from the image-role contract rather than from whatever
    order the fields happen to sit in on the record. The hero photograph leads,
    the other named angles follow anatomically, then the free-form gallery — so
    two products with the same fields always present them the same way, and a
    banner never opens a product gallery.
  */
  const images = [
    ...productGalleryImages(p),
    ...(isUsableImageUrl(p["image"]) ? [String(p["image"]).trim()] : []),
  ].filter((url, index, all) => url && all.indexOf(url) === index);

  const identity = IDENTITY_FIELDS.map((field) => ({
    label: t(field.key),
    value: str(p[field.target]),
  })).filter((row) => row.value);

  const warranty = [
    { label: t("product.warranty"), value: str(p["warranty"]) },
    { label: t("common.type"), value: str(p["warrantyType"]) },
    { label: t("common.notes"), value: str(p["warrantyNotes"]) },
    { label: t("specs.certifications"), value: str(p["certifications"]) },
  ].filter((row) => row.value);

  const price = toAmount(p["price"]);
  const originalPrice = toAmount(p["originalPrice"]);
  const declaredDiscount = toAmount(p["discountPercent"]);
  const discountPercent =
    declaredDiscount > 0
      ? declaredDiscount
      : originalPrice > price && originalPrice > 0
        ? Math.round(((originalPrice - price) / originalPrice) * 100)
        : 0;

  return {
    schema,
    title: str(p["titleEn"]) || str(p["english_name"]) || str(p["title"]) || str(p["name"]),
    subtitle: str(p["shortName"]) || str(p["tagline"]),
    brand: str(p["brand"]),
    model: str(p["model"]),
    price,
    originalPrice,
    discountPercent,
    stock: Number(p["stock"]) || 0,
    isInfiniteStock: p["isInfiniteStock"] === true,
    availability: str(p["availabilityStatus"]),
    images,
    descriptionShort: str(p["description_short"]),
    descriptionFull: chooseDescription(p, locale),
    overview: str(p["overview"]),
    identity,
    features: list<unknown>(p["features"]).map(getTextValue).filter(Boolean),
    highlights: [
      ...list<unknown>(p["highlights"]).map(getTextValue),
      ...list<unknown>(p["sellingPoints"]).map(getTextValue),
    ].filter(Boolean),
    pros: list<unknown>(p["pros"]).map(getTextValue).filter(Boolean),
    cons: list<unknown>(p["cons"]).map(getTextValue).filter(Boolean),
    specGroups: mergedGroups,
    compatibility: list<Record_>(p["compatibility"])
      .map((c) => {
        const item: CompatibilityItem = {
          name: str(c["name"]) || str(c["product"]) || str(c["model"]),
        };
        if (c["status"]) item.status = str(c["status"]);
        if (c["notes"]) item.notes = str(c["notes"]);
        if (c["url"]) item.url = str(c["url"]);
        if (c["productId"]) item.productId = str(c["productId"]);
        return item;
      })
      .filter((c) => c.name),
    gameCompatibility: list<Record_>(p["gameCompatibility"])
      .map((g) => {
        const item: GameCompatibilityItem = { game: str(g["game"]) };
        if (g["platform"]) item.platform = str(g["platform"]);
        if (g["function"]) item.function = str(g["function"]);
        if (g["reward"]) item.reward = str(g["reward"]);
        if (g["description"]) item.description = str(g["description"]);
        if (g["sourceUrl"]) item.sourceUrl = str(g["sourceUrl"]);
        return item;
      })
      .filter((g) => g.game),
    boxContents: list<Record_>(p["boxContents"])
      .map((b) => {
        const item: BoxContentItem = { name: str(b["name"]) };
        const qty = Number(b["quantity"]);
        if (Number.isFinite(qty) && qty > 0) item.quantity = qty;
        if (b["image"]) item.image = str(b["image"]);
        if (b["notes"]) item.notes = str(b["notes"]);
        return item;
      })
      .filter((b) => b.name),
    gallery: list<Record_>(p["gallery"])
      .map((g) => {
        const item: MediaItem = { url: str(g["url"]) };
        if (g["title"]) item.title = str(g["title"]);
        if (g["description"]) item.description = str(g["description"]);
        return item;
      })
      .filter((g) => g.url),
    videos: list<Record_>(p["videos"])
      .map((v) => {
        const item: VideoItem = { url: str(v["url"]) };
        if (v["title"]) item.title = str(v["title"]);
        if (v["thumbnail"]) item.thumbnail = str(v["thumbnail"]);
        if (v["type"]) item.type = str(v["type"]);
        return item;
      })
      .filter((v) => v.url),
    documents: list<Record_>(p["documents"])
      .map((d) => {
        const item: DocumentItem = { url: str(d["url"]) };
        if (d["title"]) item.title = str(d["title"]);
        if (d["type"]) item.type = str(d["type"]);
        return item;
      })
      .filter((d) => d.url),
    faq: list<Record_>(p["faq"])
      .map((q) => ({ question: str(q["question"]), answer: str(q["answer"]) }))
      .filter((q) => q.question && q.answer),
    sources: list<Record_>(p["sources"])
      .map((s) => {
        const item: SourceItem = { name: str(s["name"]) || str(s["url"]), url: str(s["url"]) };
        if (s["type"]) item.type = str(s["type"]);
        return item;
      })
      .filter((s) => s.url),
    updates: list<Record_>(p["firmwareUpdates"])
      .map((u) => {
        const item: UpdateItem = {};
        if (u["version"]) item.version = str(u["version"]);
        if (u["date"]) item.date = str(u["date"]);
        if (u["title"]) item.title = str(u["title"]);
        if (u["changes"]) item.changes = str(u["changes"]);
        if (u["url"]) item.url = str(u["url"]);
        return item;
      })
      .filter((u) => u.version || u.title || u.changes),
    externalReviews: list<Record_>(p["externalReviews"])
      .map((r) => {
        const item: ExternalReviewItem = { source: str(r["source"]) };
        if (r["score"]) item.score = str(r["score"]);
        if (r["quote"]) item.quote = str(r["quote"]);
        if (r["url"]) item.url = str(r["url"]);
        return item;
      })
      .filter((r) => r.source),
    usageSteps: toSteps(p["redemptionSteps"] ?? p["redeemSteps"] ?? p["setupSteps"]).length
      ? toSteps(p["redemptionSteps"] ?? p["redeemSteps"] ?? p["setupSteps"])
      : toSteps(p["redemptionGuide"] ?? p["activationGuide"] ?? p["usageGuide"]),
    usageUrl: str(p["redemptionUrl"] ?? ""),
    usageTerms: str(p["usageTerms"] ?? ""),
    options: list<Record_>(p["options"])
      .map((o, index) => {
        const item: OptionItem = {
          id: str(o["id"]) || `option-${index + 1}`,
          name: str(o["name"]),
        };
        if (o["price"] != null && str(o["price"]) !== "") {
          const amt = toAmount(o["price"]);
          if (amt > 0 || o["price"] === 0 || o["price"] === "0") item.price = amt;
        }
        if (o["cost"] != null && str(o["cost"]) !== "") {
          const amt = toAmount(o["cost"]);
          if (amt > 0 || o["cost"] === 0 || o["cost"] === "0") item.cost = amt;
        }
        if (o["stock"] != null) item.stock = Number(o["stock"]) || 0;
        if (o["image"]) item.image = str(o["image"]);
        const stdOptDesc = resolveOptionStandardDescription(item.name || item.id, o["description"]);
        if (stdOptDesc) item.description = stdOptDesc;
        return item;
      })
      .filter((o) => o.name),
    variants: (list<Record_>(p["variants"]).length > 0
      ? list<Record_>(p["variants"])
      : list<Record_>(p["types"])
    )
      .map((v) => {
        const item: VariantItem = { name: str(v["name"]) };
        const variantId = str(v["id"]);
        if (variantId) item.id = variantId;
        const optId = str(v["optionId"] || v["option_id"]);
        if (optId && optId !== "all") item.optionId = optId;
        if (v["price"] != null && str(v["price"]) !== "") {
          const amt = toAmount(v["price"]);
          if (amt > 0 || v["price"] === 0 || v["price"] === "0") item.price = amt;
        }
        if (v["cost"] != null && str(v["cost"]) !== "") {
          const amt = toAmount(v["cost"]);
          if (amt > 0 || v["cost"] === 0 || v["cost"] === "0") item.cost = amt;
        }
        if (v["stock"] != null) item.stock = Number(v["stock"]) || 0;
        if (v["color"]) item.color = str(v["color"]);
        if (v["image"]) item.image = str(v["image"]);
        if (v["sku"]) item.sku = str(v["sku"]);
        const stdTypeDesc = resolveTypeStandardDescription(item.name, v["description"]);
        if (stdTypeDesc) item.description = stdTypeDesc;
        return item;
      })
      .filter((v) => v.name),
    warranty,
    seo: {
      title: str(p["seoTitle"]) || str(p["title"]),
      description: str(p["seoDescription"]) || str(p["description_short"]),
      image: str(p["ogImage"]) || str(p["mainImage"]) || str(p["coverImage"]),
    },
    requirements: list<unknown>(p["requirements"]).map(getTextValue).filter(Boolean),
    refundPolicy: str(p["refundPolicy"]),
    condition: schema.id === "used" ? buildCondition(p) : null,
    bundle: schema.id === "bundle" ? buildBundle(p) : null,
    giftCard: schema.id === "gift_card" ? buildGiftCard(p) : null,
    amiibo: schema.id === "amiibo" ? buildAmiibo(p, t) : null,
    accessoryType: str(p["accessoryType"]),
  };
}

/**
 * Steps arrive either as a list or as one blob of text; both become an array of
 * clean lines so the page can always number them.
 */
function toSteps(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  return raw
    .flatMap((entry) => {
      if (entry && typeof entry === "object") {
        const rec = entry as Record_;
        return [String(rec["value"] ?? rec["text"] ?? rec["title"] ?? rec["name"] ?? "")];
      }
      return String(entry ?? "").split(/\r?\n|\s*[>›»]\s*|\s*\u2190\s*/);
    })
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

/** Booleans become localized yes/no; everything else is passed through as text. */
function formatValue(value: unknown, _locale: Locale, t: (key: string) => string): string {
  if (value === true) return t("common.yes");
  if (value === false) return "";
  if (value == null) return "";
  const text = String(value).trim();
  return text;
}
