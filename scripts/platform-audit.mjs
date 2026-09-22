#!/usr/bin/env node
/**
 * Corrects the console a game is filed under, and takes the supplier's console
 * bracket out of its name.
 *
 * «صحح التسميات والمنصات واكمل الصور».
 *
 * ## Why this is the images task
 *
 * The square-card runs kept reporting the same refusal. Nintendo's page for
 * the game exists, and the fill refuses it:
 *
 *     zombie-rollerz-the-last-ship-switch → 200, rejected: platform generation
 *     Deer & Boy                          · europe: no Switch 2 row with this title
 *
 * Both sentences say the same thing from two different Nintendo catalogues:
 * the shop has the game filed as a Nintendo Switch 2 product and Nintendo only
 * publishes it for Nintendo Switch. The guard is right to refuse — it is what
 * stops a Switch 2 line taking Switch 1 artwork — so the label has to be the
 * thing that moves. In a 120-game sample this was 36 of the refusals.
 *
 * ## What it changes, and what it cannot
 *
 * `platform`, `title` and `titleEn`. Three fields, asserted before the write
 * and verified field by field after it. The price, the cost, the stock, the
 * hidden flag, the Offline/Online options, the types, the trade-in values, the
 * display order and the sales figures are not read for writing and cannot be
 * reached from here.
 *
 * The slug is deliberately NOT changed when a title is. A slug is a URL: it is
 * in customers' history, in shared links and in the order records, and a
 * cosmetic rename is not worth breaking one.
 *
 * ## Why a platform change is dangerous, and the three refusals
 *
 * `productIdentityKeys` builds a product's identity as `platform::title`, and
 * `product_identity` has a unique index on that pair. So this does not edit a
 * label; it moves a product onto another key.
 *
 *  1. **Evidence.** A label moves only when a Nintendo catalogue positively
 *     lists the exact title on the other console and neither catalogue lists
 *     it on the stored one. A game neither store carries is left alone: no
 *     evidence is not evidence of a wrong label.
 *  2. **Completeness.** If any request failed in transport, the run refuses to
 *     read that silence as an answer.
 *  3. **Collision.** Every proposed change is checked against the catalogue it
 *     would produce — including the other changes in the same batch — and any
 *     change landing on an identity another product holds is dropped, and the
 *     drop is re-checked, until the set is stable.
 *
 * DRY RUN BY DEFAULT. `--apply` is what writes.
 *
 * Usage:
 *   node scripts/platform-audit.mjs [--apply] [--limit=N] [--offset=N] [--only=id,id]
 *                                   [--deadline-minutes=N] [--no-titles] [--no-platforms]
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 */

import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { searchEuropeGenerations } from "./lib/nintendo-eu-search.mjs";
import { editionAwareTitle, probeGenerations } from "./lib/nintendo-store.mjs";
import {
  declaresSwitch2Edition,
  platformVerdict,
  settleWithFallback,
  titleFlags,
  titleVerdict,
} from "./lib/platform-verdict.mjs";

/** Every field this script is allowed to touch. Nothing else may enter a patch. */
const WRITABLE = ["platform", "title", "titleEn"];

