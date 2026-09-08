/**
 * Used & returned marketplace — the rules, with no database in them.
 *
 * A seller lists a second-hand item, pays a listing fee out of their wallet,
 * and an admin reviews it before it ever reaches a customer. Everything that
 * decides *whether* a move is allowed lives here so it can be tested without
 * D1 and read without following a query around.
 *
 * The condition vocabulary is deliberately the same one the `used` import
 * schema already uses: a listing that gets approved becomes a product of that
 * shape, and two different sets of grades would make that conversion lossy.
 */

import {
  CONDITION_GRADE_VALUES,
  GUARANTEE_VALUES,
  PACKAGING_VALUES,
  USED_TYPE_VALUES,
} from "./productImport/usedSchema";
import { normalizeContact } from "./contact-links";

export { CONDITION_GRADE_VALUES, GUARANTEE_VALUES, PACKAGING_VALUES, USED_TYPE_VALUES };

export type UsedType = (typeof USED_TYPE_VALUES)[number];
export type ConditionGrade = (typeof CONDITION_GRADE_VALUES)[number];
export type Packaging = (typeof PACKAGING_VALUES)[number];
export type Guarantee = (typeof GUARANTEE_VALUES)[number];

export const USED_LISTING_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_CHANGES",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "SOLD",
  "PAUSED",
] as const;

export type UsedListingStatus = (typeof USED_LISTING_STATUSES)[number];

/** Statuses a customer can actually see on the storefront. */
export const PUBLIC_STATUSES: readonly UsedListingStatus[] = ["APPROVED"];

/** Statuses that are the end of the road — nothing follows them but a relist. */
export const TERMINAL_STATUSES: readonly UsedListingStatus[] = ["REJECTED", "SOLD"];

export type Actor = "seller" | "admin" | "system";

interface Transition {
  to: UsedListingStatus;
  /** Who is allowed to make this move. */
  by: readonly Actor[];
}

/**
 * The whole state machine in one table.
 *
 * Read it as "from this status, these moves exist, and only these actors may
 * make them". Anything not written here is not a legal move — there is no
 * implicit fallthrough, which is what stops an admin action and a seller
 * action from racing a listing into a status neither of them intended.
 */
export const TRANSITIONS: Record<UsedListingStatus, readonly Transition[]> = {
  DRAFT: [{ to: "SUBMITTED", by: ["seller"] }],
  SUBMITTED: [
    { to: "UNDER_REVIEW", by: ["admin"] },
    { to: "NEEDS_CHANGES", by: ["admin"] },
    { to: "APPROVED", by: ["admin"] },
    { to: "REJECTED", by: ["admin"] },
    // A seller may pull a listing back while nobody has picked it up yet.
    { to: "DRAFT", by: ["seller"] },
  ],
  UNDER_REVIEW: [
    { to: "NEEDS_CHANGES", by: ["admin"] },
    { to: "APPROVED", by: ["admin"] },
    { to: "REJECTED", by: ["admin"] },
  ],
  NEEDS_CHANGES: [
    { to: "SUBMITTED", by: ["seller"] },
    { to: "DRAFT", by: ["seller"] },
    { to: "REJECTED", by: ["admin"] },
  ],
  APPROVED: [
    { to: "PAUSED", by: ["seller", "admin"] },
    { to: "SOLD", by: ["admin", "system"] },
    { to: "EXPIRED", by: ["system", "admin"] },
    // Something wrong spotted after publication pulls it straight back.
    { to: "NEEDS_CHANGES", by: ["admin"] },
    { to: "REJECTED", by: ["admin"] },
  ],
  PAUSED: [
    { to: "APPROVED", by: ["seller", "admin"] },
    { to: "EXPIRED", by: ["system", "admin"] },
    { to: "REJECTED", by: ["admin"] },
  ],
  // A finished window can be paid for again; that starts from a fresh draft.
  EXPIRED: [{ to: "DRAFT", by: ["seller", "admin"] }],
  REJECTED: [],
  SOLD: [],
};

