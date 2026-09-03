/**
 * @vitest-environment node
 */
/**
 * That the prep tool uses the shared copy in *both* places, and nowhere else.
 *
 * The behaviour is tested in `SupplierNameCopy.test.tsx`, by clicking it. What
 * is left for this file is the thing a behavioural test cannot see: that the
 * modal has not grown a second, hand-rolled copy somewhere, which is exactly
 * how the detail card came to be missing `stopPropagation` while the chip a
 * thousand lines above it had one.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dirname, "AccountToolsModal.tsx"), "utf8");

/**
 * Comments blanked, so prose about a call is not read as one.
 *
 * The comment explaining why the credentials copy borrows the fallback names
 * `navigator.clipboard`, and the first version of the assertion below counted
 * that as a use of it.
 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m) => " ".repeat(m.length));

describe("the game name in the prep tool", () => {
  it("uses the shared copy in both places it appears", () => {
    /* The short card in the strip, and the opened delivery-item card. */
    const uses = source.match(/<SupplierNameCopy\b/g) ?? [];
    expect(uses).toHaveLength(2);
  });

  it("has no copy of the clipboard logic of its own", () => {
    /*
      Both copies in this tool go through `copySilently` — the silent one on the
      game name and the loud one on the credentials, which keeps its button and
      its toast but borrows the fallback. `navigator.clipboard` is refused
      inside a modal on mobile Safari, and the credentials copy used to throw
      there and then show the success toast anyway.
    */
    expect(code).not.toContain("navigator.clipboard");
    expect(code).not.toContain("execCommand");
  });

  it("never renders the Chinese name", () => {
    /*
      It is copied, never shown. The only place the field may appear is as a
      value handed to the component that copies it.
    */
    const renders = source.match(/\{[^}]*supplierNameZhCn[^}]*\}/g) ?? [];
    for (const render of renders) {
      expect(render).not.toMatch(/^\{\s*(item|selected|target)\.supplierNameZhCn\s*\}$/);
    }
  });

  it("shows what was sold beside the name, from the order's own snapshot", () => {
    /*
      An offline account and an online one are different products behind the
      same title, and the edition and console decide which SKU to order. All of
      it comes from `orderItems`, which is the snapshot taken at purchase — not
      from the product as it stands today, which an admin can edit.
    */
    expect(source).toContain("selectionFor(item.orderItemId)");
    expect(source).toContain("selectionFor(selected.orderItemId)");
    expect(source).toContain("quantityFor(item.orderItemId)");
    expect(source).toContain("quantityFor(selected.orderItemId)");
    expect(source).toContain("orderItemById");
  });
});
