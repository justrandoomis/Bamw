/**
 * Wikipedia's language links, read as a third source of Chinese supplier names.
 *
 * Wikidata answered for 90 of 143 games and left 53 with nothing — not because
 * the requests failed (that run reported zero failures) but because those items
 * carry no Chinese *label*. A Wikidata label and a Chinese Wikipedia article
 * are different things, and plenty of games have the second without the first:
 * the label is one editor's field, the article is a whole community's page.
 *
 * So: ask English Wikipedia for the game's article, take the Chinese article it
 * links to, and use that article's title.
 *
 * The danger here is worse than Wikidata's, not better. `Stray` is a
 * disambiguation page, `Hades` is a Greek god, and following either would put a
 * god's name on a game order. Wikipedia has no `instance of` to check, so the
 * identity check is borrowed rather than skipped: the English page names its
 * Wikidata item, and that item is put through the same two tests the Wikidata
 * source uses — it must read as a video game, and its English label or an alias
 * must match the title we asked for, whole.
 *
 * An article with no Wikidata item is refused. An article whose item is a god,
 * a film or a disambiguation page is refused. What is left is a Chinese article
 * title for a game we have identified twice over.
 */

/* The same range `checkSupplierNameZh` uses. */
const HAN = /[一-鿿㐀-䶿豈-﫿]/;

const EN_API = "https://en.wikipedia.org/w/api.php";

export const zhArticleUrl = (title) =>
  `https://zh.wikipedia.org/wiki/${encodeURIComponent(String(title ?? "").replace(/ /g, "_"))}`;

/**
 * The English article, its Chinese language link, and the Wikidata item it
 * belongs to — in one request.
 *
 * `redirects=1` is what makes an alternate spelling find the article at all.
 * `variant=zh-cn` asks for the Simplified reading of the linked title; where
 * MediaWiki does not honour it the name arrives Traditional and
 * `checkSupplierNameZh` flags it for review, which is the right outcome rather
 * than a silent one.
 */
export function langlinkUrl(title) {
  const params = new URLSearchParams({
    action: "query",
    titles: String(title ?? ""),
    prop: "langlinks|pageprops",
    lllang: "zh",
    ppprop: "wikibase_item",
    redirects: "1",
    variant: "zh-cn",
    format: "json",
    formatversion: "2",
    origin: "*",
  });
  return `${EN_API}?${params}`;
}

/**
 * What one `langlinkUrl` response holds, or null.
 *
 * Returns `{ zhTitle, itemId }`. Both are required: without the Chinese title
 * there is no name, and without the item id there is no way to check that the
 * article is the game rather than the god it is named after.
 */
export function readLanglink(json) {
  const page = (json?.query?.pages ?? [])[0];
  if (!page || page.missing) return null;

  const zhTitle = String(page.langlinks?.[0]?.title ?? "").trim();
  if (!zhTitle || !HAN.test(zhTitle)) return null;

  const itemId = String(page.pageprops?.wikibase_item ?? "").trim();
  if (!/^Q\d+$/.test(itemId)) return null;

  return { zhTitle, itemId, sourceUrl: zhArticleUrl(zhTitle) };
}