export function allowedTransitions(from: UsedListingStatus, actor: Actor): UsedListingStatus[] {
  return (TRANSITIONS[from] ?? [])
    .filter((transition) => transition.by.includes(actor))
    .map((transition) => transition.to);
}

export function canTransition(
  from: UsedListingStatus,
  to: UsedListingStatus,
  actor: Actor,
): boolean {
  return allowedTransitions(from, actor).includes(to);
}

/** Admin-controlled settings, stored on the store document under `usedMarketplace`. */
export interface UsedMarketplaceConfig {
  /** Master switch — off means the pages 404 and every write is refused. */
  enabled: boolean;
  /** What a seller pays, out of their wallet, for one publication window. */
  listingFeeIqd: number;
  /** How long an approved listing stays up before it expires. */
  listingDurationDays: number;
  /** Listings one seller may hold in a live status at the same time. */
  maxActiveListingsPerSeller: number;
  maxPhotos: number;
  minPriceIqd: number;
  maxPriceIqd: number;
  /** Bumped whenever the policy text changes; acceptances record the version. */
  policyVersion: string;
  /** Give the fee back when the store rejects the listing outright. */
  refundFeeOnReject: boolean;
  /** Require an admin to approve before a listing is visible. Always true today. */
  requireReview: boolean;
}

export const DEFAULT_USED_CONFIG: UsedMarketplaceConfig = {
  enabled: true,
  listingFeeIqd: 1000,
  /*
    A month, which is what the owner asked a listing to live for. It was seven
    days: the fee buys a window, and a window that closes in a week made a
    seller pay four times to sell one console.
  */
  listingDurationDays: 30,
  maxActiveListingsPerSeller: 10,
  maxPhotos: 8,
  minPriceIqd: 1000,
  maxPriceIqd: 5_000_000,
  policyVersion: "2026-08-29",
  refundFeeOnReject: true,
  requireReview: true,
};

function num(value: unknown, fallback: number, { min = 0 }: { min?: number } = {}): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) return fallback;
  return n;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/**
 * Reads the stored settings blob into a complete config.
 *
 * Every field falls back to its default individually, so a settings document
 * written before a field existed still produces a usable config rather than a
 * listing fee of `NaN`.
 */
export function readUsedConfig(raw: unknown): UsedMarketplaceConfig {
  const source = (raw ?? {}) as Record<string, unknown>;
  const d = DEFAULT_USED_CONFIG;
  const config: UsedMarketplaceConfig = {
    enabled: bool(source["enabled"], d.enabled),
    listingFeeIqd: num(source["listingFeeIqd"], d.listingFeeIqd),
    listingDurationDays: num(source["listingDurationDays"], d.listingDurationDays, { min: 1 }),
    maxActiveListingsPerSeller: num(
      source["maxActiveListingsPerSeller"],
      d.maxActiveListingsPerSeller,
      { min: 1 },
    ),
    maxPhotos: num(source["maxPhotos"], d.maxPhotos, { min: 1 }),
    minPriceIqd: num(source["minPriceIqd"], d.minPriceIqd, { min: 1 }),
    maxPriceIqd: num(source["maxPriceIqd"], d.maxPriceIqd, { min: 1 }),
    policyVersion: String(source["policyVersion"] || d.policyVersion),
    refundFeeOnReject: bool(source["refundFeeOnReject"], d.refundFeeOnReject),
    requireReview: bool(source["requireReview"], d.requireReview),
  };
  // A max below the min would refuse every price; the pair is only meaningful
  // together, so an inverted pair falls back to the defaults as a pair.
  if (config.maxPriceIqd < config.minPriceIqd) {
    config.minPriceIqd = d.minPriceIqd;
    config.maxPriceIqd = d.maxPriceIqd;
  }
  return config;
}

/**
 * Statuses that count against the per-seller cap.
 *
 * A draft does not: it costs nothing and blocks nothing. Everything from
 * SUBMITTED onwards occupies either review attention or a storefront slot.
 */