const APPLY = process.argv.includes("--apply");
const DO_TITLES = !process.argv.includes("--no-titles");
const DO_PLATFORMS = !process.argv.includes("--no-platforms");
const flag = (name, fallback) =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=")[1];
const LIMIT = Math.max(0, Number(flag("limit", "0")) || 0);
const OFFSET = Math.max(0, Number(flag("offset", "0")) || 0);
const DEADLINE_MINUTES = Math.max(0, Number(flag("deadline-minutes", "0")) || 0);
const STARTED_AT = Date.now();
const outOfTime = () => DEADLINE_MINUTES > 0 && Date.now() - STARTED_AT > DEADLINE_MINUTES * 60_000;
const ONLY = flag("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
  writeFileSync("platform-audit.md", lines.join("\n") + "\n");
  process.exit(code);
};

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
const outfile = path.resolve(".platform-audit-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/platform-audit-entry.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "silent",
  alias: { "@": path.resolve("src") },
  external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
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

say(`# Labels and platforms — ${APPLY ? "APPLY" : "DRY RUN, nothing is written"}`);
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

/* Every product as it stands, for the collision report and the read-back. */
const before = new Map(products.map((p) => [String(p.id ?? ""), p]));
const games = products.filter((p) => app.isGameProduct(p));
let queue = games.slice();
if (ONLY.length) {
  queue = queue.filter((p) => ONLY.includes(String(p.id)) || ONLY.includes(String(p.slug ?? "")));
}
// Stable across batches: the document order is the admin's arrangement and
// moves when a product is saved; the id does not.
queue.sort((a, b) => String(a.id).localeCompare(String(b.id)));
if (OFFSET > 0) queue = queue.slice(OFFSET);
if (LIMIT > 0) queue = queue.slice(0, LIMIT);

say(`- products in the catalogue: **${products.length}**`);
say(`- of them games: **${games.length}**`);
say(`- this run looks at: **${queue.length}**${OFFSET ? ` (from ${OFFSET + 1})` : ""}`);
say();

/* ------------------------------------------------------------------ evidence */
const fetchJson = async (url) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": "bananto-platform-audit/1.0 (https://github.com/justrandoomis/Bamw)",
        },
        signal: ctl.signal,
      });
      if (!res.ok) return { ok: false, status: res.status };
      return { ok: true, json: await res.json() };
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: 0 };
};

/**
 * The title to ask Nintendo about.
 *
 * Both Nintendo catalogues are searched in Latin script, and a shelf title may
 * be Arabic. `titleEn` is the English name the shop already keeps for exactly
 * this sort of purpose, so it is used when the primary title has nothing a
 * store index can match. A product with neither is not asked about at all: it
 * is left alone and counted, rather than reported as though Nintendo had
 * answered.
 */
function lookupTitle(product) {
  for (const candidate of [product.title, product.titleEn]) {
    if (editionAwareTitle(candidate)) return String(candidate);
  }
  return "";
}

/**
 * Both catalogues, combined by union.
 *
 * Union, not intersection, and the direction matters. A console seen by EITHER
 * store is a console the game exists on, and that is enough to stop a flip
 * away from it. A console seen by NEITHER is the only thing that lets one
 * happen. So a source that answers nothing can never cause a change, only
 * fail to prevent one — which is why `complete` is tracked separately and a
 * failed request blocks the write outright.
 *
 * Europe is asked first and America only if Europe did not already vindicate
 * the stored label. One search settles the overwhelming majority of a
 * correctly-labelled catalogue, and the American probe costs up to eight page
 * fetches — asking it about games with nothing to correct is how the first
 * square-card runs spent their whole budget without finishing.
 */
async function gatherEvidence(product, stored) {
  const title = lookupTitle(product);
  if (!title) return { generations: [], complete: false, unaskable: true, us: null, eu: null };

  const eu = await searchEuropeGenerations(title, fetchJson);
  const euGenerations = eu.ok ? eu.generations : [];
  /*
    Only Nintendo's own two "we do not have that" answers are answers. Every
    other outcome — a 503, a 400, a request that never arrived — means the
    question was not put, and a question not put must never read as a console
    that does not exist.
  */
  const euComplete =
    eu.ok || /^(no rows|no row with this exact title)$/.test(String(eu.reason ?? ""));

  if (euGenerations.includes(stored)) {
    return {
      generations: euGenerations,
      complete: true,
      us: null,
      eu: { generations: eu.generations },
    };
  }

  const us = await probeGenerations({
    title,
    slug: product.slug,
    nintendoEshopUrl: product.nintendoEshopUrl,
    eshopUrl: product.eshopUrl,
    officialUrl: product.officialUrl,
  });

  return {
    generations: [...new Set([...us.generations, ...euGenerations])].sort(),
    complete: us.complete && euComplete,
    us,
    eu: eu.ok ? { generations: eu.generations } : { reason: eu.reason },
  };
}

