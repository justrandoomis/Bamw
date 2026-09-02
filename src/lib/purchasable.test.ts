import { describe, expect, it } from "vitest";

import { applyHiddenIntent, hiddenToggleState, isProductHidden } from "./purchasable";

/**
 * The unhide-that-did-nothing bug, pinned.
 *
 * `isProductHidden` honours five spellings of hidden; the admin form read and
 * wrote exactly one (`isHidden`). A product hidden through `is_hidden`,
 * `hidden`, `visibility` or `status: "مخفي"` showed an unchecked box, the
 * admin saved "visible", the save succeeded — and the storefront kept hiding
 * it on one of the other four signals.
 */

describe("hiddenToggleState", () => {
  it("reads every spelling the storefront's hidden check honours", () => {
    expect(hiddenToggleState({ isHidden: true })).toBe(true);
    expect(hiddenToggleState({ is_hidden: true })).toBe(true);
    expect(hiddenToggleState({ hidden: true })).toBe(true);
    expect(hiddenToggleState({ visibility: "hidden" })).toBe(true);
    expect(hiddenToggleState({ visibility: " Private " })).toBe(true);
    expect(hiddenToggleState({ visibility: "draft" })).toBe(true);
    expect(hiddenToggleState({ status: "مخفي" })).toBe(true);
    expect(hiddenToggleState({ status: "Hidden" })).toBe(true);
  });

  it("shows visible for a product with no hidden signal", () => {
    expect(hiddenToggleState({})).toBe(false);
    expect(hiddenToggleState({ isHidden: false, status: "نشط" })).toBe(false);
    expect(hiddenToggleState(null)).toBe(false);
    expect(hiddenToggleState("prd_1")).toBe(false);
  });

  it("does not read deletion as the hide toggle", () => {
    // A deleted product is not "hidden by a toggle" — initialising the box
    // from the deletion marker would let an unhide save resurrect it.
    expect(hiddenToggleState({ isDeleted: true })).toBe(false);
    expect(hiddenToggleState({ visibility: "deleted" })).toBe(false);
    expect(hiddenToggleState({ status: "محذوف" })).toBe(false);
  });
});

describe("applyHiddenIntent", () => {
  it("hides in both boolean spellings, and the loose one only if present", () => {
    const bare: Record<string, unknown> = {};
    applyHiddenIntent(bare, true);
    expect(bare).toEqual({ isHidden: true, is_hidden: true });

    const withLoose: Record<string, unknown> = { hidden: false };
    applyHiddenIntent(withLoose, true);
    expect(withLoose["hidden"]).toBe(true);
  });

  it("unhides a product hidden through the legacy flag — the reported bug", () => {
    const product: Record<string, unknown> = { is_hidden: true, title: "Mario" };
    applyHiddenIntent(product, false);
    expect(isProductHidden(product)).toBe(false);
    expect(product["isHidden"]).toBe(false);
    expect(product["is_hidden"]).toBe(false);
  });

  it("releases a hidden-ish visibility and the hidden status words", () => {
    const product: Record<string, unknown> = { visibility: "hidden", status: "مخفي" };
    applyHiddenIntent(product, false);
    expect("visibility" in product).toBe(false);
    expect(product["status"]).toBe("نشط");
    expect(isProductHidden(product)).toBe(false);
  });

  it("never releases deletion markers: unhide must not resurrect", () => {
    const product: Record<string, unknown> = {
      isDeleted: true,
      visibility: "deleted",
      status: "محذوف",
    };
    applyHiddenIntent(product, false);
    expect(product["isDeleted"]).toBe(true);
    expect(product["visibility"]).toBe("deleted");
    expect(product["status"]).toBe("محذوف");
    expect(isProductHidden(product)).toBe(true);
  });

  it("leaves an unrelated status alone when unhiding", () => {
    // "غير نشط" is the isActive axis, not the hidden one.
    const product: Record<string, unknown> = { isHidden: true, status: "غير نشط" };
    applyHiddenIntent(product, false);
    expect(product["status"]).toBe("غير نشط");
  });

  it("hiding never touches visibility or status", () => {
    const product: Record<string, unknown> = { visibility: "public", status: "نشط" };
    applyHiddenIntent(product, true);
    expect(product["visibility"]).toBe("public");
    expect(product["status"]).toBe("نشط");
    expect(isProductHidden(product)).toBe(true);
  });
});
