/**
 * @vitest-environment node
 *
 * The two ways a template becomes a product must price it the same.
 *
 * `scripts/zip-import.mjs` has two: it creates a new product from
 * `buildBatchGameImport`, and it repairs an existing hidden one from the same
 * call. While the engine was the only thing that priced, a second derivation
 * in the script was a duplicate and agreed by construction. Once the builder
 * began reading prices out of the file, the duplicate stopped agreeing — and
 * it was the duplicate that was wrong.
 *
 * `16-mario-golf-super-rush` is the case, and it is a real file in the
 * archive:
 *
 *     type.1 offline  price=25000  cost=1250
 *     type.2 online   price=35000  cost=25000
 *
 * `mapSupplierCosts` sees the online row's 25,000 cost also standing as the
 * offline row's *price*, calls it the legacy copy, and takes the 35,000
 * selling price as the acquisition cost instead — then marks that up to
 * 45,000. The operator's own figures say 35,000 over a 25,000 cost.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildBatchGameImport } from "./gameImportForm";
import { mapSupplierCosts, priceGame, readyTierPricing } from "./nintendoPricing";
import { demandTierFor } from "./nintendoDemandTiers";

const FILE = "import-sources/nintendo-2026-08/16-mario-golf-super-rush.txt";

const tiersOf = (payload: Record<string, unknown>) =>
  Object.fromEntries(
    (payload["types"] as { id: string; price: number; cost: number }[]).map((type) => [
      type.id,
      { price: type.price, cost: type.cost },
    ]),
  );

describe("a template whose file states its prices", () => {
  const built = buildBatchGameImport(readFileSync(FILE, "utf8"), "cat_nintendo");

  it("is read as ready-priced and imports", () => {
    expect(built.ok).toBe(true);
  });

  it("keeps the operator's own numbers", () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(tiersOf(built.payload)).toMatchObject({
      offline_base: { price: 25_000, cost: 1_250 },
      online_base: { price: 35_000, cost: 25_000 },
    });
  });

  it("is priced differently by the engine, which is why nothing may re-derive it", () => {
    /*
      Pinned deliberately. This is not the engine being wrong in general — it
      is the engine reading a corrected file with the rules for a legacy one,
      which is exactly what `readyTierPricing` exists to notice. Anything that
      recomputes prices after the builder has set them reintroduces this.
    */
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const engine = priceGame(
      mapSupplierCosts(built.payload["types"] as never),
      "switch1",
      demandTierFor("mario-golf-super-rush-switch-1").tier,
    );
    const online = engine.tiers.find((tier) => tier.account === "online" && tier.content === "base");
    expect(online?.cost).toBe(35_000);
    expect(online?.cost).not.toBe(25_000);
  });
});

describe("the script's own pricing step", () => {
  it("no longer rewrites what the builder priced", () => {
    /*
      A source-level check, because the script is a bundled `.mjs` that reaches
      the application through esbuild and cannot be imported here. What it
      pins is the shape of the mistake: `applyPricing` returning a payload it
      rebuilt from `pricing.tiers` is what made the create path disagree with
      the repair path, so the catalogue's prices depended on how many times the
      importer had been run.
    */
    const source = readFileSync("scripts/zip-import.mjs", "utf8");
    const body = source.slice(
      source.indexOf("function applyPricing("),
      source.indexOf("function templateTypes("),
    );
    expect(body).toContain("return { payload,");
    expect(body).not.toContain("types: built,");
    // The guarantee is read off the rows that will be written, not off a
    // separate derivation of them.
    expect(body).toContain("rows.filter((t) => Number(t.price) <= Number(t.cost))");
  });
});
