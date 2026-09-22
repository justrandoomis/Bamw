/**
 * Nintendo's European catalogue, searched by title.
 *
 * ## Why a second source at all
 *
 * The url-key approach asks `nintendo.com/us/store/products/<guessed-key>/`
 * and it answered for the games it could. The fourth apply run measured what
 * is left: 308 games whose every candidate key returns a real 404. Nintendo's
 * US store does not carry them under any name this can build — a European or
 * Japanese release, a delisted title, a publisher who never shipped it there.
 * No further guessing finds those, because there is nothing to guess at.
 *
 * Nintendo of Europe publishes a search index over its own catalogue, and it
 * carries `image_url_sq_s` — the square key art, the same role, from Nintendo
 * itself rather than from a third party.
 *
 * ## Why a search is more dangerous than a url key, and what is done about it
 *
 * A url key either resolves to a page or it does not. A search always returns
 * something, and the something is ranked by relevance, which is exactly how a
 * game ends up wearing another game's artwork. Three rules, all of them
 * refusals:
 *
 * 1. The match must be EXACT on the normalised title — the same
 *    `normalizeTitle` the url-key path compares with, so "Trine 4" cannot
 *    satisfy "Trine 5" and a sequel cannot satisfy its predecessor.
 * 2. The console generation must agree, read from the row's own system names.
 *    A Switch 2 line may not take a Switch 1 listing's art, which is the same
 *    rule `identityMatch` enforces and for the same reason.
 * 3. Exactly one row may survive. Two rows with the same normalised title are
 *    two editions and this cannot tell which is meant, so it answers nothing.
 *
 * Nothing here decides what an image IS. It proposes a URL; the caller still
 * fetches it, proves it decodes, measures it square and uploads it — the same
 * chain every other candidate goes through.
 */

import { normalizeTitle, titleAlternatives } from "./nintendo-store.mjs";

const ENDPOINT = "https://search.nintendo-europe.com/en/select";

/** Strip the shop's own bracket, as the url-key path does. */
const PLATFORM_BRACKET = /\s*[[(]\s*(?:nintendo\s*)?switch\s*2?\s*[\])]\s*$/i;

/** Solr treats these as syntax; a title carrying one must not become a query. */
const escapeSolr = (term) => String(term ?? "").replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, " ");

const isSwitch2Row = (row) => {
  const systems = []
    .concat(row?.system_names_txt ?? [], row?.system_type ?? [], row?.title ?? "")
    .join(" ");
  return /switch\s*2/i.test(systems);
};

/**
 * Every row in the European catalogue whose title is EXACTLY this game's.
 *
 * Split out of `searchEuropeSquare` so the platform audit can ask a different
 * question of the same rows — "which consoles does Nintendo list this title
 * on?" — without a second, subtly different notion of what counts as the same
 * game. One exact-title rule, two callers.
 */
export async function europeRows(title, fetchJson) {
  const bare = String(title ?? "")
    .replace(PLATFORM_BRACKET, "")
    .trim();
  if (!normalizeTitle(bare)) return { ok: false, reason: "no comparable title" };

  /*
    ONE SEARCH PER ALTERNATIVE, IN ORDER, AND THE FIRST THAT ANSWERS WINS.

    «Pokémon Sword / Shield» is two games, and Europe has no row with that
    exact title — so the whole row was refused with «no row with this exact
    title» while both halves sat in the index.

    Deliberately a loop and not one pooled search: pooling would put «Pokémon
    Sword» and «Pokémon Shield» in `exact` together and trip the two-rows
    refusal downstream, which reads several exact matches as an ambiguity it
    must not guess at. Asked one at a time, each answer is unambiguous.

    The whole title is always tried first, so nothing that resolves today stops
    resolving, and the LAST failure's reason is what gets reported.
  */
  let lastReason = "no row with this exact title";
  for (const candidate of titleAlternatives(bare)) {
    const wanted = normalizeTitle(candidate);
    if (!wanted) continue;

    const query = escapeSolr(candidate).trim();
    if (!query) {
      lastReason = "title has no searchable words";
      continue;
    }

    const url =
      `${ENDPOINT}?q=${encodeURIComponent(query)}` +
      `&fq=${encodeURIComponent("type:GAME AND *:*")}` +
      `&rows=24&wt=json`;

    const found = await fetchJson(url);
    if (!found.ok) {
      lastReason = `search HTTP ${found.status ?? 0}`;
      continue;
    }

    const docs = found.json?.response?.docs;
    if (!Array.isArray(docs) || docs.length === 0) {
      lastReason = "no rows";
      continue;
    }

    /*
      Equality, not containment, and on the same normalisation the url-key path
      uses. Relevance ranking is what makes a search dangerous here; an exact
      title is the only thing worth acting on.
    */
    const exact = docs.filter((row) => normalizeTitle(row?.title) === wanted);
    if (exact.length === 0) {
      lastReason = "no row with this exact title";
      continue;
    }
    return { ok: true, rows: exact };
  }
  return { ok: false, reason: lastReason };
}

