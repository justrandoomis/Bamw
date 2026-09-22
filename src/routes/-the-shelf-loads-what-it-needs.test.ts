/**
 * «تأخر في تحميل المنتجات ... تعليك lagging جدا قوي أثناء عمل scroll down ...
 *  وعند الصعود للأعلى بعد النزول للاسفل تحمل المنتجات من جديد.»
 *
 * Two of those have the same cause, and it is not the rendering.
 *
 * The category page fetched `/api/data` with no `?slim=1` — the FULL catalogue,
 * every product carrying its description in three languages, its story
 * chapters, guides, FAQs, reviews and galleries. Worse, it used the same
 * react-query key as the hook that fetches the slim projection, and one Query
 * per key means the last observer to render installs its own `queryFn` for
 * every later refetch. So the heavy fetcher became the fetcher for the focus
 * refetch too, and the `?slim=1` preload in the document head could never be
 * used: different URL, different cache entry, catalogue downloaded twice.
 *
 * These are source assertions because rendering this page needs a router, a
 * query client and a catalogue. What must not drift is which payload it asks
 * for and that it no longer defines a competing observer on a shared key.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("src/routes/category.$categoryId.tsx", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");

describe("the page asks for the payload it can use", () => {
  it("goes through the shared store hook", () => {
    expect(SOURCE).toContain("useStoreData()");
    expect(SOURCE).toContain('from "@/hooks/useStoreData"');
  });

  it("no longer defines its own observer on the shared key", () => {
    /*
      The collision, not merely the payload size. Two observers on one key let
      whichever renders last decide the fetcher for both.
    */
    expect(SOURCE).not.toMatch(/queryKey:\s*\["store"\]/);
    expect(SOURCE).not.toContain("queryFn: api.store");
  });

  it("does not import the full-catalogue client any more", () => {
    expect(SOURCE).not.toMatch(/import \{ api \} from "@\/lib\/api"/);
  });
});

describe("the sort key is computed once per product", () => {
  it("takes the key functions from a module instead of defining them inline", () => {
    expect(SOURCE).toContain('from "@/lib/listingSort"');
    expect(SOURCE).toMatch(/freshnessScore/);
    expect(SOURCE).toMatch(/releaseTime/);
  });

  it("no longer builds a scorer inside the comparator", () => {
    /*
      Both date sorts built their key in a closure the comparator called on
      BOTH operands — about 29,270 calls for 1,714 games, each constructing up
      to two Dates and running up to two regexes. 35.2 ms against 2.9 ms for
      the identical ordering.
    */
    expect(SOURCE).not.toMatch(/const getScore = \(/);
    expect(SOURCE).not.toMatch(/const getVal = \(/);
  });

  it("decorates before sorting", () => {
    expect(SOURCE).toMatch(/new Map\(filtered\.map/);
  });
});
