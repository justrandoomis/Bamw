/**
 * The listing that decides which of the shop's pictures exist.
 *
 * Two versions of this question were wrong before this one, and both were
 * wrong about the INSTRUMENT rather than about the shop:
 *
 *   - asking the REST object endpoint per picture, which sends the bytes: a
 *     run spent a hundred seconds downloading square cards to learn their
 *     HTTP status;
 *   - then listing one prefix per product, which is about twelve hundred
 *     authenticated calls in a minute against a rate-limited API. Listings
 *     came back empty or not at all, and pictures that are sitting in R2 right
 *     now were reported `unknown` because the folder could not be read.
 *
 * So: one listing per bucket over the shared root. What is tested here is the
 * part that can destroy something — that a listing which did not finish is
 * reported as a FAILURE and never as a short list of keys. Every key past the
 * cut would otherwise look absent, and absent is the verdict that erases.
 */
import { describe, expect, it, vi } from "vitest";

import { commonPrefix, listPrefix, MAX_PAGES } from "./lib/r2-listing.mjs";

const CREDS = { account: "acct", token: "tok" };

/** A fake API that hands back `pages` in order. */
const apiReturning = (pages) => {
  let call = 0;
  return vi.fn(async () => {
    const page = pages[Math.min(call++, pages.length - 1)];
    return {
      ok: page.ok !== false,
      json: async () => ({
        success: page.success !== false,
        result: (page.keys ?? []).map((key) => ({ key })),
        result_info: { cursor: page.cursor ?? "", is_truncated: Boolean(page.cursor) },
      }),
    };
  });
};

describe("the shared root of a set of keys", () => {
  it("is the folder they all sit under", () => {
    expect(
      commonPrefix(["files/products/a/x.webp", "files/products/b/y.webp"]),
    ).toBe("files/products/");
  });

  it("stops at a folder boundary rather than mid-name", () => {
    /* «prd_cat_ball» and «prd_cat_balatro» share «prd_cat_bal», which is not a
       folder and would list the wrong thing. */
    expect(
      commonPrefix([
        "files/products/prd_cat_balatro/a.webp",
        "files/products/prd_cat_ball-x-pit/b.webp",
      ]),
    ).toBe("files/products/");
  });

  it("is the key's own folder when there is only one", () => {
    expect(commonPrefix(["files/products/a/x.webp"])).toBe("files/products/a/");
  });

  it("is empty when they share nothing", () => {
    expect(commonPrefix(["files/a.webp", "other/b.webp"])).toBe("");
    expect(commonPrefix([])).toBe("");
  });
});

describe("a listing that did not finish", () => {
  it("returns the keys when the API said there was no more", async () => {
    const fetchImpl = apiReturning([{ keys: ["files/a.webp", "files/b.webp"] }]);
    const keys = await listPrefix("bucket", "files/", { ...CREDS, fetchImpl });
    expect([...keys]).toEqual(["files/a.webp", "files/b.webp"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("follows the cursor and joins the pages", async () => {
    const fetchImpl = apiReturning([
      { keys: ["files/a.webp"], cursor: "c1" },
      { keys: ["files/b.webp"] },
    ]);
    const keys = await listPrefix("bucket", "files/", { ...CREDS, fetchImpl });
    expect([...keys].sort()).toEqual(["files/a.webp", "files/b.webp"]);
  });

  /*
    THE ONE THAT MATTERS. A listing still truncated at the page cap returns
    null, NOT the keys it managed to collect. A partial listing is the most
    dangerous answer this function can give: every key past the cut looks
    absent, and absent is the verdict that clears a picture.
  */
  it("refuses to hand back a partial list when it ran out of pages", async () => {
    const fetchImpl = apiReturning([{ keys: ["files/a.webp"], cursor: "more" }]);
    const keys = await listPrefix("bucket", "files/", { ...CREDS, fetchImpl });
    expect(keys).toBe(null);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it.each([403, 429, 500, 503])("returns null on a %i rather than an empty list", async (status) => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status, json: async () => ({}) }));
    expect(await listPrefix("bucket", "files/", { ...CREDS, fetchImpl })).toBe(null);
  });

  it("returns null when the request throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    });
    expect(await listPrefix("bucket", "files/", { ...CREDS, fetchImpl })).toBe(null);
  });

  it("returns null when the API answered 200 with success:false", async () => {
    const fetchImpl = apiReturning([{ success: false }]);
    expect(await listPrefix("bucket", "files/", { ...CREDS, fetchImpl })).toBe(null);
  });

  it("returns null rather than an empty list when there is no token", async () => {
    const fetchImpl = vi.fn();
    expect(await listPrefix("bucket", "files/", { account: "a", fetchImpl })).toBe(null);
    expect(await listPrefix("bucket", "files/", { token: "t", fetchImpl })).toBe(null);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  /* An empty folder is a real answer, and must not look like a failed one. */
  it("gives an empty Set for a folder that really is empty", async () => {
    const fetchImpl = apiReturning([{ keys: [] }]);
    const keys = await listPrefix("bucket", "files/", { ...CREDS, fetchImpl });
    expect(keys).toBeInstanceOf(Set);
    expect(keys.size).toBe(0);
  });
});
