/**
 * `buildMedia` end to end, which nothing was exercising.
 *
 * The European fallback was added by moving `put` above the lookup so both
 * paths could store through it — and that move carried the GameTDB sleeve
 * block with it, to a place where `product` does not exist yet. Every test in
 * the suite passed, because not one of them called `buildMedia`, and
 * `node --check` passes it too: a temporal dead zone is a runtime error.
 *
 * These run the function. They exercise the path where the US store has no
 * page — which is the new one — and that path returns before the sleeve block
 * is reached, so it does NOT catch the ordering mistake. Tried it: the bug
 * was reintroduced and all three still passed. The last test below is what
 * actually pins it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { buildMedia } from "./lib/media-pipeline.mjs";

/** Enough of sharp for the pipeline: convert, measure, and nothing else. */
const fakeSharp = (buffer) => ({
  webp: () => ({ toBuffer: async () => buffer }),
  metadata: async () => ({ width: 1024, height: 1024 }),
});

const r2 = { put: async () => true };

/*
  A real PNG signature, because `fetchImage` sniffs the bytes and refuses
  anything it cannot identify — which is the guard that stops an HTML error
  page being stored as a cover. Twelve bytes is the minimum it will look at.
*/
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const respondWithImage = () =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "image/png" },
    arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
    text: async () => "",
  }));

const identity = { id: "prd_x", title: "Above Snakes", platform: "switch" };

describe("when the US store has no page", () => {
  it("asks Europe, and stores the square card it answers with", async () => {
    vi.stubGlobal("fetch", respondWithImage());
    try {
      const out = await buildMedia(identity, {
        sharp: fakeSharp,
        r2,
        apply: true,
        roles: ["nintendoCardImage"],
        euSearch: async () => ({
          ok: true,
          json: {
            response: {
              docs: [
                {
                  title: "Above Snakes",
                  image_url_sq_s: "https://img.nintendo.eu/above-snakes-sq.jpg",
                  system_names_txt: ["Nintendo Switch"],
                },
              ],
            },
          },
        }),
      });

      expect(out.patch.nintendoCardImage).toMatch(/^\/api\/files\/products\/prd_x\/square-card-/);
      expect(out.resolvedUrl).toContain("Nintendo of Europe");
      // One role asked for, one role filled, nothing else touched.
      expect(Object.keys(out.patch)).toEqual(["nintendoCardImage"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stores nothing when Europe has no exact match either", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => "" }, text: async () => "" })),
    );
    try {
      const out = await buildMedia(identity, {
        sharp: fakeSharp,
        r2,
        apply: true,
        roles: ["nintendoCardImage"],
        euSearch: async () => ({ ok: true, json: { response: { docs: [] } } }),
      });

      expect(out.patch).toEqual({});
      expect(out.unresolved).toContain("nintendoCardImage");
      expect(out.note).toMatch(/europe: no rows/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not ask Europe when the square card was not requested", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => "" }, text: async () => "" })),
    );
    const euSearch = vi.fn();
    try {
      await buildMedia(identity, {
        sharp: fakeSharp,
        r2,
        apply: true,
        roles: ["coverImage"],
        euSearch,
      });
      expect(euSearch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the order the function is written in", () => {
  /*
    Asserted on the source because the runtime tests cannot reach it: the
    sleeve block only runs when the US store HAS a page, and standing that up
    means a whole `__NEXT_DATA__` fixture for a branch whose only failure mode
    is this one.

    `put` must come before the lookup, because the European fallback stores
    through it and that runs inside the "no page" branch. Everything that
    touches `product` must come after `product` exists. Those two pull in
    opposite directions, which is exactly why this went wrong once.
  */
  const SOURCE = readFileSync(resolve(process.cwd(), "scripts/lib/media-pipeline.mjs"), "utf8");

  it("defines put before the lookup that may need it", () => {
    expect(SOURCE.indexOf("const put = async (role,")).toBeLessThan(
      SOURCE.indexOf("const resolved = await resolveProduct(identity)"),
    );
  });

  it("reads product only after product exists", () => {
    const declared = SOURCE.indexOf("const product = resolved.product;");
    expect(declared).toBeGreaterThan(-1);
    for (const use of ["gameTdbId(product.productCode)", "candidatesFor(product)"]) {
      expect(SOURCE.indexOf(use)).toBeGreaterThan(declared);
    }
  });
});
