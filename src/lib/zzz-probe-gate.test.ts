import { describe, expect, it } from "vitest";
import { appendFileSync } from "node:fs";
const OUT = "/tmp/claude-0/-home-user-Bamw/d1b09a47-395d-5471-85c8-02e064d1646e/scratchpad/probe.txt";
const console = { log: (...a: unknown[]) => appendFileSync(OUT, a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ") + "\n") };
import { repriceTiers, tierProblem } from "./tierRepricing";

const at = (r: ReturnType<typeof repriceTiers>, k: string) => r.proposals.filter((p) => p.kind === k);

describe("probe", () => {
  it("A: non-game kind — do online/extras tiers still move?", () => {
    const r = repriceTiers({
      id: "hw", title: "Nintendo Switch 2 Console", kind: "hardware",
      types: [
        { id: "offline_base", price: 8_000, cost: 2_000 },
        { id: "offline_extras", price: 15_000, cost: 7_000 },
        { id: "online_base", price: 500_000, cost: 450_000 },
      ],
    });
    console.log("A:", JSON.stringify(r.proposals.map(p => [p.kind, p.oldPrice, p.newPrice, p.changed, p.skipped]), null, 1));
    console.log("A gate:", r.proposals.map(p => tierProblem(p, r)));
  });

  it("B: gift-card title with tiers", () => {
    const r = repriceTiers({
      id: "gc", title: "Nintendo eShop Card HK 1000", kind: "game",
      types: [
        { id: "offline_base", price: 18_500, cost: 17_600 },
        { id: "offline_extras", price: 19_000, cost: 18_600 },
        { id: "online_base", price: 18_500, cost: 17_600 },
      ],
    });
    console.log("B:", JSON.stringify(r.proposals.map(p => [p.kind, p.oldPrice, p.newPrice, p.changed, p.skipped]), null, 1));
    console.log("B gate:", r.proposals.map(p => tierProblem(p, r)));
  });

  it("C: two offline_extras rows — second priced from the first's gap?", () => {
    const r = repriceTiers({
      id: "two", title: "Game", kind: "game",
      types: [
        { id: "offline_base", name: "اوفلاين عادي", price: 8_000, cost: 1_000 },
        { id: "t2", name: "اوفلاين مع الاضافات", price: 9_000, cost: 1_300 },
        { id: "t3", name: "اوفلاين مع كل الاضافات", price: 30_000, cost: 8_500 },
      ],
    });
    console.log("C:", JSON.stringify(r.proposals.map(p => [p.kind, p.cost, p.oldPrice, p.newPrice, p.changed, p.skipped, p.reason]), null, 1));
    console.log("C gate:", r.proposals.map(p => tierProblem(p, r)));
  });

  it("D: two offline_base rows", () => {
    const r = repriceTiers({
      id: "twob", title: "Game", kind: "game",
      types: [
        { id: "b1", name: "اوفلاين", price: 5_000, cost: 1_000 },
        { id: "b2", name: "offline account", price: 30_000, cost: 20_000 },
        { id: "e1", name: "offline dlc", price: 6_000, cost: 1_500 },
      ],
    });
    console.log("D:", JSON.stringify(r.proposals.map(p => [p.kind, p.cost, p.oldPrice, p.newPrice, p.changed]), null, 1));
    console.log("D gate:", r.proposals.map(p => tierProblem(p, r)));
  });

  it("E: outlier online tier on a plain game", () => {
    const r = repriceTiers({
      id: "big", title: "Game", kind: "game",
      types: [{ id: "online_base", price: 30_000, cost: 450_000 }],
    });
    console.log("E:", JSON.stringify(r.proposals.map(p => [p.kind, p.cost, p.oldPrice, p.newPrice, p.changed]), null, 1));
    console.log("E gate:", r.proposals.map(p => tierProblem(p, r)));
  });

  it("F: base skipped by OUTLIER, extras still moves", () => {
    const r = repriceTiers({
      id: "o", title: "Game", kind: "game",
      types: [
        { id: "offline_base", price: 120_000, cost: 90_000 },
        { id: "offline_extras", price: 1_000, cost: 95_000 },
      ],
    });
    console.log("F:", JSON.stringify(r.proposals.map(p => [p.kind, p.cost, p.oldPrice, p.newPrice, p.changed, p.skipped]), null, 1));
    console.log("F gate:", r.proposals.map(p => tierProblem(p, r)));
  });
});
