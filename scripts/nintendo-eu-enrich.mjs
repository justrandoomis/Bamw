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

// The index reader and the matching rules live in one module since the games
// database loader became their second reader (scripts/games-db-load.mjs).
import { fetchSwitchIndex, indexMaps, matchProduct } from "./lib/nintendo-eu-index.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, value, i, all) => {
    if (value.startsWith("--")) acc.push([value.slice(2), all[i + 1]?.startsWith("--") ? "1" : all[i + 1]]);
    return acc;
  }, []),
);
const OUT = args.out || "nintendo-eu-out";
const CATALOGUE = args.catalogue;

mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------ 1. the index */
const { index } = await fetchSwitchIndex({
  onProgress: (read, total) => process.stdout.write(`\rindex ${read}/${total}`),
});
process.stdout.write("\n");
writeFileSync(join(OUT, "nintendo-eu-switch-index.json"), JSON.stringify(index));
console.log(`Nintendo EU: ${index.length} Switch-family games`);

if (!CATALOGUE) process.exit(0);

/* ------------------------------------------------------------- 2. matching */
const maps = indexMaps(index);

const doc = JSON.parse(readFileSync(CATALOGUE, "utf8"));
const products = (doc.products ?? []).filter((p) => String(p.kind) !== "hardware");
const empty = (v) =>
  v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);
/** A picture in the shop's own storage, served by `/api/files/...` (scripts/lib/square-link-verdict.mjs). */
const STORED = /^(?:https?:\/\/[^/]+)?\/api\/files\//i;

const patches = [];
const unmatched = [];
const matchedIds = new Set();
for (const product of products) {
  // Store link, then nsuid, then the one title on the same console.
  const match = matchProduct(product, maps);
  if (!match) {
    unmatched.push({ id: product.id, title: product.titleEn || product.title, platform: product.platform });
    continue;
  }
  const { game, how } = match;
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
  /*
    A picture the shop keeps in its own storage (`/api/files/...`) may be a
    link to a file that is gone: Kirby and the Forgotten Land's square card
    answered 404 on 2026-11-05 and the page showed «لم يتم إضافة الصورة بعد».
    Nintendo's picture for the same role is offered as a repair, and written
    only where the buckets prove the stored file absent from both
    (scripts/catalogue-enrich.mjs). A live stored picture is never replaced.
  */
  const repair = {};
  const offer = (field, value) => {
    if (value && STORED.test(String(product[field] ?? "").trim())) repair[field] = value;
  };
  offer("cartridgeImage", game.images.frontBox);
  offer("nintendoCardImage", game.images.square);
  offer("coverImage", game.images.wide);
  if (Object.keys(fill).length || Object.keys(repair).length) {
    patches.push({
      id: product.id,
      title: product.titleEn || product.title,
      how,
      euId: game.euId,
      fill,
      ...(Object.keys(repair).length ? { repair } : {}),
    });
  }
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
const repairCounts = {};
for (const p of patches) for (const k of Object.keys(p.repair ?? {})) repairCounts[k] = (repairCounts[k] ?? 0) + 1;
const how = patches.reduce((acc, p) => ((acc[p.how] = (acc[p.how] ?? 0) + 1), acc), {});
console.log(
  JSON.stringify(
    {
      shopGames: products.length,
      withPatch: patches.length,
      matchedBy: how,
      unmatched: unmatched.length,
      fieldsFilled: fieldCounts,
      repairsOffered: repairCounts,
      missingFromShop: missing.length,
    },
    null,
    1,
  ),
);
