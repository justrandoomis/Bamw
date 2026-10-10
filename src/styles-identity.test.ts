import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("Bananto visual identity baseline", () => {
  it("loads the original scoped design system instead of the generic redesign", () => {
    expect(STYLES).toContain('@import "tailwindcss" source(none);');
    expect(STYLES).toContain('@source "../src";');
    expect(STYLES).not.toContain('@import "./index.css";');
  });

  it("keeps the original cream storefront surfaces and light borders", () => {
    expect(STYLES).toContain("--page: #f4f1e8;");
    expect(STYLES).toContain("--surface: #f8f5f1;");
    expect(STYLES).toContain("--surface-2: #fcfbf9;");
    expect(STYLES).toContain("--line: #d6cdc2;");
  });

  /*
    «Turn all website ui ux to claymorphism (button, card, background…) all
    pages and elements (apple design + claymorphism)» — the owner's own brief,
    so the baseline moved with it: the cream surfaces above are unchanged, the
    corners grew from 0.625rem to clay's 0.875rem, and the clay recipes are
    what every shadow in the shop now draws.
  */
  it("is made of clay, tuned per theme", () => {
    expect(STYLES).toContain("--radius: 0.875rem;");
    for (const recipe of ["--clay-1:", "--clay-2:", "--clay-3:", "--clay-btn:", "--clay-well:"]) {
      expect(STYLES).toContain(recipe);
    }
    expect(STYLES).toContain("--shadow-sm: var(--clay-1);");
    expect(STYLES).toContain("--shadow-md: var(--clay-2);");
    expect(STYLES).toContain("--shadow-2xl: var(--clay-3);");
    expect(STYLES).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*scale: none !important/,
    );
  });

  it("keeps cartridges independent from generic card and theme tokens", () => {
    expect(STYLES).toContain("--cart-red: #e60012;");
    expect(STYLES).toContain("--cart-shell: #1c1c1c;");
    expect(STYLES).toContain("--cart-shell-2: #1a1a1a;");
  });

  it("preserves optional themes without changing the original default pack", () => {
    for (const theme of ["cream", "midnight", "space", "banana", "cyber"]) {
      expect(STYLES).toContain(`[data-theme="${theme}"]`);
    }
  });
});
