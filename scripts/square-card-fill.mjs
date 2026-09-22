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
const UA = "bananto-square-cards/1.0 (https://github.com/justrandoomis/Bamw)";

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
/*
  Try the games that have not been tried yet.

  Measured, which is the only reason this exists: the second apply run wrote
  twenty-eight cards in forty-two minutes. The list is ordered by id and the
  four hundred games that failed the first run sit all through the front of
  it, so the run spent its whole budget re-asking Nintendo about games
  Nintendo does not have, and barely reached the five hundred it had never
  seen. At that rate the catalogue never finishes.

  So a failure is remembered. `--retry-failed` ignores the memory, and
  `--stale-days` decides when a remembered failure is old enough to be worth
  asking about again — Nintendo does add listings.
*/
const RETRY_FAILED = process.argv.includes("--retry-failed");
const STALE_DAYS = Math.max(0, Number(flag("stale-days", "30")) || 0);
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

/*
  The memory of what has already been asked and answered "no".

  Created here rather than in the Worker's schema: nothing in the application
  reads it, it exists only so successive runs of this script make forward
  progress, and adding it to the runtime bootstrap would put a migration in
  front of a repair.
*/
await app.d1Run(`
  CREATE TABLE IF NOT EXISTS square_card_attempts (
    product_id   TEXT PRIMARY KEY,
    outcome      TEXT NOT NULL,
    attempted_at TEXT NOT NULL
  )
`);

let skippedTried = 0;
if (!RETRY_FAILED) {
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  /*
    Only the two outcomes that are answers.

    Named precisely on purpose. An earlier run wrote a generic `no_listing`
    for every unresolved game, including ones whose every request had failed
    in transport — so those rows do not match these names, are not skipped,
    and are asked about again and recorded properly. The mistake retires
    itself rather than needing a migration to undo.
  */
  const tried = new Set(
    (
      await app.d1All(
        `SELECT product_id FROM square_card_attempts
         WHERE outcome IN ('no_listing_404', 'no_square_asset') AND attempted_at > ?`,
        cutoff,
      )
    ).map((row) => String(row.product_id)),
  );
  const before = missing.length;
  missing = missing.filter((p) => !tried.has(String(p.id)));
  skippedTried = before - missing.length;
}
if (OFFSET > 0) missing = missing.slice(OFFSET);
if (LIMIT > 0) missing = missing.slice(0, LIMIT);

say(`- products in the catalogue: **${products.length}**`);
say(`- of them games: **${games.length}**`);
say(`- games with no square card: **${totalMissing}**`);
if (skippedTried > 0) {
  say(`- asked about before and still unanswered, skipped: **${skippedTried}**`);
}
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
/**
 * Record that this game was asked about and Nintendo had nothing.
 *
 * Only on a real answer — a page that does not exist, or one that exists and
 * carries no square asset. A thrown request is not an answer and is never
 * written here, because a run that remembers its own timeouts stops asking
 * about games it never reached.
 *
 * Dry runs write nothing, so a dry run cannot teach the next apply to skip.
 */
async function remember(productId, outcome) {
  if (!APPLY) return;
  await app
    .d1Run(
      `INSERT INTO square_card_attempts (product_id, outcome, attempted_at) VALUES (?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET outcome = excluded.outcome, attempted_at = excluded.attempted_at`,
      productId,
      outcome,
      new Date().toISOString(),
    )
    .catch(() => undefined);
}

/**
 * One JSON request against Nintendo of Europe, with the same manners the
 * Wikidata lookup uses: a timeout, one retry, and a failure reported as a
 * failure rather than as an empty answer.
 */
async function euSearch(url) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12_000);
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": UA },
        signal: ctl.signal,
      });
      if (res.ok) return { ok: true, json: await res.json() };
      if (res.status !== 429 && res.status < 500) return { ok: false, status: res.status };
    } catch {
      /* fall through to the retry */
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 1) await new Promise((wake) => setTimeout(wake, 800));
  }
  return { ok: false, status: 0 };
}

