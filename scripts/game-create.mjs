#!/usr/bin/env node
/**
 * Creates the September supplier batch as hidden products, one game at a time.
 *
 * DRY RUN BY DEFAULT. `--apply` is required before anything is written, and
 * even then the only statements are an INSERT of one product's overlay row by
 * a freshly generated id, and one row in `product_admin_metadata` for the
 * Chinese supplier name. No existing product is read for update, none is
 * modified, and nothing is ever published.
 *
 * ## Why a product is written rather than imported
 *
 * The Nintendo `.txt` import path cannot express this batch. Its `option` rows
 * carry no price and no cost (gameImportSchema.ts), so a game imported that way
 * can never have a priced offline and online tier — which is the entire
 * commercial shape of these products. The document is therefore assembled here,
 * against `ProductOption` / `ProductTypeVariant`, which do carry cost.
 *
 * ## Hidden is a safety property, not a default
 *
 * Creating a product does not pass the publication floor: `checkPublishable`
 * runs on edit, not on create, so a document written with `isHidden: false` is
 * live immediately. Every document here is built hidden, and the check runs
 * again on the document that is about to be written rather than on intent.
 *
 * ## What it refuses to do
 *
 * - Take a product whose title is not exactly the one asked for, or whose
 *   console generation differs. `identityMatch` decides, not this script.
 * - Promote a screenshot into a banner.
 * - Reference an image it has not fetched and measured.
 * - Write a game that fails validation. The failure is reported and the run
 *   moves to the next game; a half-built product is never left behind.
 *
 * Usage:
 *   node scripts/game-create.mjs [--only=1,2] [--apply]
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

import {
  resolveProduct, galleryFrom, coverFrom, squareFrom, metadataFrom, fetchText, fetchBinary,
} from "./lib/nintendo-store.mjs";
import { keyArtCandidates, isKeyArt } from "./lib/keyart.mjs";
import { priceVariants, checkPricing } from "./lib/batch-pricing.mjs";
import { createR2 } from "./lib/r2-store.mjs";

const APPLY = process.argv.includes("--apply");
const only = (() => {
  const hit = process.argv.find((a) => a.startsWith("--only="));
  return hit ? new Set(hit.slice(7).split(",").map((s) => Number(s.trim()))) : null;
})();

process.env.D1_DATABASE_ID ||= process.env.CLOUDFLARE_D1_DATABASE_ID || "";
for (const k of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]) {
  if (!process.env[k]) throw new Error(`missing ${k}`);
}

const SECRETS = [process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID].filter((v) => v && v.length >= 8);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const say = (t = "") => console.log(redact(t));

const CONFIG = "wrangler.jsonc";
const DB_NAME = "bananto";
const BUCKET = "bananto-private";
const WORK_DIR = path.resolve(".game-create-tmp");
mkdirSync(WORK_DIR, { recursive: true });

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
  });
}
const parseJson = (raw) => {
  const i = String(raw ?? "").search(/[[{]/);
  if (i < 0) return null;
  try { return JSON.parse(String(raw).slice(i)); } catch { return null; }
};
const READ_ONLY = /^\s*select\b/i;
function d1Read(sql) {
  if (!READ_ONLY.test(sql)) throw new Error("d1Read refuses a non-SELECT");
  const parsed = parseJson(wrangler(["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", sql]));
  return (Array.isArray(parsed) ? parsed[0] : parsed)?.results ?? [];
}
const esc = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
function d1Write(sql) {
  if (!APPLY) throw new Error("d1Write without --apply");
  return wrangler(["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", sql]);
}

const r2 = createR2(BUCKET, { tmpDir: WORK_DIR, log: () => {} });

/* ---------------------------------------------------------------- imagery */

/**
 * Fetch, convert, hash and store one image; return the path to reference.
 *
 * Returns null on any failure, and null always means nothing was stored — so a
 * product can never end up pointing at an object that did not upload. The hash
 * is returned too, because it is what proves two roles are not the same picture.
 */
