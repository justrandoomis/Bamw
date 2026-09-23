/**
 * Every preloaded image must be one some screen actually draws.
 *
 * A browser audit of banan.to found exactly one failing image request on the
 * whole site, and it was a `<link rel="preload" as="image">` in the document
 * head:
 *
 *   net::ERR_BLOCKED_BY_ORB — https://assets.banan.to/Images/Brand/bananto_logo.webp
 *
 * Chrome's Opaque Response Blocking refuses a cross-origin subresource whose
 * body is not the kind that was asked for — an HTML error page where a WebP was
 * requested. `Images/Services/Hang_Banner.webp` from the SAME host answers 200,
 * so the host was never the problem; that one object is not there.
 *
 * What makes it worth a test rather than just a deletion is the second half:
 * nothing rendered that URL. Every screen that draws the mascot imports the
 * bundled, same-origin, content-hashed copy. The preload could not have been
 * used even if it had loaded. It cost a DNS lookup, a TLS handshake, a request
 * and a console error on every page view, for nothing — and none of that is
 * visible from reading the line.
 *
 * So the rule is the one that would have caught it: a preload is a promise that
 * something is about to need this. If nothing renders it, it is not a promise,
 * it is a request nobody asked for.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = readFileSync(path.resolve(__dirname, "__root.tsx"), "utf8");

/** Every `href` the head preloads as an image. */
const preloadedImages = [
  ...root.matchAll(/rel:\s*"preload",\s*as:\s*"image",\s*href:\s*"([^"]+)"/g),
].map((m) => m[1]!);

/** Every source file, so "does anything render this?" can actually be asked. */
function allSources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      allSources(full, found);
    } else if (/\.(tsx?|css)$/.test(entry) && !entry.includes(".test.")) {
      found.push(full);
    }
  }
  return found;
}

const sources = allSources(path.resolve(__dirname, "..")).map((file) => ({
  file,
  /* Comments explain why a URL is NOT preloaded; they do not render it. */
  text: readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/[^\n]*/gm, " "),
}));

describe("the head preloads nothing the app does not draw", () => {
  it("finds the preloads at all, so this file is testing something", () => {
    expect(preloadedImages.length).toBeGreaterThan(0);
  });

  it.each(preloadedImages)("something renders %s", (href) => {
    /*
      Matched on the PATH, not the whole URL. `publicAssets.ts` builds these as
      `${ASSET_BASE_URL}/Images/...`, so a search for the absolute string finds
      the preload and nothing else — which would fail every asset the app really
      does draw, and pass nothing. The first version of this test did exactly
      that and reported `Hang_Banner.webp`, which the store-services sign shows
      on the home page.
    */
    const assetPath = href.replace(/^https?:\/\/[^/]+/, "");
    const renderers = sources.filter(
      ({ file, text }) => !file.endsWith("__root.tsx") && text.includes(assetPath),
    );
    expect(
      renderers.length,
      `${assetPath} is preloaded and nothing renders it — a request, a console error, and no use`,
    ).toBeGreaterThan(0);
  });

  it("no longer preloads the logo that only ever answered with ORB", () => {
    expect(root).not.toContain('href: "https://assets.banan.to/Images/Brand/bananto_logo.webp"');
  });

  /*
    And the screens that DO show the mascot use the bundled copy, which is
    same-origin and cannot be blocked this way. If that ever changes back to a
    cross-origin URL, the preload question returns with it.
  */
  it.each([
    "components/auth/AuthPieces.tsx",
    "components/telegram/TelegramLayout.tsx",
    "components/AdminDashboard.tsx",
    "routes/telegram/index.tsx",
  ])("%s draws the mascot from the bundle, not from a CDN", (relative) => {
    const text = readFileSync(path.resolve(__dirname, "..", relative), "utf8");
    expect(text).toContain('from "@/assets/bananto_logo.webp.asset.json"');
    expect(text).not.toContain("assets.banan.to/Images/Brand");
  });
});
