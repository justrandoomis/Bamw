/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { appendFileSync } from "node:fs";
const OUT = "/tmp/claude-0/-home-user-Bamw/d1b09a47-395d-5471-85c8-02e064d1646e/scratchpad/out.txt";
const log = (...a: any[]) => appendFileSync(OUT, a.map((x)=>typeof x === "string" ? x : JSON.stringify(x)).join(" ") + "\n");
import { parseGameImport } from "./gameImportParser";
import { applyGameImportToForm, buildBatchGameImport, createBlankProductForm } from "./gameImportForm";
import { mapSupplierCosts, priceGame, readyTierPricing, isExtrasRow, type TemplateType, type AccountKind, type ContentKind, type SupplierCosts } from "./nintendoPricing";

const gameTemplate = (name: string, extra = "") => `
schema_version=1
name=${name}
slug=super-smash-bros-ultimate
platform=switch1
device_performance.1.device=Nintendo Switch
device_performance.1.information_status=not_published
device_performance.1.unavailable_reason=Nintendo has not published performance figures.
device_performance.1.source_name=Nintendo eShop
device_performance.1.verification_status=checked
price=25000
cost=18000
is_infinite_stock=true

option.1.id=offline_account
option.1.name=حساب أوفلاين
option.1.stock=
option.1.is_infinite_stock=true

option.2.id=online_account
option.2.name=حساب أونلاين
option.2.stock=4
option.2.is_infinite_stock=false

type.1.id=standard_offline
type.1.name=النسخة القياسية
type.1.option_id=offline_account
type.1.price=25000
type.1.cost=18000
type.1.stock=
type.1.is_infinite_stock=true

type.2.id=standard_online
type.2.name=النسخة القياسية
type.2.option_id=online_account
type.2.price=32000
type.2.cost=24000
type.2.stock=2
type.2.is_infinite_stock=false
${extra}`;

const num = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The ORIGINAL pre-change mapSupplierCosts, copied from git HEAD. */
function oldMapSupplierCosts(types: readonly TemplateType[]): SupplierCosts {
  const out: SupplierCosts = { unmapped: [] };
  const offlineAmounts = new Set<number>();
  const rowsByAccount = {
    offline: types.filter((type) => type.optionId === "offline_account"),
    online: types.filter((type) => type.optionId === "online_account"),
  };
  for (const type of types) {
    if (type.optionId !== "offline_account") continue;
    const cost = num(type.cost);
    const price = num(type.price);
    if (cost !== null) offlineAmounts.add(cost);
    if (price !== null) offlineAmounts.add(price);
  }
  for (const type of types) {
    const account: AccountKind | null =
      type.optionId === "offline_account" ? "offline" : type.optionId === "online_account" ? "online" : null;
    if (!account) {
      out.unmapped.push(`${type.name ?? type.id ?? "?"} — no recognisable option`);
      continue;
    }
    const accountRows = rowsByAccount[account];
    const rowIndex = accountRows.indexOf(type);
    const content: ContentKind =
      rowIndex >= 0 ? (rowIndex === 0 ? "base" : "extras") : isExtrasRow(type.name) ? "extras" : "base";
    const parsedCost = num(type.cost);
    const parsedPrice = num(type.price);
    const useOnlineCost = account === "online" && parsedCost !== null && !offlineAmounts.has(parsedCost);
    const amount = account === "offline" ? (parsedCost ?? parsedPrice) : useOnlineCost ? parsedCost : parsedPrice;
    if (amount === null) {
      out.unmapped.push(`${type.name ?? type.id ?? "?"} — no usable amount`);
      continue;
    }
    const key = `${account}${content === "base" ? "Base" : "Extras"}` as const;
    if (out[key]) {
      out.unmapped.push(`${type.name ?? type.id ?? "?"} — ${key} was already taken`);
      continue;
    }
    out[key] = { amount, source: `${type.name ?? type.id ?? "?"} (${account === "offline" || useOnlineCost ? "cost" : "price"} field)` };
  }
  return out;
}

describe("regression scratch", () => {
  it("dumps parsed types + old and new pricing for the suite fixture", () => {
    const parsed = parseGameImport(gameTemplate("Zelda Echoes"));
    const form = applyGameImportToForm(createBlankProductForm("cat_nintendo"), parsed.data);
    const sourceTypes = form.types;
    log("PARSED TYPES", JSON.stringify(sourceTypes, null, 1));

    const costs = mapSupplierCosts(sourceTypes);
    log("mapSupplierCosts", JSON.stringify(costs, null, 1));
    const old = priceGame(costs, "switch1", "flagship");
    log("OLD priceGame flagship/switch1", JSON.stringify(old, null, 1));

    const ready = readyTierPricing(sourceTypes);
    log("NEW readyTierPricing", JSON.stringify(ready, null, 1));

    const built = buildBatchGameImport(gameTemplate("Zelda Echoes"), "cat_nintendo");
    log("BUILT ok", built.ok);
    if (built.ok) {
      log("payload price/cost", built.payload.price, built.payload.cost);
      log("payload types", JSON.stringify(built.payload.types, null, 1));
    } else {
      log("reason", built.reason);
    }
  });

  it("shows the unmapped-order difference", () => {
    const rows: TemplateType[] = [
      { id: "t1", name: "A", optionId: "offline_account", price: null, cost: null },
      { id: "t2", name: "B", optionId: "mystery_account", price: 100, cost: 50 },
      { id: "t3", name: "C", optionId: "online_account", price: 200, cost: 100 },
    ];
    log("OLD unmapped", JSON.stringify(oldMapSupplierCosts(rows).unmapped));
    log("NEW unmapped", JSON.stringify(mapSupplierCosts(rows).unmapped));

    const dup: TemplateType[] = [
      { id: "d1", name: "Base", optionId: "offline_account", price: 100, cost: 50 },
      { id: "d0", name: "Junk", optionId: "", price: 1, cost: 1 },
      { id: "d2", name: "Dup", optionId: "offline_account", price: 300, cost: 200 },
    ];
    log("OLD dup unmapped", JSON.stringify(oldMapSupplierCosts(dup).unmapped));
    log("NEW dup unmapped", JSON.stringify(mapSupplierCosts(dup).unmapped));
    log("OLD dup priceGame needsReview", JSON.stringify(priceGame(oldMapSupplierCosts(dup), "switch1", "major").needsReview));
    log("NEW dup priceGame needsReview", JSON.stringify(priceGame(mapSupplierCosts(dup), "switch1", "major").needsReview));
  });
});
