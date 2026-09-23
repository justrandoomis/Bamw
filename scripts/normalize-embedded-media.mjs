#!/usr/bin/env node
/**
 * Moves base64 `data:` URIs out of product documents and into R2.
 *
 * DRY RUN BY DEFAULT — `--apply` is required to write.
 *
 * street-fighter-6-switch-2 is 5.67 MB, of which 5.92 MB — 99.6% — is a single
 * `coverHiResImage` holding an embedded image instead of a URL. That one field
 * is three quarters of the entire catalogue, and every read of the catalogue
 * pays for it.
 *
 * Nothing is discarded. The image is decoded, converted to WebP, stored in R2
 * under the product's own prefix and the field is repointed at it, so the
 * product keeps exactly the media it had. The original bytes are written to the
 * run's artifact directory first, so the pre-change value survives the run
 * regardless of what happens afterwards.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SERVING_BUCKET } from "./lib/r2-buckets.mjs";

const DB_NAME = "bananto";
const CONFIG = "wrangler.jsonc";
const BUCKET = SERVING_BUCKET;
const BACKUP_DIR = "media-backup";

const APPLY = process.argv.includes("--apply");
const ONLY = (process.argv.find((a) => a.startsWith("--products=")) ?? "").split("=")[1];

/* ------------------------------------------------------------------ safety */

const MUTATING =
  /(^|[^_\w])(insert|update|delete|replace|upsert|alter|drop|create|attach|detach|vacuum|reindex|truncate)([^_\w]|$)/i;
function assertRead(sql) {
  const s = String(sql).trim();
  if (!/^\s*select\b/i.test(s)) throw new Error(`REFUSED (not a SELECT): ${s.slice(0, 60)}`);
  if (MUTATING.test(s)) throw new Error(`REFUSED (mutating keyword): ${s.slice(0, 60)}`);
  if (s.replace(/;\s*$/, "").includes(";")) throw new Error("REFUSED (multiple statements)");
  return s;
}

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

const WRANGLER =
  process.env.WRANGLER_BIN ||
  (existsSync("node_modules/.bin/wrangler") ? "node_modules/.bin/wrangler" : "wrangler");
const ENV = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };

function wrangler(args, { allowFail = false, timeoutMs = 180_000 } = {}) {
  try {
    return execFileSync(WRANGLER, args, {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      env: ENV,
    });
  } catch (err) {
    if (allowFail) return null;
    throw new Error(redact(err?.stderr || err?.message || String(err)).slice(0, 800));
  }
}
const parseJson = (raw) => {
  if (raw == null) return null;
  const i = raw.search(/[[{]/);
  if (i < 0) return null;
  try {
    return JSON.parse(raw.slice(i));
  } catch {
    return null;
  }
};
function d1(sql) {
  const parsed = parseJson(
    wrangler([
      "d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG,
      "--command", assertRead(sql),
    ]),
  );
  return (Array.isArray(parsed) ? parsed[0] : parsed)?.results ?? [];
}

/** The single write: one product's overlay row, addressed by immutable id. */
function writeOverlay(id, doc) {
  if (!APPLY) throw new Error("writeOverlay without --apply");
  const value = JSON.stringify(doc);
  const esc = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const sql =
    `INSERT INTO store_kv (key, value, updated_at) VALUES (` +
    `${esc(`store:product:${id}`)}, ${esc(value)}, ${esc(new Date().toISOString())})` +
    ` ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;
  return wrangler(
    ["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", sql],
    { allowFail: true },
  ) !== null;
}

/* -------------------------------------------------------------------- main */

say(`# Embedded media normalization — ${APPLY ? "**APPLY**" : "DRY RUN (nothing written)"}`);
say();
say(`Run at ${new Date().toISOString()}.`);
say();

const chunkKeys = d1(
  "SELECT key FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%' ORDER BY key",
).map((r) => String(r.key));
const numbered = chunkKeys
  .filter((k) => /^store:products#\d+$/.test(k))
  .sort((a, b) => Number(a.split("#")[1]) - Number(b.split("#")[1]));
let raw = "";
for (const key of numbered.length ? numbered : ["store:products"]) {
  process.stderr.write(`[chunk] ${key}\n`);
  raw += d1(`SELECT value FROM store_kv WHERE key = '${key.replace(/'/g, "''")}'`)?.[0]?.value ?? "";
}
const live = new Map();
for (const p of JSON.parse(raw || "[]")) if (p?.id) live.set(String(p.id), p);
for (const row of d1("SELECT key, value FROM store_kv WHERE key LIKE 'store:product:%'")) {
  let doc = null;
  try {
    doc = JSON.parse(row.value);
  } catch {
    continue;
  }
  if (!doc?.id) continue;
  if (doc._deleted === true) live.delete(String(doc.id));
  else live.set(String(doc.id), doc);
}
say(`- Live products: **${live.size}**`);

const DATA_URI = /^data:([a-z0-9.+/-]+);base64,/i;
const targets = ONLY ? ONLY.split(",").map((s) => s.trim()) : [...live.keys()];

const found = [];
for (const id of targets) {
  const doc = live.get(id);
  if (!doc) continue;
  for (const [field, value] of Object.entries(doc)) {
    if (typeof value !== "string") continue;
    const m = value.match(DATA_URI);
    if (!m) continue;
    found.push({ id, slug: String(doc.slug ?? ""), field, mime: m[1], bytes: value.length });
  }
}

say(`- Fields holding an embedded \`data:\` URI: **${found.length}**`);
say();
if (!found.length) {
  say("Nothing to normalize.");
} else {
  say("| product | field | mime | embedded bytes |");
  say("| --- | --- | --- | ---: |");
  for (const f of found) {
    say(`| \`${f.id}\` ${f.slug.slice(0, 30)} | \`${f.field}\` | ${f.mime} | ${f.bytes.toLocaleString()} |`);
  }
  say();
}

if (!APPLY) {
  say("**Dry run — nothing written.** Re-run with `--apply`.");
} else if (found.length) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const sharp = (await import("sharp")).default;
  let ok = 0;
  let failed = 0;

  for (const f of found) {
    const doc = { ...live.get(f.id) };
    const original = String(doc[f.field]);
    const base64 = original.slice(original.indexOf(",") + 1);
    const input = Buffer.from(base64, "base64");
    say(`### \`${f.id}\` ${f.slug} — \`${f.field}\``);
    say(`- decoded ${input.length.toLocaleString()} bytes from ${f.mime}`);

    // The pre-change value leaves the database before the database changes.
    const backup = path.join(BACKUP_DIR, `${f.id}.${f.field}.original`);
    writeFileSync(backup, original);
    say(`- original value backed up to \`${backup}\``);

    let out;
    let ext;
    let contentType;
    try {
      out = await sharp(input).webp({ quality: 90 }).toBuffer();
      ext = "webp";
      contentType = "image/webp";
      say(`- converted to WebP: ${out.length.toLocaleString()} bytes (${Math.round((1 - out.length / input.length) * 100)}% smaller)`);
    } catch (err) {
      out = input;
      ext = (f.mime.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "");
      contentType = f.mime;
      say(`- **WebP conversion failed (${String(err).slice(0, 80)}) — storing the original bytes unchanged**`);
    }

    const hash = createHash("sha256").update(out).digest("hex").slice(0, 16);
    const key = `files/products/${f.id}/3d-texture-${hash}.${ext}`;
    const tmp = path.join(BACKUP_DIR, `${hash}.${ext}`);
    writeFileSync(tmp, out);

    const put = wrangler(
      ["r2", "object", "put", `${BUCKET}/${key}`, "--file", tmp, "--remote", "--content-type", contentType],
      { allowFail: true },
    );
    if (put === null) {
      failed++;
      say(`- **R2 upload FAILED — document left untouched**`);
      say();
      continue;
    }
    const verify = wrangler(["r2", "object", "get", `${BUCKET}/${key}`, "--remote", "--pipe"], {
      allowFail: true,
      timeoutMs: 30_000,
    });
    if (!verify || !verify.length) {
      failed++;
      say(`- **R2 object not readable after upload — document left untouched**`);
      say();
      continue;
    }
    say(`- stored and verified in R2: \`${key}\``);

    doc[f.field] = `/api/${key}`;
    const before = JSON.stringify(live.get(f.id)).length;
    const after = JSON.stringify(doc).length;
    if (!writeOverlay(f.id, doc)) {
      failed++;
      say(`- **D1 write FAILED — R2 object kept, document unchanged**`);
      say();
      continue;
    }
    const back = d1(`SELECT value FROM store_kv WHERE key = 'store:product:${f.id.replace(/'/g, "''")}'`);
    const stored = back?.[0]?.value ? JSON.parse(back[0].value) : null;
    if (stored?.[f.field] === `/api/${key}` && !DATA_URI.test(String(stored[f.field]))) {
      ok++;
      say(`- verified: document ${before.toLocaleString()} → ${after.toLocaleString()} bytes`);
    } else {
      failed++;
      say(`- **read-after-write verification FAILED**`);
    }
    say();
  }
  say(`- Normalized and verified: **${ok}** · failed: **${failed}**`);
}

writeFileSync("normalize-embedded-media.md", lines.join("\n") + "\n");