/* ------------------------------------------------------------- the decisions */
const proposals = new Map(); // id -> { product, platform?, title?, titleEn?, why: [] }
const reports = [];
const flags = [];
const leaks = [];
/* Per product, the lesser rename to fall back on if the better one collides. */
const weaker = new Map();
const unchanged = [];
let asked = 0;
let unaskable = 0;
let stoppedEarly = false;

for (const product of queue) {
  if (outOfTime()) {
    stoppedEarly = true;
    say(`_Stopped after ${DEADLINE_MINUTES} minutes with ${asked} of ${queue.length} asked._`);
    say();
    break;
  }
  asked += 1;
  const id = String(product.id ?? "");
  const stored = app.normalizeProductPlatform(product.platform);
  const isEdition = declaresSwitch2Edition(product);
  const label = `${product.title ?? product.titleEn ?? id}`;

  let platform = stored;
  const why = [];

  if (DO_PLATFORMS) {
    const evidence = await gatherEvidence(product, stored);
    if (evidence.unaskable) {
      unaskable += 1;
    } else {
      const verdict = platformVerdict({
        ours: stored,
        evidence: evidence.generations,
        complete: evidence.complete,
        isEdition,
      });
      if (verdict.action === "flip") {
        platform = verdict.to;
        why.push(`platform ${stored} → ${verdict.to}: ${verdict.reason}`);
      } else if (verdict.action === "report") {
        reports.push({
          id,
          label,
          kind: "platform",
          reason: verdict.reason,
          detail: [
            evidence.eu?.reason ? `europe: ${evidence.eu.reason}` : "",
            (evidence.us?.tried ?? []).join("; "),
          ]
            .filter(Boolean)
            .join(" · "),
        });
      }
    }
  }

  /*
    The title decision runs against the CORRECTED platform, not the stored
    one. A game filed as Switch 2 and named `Foo [Switch 2]`, whose platform
    this run moves to Switch 1, has a bracket that now disagrees — and
    stripping it is right, because the whole claim came from the same wrong
    column of the same sheet.
  */
  if (DO_TITLES) {
    for (const field of ["title", "titleEn"]) {
      /*
        Reported and never acted on. Each of these has more than one plausible
        repair and choosing between them is a judgement about the shop's own
        copy — `PokÃ©mon` may be a mangled `é` or may be what the publisher
        wrote — so they are listed and the stored name stands.
      */
      for (const flagged of titleFlags(product[field])) {
        if (flagged === "empty") continue;
        flags.push({ id, label, field, flagged, value: String(product[field] ?? "") });
      }
      const verdict = titleVerdict(product[field], platform);
      if (verdict.action === "rename") {
        why.push(`${field} "${product[field]}" → "${verdict.to}": ${verdict.reason}`);
        proposals.set(id, { ...(proposals.get(id) ?? {}), [field]: verdict.to });
        if (verdict.leaked) {
          leaks.push({ id, field, leaked: verdict.leaked, was: String(product[field] ?? "") });
        }
        if (verdict.fallback) {
          weaker.set(id, { ...(weaker.get(id) ?? {}), [field]: verdict.fallback });
        }
      } else if (verdict.action === "report") {
        reports.push({ id, label, kind: field, reason: verdict.reason, detail: "" });
      }
    }
  }

  if (platform !== stored) {
    proposals.set(id, { ...(proposals.get(id) ?? {}), platform });
  }
  const entry = proposals.get(id);
  if (entry) {
    entry.product = product;
    entry.why = [...(entry.why ?? []), ...why];
  } else {
    unchanged.push(label);
  }
}

/* ------------------------------------------------------- the collision check */
/*
  The catalogue this run would produce, checked against itself. The rule and
  the loop live in `platform-verdict.mjs` so they can be exercised without a
  network or a database; what is passed in here is the application's OWN
  `productIdentityKeys`, so this cannot disagree with the admin save path
  about what a duplicate is.
*/
const { refused, rescued, preexisting } = settleWithFallback(
  products,
  proposals,
  weaker,
  app.productIdentityKeys,
);
for (const id of rescued) {
  const entry = proposals.get(id);
  if (!entry) continue;
  entry.why = [
    ...(entry.why ?? []),
    "the fuller rename would have collided, so only the supplier's data was removed",
  ];
}

