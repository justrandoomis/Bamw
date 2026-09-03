/**
 * @vitest-environment node
 */
/**
 * The two mistakes the Chinese-name check exists to catch.
 *
 * The field is typed by hand and pasted from a browser, so what actually goes
 * wrong is not exotic: the English title ends up in the Chinese column, or a
 * name is pasted straight from a Traditional page without being converted as
 * the supplier rules require.
 */

import { describe, expect, it } from "vitest";
import { checkSupplierNameZh } from "./productAdminMetadata.server";

describe("checkSupplierNameZh", () => {
  it("accepts an official Simplified name", () => {
    expect(checkSupplierNameZh("超级马力欧 奥德赛", "Super Mario Odyssey")).toEqual({ ok: true });
  });

  it("refuses an empty value", () => {
    expect(checkSupplierNameZh("", "Super Mario Odyssey").reason).toBe("empty");
    expect(checkSupplierNameZh("   ", "Super Mario Odyssey").reason).toBe("empty");
  });

  it("refuses the English title pasted into the Chinese field", () => {
    // The commonest mistake, and the one a "not empty" check waves through.
    expect(checkSupplierNameZh("Super Mario Odyssey", "Super Mario Odyssey").reason).toBe(
      "not_chinese",
    );
  });

  it("refuses a Latin string even when the titles differ", () => {
    expect(checkSupplierNameZh("Mario Odyssey CN", "Super Mario Odyssey").reason).toBe(
      "not_chinese",
    );
  });

  it("flags a Traditional name that was never converted", () => {
    /*
      The rules allow an official Traditional name — after converting the
      script. 薩爾達傳說 is the Traditional form; the Simplified is 塞尔达传说.
      Storing the Traditional one is a rule violation, not a typo, so it is
      refused rather than silently accepted.
    */
    expect(checkSupplierNameZh("薩爾達傳說 王國之淚", "Tears of the Kingdom").reason).toBe(
      "looks_traditional",
    );
    expect(checkSupplierNameZh("塞尔达传说 王国之泪", "Tears of the Kingdom")).toEqual({ ok: true });
  });

  it("refuses something far too long to be a title", () => {
    expect(checkSupplierNameZh("超级".repeat(70), "x").reason).toBe("too_long");
  });

  it("accepts a name carrying Latin digits and punctuation", () => {
    // Real supplier names do this: 马力欧赛车8 豪华版, 精灵宝可梦 剑/盾.
    expect(checkSupplierNameZh("马力欧赛车8 豪华版", "Mario Kart 8 Deluxe")).toEqual({ ok: true });
  });
});
