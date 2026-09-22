import { describe, expect, it } from "vitest";
import { classifyTier } from "/home/user/Bamw/src/lib/tierPricing";
import { repriceTiers, tierProblem } from "/home/user/Bamw/src/lib/tierRepricing";

describe("probe", () => {
  it("classifies", () => {
    console.log("معيارية:", classifyTier({ id: "standard_offline", name: "النسخة المعيارية" }).kind);
    console.log("معتاد:", classifyTier({ id: "standard_offline", name: "الحساب المعتاد" }).kind);
    console.log("canonical plain:", classifyTier({ id: "standard_offline", name: "حساب أوفلاين — عادي" }).kind);
    console.log("canonical extras:", classifyTier({ id: "dlc_offline", name: "حساب أوفلاين — مع الإضافات" }).kind);
    console.log("bare id only:", classifyTier({ id: "standard_offline", name: "" }).kind);
  });

  it("what happens to a product whose plain offline is misread", () => {
    const r = repriceTiers({
      id: "p1", title: "Game", kind: "game",
      types: [
        { id: "standard_offline", name: "النسخة المعيارية", cost: 1700, price: 8000 },
        { id: "standard_online", name: "حساب أونلاين", cost: 16000, price: 26000 },
      ],
    });
    console.log(JSON.stringify(r, null, 1));
    console.log("problems:", r.proposals.map((p) => tierProblem(p, r)));
  });

  it("plain offline misread WITH a real dlc tier present", () => {
    const r = repriceTiers({
      id: "p2", title: "Game", kind: "game",
      types: [
        { id: "standard_offline", name: "النسخة المعيارية", cost: 2000, price: 8000 },
        { id: "dlc_offline", name: "مع الإضافات", cost: 7000, price: 15000 },
      ],
    });
    console.log(JSON.stringify(r, null, 1));
  });
});