for (const drop of refused) {
  reports.push({
    id: drop.id,
    label: String(before.get(drop.id)?.title ?? drop.id),
    kind: "collision",
    reason: `the correction would put it on \`${drop.key}\`, which ${drop.held.join(", ")} already holds`,
    detail: "",
  });
}

/* ----------------------------------------------------------------- the report */
say(`## What would change`);
say();
if (proposals.size === 0) {
  say(`Nothing. Every game this run looked at is already filed and named correctly,`);
  say(`or the evidence did not settle the question.`);
} else {
  say(`| product | field | from | to | why |`);
  say(`| --- | --- | --- | --- | --- |`);
  for (const [id, entry] of proposals) {
    const product = entry.product;
    for (const field of WRITABLE) {
      if (!(field in entry)) continue;
      const cell = (v) => String(v ?? "").replace(/\|/g, "\\|");
      say(
        `| ${cell(product.title ?? id)} | ${field} | ${cell(product[field])} | ${cell(entry[field])} | ${cell((entry.why ?? []).find((w) => w.startsWith(`${field} `)) ?? "")} |`,
      );
    }
  }
}
say();
say(`- products this run would change: **${proposals.size}**`);
say(`- looked at and left alone: **${unchanged.length}**`);
say(`- reported and not acted on: **${reports.length}**`);
if (unaskable) {
  say(`- with no Latin title to ask either Nintendo store about: **${unaskable}**`);
}
say();

if (reports.length) {
  say(`## Reported, and left exactly as they are`);
  say();
  const byKind = new Map();
  for (const report of reports) {
    if (!byKind.has(report.kind)) byKind.set(report.kind, []);
    byKind.get(report.kind).push(report);
  }
  for (const [kind, rows] of byKind) {
    say(`### ${kind} (${rows.length})`);
    say();
    for (const row of rows.slice(0, 80)) {
      say(`- **${row.label}** — ${row.reason}${row.detail ? `  \n  _${row.detail}_` : ""}`);
    }
    if (rows.length > 80) say(`- _…and ${rows.length - 80} more._`);
    say();
  }
}

