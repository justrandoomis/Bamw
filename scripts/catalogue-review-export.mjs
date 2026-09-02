#!/usr/bin/env node
/**
 * Exports the next batch of production games for the field-by-field review.
 *
 * READ ONLY against production. It writes only into `review-workdir/` in the
 * repository checkout: the batch export (full game records + a content hash +
 * an image-role probe report), small thumbnails of every image so a reviewer
 * can inspect them visually, and a reviewed-file skeleton with `apply: false`.
 *
 * No customer data is ever read or written: the queries touch only
 * `store:products*` / `store:product:*` keys — the catalogue documents.
 *
 * Usage:
 *   node scripts/catalogue-review-export.mjs [--limit=5] [--only=id1,id2]
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const WORK_DIR = "review-workdir";
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || "https://banan.to";

const flag = (name, fallback) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=")[1];
const LIMIT = Math.max(1, Math.min(5, Number(flag("limit", "5"))));
const ONLY = flag("only", "").split(",").map((s) => s.trim()).filter(Boolean);

for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) throw new Error(`missing ${key}`);
}

/* ------------------------------------------------ the application's own code */
const outfile = path.resolve(".catalogue-review-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/import-entry.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  logLevel: "silent",
  alias: { "@": path.resolve("src") },
  external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
});
const app = await import(outfile);

/* ---------------------------------------------------------- live catalogue */
const rows = await app.d1All(
  "SELECT key, value FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%' OR key LIKE 'store:product:%'",
);
if (!rows.length) throw new Error("D1 unreachable or empty — refusing to export nothing");
let aggregate = "";
const overlays = [];
for (const row of rows) {
  if (String(row.key).startsWith("store:product:")) overlays.push(row);
  else aggregate += String(row.value ?? "");
}
const live = new Map();
for (const p of JSON.parse(aggregate || "[]")) if (p?.id) live.set(String(p.id), p);
for (const row of overlays) {
  try {
    const doc = JSON.parse(String(row.value));
    if (doc?.id) live.set(String(doc.id), doc);
  } catch {
    /* an unparseable overlay is reported by the recovery tooling, not here */
  }
}

const games = [...live.values()]
  .filter((p) => !p["_deleted"] && !p["isDeleted"])
  .filter((p) => app.getProductCategory(p) === "game")
  .sort((a, b) => String(a.slug || a.id).localeCompare(String(b.slug || b.id)));

/* ------------------------------------------------------------------- state */
mkdirSync(WORK_DIR, { recursive: true });
const statePath = path.join(WORK_DIR, "review-state.json");
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : { batches: 0, reviewed: {} };

const pending = ONLY.length
  ? games.filter((g) => ONLY.includes(String(g.id)) || ONLY.includes(String(g.slug)))
  : games.filter((g) => !state.reviewed[String(g.id)]);
const batchGames = pending.slice(0, LIMIT);
const batchNo = String(state.batches + 1).padStart(3, "0");

console.log(`production games: ${games.length} · reviewed: ${Object.keys(state.reviewed).length} · this batch: ${batchGames.length}`);
if (!batchGames.length) {
  writeFileSync(path.join(WORK_DIR, "ALL-REVIEWED.txt"), `All ${games.length} production games reviewed.\n`);
  console.log("ALL GAMES REVIEWED — nothing to export.");
  process.exit(0);
}

/* --------------------------------------------------------------- utilities */
export function canonicalHash(doc) {
  const stable = (v) => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
    return v;
  };
  return createHash("sha256").update(JSON.stringify(stable(doc))).digest("hex");
}

