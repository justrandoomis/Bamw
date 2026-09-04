/**
 * Cost is admin data, and every customer-facing path is held to that here.
 *
 * The shop's own rule is that cost and admin-only information must never
 * appear to a user. Four paths did not honour it, each for its own reason, and
 * none of them was a missing check — each was a place where the check that
 * exists was not reached:
 *
 *   - the buyer's own order returned `unitCost`, the acquisition cost of every
 *     line, because the redactor only ever removed the staged password;
 *   - `/api/hardware/$slug` returned the stored product document verbatim,
 *     because visibility was mistaken for a serializer;
 *   - `dlcs` was the one purchasable collection whose text was never checked;
 *   - the product's own description was never checked at all — only its
 *     variants' were.
 *
 * These are unit tests against the functions those paths use, so a route
 * rewritten later still has to pass them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toPublicProduct } from "./public-product.server";
import { customerSafeParagraph, looksLikeInternalNote } from "./internalMetadata";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("a product's own description", () => {
  it("loses a stored sale-price line", () => {
    const out = toPublicProduct({
      id: "gift-card",
      description: "بطاقة نينتندو إي شوب الأمريكية.\nسعر البيع: 7,000 د.ع\nتصل خلال دقائق.",
    });
    expect(String(out["description"])).not.toContain("سعر البيع");
  });

  it("keeps everything the line was sitting between", () => {
    const out = toPublicProduct({
      id: "gift-card",
      description: "بطاقة نينتندو إي شوب الأمريكية.\nسعر البيع: 7,000 د.ع\nتصل خلال دقائق.",
    });
    /*
      Dropping the whole field would leave a blank product page, which is not
      a smaller problem than the line it removed.
    */
    expect(String(out["description"])).toContain("بطاقة نينتندو إي شوب");
    expect(String(out["description"])).toContain("تصل خلال دقائق");
  });

  it("loses a supplier cost derivation", () => {
    const out = toPublicProduct({
      id: "x",
      description: "Supplier Regular / 普通版 converted to IQD using 1 CNY = 220 IQD",
    });
    expect(out["description"]).toBeUndefined();
  });
});

describe("every purchasable collection", () => {
  it("checks DLC text, not only editions and options", () => {
    const out = toPublicProduct({
      id: "x",
      dlcs: [{ id: "d1", name: "Expansion Pass", description: "التكلفة: 4,500 د.ع" }],
    });
    const dlc = (out["dlcs"] as Record<string, unknown>[])[0]!;
    expect(dlc["description"]).toBeUndefined();
    expect(dlc["name"]).toBe("Expansion Pass");
  });

  it("descends into a nested row collection nobody named in advance", () => {
    const out = toPublicProduct({
      id: "x",
      editions: [
        {
          id: "std",
          name: "Standard",
          perks: [
            { id: "p1", label: "wholesale price 4200" },
            { id: "p2", label: "يشمل اللعبة الأساسية" },
          ],
        },
      ],
    });
    const perks = (out["editions"] as Record<string, unknown>[])[0]!["perks"] as Record<
      string,
      unknown
    >[];
    expect(perks).toHaveLength(1);
    expect(perks[0]!["label"]).toBe("يشمل اللعبة الأساسية");
  });
});

describe("the price-line detector", () => {
  it("catches a stated figure", () => {
    expect(looksLikeInternalNote("سعر البيع: 7,000 د.ع")).toBe(true);
    expect(looksLikeInternalNote("الكلفة: 6,800")).toBe(true);
    expect(looksLikeInternalNote("margin: 700")).toBe(true);
  });

  it("leaves ordinary prose about value alone", () => {
    /*
      The colon is what separates a bookkeeping line from a sentence. Without
      it this pattern would eat legitimate copy, and a detector that removes
      real product descriptions is worse than the line it was added for.
    */
    expect(looksLikeInternalNote("أفضل سعر البيع في السوق العراقي")).toBe(false);
    expect(looksLikeInternalNote("لعبة ممتازة بسعر مناسب")).toBe(false);
  });

  it("returns nothing when a paragraph is entirely bookkeeping", () => {
    expect(customerSafeParagraph("سعر البيع: 7,000 د.ع")).toBeUndefined();
  });
});

describe("the routes that were returning cost", () => {
  it("the buyer's order redactor decides by audience, and cannot be called without one", () => {
    const text = source("src/routes/api/orders.ts");
    expect(text).toContain("function redactItems(items: OrderItem[], viewer: OrderViewer)");
    expect(text).toContain("viewer.isAdmin && unitCost !== undefined");
    // Every call states its audience — none is left to a default.
    for (const line of text.split("\n")) {
      if (!line.includes("redactOrder(")) continue;
      if (line.includes("export function redactOrder")) continue;
      expect(line, line.trim()).toMatch(/,\s*(user|ADMIN_VIEWER|viewer)\)/);
    }
  });

  it("the hardware route serializes rather than returning the stored row", () => {
    const text = source("src/routes/api/hardware/$slug.ts");
    expect(text).toContain("toPublicProduct(");
    expect(text).not.toMatch(/json\(\{\s*hardware,/);
  });

  it("the admin API states its own audience, once", () => {
    const text = source("src/routes/api/admin.orders.ts");
    expect(text).toContain("const ADMIN_VIEWER = { isAdmin: true }");
    for (const line of text.split("\n")) {
      if (!line.includes("redactOrder(")) continue;
      if (line.includes("import ")) continue;
      expect(line, line.trim()).toContain("ADMIN_VIEWER");
    }
  });

  it("the store payload redacts bundles instead of restoring the raw ones", () => {
    const text = source("src/routes/api/data.ts");
    expect(text).toContain("redactPrivateKeys(store.bundles");
  });
});
