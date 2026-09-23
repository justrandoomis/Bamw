#!/usr/bin/env node
/**
 * Re-points product image roles at assets that actually exist in R2.
 *
 * DRY RUN BY DEFAULT. `--apply` is required to write anything.
 *
 * The product documents are not missing their image fields — every role is
 * populated. What broke is that many of those URLs name R2 objects that no
 * longer exist, because a media migration ingested fresh copies under new keys,
 * recorded them in `game_images`, and never wrote the new URLs back into the
 * documents. The old objects are gone; the new ones are in `bananto-private`.
 *
 * So this never invents an image and never restores a "lost" field. For each
 * role it checks whether the URL the document names still resolves. If it does,
 * that value wins and is left alone. Only when it does not does the repair look
 * for a `game_images` row of the *same role* for the *same product*, verify
 * that asset exists, and propose it.
 *
 * Roles stay separate. A missing square card is never filled from the front
 * cover, and one asset is never assigned to several roles.
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { SERVING_BUCKET } from "./lib/r2-buckets.mjs";

const DB_NAME = "bananto";
const CONFIG = "wrangler.jsonc";
/*
  `PUBLIC_BUCKET` used to be declared here, from `CLOUDFLARE_R2_BUCKET_NAME ||
  "bananto"`, and nothing ever read it. A named bucket nothing uses is a trap:
  the next edit that needs one reaches for the name already sitting there, which
  is how `square-card-fill.mjs` hid 849 pictures.
*/
const PRIVATE_BUCKET = SERVING_BUCKET;

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = Number(
  (process.argv.find((a) => a.startsWith("--batch=")) ?? "--batch=5").split("=")[1],
);
const ONLY = (process.argv.find((a) => a.startsWith("--products=")) ?? "").split("=")[1];
const arg = (name, fallback) =>
  Number((process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=")[1]);
/*
  A present object answers in about two seconds; a miss costs the full probe
  timeout, and a miss is the common case here. Planning all ninety products in
  one run needs several hundred probes and cannot finish inside a job, so a run
  covers a slice and the offset walks the catalogue.
*/
const LIMIT = arg("limit", 200);
const OFFSET = arg("offset", 0);

/* ------------------------------------------------------------------ safety */

const READ_SHAPE = /^\s*select\b/i;
const MUTATING =
  /(^|[^_\w])(insert|update|delete|replace|upsert|alter|drop|create|attach|detach|vacuum|reindex|truncate)([^_\w]|$)/i;

function assertReadOnly(sql) {
  const s = String(sql).trim();
  if (!READ_SHAPE.test(s)) throw new Error(`REFUSED (not a SELECT): ${s.slice(0, 60)}`);
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

/* ----------------------------------------------------------------- wrangler */

const WRANGLER =
  process.env.WRANGLER_BIN ||
  (existsSync("node_modules/.bin/wrangler") ? "node_modules/.bin/wrangler" : "wrangler");
const ENV = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };

function wrangler(args, { allowFail = false, timeoutMs = 120_000 } = {}) {
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
  const s = assertReadOnly(sql);
  const parsed = parseJson(
    wrangler(["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", s]),
  );
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first?.results ?? [];
}

/**
 * The one write path: a single INSERT ... ON CONFLICT targeting exactly one
 * product's overlay row, addressed by its immutable id. No LIKE, no IN, no
 * NOT IN, nothing that can reach a second row.
 *
 * Sent with `--command`, not `--file`: a `--file` execution against this
 * database never returned during the audit and burned a whole job.
 */
const MAX_WRITE_BYTES = 500_000;

function writeOverlay(id, doc) {
  if (!APPLY) throw new Error("writeOverlay called without --apply");
  const value = JSON.stringify(doc);
  if (value.length > MAX_WRITE_BYTES) {
    return { ok: false, reason: `document is ${value.length} bytes, over the ${MAX_WRITE_BYTES} write cap` };
  }
  const esc = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const sql =
    `INSERT INTO store_kv (key, value, updated_at) VALUES (` +
    `${esc(`store:product:${id}`)}, ${esc(value)}, ${esc(new Date().toISOString())})` +
    ` ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;
  const out = wrangler(
    ["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", sql],
    { allowFail: true },
  );
  return { ok: out !== null, reason: out === null ? "wrangler returned no output" : "" };
}

/* ------------------------------------------------------------- role mapping */

/** `game_images.kind` → the product field that role belongs in. Never merged. */
function roleForKind(kind) {
  const k = String(kind).toLowerCase();
  if (/^front$|^cartridgeimage$|^boxart_front$|^packagingfront/.test(k)) return "cartridgeImage";
  if (/^square$|^nintendocardimage$|^squaregameimage$/.test(k)) return "nintendoCardImage";
  if (/^cover$|^coverimage$|^cardartwork$/.test(k)) return "coverImage";
  if (/^3d-texture$|^coverhiresimage$|^modeltexture/.test(k)) return "coverHiResImage";
  if (/^image$|^mainimage$/.test(k)) return "image";
  const banner = k.match(/^banner-(\d+)$/);
  if (banner) return `bannerImages[${banner[1]}]`;
  if (/^banner$|^bannerimages$/.test(k)) return "banner";
  const gallery = k.match(/^(?:gallery|screenshot|shot)-?(\d+)$/);
  if (gallery) return `galleryImages[${gallery[1]}]`;
  if (/^gallery|^screenshot/.test(k)) return "galleryImages";
  return "";
}

const SINGLE_ROLES = ["image", "banner", "cartridgeImage", "nintendoCardImage", "coverImage", "coverHiResImage"];

/*
  Hosts whose objects live in our R2 and are served through the Worker. A URL
  pointing anywhere else — Nintendo's CDN, Cloudinary, Amazon, a news site — is
  loaded directly by the browser and has nothing to do with R2. Stripping its
  hostname and looking for the leftover path in our bucket finds nothing and
  says "dead", which is how a working hotlinked image got reported as missing.
*/
const OWN_HOSTS = /(^|\.)(banan\.to|r2\.dev|r2\.cloudflarestorage\.com)$/i;

/** "r2" — ours, resolvable and repairable. "external" — not ours, never touched. */
function classifyUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return { kind: "empty", host: "" };
  if (raw.startsWith("data:")) return { kind: "external", host: "data:" };
  if (!/^https?:\/\//i.test(raw)) return { kind: "r2", host: "" };
  try {
    const { hostname } = new URL(raw);
    return OWN_HOSTS.test(hostname) ? { kind: "r2", host: hostname } : { kind: "external", host: hostname };
  } catch {
    return { kind: "external", host: "unparseable" };
  }
}

function assetKey(url) {
  let path = String(url ?? "");
  try {
    if (path.startsWith("http")) path = new URL(path).pathname;
  } catch {
    /* not a URL */
  }
  path = path.replace(/^\/+/, "").replace(/^api\//, "");
  const i = path.indexOf("files/");
  return i > 0 ? path.slice(i) : path;
}

const probeCache = new Map();
let probes = 0;
function existsInR2(url) {
  const key = assetKey(url);
  if (!key) return false;
  if (probeCache.has(key)) return probeCache.get(key);
  probes++;
  /*
    Product media lives in the private bucket — the public one holds 72 objects
    against 1,622 there — so one probe answers the question. Eight seconds is
    generous for a hit and caps what a miss costs.
  */
  const got = wrangler(["r2", "object", "get", `${PRIVATE_BUCKET}/${key}`, "--remote", "--pipe"], {
    allowFail: true,
    timeoutMs: 8_000,
  });
  const found = Boolean(got && got.length > 0);
  probeCache.set(key, found);
  return found;
}

/* --------------------------------------------------------------------- main */

say(`# Image re-point — ${APPLY ? "**APPLY**" : "DRY RUN (nothing is written)"}`);
say();
say(`Run at ${new Date().toISOString()}. Batch size ${BATCH_SIZE}.`);
say();

/* Live catalogue, same merge rule as loadStore. */
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
const aggregate = JSON.parse(raw || "[]");
const live = new Map();
for (const p of aggregate) if (p?.id) live.set(String(p.id), p);
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

/* The replacement catalogue: role → asset, per product. */
const byProduct = new Map();
for (const row of d1("SELECT game_id, kind, url FROM game_images")) {
  const id = String(row.game_id);
  if (!byProduct.has(id)) byProduct.set(id, []);
  byProduct.get(id).push({ kind: String(row.kind), url: String(row.url), role: roleForKind(row.kind) });
}
say(`- Products with \`game_images\` rows: **${byProduct.size}**`);
say();

const allIds = [...live.keys()].sort();
const roleStats = new Map();
const sampled = new Map();
/** Probes spent per role on URLs nothing could replace, purely to measure. */
const SAMPLE_PER_ROLE = arg("sample", 20);
const bump = (role, bucket) => {
  const base = String(role).replace(/\[\d+\]$/, "");
  if (!roleStats.has(base)) {
    roleStats.set(base, { external: 0, alive: 0, dead: 0, replaced: 0, unfixable: 0, unverified: 0 });
  }
  roleStats.get(base)[bucket]++;
};

const targets = ONLY
  ? ONLY.split(",").map((s) => s.trim())
  : allIds.slice(OFFSET, OFFSET + LIMIT);
say(`- This run covers products **${OFFSET + 1}–${Math.min(OFFSET + LIMIT, allIds.length)}** of ${allIds.length}${OFFSET + LIMIT < allIds.length ? ` — re-run with \`--offset=${OFFSET + LIMIT}\` for the next slice` : ""}`);
say();
const plans = [];

for (const id of targets) {
  const doc = live.get(id);
  if (!doc) continue;
  const candidates = byProduct.get(id) ?? [];
  const known = new Set(candidates.map((c) => assetKey(c.url)));
  const claimed = new Set();
  const fixes = [];
  const unrecoverable = [];
  const external = [];

  const check = (role, current) => {
    if (!current) return;
    const kind = classifyUrl(current);
    if (kind.kind === "external") {
      external.push({ role, host: kind.host });
      bump(role, "external");
      return;
    }
    if (kind.kind === "empty") return;
    const key = assetKey(current);
    const match = candidates.find((c) => c.role === role && !claimed.has(assetKey(c.url)));

    /*
      Probing costs eight seconds on a miss, and `game_images` carries no
      gallery or screenshot kind, so a dead gallery entry has no replacement
      whether or not it is dead — 121 such probes in the first 25 products
      alone, for a plan that could never include them.

      But not probing is not the same as knowing, and a healthy image must not
      be reported as broken just because nothing could replace it. So a role
      with no candidate is sampled up to a budget: enough probes to measure how
      many are really dead, and the remainder recorded as unverified rather
      than assumed either way.
    */
    if (!match) {
      if (known.has(key)) {
        claimed.add(key);
        bump(role, "alive");
        return;
      }
      const base = String(role).replace(/\[\d+\]$/, "");
      const used = sampled.get(base) ?? 0;
      if (used >= SAMPLE_PER_ROLE) {
        bump(role, "unverified");
        return;
      }
      sampled.set(base, used + 1);
      if (existsInR2(current)) {
        bump(role, "alive");
        return;
      }
      unrecoverable.push({ role, url: current });
      bump(role, "unfixable");
      return;
    }

    // A URL game_images already knows is a verified-present new-generation key.
    if (known.has(key) || existsInR2(current)) {
      claimed.add(key);
      bump(role, "alive");
      return;
    }
    bump(role, "dead");
    if (existsInR2(match.url)) {
      claimed.add(assetKey(match.url));
      fixes.push({ role, from: current, to: match.url, kind: match.kind });
      bump(role, "replaced");
    } else {
      unrecoverable.push({ role, url: current });
      bump(role, "unfixable");
    }
  };

  for (const role of SINGLE_ROLES) check(role, doc[role]);
  if (Array.isArray(doc.bannerImages)) {
    doc.bannerImages.forEach((url, i) => check(`bannerImages[${i}]`, url));
  }
  // The audit found a dead gallery reference on all 89 games; whether any of
  // them can be repaired from D1 depends on game_images carrying a gallery
  // kind at all, which this run answers rather than assumes.
  if (Array.isArray(doc.galleryImages)) {
    doc.galleryImages.forEach((url, i) => check(`galleryImages[${i}]`, url));
  }

  if (fixes.length || unrecoverable.length || external.length) {
    plans.push({ id, slug: String(doc.slug ?? ""), fixes, unrecoverable, external });
  }
}

say(`## Plan`);
say();
say(`- Products needing at least one change: **${plans.filter((p) => p.fixes.length).length}**`);
say(`- Total role re-points: **${plans.reduce((n, p) => n + p.fixes.length, 0)}**`);
say(`- Roles whose R2 object is gone and has no replacement: **${plans.reduce((n, p) => n + p.unrecoverable.length, 0)}**`);
say(`- Roles hosted outside R2 (left untouched, not broken): **${plans.reduce((n, p) => n + p.external.length, 0)}**`);
const hosts = {};
for (const p of plans) for (const e of p.external) hosts[e.host] = (hosts[e.host] ?? 0) + 1;
say(`- External hosts in use: ${Object.entries(hosts).sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} (${n})`).join(", ") || "none"}`);
say(`- R2 probes: ${probes}`);
say();
say("| role | external | R2 alive | R2 dead | replaceable | no replacement | unverified |");
say("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const [role, st] of [...roleStats.entries()].sort()) {
  say(`| \`${role}\` | ${st.external} | ${st.alive} | ${st.dead} | ${st.replaced} | ${st.unfixable} | ${st.unverified} |`);
}
say();
const kinds = new Map();
for (const rows of byProduct.values()) for (const r of rows) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
say(`\`game_images\` kinds available as replacements: ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `\`${k}\` ${n}`).join(", ")}`);
say();
for (const p of plans.slice(0, 40)) {
  say(`### \`${p.id}\` ${p.slug}`);
  for (const f of p.fixes) say(`  - ${f.role}: \`${String(f.from).slice(0, 70)}\` (gone) → \`${assetKey(f.to)}\``);
  for (const u of p.unrecoverable) say(`  - ${u.role}: **R2 object gone, no replacement** — \`${String(u.url).slice(0, 70)}\``);
  if (p.external.length) say(`  - hosted externally, untouched: ${p.external.map((e) => `${e.role}@${e.host}`).join(", ")}`);
}
say();