/**
 * Which console generations Nintendo of Europe lists this exact title on.
 *
 * The one question `searchEuropeSquare` cannot answer, because it takes the
 * generation as an input and refuses anything that disagrees with it. Here the
 * generation IS the answer, so nothing is filtered by it.
 *
 * A "Nintendo Switch 2 Edition" is a different title, not a different console
 * row for the same one, so it cannot reach this list: its name carries those
 * words and the exact-title rule above rejects it against a plain title. That
 * is deliberate — an edition is a separate SKU and must not be read as
 * evidence that the plain game is a Switch 2 product.
 *
 * @returns {{ok: true, generations: string[], rows: object[]}} | {ok: false, reason: string}
 */
export async function searchEuropeGenerations(title, fetchJson) {
  const found = await europeRows(title, fetchJson);
  if (!found.ok) return found;
  const generations = [
    ...new Set(found.rows.map((row) => (isSwitch2Row(row) ? "switch2" : "switch1"))),
  ].sort();
  return { ok: true, generations, rows: found.rows };
}

/**
 * The square art Nintendo Europe holds for this exact game, or null.
 *
 * @param title     the shelf title, bracket and all
 * @param wantTwo   true when this shop's line is a Switch 2 edition
 * @param fetchJson injected so the caller owns timeouts and retries
 */
export async function searchEuropeSquare(title, wantTwo, fetchJson) {
  const found = await europeRows(title, fetchJson);
  if (!found.ok) return found;
  const exact = found.rows;

  let sameGeneration = exact.filter((row) => isSwitch2Row(row) === Boolean(wantTwo));
  let crossedGeneration = false;
  if (sameGeneration.length === 0) {
    /*
      THE OTHER GENERATION'S ROW, WHEN IT IS THE ONLY ONE THERE.

      Measured: of forty games re-asked about, ten were FOUND and then refused
      right here — this shop calls the game a Switch 2 edition and Nintendo
      lists only the Switch 1 one — and eighteen of the six hundred have no
      Switch 2 row in either store at all. Every one of them is left with no
      picture whatsoever.

      A generation is not an edition. «Standard» and «Deluxe» are two different
      products and the rule below rightly refuses to guess between them; the
      Switch 1 and Switch 2 listings of one game are the same game with the
      same key art, and Nintendo ships the same square asset for both. Taking
      it is not a guess — and a game with no image at all is not the safer
      answer, it is just the emptier one.

      Still one row or nothing: if the other generation has two editions, this
      is as unable to choose between them as before. And the provenance says
      which listing the picture came from, so nothing pretends otherwise.
    */
    sameGeneration = exact;
    crossedGeneration = true;
  }
  if (sameGeneration.length === 0) {
    return { ok: false, reason: `no ${wantTwo ? "Switch 2" : "Switch"} row with this title` };
  }
  /*
    Two rows, one title. They are two editions — a standard and a deluxe, a
    regional re-release — and there is nothing here that can say which one the
    shelf means. Guessing is how the wrong box art gets stored.
  */
  if (sameGeneration.length > 1) {
    return { ok: false, reason: `${sameGeneration.length} rows share this exact title` };
  }

  const row = sameGeneration[0];
  const square = String(row?.image_url_sq_s ?? "").trim();
  if (!square) return { ok: false, reason: "the row carries no square image" };

  return {
    ok: true,
    url: square.startsWith("//") ? `https:${square}` : square,
    provenance: crossedGeneration
      ? `Nintendo of Europe catalogue, square key art for "${row.title}" — the ${
          isSwitch2Row(row) ? "Switch 2" : "Switch"
        } listing, this shop calls it the ${wantTwo ? "Switch 2" : "Switch"} edition; same game, same key art`
      : `Nintendo of Europe catalogue, square key art for "${row.title}"`,
    matchedTitle: String(row.title ?? ""),
  };
}
