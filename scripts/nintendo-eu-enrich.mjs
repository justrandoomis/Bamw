#!/usr/bin/env node
/**
 * Nintendo Europe's own catalogue → fill-only patches for the shop's games,
 * and the list of Switch / Switch 2 games the shop does not carry yet.
 *
 *   node scripts/nintendo-eu-enrich.mjs --catalogue <public /api/data json> --out <dir>
 *
 * Reads (public, no key): https://search.nintendo-europe.com/en/select — the
 * index behind nintendo.com/en-gb. For every Switch-family game it keeps the
 * facts the shop shows (description, genres, publisher, developer, release
 * date, PEGI, players, languages, size, product code) and the three pictures,
 * each in the role Nintendo files it under:
 *
 *   05_packshots     → `cartridgeImage`     (vertical front box)
 *   11_square_images → `nintendoCardImage`  (square card)
 *   10_share_images  → `coverImage`         (wide 2:1 hero)
 *
 * Matching, strongest first: the product's own Nintendo store link, then the
 * nsuid, then the exact normalised title on the same console. A product with
 * no confident match is left alone and listed for a person to check.
 *
 * FILL ONLY: a patch carries a field only when the shop's value is empty. It
 * never overwrites what the shop already says — a curated Arabic description
 * or a hand-picked cover is worth more than Nintendo's generic copy.
 *
 * Writes nothing anywhere but `--out`. Applying the patches is a separate,
 * deliberate step (the admin's product PATCH, which writes the overlay row).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, value, i, all) => {
    if (value.startsWith("--")) acc.push([value.slice(2), all[i + 1]?.startsWith("--") ? "1" : all[i + 1]]);
    return acc;
  }, []),
);
const OUT = args.out || "nintendo-eu-out";
const CATALOGUE = args.catalogue;
const ENDPOINT = "https://search.nintendo-europe.com/en/select";
const ORIGIN = "https://www.nintendo.com";
const FIELDS = [
  "fs_id", "url", "title", "sorting_title", "nsuid_txt", "product_code_txt", "product_code_ss",
  "dates_released_dts", "publisher", "developer", "excerpt", "product_catalog_description_s",
  "pretty_game_categories_txt", "pretty_agerating_s", "players_from", "players_to",
  "language_availability", "datasize_readable_txt", "playable_on_txt", "image_url", "image_url_sq_s",
  "image_url_h2x1_s", "physical_version_b", "digital_version_b", "eshop_removed_b", "game_series_txt",
].join(",");

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(start, rows) {
  const url =
    `${ENDPOINT}?q=*%3A*&fq=${encodeURIComponent("type:GAME AND (playable_on_txt:HAC OR playable_on_txt:BEE)")}` +
    `&sort=${encodeURIComponent("sorting_title asc")}&start=${start}&rows=${rows}&wt=json&fl=${FIELDS}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).response;
    } catch (err) {
      if (attempt === 4) throw err;
      await sleep(1500 * attempt);
    }
  }
}

const absolute = (value) => {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return `${ORIGIN}${s}`;
  return s.startsWith("http") ? s : "";
};
const first = (value) => (Array.isArray(value) ? value[0] : value);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** One Nintendo row, in the shop's own field names. */
function toFacts(row) {
  const consoles = (row.playable_on_txt ?? []).map((c) => String(c).toUpperCase());
  const released = first(row.dates_released_dts);
  const languages = clean(first(row.language_availability))
    .split(/\s*,\s*/)
    .filter(Boolean)
    .map((l) => l.charAt(0).toUpperCase() + l.slice(1));
  const size = clean(first(row.datasize_readable_txt));
  const playersFrom = Number(row.players_from) || 0;
  const playersTo = Number(row.players_to) || 0;
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
  };
}

/* ------------------------------------------------------------ 1. the index */
const rows = 500;
const firstPage = await page(0, rows);
const total = firstPage.numFound;
const index = firstPage.docs.map(toFacts);
for (let start = rows; start < total; start += rows) {
  const next = await page(start, rows);
  index.push(...next.docs.map(toFacts));
  process.stdout.write(`\rindex ${index.length}/${total}`);
  await sleep(250);
}
process.stdout.write("\n");
writeFileSync(join(OUT, "nintendo-eu-switch-index.json"), JSON.stringify(index));
console.log(`Nintendo EU: ${index.length} Switch-family games`);

if (!CATALOGUE) process.exit(0);