async function takeImage(sourceUrl, keyTemplate, seenHashes, role, notes) {
  const got = await fetchBinary(sourceUrl);
  if (!got.ok) { notes.push(`${role}: download failed (${got.error})`); return null; }
  let meta, out;
  try {
    meta = await sharp(got.buffer).metadata();
    out = await sharp(got.buffer).webp({ quality: 88 }).toBuffer();
  } catch (err) {
    notes.push(`${role}: not a decodable image (${String(err).slice(0, 50)})`);
    return null;
  }
  const hash = createHash("sha256").update(out).digest("hex").slice(0, 16);
  if (seenHashes.has(hash)) {
    notes.push(`${role}: identical to ${seenHashes.get(hash)} — not used twice`);
    return null;
  }
  const key = keyTemplate.replace("{hash}", hash);
  if (APPLY && !(await r2.put(key, out, "image/webp"))) {
    notes.push(`${role}: R2 store or read-back failed — not referenced`);
    return null;
  }
  seenHashes.set(hash, role);
  return { url: `/api/${key}`, width: meta.width, height: meta.height, hash };
}

/** Up to six wide key art images from the publisher's own page. */
async function keyArtFrom(officialUrl, prefix, seenHashes, notes) {
  if (!officialUrl) { notes.push("banners: Nintendo gave no official site for this game"); return []; }
  const page = await fetchText(officialUrl).catch(() => null);
  if (!page?.body) {
    notes.push(`banners: official site unreachable (${officialUrl}${page?.error ? ` — ${page.error}` : ""})`);
    return [];
  }

  const candidates = keyArtCandidates(page.body, officialUrl);
  const taken = [];
  for (const c of candidates) {
    if (taken.length >= 6) break;
    const got = await fetchBinary(c.url).catch(() => null);
    if (!got?.ok) continue;
    let meta;
    try { meta = await sharp(got.buffer).metadata(); } catch { continue; }
    const verdict = isKeyArt({ width: meta.width, height: meta.height, url: c.url, weight: c.weight });
    if (!verdict.ok) continue;
    const stored = await takeImage(c.url, `${prefix}/banner-{hash}.webp`, seenHashes, `banner ${taken.length + 1}`, notes);
    if (stored) taken.push({ ...stored, provenance: c.provenance });
  }
  if (taken.length < 6) {
    notes.push(`banners: ${taken.length} of 6 — ${candidates.length} images on the official site, and the rest were not wide key art`);
  }
  return taken;
}

/* -------------------------------------------------------------- the record */

const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * What must be true before a product is written, and what is merely absent.
 *
 * The two are not the same thing and collapsing them was wrong. A product with
 * no price, no cost, or `isHidden` unset is dangerous and must not be written.
 * A product whose square artwork Nintendo never published is complete as far as
 * the source goes — refusing to create it does not produce the missing image,
 * it just means the game is not in the shop.
 *
 * So blocking problems stop the write, and gaps are recorded on the product
 * under `_dataGaps` where the owner can see exactly what is missing and why,
 * rather than being silently absent or silently invented.
 */
