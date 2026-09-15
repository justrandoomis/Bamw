import { describe, expect, it } from "vitest";

import { ACCESSORY_SCHEMA } from "./accessorySchema";
import { GIFT_CARD_SCHEMA } from "./giftCardSchema";
import { parseProductImport } from "./parser";
import { buildQualityReport, fieldApplies, fieldLevel } from "./quality";
import { USED_SCHEMA } from "./usedSchema";

describe("import quality report", () => {
  it("counts a category's own required fields, and names the blank ones", () => {
    const report = buildQualityReport(
      { title: "Nintendo eShop Card", cardType: "eshop" },
      GIFT_CARD_SCHEMA,
    );
    expect(report.required.total).toBe(6);
    expect(report.required.present).toBe(2);
    expect(report.required.missing).toEqual([
      "card_value",
      "card_currency",
      "card_region",
      "delivery_method",
    ]);
    expect(report.complete).toBe(false);
  });

  it("is complete once every required field is answered", () => {
    const report = buildQualityReport(
      {
        title: "Nintendo eShop Card 20 USD",
        cardType: "eshop",
        cardValue: "20 USD",
        cardCurrency: "USD",
        cardRegion: "US",
        deliveryMethod: "instant_code",
      },
      GIFT_CARD_SCHEMA,
    );
    expect(report.required).toMatchObject({ present: 6, total: 6, missing: [] });
    expect(report.complete).toBe(true);
  });

  it("treats false as an answer, so an honest 'no' is not a gap", () => {
    // `tested=false` is a statement about the item, not a missing value.
    const report = buildQualityReport(
      { title: "Used Switch", usedType: "console", conditionGrade: "good", tested: false },
      USED_SCHEMA,
    );
    expect(report.required.missing).toEqual(["condition_notes"]);
  });

  it("does not ask a charger for controller fields", () => {
    const charger = buildQualityReport(
      { title: "USB-C Charger", accessoryType: "charger" },
      ACCESSORY_SCHEMA,
    );
    const controller = buildQualityReport(
      { title: "Pro Controller", accessoryType: "controller" },
      ACCESSORY_SCHEMA,
    );
    // Both draw from the same schema; the conditional blocks differ.
    expect(charger.recommended.missing).not.toContain("hall_effect");
    expect(charger.warnings.join(" ")).not.toContain("hall_effect");
    expect(controller.required.total).toBe(charger.required.total);
  });

  it("warns about a missing listing image without failing the import", () => {
    const report = buildQualityReport({ title: "X", mainImage: "https://e.test/a.webp" }, USED_SCHEMA);
    expect(report.warnings.some((w) => w.includes("listing_image"))).toBe(true);
    expect(report.media).toBe(1);
  });

  it("reads a whole template through the parser and reports on it", () => {
    const file = [
      "schema_version=2",
      "name=Nintendo eShop Card 20 USD",
      "card_type=eshop",
      "card_value=20 USD",
      "card_currency=USD",
      "card_region=US",
      "delivery_method=instant_code",
      "main_image=https://example.test/card.webp",
      "listing_image=https://example.test/card-card.webp",
      "gallery.1.image=https://example.test/g1.webp",
      "source.1.name=Nintendo",
      "source.1.url=https://www.nintendo.com/",
      // Well past the numbers the template prints as examples.
      "redeem_step.11=افتح المتجر",
    ].join("\n");
    const parsed = parseProductImport(file, GIFT_CARD_SCHEMA);
    expect(parsed.errors.filter((e) => e.severity === "error")).toEqual([]);
    const report = buildQualityReport(parsed.data, GIFT_CARD_SCHEMA);
    expect(report.complete).toBe(true);
    expect(report.media).toBe(3);
    expect(report.sources).toBe(1);
    // `.11` is well past the highest index the template prints; the parser and
    // the report both read it as present.
    expect(report.recommended.missing).not.toContain("redeem_step");
    // Nothing required is missing, so no warning names a required field.
    expect(report.warnings.filter((w) => w.startsWith("حقل مطلوب"))).toEqual([]);
  });
});

describe("fieldLevel", () => {
  it("derives required from the parser's own blocking flag", () => {
    const cardType = GIFT_CARD_SCHEMA.fields.find((f) => f.key === "card_type")!;
    expect(cardType.required).toBe(true);
    expect(fieldLevel(cardType)).toBe("required");
  });

  it("leaves unlisted fields optional", () => {
    const barcode = GIFT_CARD_SCHEMA.fields.find((f) => f.key === "barcode")!;
    expect(fieldLevel(barcode)).toBe("optional");
  });
});