/* ----------------------------------------- supplier data anywhere a customer reads */
/*
  The question the titles raised, asked of every public field.

  `¥8.76` and `狂乱命运` were in product titles because a scrape glued a cell
  onto the name. The same scrape filled the rest of the record, so the honest
  next question is whether it put a supplier's price or the Chinese supplier
  name anywhere else a customer can read.

  It is asked of `toPublicProduct`'s output, not of the stored record: that
  function already drops the fields that are private by name and the lines that
  are plainly supplier bookkeeping, so anything still carrying a yuan mark
  after it is genuinely on the page. A game's own Japanese or Chinese name is
  not a leak, so CJK on its own is not reported — only a currency mark, and
  only the yuan and the renminbi sign this supplier prices in.

  Report only. Nothing here is changed by this script, and the fields it names
  are outside the three it may write.
*/
/*
  A supplier's price, and not a product's own.

  The first sweep matched any yuan mark and reported 240 hits. Nearly all of
  them were the Nintendo eShop Japan Gift Card's own denominations — `¥500`,
  `¥1,000`, `Japan Nintendo eShop balance ¥2,500` — which is what the customer
  is buying, printed exactly where it should be. Reporting those as a
  disclosure was wrong, and a report that cries wolf about a product's own
  price is worse than no report.

  The supplier prices this shop actually pays are in yuan and to the fen:
  `¥8.76`, `¥14.64`, `¥11.7`, `¥7.78`. A decimal fraction is what separates
  them from a gift card's denomination, which is always round. So a fraction
  is the test, and the round ones are counted separately and named for what
  they almost certainly are.

  A supplier price that happened to be round would be missed. That is the
  trade, it is stated in the report, and the alternative — reporting every
  yen figure in a Japanese gift card as a leak — hides the real ones in a
  list nobody will read to the end.
*/
const SUPPLIER_PRICE = /(?:¥|￥)\s*\d+\.\d|(?:CNY|RMB|人民币)\s*\d/i;
const DENOMINATION = /(?:¥|￥)\s*[\d,]+/;
const publicLeaks = [];
let denominations = 0;
const walk = (node, path, into) => {
  if (typeof node === "string") {
    if (SUPPLIER_PRICE.test(node)) into.push({ path, value: node.slice(0, 160) });
    else if (DENOMINATION.test(node)) denominations += 1;
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${path}[${index}]`, into));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node))
      walk(value, path ? `${path}.${key}` : key, into);
  }
};
for (const product of products) {
  const found = [];
  try {
    walk(app.toPublicProduct(product), "", found);
  } catch {
    // A product the public serializer cannot read is a different fault, and
    // not one this audit is entitled to act on.
    continue;
  }
  for (const hit of found) {
    publicLeaks.push({ id: String(product.id ?? ""), label: String(product.title ?? ""), ...hit });
  }
}

if (publicLeaks.length) {
  say(`## A supplier's price still reaching a customer, elsewhere in the record`);
  say();
  say(`Reported only. These fields are outside the three this script may write.`);
  say();
  say(
    `Matched on a decimal fraction, because that is what separates a supplier's` +
      ` price in yuan from a gift card's own denomination. A supplier price that` +
      ` happened to be round would be missed.`,
  );
  say();
  for (const row of publicLeaks.slice(0, 60)) {
    say(`- **${row.label}** \`${row.path}\` — ${row.value}`);
  }
  if (publicLeaks.length > 60) say(`- _…and ${publicLeaks.length - 60} more._`);
  say();
}

if (leaks.length) {
  /*
    First, because it is the only thing in this report that is a disclosure
    rather than an untidiness. A price in yuan is a supplier cost; a Chinese
    name is the `supplier_name_zh_cn` this shop keeps out of the public
    product API, off the product page, out of the public HTML, out of the
    cache and out of search — and it is in the product's public title.
  */
  say(`## Supplier data found in a public name`);
  say();
  say(`Each of these is removed by the correction above.`);
  say();
  for (const row of leaks) say(`- \`${row.leaked}\` in \`${row.field}\` — ${row.was}`);
  say();
}

if (flags.length) {
  say(`## Names worth a person's eye, reported and not changed`);
  say();
  const byFlag = new Map();
  for (const row of flags) {
    if (!byFlag.has(row.flagged)) byFlag.set(row.flagged, []);
    byFlag.get(row.flagged).push(row);
  }
  for (const [flagged, rows] of byFlag) {
    say(`### ${flagged} (${rows.length})`);
    say();
    for (const row of rows.slice(0, 40)) say(`- \`${row.field}\` — ${row.value}`);
    if (rows.length > 40) say(`- _…and ${rows.length - 40} more._`);
    say();
  }
}

if (preexisting.length) {
  say(`## Already duplicated before this run, and not touched`);
  say();
  for (const row of preexisting.slice(0, 40)) say(`- \`${row.key}\` — ${row.ids.join(", ")}`);
  say();
}

/*
  The recap, last.

  A run's report is long — a hundred renames, a hundred and seventy names in
  capitals — and the numbers that decide whether to apply it were in the
  middle, where the tail of a job log cannot reach them. They are repeated
  here so the last twenty lines of any run say what it found.
*/
const platformMoves = [...proposals.values()].filter((entry) => "platform" in entry).length;
const renames = [...proposals.values()].filter(
  (entry) => "title" in entry || "titleEn" in entry,
).length;
say(`## In short`);
say();
say(`- games looked at: **${asked}** of ${games.length}`);
say(`- products this run would change: **${proposals.size}**`);
say(`  - moved to another console: **${platformMoves}**`);
say(`  - renamed: **${renames}**`);
say(`- supplier data taken out of a public name: **${leaks.length}**`);
say(`- a supplier's price still reaching a customer elsewhere: **${publicLeaks.length}**`);
say(
  `  - round yen figures, almost all a gift card's own denomination, not counted: **${denominations}**`,
);
say(`- corrections refused because they would collide: **${refused.length}**`);
if (rescued.length) {
  say(
    `  - of those, rescued by removing only the supplier's data: **${rescued.filter((id) => proposals.has(id)).length}**`,
  );
}
say(`- duplicates already in the catalogue, untouched: **${preexisting.length}**`);
say(`- reported and left alone: **${reports.length}**`);
if (stoppedEarly) say(`- **stopped on its deadline; resume with \`--offset=${OFFSET + asked}\`**`);
say();
if (refused.length) {
  /*
    Named, not just counted. Every one of these is two products the catalogue
    believes are one game, and which of them keeps the orders is a person's
    decision, not a script's.
  */
  say(`### The corrections refused, and what already holds the name`);
  say();
  for (const drop of refused.slice(0, 40)) {
    say(
      `- **${String(before.get(drop.id)?.title ?? drop.id)}** — \`${drop.key}\` is held by ${drop.held.join(", ")}`,
    );
  }
  if (refused.length > 40) say(`- _…and ${refused.length - 40} more._`);
  say();
}

if (!APPLY) {
  say(`**Dry run. Nothing was written.**`);
  finish(0);
}
if (proposals.size === 0) {
  say(`**Nothing to write.**`);
  finish(0);
}

/* -------------------------------------------------------------------- the write */
/*
  The assertion that keeps this to three fields. Built before the write rather
  than checked after it, so a patch carrying anything else stops the run
  instead of reaching the catalogue.
*/
for (const [id, entry] of proposals) {
  const keys = Object.keys(entry).filter((k) => k !== "product" && k !== "why");
  const stray = keys.filter((k) => !WRITABLE.includes(k));
  if (stray.length) {
    say(`**A patch for ${id} carries ${stray.join(", ")}, which this script may not write.**`);
    finish(1);
  }
}

/**
 * One product, patched. The only place a changed record is built.
 *
 * Shared by the rehearsal below and by the write itself, so what is inspected
 * and what is stored cannot be two different things.
 */
const patched = (item) => {
  const entry = proposals.get(String(item?.id ?? ""));
  if (!entry) return item;
  const patch = {};
  for (const field of WRITABLE) if (field in entry) patch[field] = entry[field];
  return { ...item, ...patch };
};

/*
  The rehearsal.

  The read-back below catches a bad write, but only after it has happened, and
  a catalogue cannot be un-written. So every changed record is built in memory
  first and compared against the original field by field: if anything outside
  the three writable fields differs, the run stops with the catalogue
  untouched. It has cost nothing and it is the difference between detecting a
  fault and preventing one.
*/
for (const [id] of proposals) {
  const was = before.get(id);
  if (!was) {
    say(`**${id} has a correction but is not in the catalogue that was read.**`);
    finish(1);
  }
  const now = patched(was);
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (WRITABLE.includes(key)) continue;
    if (JSON.stringify(was[key] ?? null) !== JSON.stringify(now[key] ?? null)) {
      say(`**Building the patch for ${id} would change \`${key}\`, which this script may not.**`);
      finish(1);
    }
  }
}

