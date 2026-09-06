/**
 * The acceptance matrix: one populated product per non-game category, taken
 * from its real import template through the parser, the view model and the
 * section registry.
 *
 * What this is guarding is the end-to-end claim — TEMPLATE → PARSE →
 * NORMALIZE → VIEW → ONLY POPULATED SECTIONS — for exactly the product kinds
 * the store sells.
 */

import { describe, expect, it } from "vitest";

import { buildQualityReport } from "./quality";
import { buildProductView } from "./productView";
import { resolveSections } from "./sectionRegistry";
import { FIXTURES, FIXTURE_IDS } from "@/test/product-fixtures";
import { resolveProductImage } from "@/lib/productImages";

const sectionIds = (id: string) => {
  const fixture = FIXTURES[id]!;
  const view = buildProductView(fixture.product, "ar", fixture.schema);
  if (!view) throw new Error(`no view for ${id}`);
  return { view, ids: resolveSections(view).map((s) => s.id) };
};

describe("every fixture template parses without an error", () => {
  it.each(FIXTURE_IDS)("%s", (id) => {
    const blocking = FIXTURES[id]!.errors.filter((e) => e.severity === "error");
    expect(blocking).toEqual([]);
  });
});

describe("every fixture satisfies its category's required fields", () => {
  it.each(FIXTURE_IDS)("%s", (id) => {
    const fixture = FIXTURES[id]!;
    const report = buildQualityReport(fixture.product, fixture.schema);
    expect(report.required.missing).toEqual([]);
    expect(report.complete).toBe(true);
  });
});

describe("every fixture resolves an image for every storefront context", () => {
  /*
    The hero comes from a named single-image role — never a gallery frame and
    never the placeholder. That is the rule; `main` was merely the answer it
    always happened to give while one chain served every category.

    A gift card leads with its own artwork now, because its artwork *is* the
    product: `cover_image` when the owner has uploaded one, `card_artwork` from
    the import when they have not. Asserting the field name rather than the
    property would fail here for a card doing exactly the right thing.
  */
  const HERO_ROLES = ["cover", "artwork", "main", "front", "packagingFront"];

  it.each(FIXTURE_IDS)("%s", (id) => {
    const product = FIXTURES[id]!.product;
    for (const context of ["listing", "hero", "thumbnail"] as const) {
      // No placeholder, and never a gallery frame standing in for the hero.
      expect(resolveProductImage(product, context).isPlaceholder).toBe(false);
    }
    expect(HERO_ROLES).toContain(resolveProductImage(product, "hero").source);
  });

  it("gives a gift card its own artwork as the hero, not a shared photograph", () => {
    const card = FIXTURES["gift_card"]!.product;
    expect(resolveProductImage(card, "hero").source).toBe("artwork");
    // And every other fixture still leads with its main photograph.
    for (const id of FIXTURE_IDS.filter((each) => each !== "gift_card")) {
      expect(resolveProductImage(FIXTURES[id]!.product, "hero").source).toBe("main");
    }
  });
});

describe("each category's page is built from its own sections", () => {
  it("a used console leads with condition and inspection", () => {
    const { ids } = sectionIds("used_console");
    expect(ids).toContain("condition");
    expect(ids).toContain("inspection");
    expect(ids.indexOf("condition")).toBeLessThan(ids.indexOf("overview"));
    expect(ids).not.toContain("cardDetails");
    expect(ids).not.toContain("bundleContents");
    expect(ids).not.toContain("amiiboFunctionality");
  });

  it("a gift card shows redemption and region, and no hardware specifications", () => {
    const { view, ids } = sectionIds("gift_card");
    expect(ids).toContain("cardDetails");
    expect(ids).toContain("howToRedeem");
    expect(ids).toContain("requirements");
    expect(ids).not.toContain("specs");
    expect(ids).not.toContain("boxContents");
    expect(view.giftCard?.regionLocked).toBe(true);
    // Five redemption steps, including one written at index 9.
    expect(view.usageSteps).toHaveLength(5);
  });

  it("a bundle resolves its items and derives the saving from them", () => {
    const { view, ids } = sectionIds("bundle");
    expect(ids).toContain("bundleContents");
    expect(view.bundle?.items).toHaveLength(3);
    expect(view.bundle?.totalValue).toBe(155000);
    // Derived against the live price (25 000), not the number an editor typed.
    expect(view.bundle?.savingsAmount).toBe(130000);
    expect(view.bundle?.savingsPercent).toBe(84);
  });

  it("an amiibo shows its per-game table and no duplicate specification section", () => {
    const { view, ids } = sectionIds("amiibo");
    expect(ids).toContain("gameCompatibility");
    expect(ids).toContain("amiiboFunctionality");
    expect(ids).toContain("collector");
    expect(ids).not.toContain("specs");
    expect(view.gameCompatibility).toHaveLength(3);
    expect(view.amiibo?.compatibleConsoles).toEqual([
      "Nintendo Switch",
      "Nintendo Switch 2",
      "Wii U",
    ]);
  });

  it("accessory subtypes carry different fields, and none carry another's", () => {
    const controller = FIXTURES["accessory_controller"]!.product;
    const charger = FIXTURES["accessory_charger"]!.product;
    const storage = FIXTURES["accessory_storage"]!.product;
    const bag = FIXTURES["accessory_case"]!.product;

    expect(controller["hallEffect"]).toBe(true);
    expect(charger["hallEffect"]).toBeUndefined();
    expect(charger["maximumWattage"]).toBe(65);
    expect(storage["readSpeed"]).toBe("880");
    expect(storage["maximumWattage"]).toBeUndefined();
    expect(bag["gameCardSlots"]).toBe(10);
    expect(bag["capacity"]).toBeUndefined();
  });

  it("never renders a section a category has no data for", () => {
    for (const id of FIXTURE_IDS) {
      const { view, ids } = sectionIds(id);
      for (const sectionId of ids) {
        // The registry's own predicate is the page's only reason to render.
        expect(ids.filter((other) => other === sectionId)).toHaveLength(1);
      }
      // Nothing here has firmware updates, external reviews or documents.
      expect(ids).not.toContain("updates");
      expect(ids).not.toContain("reviews");
      expect(ids).not.toContain("documentation");
      expect(view.updates).toEqual([]);
    }
  });

  it("shows one description, in Arabic, not five stacked paragraphs", () => {
    const fixture = FIXTURES["used_cartridge"]!;
    const ar = buildProductView(fixture.product, "ar", fixture.schema)!;
    const en = buildProductView(fixture.product, "en", fixture.schema)!;
    expect(ar.descriptionFull).toContain("نسخة مستعملة");
    expect(ar.descriptionFull).not.toContain("A tested pre-owned copy");
    expect(en.descriptionFull).toContain("A tested pre-owned copy");
  });

  it("orders the gallery by image role, hero first", () => {
    const fixture = FIXTURES["amiibo"]!;
    const view = buildProductView(fixture.product, "ar", fixture.schema)!;
    expect(view.images[0]).toContain("main");
    expect(view.images[1]).toContain("front");
    expect(view.images.at(-1)).toContain("g12");
  });
});
