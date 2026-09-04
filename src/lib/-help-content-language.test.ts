/**
 * Nothing on the help pages may reach a customer in the wrong language, as a
 * placeholder, or as a shape that was meant to be text.
 *
 * These four pages are assembled from JSON files, so the failures are the ones
 * JSON produces: an object where a string belonged, a translation key that was
 * never filled, a Simplified Chinese product name that came in with a supplier
 * import. Each renders as visible nonsense rather than as an error, which is
 * why it needs asserting rather than catching.
 */
import { describe, expect, it } from "vitest";
import { shippedGuides } from "./siteGuides";
import { shippedPolicySections } from "./sitePolicy";
import { shippedFaqCategories, shippedFaqItems } from "./siteFaq";

/** Every string the four pages can print, with the path that holds it. */
function strings(value: unknown, trail = ""): Array<{ path: string; text: string }> {
  if (typeof value === "string") return [{ path: trail, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, i) => strings(item, `${trail}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => strings(child, `${trail}.${key}`));
  }
  return [];
}

const all = [
  ...strings(shippedGuides(), "guides"),
  ...strings(shippedPolicySections(), "policy"),
  ...strings(shippedFaqCategories(), "faqCategories"),
  ...strings(shippedFaqItems(), "faq"),
];

describe("the shipped help content", () => {
  it("has plenty to say", () => {
    // A guard against the whole suite passing on an empty file.
    expect(all.length).toBeGreaterThan(400);
  });

  it("never prints a shape where a sentence belonged", () => {
    for (const entry of all) {
      expect(entry.text, entry.path).not.toContain("[object Object]");
      expect(entry.text, entry.path).not.toContain("undefined");
      expect(entry.text, entry.path).not.toContain("NaN");
    }
  });

  it("never shows a translation key instead of its text", () => {
    for (const entry of all) {
      expect(entry.text, entry.path).not.toMatch(/^[a-z][a-z0-9_]*\.[a-z0-9_.]+$/);
      expect(entry.text, entry.path).not.toContain("{{");
    }
  });

  it("carries no Simplified Chinese, which only ever arrives from a supplier import", () => {
    for (const entry of all) {
      expect(entry.text, entry.path).not.toMatch(/[一-鿿]/);
    }
  });

  it("leaks no cost, rate or supplier vocabulary", async () => {
    /*
      The same detector the product serializer filters with. These files are
      hand-written today and admin-edited tomorrow, and a help page is exactly
      where somebody would paste a note meant for the shop.
    */
    const { looksLikeInternalNote } = await import("./internalMetadata");
    for (const entry of all) {
      expect(looksLikeInternalNote(entry.text), `${entry.path}: ${entry.text}`).toBe(false);
    }
  });

  it("holds no password, code or account of anybody's", async () => {
    const { findForbiddenSecret } = await import("./telegram-admin-routing.server");
    for (const entry of all) {
      expect(findForbiddenSecret(entry.text), entry.path).toBeUndefined();
    }
  });

  it("points only inside the site", () => {
    for (const entry of all) {
      for (const match of entry.text.matchAll(/https?:\/\/[^\s)"']+/g)) {
        const host = new URL(match[0]).hostname;
        expect(
          /(^|\.)(banan\.to|nintendo\.com|ec\.nintendo\.com)$/.test(host),
          `${entry.path} → ${host}`,
        ).toBe(true);
      }
    }
  });
});