let written = 0;
await app.updateStore((current) => {
  const list = Array.isArray(current?.products) ? current.products : [];
  const next = list.map((item) => {
    if (!proposals.has(String(item?.id ?? ""))) return item;
    written += 1;
    return patched(item);
  });
  return { ...current, products: next };
});

/*
  Read back, and compare field by field rather than trusting the write.

  Every key of every changed product must be identical to what it was, except
  the ones in the patch. A price that moved would be caught here, and the run
  would say so instead of reporting a success.
*/
const after = await app.getStore();
const afterList = Array.isArray(after?.products) ? after.products : [];
const afterById = new Map(afterList.map((p) => [String(p.id ?? ""), p]));
const faults = [];
let verified = 0;
for (const [id, entry] of proposals) {
  const was = before.get(id);
  const now = afterById.get(id);
  if (!now) {
    faults.push(`${id} is not in the catalogue after the write`);
    continue;
  }
  for (const field of WRITABLE) {
    if (field in entry && now[field] !== entry[field]) {
      faults.push(`${id}.${field} is "${now[field]}", expected "${entry[field]}"`);
    }
  }
  for (const key of new Set([...Object.keys(was ?? {}), ...Object.keys(now)])) {
    if (WRITABLE.includes(key) && key in entry) continue;
    const a = JSON.stringify(was?.[key] ?? null);
    const b = JSON.stringify(now[key] ?? null);
    if (a !== b) faults.push(`${id}.${key} changed, and this script may not change it`);
  }
  verified += 1;
}

