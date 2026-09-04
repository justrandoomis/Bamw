/**
 * The condition the shop owner could never see.
 *
 * A customer answering "بدون علبة، شريحة بها خدوش، تحتاج تنظيف" is telling the
 * shop exactly what it needs to price the disc, and every word of it was
 * stored. None of it reached the pricing screen, because of two faults stacked
 * on each other:
 *
 *   1. `selections` is written with `JSON.stringify` and the admin endpoint
 *      returned the row unparsed, so the card's `typeof selections === "object"`
 *      guard was never true and the whole condition panel was unreachable.
 *   2. The stored value is the rule's `key`, and the Arabic label lives in
 *      `trade_rules`, which that screen never loaded. Parsing alone would have
 *      printed `cart_scratched` to an Arabic-speaking owner.
 *
 * Both are resolved on the server now, so the client receives finished labels.
 */
import { describe, expect, it } from "vitest";
import { describeSelections, parseSelections, payoutMethodOf } from "./tradeConditionView";
import type { TradeRule } from "./trade-calc";

const rule = (category: string, key: string, label_ar: string, percent = 0): TradeRule =>
  ({
    id: `${category}-${key}`,
    category,
    key,
    label_ar,
    label_en: null,
    percent,
    sort_order: 0,
    active: 1,
    created_at: "2026-01-01T00:00:00.000Z",
  }) as unknown as TradeRule;

const RULES: TradeRule[] = [
  rule("box_presence", "no_box", "بدون علبة", -15),
  rule("box_presence", "with_box", "مع العلبة"),
  rule("cartridge_condition", "cart_scratched", "شريحة بها خدوش", -20),
  rule("cleanliness", "dirty", "تحتاج تنظيف", -5),
  rule("region", "jp", "ياباني"),
  rule("payout_method", "cash", "نقداً"),
  rule("payout_method", "store_credit", "رصيد متجر", 10),
];

/** Exactly how the row is written: a string, not an object. */
const STORED = JSON.stringify({
  cleanliness: "dirty",
  box_presence: "no_box",
  payout_method: "cash",
  cartridge_condition: "cart_scratched",
  region: "jp",
});

describe("parseSelections", () => {
  it("reads the JSON string the column actually holds", () => {
    expect(parseSelections(STORED)["box_presence"]).toBe("no_box");
  });

  it("accepts an object too, so a parsed row is not broken by being parsed", () => {
    expect(parseSelections({ box_presence: "no_box" })["box_presence"]).toBe("no_box");
  });

  it("answers nothing rather than throwing on a row it cannot read", () => {
    /*
      One unreadable row must not take the whole trade list down with it — the
      screen should show that request with no condition, not fail to render.
    */
    expect(parseSelections("{not json")).toEqual({});
    expect(parseSelections(null)).toEqual({});
    expect(parseSelections("[1,2]")).toEqual({});
  });
});

describe("describeSelections", () => {
  it("turns every stored key into the Arabic the owner reads", () => {
    const answers = describeSelections(STORED, RULES);
    const labels = answers.map((a) => `${a.categoryLabel}: ${a.valueLabel}`);
    expect(labels).toContain("العلبة: بدون علبة");
    expect(labels).toContain("حالة الشريحة: شريحة بها خدوش");
    expect(labels).toContain("النظافة العامة: تحتاج تنظيف");
    // Never the raw key.
    expect(JSON.stringify(labels)).not.toContain("cart_scratched");
  });

  it("orders the answers the way the customer was asked them", () => {
    /*
      The JSON above is deliberately scrambled. The disc's story should read in
      the order it was told, not in whatever order the object serialised.
    */
    const answers = describeSelections(STORED, RULES);
    expect(answers.map((a) => a.category)).toEqual([
      "box_presence",
      "cartridge_condition",
      "cleanliness",
      "region",
      "payout_method",
    ]);
  });

  it("carries what each answer does to the price", () => {
    const answers = describeSelections(STORED, RULES);
    const cartridge = answers.find((a) => a.category === "cartridge_condition");
    expect(cartridge?.percent).toBe(-20);
  });

  it("shows a key with no rule rather than dropping the answer", () => {
    /*
      A rule deleted after a request was submitted must not make that answer
      disappear from the screen — the owner needs to know something was said.
    */
    const answers = describeSelections(JSON.stringify({ extras: "gone_rule" }), RULES);
    expect(answers).toHaveLength(1);
    expect(answers[0]!.valueLabel).toBe("gone_rule");
    expect(answers[0]!.unknown).toBe(true);
  });

  it("is empty for a row that has no selections, and does not invent any", () => {
    expect(describeSelections(null, RULES)).toEqual([]);
  });
});

describe("payoutMethodOf", () => {
  it("reports the choice the customer actually made", () => {
    /*
      `preferred_trade` says store credit on every row — the form hardcodes it.
      The real answer is in the condition step, and it is the one the quote was
      calculated from, so paying by the column would settle a cash request in
      store credit.
    */
    expect(payoutMethodOf(STORED)).toBe("cash");
  });

  it("says nothing rather than guessing when the answer is absent", () => {
    expect(payoutMethodOf(JSON.stringify({ box_presence: "no_box" }))).toBeNull();
    expect(payoutMethodOf(JSON.stringify({ payout_method: "something_else" }))).toBeNull();
  });
});