function validate(doc, priced) {
  const blocking = [];
  const gaps = [];

  /* Identity, money and safety. Nothing here can be sourced later. */
  const required = {
    title: "English name", slug: "slug", platform: "platform",
    description: "description", publisher: "publisher", releaseDate: "release date",
    nsuid: "Nintendo nsuid", cartridgeImage: "front box cover", coverImage: "detail cover",
  };
  for (const [k, label] of Object.entries(required)) {
    if (String(doc[k] ?? "").trim() === "") blocking.push(`${label} (${k})`);
  }
  if (!Array.isArray(doc.galleryImages) || doc.galleryImages.length === 0) blocking.push("gallery (galleryImages)");
  if (doc.isHidden !== true) blocking.push("NOT HIDDEN — refusing to write a product that would be live");
  if (!Array.isArray(doc.options) || !doc.options.length) blocking.push("purchase options");
  if (!Array.isArray(doc.types) || !doc.types.length) blocking.push("edition variants");
  if (!(Number(doc.cost) > 0)) blocking.push("base cost");
  if (!(Number(doc.price) > 0)) blocking.push("base price");
  for (const t of doc.types ?? []) {
    if (!(Number(t.cost) > 0)) blocking.push(`variant "${t.name}": no cost`);
    if (!(Number(t.price) > 0)) blocking.push(`variant "${t.name}": no price`);
    if (!t.optionId) blocking.push(`variant "${t.name}": not bound to an account option`);
  }
  blocking.push(...checkPricing(priced));

  /* Present in some store records and not others. Recorded, never invented. */
  if (String(doc.developer ?? "").trim() === "") gaps.push("developer — the store record does not name one");
  if (String(doc.nintendoCardImage ?? "").trim() === "") gaps.push("square artwork — Nintendo publishes none for this title");
  if (!Array.isArray(doc.genres) || !doc.genres.length) gaps.push("genres — the store record lists none");
  if (!Array.isArray(doc.supportedLanguages) || !doc.supportedLanguages.length) gaps.push("languages — the store record lists none");
  if (String(doc.ageRating ?? "").trim() === "") gaps.push("age rating — the store record gives none");
  const banners = Array.isArray(doc.bannerImages) ? doc.bannerImages.length : 0;
  if (banners < 6) gaps.push(`key art — ${banners} of 6 wide banners found on official sources`);

  return { blocking, gaps };
}