const publicUrl = (raw) => {
  const url = String(raw || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return PUBLIC_ORIGIN + url;
  return url;
};

/** The image roles a game page actually draws, field by field. */
function imageRoles(p) {
  const roles = [];
  const push = (role, field, value) => {
    const url = publicUrl(value);
    if (url) roles.push({ role, field, url });
  };
  push("front-box", "cartridgeImage", p.cartridgeImage);
  push("front-box", "box_front_url", p.box_front_url);
  push("square-card", "nintendoCardImage", p.nintendoCardImage);
  push("detail-cover", "coverImage", p.coverImage);
  push("3d-texture", "coverHiResImage", p.coverHiResImage);
  push("listing", "mainImage", p.mainImage);
  push("listing", "image", p.image);
  (Array.isArray(p.bannerImages) ? p.bannerImages : []).slice(0, 4).forEach((b, i) =>
    push("banner", `bannerImages[${i}]`, typeof b === "string" ? b : b?.url),
  );
  (Array.isArray(p.galleryImages) ? p.galleryImages : []).slice(0, 6).forEach((g, i) =>
    push("gallery", `galleryImages[${i}]`, typeof g === "string" ? g : g?.url),
  );
  // one entry per distinct field, first occurrence wins per (role,url)
  const seen = new Set();
  return roles.filter((r) => {
    const key = `${r.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function probeImage(url, thumbPath) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    const type = res.headers.get("content-type") || "";
    if (!res.ok) return { status: res.status, contentType: type };
    const buf = Buffer.from(await res.arrayBuffer());
    let width = null, height = null, thumb = null;
    try {
      const img = sharp(buf, { limitInputPixels: 100_000_000 });
      const meta = await img.metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      await img.resize({ width: 240, height: 240, fit: "inside" }).png({ quality: 80 }).toFile(thumbPath);
      thumb = thumbPath;
    } catch {
      /* not decodable — reported via width/height null */
    }
    return { status: res.status, contentType: type, bytes: buf.length, width, height, thumb };
  } catch (err) {
    return { status: 0, error: String(err?.message || err).slice(0, 120) };
  }
}

/* ----------------------------------------------------------------- export */
const thumbsDir = path.join(WORK_DIR, "thumbs", `batch-${batchNo}`);
mkdirSync(thumbsDir, { recursive: true });

const exportGames = [];
for (const game of batchGames) {
  const id = String(game.id);
  const roles = imageRoles(game);
  const images = [];
  for (const [i, entry] of roles.entries()) {
    const thumbFile = path.join(
      thumbsDir,
      `${String(game.slug || id).replace(/[^a-z0-9-]/gi, "_")}__${entry.role}-${i}.png`,
    );
    const probe = await probeImage(entry.url, thumbFile);
    images.push({ ...entry, ...probe });
    console.log(
      `  img ${id} ${entry.role} <- ${entry.field}: ${probe.status}${probe.width ? ` ${probe.width}x${probe.height}` : ""}${probe.error ? ` ${probe.error}` : ""}`,
    );
  }
  exportGames.push({ id, slug: game.slug, title: game.titleEn || game.title, platform: game.platform, isHidden: game.isHidden === true, hash: canonicalHash(game), images, record: game });
  console.log(`exported ${id} (${game.slug}) hash=${canonicalHash(game).slice(0, 12)}`);
}

writeFileSync(
  path.join(WORK_DIR, `export-batch-${batchNo}.json`),
  JSON.stringify({ batch: batchNo, generatedAt: new Date().toISOString(), totalGames: games.length, reviewedSoFar: Object.keys(state.reviewed).length, games: exportGames }, null, 1),
);
writeFileSync(
  path.join(WORK_DIR, `reviewed-catalogue-batch-${batchNo}.json`),
  JSON.stringify(
    {
      batch: batchNo,
      apply: false,
      games: exportGames.map((g) => ({ id: g.id, slug: g.slug, baseHash: g.hash, set: {}, clear: [], imageNotes: "", notes: "" })),
    },
    null,
    1,
  ),
);
state.batches += 1;
state.pending = batchNo;
writeFileSync(statePath, JSON.stringify(state, null, 1));
console.log(`batch ${batchNo} exported: ${exportGames.map((g) => g.slug).join(", ")}`);
