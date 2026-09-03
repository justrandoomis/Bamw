import { describe, expect, it } from "vitest";

import { langlinkUrl, readLanglink, zhArticleUrl } from "./lib/supplier-name-wikipedia.mjs";

/** One page from a `formatversion=2` query response, cut to what is read. */
const response = (page) => ({ query: { pages: [page] } });

describe("langlinkUrl", () => {
  const url = new URL(langlinkUrl("Hollow Knight"));

  it("asks English Wikipedia for the Chinese link and the Wikidata item", () => {
    expect(url.origin + url.pathname).toBe("https://en.wikipedia.org/w/api.php");
    expect(url.searchParams.get("titles")).toBe("Hollow Knight");
    expect(url.searchParams.get("lllang")).toBe("zh");
    expect(url.searchParams.get("ppprop")).toBe("wikibase_item");
  });

  it("follows redirects, so an alternate spelling still finds the article", () => {
    expect(url.searchParams.get("redirects")).toBe("1");
  });

  it("asks English Wikipedia for no variant of its own language", () => {
    /*
      A variant has to be one of the queried wiki's own and English has none, so
      `variant=zh-cn` here is an invalid request. The first version sent it, got
      an error object back for every game, and reported zero finds — which read
      exactly like an honest answer.
    */
    expect(url.searchParams.get("variant")).toBeNull();
  });
});

describe("zhArticleUrl", () => {
  it("builds a URL a person can open", () => {
    expect(zhArticleUrl("空洞骑士")).toBe(
      `https://zh.wikipedia.org/wiki/${encodeURIComponent("空洞骑士")}`,
    );
  });

  it("writes a space the way Wikipedia does", () => {
    expect(zhArticleUrl("Final Fantasy VI")).toContain("Final_Fantasy_VI");
  });
});

describe("readLanglink", () => {
  it("returns the Chinese title and the item it belongs to", () => {
    const out = readLanglink(
      response({
        title: "Hollow Knight",
        langlinks: [{ lang: "zh", title: "空洞骑士" }],
        pageprops: { wikibase_item: "Q28134476" },
      }),
    );
    expect(out).toEqual({
      zhTitle: "空洞骑士",
      itemId: "Q28134476",
      sourceUrl: zhArticleUrl("空洞骑士"),
    });
  });

  it("reports an API error as a failure, not as an absent name", () => {
    const out = readLanglink({ error: { code: "invalidvariant", info: "..." } });
    expect(out).toEqual({ failed: true, why: "invalidvariant" });
  });

  it("refuses an article that does not exist", () => {
    expect(readLanglink(response({ title: "Nothing", missing: true }))).toBeNull();
    expect(readLanglink({})).toBeNull();
  });

  it("refuses an article with no Chinese link", () => {
    expect(
      readLanglink(response({ title: "Rotwood", pageprops: { wikibase_item: "Q1" } })),
    ).toBeNull();
  });

  it("refuses a Chinese link that is not in Chinese", () => {
    /*
      Chinese Wikipedia keeps the Latin name for a good many games — its
      Minecraft article is called Minecraft. That is not a supplier name, and
      returning it would put the English title on the clipboard by the back door.
    */
    expect(
      readLanglink(
        response({
          title: "Minecraft",
          langlinks: [{ lang: "zh", title: "Minecraft" }],
          pageprops: { wikibase_item: "Q49740" },
        }),
      ),
    ).toBeNull();
  });

  it("refuses an article with no Wikidata item", () => {
    /*
      The item is how the article is checked to be the game rather than the god
      it is named after. Without one there is nothing to check against.
    */
    expect(
      readLanglink(response({ title: "Hades", langlinks: [{ lang: "zh", title: "哈迪斯" }] })),
    ).toBeNull();
    expect(
      readLanglink(
        response({
          title: "Hades",
          langlinks: [{ lang: "zh", title: "哈迪斯" }],
          pageprops: { wikibase_item: "not-an-item" },
        }),
      ),
    ).toBeNull();
  });
});