describe("conditional fields drive what an admin is shown", () => {
  it("hides controller fields on a charger and shows them on a controller", () => {
    const hallEffect = ACCESSORY_SCHEMA.fields.find((f) => f.key === "hall_effect");
    expect(hallEffect?.showFor).toEqual(["controller"]);

    expect(fieldApplies(hallEffect!, ACCESSORY_SCHEMA, { accessoryType: "charger" })).toBe(false);
    expect(fieldApplies(hallEffect!, ACCESSORY_SCHEMA, { accessoryType: "controller" })).toBe(true);
  });

  it("hides storage fields on a carrying case", () => {
    const readSpeed = ACCESSORY_SCHEMA.fields.find((f) => f.key === "read_speed");
    expect(readSpeed?.showFor).toEqual(["storage"]);
    expect(fieldApplies(readSpeed!, ACCESSORY_SCHEMA, { accessoryType: "case" })).toBe(false);
    expect(fieldApplies(readSpeed!, ACCESSORY_SCHEMA, { accessoryType: "storage" })).toBe(true);
  });

  it("keeps unconditional fields visible whatever the type", () => {
    const name = ACCESSORY_SCHEMA.fields.find((f) => f.key === "name")!;
    expect(fieldApplies(name, ACCESSORY_SCHEMA, { accessoryType: "cable" })).toBe(true);
    expect(fieldApplies(name, ACCESSORY_SCHEMA, {})).toBe(true);
  });

  it("hides every conditional block until the driving type is chosen", () => {
    // With no accessory_type there is no basis for showing one family over
    // another, so a new product starts with the shared fields only.
    const hallEffect = ACCESSORY_SCHEMA.fields.find((f) => f.key === "hall_effect")!;
    expect(fieldApplies(hallEffect, ACCESSORY_SCHEMA, {})).toBe(false);
  });
});

describe("the used editor asks each kind its own questions", () => {
  const byKey = (key: string) => USED_SCHEMA.fields.find((f) => f.key === key)!;

  it("does not ask a figurine for a platform, a warranty or an inspection", () => {
    const figure = { usedType: "collectible" };
    expect(fieldApplies(byKey("platform"), USED_SCHEMA, figure)).toBe(false);
    expect(fieldApplies(byKey("guarantee_status"), USED_SCHEMA, figure)).toBe(false);
    expect(fieldApplies(byKey("inspection_point"), USED_SCHEMA, figure)).toBe(false);
    expect(fieldApplies(byKey("usage_period_months"), USED_SCHEMA, figure)).toBe(false);
    // Its box is the one thing that does matter.
    expect(fieldApplies(byKey("packaging"), USED_SCHEMA, figure)).toBe(true);
  });

  it("asks a console everything and a cartridge only what applies", () => {
    const console_ = { usedType: "console" };
    const cartridge = { usedType: "cartridge" };
    expect(fieldApplies(byKey("usage_period_months"), USED_SCHEMA, console_)).toBe(true);
    expect(fieldApplies(byKey("serial_number"), USED_SCHEMA, console_)).toBe(true);
    expect(fieldApplies(byKey("usage_period_months"), USED_SCHEMA, cartridge)).toBe(false);
    expect(fieldApplies(byKey("serial_number"), USED_SCHEMA, cartridge)).toBe(false);
    expect(fieldApplies(byKey("platform"), USED_SCHEMA, cartridge)).toBe(true);
  });

  it("no longer asks a second-hand item about setup steps, options or critic scores", () => {
    // They describe a product the shop stocks, not one object somebody owns.
    for (const key of ["setup_step", "option", "variant", "review_score", "user_score"]) {
      expect(USED_SCHEMA.fields.find((f) => f.key === key)).toBeUndefined();
    }
  });
});

describe("audience classification", () => {
  it("marks SEO and research fields internal, and product copy customer-facing", () => {
    const byKey = (key: string) => USED_SCHEMA.fields.find((f) => f.key === key)!;
    expect(byKey("seo_title").audience).toBe("internal");
    expect(byKey("internal_notes").audience).toBe("internal");
    expect(byKey("data_gap").audience).toBe("internal");
    expect(byKey("field_source").audience).toBe("internal");
    expect(byKey("description_ar").audience).toBe("customer");
    expect(byKey("condition_notes").audience).toBe("customer");
  });
});
