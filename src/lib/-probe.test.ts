import { describe, expect, it } from "vitest";
import { repriceTiers } from "./tierRepricing";

const brief = (r: any) =>
  r.proposals.map((p: any) => `${p.kind} cost=${p.cost} ${p.oldPrice}->${p.newPrice} skipped=${p.skipped ?? "-"} reason=${p.reason}`);

describe("probe", () => {
  it("console", () => {
    expect(brief(repriceTiers({
      id: "prd_console", title: "Nintendo Switch 2 جهاز", kind: "hardware",
      types: [
        { id: "offline_base", name: "اوفلاين", cost: 1000, price: 5000 },
        { id: "online_base", name: "اونلاين", cost: 27500, price: 30000 },
      ],
    }))).toEqual(["MARKER"]);
  });
  it("giftcard", () => {
    expect(brief(repriceTiers({
      id: "prd_card", title: "Nintendo eShop Gift Card HK",
      types: [{ id: "online_base", name: "اونلاين", cost: 17600, price: 18500 }],
    }))).toEqual(["MARKER"]);
  });
  it("hardware extras", () => {
    expect(brief(repriceTiers({
      id: "prd_hw", title: "جهاز", kind: "hardware",
      types: [
        { id: "offline_base", name: "اوفلاين", cost: 1000, price: 5000 },
        { id: "offline_extras", name: "اوفلاين مع الاضافات", cost: 3000, price: 6000 },
      ],
    }))).toEqual(["MARKER"]);
  });
  it("two dlc tiers", () => {
    expect(brief(repriceTiers({
      id: "prd_two_dlc", title: "Game",
      types: [
        { id: "offline_base", name: "اوفلاين", cost: 1000, price: 8000 },
        { id: "offline_dlc1", name: "اوفلاين dlc 1", cost: 2000, price: 10000 },
        { id: "offline_dlc2", name: "اوفلاين dlc 2", cost: 1500, price: 9000 },
      ],
    }))).toEqual(["MARKER"]);
  });
  it("outlier", () => {
    expect(brief(repriceTiers({
      id: "prd_out", title: "Console bundle",
      types: [{ id: "online_base", name: "اونلاين", cost: 450000, price: 500000 }],
    }))).toEqual(["MARKER"]);
  });
});
