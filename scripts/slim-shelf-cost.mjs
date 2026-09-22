#!/usr/bin/env node
/**
 * What the games shelf loses by fetching `?slim=1` instead of the whole record.
 *
 * READ ONLY. There is no apply flag, and the only SQL is a SELECT.
 *
 * /category/$categoryId used to fetch the FULL catalogue and now fetches the
 * slim projection, which is the whole point — 6.78 MB against a 78-field
 * listing payload. But the projection is a fixed list of field names, and the
 * page reads fields through five helpers that were written against the full
 * record. A field that does not travel does not read as absent-but-fine: it
 * reads as ABSENT, and three of these helpers change what the member sees when
 * it does.
 *
 *   picturedFirst   — a game with artwork only in a dropped field is ranked as
 *                     having none, so it moves to the END of the shelf and is
 *                     labelled «لم يتم إضافة الصورة بعد». That is ترتيب العرض,
 *                     which must not change.
 *   getProductGenres — a genre only in `metadata.genres` disappears from the
 *                     chips and from what the filter matches.
 *   releaseTime     — a date only in `metadata` sorts the game to 1970 under
 *                     «تاريخ الإصدار».
 *   bannerCandidates — the header slideshow loses its pictures.
 *
 * So: count them. Not "could this happen" — how many products, by name, on the
 * live catalogue today.
 */

import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SECRETS = [process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID].filter(
  (v) => v && v.length >= 8,
);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const lines = [];
const say = (t = "") => {
  const safe = redact(t);
  lines.push(safe);
  console.log(safe);
};

/*
  The database id comes from wrangler.jsonc when the secret is not set, which
  is how every working script in this directory finds it — the first run of
  this one died on `missing D1_DATABASE_ID` because it only looked at the
  environment. The committed config IS the production binding.
*/
if (!process.env["D1_DATABASE_ID"] && !process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  try {
    const config = readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    const found = config.match(/"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/);
    if (found) process.env["D1_DATABASE_ID"] = found[1];
  } catch {
    /* Reported below as a missing id. */
  }
}
if (!process.env["D1_DATABASE_ID"] && process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  process.env["D1_DATABASE_ID"] = process.env["CLOUDFLARE_D1_DATABASE_ID"];
}
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) throw new Error(`missing ${key}`);
}

/* ------------------------------------- the projection, parsed not remembered */

const DATA_ROUTE = readFileSync("src/routes/api/data.ts", "utf8");
const listBlock = DATA_ROUTE.slice(
  DATA_ROUTE.indexOf("LIST_FIELDS"),
  DATA_ROUTE.indexOf("] as const;"),
);
const SLIM = new Set([...listBlock.matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]));
if (SLIM.size < 50) throw new Error(`only ${SLIM.size} slim fields parsed — refusing to report`);

const BARE = readFileSync("src/lib/bareListing.ts", "utf8");
const imageBlock = BARE.slice(BARE.indexOf("const IMAGE_FIELDS"), BARE.indexOf("const DESCRIPTION_FIELDS"));
const IMAGE_FIELDS = [...imageBlock.matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
if (IMAGE_FIELDS.length < 5) throw new Error("IMAGE_FIELDS not parsed");

const usable = (v) => typeof v === "string" && v.trim().length > 5;

/* -------------------------------------------------------- the live catalogue */

const outfile = path.resolve(".slim-shelf-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/import-entry.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "silent",
  alias: { "@": path.resolve("src") },
  external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
});
const app = await import(outfile);

const reachable = await app.d1All("SELECT count(*) AS n FROM store_kv");
if (!reachable.length) throw new Error("D1 is not reachable — refusing to report on nothing");

const rows = await app.d1All(
  "SELECT key, value FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%' OR key LIKE 'store:product:%'",
);
let aggregate = "";
const overlays = [];
for (const row of rows) {
  const key = String(row.key);
  if (key.startsWith("store:product:")) overlays.push(row);
  else aggregate += String(row.value ?? "");
}
const live = new Map();
for (const p of JSON.parse(aggregate || "[]")) if (p?.id) live.set(String(p.id), p);
for (const row of overlays) {
  let doc = null;
  try {
    doc = JSON.parse(String(row.value));
  } catch {
    continue;
  }
  if (!doc?.id) continue;
  if (doc._deleted === true) live.delete(String(doc.id));
  else live.set(String(doc.id), doc);
}

