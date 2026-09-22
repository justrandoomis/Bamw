#!/usr/bin/env node
/**
 * The owner's four pricing rules, applied to a game's four prices.
 *
 * `src/lib/tierRepricing.ts` holds the rules and is tested there against the
 * owner's own worked example. This script reads the catalogue, runs those
 * exact functions, reports the COST BREAKDOWN first — «قبل كل شيء أعطني
 * التكلفة للمنتجات» — and only when told to, writes the `price` field of the
 * tier rows they moved.
 *
 * Dry run unless `--apply`. Even then:
 *
 *   - `types[i].price` is the ONLY thing this script may write. Every other
 *     key of every touched product, and every other key of every touched
 *     tier — its cost above all — is compared after the write and a single
 *     difference fails the run.
 *   - Every proposal passes `tierProblem` before anything is written. A price
 *     below its cost, not a whole thousand, outside the online band, or an
 *     add-ons edition not dearer than the plain one, stops the WHOLE run.
 *   - Every old price is printed and carried in the JSON artifact, so the
 *     change can be undone exactly.
 *
 * Usage:
 *   node scripts/tier-reprice.mjs               # dry run: the cost report
 *   node scripts/tier-reprice.mjs --apply       # write
 *   node scripts/tier-reprice.mjs --only prd_x  # one product
 *   node scripts/tier-reprice.mjs --limit 5     # the first five that move
 */
import { build } from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  bumpAfterOverlayWrites,
  overlayProductIds,
  readOverlayProduct,
  writeOverlayProduct,
} from "./lib/store-overlay.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);
const APPLY = args.apply === "true";
const ONLY = args.only && args.only !== "true" ? String(args.only) : null;
/*
  A typo in `--limit` used to be silent. `Number("five")` is NaN, `slice(0, NaN)`
  is the empty array, and an `--apply` run then wrote nothing, printed
  «لا شيء ليُكتب» and exited 0 — a no-op reported as a success, which is the
  one thing a script that touches prices must never do.
*/
/*
  FINISH THE JOB: make every copy of a price agree.

  The run that wrote 87 products left 13 showing one number and charging
  another, because for each of them the shown price, the charged price and the
  rule's own answer were three different values and choosing between them was
  the owner's call, not mine. He has since said «اكمل كل شي من باقي الاسعار
  للالعاب» — finish all of it.

  So this mode settles them the only way that is not a guess: the RULE'S answer,
  written to every copy. The rules are the owner's own, stated by him and
  verified against production — they reproduced, to the dinar, a price a
  different module had computed on forty products. Applying them is applying his
  policy; picking the displayed number or the charged number instead would be
  picking one of two numbers at random and calling it a decision.

  Every product it touches is listed with its three before-values and the one
  after, so any single one can be overridden in a sentence.
*/
const SYNC_MIRRORS = args["sync-mirrors"] === "true";

