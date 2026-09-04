/**
 * The filter was removing the terms along with the bookkeeping.
 *
 * These records do not put a supplier note on a line of its own. The gift
 * cards keep a paragraph of genuine customer policy and close it with a note
 * to ourselves; the variant rows carry the cost derivation and the "no coupon
 * applies to this product" exclusion in the same sentence run. Filtering by
 * line removed all of it — so the fix for a commercial leak was quietly
 * deleting the refund terms, the "no physical card is included" warning, and
 * the coupon exclusion a buyer needs before paying.
 *
 * Sentence granularity keeps what was written for the buyer. It only holds
 * because each bookkeeping sentence trips a pattern on its own, which is why
 * the rate forms these records actually use are named: a sentence that stated
 * a rate only by sitting beside one would now survive where the whole line
 * used to go.
 */
import { describe, expect, it } from "vitest";
import {
  customerSafeParagraph,
  customerSafeText,
  internalSentences,
  looksLikeInternalNote,
} from "./internalMetadata";

/** The English paragraph, exactly as production holds it. */
const TERMS =
  "US code balances do not expire, have no code-related fees and are not reloadable. " +
  "After redemption the funds are non-transferable. " +
  "Nintendo's cash redemption and refund restrictions apply, subject to applicable law. " +
  "Protect the code and purchase receipt. " +
  "No physical card, console, pictured game or accessory is included. " +
  "Actual merchant stock and supplier acquisition cost still require confirmation";

/** The variant row, exactly as production holds it. */
const VARIANT =
  "20 USD face value; selling price 28000 IQD at the merchant-defined rate of 1400 IQD/USD. " +
  "Fulfillment: 12–72 hours. " +
  "No coupon may apply to this product. " +
  "It is excluded from all current and future merchant promotions and discounts. " +
  "Supplier cost remains unconfirmed. " +
  "Disclose any multiple-code bundle composition before sale.";

describe("the gift card's terms paragraph", () => {
  const kept = customerSafeParagraph(TERMS) ?? "";

  it("keeps the refund terms a buyer has to read", () => {
    expect(kept).toContain("cash redemption and refund restrictions apply");
    expect(kept).toContain("No physical card, console, pictured game or accessory is included");
    expect(kept).toContain("balances do not expire");
  });

  it("removes the note about our own stock and cost", () => {
    expect(kept).not.toContain("supplier");
    expect(kept).not.toContain("acquisition cost");
    expect(kept).not.toContain("merchant stock");
  });

  it("leaves nothing the detector would still object to", () => {
    expect(looksLikeInternalNote(kept)).toBe(false);
  });
});

describe("the denomination row", () => {
  const kept = customerSafeText(VARIANT) ?? "";

  it("keeps the coupon exclusion, which is a term of the sale", () => {
    expect(kept).toContain("No coupon may apply to this product");
    expect(kept).toContain("excluded from all current and future merchant promotions");
  });

  it("keeps the fulfilment time, which is what the buyer waits for", () => {
    expect(kept).toContain("12–72 hours");
  });

  it("removes the rate the price was derived at", () => {
    expect(kept).not.toContain("28000");
    expect(kept).not.toContain("1400 IQD/USD");
    expect(kept).not.toContain("merchant-defined rate");
  });

  it("removes the instructions meant for whoever fulfils the order", () => {
    expect(kept).not.toContain("Supplier cost remains unconfirmed");
    expect(kept).not.toContain("Disclose any multiple-code bundle");
  });
});

describe("the Arabic pricing line", () => {
  const line = "سعر البيع: 28,000 د.ع، محسوب على أساس 1 USD = 1,400 IQD. مدة التجهيز: 12–72 ساعة.";

  it("removes the price and the rate", () => {
    const kept = customerSafeParagraph(line) ?? "";
    expect(kept).not.toContain("سعر البيع");
    expect(kept).not.toContain("1,400");
  });

  it("keeps how long the buyer waits", () => {
    expect(customerSafeParagraph(line)).toContain("مدة التجهيز");
  });
});

describe("a value that is entirely internal", () => {
  const only =
    "Supplier Regular / 普通版 converted to IQD using 1 CNY = 220 IQD and rounded down to nearest 250 IQD";

  it("is dropped whole, so no row renders empty", () => {
    expect(customerSafeText(only)).toBeUndefined();
    expect(customerSafeParagraph(only)).toBeUndefined();
  });
});

describe("ordinary copy", () => {
  it("comes back exactly as written", () => {
    const text = "اشحن حسابك الأمريكي برصيد 20 دولار.\n\nتختار الألعاب بنفسك.";
    expect(customerSafeParagraph(text)).toBe(text);
  });

  it("does not lose a blank line between two paragraphs it keeps", () => {
    expect(customerSafeParagraph("first line.\n\nsecond line.")).toBe("first line.\n\nsecond line.");
  });
});

describe("the report the repair tool prints", () => {
  it("names every sentence it will remove, and the rule that decided", () => {
    const removed = internalSentences(VARIANT);
    expect(removed.map((r) => r.sentence).join(" ")).toContain("merchant-defined rate");
    expect(removed.map((r) => r.sentence).join(" ")).toContain("Supplier cost remains unconfirmed");
    for (const entry of removed) expect(entry.reason.length).toBeGreaterThan(0);
  });

  it("says nothing about text it keeps", () => {
    expect(internalSentences("No coupon may apply to this product.")).toHaveLength(0);
  });
});
