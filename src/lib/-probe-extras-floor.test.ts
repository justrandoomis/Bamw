import { describe, expect, it } from "vitest";
import { repriceTiers, tierProblem } from "./tierRepricing";
import { dlcIncreaseFor } from "./repricing";

const game = (types: unknown[]) => ({ id: "p", title: "Game", kind: "game", schemaId: "game", types });
const ceilThousand = (v: number) => Math.ceil(v / 1000) * 1000;

describe("probe", () => {
  it("reproduces the reviewer's case", () => {
    const r = repriceTiers(game([
      { id: "offline_base", price: 5_000, cost: 2_000 },
      { id: "offline_extras", price: 9_999, cost: 2_300 },
    ]));
    const b = r.proposals[0]!, e = r.proposals[1]!;
    console.log("base", b.newPrice, "profit", b.newPrice - b.cost);
    console.log("extras", e.newPrice, "profit", e.newPrice - e.cost, "gate", tierProblem(e, r));
  });

  it("what the suggested floor would do to ordinary quarter-thousand costs", () => {
    const rows: string[] = [];
    for (const [bc, ec] of [[2000,2300],[1750,2250],[2000,2250],[1500,2250],[2000,3000],[1750,2500],[2000,2500]] as const) {
      const r = repriceTiers(game([
        { id: "offline_base", price: 5_000, cost: bc },
        { id: "offline_extras", price: 9_999, cost: ec },
      ]));
      const b = r.proposals[0]!, e = r.proposals[1]!;
      const gap = ec - bc;
      const floored = Math.max(e.newPrice, ec > 2000 ? ceilThousand(ec + 5000) : 5000);
      rows.push(`baseCost ${bc} basePrice ${b.newPrice} | extrasCost ${ec} gap ${gap} increase(owner) ${dlcIncreaseFor(gap)} -> current ${e.newPrice} (profit ${e.newPrice-e.cost}) | withFix ${floored} (increase ${floored-b.newPrice})`);
    }
    console.log(rows.join("\n"));
  });

  it("extras margin vs base margin, swept", () => {
    let worst = Infinity, worstCase = "";
    for (let bc = 250; bc <= 3000; bc += 250) {
      for (let g = 100; g <= 12000; g += 50) {
        const r = repriceTiers(game([
          { id: "offline_base", price: 5_000, cost: bc },
          { id: "offline_extras", price: 1, cost: bc + g },
        ]));
        const b = r.proposals[0]!, e = r.proposals[1]!;
        if (e.skipped) continue;
        const d = (e.newPrice - e.cost) - (b.newPrice - b.cost);
        if (d < worst) { worst = d; worstCase = `baseCost ${bc} gap ${g}: base ${b.newPrice}/${b.cost} extras ${e.newPrice}/${e.cost}`; }
        expect(tierProblem(e, r), worstCase).toBeNull();
      }
    }
    console.log("min(extras margin - base margin) =", worst, "at", worstCase);
  });
});
