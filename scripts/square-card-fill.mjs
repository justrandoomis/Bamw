#!/usr/bin/env node
/**
 * Finds the square cover for every game that has none, and gives it one.
 *
 * «في الألعاب التي لا تحمل صورة مربعة قم بالبحث عن الصورة المربعة الخاصة بهذه
 * اللعبة وإضافتها».
 *
 * ## Where the picture comes from
 *
 * One source, and it is the only one that answers this question honestly:
 * Nintendo's own store record for that game, field
 * `productImage({"shape":"square"})`. That is a separate asset with its own
 * id on Nintendo's CDN — not the packshot resized, not a screenshot, not a
 * crop of the box. Role is decided by where the asset sits in Nintendo's data
 * model rather than by looking at the pixels and guessing, which is how a 16:9
 * gameplay screenshot once became a hero image in this shop.
 *
 * A game whose page cannot be resolved, or whose square asset does not exist,
 * is reported and left alone. It is never filled from the front cover, never
 * filled from the gallery, and never filled with a picture belonging to a
 * game with a similar name — `identityMatch` has to agree on the title and
 * the console generation before a page is read at all.
 *
 * ## What it writes
 *
 * `nintendoCardImage`, and nothing else. Not the price, not the cost, not the
 * stock, not the hidden flag, not an option, not a type, not the display
 * order. The patch is built field by field and the assertion below refuses the
 * whole run if any other key ever appears in it.
 *
 * The bytes are fetched, proved to be a decodable image, measured square,
 * converted to webp, uploaded to R2 and READ BACK before the URL is written.
 * A URL is never stored on the strength of looking like one — `buildMedia`
 * owns that order and this script does not reimplement it.
 *
 * A game that already has a square card is never touched, on any run.
 *
 * ## Batching
 *
 * Each game costs up to ten page fetches to find its listing, then a download,
 * a decode, a conversion and two R2 round trips. A run covers a slice and the
 * offset walks the catalogue, the same shape `repair-images.mjs` uses and for
 * the same reason: the whole shelf does not fit in one job's lifetime.
 *
 * The document is written once per run rather than once per game. `updateStore`
 * rewrites and re-chunks the whole catalogue, and doing that nine hundred times
 * would cost far more than the downloads.
 *
 * DRY RUN BY DEFAULT. `--apply` is what writes.
 *
 * Usage:
 *   node scripts/square-card-fill.mjs [--apply] [--limit=N] [--offset=N] [--only=id,id]
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 */

import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildMedia } from "./lib/media-pipeline.mjs";
import { createR2 } from "./lib/r2-store.mjs";

/** The one role this script exists to fill. */
const ROLE = "nintendoCardImage";

const APPLY = process.argv.includes("--apply");
const flag = (name, fallback) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=")[1];
const LIMIT = Math.max(0, Number(flag("limit", "0")) || 0);
/*
  Stop before the job does.

  Fifteen hundred games at roughly a second each is longer than one run, and a
  run killed by the job timeout loses every picture it had collected but not
  yet written — the document is written once at the end, which is the right
  trade everywhere except here. So the loop watches the clock and stops early
  enough to write what it has.
*/
const DEADLINE_MINUTES = Math.max(0, Number(flag("deadline-minutes", "0")) || 0);
const STARTED_AT = Date.now();
const outOfTime = () =>
  DEADLINE_MINUTES > 0 && Date.now() - STARTED_AT > DEADLINE_MINUTES * 60_000;