/** The slim record, produced exactly as the server produces it. */
const slimOf = (p) => {
  const out = {};
  for (const key of SLIM) if (p?.[key] !== undefined) out[key] = p[key];
  if (p?.switch2?.isSwitch2Edition === true) out.switch2 = { isSwitch2Edition: true };
  return out;
};

/* ----------------------------------------------------- what the shelf shows */

const inGamesCategory = (p) => {
  const cat = String(p?.category ?? p?.categoryId ?? "").toLowerCase();
  const kind = String(p?.kind ?? "").toLowerCase();
  return (
    cat === "nintendo_games" ||
    cat === "cat_nintendo" ||
    cat === "nintendo-switch-games" ||
    kind === "nintendo-switch-games"
  );
};

const hasPicture = (p) => IMAGE_FIELDS.some((f) => usable(p?.[f]));

const genresOf = (p) => {
  const out = new Set();
  const push = (v) => {
    if (typeof v === "string" && v.trim()) out.add(v.trim().toLowerCase());
  };
  if (Array.isArray(p?.genres)) p.genres.forEach(push);
  else if (typeof p?.genres === "string") p.genres.split(",").forEach(push);
  if (Array.isArray(p?.genre)) p.genre.forEach(push);
  else if (typeof p?.genre === "string") p.genre.split(",").forEach(push);
  if (Array.isArray(p?.metadata?.genres)) p.metadata.genres.forEach(push);
  if (Array.isArray(p?.tags)) p.tags.forEach(push);
  return out;
};

const releaseFieldOf = (p) =>
  p?.releaseDate ||
  p?.release_date ||
  p?.metadata?.releaseDate ||
  p?.metadata?.release_date ||
  p?.releaseYear ||
  p?.release_year ||
  null;

const SCENE_FIELDS = ["banner", "bannerImage", "heroImage", "keyArt", "wallpaper", "background"];
const cartridgeLike = (u) => {
  const l = String(u).toLowerCase();
  return (
    l.includes("cartridge") ||
    l.includes("/cartridges/") ||
    l.includes("cart_") ||
    l.includes("cover_thumb")
  );
};
const sceneUrls = (p) => {
  const out = [];
  const push = (v) => {
    const u = typeof v === "string" ? v : v?.url || v?.imageUrl;
    if (typeof u === "string" && u.length > 5 && !cartridgeLike(u)) out.push(u);
  };
  SCENE_FIELDS.forEach((f) => push(p?.[f]));
  for (const key of ["gallery", "galleryImages", "screenshots", "bannerImages"]) {
    const v = p?.[key];
    if (Array.isArray(v)) v.forEach(push);
    else if (typeof v === "string") v.split(",").forEach((s) => push(s.trim()));
  }
  if (Array.isArray(p?.metadata?.screenshots)) p.metadata.screenshots.forEach(push);
  if (Array.isArray(p?.metadata?.images?.screenshots)) p.metadata.images.screenshots.forEach(push);
  return out;
};

/* ------------------------------------------------------------------ the report */

const all = [...live.values()];
const shelf = all.filter(inGamesCategory);

say(`# What the games shelf loses to \`?slim=1\` — READ ONLY`);
say();
say(`Run at ${new Date().toISOString()}.`);
say();
say(`- products in production: **${all.length}**`);
say(`- in the games category (as the banner filter matches it): **${shelf.length}**`);
say(`- fields the slim projection carries: **${SLIM.size}**`);
say();

/* 1 — display order. The hard constraint. */
const lostPicture = all.filter((p) => hasPicture(p) && !hasPicture(slimOf(p)));
say(`## 1. ترتيب العرض — products that would move`);
say();
say(`\`picturedFirst\` reads ${IMAGE_FIELDS.length} fields: ${IMAGE_FIELDS.join(", ")}.`);
say(`Of those, the slim projection drops: **${IMAGE_FIELDS.filter((f) => !SLIM.has(f)).join(", ") || "none"}**.`);
say();
say(`Products with artwork that slim reports as having NONE: **${lostPicture.length}**`);
say();
if (lostPicture.length) {
  say(`| id | title | the field that carries the artwork |`);
  say(`| --- | --- | --- |`);
  for (const p of lostPicture.slice(0, 60)) {
    const field = IMAGE_FIELDS.find((f) => usable(p[f]) && !SLIM.has(f)) ?? "?";
    say(`| ${p.id} | ${String(p.titleEn || p.title || "").slice(0, 60)} | \`${field}\` |`);
  }
  if (lostPicture.length > 60) say(`| … | ${lostPicture.length - 60} more | |`);
  say();
}

