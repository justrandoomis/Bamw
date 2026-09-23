import { it, expect } from "vitest";
import { fameBandFor } from "@/lib/repricing";
import { bestSellerRank } from "@/lib/bestSellers";
it("x", () => {
  const out = ["Game", "Mario Kart 8 Deluxe", "Animal Crossing: New Horizons", "Super Mario Odyssey", "Splatoon 2", "Luigi's Mansion 3", "Astral Chain", "Bayonetta 3", "Xenoblade Chronicles 3", "Super Smash Bros. Ultimate", "Pokemon Sword"]
    .map((t) => `${t} | rank=${bestSellerRank(t)} | ${fameBandFor(t)}`).join("\n");
  expect(out).toBe("");
});
