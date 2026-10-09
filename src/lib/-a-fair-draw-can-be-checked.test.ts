/**
 * «يكون السحب عادل عن طريق النظام يحدد التذكرة الفائزة»
 *
 * What makes the draw fair is checkable here: the same seed and tickets always
 * give the same picks (so a published draw can be re-run by anyone), every
 * ticket is equally likely, a member's extra tickets raise their chance but
 * never their prize count, and alternates come out of the same draw.
 */
import { describe, expect, it } from "vitest";

import { DRAW_ALGORITHM, drawPicks, newDrawSeed, poolDigest, type DrawTicket } from "./contestDraw";

const tickets = (holders: string[]): DrawTicket[] =>
  holders.map((holder, index) => ({ id: `e${index + 1}`, number: index + 1, holder }));

describe("the draw", () => {
  it("is the same every time for the same seed and tickets — anyone can re-run it", async () => {
    const pool = tickets(["a", "b", "c", "d", "e", "f", "g"]);
    const seed = newDrawSeed();
    const first = await drawPicks({ tickets: pool, seed, winners: 2, alternates: 2 });
    const again = await drawPicks({
      tickets: [...pool].reverse(),
      seed,
      winners: 2,
      alternates: 2,
    });
    expect(again).toEqual(first);
    expect(first.map((p) => p.alternate)).toEqual([false, false, true, true]);
    expect(first.map((p) => p.position)).toEqual([1, 2, 3, 4]);
    expect(DRAW_ALGORITHM).toBe("hmac-sha256-rejection-v1");
  });

  it("gives every ticket the same chance", async () => {
    const pool = tickets(["a", "b", "c", "d", "e"]);
    const counts = new Map<string, number>();
    const runs = 2500;
    for (let i = 0; i < runs; i += 1) {
      const [pick] = await drawPicks({ tickets: pool, seed: newDrawSeed(), winners: 1 });
      counts.set(pick!.holder, (counts.get(pick!.holder) ?? 0) + 1);
    }
    for (const holder of ["a", "b", "c", "d", "e"]) {
      // 500 expected each; ±25% is far outside chance for a fair draw.
      expect(counts.get(holder) ?? 0).toBeGreaterThan(375);
      expect(counts.get(holder) ?? 0).toBeLessThan(625);
    }
  });

  it("lets extra tickets raise a chance, never the number of prizes", async () => {
    const pool = tickets(["whale", "whale", "whale", "whale", "b", "c"]);
    for (let i = 0; i < 50; i += 1) {
      const picks = await drawPicks({ tickets: pool, seed: newDrawSeed(), winners: 3 });
      expect(new Set(picks.map((p) => p.holder)).size).toBe(3);
    }
  });

  it("stops when the pool runs out rather than inventing winners", async () => {
    const picks = await drawPicks({
      tickets: tickets(["a", "a", "b"]),
      seed: newDrawSeed(),
      winners: 2,
      alternates: 3,
    });
    expect(picks).toHaveLength(2);
  });

  it("fingerprints the pool, so a ticket added afterwards shows", async () => {
    const pool = tickets(["a", "b", "c"]);
    const digest = await poolDigest(pool);
    expect(await poolDigest([...pool].reverse())).toBe(digest);
    expect(await poolDigest([...pool, { id: "e4", number: 4, holder: "d" }])).not.toBe(digest);
  });
});
