/**
 * Nintendo Europe's public game index — the list behind nintendo.com/en-gb —
 * read one way by every script that needs it.
 *
 *   https://search.nintendo-europe.com/en/select   (public, no key)
 *
 * Moved here from `scripts/nintendo-eu-enrich.mjs` unchanged, when the games
 * database loader (`scripts/games-db-load.mjs`) became the second reader: two
 * copies of `toFacts` would have drifted, and the enrichment and the database
 * would have started describing the same game differently.
 *
 * For every Switch-family game it keeps the facts the shop shows and the three
 * pictures, each in the role Nintendo files it under:
 *
 *   05_packshots     → images.frontBox  (vertical front box)
 *   11_square_images → images.square    (square card)
 *   10_share_images  → images.wide      (wide 2:1 hero)
 */

export const ENDPOINT = "https://search.nintendo-europe.com/en/select";
export const ORIGIN = "https://www.nintendo.com";
export const FIELDS = [
  "fs_id", "url", "title", "sorting_title", "nsuid_txt", "product_code_txt", "product_code_ss",
  "dates_released_dts", "publisher", "developer", "excerpt", "product_catalog_description_s",
  "pretty_game_categories_txt", "pretty_agerating_s", "players_from", "players_to",
  "language_availability", "datasize_readable_txt", "playable_on_txt", "image_url", "image_url_sq_s",
  "image_url_h2x1_s", "physical_version_b", "digital_version_b", "eshop_removed_b", "game_series_txt",
  // The rest of what Nintendo says about a game (`details` in `toFacts`), and
  // its downloads rank: the order «الأكثر مبيعًا عالميًا» gives the catalogue.
  "downloads_rank_i", "play_mode_tv_mode_b", "play_mode_tabletop_mode_b", "play_mode_handheld_mode_b",
  "play_mode_camera_play_b", "players_from_local_i", "players_to_local_i", "players_from_online_i",
  "players_to_online_i", "paid_subscription_required_b", "internet_required_b", "cloud_saves_b",
  "demo_availability", "hdr_b", "surround_sound_b", "image_url_h16x9_s", "copyright_s",
].join(",");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One page of the Switch / Switch 2 index, sorted by title so pages do not overlap. */
export function indexPageUrl(start, rows) {
  return (
    `${ENDPOINT}?q=*%3A*&fq=${encodeURIComponent("type:GAME AND (playable_on_txt:HAC OR playable_on_txt:BEE)")}` +
    `&sort=${encodeURIComponent("sorting_title asc")}&start=${start}&rows=${rows}&wt=json&fl=${FIELDS}`
  );
}

/** The Solr `response` object of one page, retried four times before it is a failure. */
export async function fetchIndexPage(start, rows, { fetchImpl = fetch, sleep = wait } = {}) {
  const url = indexPageUrl(start, rows);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).response;
    } catch (err) {
      if (attempt === 4) throw err;
      await sleep(1500 * attempt);
    }
  }
  throw new Error("unreachable");
}

/**
 * The whole index, as facts. `total` is what Nintendo says it holds, so a
 * caller can tell a complete read from a short one.
 */
export async function fetchSwitchIndex({
  rows = 500,
  pauseMs = 250,
  onProgress = () => {},
  fetchImpl = fetch,
  sleep = wait,
} = {}) {
  const firstPage = await fetchIndexPage(0, rows, { fetchImpl, sleep });
  const total = Number(firstPage?.numFound ?? 0);
  const index = (firstPage?.docs ?? []).map(toFacts);
  for (let start = rows; start < total; start += rows) {
    const next = await fetchIndexPage(start, rows, { fetchImpl, sleep });
    index.push(...(next?.docs ?? []).map(toFacts));
    onProgress(index.length, total);
    await sleep(pauseMs);
  }
  return { total, index };
}

