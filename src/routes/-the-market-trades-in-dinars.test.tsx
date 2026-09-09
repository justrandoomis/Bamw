/**
 * @vitest-environment jsdom
 *
 * The banana market has never been in dollars.
 *
 * Every price on the page was printed with a `$` in front of it, while the
 * offers column is `price_iqd`, the bot floor it is compared against is
 * `min_price_iqd`, the admin panel calls the same number «السعر الأساسي (د.ع)»,
 * and the shop's own default currency is IQD. The sign was wrong on every row
 * a customer reads — and «موزة واحدة $0.00» was two faults at once: a price of
 * zero, printed in a currency the market does not use.
 */
import { describe, expect, it } from "vitest";

import { dinars } from "@/routes/banana_market";

describe("what a price looks like on this page", () => {
  it("is marked in dinars, not dollars", () => {
    expect(dinars(0.24)).toContain("د.ع");
    expect(dinars(0.24)).not.toContain("$");
  });

  it("keeps three decimals below one dinar, where the whole price lives", () => {
    /*
      The engine rounds to three decimals, and a banana costs a fraction of a
      dinar — so two decimals would show 0.24 as 0.24 but 0.004 as 0.00, which
      is the same lie in a different font.
    */
    expect(dinars(0.24)).toBe("0.240 د.ع");
    expect(dinars(0.004)).toBe("0.004 د.ع");
  });

  it("does not put decimals on a whole number", () => {
    expect(dinars(375215)).toBe("375,215 د.ع");
  });

  it("shows two decimals on a mixed amount above a dinar", () => {
    expect(dinars(1250.5)).toBe("1,250.50 د.ع");
  });

  it("reads a missing amount as zero rather than NaN", () => {
    expect(dinars(undefined)).toBe("0 د.ع");
    expect(dinars(null)).toBe("0 د.ع");
  });
});