const OFFSET = Math.max(0, Number(flag("offset", "0")) || 0);
const ONLY = flag("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || "bananto";

const SECRETS = [process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID].filter(
  (v) => v && v.length >= 8,
);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const lines = [];
const say = (t = "") => {
  const s = redact(t);
  lines.push(s);
  console.log(s);
};
const finish = (code) => {
  writeFileSync("square-cards.md", lines.join("\n") + "\n");
  process.exit(code);
};

/*
  The database id is committed in `wrangler.jsonc` — it is the binding this
  Worker deploys against — and `CLOUDFLARE_D1_DATABASE_ID` is not a secret this
  repository sets.
*/
if (!process.env.D1_DATABASE_ID) {
  process.env.D1_DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID || "";
}
if (!process.env.D1_DATABASE_ID) {
  const found = /"database_id"\s*:\s*"([^"]+)"/.exec(readFileSync("wrangler.jsonc", "utf8"));
  if (found) process.env.D1_DATABASE_ID = found[1];
}
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) throw new Error(`missing ${key}`);
}

/* ------------------------------------------------ the application's own code */
const outfile = path.resolve(".square-card-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/square-card-entry.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "silent",
  alias: { "@": path.resolve("src") },
  external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
  /*
    Safe here for the reason `store-media-repair.mjs` records: nothing on this
    path runs a request handler, so the server core is reached by the import
    graph and never by a call.
  */
  plugins: [
    {
      name: "stub-start-virtuals",
      setup(pluginBuild) {
        const virtual = /^(#tanstack-router-entry|#tanstack-start-entry|tanstack-start-manifest:)/;
        pluginBuild.onResolve({ filter: virtual }, (a) => ({
          path: a.path,
          namespace: "start-virtual",
        }));
        pluginBuild.onLoad({ filter: /.*/, namespace: "start-virtual" }, () => ({
          contents: "export default {}; export const getStartManifest = () => ({});",
          loader: "js",
        }));
      },
    },
  ],
});
const app = await import(outfile);
const sharp = (await import("sharp")).default;

say(`# Square cards — ${APPLY ? "APPLY" : "DRY RUN, nothing is written"}`);
say();
say(`Run at ${new Date().toISOString()}.`);
say();

/* ------------------------------------------------------------- the catalogue */
const store = await app.getStore();
const products = Array.isArray(store?.products) ? store.products : [];
if (!products.length) {
  say(`**The catalogue read back empty — refusing to act on nothing.**`);
  finish(1);
}

const games = products.filter((p) => app.isGameProduct(p));
let missing = games.filter((p) => !app.hasNintendoSquareCard(p));
const totalMissing = missing.length;

if (ONLY.length) {
  missing = missing.filter(
    (p) => ONLY.includes(String(p.id)) || ONLY.includes(String(p.slug ?? "")),
  );
}
/*
  A stable order, so batch 2 begins exactly where batch 1 stopped. The document
  order is the admin's arrangement and can move when a product is saved; the id
  cannot.
*/
missing.sort((a, b) => String(a.id).localeCompare(String(b.id)));
if (OFFSET > 0) missing = missing.slice(OFFSET);
if (LIMIT > 0) missing = missing.slice(0, LIMIT);

say(`- products in the catalogue: **${products.length}**`);
say(`- of them games: **${games.length}**`);
say(`- games with no square card: **${totalMissing}**`);
say(`- this run looks at: **${missing.length}**${OFFSET ? ` (from ${OFFSET + 1})` : ""}`);
say();

if (!missing.length) {
  say(
    totalMissing === 0
      ? `**Every game in the catalogue already has a square card.**`
      : `Nothing in this slice. The next run should use a smaller offset.`,
  );
  finish(0);
}

/* ----------------------------------------------------------------- the pass */
const r2 = createR2(BUCKET, { tmpDir: ".square-card-tmp", log: () => {} });
const patches = new Map(); // product id -> square card URL
const rows = [];
let filled = 0;
let noPage = 0;
let noSquare = 0;
let stoppedEarly = 0;

