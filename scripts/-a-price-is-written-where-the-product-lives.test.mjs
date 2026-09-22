/**
 * The catalogue has two homes, and the apply wrote to one of them.
 *
 * On 2026-09-22 the owner's new ceiling was applied to 446 games. The run
 * FAILED — correctly — because `reprice.mjs`'s own read-back found products
 * still sitting at the price they started with:
 *
 *   prd_cat_contra-anniversary-collection ما زال 8000، والمطلوب 7000
 *   prd_cat_metroid-prime-4-beyond        ما زال 8000، والمطلوب 7000
 *   prd_34be2de35cbe4d6b.price = 14500، والمتوقع 9000      (Mario Kart World)
 *
 * `loadStore` merges the chunked catalogue with the granular
 * `store:product:<id>` rows and lets the GRANULAR one win, while `updateStore`
 * writes only the chunks. So for those products the write succeeded, the
 * shopper went on seeing the old price, and nothing said why.
 *
 * `tier-reprice.mjs` already knew this — it had the whole two-path write, with
 * a comment explaining it. `reprice.mjs` did not. One script knowing something
 * the other needs is the fault underneath the fault, so the knowledge now lives
 * in `scripts/lib/store-overlay.mjs` and BOTH ask it. That is asserted here as
 * well as the behaviour, because a second copy reappearing is how this returns.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bumpAfterOverlayWrites,
  overlayProductIds,
  readOverlayProduct,
  writeOverlayProduct,
} from "./lib/store-overlay.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const read = (file) => readFileSync(path.resolve(here, file), "utf8");

/** A stand-in for the bundled app module, recording every statement. */
function fakeApp(rows = {}) {
  const calls = { run: [], bumps: 0 };
  return {
    calls,
    async d1All(sql, param) {
      if (sql.includes("LIKE 'store:product:%'")) {
        return Object.keys(rows).map((key) => ({ key }));
      }
      if (sql.includes("WHERE key = ?")) {
        const value = rows[String(param)];
        return value === undefined ? [] : [{ value }];
      }
      return [];
    },
    async d1Run(sql, ...params) {
      calls.run.push({ sql, params });
    },
    async bumpCatalogVersion() {
      calls.bumps += 1;
    },
  };
}

describe("which products are not served from the chunks", () => {
  it("lists the ids that own a granular row", async () => {
    const app = fakeApp({
      "store:product:prd_a": "{}",
      "store:product:prd_cat_metroid-prime-4-beyond": "{}",
    });
    const ids = await overlayProductIds(app);
    expect([...ids].sort()).toEqual(["prd_a", "prd_cat_metroid-prime-4-beyond"]);
  });

  it("is empty, not undefined, when the catalogue has none", async () => {
    expect([...(await overlayProductIds(fakeApp({})))]).toEqual([]);
  });
});

describe("the raw document, read before anything is written", () => {
  it("returns the row exactly as stored", async () => {
    const app = fakeApp({
      "store:product:prd_a": JSON.stringify({ id: "prd_a", price: 8000, cost: 1496 }),
    });
    expect(await readOverlayProduct(app, "prd_a")).toEqual({
      id: "prd_a",
      price: 8000,
      cost: 1496,
    });
  });

  it("refuses a row whose id is not the id asked for", async () => {
    /*
      The row a shopper is served. Writing a patched copy of the WRONG product
      over it would move a price the rules never looked at.
    */
    const app = fakeApp({ "store:product:prd_a": JSON.stringify({ id: "prd_b", price: 8000 }) });
    expect(await readOverlayProduct(app, "prd_a")).toBeNull();
  });

  it("refuses a row that will not parse, rather than overwriting it", async () => {
    const app = fakeApp({ "store:product:prd_a": "{not json" });
    expect(await readOverlayProduct(app, "prd_a")).toBeNull();
  });

  it("refuses a row that is not there", async () => {
    expect(await readOverlayProduct(fakeApp({}), "prd_a")).toBeNull();
  });
});