export const absolute = (value) => {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return `${ORIGIN}${s}`;
  return s.startsWith("http") ? s : "";
};
export const first = (value) => (Array.isArray(value) ? value[0] : value);
export const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** One Nintendo row, in the shop's own field names. */
export function toFacts(row) {
  const consoles = (row.playable_on_txt ?? []).map((c) => String(c).toUpperCase());
  const released = first(row.dates_released_dts);
  const languages = clean(first(row.language_availability))
    .split(/\s*,\s*/)
    .filter(Boolean)
    .map((l) => l.charAt(0).toUpperCase() + l.slice(1));
  const size = clean(first(row.datasize_readable_txt));
  const playersFrom = Number(row.players_from) || 0;
  const playersTo = Number(row.players_to) || 0;
  const range = (from, to) => {
    const low = Number(from) || 0;
    const high = Number(to) || 0;
    return high > 1 ? `${low || 1}-${high}` : high === 1 ? "1" : "";
  };
  const rank = Number(row.downloads_rank_i);
  return {
    euId: String(row.fs_id ?? ""),
    euUrl: row.url ? `${ORIGIN}${row.url}` : "",
    title: clean(row.title),
    platform: consoles.includes("BEE") && !consoles.includes("HAC") ? "switch2" : consoles.includes("BEE") ? "both" : "switch1",
    nsuid: String(first(row.nsuid_txt) ?? ""),
    productCode: String(first(row.product_code_txt) ?? first(row.product_code_ss) ?? ""),
    releaseDate: released ? String(released).slice(0, 10) : "",
    publisher: clean(row.publisher),
    developer: clean(row.developer),
    description: clean(row.product_catalog_description_s || row.excerpt),
    genres: (row.pretty_game_categories_txt ?? []).map(clean).filter(Boolean),
    ageRating: clean(row.pretty_agerating_s),
    numberOfPlayers: playersTo > 1 ? `${playersFrom || 1}-${playersTo}` : playersTo === 1 ? "1" : "",
    supportedLanguages: languages.join(", "),
    size,
    physical: row.physical_version_b === true,
    digital: row.digital_version_b === true,
    delisted: row.eshop_removed_b === true,
    series: (row.game_series_txt ?? []).map(clean).filter(Boolean),
    images: {
      frontBox: absolute(row.image_url).includes("/05_packshots/") ? absolute(row.image_url) : "",
      square: absolute(row.image_url_sq_s),
      wide: absolute(row.image_url_h2x1_s),
    },
    // Nintendo's own downloads rank, 1 = most downloaded; 0 = unranked (about half the index).
    downloadsRank: Number.isInteger(rank) && rank > 0 ? rank : 0,
    /*
      What Nintendo's game page lists beside the facts above. Only a flag that
      is true is a fact: Nintendo leaves most of these unset, and an unset
      «online play» is not a game without one.
    */
    details: {
      modes: [
        ["tv", row.play_mode_tv_mode_b],
        ["tabletop", row.play_mode_tabletop_mode_b],
        ["handheld", row.play_mode_handheld_mode_b],
      ]
        .filter(([, on]) => on === true)
        .map(([mode]) => mode),
      localPlayers: range(row.players_from_local_i, row.players_to_local_i),
      onlinePlayers: range(row.players_from_online_i, row.players_to_online_i),
      nintendoSwitchOnline: row.paid_subscription_required_b === true,
      internetRequired: row.internet_required_b === true,
      cloudSaves: row.cloud_saves_b === true,
      demo: row.demo_availability === true,
      hdr: row.hdr_b === true,
      surroundSound: row.surround_sound_b === true,
      cameraPlay: row.play_mode_camera_play_b === true,
      image16x9: absolute(row.image_url_h16x9_s),
      copyright: clean(row.copyright_s),
    },
  };
}

/* ------------------------------------------------------- matching a product */

/** A title folded for matching a shop product to a Nintendo row. */
export const normalise = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[™®©]/g, "")
    .replace(/\s*[[(](switch 2|nintendo switch 2|switch|nintendo switch)[\])]\s*/g, " ")
    .replace(/[–—:\-_'’".,!?&+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const pathOf = (url) => {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
};

/** A product and a Nintendo row on compatible consoles. */
export const sameConsole = (product, game) => {
  const p = String(product.platform ?? "switch1");
  return p === "both" || game.platform === "both" || p === game.platform;
};

/** The product's own links to Nintendo's European store, as paths. */
export const storeLinkPaths = (product) =>
  [product.officialStoreUrl, product.nintendoEshopUrl, product.eshopUrl, product.officialUrl]
    .filter(Boolean)
    .map(pathOf)
    .filter((p) => p.includes("/en-gb/") || p.includes("/en/"));

/** Lookup tables over the index: by store path, by nsuid, by folded title. */
export function indexMaps(index) {
  const byPath = new Map();
  const byNsuid = new Map();
  const byTitle = new Map();
  for (const game of index) {
    if (game.euUrl) byPath.set(pathOf(game.euUrl), game);
    if (game.nsuid) byNsuid.set(game.nsuid, game);
    const key = normalise(game.title);
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(game);
  }
  return { byPath, byNsuid, byTitle };
}

/**
 * The Nintendo row a product is, strongest evidence first: its own Nintendo
 * store link, then its nsuid, then its exact folded title on the same console
 * — and only when exactly one row has that title. No confident match is no
 * match; a wrong link is worse than none.
 */
export function matchProduct(product, maps) {
  const viaLink = storeLinkPaths(product)
    .map((p) => maps.byPath.get(p))
    .find(Boolean);
  if (viaLink) return { game: viaLink, how: "store-link" };
  if (product.nsuid && maps.byNsuid.has(String(product.nsuid))) {
    return { game: maps.byNsuid.get(String(product.nsuid)), how: "nsuid" };
  }
  const candidates = (maps.byTitle.get(normalise(product.titleEn || product.title)) ?? []).filter((g) =>
    sameConsole(product, g),
  );
  if (candidates.length === 1) return { game: candidates[0], how: "title" };
  return null;
}