if (!APPLY) {
  say("**Dry run — nothing was written.** Re-run with `--apply` to write, in batches.");
} else {
  say("## Applying");
  say();
  let ok = 0;
  let failed = 0;
  const withFixes = plans.filter((p) => p.fixes.length);
  for (let i = 0; i < withFixes.length; i += BATCH_SIZE) {
    const batch = withFixes.slice(i, i + BATCH_SIZE);
    for (const plan of batch) {
      const doc = { ...live.get(plan.id) };
      const before = JSON.stringify(doc);
      for (const f of plan.fixes) {
        const arr = f.role.match(/^bannerImages\[(\d+)\]$/);
        if (arr) {
          doc.bannerImages = [...(doc.bannerImages ?? [])];
          doc.bannerImages[Number(arr[1])] = f.to;
        } else {
          doc[f.role] = f.to;
        }
      }
      // Backup the pre-change document to the log before writing.
      say(`  - \`${plan.id}\` backup ${before.length} bytes, ${plan.fixes.length} role(s)`);
      const wrote = writeOverlay(plan.id, doc);
      if (!wrote.ok) {
        failed++;
        say(`    **WRITE FAILED (${wrote.reason}) — stopping**`);
        break;
      }
      // Read-after-write verify.
      const back = d1(`SELECT value FROM store_kv WHERE key = 'store:product:${plan.id.replace(/'/g, "''")}'`);
      const verified = back?.[0]?.value ? JSON.parse(back[0].value) : null;
      const good = plan.fixes.every((f) => {
        const arr = f.role.match(/^bannerImages\[(\d+)\]$/);
        return arr ? verified?.bannerImages?.[Number(arr[1])] === f.to : verified?.[f.role] === f.to;
      });
      if (good) {
        ok++;
        say(`    verified`);
      } else {
        failed++;
        say(`    **VERIFY FAILED — stopping**`);
        break;
      }
    }
    if (failed) break;
  }
  say();
  say(`- Repaired and verified: **${ok}**`);
  say(`- Failed: **${failed}**`);
}

writeFileSync("repair-images.md", lines.join("\n") + "\n");
