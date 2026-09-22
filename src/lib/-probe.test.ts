import { describe, expect, it } from "vitest";
import { normalizeProductRecord } from "./db.server";

// exact copy of scripts/tier-reprice.mjs patchProduct
const patchProduct = (before: any, perTier: Map<number, number>) => {
  const types = (Array.isArray(before["types"]) ? before["types"] : []).map((tier: any, index: number) =>
    perTier.has(index) ? { ...tier, price: perTier.get(index) } : tier,
  );
  return { ...before, types };
};

describe("write probe", () => {
  it("raw overlay row with only `variants`", () => {
    const raw = {
      id: "prd_v", title: "Game",
      variants: [
        { id: "offline_base", name: "اوفلاين", cost: 1000, price: 10250 },
        { id: "online_base", name: "اونلاين", cost: 20000, price: 40000 },
      ],
    };
    const normalized: any = normalizeProductRecord(raw);
    const guardPasses = Array.isArray(normalized.types) && normalized.types.length > 0;
    const patched = patchProduct(raw, new Map([[0, 10000]]));
    const afterNormalized: any = normalizeProductRecord(patched);
    expect({ guardPasses, patchedTypes: patched.types, afterTiers: afterNormalized.types.length,
             variantsStillThere: (patched as any).variants.length }).toEqual("MARKER");
  });

  it("raw overlay row whose types array has a falsy hole", () => {
    const raw = {
      id: "prd_h", title: "Game",
      types: [null, { id: "offline_base", name: "اوفلاين", cost: 1000, price: 10250 }],
    };
    const normalized: any = normalizeProductRecord(raw);
    const patched: any = patchProduct(raw, new Map([[0, 10000]]));
    expect({ normalizedFirstId: normalized.types[0]?.id, normalizedLen: normalized.types.length,
             patched0: patched.types[0], patched1: patched.types[1] }).toEqual("MARKER");
  });

  it("variants mirror goes stale after the overlay write", () => {
    const raw = {
      id: "prd_m", title: "Game",
      types: [{ id: "offline_base", name: "اوفلاين", cost: 1000, price: 10250 }],
      variants: [{ id: "offline_base", name: "اوفلاين", cost: 1000, price: 10250 }],
    };
    const patched: any = patchProduct(raw, new Map([[0, 10000]]));
    expect({ types: patched.types[0].price, variants: patched.variants[0].price }).toEqual("MARKER");
  });
});