async function buildOne(entry, existingSlugs) {
  const notes = [];
  const label = `${entry.title} [${entry.platform}]`;
  say(`\n${"=".repeat(72)}\n${entry.n}. ${label}`);

  const resolved = await resolveProduct({ title: entry.title, platform: entry.platform, slug: "", nsuid: "" });
  if (!resolved?.product) {
    say(`  NOT RESOLVED on Nintendo — ${resolved?.reason ?? "no exact title and console match"}`);
    return { ok: false, reason: "unresolved", notes };
  }
  const p = resolved.product;
  const meta = metadataFrom(p) ?? {};

  /* Already here. Checked on Nintendo's own id before anything is downloaded. */
  const nsuid = String(meta.nsuid ?? "").trim();
  if (nsuid && existingNsuids.has(nsuid)) {
    say(`  ALREADY IN THE CATALOGUE — nsuid ${nsuid} is present; nothing created`);
    return { ok: false, reason: "already exists", notes };
  }
  if (existingTitleKeys.has(titleKey(p.name ?? entry.title, entry.platform))) {
    say(`  ALREADY IN THE CATALOGUE — a product with this title and console is present; nothing created`);
    return { ok: false, reason: "already exists", notes };
  }

  const id = `prd_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const base = slugify(entry.title);
  let slug = base;
  if (existingSlugs.has(slug)) slug = `${base}-${entry.platform === "switch2" ? "switch-2" : "switch-1"}`;
  if (existingSlugs.has(slug)) { say(`  SLUG TAKEN: ${slug}`); return { ok: false, reason: "slug", notes }; }
  existingSlugs.add(slug);
  if (nsuid) existingNsuids.add(nsuid);
  existingTitleKeys.add(titleKey(p.name ?? entry.title, entry.platform));

  const seen = new Map();

  const prefix = `files/products/${id}`;
  const coverUrl = coverFrom(p);
  const squareUrl = squareFrom(p);
  const shots = galleryFrom(p) ?? [];

  const front = coverUrl ? await takeImage(coverUrl, `${prefix}/front-cover-{hash}.webp`, seen, "front cover", notes) : null;
  const square = squareUrl ? await takeImage(squareUrl, `${prefix}/square-{hash}.webp`, seen, "square", notes) : null;
  const gallery = [];
  for (const [i, s] of shots.entries()) {
    const g = await takeImage(s.url, `${prefix}/shot-{hash}.webp`, seen, `gallery ${i + 1}`, notes);
    if (g) gallery.push(g);
  }
  const banners = await keyArtFrom(meta.officialUrl, prefix, seen, notes);

  /*
    Roles, as `nintendoImages.ts` defines them — it owns this decision, and its
    rule is that no banner goes into a cover slot and no screenshot goes into
    either.

      front-box    -> cartridgeImage   the vertical retail packshot
      detail-cover -> coverImage       the detail page's primary cover
      banner       -> bannerImage      wide key art, never a cover

    `coverImage` is a cover, not key art: the first version put the game's
    banner there, which is exactly the substitution the resolver exists to
    prevent. Nintendo publishes one product image, and both cover roles mean a
    cover, so both point at that one stored object rather than storing it twice.
  */
  const banner = banners[0] ?? null;

  const priced = priceVariants(entry.variants, entry.demandTier);
  const offline = priced.filter((v) => v.account === "offline");
  const online = priced.filter((v) => v.account === "online");
  const optOffline = { id: `opt_${randomUUID().replace(/-/g, "").slice(0, 12)}`, name: "Offline Account", description: "حساب أوفلاين" };
  const optOnline = { id: `opt_${randomUUID().replace(/-/g, "").slice(0, 12)}`, name: "Online Account", description: "حساب أونلاين" };
  const options = [];
  if (offline.length) options.push({ ...optOffline, price: offline[0].price, cost: offline[0].cost, isInfiniteStock: true });
  if (online.length) options.push({ ...optOnline, price: online[0].price, cost: online[0].cost, isInfiniteStock: true });

  /*
    `description` is read by the buyer; `internalNote` is not.

    The pricing rationale was going into `description`, which the editions
    comparison prints beside the price — so "10,000 floor plus 2,000 for a
    standard title, on a 20,112 cost" would have shown a customer the supplier
    cost and the margin. The schema warns about this in as many words, having
    been burned by an extraction run that filled the same field with the
    supplier conversion rule.

    The customer gets a sentence about what they are buying. The reasoning goes
    where only staff can read it.
  */
  const types = priced.map((v) => ({
    id: `typ_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    name: v.name,
    optionId: v.account === "offline" ? optOffline.id : optOnline.id,
    price: v.price,
    cost: v.cost,
    isInfiniteStock: true,
    description:
      v.account === "offline"
        ? "حساب أوفلاين — يُستخدم للعب دون اتصال بعد الإعداد."
        : "حساب أونلاين — يدعم اللعب عبر الإنترنت.",
    internalNote: v.reason,
  }));

  const now = new Date().toISOString();
  const doc = {
    id, slug,
    title: p.name ?? entry.title,
    titleEn: p.name ?? entry.title,
    platform: entry.platform,
    categoryId: "cat_nintendo", category: "cat_nintendo",
    /* The cheapest offline line is what a listing card prints. */
    price: offline[0]?.price ?? priced[0].price,
    cost: offline[0]?.cost ?? priced[0].cost,
    options, types,
    isHidden: true, isActive: true, status: "نشط",
    isInfiniteStock: true, stock: 999999,
    cartridgeImage: front?.url ?? "",
    nintendoCardImage: square?.url ?? "",
    coverImage: front?.url ?? "",
    /*
      Both spellings, because two different surfaces read two different fields:
      the role resolver reads `bannerImage`, and the details view rotates
      through `bannerImages`. Writing only the plural — which is what the import
      schema targets — leaves the resolver's banner role empty.
    */
    bannerImage: banner?.url ?? "",
    bannerImages: banners.map((b) => b.url),
    galleryImages: gallery.map((g) => ({ url: g.url })),
    description: meta.description ?? "",
    tagline: meta.tagline ?? "",
    /* Nintendo's record names a developer for some titles and not others. A
       researched one is used only where the store has nothing to say. */
    developer: meta.developer || entry.developer || "",
    publisher: meta.publisher ?? "",
    releaseDate: meta.releaseDate ?? "",
    genres: meta.genres ?? [],
    ageRating: meta.ageRating ?? "",
    supportedLanguages: meta.supportedLanguages ?? [],
    arabicSupport: meta.arabicSupport ?? false,
    numberOfPlayers: meta.numberOfPlayers ?? "",
    downloadSizeGb: meta.downloadSizeGb ?? null,
    requiredSpaceGb: meta.requiredSpaceGb ?? null,
    nsuid: meta.nsuid ?? "",
    product_code: meta.product_code ?? "",
    title_id: meta.title_id ?? "",
    edition: meta.edition ?? "",
    officialUrl: meta.officialUrl ?? "",
    nintendoEshopUrl: meta.nintendoEshopUrl ?? "",
    nintendoPlayModes: meta.nintendoPlayModes ?? [],
    tvMode: meta.tvMode ?? null, tabletopMode: meta.tabletopMode ?? null, handheldMode: meta.handheldMode ?? null,
    nintendoCloudSaves: meta.nintendoCloudSaves ?? null,
    nintendoNotes: meta.nintendoNotes ?? "",
    createdAt: now, created_at: now, updatedAt: now, updated_at: now,
  };

  const { blocking, gaps } = validate(doc, priced);
  /* Recorded on the product, so a gap is visible to whoever opens it rather
     than looking like a field nobody filled in. */
  if (gaps.length) doc._dataGaps = gaps;

  say(`  resolved   : ${p.name} · nsuid ${meta.nsuid} · ${meta.publisher ?? "?"} / ${meta.developer ?? "?"}`);
  say(`  slug       : ${slug}`);
  say(`  released   : ${meta.releaseDate ?? "?"} · ${(meta.genres ?? []).join(", ")} · ${meta.ageRating ?? "?"} · ${(meta.supportedLanguages ?? []).length} languages`);
  say(`  images     : front ${front ? "yes" : "MISSING"} · square ${square ? "yes" : "MISSING"} · gallery ${gallery.length} · banners ${banners.length}/6`);
  say("  pricing    :");
  for (const v of priced) {
    say(`    ${v.account.padEnd(8)}${v.name.padEnd(22)}cost ${String(v.cost).padStart(7)} -> ${String(v.price).padStart(7)}  (+${v.margin})`);
  }
  for (const n of notes) say(`  note       : ${n}`);
  for (const g of gaps) say(`  gap        : ${g}`);
  if (blocking.length) {
    say(`  BLOCKED (${blocking.length}):`);
    for (const x of blocking) say(`    ✗ ${x}`);
    return { ok: false, reason: "validation", problems: blocking, notes };
  }
  say(`  validation : passed${gaps.length ? ` (with ${gaps.length} recorded gap${gaps.length > 1 ? "s" : ""})` : ""}`);

  if (!APPLY) { say("  (dry run — nothing written)"); return { ok: true, doc, dry: true, notes }; }

  d1Write(
    `INSERT INTO store_kv (key, value, updated_at) VALUES (${esc(`store:product:${id}`)}, ${esc(JSON.stringify(doc))}, ${esc(now)})` +
    ` ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  /* The Chinese name is admin-and-fulfilment only; it never touches the product. */
  d1Write(
    `INSERT INTO product_admin_metadata (product_id, supplier_name_zh_cn, supplier_name_zh_verification_status, updated_by, created_at, updated_at)` +
    ` VALUES (${esc(id)}, ${esc(entry.zh)}, 'verified', 'game-create', ${esc(now)}, ${esc(now)})` +
    ` ON CONFLICT(product_id) DO UPDATE SET supplier_name_zh_cn = excluded.supplier_name_zh_cn, updated_at = excluded.updated_at`,
  );

  /* Read back: a write that did not land must not be reported as one. */
  const back = d1Read(`SELECT value FROM store_kv WHERE key = ${esc(`store:product:${id}`)}`);
  const stored = back.length ? JSON.parse(String(back[0].value)) : null;
  if (!stored || stored.id !== id) { say("  WRITE DID NOT LAND"); return { ok: false, reason: "write", notes }; }
  if (stored.isHidden !== true) { say("  WROTE A VISIBLE PRODUCT — this is a bug"); return { ok: false, reason: "visible", notes }; }
  say(`  written    : ${id} — hidden, verified by read-back`);
  return { ok: true, id, doc, notes };
}

/* ------------------------------------------------------------------- main */

const batch = JSON.parse(readFileSync("data/supplier-batch-2026-09.json", "utf8"));
const games = batch.games.filter((g) => !only || only.has(g.n));

say(`${games.length} entries to build. ${APPLY ? "APPLYING." : "Dry run — nothing will be written."}`);

/*
  What is already in the catalogue, so a second run adds nothing.

  Without this, running with --apply twice creates every game twice: the id is
  freshly generated each time, and the slug check would see the first run's
  slug taken and quietly build "katana-zero-switch-1" beside "katana-zero".
  Two products for one game, both hidden, both priced, and no way to tell which
  the shop should sell.

  `nsuid` is Nintendo's own identifier for the exact product and console, which
  makes it the right key; title and platform together are the fallback for rows
  that predate it.
*/
const existingSlugs = new Set();
const existingNsuids = new Set();
const existingTitleKeys = new Set();
const titleKey = (title, platform) =>
  `${String(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")}::${String(platform ?? "").toLowerCase()}`;

function indexProduct(d) {
  if (!d) return;
  if (d.slug) existingSlugs.add(String(d.slug));
  if (d.nsuid) existingNsuids.add(String(d.nsuid).trim());
  const t = d.titleEn || d.title;
  if (t) existingTitleKeys.add(titleKey(t, d.platform));
}
for (const row of d1Read("SELECT value FROM store_kv WHERE key LIKE 'store:product:%'")) {
  try { indexProduct(JSON.parse(String(row.value))); } catch { /* not ours to fix */ }
}
for (const row of d1Read("SELECT value FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%'")) {
  try { for (const d of JSON.parse(String(row.value))) indexProduct(d); } catch { /* ditto */ }
}
say(`catalogue already holds ${existingSlugs.size} slugs and ${existingNsuids.size} nsuids.`);

const done = [], failed = [];
for (const entry of games) {
  /*
    Two reasons not to build a game, and they are different things.

    `_ambiguous` means the title could name more than one real product, so
    creating one would be a coin toss between two games. `_unavailable` means
    the research established there is no such product on the US eShop at all —
    a supplier line with nothing on Nintendo to attach it to.

    Both are recorded with their reason rather than dropped quietly, because a
    supplier line that cannot be sold is something the owner needs to see.
  */
  if (entry._ambiguous || entry._unavailable) {
    const why = entry._ambiguous ? "needs_identity_review" : "not on the US eShop";
    say(`\n${"=".repeat(72)}\n${entry.n}. ${entry.title} [${entry.platform}]`);
    say(`  SKIPPED — ${why}: ${entry._ambiguous ?? entry._unavailable}`);
    failed.push({ n: entry.n, title: entry.title, reason: why });
    continue;
  }
  try {
    const res = await buildOne(entry, existingSlugs);
    (res.ok ? done : failed).push({ n: entry.n, title: entry.title, platform: entry.platform, ...res });
  } catch (err) {
    say(`  ERROR: ${redact(err?.message ?? err).slice(0, 300)}`);
    failed.push({ n: entry.n, title: entry.title, reason: "error" });
  }
}

say(`\n${"=".repeat(72)}`);
say(`built: ${done.length}   not built: ${failed.length}`);
for (const f of failed) say(`  ✗ ${f.n}. ${f.title} — ${f.reason}${f.problems ? `: ${f.problems.length} problems` : ""}`);
if (!APPLY) say("\nDry run. Nothing was written. Re-run with --apply.");