/* 2 — genres. */
const lostGenres = all.filter((p) => {
  const full = genresOf(p);
  const thin = genresOf(slimOf(p));
  return full.size > thin.size;
});
say(`## 2. التصنيفات — genres that stop being filterable`);
say();
say(`Products whose genre list shrinks under slim: **${lostGenres.length}**`);
if (lostGenres.length) {
  say();
  for (const p of lostGenres.slice(0, 30)) {
    const lost = [...genresOf(p)].filter((g) => !genresOf(slimOf(p)).has(g));
    say(`- ${p.id} — ${String(p.titleEn || p.title || "").slice(0, 50)} — loses: ${lost.join(", ")}`);
  }
  if (lostGenres.length > 30) say(`- … ${lostGenres.length - 30} more`);
}
say();

/* 3 — release dates. */
const lostDate = all.filter((p) => releaseFieldOf(p) && !releaseFieldOf(slimOf(p)));
say(`## 3. تاريخ الإصدار — dates that stop sorting`);
say();
say(`Products with a release date only slim cannot see: **${lostDate.length}**`);
if (lostDate.length) {
  say();
  for (const p of lostDate.slice(0, 30)) {
    say(`- ${p.id} — ${String(p.titleEn || p.title || "").slice(0, 50)} — ${releaseFieldOf(p)}`);
  }
  if (lostDate.length > 30) say(`- … ${lostDate.length - 30} more`);
}
say();

/* 4 — the header slideshow. */
const fullPool = new Set();
const slimPool = new Set();
for (const p of shelf) {
  sceneUrls(p).forEach((u) => fullPool.add(u));
  sceneUrls(slimOf(p)).forEach((u) => slimPool.add(u));
}
const contributorsFull = shelf.filter((p) => sceneUrls(p).length > 0).length;
const contributorsSlim = shelf.filter((p) => sceneUrls(slimOf(p)).length > 0).length;
say(`## 4. بنر الصفحة — the header's picture pool`);
say();
say(`| | full record | slim |`);
say(`| --- | --- | --- |`);
say(`| distinct scene pictures in this category | ${fullPool.size} | ${slimPool.size} |`);
say(`| products contributing at least one | ${contributorsFull} | ${contributorsSlim} |`);
say();
say(`The slideshow needs 24. ${slimPool.size >= 24 ? "Slim has enough." : "**Slim does NOT have enough.**"}`);
say();
const byField = {};
for (const p of shelf) {
  for (const f of [...SCENE_FIELDS, "gallery", "galleryImages", "screenshots", "bannerImages"]) {
    const v = p?.[f];
    const n = Array.isArray(v) ? v.length : usable(v) ? 1 : 0;
    if (n) byField[f] = (byField[f] ?? 0) + 1;
  }
  if (Array.isArray(p?.metadata?.screenshots) && p.metadata.screenshots.length) {
    byField["metadata.screenshots"] = (byField["metadata.screenshots"] ?? 0) + 1;
  }
}
say(`Where those pictures live, by field, across the ${shelf.length} games:`);
say();
say(`| field | products with it | in slim? |`);
say(`| --- | --- | --- |`);
for (const [field, n] of Object.entries(byField).sort((a, b) => b[1] - a[1])) {
  say(`| \`${field}\` | ${n} | ${SLIM.has(field.split(".")[0]) ? "yes" : "**no**"} |`);
}
say();

/*
  The app's own category resolver, used by sections 5 and 6 below. Not a
  string match: the first pass of section 5 compared raw `category`/`kind`
  strings and found THREE non-game products in a catalogue of 1,714, which is
  not a finding but a broken matcher.
*/
const { getProductCategory } = app;
if (typeof getProductCategory !== "function") {
  throw new Error("getProductCategory is not exported — refusing to report a count from a guess");
}

/* 5 — the picture a NON-GAME card shows. */

/*
  `picturedFirst` decides the shelf ORDER and reads seven named fields, which
  section 1 covered. `resolveProductImage(p, "listing")` decides WHICH PICTURE
  IS DRAWN, and it has a last resort the other does not: a frame from the
  product's gallery. `gallery`, `galleryImages`, `lifestyleImages` and `images`
  are none of them in the projection — so a console or an accessory whose only
  photograph lives in a gallery would keep its place on the shelf and show a
  placeholder standing in it. Found by an adversarial reviewer's probe; counted
  here, in the same way as everything above.
*/
const { resolveProductImage } = app;