const r2 = createR2(BUCKET, { tmpDir: ".square-card-tmp", log: () => {} });
const patches = new Map(); // product id -> square card URL
const rows = [];
let filled = 0;
let noPage = 0;
let noSquare = 0;
let stoppedEarly = 0;
/*
  The two halves of "no listing", counted apart.

  They are different problems with different answers. Every key answering 404
  means Nintendo's US store has no page under any name this builds — a delisted
  game, a region-exclusive, or a key shape unknown here, and no amount of
  re-running finds it. A page that answered 200 and was then refused is a
  disagreement about which product it is, and the commonest one is the
  catalogue calling a game a Switch 2 edition when Nintendo's listing is
  Switch 1. That is a fact about this shop's own data, and it is worth a
  number rather than an impression.
*/
let allKeys404 = 0;
let foundButRejected = 0;
let unreachable = 0;
/* Of the cards stored, how many the US store could not have given us. */
let fromEurope = 0;
/* Games neither Nintendo store has a Switch 2 row for, though we call them one. */
let europeNoSwitch2 = 0;

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
        /*
          NINTENDO'S OWN TITLE FOR THIS ROW, WHICH THE SHOP ALREADY HAS.

          `catalogueImport` stores the supplier sheet's `Matched Title` here,
          and for «Pokémon Scarlet + The Hidden Treasure of Area Zero» it
          already says «Pokémon Scarlet» — the title that actually is a page.
          It was never passed, so the filler built every key from a row title
          Nintendo does not use.
        */
        canonicalTitle: product.canonicalTitle,
        /*
          THE SQUARE COVER THE SHOP ALREADY HAS FOR THIS ROW.

          `catalogueImport` stores the supplier sheet's `Cover URL` here, and
          411 of the 607 rows that carry one point at Nintendo's own square
          directories. The filler has been asking two stores about games whose
          answer was already on the record. `sheetSquareCover` decides whether
          it is square art or a packshot; the pipeline still measures it.
        */
        sheetCover: product.coverImage,
        /*
          Nintendo's own store page for this row, from the sheet's Store Link.
          Measured on the live catalogue: 346 of the 372 games still without a
          square card carry it, against 3 with an nsuid and 0 with a product
          code. It is the widest key this shop has.
        */
        officialStoreUrl: product.officialStoreUrl,
        /*
          Read here rather than inside the search, so one rule decides it.
          The bracket, the platform field and the title all carry the
          generation in this catalogue, and the url-key path already reads
          all three.
        */
        wantsSwitch2: /switch\s*2/i.test(`${product.platform ?? ""} ${title} ${product.slug ?? ""}`),
      },
      { sharp, r2, apply: APPLY, roles: [ROLE], log: () => {}, euSearch },
    );
  } catch (err) {
    rows.push({ id, title, outcome: `failed: ${String(err?.message ?? err).slice(0, 70)}` });
    noPage += 1;
    /*
      Deliberately NOT remembered. This branch is a thrown error — a network
      fault, a timeout, a rate limit — which says nothing about whether
      Nintendo has the game. Remembering it would teach the run to skip a game
      it never actually asked about.
    */
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
      /*
        Say which keys were tried and what each answered, not just that
        nothing matched.

        `buildMedia` already carries it — `resolveProduct` records a line per
        url key, distinguishing "HTTP 404" from "200, rejected: title X is not
        Y". Those are completely different problems: the first is a key this
        does not know how to build, the second is a page found and refused.
        Printing one sentence for both is what hid the bracket bug through a
        dry run and an apply, and reading the reasons is what found it.
      */
      /*
        Split the note into its two halves before trimming either.

        It reads `no Nintendo store page resolved (key → HTTP 404; key → …)`
        and, when the European source also answered, `; europe: <reason>` after
        the closing bracket. Stripping a trailing `)` no longer works once that
        suffix exists, so the bracket was ending up mid-line and the keys and
        the European reason were being cut apart at the wrong place — which is
        how `HTTP 0)` reached the report.
      */
      const note = String(media.note);
      const keysPart = /resolved \(([\s\S]*?)\)(?:; europe: |$)/.exec(note)?.[1] ?? note;
      const europePart = /; europe: ([\s\S]*)$/.exec(note)?.[1] ?? "";
      const tried = [
        ...keysPart.split("; ").slice(-2),
        ...(europePart ? [`europe: ${europePart}`] : []),
      ]
        .join(" · ")
        .slice(0, 170);

      /*
        The commonest European refusal, counted on its own.

        "no Switch 2 row with this title" means this shop calls the game a
        Switch 2 edition and Nintendo — in Europe as well as America — has
        only a Switch 1 listing. It is the same finding as the US platform
        rejection, from a second direction, and together they say the blocker
        is our own label rather than Nintendo's catalogue.
      */
      if (/no Switch 2 row with this title/.test(europePart)) europeNoSwitch2 += 1;
      rows.push({ id, title, outcome: `no listing — ${tried || "no keys tried"}` });
      /*
        Read off the whole note, not the two lines printed above: a game can
        404 on one key and be refused on another, and it is the refusal that
        says something.
      */
      /*
        `HTTP 0` is the shape `fetchText` reports when the request itself
        failed — a timeout, a reset, a rate limit — and it is not an answer
        about whether Nintendo has the game.

        This is the guard I wrote for the `catch` branch and then left a hole
        beside: `resolveProduct` does not throw when every key fails in
        transport, it returns a note, so those games were being recorded as
        "Nintendo has nothing" and skipped for a month. `Prison Architect`
        is in the fourth run's report reading `HTTP 0 · HTTP 0`.
      */
      const keyLines = String(media.note).split("; ");
      const rejected404 = /, rejected:/.test(String(media.note));
      const everyKeyUnreachable =
        keyLines.length > 0 && keyLines.every((line) => /→ HTTP 0\b/.test(line));

      if (rejected404) {
        foundButRejected += 1;
        await remember(id, "no_listing_404");
      } else if (everyKeyUnreachable) {
        unreachable += 1;
        // Not remembered. We never actually asked.
      } else {
        allKeys404 += 1;
        await remember(id, "no_listing_404");
      }
    } else {
      noSquare += 1;
      rows.push({
        id,
        title,
        outcome: rejected ? `no square asset — ${rejected.reason}` : "no square asset on the page",
      });
      await remember(id, "no_square_asset");
    }
    continue;
  }

  const shape = media.report.find((r) => r.role === ROLE && r.ok);
  if (String(media.resolvedUrl ?? "").startsWith("Nintendo of Europe")) fromEurope += 1;
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
    /*
      Reset, because this callback can run more than once.

      `updateStore` re-reads and re-applies on a revision conflict, up to four
      times, and a counter that only ever incremented would report four times
      the pictures it wrote. It has never happened — no run has hit a conflict
      — which is exactly why it would have been believed when it did.
    */
    written = 0;
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
say(`  - of those, found only on Nintendo of Europe: **${fromEurope}**`);
say(`- no Nintendo listing matched: **${noPage}**`);
say(`  - every key answered 404 — not on Nintendo's US store: **${allKeys404}**`);
say(
  `  - a page was found and refused, usually because this shop calls the game a ` +
    `Switch 2 edition and Nintendo's listing is Switch 1: **${foundButRejected}**`,
);
say(
  `  - every request failed in transport, so Nintendo was never actually asked ` +
    `and nothing was remembered: **${unreachable}**`,
);
say(
  `  - and of all of those, games NEITHER Nintendo store has a Switch 2 row for, ` +
    `though this catalogue calls them a Switch 2 edition: **${europeNoSwitch2}**`,
);
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