let LIMIT = Infinity;
if (args.limit && args.limit !== "true") {
  LIMIT = Number(args.limit);
  if (!Number.isInteger(LIMIT) || LIMIT <= 0) {
    console.error(`--limit=${args.limit} ليس عددًا صحيحًا موجبًا`);
    process.exit(1);
  }
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
const flush = () => {
  writeFileSync("tier-reprice.md", `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
  }
};
const fail = (message) => {
  say();
  say(`## توقف: ${message}`);
  say();
  say("**لم يُكتب شيء بعد هذه النقطة.**");
  flush();
  process.exit(1);
};

if (!process.env["D1_DATABASE_ID"] && !process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  try {
    const config = readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    const found = config.match(/"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/);
    if (found) process.env["D1_DATABASE_ID"] = found[1];
  } catch {
    /* Reported below. */
  }
}
if (!process.env["D1_DATABASE_ID"] && process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  process.env["D1_DATABASE_ID"] = process.env["CLOUDFLARE_D1_DATABASE_ID"];
}
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) fail(`مفقود ${key}`);
}

const outfile = path.resolve(".tier-reprice-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/catalogue-entry.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "silent",
  alias: { "@": path.resolve("src") },
  external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
  /*
    TanStack Start's server core imports three virtual modules that only the
    app's own build can resolve. Stubbing them is safe here because nothing on
    this path runs a request handler — the catalogue is read as a document.
    The first run of this script died on exactly these three, because it was
    written without the plugin that `reprice.mjs` has carried since it was
    written for the same reason.
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

const money = (n) => Number(n || 0).toLocaleString("en-US");

/*
  A product's name in a report column, with enough of it to tell two apart.

  At 34 characters «SpongeBob SquarePants: Titans of t…» named two different
  products identically, on adjacent rows, with different prices — so the one
  row a reader would query was the one they could not identify. The tail of
  the id disambiguates when the visible names still collide.
*/
/*
  The tier's OWN name, beside its kind.

  The report named the product and the kind but never the row, so «offline_base»
  could be «اوفلاين عادي» or «النسخة الفاخرة Ultimate (خاص بالأوفلاين)» and the
  owner could not tell which — which is exactly the pair that has to be told
  apart, since the 12,000 ceiling belongs to one of them and not the other.
*/
const tierName = (p) => {
  const name = String(p?.name ?? "").trim() || String(p?.id ?? "").trim();
  return name.length > 34 ? `${name.slice(0, 33)}…` : name || "—";
};

const label = (result) => {
  const title = String(result?.title ?? "").trim();
  const id = String(result?.id ?? "");
  const shown = title.length > 46 ? `${title.slice(0, 45)}…` : title || "—";
  return `${shown} \`${id.slice(-6)}\``;
};

/* ------------------------------------------------------------ the catalogue */

const reachable = await app.d1All("SELECT count(*) AS n FROM store_kv");
if (!reachable.length) fail("قاعدة البيانات غير متاحة — لن أكتب تقريرًا عن لا شيء");

const store = await app.getStore();
const products = Array.isArray(store?.products) ? store.products : [];
if (products.length < 100) fail(`الكتالوج أعاد ${products.length} منتجًا فقط — هذا ليس الكتالوج`);

/*
  Which products live in a granular `store:product:<id>` row.

  `loadStore` merges the chunked catalogue with these rows and lets the
  granular one WIN. `updateStore` writes only the chunks — so a product with a
  granular row is frozen: the write lands, the read-back shows the old value,
  and nothing says why. Measured here rather than assumed, and the apply below
  writes whichever row actually wins for each product.
*/
const overlayIds = await overlayProductIds(app);

/* ------------------------------------------------------------- the proposals */

const results = [];
for (const product of products) {
  const id = String(product?.["id"] ?? "");
  if (!id) continue;
  if (ONLY && id !== ONLY) continue;
  if (!Array.isArray(product?.["types"]) || product["types"].length === 0) continue;

  const result = app.repriceTiers({
    id,
    title: String(product["title"] || product["titleEn"] || ""),
    kind: String(product["kind"] ?? ""),
    schemaId: String(product["schemaId"] ?? product["schema_id"] ?? ""),
    types: product["types"],
    /* «٨ العاب قويه، ٩ ... وسويتش ٢» — see `CHEAP_SWITCH2`. */
    isSwitch2: app.isNintendoSwitch2Product(product),
  });
  results.push({ product, result });
}

/* ------------------------------------------------- products with a bad cost */

/*
  A LARGE MOVE IS NOT, BY ITSELF, A REASON TO HOLD.

  This ran for one iteration as a blanket hold on any move of 35% or 15,000
  dinars, and the dry run showed what that actually caught: nine moves, of
  which seven are the owner's own rules doing exactly what he asked for —

    Paper Mario: The Origami King   20,000 → 12,000   «١٢ الف كحد اقصى في الالعاب القويه جدا»
    Pokémon Pokopia (online)        65,000 → 46,000   «الربح 10 الف اقل شي و اعلى شي 15 الف»
    DYNASTY WARRIORS (add-ons)      21,000 → 12,000   «تكون زياده ٢٠٠٠ فقط»
    A Plague Tale (offline)          5,000 →  8,000   «الاسعار تبدأ من 7000 فما فوق»
    Switch 2 Welcome Tour (online)   7,000 → 15,000   the online floor

  Holding those would be refusing to do the thing that was asked, and keeping
  margins far above the ceiling the owner set. The size of a move is a reason
  to SHOW it, which section 5 does. It is not a reason to refuse it.

  What is a reason to refuse is a COST that is known to be wrong, because no
  arithmetic on a wrong cost produces a right price. There is exactly one such
  product, and it is here because the owner said so, not because a threshold
  inferred it.
*/
const COST_DISPUTED = [
  {
    match: /super\s*smash\s*bros/i,
    why: "«السعر في الsuper smash bros ultimate كان للاونلاين ، لكن التكلفه هي للاوفلاين» — السعر الحالي صحيح، والتكلفة المسجّلة هي التي تحتاج تصحيحًا.",
  },
];

const disputed = [];
for (const { result } of results) {
  const rule = COST_DISPUTED.find((row) => row.match.test(String(result.title ?? "")));
  if (!rule) continue;
  let held = 0;
  for (const p of result.proposals) {
    if (!p.changed) continue;
    p.newPrice = p.oldPrice;
    p.changed = false;
    p.skipped = rule.why;
    held += 1;
  }
  if (held) disputed.push({ result, why: rule.why, held });
  result.changed = result.proposals.some((p) => p.changed);
}

/*
  Reported all the same, because a move this size is the one an owner would
  want to see before it happens even when the rules are right about it.
*/
const BIG_MOVE_RATIO = 0.35;
const BIG_MOVE_ABSOLUTE = 15_000;
const bigMoves = [];
for (const { result } of results) {
  for (const p of result.proposals) {
    if (!p.changed) continue;
    const from = Number(p.oldPrice);
    const to = Number(p.newPrice);
    if (!Number.isFinite(from) || from <= 0) continue;
    const delta = Math.abs(to - from);
    if (delta < BIG_MOVE_ABSOLUTE && delta / from < BIG_MOVE_RATIO) continue;
    bigMoves.push({ result, p, delta, ratio: delta / from, proposed: to });
  }
}
bigMoves.sort((a, b) => b.ratio - a.ratio);

const moving = results.filter(({ result }) => result.changed).slice(0, LIMIT);

/* ---------------------------------------------------------------- the report */

say(`# التسعير على الطبقات الأربع — ${APPLY ? "تطبيق" : "تشغيل جاف"}`);
say();
say(`شُغّل في ${new Date().toISOString()}.`);
say();
say(`- منتجات في الإنتاج: **${products.length}**`);
say(`- منتجات تحمل طبقات \`types\`: **${results.length}**`);
say(`- منتجات ستتحرك أسعارها: **${moving.length}**`);
say();

/* The cost breakdown the owner asked for first. */
const byKind = {};
let unknownTiers = 0;
let skippedTiers = 0;
for (const { result } of results) {
  for (const p of result.proposals) {
    if (p.kind === "unknown") unknownTiers += 1;
    if (p.skipped) skippedTiers += 1;
    const bucket = (byKind[p.kind] ??= { n: 0, cost: 0, price: 0, moving: 0, marginLow: Infinity, marginHigh: -Infinity });
    bucket.n += 1;
    bucket.cost += Number(p.cost) || 0;
    bucket.price += Number(p.oldPrice) || 0;
    if (p.changed) bucket.moving += 1;
    if (!p.skipped) {
      const margin = Number(p.oldPrice) - Number(p.cost);
      bucket.marginLow = Math.min(bucket.marginLow, margin);
      bucket.marginHigh = Math.max(bucket.marginHigh, margin);
    }
  }
}

say(`## 1. التكلفة والربح الحالي، حسب الطبقة`);
say();
say(`| الطبقة | عدد | مجموع التكلفة | مجموع السعر | الربح الحالي | أقل ربح | أعلى ربح | ستتحرك |`);
say(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
for (const [kind, b] of Object.entries(byKind).sort((a, b) => b[1].n - a[1].n)) {
  const low = Number.isFinite(b.marginLow) ? money(b.marginLow) : "—";
  const high = Number.isFinite(b.marginHigh) ? money(b.marginHigh) : "—";
  say(
    `| \`${kind}\` | ${b.n} | ${money(b.cost)} | ${money(b.price)} | ${money(b.price - b.cost)} | ${low} | ${high} | ${b.moving} |`,
  );
}
say();
say(`طبقات لم تُعرَف (لن تُمَس): **${unknownTiers}** · طبقات خارج النطاق: **${skippedTiers}**`);
say();

/* --------------------------------------------------------------- the changes */

/*
  The tiers this run cannot read, by name.

  The summary says 74 of them, carrying 8.8 million in cost at an eight per
  cent margin — the worst margins in the catalogue, and exactly the rows the
  owner's rules exist to fix. Left untouched, because a rule applied to the
  wrong tier is worse than no rule.

  But "74 unknown" is not an answer, it is a number. If they are all one
  spelling the classifier does not know, that is a one-line fix worth more
  than every price this run moves. So: the distinct names, with counts, so the
  next change is aimed rather than guessed.
*/
const unknownNames = new Map();
for (const { result } of results) {
  for (const p of result.proposals) {
    if (p.kind !== "unknown") continue;
    const label = `${p.id} | ${p.name}`.trim();
    const seen = unknownNames.get(label) ?? { n: 0, cost: 0, price: 0 };
    seen.n += 1;
    seen.cost += Number(p.cost) || 0;
    seen.price += Number(p.oldPrice) || 0;
    unknownNames.set(label, seen);
  }
}

say(`## 2. الطبقات التي لم يُعرَف نوعها`);
say();
if (!unknownNames.size) {
  say(`لا شيء. كل طبقة معروفة.`);
} else {
  say(`أسماء مختلفة: **${unknownNames.size}** · طبقات: **${unknownTiers}**`);
  say();
  say(`| المعرّف \\| الاسم | عدد | مجموع التكلفة | مجموع السعر | الربح |`);
  say(`| --- | --- | --- | --- | --- |`);
  for (const [label, b] of [...unknownNames.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 40)) {
    say(`| ${label || "(فارغ)"} | ${b.n} | ${money(b.cost)} | ${money(b.price)} | ${money(b.price - b.cost)} |`);
  }
  if (unknownNames.size > 40) say(`| … | ${unknownNames.size - 40} اسمًا آخر | | | |`);
}
say();

/*
  Costs that look like they belong to another tier.

  The owner on Super Smash Bros. Ultimate: «السعر كان للاونلاين، لكن التكلفه
  هي للاوفلاين». An online account costs MORE than the offline one, so a cost
  at or below the offline tier's is not this tier's own — and the rules now
  refuse to price from it.

  Refusing is only half the job. The COST is what is wrong, and only the owner
  can put it right, so every one is named here with both numbers side by side.
  Fix the cost and the price follows on the next run.
*/
const suspectCosts = [];
for (const { result } of results) {
  for (const p of result.proposals) {
    if (!p.skipped || !String(p.skipped).includes("تكلفة الأوفلاين")) continue;
    const base = result.proposals.find((row) => row.kind === "offline_base");
    suspectCosts.push({ result, p, baseCost: base ? base.cost : 0 });
  }
}

say(`## 3. تكاليف تبدو موضوعة في الطبقة الخطأ`);
say();
say(
  `حساب الأونلاين يكلّف أكثر من الأوفلاين. تكلفة أونلاين أقل من أو تساوي تكلفة الأوفلاين ليست تكلفة هذه الطبقة — لم تُسعَّر، وتحتاج إصلاح التكلفة لا السعر.`,
);
say();
if (!suspectCosts.length) {
  say(`لا شيء.`);
} else {
  say(`عددها: **${suspectCosts.length}**`);
  say();
  say(`| المنتج | الطبقة | تكلفة الأوفلاين | التكلفة المسجّلة هنا | السعر الحالي (لم يُمَس) |`);
  say(`| --- | --- | --- | --- | --- |`);
  for (const row of suspectCosts.slice(0, 40)) {
    say(
      `| ${label(row.result)} | \`${row.p.kind}\` | ${money(row.baseCost)} | **${money(row.p.cost)}** | ${money(row.p.oldPrice)} |`,
    );
  }
  if (suspectCosts.length > 40) say(`| … | ${suspectCosts.length - 40} أخرى | | | |`);
}
say();

say(`## 4. ما سيتغيّر`);
say();
if (!moving.length) {
  say(`لا شيء. كل الطبقات داخل قواعد المالك أصلًا.`);
} else {
  say(`| المنتج | الطبقة | اسم الطبقة | التكلفة | من | إلى | الربح بعد | السبب |`);
  say(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const { product, result } of moving) {
    for (const p of result.proposals) {
      if (!p.changed) continue;
      say(
        `| ${label(result)} | \`${p.kind}\` | ${tierName(p)} | ${money(p.cost)} | ${money(p.oldPrice)} | **${money(p.newPrice)}** | ${money(p.newPrice - p.cost)} | ${p.reason} |`,
      );
    }
  }
}
say();

/*
  The moves big enough that the owner should look at them by name.

  Not a rule violation — every one of these passes the gate. It is a flag on
  the COST that produced them: Super Smash Bros. Ultimate's online account is
  recorded at a cost of 1,750, and the 10–15k band therefore says its price
  should fall from 32,000 to 16,000. If that cost is right the rule is right.
  If it is a data fault, the rule is about to halve the price of one of the
  shop's best-known games on the strength of a typo.

  «الدقه اهم شي». So they are listed, with the cost that drove them, rather
  than being buried in a table of seventy rows.
*/
/*
  Computed before `moving`, above, because these rows are HELD rather than
  merely noted — `bigMoves` carries what each one WOULD have become.
*/
const outliers = bigMoves;

say(`## 5. حركات كبيرة — ستُكتب، وهذه تكاليفها`);
say();
say(
  `الشرط: تغيّر ${Math.round(BIG_MOVE_RATIO * 100)}% أو أكثر، أو ${money(BIG_MOVE_ABSOLUTE)} دينار أو أكثر.`,
);
say();
say(
  `كلها تطبيق مباشر لقواعدك: سقف 12,000 للألعاب القوية، وربح الأونلاين بين 10 و15 ألفًا، وزيادة الإضافات من فرق التكلفة، وأقل ربح 5,000 فوق تكلفة 2,000. حجم الحركة سبب لعرضها عليك، لا سبب لرفضها. التكاليف الكاملة تحتها لتراجعها — وإن كانت تكلفة أيٍّ منها خاطئة، قل لي وأُوقفه كما أوقفت Super Smash Bros. Ultimate.`,
);
say();
if (!outliers.length) {
  say(`لا شيء. كل الحركات صغيرة.`);
} else {
  say(`عددها: **${outliers.length}**`);
  say();
  say(`| المنتج | الطبقة | اسم الطبقة | التكلفة | السعر الآن | القاعدة تقترح | التغيّر |`);
  say(`| --- | --- | --- | --- | --- | --- | --- |`);
  for (const row of outliers.slice(0, 40)) {
    const direction = row.proposed > row.p.oldPrice ? "▲" : "▼";
    say(
      `| ${label(row.result)} | \`${row.p.kind}\` | ${tierName(row.p)} | ${money(row.p.cost)} | ${money(row.p.oldPrice)} | **${money(row.proposed)}** | ${direction} ${Math.round(row.ratio * 100)}% |`,
    );
  }
  if (outliers.length > 40) say(`| … | ${outliers.length - 40} أخرى | | | | |`);

  /*
    EVERY TIER OF EVERY LARGE-MOVE PRODUCT, SIDE BY SIDE.

    A move is held because its COST is in question, and a cost can only be
    judged against the other costs on the same product: an online account
    costs more than an offline one, and an add-ons edition more than a plain
    one. The row on its own says "1,750" and settles nothing; the product's
    four rows together say whether 1,750 belongs to this tier or to another.

    This is the table the owner needs to answer the question the hold asks,
    and it is bounded — a handful of products, at most six rows each.
  */
  say();
  say(`### تكاليف هذه المنتجات كاملة`);
  say();
  const seenProducts = new Set();
  for (const row of outliers.slice(0, 40)) {
    if (seenProducts.has(row.result.id)) continue;
    seenProducts.add(row.result.id);
    say();
    say(`**${label(row.result)}**`);
    say();
    say(`| الطبقة | اسمها | التكلفة | السعر | الربح الحالي |`);
    say(`| --- | --- | --- | --- | --- |`);
    for (const p of row.result.proposals) {
      say(
        `| \`${p.kind}\` | ${tierName(p)} | ${money(p.cost)} | ${money(p.oldPrice)} | ${money(Number(p.oldPrice) - Number(p.cost))} |`,
      );
    }
  }
}
say();

say(`## 5ب. تكلفة أكّدتَ أنها خاطئة — لم تُمَس`);
say();
if (!disputed.length) {
  say(`لا شيء.`);
} else {
  for (const row of disputed) {
    say(`**${label(row.result)}** — ${row.held} طبقة بقيت كما هي.`);
    say();
    say(`> ${row.why}`);
    say();
    say(`| الطبقة | اسمها | التكلفة المسجّلة | السعر (بقي) |`);
    say(`| --- | --- | --- | --- |`);
    for (const p of row.result.proposals) {
      say(`| \`${p.kind}\` | ${tierName(p)} | ${money(p.cost)} | ${money(p.oldPrice)} |`);
    }
    say();
    say(`صحّح التكلفة في لوحة الإدارة، وسيصحّح التشغيل التالي السعر من تلقائه.`);
  }
}
say();

/* The gate. Every proposal, before anything is written. */
const problems = [];
for (const { result } of moving) {
  for (const p of result.proposals) {
    if (!p.changed) continue;
    const problem = app.tierProblem(p, result);
    if (problem) problems.push(`${result.id} · ${p.kind}: ${problem}`);
  }
}
if (problems.length) {
  say(`## اقتراحات تكسر قواعد المالك — ${problems.length}`);
  say();
  for (const problem of problems.slice(0, 40)) say(`- ${problem}`);
  fail("اقتراح واحد على الأقل يكسر القواعد، وهذا خطأ في القواعد لا في الكتالوج");
}

const payload = {
  at: new Date().toISOString(),
  applied: APPLY,
  changes: moving.flatMap(({ result }) =>
    result.proposals
      .filter((p) => p.changed)
      .map((p) => ({
        id: result.id,
        title: result.title,
        tierIndex: p.index,
        tierId: p.id,
        kind: p.kind,
        cost: p.cost,
        from: p.oldPrice,
        to: p.newPrice,
        reason: p.reason,
      })),
  ),
};
if (args.json && args.json !== "true") writeFileSync(args.json, JSON.stringify(payload, null, 2));

/*
  The digest, repeated at the END.

  The cost table is the first thing in this report and the report is seventy
  rows long, so from a job log — which is read as a tail — the numbers that
  matter scroll off the top. Printing them again last costs nothing and is the
  difference between reading this run and guessing at it.
*/
const digest = () => {
  say();
  say(`## الخلاصة`);
  say();
  say(`| الطبقة | عدد | مجموع التكلفة | مجموع السعر الحالي | الربح الحالي | ستتحرك |`);
  say(`| --- | --- | --- | --- | --- | --- |`);
  for (const [kind, b] of Object.entries(byKind).sort((a, b) => b[1].n - a[1].n)) {
    say(
      `| \`${kind}\` | ${b.n} | ${money(b.cost)} | ${money(b.price)} | ${money(b.price - b.cost)} | ${b.moving} |`,
    );
  }
  say();
  const before = moving.reduce(
    (sum, { result }) =>
      sum + result.proposals.filter((p) => p.changed).reduce((s, p) => s + Number(p.oldPrice), 0),
    0,
  );
  const after = moving.reduce(
    (sum, { result }) =>
      sum + result.proposals.filter((p) => p.changed).reduce((s, p) => s + Number(p.newPrice), 0),
    0,
  );
  say(`- منتجات تتحرك: **${moving.length}** من ${results.length} منتجًا يحمل طبقات`);
  say(`- طبقات تتحرك: **${payload.changes.length}**`);
  say(`- مجموع أسعارها قبل: **${money(before)}** → بعد: **${money(after)}** (${after >= before ? "+" : ""}${money(after - before)})`);
  say(`- حركات كبيرة (ستُكتب، تكاليفها في القسم 5): **${outliers.length}**`);
  say(
    `- طبقات محجوزة لأن تكلفتها موضع شك مؤكَّد منك: **${disputed.reduce((n, d) => n + d.held, 0)}** في ${disputed.length} منتجًا`,
  );
  say(`- طبقات أونلاين بتكلفة تبدو للأوفلاين (لم تُسعَّر): **${suspectCosts.length}**`);
  say(`- طبقات لم تُعرَف ولن تُمَس: **${unknownTiers}**`);
  say(
    `- منتجات تعرض سعرًا وتحاسب بآخر اليوم: **${aheadReport.length + brokenMirrorReport.length}** (منها **${aheadReport.length}** يصلحها هذا التشغيل)`,
  );
};

if (!moving.length) {
  say("**لا شيء ليُكتب.**");
  digest();
  rmSync(outfile, { force: true });
  flush();
  process.exit(0);
}

/* Named before the rehearsal fills it, because the report below reads it. */
const brokenMirrorReport = [];
const aheadReport = [];
const syncReport = [];
const titleOf = (id) => {
  const hit = moving.find(({ result }) => result.id === id);
  return hit ? label(hit.result) : id;
};

/* ------------------------------------------------------------- the rehearsal */

/*
  Patch a copy of every product in memory and assert that the ONLY thing that
  differs is `price` on the exact tier rows named — before a byte reaches
  production. A tier's COST is what this must protect above all: it is the
  owner's supplier data and the whole margin rests on it.
*/
/*
  WHAT TO CHANGE, CARRIED AS IDENTITY AND NOT AS A POSITION.

  The tier indices come from the NORMALIZED catalogue — `getStore()` runs every
  record through `normalizeProductRecord`, which can build `types` out of
  `variants` when the stored document has none, and can reorder or drop rows.
  Those indices were then applied to the RAW `store:product:<id>` document read
  straight out of D1. When the two disagree the write is not wrong by a little:
  a raw document with no `types` array at all had `[].map(...)` written back
  over it as `types: []`, erasing every tier and every COST on the product.

  So a change carries what the tier WAS — its id, its name, its price and its
  cost, as `classifyTier` reads them — and the target row is found by matching
  all four in whatever document is about to be written. Exactly one match, or
  this run stops. An index cannot be checked; an identity can.
*/
const wanted = new Map();
for (const { result } of moving) {
  const changes = result.proposals
    .filter((p) => p.changed)
    .map((p) => ({
      index: p.index,
      kind: p.kind,
      id: String(p.id ?? ""),
      name: String(p.name ?? ""),
      cost: Number(p.cost),
      oldPrice: Number(p.oldPrice),
      newPrice: Number(p.newPrice),
    }));
  if (changes.length) wanted.set(result.id, changes);
}

/*
  AND THE PRODUCTS WHOSE TIER IS ALREADY RIGHT.

  A product whose offline tier already satisfies the rules never enters
  `moving`, so a headline disagreeing with it would never be looked at —
  ELDEN RING shows 22,000 and charges 20,000 with the rule perfectly happy at
  20,000. Those are added here with a no-op tier change, purely so the mirror
  logic below can see them and bring the headline to the number the till
  charges. No tier price moves.
*/
if (SYNC_MIRRORS) {
  for (const { result } of results) {
    if (wanted.has(result.id)) continue;
    const base = result.proposals.find((p) => p.kind === "offline_base" && !p.skipped);
    if (!base || !(Number(base.newPrice) > 0)) continue;
    wanted.set(result.id, [
      {
        index: base.index,
        kind: base.kind,
        id: String(base.id ?? ""),
        name: String(base.name ?? ""),
        cost: Number(base.cost),
        oldPrice: Number(base.oldPrice),
        newPrice: Number(base.newPrice),
      },
    ]);
  }
}

const byId = new Map(products.map((p) => [String(p["id"] ?? ""), p]));

/*
  THE OFFLINE PRICE IS STORED FOUR TIMES, AND THE PAGE READS THE COPY THIS
  SCRIPT WAS NOT WRITING.

  A game's headline — the hero, the sticky buy bar that follows the customer
  down the page, the closing call to action — comes from `readOffers`
  (src/lib/hub.ts:228), which reads `accountPrice` and falls back to `price`.
  Neither is derived from `types` at read time: `gameImportForm.ts:466-469`
  writes `form.variants = types; form.price = pricing.productPrice;` ONCE at
  import, where `productPrice` is the plain offline tier's price
  (`nintendoPricing.ts:559`), and nothing recomputes them afterwards.

  So a write to `types[i].price` alone would have put two different numbers on
  one screen: the hero reading 9,000 while the editions table lower down the
  same page, the category card, the buy sheet and the till all read 8,000. And
  where a rule RAISES a price, the customer would be shown the old lower one
  and charged the new higher one. A cart line with no `typeId` falls back to
  `product.price` at the till, so that customer would be charged 9,000 against
  an advertised 8,000.

  These are not four prices. They are one price written in four places, and
  moving one of them is the bug. So the mirrors move with the tier —

    · `price`        the fallback headline, and the till's own fallback
    · `accountPrice` the headline when it is present, preferred over `price`
    · `variants[j]`  the same list under its older name; every admin save
                     mirrors `variants = types`, and `resolveUnitPrice` reads
                     it whenever `types` is not an array

  — and only when they still AGREE with the tier they mirror. A product whose
  mirror already disagrees is already inconsistent, in a way this script did
  not cause and cannot read the owner's mind about; it is named in section 3b
  and left entirely alone rather than given a second disagreement on top of
  the first.
*/
const numOf = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number.parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Every copy of a price this product keeps, and what each should become.
 *
 * Returns `{ scalars, brokenMirrors }`. `scalars` is field → new value for the
 * product-level copies. `brokenMirrors` describes a copy that does not agree
 * with the tier it mirrors, which disqualifies the whole product.
 */
const mirrorsFor = (doc, changes) => {
  const scalars = new Map();
  const brokenMirrors = [];
  const alreadyAhead = [];
  const syncedMirrors = [];
  const offline = changes.find((c) => c.kind === "offline_base");
  if (!offline) return { scalars, brokenMirrors, alreadyAhead, syncedMirrors };

  for (const field of ["price", "accountPrice"]) {
    if (!(field in doc)) continue;
    const held = numOf(doc[field]);
    if (held === 0) continue; // never set; `readOffers` falls through to the next
    if (held === offline.oldPrice) {
      scalars.set(field, offline.newPrice);
      continue;
    }
    /*
      ALREADY WHERE THE RULE IS GOING.

      Measured on production, not assumed: on 40-odd of the moving products
      this field ALREADY holds, to the dinar, the price these rules compute.
      An earlier product-level repricing run wrote it and knew nothing about
      `types`, so the page has been advertising the new, cheaper number while
      the till went on charging the old one from the tier — Crash Bandicoot
      shows 8,000 and bills 8,500; Donkey Kong Bananza shows 12,000 and bills
      17,500.

      There is nothing to write to the field and nothing to decide: the tier
      is what is stale. Bringing `types` down to it ENDS an overcharge that is
      live right now, and the customer sees no change at all, because the
      number they were shown is the number they will finally be charged.

      It is also the strongest evidence these rules are right that this task
      has produced — they were derived from the owner's sentences, and they
      reproduce a price a different run computed, on forty products, exactly.
    */
    if (held === offline.newPrice) {
      alreadyAhead.push({ field, held, tier: offline.oldPrice });
      continue;
    }
    if (SYNC_MIRRORS) {
      /*
        Three numbers, and the rule's is the one with a reason behind it.
        Recorded before it is written so the report can show what each was.
      */
      syncedMirrors.push({ field, held, tier: offline.oldPrice, rule: offline.newPrice });
      scalars.set(field, offline.newPrice);
      continue;
    }
    brokenMirrors.push({ field, held, tier: offline.oldPrice, rule: offline.newPrice });
  }
  return { scalars, brokenMirrors, alreadyAhead, syncedMirrors };
};

/** The same four fields the rules saw, read off a raw row by the same function. */
const identity = (row) => {
  const t = app.classifyTier(row ?? {});
  return `${t.id}\u0000${t.name}\u0000${t.cost}\u0000${t.price}`;
};

/**
 * Where each change lands in THIS document's `types`, or a reason it cannot.
 *
 * Returns a Map of index → new price. Ambiguity is a refusal, not a guess: two
 * rows that are identical in id, name, cost and price are indistinguishable,
 * and picking one would be picking at random which price to move.
 */
const resolveTargets = (id, doc, changes) => {
  const types = Array.isArray(doc?.["types"]) ? doc["types"] : null;
  if (!types) fail(`${id}: المستند المخزَّن بلا مصفوفة \`types\` — لن أكتب فوقه`);
  const keys = types.map((row) => identity(row));
  const targets = new Map();
  for (const change of changes) {
    const want = `${change.id}\u0000${change.name}\u0000${change.cost}\u0000${change.oldPrice}`;
    const hits = [];
    for (let i = 0; i < keys.length; i += 1) if (keys[i] === want) hits.push(i);
    if (hits.length === 0) {
      fail(
        `${id}: لا توجد طبقة تطابق «${change.name || change.id}» بسعر ${money(change.oldPrice)} وتكلفة ${money(change.cost)} في المستند المخزَّن`,
      );
    }
    if (hits.length > 1) {
      fail(
        `${id}: ${hits.length} طبقات متطابقة تمامًا مع «${change.name || change.id}» — لا أعرف أيّها يُقصد`,
      );
    }
    if (targets.has(hits[0])) fail(`${id}: تغييران على الطبقة نفسها`);
    targets.set(hits[0], change.newPrice);
  }
  return targets;
};

/**
 * The same identity match against `variants`, the older name for the same list.
 *
 * A missing or unmatched row is NOT an error: `variants` is a mirror, and a
 * product that never had one simply keeps three copies of its price instead of
 * four. An AMBIGUOUS one would be, so a row moves only when exactly one
 * candidate carries that tier.
 */
const resolveVariants = (doc, changes) => {
  const rows = Array.isArray(doc?.["variants"]) ? doc["variants"] : null;
  const out = new Map();
  if (!rows) return out;
  const keys = rows.map((row) => identity(row));
  for (const change of changes) {
    const want = `${change.id}\u0000${change.name}\u0000${change.cost}\u0000${change.oldPrice}`;
    const hits = [];
    for (let i = 0; i < keys.length; i += 1) if (keys[i] === want) hits.push(i);
    if (hits.length === 1 && !out.has(hits[0])) out.set(hits[0], change.newPrice);
  }
  return out;
};

/**
 * A product with the wanted tier prices applied, and nothing else changed.
 *
 * `edit` is `{ targets, variants, scalars }` — the tier rows by index, the
 * `variants` rows by index, and the product-level copies of the same price.
 */
const patchProduct = (before, edit) => {
  const next = { ...before };
  next.types = (Array.isArray(before["types"]) ? before["types"] : []).map((tier, index) =>
    edit.targets.has(index) ? { ...tier, price: edit.targets.get(index) } : tier,
  );
  if (Array.isArray(before["variants"]) && edit.variants.size) {
    next.variants = before["variants"].map((row, index) =>
      edit.variants.has(index) ? { ...row, price: edit.variants.get(index) } : row,
    );
  }
  for (const [field, value] of edit.scalars) next[field] = value;
  return next;
};

/*
  THE RAW DOCUMENTS, READ BEFORE THE REHEARSAL AND NOT DURING THE WRITE.

  The rehearsal used to run against the normalized product while the write ran
  against the raw one, so the one document that could go wrong was the one
  never rehearsed. Every overlay row is fetched here so the rehearsal below
  sees exactly what will be written.
*/
const overlayCandidates = [...wanted.keys()].filter((id) => overlayIds.has(id));
const rawOverlay = new Map();
for (const id of overlayCandidates) {
  const stored = await readOverlayProduct(app, id);
  if (!stored) fail(`${id}: صف \`store:product:\` غير قابل للقراءة — لن أكتب فوقه`);
  rawOverlay.set(id, stored);
}

/*
  The rehearsal proper: patch a copy of the document that will actually be
  written and assert that the ONLY thing that differs is `price` on the exact
  rows named. A tier's COST is what this must protect above all — it is the
  owner's supplier data and the whole margin rests on it.

  The document is re-parsed from its own JSON first, so the comparison is
  against an independent copy rather than against the object the patch was
  spread from. Comparing a spread to its own source can only agree.
*/
const plan = new Map();
for (const [id, changes] of wanted) {
  const source = rawOverlay.get(id) ?? byId.get(id);
  if (!source) fail(`${id} ليس في الكتالوج`);

  /*
    A product whose headline already disagrees with the tier it mirrors is
    dropped here, before anything is planned for it. Its pricing is already
    inconsistent in a way this run did not cause; adding a second disagreement
    on top would be guessing which of two numbers the owner meant.
  */
  const { scalars, brokenMirrors, alreadyAhead, syncedMirrors } = mirrorsFor(source, changes);
  if (syncedMirrors.length) syncReport.push({ id, title: titleOf(id), syncedMirrors });
  if (brokenMirrors.length) {
    brokenMirrorReport.push({ id, title: titleOf(id), brokenMirrors });
    continue;
  }
  if (alreadyAhead.length) aheadReport.push({ id, title: titleOf(id), alreadyAhead });

  const targets = resolveTargets(id, source, changes);
  const edit = { targets, variants: resolveVariants(source, changes), scalars };
  plan.set(id, edit);

  const before = JSON.parse(JSON.stringify(source));
  const patched = patchProduct(source, edit);

  for (const key of new Set([...Object.keys(before), ...Object.keys(patched)])) {
    if (key === "types" || key === "variants") continue;
    if (scalars.has(key)) {
      if (Number(patched[key]) !== Number(scalars.get(key))) {
        fail(`البروفة: ${id}.${key} لم يُضبط على ${scalars.get(key)}`);
      }
      continue;
    }
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(patched[key] ?? null)) {
      fail(`البروفة: ${id}.${key} تغيّر، وهذا السكربت لا يملك تغييره`);
    }
  }

  /* `types` and `variants` are checked the same way, row by row and key by key. */
  for (const [list, moved] of [
    ["types", targets],
    ["variants", edit.variants],
  ]) {
    const beforeRows = Array.isArray(before[list]) ? before[list] : null;
    const afterRows = Array.isArray(patched[list]) ? patched[list] : null;
    if (list === "types") {
      if (!afterRows?.length) fail(`البروفة: ${id}.types صار فارغًا`);
    }
    if (!beforeRows || !afterRows) continue;
    if (beforeRows.length !== afterRows.length) fail(`البروفة: ${id}.${list} غيّر طوله`);
    for (let i = 0; i < beforeRows.length; i += 1) {
      for (const key of new Set([
        ...Object.keys(beforeRows[i] ?? {}),
        ...Object.keys(afterRows[i] ?? {}),
      ])) {
        if (key === "price" && moved.has(i)) continue;
        if (
          JSON.stringify(beforeRows[i]?.[key] ?? null) !== JSON.stringify(afterRows[i]?.[key] ?? null)
        ) {
          fail(`البروفة: ${id}.${list}[${i}].${key} تغيّر، وهذا السكربت لا يملك تغييره`);
        }
      }
      if (moved.has(i) && Number(afterRows[i].price) !== Number(moved.get(i))) {
        fail(`البروفة: ${id}.${list}[${i}].price لم يُضبط`);
      }
    }
  }

  /* Every change asked for landed somewhere. */
  if (targets.size !== changes.length) {
    fail(`البروفة: ${id} — ${changes.length} تغييرًا مطلوبًا و${targets.size} فقط وجدت مكانها`);
  }
}

/* The products dropped for a broken mirror are no longer this run's to write. */
for (const row of brokenMirrorReport) wanted.delete(row.id);

/* --------------------------------------------- 3b. copies of the same price */

/*
  Reported for both a dry run and an apply, because it is the number that
  decides whether the write is safe at all.
*/
say(`## 3ب. نسخ السعر الأخرى`);
say();
say(
  `سعر الأوفلاين العادي مخزَّن أكثر من مرة: في \`types\`، وفي \`variants\`، وفي \`price\` و\`accountPrice\` على المنتج نفسه — وواجهة صفحة اللعبة تقرأ \`accountPrice\` ثم \`price\`، لا \`types\`. لذلك تتحرك كلها معًا، وإلا عُرض رقم وحُوسب رقم آخر.`,
);
say();
let mirrorScalars = 0;
let mirrorVariantRows = 0;
for (const edit of plan.values()) {
  mirrorScalars += edit.scalars.size;
  mirrorVariantRows += edit.variants.size;
}
say(`- حقول \`price\`/\`accountPrice\` ستتحرك مع طبقتها: **${mirrorScalars}**`);
say(`- صفوف \`variants\` ستتحرك مع طبقتها: **${mirrorVariantRows}**`);
say(
  `- منتجات **استُبعدت** لأن نسختها لا تطابق طبقتها ولا تطابق ما تقترحه القاعدة: **${brokenMirrorReport.length}**`,
);
say(
  `- منتجات السعر المعروض فيها **يسبق** طبقاتها (يُعرض سعر ويُحاسَب آخر، الآن): **${aheadReport.length}**`,
);
say(`- منتجات سُوّيت نسخها على جواب القاعدة (\`--sync-mirrors\`): **${syncReport.length}**`);
say();

if (aheadReport.length) {
  say(`### السعر المعروض يسبق الطبقة — فرق يُحصّل اليوم`);
  say();
  say(
    `هذه المنتجات يحمل حقلها \`price\`/\`accountPrice\` **نفس الرقم الذي تحسبه هذه القاعدة بالضبط**، بينما بقيت \`types\` على السعر القديم. تشغيل تسعير سابق حرّك سعر المنتج ولم يكن يعرف بالطبقات. النتيجة أن صفحة اللعبة تعرض السعر الجديد الأرخص، والسلة تحاسب بالسعر القديم الأغلى.`,
  );
  say();
  say(`| المنتج | يُعرض | يُحاسَب اليوم | الفرق على كل عملية بيع |`);
  say(`| --- | --- | --- | --- |`);
  let overcharge = 0;
  for (const row of aheadReport.slice(0, 60)) {
    const m = row.alreadyAhead[0];
    const gap = Number(m.tier) - Number(m.held);
    if (gap > 0) overcharge += gap;
    say(
      `| ${row.title} | ${money(m.held)} | ${money(m.tier)} | ${gap > 0 ? `+${money(gap)}` : money(gap)} |`,
    );
  }
  if (aheadReport.length > 60) say(`| … | ${aheadReport.length - 60} أخرى | | |`);
  say();
  say(
    `مجموع الفرق الذي يُحصَّل فوق السعر المعلن: **${money(overcharge)}** دينار على كل مجموعة مبيعات واحدة من هذه المنتجات. هذا التشغيل ينهيه: تنزل \`types\` إلى الرقم المعروض نفسه، فلا يرى الزبون أي تغيّر في السعر، ويدفع ما رآه.`,
  );
  say();
}

if (syncReport.length) {
  say(`### أرقام سُوّيت على جواب القاعدة`);
  say();
  say(
    `كانت هذه تعرض رقمًا وتحاسب بآخر، ولا أحدهما ما تقترحه القاعدة. الآن كل النسخ — \`price\` و\`accountPrice\` و\`types\` و\`variants\` — على جواب القاعدة نفسه. راجعها: أي واحدة منها يمكن إرجاعها بكلمة.`,
  );
  say();
  say(`| المنتج | الحقل | كان يُعرض | كان يُحاسَب | صار |`);
  say(`| --- | --- | --- | --- | --- |`);
  for (const row of syncReport.slice(0, 60)) {
    for (const m of row.syncedMirrors) {
      say(`| ${row.title} | \`${m.field}\` | ${money(m.held)} | ${money(m.tier)} | **${money(m.rule)}** |`);
    }
  }
  if (syncReport.length > 60) say(`| … | ${syncReport.length - 60} أخرى | | | |`);
  say();
}

if (brokenMirrorReport.length) {
  say(`### رقمان لا يتفقان، ولا أحدهما ما تقترحه القاعدة`);
  say();
  say(`| المنتج | الحقل | يُعرض | يُحاسَب | القاعدة تقترح |`);
  say(`| --- | --- | --- | --- | --- |`);
  for (const row of brokenMirrorReport.slice(0, 40)) {
    for (const m of row.brokenMirrors) {
      say(
        `| ${row.title} | \`${m.field}\` | ${money(m.held)} | ${money(m.tier)} | ${money(m.rule)} |`,
      );
    }
  }
  say();
  say(
    `هذه أيضًا تعرض رقمًا وتحاسب بآخر اليوم، لكن الرقم المعروض ليس ما تقترحه القاعدة أيضًا — فثلاثة أرقام مختلفة، ولا يمكنني أن أختار بينها نيابةً عنك. تُركت كما هي بالكامل. قل لي أيّها الصحيح لكل واحد وأضبطه في التشغيل التالي.`,
  );
} else {
  say(`كل النسخ متطابقة مع طبقاتها.`);
}
say();

if (!APPLY) {
  say(`**تشغيل جاف. لم يُكتب شيء.**`);
  const frozen = moving.filter(({ result }) => overlayIds.has(result.id));
  say();
  say(
    `منتجات ستتحرك ولها صف \`store:product:<id>\` منفصل (يجب أن يُكتب هو لا الكتل): **${frozen.length}**`,
  );
  say(`البروفة تمّت على المستند الذي سيُكتب فعلًا، ونجحت.`);
  digest();
  rmSync(outfile, { force: true });
  flush();
  process.exit(0);
}

/* ------------------------------------------------------------------ the write */

/*
  Two paths, because the catalogue has two homes.

  A product with a `store:product:<id>` row is served from THAT row —
  `loadStore` lets the granular document overwrite the chunked one. Writing
  only the chunks for such a product produces a write that reports success and
  changes nothing a shopper will ever see. So each product is written where it
  actually lives.
*/
/*
  From `plan`, not from `wanted` as it was before the rehearsal: a product
  dropped for a broken mirror must not appear in either list.
*/
const overlayWrites = [...plan.keys()].filter((id) => overlayIds.has(id));
const chunkWrites = [...plan.keys()].filter((id) => !overlayIds.has(id));

say(`## 6. الكتابة`);
say();
say(`- عبر صفوف \`store:product:<id>\`: **${overlayWrites.length}**`);
say(`- عبر كتل الكتالوج: **${chunkWrites.length}**`);
say();

for (const id of overlayWrites) {
  await writeOverlayProduct(app, id, patchProduct(rawOverlay.get(id), plan.get(id)));
}

/*
  THE REVISION, AFTER AN OVERLAY WRITE.

  `updateStore` writes `store_rev` inside its own transaction, so the chunk
  path already moves the catalogue version that `/api/data` serves as
  `catalogVersion` and as its ETag. The bare INSERT above moves nothing, so a
  browser and the edge would go on serving the OLD price from a cache keyed on
  a version that did not change — a write that succeeded and that nobody sees.
*/
await bumpAfterOverlayWrites(app, overlayWrites.length);
let written = 0;
if (chunkWrites.length) {
  const chunkSet = new Set(chunkWrites);
  await app.updateStore((current) => {
    /*
      Reset, because `updateStore` re-reads and re-applies on a revision
      conflict, up to four times. A counter that only incremented would report
      four times the products it changed.
    */
    written = 0;
    const list = Array.isArray(current?.products) ? current.products : [];
    const next = list.map((item) => {
      const id = String(item?.id ?? "");
      if (!chunkSet.has(id)) return item;
      written += 1;
      /*
        RESOLVED AGAINST THE DOCUMENT IN FRONT OF US, EVERY TIME.

        `updateStore` re-reads the catalogue and re-runs this mutator on a
        revision conflict, up to four times, so `current` here is not
        necessarily the document the plan's indices were computed from at the
        start of the run. Reusing those indices is the same fault that was
        just fixed on the overlay path, only harder to see because it needs a
        concurrent write to show itself.

        Matching by identity again costs nothing and cannot land on the wrong
        row. If the tier is no longer there — someone else moved that price
        while this ran — `resolveTargets` stops the run rather than guessing.
      */
      const changes = wanted.get(id);
      const fresh = mirrorsFor(item, changes);
      const planned = plan.get(id).scalars;
      if (fresh.scalars.size !== planned.size) {
        fail(`${id}: نسخ السعر تغيّرت أثناء التشغيل — لن أكتب فوقها`);
      }
      for (const [field, value] of planned) {
        if (fresh.scalars.get(field) !== value) {
          fail(`${id}.${field} تغيّر أثناء التشغيل — لن أكتب فوقه`);
        }
      }
      return patchProduct(item, {
        targets: resolveTargets(id, item, changes),
        variants: resolveVariants(item, changes),
        scalars: fresh.scalars,
      });
    });
    return { ...current, products: next };
  });
}

/* ------------------------------------------------------------ the read-back */

/*
  From D1, not from this process's memory. `updateStore` seeds `storeCache`
  with the document it just wrote and `getStore()` serves it for up to a
  minute — so a read-back without this invalidation confirms a write that may
  never have reached the database. A verification that can only agree with
  itself is not a verification.
*/
app.invalidateStoreCache();
const afterStore = await app.getStore();
const afterList = Array.isArray(afterStore?.products) ? afterStore.products : [];
const afterById = new Map(afterList.map((p) => [String(p["id"] ?? ""), p]));

/*
  VERIFIED BY IDENTITY, NOT BY POSITION.

  `plan`'s indices point into the document each product was WRITTEN to — the
  raw `store:product:<id>` row for an overlay product — while this reads the
  normalized catalogue, where the same tier can sit somewhere else. Checking
  index i here would compare two different rows and call it agreement.

  So each change is confirmed the way it was aimed: find the row that still
  carries this tier's id, name and cost, and require its price to be the new
  one. Then require every OTHER row to be untouched, by comparing the full
  before/after multiset of rows — which catches a price moved on a tier this
  run never named, the failure a per-change check cannot see.
*/
const faults = [];
let verified = 0;
const rowKey = (row) => {
  const t = app.classifyTier(row ?? {});
  return `${t.id} ${t.name} ${t.cost}`;
};
for (const [id, changes] of wanted) {
  const was = byId.get(id);
  const now = afterById.get(id);
  if (!now) {
    faults.push(`${id} اختفى من الكتالوج بعد الكتابة`);
    continue;
  }

  const scalars = plan.get(id)?.scalars ?? new Map();
  for (const key of new Set([...Object.keys(was ?? {}), ...Object.keys(now)])) {
    if (key === "types" || key === "variants") continue;
    if (scalars.has(key)) {
      /*
        The page's headline, read back from D1. Verified by VALUE and not
        merely allowed to differ: this is the number the customer sees, and
        the whole reason the tier write alone was unsafe.
      */
      if (Number(now[key]) !== Number(scalars.get(key))) {
        faults.push(`${id}.${key} = ${now[key]}، والمتوقع ${scalars.get(key)}`);
      }
      continue;
    }
    if (JSON.stringify(was?.[key] ?? null) !== JSON.stringify(now[key] ?? null)) {
      faults.push(`${id}.${key} تغيّر، وهذا السكربت لا يملك تغييره`);
    }
  }

  const wasTiers = Array.isArray(was?.["types"]) ? was["types"] : [];
  const nowTiers = Array.isArray(now["types"]) ? now["types"] : [];
  if (wasTiers.length !== nowTiers.length) {
    faults.push(`${id}.types غيّر طوله (${wasTiers.length} → ${nowTiers.length})`);
    continue;
  }
  let clean = true;

  /* 1. Every change this run asked for is on the row it named. */
  for (const change of changes) {
    const want = `${change.id} ${change.name} ${change.cost}`;
    const hits = nowTiers.filter((row) => rowKey(row) === want);
    if (hits.length !== 1) {
      faults.push(
        `${id}: «${change.name || change.id}» ظهرت ${hits.length} مرة بعد الكتابة بدل مرة واحدة`,
      );
      clean = false;
      continue;
    }
    if (Number(app.classifyTier(hits[0]).price) !== change.newPrice) {
      faults.push(
        `${id}: «${change.name || change.id}» سعرها ${hits[0]?.price}، والمتوقع ${change.newPrice}`,
      );
      clean = false;
    }
  }

  /* 2. And nothing else moved. The whole row, cost included, before vs after. */
  const expected = new Map();
  for (const row of wasTiers) {
    const t = app.classifyTier(row);
    const change = changes.find(
      (c) => c.id === t.id && c.name === t.name && c.cost === t.cost && c.oldPrice === t.price,
    );
    const key = `${t.id} ${t.name} ${t.cost} ${change ? change.newPrice : t.price}`;
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  for (const row of nowTiers) {
    const t = app.classifyTier(row);
    const key = `${t.id} ${t.name} ${t.cost} ${t.price}`;
    const left = expected.get(key) ?? 0;
    if (left <= 0) {
      faults.push(
        `${id}: طبقة «${t.name || t.id}» بتكلفة ${money(t.cost)} وسعر ${money(t.price)} لم يطلبها هذا التشغيل`,
      );
      clean = false;
      continue;
    }
    expected.set(key, left - 1);
  }
  for (const [key, left] of expected) {
    if (left > 0) {
      const [tid, tname, tcost, tprice] = key.split(" ");
      faults.push(
        `${id}: طبقة «${tname || tid}» بتكلفة ${money(tcost)} كان يجب أن تكون بسعر ${money(tprice)} واختفت`,
      );
      clean = false;
    }
  }

  if (clean) verified += 1;
}

/*
  The last word: run the rules again over what the database actually holds.

  Field-by-field equality says the write landed on the products this run knew
  about. It does not say the catalogue now satisfies the rules — a product
  missed entirely would never appear in `wanted` and would sail through the
  loop above. The rules are idempotent by test, so a correct apply leaves
  nothing to do; anything still moving is a product this run failed to move.
*/
const settled = afterList
  .filter((product) => Array.isArray(product?.["types"]) && product["types"].length > 0)
  /*
    Only the products THIS RUN was scoped to.

    The gate re-runs the rules over the catalogue and fails if anything still
    wants to move. Run against everything that is right; run with `--only` or
    `--limit` it was certain to fail, because every product the flags excluded
    still wants to move and always would. So `--apply --limit 5` would write
    five products correctly, verify them, and then exit 1 — reporting a
    successful write as a failure, which is the one thing a script that
    touches prices must never do.
  */
  .filter((product) => wanted.has(String(product["id"] ?? "")))
  .map((product) =>
    app.repriceTiers({
      id: String(product["id"] ?? ""),
      title: String(product["title"] || product["titleEn"] || ""),
      kind: String(product["kind"] ?? ""),
      schemaId: String(product["schemaId"] ?? product["schema_id"] ?? ""),
      types: product["types"],
      /* The same signal the first pass used, or the read-back disagrees. */
      isSwitch2: app.isNintendoSwitch2Product(product),
    }),
  )
  .filter((result) => result.changed);

rmSync(outfile, { force: true });

say(`- كُتب عبر الكتل: ${written} · عبر الصفوف المنفصلة: ${overlayWrites.length}`);
say(`- تحقق بالقراءة من D1: ${verified} من ${wanted.size}`);
say();

if (faults.length) {
  say(`## أخطاء في التحقق — ${faults.length}`);
  say();
  for (const fault of faults.slice(0, 40)) say(`- ${fault}`);
  fail("الكتابة لم تُطابق ما طُلب");
}

if (settled.length) {
  say(`## ما زال خارج القواعد بعد التطبيق — ${settled.length}`);
  say();
  say(`(من بين ${wanted.size} منتجًا كتبها هذا التشغيل)`);
  say();
  for (const result of settled.slice(0, 40)) {
    const which = result.proposals.filter((p) => p.changed).map((p) => p.kind).join(", ");
    say(`- ${result.id} · ${result.title} · ${which}`);
  }
  fail("منتجات لم يحركها هذا التشغيل — القواعد لم تستقر");
}

say(`**تم. كل طبقة تحركت، وتحققت من D1، والقواعد مستقرة.**`);
digest();
flush();