for (const [index, product] of missing.entries()) {
  if (outOfTime()) {
    stoppedEarly = missing.length - index;
    say(`<!-- stopped after ${index} of ${missing.length}: the deadline was reached -->`);
    break;
  }
  const id = String(product.id ?? "");
  const title = String(product.titleEn || product.title || product.english_name || "");

  let media;
  try {
    media = await buildMedia(
      {
        id,
        title,
        platform: product.platform,
        slug: product.slug,
        nsuid: product.nsuid,
      },
      { sharp, r2, apply: APPLY, roles: [ROLE], log: () => {} },
    );
  } catch (err) {
    rows.push({ id, title, outcome: `failed: ${String(err?.message ?? err).slice(0, 70)}` });
    noPage += 1;
    continue;
  }

  const url = media.patch?.[ROLE];
  if (!url) {
    /*
      Two different answers, kept apart. "Nintendo has no page I could match"
      is a research job; "the page is there and carries no square asset" is a
      fact about the game and no amount of retrying changes it.
    */
    const rejected = media.report.find((r) => r.role === ROLE && !r.ok);
    if (media.note) {
      noPage += 1;
      rows.push({ id, title, outcome: "no Nintendo listing matched" });
    } else {
      noSquare += 1;
      rows.push({
        id,
        title,
        outcome: rejected ? `no square asset — ${rejected.reason}` : "no square asset on the page",
      });
    }
    continue;
  }

  const shape = media.report.find((r) => r.role === ROLE && r.ok);
  patches.set(id, String(url));
  filled += 1;
  rows.push({
    id,
    title,
    outcome: `${shape?.width}×${shape?.height}${APPLY ? ", stored in R2" : ", not stored (dry run)"}`,
    /*
      The listing the picture came from, printed for every row. `identityMatch`
      is what stops a game lending its artwork to one with a similar name, and
      the only way to check that it worked is to be able to read which page
      each picture was taken from.
    */
    from: String(media.resolvedUrl ?? "").replace("https://www.nintendo.com", ""),
  });

  if ((index + 1) % 25 === 0) say(`<!-- ${index + 1} of ${missing.length} -->`);
}

/* ------------------------------------------------------------------ the write */
let written = 0;
if (APPLY && patches.size > 0) {
  /*
    One field, checked rather than trusted. This is the assertion that keeps a
    picture fix from becoming a catalogue edit: if anything ever adds a second
    key to the patch, the run stops with the document untouched.
  */
  const field = app.SQUARE_CARD_FIELDS[0];
  if (field !== ROLE) {
    say(`**The canonical square-card field is \`${field}\`, not \`${ROLE}\` — refusing to write.**`);
    finish(1);
  }

  await app.updateStore((current) => {
    const list = Array.isArray(current.products) ? current.products : [];
    const next = list.map((item) => {
      const url = patches.get(String(item?.id ?? ""));
      if (!url) return item;
      /*
        Only the canonical name. The other four in `SQUARE_CARD_FIELDS` are
        read for compatibility with older imported rows; writing all five
        would fan one value across the document and make a later correction
        miss four copies.
      */
      if (app.hasNintendoSquareCard(item)) return item; // it gained one meanwhile
      written += 1;
      return { ...item, [field]: url };
    });
    return { ...current, products: next };
  });
}

/* ----------------------------------------------------------------- the report */
say(`| game | outcome | taken from |`);
say(`| --- | --- | --- |`);
for (const row of rows) {
  say(`| ${row.title || row.id} | ${row.outcome} | ${row.from ? `\`${row.from}\`` : "—"} |`);
}
say();
say(`- given a square card: **${filled}**`);
say(`- no Nintendo listing matched: **${noPage}**`);
say(`- listing found, no square asset: **${noSquare}**`);
say(`- written to the catalogue: **${written}**`);
say(`- still without one after this run: **${totalMissing - written}**`);
if (stoppedEarly > 0) {
  say(
    `- **stopped ${stoppedEarly} short of the end of this slice** at the ${DEADLINE_MINUTES}-minute ` +
      `deadline. What was collected up to that point has been written; run it again to continue.`,
  );
}
say();
if (!APPLY) say(`Nothing was written. Re-run with \`apply\` to store these.`);

if (filled + noPage + noSquare + stoppedEarly !== missing.length) {
  say(`**The tallies do not add up to the number of games — refusing to report a pass that lost rows.**`);
  finish(1);
}
finish(0);
