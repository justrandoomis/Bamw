import { describe, expect, it } from "vitest";

import { buildBatchGameImport, buildBatchSchemaImport } from "../gameImportForm";
import { generateTemplate } from "./generator";
import { PRODUCT_SCHEMAS, detectSchemaId, getSchema } from "./registry";
import { ACCESSORY_SCHEMA } from "./accessorySchema";
import { GIFT_CARD_SCHEMA } from "./giftCardSchema";
import { sanitizeSlug } from "../productSlug";

/**
 * The batch importer across the registry.
 *
 * The point of the schema registry is that one importer serves every category.
 * These tests hold that: a file for any schema in the registry goes through the
 * same builder and comes out as a save payload, the Nintendo path is untouched,
 * and nothing a batch produces is visible before someone looks at it.
 */

const accessoryFile = `
schema_version=${ACCESSORY_SCHEMA.version}
name=Nintendo Switch 2 Pro Controller
accessory_type=controller
price=95000
cost=72000
description_ar<<EOF
يد تحكم رسمية بمقبض مريح وبطارية تدوم طويلاً.
EOF
`;

const giftCardFile = `
schema_version=${GIFT_CARD_SCHEMA.version}
name=Nintendo eShop Card 50 USD
card_type=eshop
delivery_method=instant_code
price=78000
cost=71000
`;

describe("the registry decides which parser a file gets", () => {
  it("routes a store category onto its schema", () => {
    expect(detectSchemaId({ category: "cat_accessories" })).toBe("accessory");
    expect(detectSchemaId({ category: "cat_gift_cards" })).toBe("gift_card");
    expect(detectSchemaId({ category: "cat_used" })).toBe("used");
  });

  it("leaves Nintendo games outside the registry, on their own pipeline", () => {
    expect(detectSchemaId({ category: "cat_nintendo" })).toBeUndefined();
  });
});

describe("buildBatchSchemaImport", () => {
  it("turns an accessory template into a save payload", () => {
    const built = buildBatchSchemaImport(accessoryFile, "cat_accessories", ACCESSORY_SCHEMA);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.title || built.payload.titleEn).toContain("Pro Controller");
    expect(built.payload.schemaId).toBe("accessory");
    /*
      The template does not carry a slug and the payload does not invent one —
      the endpoint derives it from the English title. The dry run has to predict
      the same answer to warn about duplicates before anything is written, so
      this pins that the prediction and the endpoint use one rule.
    */
    expect(built.payload.slug).toBe("");
    expect(sanitizeSlug(String(built.payload.titleEn || built.payload.title), "prd_x")).toBe(
      "nintendo-switch-2-pro-controller",
    );
  });

  it("stores every batch product hidden and flags the run as a batch", () => {
    for (const [file, schema] of [
      [accessoryFile, ACCESSORY_SCHEMA],
      [giftCardFile, GIFT_CARD_SCHEMA],
    ] as const) {
      const built = buildBatchSchemaImport(file, schema.categoryId, schema);
      expect(built.ok, schema.id).toBe(true);
      if (!built.ok) continue;
      // Hidden is the whole quality gate: a batch never publishes anything.
      expect(built.payload.isHidden, schema.id).toBe(true);
      expect(built.payload.batchImport, schema.id).toBe(true);
    }
  });

  it("refuses a file with no product name rather than saving a blank product", () => {
    const built = buildBatchSchemaImport(
      "schema_version=1\naccessory_type=controller\nprice=1000\n",
      "cat_accessories",
      ACCESSORY_SCHEMA,
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toContain("name");
  });

  it("refuses a file missing a field its own schema requires", () => {
    // `accessory_type` decides which specification fields even apply, so an
    // accessory without one is not a product the store can describe.
    const built = buildBatchSchemaImport(
      "schema_version=1\nname=Some Accessory\n",
      "cat_accessories",
      ACCESSORY_SCHEMA,
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toContain("accessory_type");
  });

  it("refuses an unterminated multi-line block instead of swallowing the rest of the file", () => {
    const built = buildBatchSchemaImport(
      "name=Thing\ndescription_ar<<EOF\nnever closed\n",
      "cat_accessories",
      ACCESSORY_SCHEMA,
    );
    expect(built.ok).toBe(false);
  });

  it("reports quality, so a file that merely parses is not mistaken for a finished one", () => {
    const thin = buildBatchSchemaImport(
      "schema_version=1\nname=Some Accessory\naccessory_type=controller\n",
      "cat_accessories",
      ACCESSORY_SCHEMA,
    );
    const fuller = buildBatchSchemaImport(accessoryFile, "cat_accessories", ACCESSORY_SCHEMA);
    expect(thin.ok && fuller.ok).toBe(true);
    if (!thin.ok || !fuller.ok) return;
    const score = (r: typeof thin.quality) => (r ? r.required.present + r.recommended.present : -1);
    expect(score(fuller.quality)).toBeGreaterThan(score(thin.quality));
  });

  it("accepts the blank template every schema generates", () => {
    for (const schema of PRODUCT_SCHEMAS) {
      const blank = generateTemplate(schema);
      const built = buildBatchSchemaImport(blank, schema.categoryId, schema);
      /*
        A blank template has no name, so it is rightly refused — what matters is
        that it is refused for a missing *field* and not because the generator
        emits something its own parser cannot read.
      */
      expect(built.ok, schema.id).toBe(false);
      if (built.ok) continue;
      expect(built.reason, schema.id).toMatch(/^name: /);
    }
  });

  it("names every schema the registry exposes, so a new one cannot be silently unreachable", () => {
    for (const schema of PRODUCT_SCHEMAS) {
      expect(getSchema(schema.id), schema.id).toBe(schema);
    }
  });
});

describe("the Nintendo path validates commercial data", () => {
  it("refuses a batch template that has no separate supplier costs", () => {
    /*
      A complete file apart from the thing under test. Without the performance
      record the refusal is about that instead, and this test would pass or
      fail on a rule it is not about.
    */
    const built = buildBatchGameImport(
      "schema_version=1\nname=Some Game\nplatform=switch1\nprice=25000\n" +
        "device_performance.1.device=Nintendo Switch\n" +
        "device_performance.1.information_status=not_published\n" +
        "device_performance.1.unavailable_reason=Nintendo has not published performance figures.\n" +
        "device_performance.1.source_name=Nintendo eShop\n" +
        "device_performance.1.verification_status=checked\n",
      "cat_nintendo",
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toMatch(/فئة طلب|التكاليف/);
  });
});