export const ACTIVE_STATUSES: readonly UsedListingStatus[] = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_CHANGES",
  "APPROVED",
  "PAUSED",
];

/**
 * Whether this move needs the seller to pay the listing fee.
 *
 * The fee buys one publication window, not one submission: a listing sent back
 * for changes and resubmitted inside the window it already paid for is not
 * charged again. That is why the paid-cycle marker, not the status, decides.
 */
export function feeIsDue(
  from: UsedListingStatus,
  to: UsedListingStatus,
  { feePaidForCycle }: { feePaidForCycle: boolean },
): boolean {
  if (to !== "SUBMITTED") return false;
  if (from !== "DRAFT" && from !== "NEEDS_CHANGES") return false;
  return !feePaidForCycle;
}

export function expiryFrom(publishedAtIso: string, durationDays: number): string {
  const published = new Date(publishedAtIso);
  if (Number.isNaN(published.getTime())) throw new Error("invalid_published_at");
  return new Date(published.getTime() + durationDays * 86_400_000).toISOString();
}

export interface ListingDraftInput {
  title?: unknown;
  usedType?: unknown;
  conditionGrade?: unknown;
  packaging?: unknown;
  guarantee?: unknown;
  priceIqd?: unknown;
  quantity?: unknown;
  conditionNotes?: unknown;
  photos?: unknown;
  /** How long the seller owned and used it, in months. */
  usagePeriodMonths?: unknown;
  /** Months of manufacturer warranty still to run, if any. */
  warrantyMonths?: unknown;
  /** How to reach the seller — see contact-links.ts for the shapes accepted. */
  contact?: unknown;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

const ONE_OF = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

/**
 * What a listing must have before a human is asked to look at it.
 *
 * This is the submit gate, not the draft gate — a seller can save a half-filled
 * draft all day. Anything returned here is shown against its own field, so the
 * messages are written for the seller rather than for a log.
 */
export function validateForSubmission(
  input: ListingDraftInput,
  config: UsedMarketplaceConfig,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const title = String(input.title ?? "").trim();
  if (title.length < 3) issues.push({ field: "title", message: "اكتب اسم القطعة كاملاً" });

  if (!ONE_OF(USED_TYPE_VALUES, input.usedType)) {
    issues.push({ field: "usedType", message: "اختر نوع القطعة" });
  }
  if (!ONE_OF(CONDITION_GRADE_VALUES, input.conditionGrade)) {
    issues.push({ field: "conditionGrade", message: "اختر درجة الحالة" });
  }
  if (input.packaging != null && !ONE_OF(PACKAGING_VALUES, input.packaging)) {
    issues.push({ field: "packaging", message: "قيمة التغليف غير معروفة" });
  }
  if (input.guarantee != null && !ONE_OF(GUARANTEE_VALUES, input.guarantee)) {
    issues.push({ field: "guarantee", message: "قيمة الضمان غير معروفة" });
  }

  const price = Number(input.priceIqd);
  if (!Number.isFinite(price) || price <= 0) {
    issues.push({ field: "priceIqd", message: "اكتب سعراً صحيحاً" });
  } else if (price < config.minPriceIqd) {
    issues.push({
      field: "priceIqd",
      message: `أقل سعر مسموح ${config.minPriceIqd.toLocaleString("en-US")} د.ع`,
    });
  } else if (price > config.maxPriceIqd) {
    issues.push({
      field: "priceIqd",
      message: `أعلى سعر مسموح ${config.maxPriceIqd.toLocaleString("en-US")} د.ع`,
    });
  }

  const quantity = Number(input.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    issues.push({ field: "quantity", message: "الكمية بين 1 و 99" });
  }

  // The honest-description rule: a used item with no stated condition is the
  // single most common source of disputes, so it is required, not recommended.
  const notes = String(input.conditionNotes ?? "").trim();
  if (notes.length < 10) {
    issues.push({
      field: "conditionNotes",
      message: "صف حالة القطعة بصدق (الخدوش وعلامات الاستخدام)",
    });
  }

  /*
    Two numbers a second-hand buyer asks before anything else, and neither had
    a home: how long it was used, and what warranty is left. Optional, because
    an honest "I do not know" is better than a made-up number — but bounded, so
    a slip of the keyboard cannot advertise a console used for four hundred
    years.
  */
  if (input.usagePeriodMonths != null && String(input.usagePeriodMonths) !== "") {
    const months = Number(input.usagePeriodMonths);
    if (!Number.isFinite(months) || months < 0 || months > 600) {
      issues.push({ field: "usagePeriodMonths", message: "مدة الاستخدام بالأشهر بين 0 و 600" });
    }
  }
  if (input.warrantyMonths != null && String(input.warrantyMonths) !== "") {
    const months = Number(input.warrantyMonths);
    if (!Number.isFinite(months) || months < 0 || months > 120) {
      issues.push({ field: "warrantyMonths", message: "الضمان المتبقي بالأشهر بين 0 و 120" });
    }
  }

  /*
    At least one way to reach the seller.

    The whole point of the section is that a buyer contacts the seller
    directly, so a listing with no contact is a listing nobody can answer — and
    the fee would have been taken for it. `normalizeContact` keeps only handles
    it could build a link from, so a box filled with something unusable counts
    as empty here rather than passing the check and drawing no button later.
  */
  const contact = normalizeContact(input.contact as Record<string, unknown> | undefined);
  if (Object.keys(contact).length === 0) {
    issues.push({
      field: "contact",
      message: "أضف وسيلة تواصل واحدة على الأقل (تلغرام، واتساب، رقم، فيسبوك أو إنستغرام)",
    });
  }

  const photos = Array.isArray(input.photos) ? input.photos.filter(Boolean) : [];
  if (photos.length < 1) {
    issues.push({ field: "photos", message: "أضف صورة واحدة على الأقل للقطعة نفسها" });
  } else if (photos.length > config.maxPhotos) {
    issues.push({ field: "photos", message: `الحد الأقصى ${config.maxPhotos} صور` });
  }

  return issues;
}

export const STATUS_LABEL_AR: Record<UsedListingStatus, string> = {
  DRAFT: "مسودة",
  SUBMITTED: "بانتظار المراجعة",
  UNDER_REVIEW: "قيد المراجعة",
  NEEDS_CHANGES: "يحتاج تعديلاً",
  APPROVED: "منشور",
  REJECTED: "مرفوض",
  EXPIRED: "منتهي",
  SOLD: "تم البيع",
  PAUSED: "موقوف مؤقتاً",
};

export const CONDITION_LABEL_AR: Record<ConditionGrade, string> = {
  like_new: "كالجديد",
  excellent: "ممتازة",
  very_good: "جيدة جداً",
  good: "جيدة",
  acceptable: "مقبولة",
  for_parts: "لقطع الغيار",
};

export const USED_TYPE_LABEL_AR: Record<UsedType, string> = {
  cartridge: "شريط لعبة",
  console: "جهاز",
  controller: "يد تحكم",
  accessory: "ملحق",
  amiibo: "أميبو",
  bundle: "حزمة",
};

export const PACKAGING_LABEL_AR: Record<Packaging, string> = {
  cib: "كامل بعلبته",
  boxed_no_manual: "بعلبته بدون كتيّب",
  loose: "بدون علبة",
  sealed: "مغلق بالكرتون",
};

export const GUARANTEE_LABEL_AR: Record<Guarantee, string> = {
  tested_30days: "مفحوص — ضمان 30 يوماً",
  tested_14days: "مفحوص — ضمان 14 يوماً",
  tested_7days: "مفحوص — ضمان 7 أيام",
  tested_only: "مفحوص بدون ضمان",
  as_is: "يُباع كما هو",
};

/** The badge the storefront shows on an item the store took back. */
export const RETURNED_BADGE_AR = "مسترجع";
