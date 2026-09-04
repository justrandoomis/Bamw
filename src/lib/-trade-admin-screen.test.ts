/**
 * What the pricing screen must put in front of the shop owner.
 *
 * The owner's words were: "طلبات المقايضة لا يمكن عرض الحاله للقرص وغيرها
 * للادمن لكي يحدد السعر" — the condition and the rest are not shown, and a
 * price cannot be set without them.
 *
 * Four separate reasons, each one enough on its own:
 *
 *   - the condition panel was guarded by `typeof selections === "object"`,
 *     never true for the JSON string D1 returns;
 *   - every photo after the first went into `disc_trade_images`, a table
 *     nothing in the repository had ever SELECTed — including the close-up of
 *     the scratch, which is usually the shot that decides the price;
 *   - the admin query, unlike the member one, joined no catalogue, so a manual
 *     price was asked for with no reference value on screen;
 *   - six of the nine status filters were the previous generation of names and
 *     could never match a row, and there was no filter at all for the two
 *     states a request awaiting a price sits in.
 *
 * These are source assertions because the defects are structural — the code
 * ran without error and simply rendered nothing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TRADE_STATUSES } from "./trade-calc";

const api = readFileSync(resolve(process.cwd(), "src/routes/api/disc-trade.ts"), "utf8");
const view = readFileSync(
  resolve(process.cwd(), "src/components/admin/services/DiscTradesAdminView.tsx"),
  "utf8",
);

/** The admin branch only — the member branch must not gain any of this. */
const adminScope = api.slice(api.indexOf('scope === "admin"'), api.indexOf("const user = await requireUser"));

describe("the admin trade payload", () => {
  it("resolves the condition into labels instead of shipping a raw string", () => {
    expect(adminScope).toContain("conditionAnswers");
    expect(adminScope).toContain("describeSelections(");
  });

  it("attaches every photo, not only the thumbnail", () => {
    expect(adminScope).toContain("disc_trade_images");
    expect(adminScope).toContain("photos:");
  });

  it("does not list the thumbnail twice", () => {
    expect(adminScope).toContain("filter((p) => p.url !== first)");
  });

  it("carries the catalogue's own valuation to price against", () => {
    expect(adminScope).toContain("catalogValuationIqd");
    expect(adminScope).toContain("FROM game_catalog");
  });

  it("reports the payout the customer chose, not the hardcoded column", () => {
    expect(adminScope).toContain("payoutMethod");
    expect(adminScope).toContain("payoutMethodOf(");
  });

  it("keeps both new lookups inside D1's parameter limit", () => {
    /*
      Both are `IN (...)` over a page of up to 200 rows, and D1 accepts fewer
      bound variables than that. The repo's own bounds audit catches an
      unchunked one; this states the requirement at the site.
    */
    expect(adminScope).toContain("chunkForParams(ids, 1)");
    expect(adminScope).toContain("chunkForParams(gameIds, 1)");
  });
});

describe("the admin trade card", () => {
  it("no longer gates the condition on a type the payload never has", () => {
    expect(view).not.toContain('typeof trade.selections === "object"');
  });

  it("renders the resolved answers", () => {
    expect(view).toContain("trade.conditionAnswers");
    expect(view).toContain("answer.valueLabel");
  });

  it("renders the whole gallery", () => {
    expect(view).toContain("trade.photos");
  });

  it("builds its status filter from the statuses that exist", () => {
    expect(view).toContain("TRADE_STATUSES.map(");
    /*
      The dead names, spelled out so this fails if anyone reintroduces one.
      `normalizeTradeStatus` maps every one of them away, so a row can never
      carry it and selecting it emptied the list.
    */
    for (const dead of [
      "waiting_review",
      "waiting_shipment",
      "received",
      "approved",
      "coupon_issued",
      "cash_paid",
    ]) {
      expect(view, `dead status option: ${dead}`).not.toContain(`<option value="${dead}"`);
    }
  });

  it("can filter for the two states a request awaiting a price sits in", () => {
    // Generated from TRADE_STATUSES, so this holds as long as they are in it.
    expect(TRADE_STATUSES).toContain("awaiting_pricing");
    expect(TRADE_STATUSES).toContain("priced");
  });
});

describe("three things the pricing screen could not do", () => {
  const view = readFileSync(
    resolve(process.cwd(), "src/components/admin/services/DiscTradesAdminView.tsx"),
    "utf8",
  );
  const code = view.replace(/\/\*[\s\S]*?\*\//g, "");

  it("cannot rewind a request to a stage it has already passed", () => {
    /*
      The card kept the status in `useState`, initialised when it first
      mounted. The list refetches, so a request the customer accepted two
      minutes ago still carried its old status there — and "حفظ فقط", which
      exists to save a price and a note, sent it back.
    */
    expect(code).not.toContain("const [status, setStatus]");
    expect(code).toContain("handleSave = (nextStatus: string = normStatus)");
  });

  it("can refuse a request, which the server has always allowed", () => {
    expect(code).toContain("رفض الطلب");
    expect(code).toContain('handleSave("rejected")');
    expect(code).toContain("إلغاء الطلب");
    expect(code).toContain('handleSave("cancelled")');
  });

  it("makes the admin write the reason the customer will read", () => {
    expect(code).toContain("اكتب سبب الرفض في ملاحظات الإدارة أولاً");
  });

  it("offers neither once the trade is finished", () => {
    expect(code).toContain('normStatus !== "completed"');
    expect(code).toContain('normStatus !== "rejected"');
    expect(code).toContain('normStatus !== "cancelled"');
  });

  it("says why a save was refused instead of doing nothing", () => {
    /*
      Every refusal this endpoint makes is a sentence written for the person
      clicking. `throw new Error("Failed to update")` discarded all of them,
      and with no `onError` the button simply did nothing.
    */
    expect(code).not.toContain('throw new Error("Failed to update")');
    expect(code).toContain("payload as { error?: string }");
    expect(code).toContain("onError: (error: Error) => toast.error(error.message)");
  });
});