/* ------------------------------------------------------------- 2. matching */
const normalise = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[™®©]/g, "")
    .replace(/\s*[[(](switch 2|nintendo switch 2|switch|nintendo switch)[\])]\s*/g, " ")
    .replace(/[–—:\-_'’".,!?&+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const pathOf = (url) => {
  try {
    return new URL(url).pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
};

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

const doc = JSON.parse(readFileSync(CATALOGUE, "utf8"));
const products = (doc.products ?? []).filter((p) => String(p.kind) !== "hardware");
const empty = (v) =>
  v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);
const sameConsole = (product, game) => {
  const p = String(product.platform ?? "switch1");
  return p === "both" || game.platform === "both" || p === game.platform;
};

const patches = [];
const unmatched = [];
const matchedIds = new Set();
for (const product of products) {
  const links = [product.officialStoreUrl, product.nintendoEshopUrl, product.eshopUrl, product.officialUrl]
    .filter(Boolean)
    .map(pathOf)
    .filter((p) => p.includes("/en-gb/") || p.includes("/en/"));
  let game = links.map((p) => byPath.get(p)).find(Boolean);
  let how = game ? "store-link" : "";
  if (!game && product.nsuid && byNsuid.has(String(product.nsuid))) {
    game = byNsuid.get(String(product.nsuid));
    how = "nsuid";
  }
  if (!game) {
    const candidates = (byTitle.get(normalise(product.titleEn || product.title)) ?? []).filter((g) =>
      sameConsole(product, g),
    );
    if (candidates.length === 1) {
      game = candidates[0];
      how = "title";
    }
  }
  if (!game) {
    unmatched.push({ id: product.id, title: product.titleEn || product.title, platform: product.platform });
    continue;
  }
  matchedIds.add(game.euId);

  const fill = {};
  const put = (field, value) => {
    if (!empty(value) && empty(product[field])) fill[field] = value;
  };
  /*
    Nintendo Europe's catalogue text is a one-line pitch ("Survive Together!").
    It is the tagline the page prints under the title, and — only where the
    shop has no description at all — better than an empty description.
  */
  put("tagline", game.description);
  put("description", game.description);
  put("descriptionEn", game.description);
  put("genres", game.genres);
  put("publisher", game.publisher);
  put("developer", game.developer);
  put("releaseDate", game.releaseDate);
  put("ageRating", game.ageRating);
  put("numberOfPlayers", game.numberOfPlayers);
  put("supportedLanguages", game.supportedLanguages);
  put("size", game.size);
  // The game page reads the size in GB only (`downloadSizeGb`).
  const sizeMatch = /^([\d.]+)\s*(GB|MB)$/i.exec(game.size);
  if (sizeMatch) {
    const gb = Number(sizeMatch[1]) / (sizeMatch[2].toUpperCase() === "MB" ? 1024 : 1);
    if (Number.isFinite(gb) && gb > 0) put("downloadSizeGb", Math.round(gb * 100) / 100);
  }
  put("nsuid", game.nsuid);
  put("product_code", game.productCode);
  put("officialStoreUrl", game.euUrl);
  // Pictures, each only into its own role and only where the shop has none.
  put("cartridgeImage", game.images.frontBox);
  put("nintendoCardImage", game.images.square);
  put("coverImage", game.images.wide);
  if (Object.keys(fill).length) patches.push({ id: product.id, title: product.titleEn || product.title, how, euId: game.euId, fill });
}

const missing = index.filter((g) => !matchedIds.has(g.euId) && !g.delisted);
writeFileSync(join(OUT, "fill-patches.json"), JSON.stringify(patches, null, 1));
writeFileSync(join(OUT, "unmatched-products.json"), JSON.stringify(unmatched, null, 1));
writeFileSync(join(OUT, "missing-games.json"), JSON.stringify(missing));
writeFileSync(
  join(OUT, "missing-games.csv"),
  ["title,platform,release_date,publisher,nintendo_url"]
    .concat(
      missing.map((g) =>
        [g.title, g.platform, g.releaseDate, g.publisher, g.euUrl]
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(","),
      ),
    )
    .join("\n"),
);

const fieldCounts = {};
for (const p of patches) for (const k of Object.keys(p.fill)) fieldCounts[k] = (fieldCounts[k] ?? 0) + 1;
const how = patches.reduce((acc, p) => ((acc[p.how] = (acc[p.how] ?? 0) + 1), acc), {});
console.log(
  JSON.stringify(
    {
      shopGames: products.length,
      withPatch: patches.length,
      matchedBy: how,
      unmatched: unmatched.length,
      fieldsFilled: fieldCounts,
      missingFromShop: missing.length,
    },
    null,
    1,
  ),
);
