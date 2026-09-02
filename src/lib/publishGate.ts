/**
 * What a product must have before a customer can see it.
 *
 * The catalogue work created 59 products hidden on purpose, and hidden is the
 * only thing standing between a half-researched record and a storefront page
 * with a blank cover and no description. Nothing enforced that: `isHidden` came
 * straight off the request body, so one bulk edit could publish all of them.
 *
 * This is deliberately a short list. It is not a quality score and it is not a
 * substitute for the details audit — it is the floor below which a page cannot
 * answer "what is this and what does it cost", which is the only question a
 * product page exists to answer. Anything richer belongs in the audit, where a
 * warning is the right response; here the response is a refusal.
 */

import { hiddenToggleState } from "./purchasable";

export interface PublishCheck {
  ok: boolean;
  /** Arabic, admin-facing: exactly what to fill in before publishing. */
  missing: string[];
}

/** A URL that will actually render, as opposed to a placeholder someone left. */
function usableImage(value: unknown): boolean {
  const url = String(value ?? "").trim();
  if (!url) return false;
  if (/^(undefined|null|n\/a|-|—)$/i.test(url)) return false;
  // `[Circular]` is what a bad serialiser leaves behind, and it is a non-empty
  // string, so a plain truthiness check reads it as a filled field.
  if (/^\[?circular\]?$/i.test(url)) return false;
  return /^(https?:\/\/|\/)/.test(url);
}

function text(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .trim();
}

const IMAGE_FIELDS = [
  "coverImage",
  "cartridgeImage",
  "mainImage",
  "listingImage",
  "image",
  "coverHiResImage",
  "nintendoCardImage",
];

const DESCRIPTION_FIELDS = ["description", "descriptionEn", "descriptionAr", "descriptionShort"];

/**
 * Checks one product against the publication floor.
 *
 * Takes a plain record rather than a `Product` so the endpoint can run it on
 * the object it is about to write, before anything has been narrowed to a type.
 */
export function checkPublishable(product: Record<string, unknown> | undefined): PublishCheck {
  const missing: string[] = [];
  if (!product) return { ok: false, missing: ["المنتج غير موجود"] };

  const title = text(product["title"]) || text(product["titleEn"]);
  if (!title) missing.push("اسم المنتج");

  /*
    Price is checked against cost, not against zero. A product priced at its
    supplier figure is the exact fault the pricing repair existed to remove, and
    publishing one sells it at no margin.
  */
  const price = Number(product["price"]);
  const cost = Number(product["cost"]);
  if (!Number.isFinite(price) || price <= 0) {
    missing.push("سعر بيع صحيح");
  } else if (Number.isFinite(cost) && cost > 0 && price <= cost) {
    missing.push("سعر بيع أعلى من التكلفة");
  }

  if (!IMAGE_FIELDS.some((field) => usableImage(product[field]))) {
    missing.push("صورة واحدة على الأقل");
  }

  const description = DESCRIPTION_FIELDS.map((field) => text(product[field])).find(
    (value) => value.length >= 40,
  );
  if (!description) missing.push("وصف لا يقل عن ٤٠ حرفاً");

  return { ok: missing.length === 0, missing };
}

/**
 * Whether this save is publishing something that was hidden.
 *
 * Three things this deliberately does not gate.
 *
 * A product that was already visible: the floor applies to the moment of
 * publication, not to every later edit, or a legacy record would become
 * uneditable until someone filled in fields the edit had nothing to do with.
 *
 * A product being created: `stored` is absent, and refusing new products would
 * be a much wider change than the one this exists for. The gate is about the 61
 * records that were created hidden on purpose and could be revealed in bulk.
 *
 * A save that leaves the product hidden: nothing reaches a customer.
 *
 * Hidden state is judged by `hiddenToggleState`, not `isHidden` alone: many of
 * the deliberately-hidden records carry their state as `is_hidden`,
 * `visibility` or `status: "مخفي"`, and now that an unhide save releases those
 * spellings too, reading only `isHidden` would let exactly those products
 * bypass the floor.
 */
export function isPublishing(
  stored: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): boolean {
  if (!stored) return false;
  return hiddenToggleState(stored) && !hiddenToggleState(next);
}