say(`## 5. صور البطاقات غير الألعاب — pictures a listing card would lose`);
say();

if (typeof resolveProductImage !== "function") {
  say(`\`resolveProductImage\` is not exported from the bundle, so this section could`);
  say(`not be measured. It is NOT a pass — do not read it as one.`);
} else {
  /*
    `getProductCategory` — the app's own resolver, not a string match.

    The first pass of this section matched raw `category`/`kind` strings and
    found THREE non-game products in a catalogue of 1,714. That is not a
    finding, it is a broken matcher, and its "0 products affected" would have
    been a zero out of nothing. The category page decides what a product is
    with `getProductCategory`, so this asks the same function the same
    question.
  */
  const NON_GAME = new Set(["hardware", "accessory", "amiibo", "gift_card", "used"]);
  const nonGameOf = (p) => {
    const resolved = String(getProductCategory(p) ?? "");
    return NON_GAME.has(resolved) ? resolved : "";
  };

  const lost = [];
  const byCategory = {};
  for (const p of all) {
    const category = nonGameOf(p);
    if (!category) continue;
    byCategory[category] = (byCategory[category] ?? 0) + 1;
    let full;
    let thin;
    try {
      full = resolveProductImage(p, "listing");
      thin = resolveProductImage(slimOf(p), "listing");
    } catch {
      continue;
    }
    if (!full?.isPlaceholder && thin?.isPlaceholder) lost.push({ p, category, full });
  }

  say(`Non-game products in production, by category:`);
  say();
  for (const [category, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    say(`- \`${category}\`: ${n}`);
  }
  say();
  const checked = Object.values(byCategory).reduce((sum, n) => sum + n, 0);
  say(`Checked: **${checked}** non-game products of ${all.length} in the catalogue.`);
  say();
  say(`Products whose listing card would fall back to a placeholder: **${lost.length}**`);
  if (lost.length) {
    say();
    say(`| id | title | where the picture is |`);
    say(`| --- | --- | --- |`);
    for (const row of lost.slice(0, 60)) {
      say(
        `| ${row.p.id} | ${String(row.p.titleEn || row.p.title || "").slice(0, 50)} | \`${row.full.source ?? "?"}\` |`,
      );
    }
    if (lost.length > 60) say(`| … | ${lost.length - 60} more | |`);
  }
}
say();

/* 6 — which SHELF a product lands on. */

/*
  The strongest of the reviewer's findings, and the one I had not measured.

  `getProductCategory` reads `category_id`, `category_title`, `schema_id` and
  `schema.id` as well as their camelCase spellings — and `resolveCategoryType`
  ends with `return "game"` when nothing resolves. So a pre-schema hardware or
  accessory row carrying only `category_id` reads as hardware on the full
  record and as a GAME on the slim one: not re-ordered within its shelf, but
  standing on the wrong shelf entirely.

  This asks the question directly, by running the app's own resolver over both
  shapes of every product and comparing the answers.
*/
say(`## 6. الرف نفسه — products that would change category`);
say();

const moved = [];
for (const p of all) {
  const full = String(getProductCategory(p) ?? "");
  const thin = String(getProductCategory(slimOf(p)) ?? "");
  if (full !== thin) moved.push({ p, full, thin });
}

const CATEGORY_FIELDS = [
  "category",
  "categoryId",
  "category_id",
  "categoryTitle",
  "category_title",
  "schemaId",
  "schema_id",
];
say(`\`getProductCategory\` reads: ${CATEGORY_FIELDS.join(", ")} (and \`schema.id\`).`);
say(`Of those, the slim projection drops: **${CATEGORY_FIELDS.filter((f) => !SLIM.has(f)).join(", ") || "none"}**.`);
say();
say(`Checked all **${all.length}** products.`);
say(`Products that would land on a DIFFERENT shelf: **${moved.length}**`);
if (moved.length) {
  say();
  say(`| id | title | full record | under slim |`);
  say(`| --- | --- | --- | --- |`);
  for (const row of moved.slice(0, 60)) {
    say(
      `| ${row.p.id} | ${String(row.p.titleEn || row.p.title || "").slice(0, 40)} | ${row.full} | **${row.thin}** |`,
    );
  }
  if (moved.length > 60) say(`| … | ${moved.length - 60} more | | |`);
}
say();

writeFileSync("slim-shelf-cost.md", `${lines.join("\n")}\n`);