/*
  The unique index beside the document.

  `product_identity` holds one row per product on (normalized_title, platform),
  and a title or platform changed in the document without moving that row
  leaves the index claiming an identity the product no longer has — which then
  refuses that identity to whoever really holds it. Every changed row is
  dropped first and re-claimed afterwards, because a claim made one at a time
  would fail wherever two products swap identities within this batch.
*/
const changedIds = [...proposals.keys()];
for (const id of changedIds) {
  await app.d1Run(`DELETE FROM product_identity WHERE product_id = ?`, id);
}
let reclaimed = 0;
const unclaimed = [];
for (const id of changedIds) {
  const product = afterById.get(id);
  if (!product) continue;
  const claim = await app.claimProductIdentity(product);
  if (claim.ok) reclaimed += 1;
  else unclaimed.push(`${id} → held by ${claim.conflictProductId ?? "something"}`);
}

/*
  Let the square-card filler ask Nintendo again about what it moved.

  The filler remembers a game it could not find so successive runs make
  forward progress, and `no_listing_404` was often recorded for exactly the
  reason this script has just repaired: the shop asked Nintendo for a Switch 2
  page for a game Nintendo only publishes on Switch. That memory is now a
  record of a question asked under a label that no longer exists, so it is
  dropped for the products whose platform moved — and only for those. A
  renamed title keeps its memory, because the filler already strips the
  console bracket before it asks.

  The table may not exist yet if the filler has never run; `IF EXISTS` is not
  available for a DELETE, so a missing table is caught and ignored rather than
  failing a write that has already succeeded.
*/
const replatformed = [...proposals.entries()]
  .filter(([, entry]) => "platform" in entry)
  .map(([id]) => id);
let forgotten = 0;
for (const id of replatformed) {
  try {
    await app.d1Run(`DELETE FROM square_card_attempts WHERE product_id = ?`, id);
    forgotten += 1;
  } catch {
    // No such table, or no such row. Neither is a reason to report a failure.
  }
}

say(`## Written`);
say();
say(`- products changed: **${written}**`);
if (replatformed.length) {
  const stillBare = replatformed.filter((id) => {
    const product = afterById.get(id);
    return product && !app.hasNintendoSquareCard(product);
  }).length;
  say(`- of them moved to another console: **${replatformed.length}**`);
  say(`- of those still without a square picture, now worth asking about again: **${stillBare}**`);
  say(`- square-card attempt rows dropped so the filler will retry: **${forgotten}**`);
}
say(`- read back and verified: **${verified}**`);
say(`- identity rows re-claimed: **${reclaimed}** of ${changedIds.length}`);
if (unclaimed.length) {
  say(`- identity rows that could not be re-claimed:`);
  for (const row of unclaimed) say(`  - ${row}`);
}
say();
if (faults.length) {
  say(`**The read-back does not agree with what was asked for:**`);
  for (const fault of faults) say(`- ${fault}`);
  finish(1);
}
say(`Every changed product reads back with exactly the fields this run asked for,`);
say(`and with every other field byte-identical to what it was.`);
if (stoppedEarly) {
  say();
  say(
    `_This run stopped on its deadline. Re-run with \`--offset=${OFFSET + asked}\` to continue._`,
  );
}
finish(0);
