/**
 * @vitest-environment node
 */
/**
 * An imported Chinese name must not ride into the product document.
 *
 * The parser has to carry the field — that is how a template hands anything
 * over — and the product payload is what every public response is built from.
 * So the value is taken off the form on its way past, and this is the check
 * that says it really was.
 */

import { describe, expect, it } from "vitest";
import { extractSupplierNameZh } from "./gameImportForm";

describe("extractSupplierNameZh", () => {
  it("lifts the name out and leaves nothing behind", () => {
    const form: Record<string, unknown> = {
      title: "Super Mario Odyssey",
      supplierNameZhCn: "超级马力欧 奥德赛",
      supplierNameZhSourceUrl: "https://www.nintendoswitch.com.cn/super_mario_odyssey/",
      price: 25_000,
    };

    const taken = extractSupplierNameZh(form);

    expect(taken.name).toBe("超级马力欧 奥德赛");
    expect(taken.sourceUrl).toBe("https://www.nintendoswitch.com.cn/super_mario_odyssey/");

    // The form is what becomes the product. It must be clean.
    expect("supplierNameZhCn" in form).toBe(false);
    expect("supplierNameZhSourceUrl" in form).toBe(false);
    expect(JSON.stringify(form)).not.toContain("超级马力欧");

    // And nothing else was disturbed.
    expect(form["title"]).toBe("Super Mario Odyssey");
    expect(form["price"]).toBe(25_000);
  });

  it("is harmless on a form that never had one", () => {
    const form: Record<string, unknown> = { title: "Hardware" };
    expect(extractSupplierNameZh(form)).toEqual({ name: "", sourceUrl: "" });
    expect(form).toEqual({ title: "Hardware" });
  });
});