describe("the write goes to the row the shopper is served from", () => {
  it("upserts the granular row, keyed by the product id", async () => {
    const app = fakeApp();
    await writeOverlayProduct(app, "prd_a", { id: "prd_a", price: 7000 }, "2026-09-22T00:00:00Z");
    expect(app.calls.run).toHaveLength(1);
    const [call] = app.calls.run;
    expect(call.sql).toContain("INSERT INTO store_kv");
    expect(call.sql).toContain("ON CONFLICT(key) DO UPDATE");
    expect(call.params[0]).toBe("store:product:prd_a");
    expect(JSON.parse(call.params[1])).toEqual({ id: "prd_a", price: 7000 });
  });

  it("moves the catalogue version after a granular write, and only then", async () => {
    /*
      `updateStore` moves `store_rev` inside its own transaction; the bare
      INSERT above moves nothing. Without the bump the edge keeps serving the
      old price from a cache keyed on a version that did not change — a write
      that succeeded and that nobody sees.
    */
    const app = fakeApp();
    await bumpAfterOverlayWrites(app, 0);
    expect(app.calls.bumps).toBe(0);
    await bumpAfterOverlayWrites(app, 3);
    expect(app.calls.bumps).toBe(1);
  });
});

describe("neither script keeps its own copy of this", () => {
  const reprice = read("reprice.mjs");
  const tier = read("tier-reprice.mjs");

  it("both import the shared module", () => {
    for (const [name, source] of [
      ["reprice.mjs", reprice],
      ["tier-reprice.mjs", tier],
    ]) {
      expect(source, name).toContain('from "./lib/store-overlay.mjs"');
      expect(source, name).toContain("overlayProductIds(app)");
    }
  });

  it("neither still writes a `store:product:` row by hand", () => {
    /*
      A source-text check, deliberately, because what it guards is a property
      of the SOURCE and not of a run: that the knowledge has not been forked
      again. The behaviour above is tested by running it.
    */
    for (const [name, source] of [
      ["reprice.mjs", reprice],
      ["tier-reprice.mjs", tier],
    ]) {
      expect(source, name).not.toContain("INSERT INTO store_kv");
      expect(source, name).not.toContain("LIKE 'store:product:%'");
    }
  });

  it("the price apply routes its write through both paths", () => {
    expect(reprice).toContain("const overlayWrites =");
    expect(reprice).toContain("const chunkWrites =");
    expect(reprice).toContain("await writeOverlayProduct(app, id,");
    expect(reprice).toContain("await bumpAfterOverlayWrites(app, overlayWrites.length)");
  });

  it("re-checks with the SAME generation the proposal was made with", () => {
    /*
      The second fault of the same apply, and a worse one because it accused
      the write of a failure that had not happened.

      `repriceAll` is asked twice: once to propose, once — after the write —
      to prove the catalogue now satisfies the rules. The proposal passed
      `isSwitch2` and the re-check did not, so every game was re-checked as a
      Switch 1 title, whose rung is 7,000. Ninety Switch 2 games sitting
      correctly at 8,000 came back as «ما زال 8000، والمطلوب 7000» and failed
      a run that had written exactly what it meant to.

      Counted rather than eyeballed: every place in the script that builds a
      product for the rules must carry the generation, because a verification
      that asks a different question from the rule it verifies is not a
      verification.
    */
    // `app` and `.repriceAll(` are not always on one line.
    const asks = reprice.match(/app\s*\.\s*reprice(All|One)\(/g) ?? [];
    const flags = reprice.match(/isSwitch2:\s*app\.isNintendoSwitch2Product\(/g) ?? [];
    expect(asks.length).toBeGreaterThan(1);
    expect(flags.length, `${asks.length} calls to the rules, ${flags.length} carry the generation`)
      .toBe(asks.length);
  });

  it("and rehearses against the raw row, not the merged product", () => {
    // Rehearsing a normalized copy while writing the raw row rehearses a
    // document that never existed.
    expect(reprice).toContain("const before = rawOverlay.get(id) ?? byId.get(id);");
  });
});
