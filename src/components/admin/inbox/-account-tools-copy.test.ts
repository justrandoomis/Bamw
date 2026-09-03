/**
 * @vitest-environment node
 */
/**
 * The rules the silent copy has to keep, asserted against the source.
 *
 * The behaviour itself is a clipboard write inside a modal, which is exactly
 * what a jsdom test cannot observe honestly. What *can* be held is the shape:
 * no icon, no label, no tooltip, no toast, the Chinese name never rendered,
 * the click not selecting the card, and — the one that costs money — no
 * fallback to the English title.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dirname, "AccountToolsModal.tsx"),
  "utf8",
);

describe("the silent copy on the game name", () => {
  it("never falls back to the English title", () => {
    /*
      The rule that matters commercially. An order placed against an English
      title is an order placed for the wrong thing, so when there is no Chinese
      name nothing is copied and the gap is logged instead.
    */
    const fn = source.slice(source.indexOf("const copySupplierName"));
    const body = fn.slice(0, fn.indexOf("[orderItemById]"));
    expect(body).toContain("if (!name)");
    expect(body).toContain("supplier_name_zh_missing");
    expect(body).not.toMatch(/name\s*\|\|\s*item\?\.productTitle/);
    expect(body).not.toMatch(/\?\?\s*item\?\.productTitle/);
  });

  it("says nothing to the admin: no toast, no tooltip, no label", () => {
    const copyRegion = source.slice(source.indexOf("async function copySilently"));
    const upToComponent = copyRegion.slice(0, copyRegion.indexOf("export function"));
    expect(upToComponent).not.toMatch(/toast\./);
    expect(upToComponent).not.toMatch(/title=/);
  });

  it("does not render the Chinese name anywhere", () => {
    /*
      It is copied, never shown. The only place it may appear in this file is
      as a field read for the clipboard.
    */
    const renders = source.match(/\{[^}]*supplierNameZhCn[^}]*\}/g) ?? [];
    for (const render of renders) {
      expect(render).not.toMatch(/^\{\s*(item|selected|target)\.supplierNameZhCn\s*\}$/);
    }
  });

  it("stops the click from selecting the card", () => {
    // The chip is itself the selector; without this an admin trying to copy
    // would change what they are looking at.
    const chip = source.slice(source.indexOf("{item.productTitle}") - 1400);
    expect(chip.slice(0, 1400)).toContain("event.stopPropagation()");
  });

  it("keeps a fallback for browsers that refuse the clipboard API", () => {
    /*
      `navigator.clipboard` needs a secure context and is refused outright by
      some mobile browsers inside a modal. The textarea is positioned
      off-screen rather than hidden on purpose: an element with display:none
      cannot be selected, which is why the obvious version of this silently
      does nothing on Safari.
    */
    expect(source).toContain("document.execCommand(\"copy\")");
    expect(source).toContain('area.style.position = "fixed"');
    expect(source).not.toContain('area.style.display = "none"');
  });
});
