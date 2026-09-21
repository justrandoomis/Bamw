import { describe, expect, it } from "vitest";
import { getProductCategory, isGameProduct, resolveCategoryType } from "@/lib/productSection";

describe("custom category classification", () => {
  it("numeric custom id with no title", () => {
    const p = {
      id: "prd_abc",
      title: "Nintendo Switch 2 Console",
      price: 400000,
      isActive: true,
      kind: "hardware",
      category: "1758294003123",
      categoryId: "1758294003123",
    };
    expect({
      cat: getProductCategory(p),
      isGame: isGameProduct(p),
      raw: resolveCategoryType("1758294003123", ""),
      withTitle: resolveCategoryType("1758294003123", "أجهزة وملحقات"),
      noCat: resolveCategoryType("", "", "hardware", ""),
    }).toBe("SHOW_ME");
  });
});
