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
let LIMIT = Infinity;
if (args.limit && args.limit !== "true") {
  LIMIT = Number(args.limit);
  if (!Number.isInteger(LIMIT) || LIMIT <= 0) {
    console.error(`--limit=${args.limit} ليس عددًا صحيحًا موجبًا`);
    process.exit(1);
  }
}
/* Large moves are HELD unless this run says otherwise — see section 5. */
const INCLUDE_BIG_MOVES = args["include-big-moves"] === "true";

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
const overlayRows = await app.d1All(
  "SELECT key FROM store_kv WHERE key LIKE 'store:product:%'",
);
const overlayIds = new Set(
  overlayRows.map((row) => String(row.key).slice("store:product:".length)).filter(Boolean),
);

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
  });
  results.push({ product, result });
}

/* ----------------------------------------------------- the big-move hold */

/*
  A MOVE THIS LARGE IS A QUESTION ABOUT THE COST, AND IT IS NOT MINE TO ANSWER.

  Section 5 used to list these and then write them anyway — «كلها تمر من
  البوابة» — which is a report pretending to be a gate. The owner's own words
  on Super Smash Bros. Ultimate settled what they actually are: «السعر في
  الsuper smash bros ultimate كان للاونلاين ، لكن التكلفه هي للاوفلاين». Its
  online tier carries a cost of 1,750. The price of 32,000 is CORRECT; the
  cost is not, and the rules were about to halve one of the shop's
  best-known games on the strength of it, with every guard passing.

  The ordering guard in `tierRepricing` cannot see it, and that is not a
  fault in the guard: 1,750 is ABOVE Smash's own offline cost, so the two
  numbers are in the right order and still the wrong numbers. No arithmetic
  on a wrong cost produces a right price.

  So the threshold that already exists for review — 35%, or 15,000 dinars —
  becomes the threshold for holding. The other 145 moves are written; these
  are listed with their costs, and the owner decides. Nothing is invented:
  the rule is unchanged, the held rows keep the price they have, and
  `--include-big-moves` writes them once a cost has been checked.
*/
const BIG_MOVE_RATIO = 0.35;
const BIG_MOVE_ABSOLUTE = 15_000;
const BIG_MOVE_HOLD = `حركة كبيرة — راجع التكلفة أولًا (${Math.round(BIG_MOVE_RATIO * 100)}% أو ${money(BIG_MOVE_ABSOLUTE)})`;
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
    if (INCLUDE_BIG_MOVES) continue;
    /*
      Held in place: the proposal keeps the price the product already has, so
      every downstream reader — section 4, the gate, the write, the digest —
      sees a row that does not move, with no second list to keep in step.
    */
    p.newPrice = p.oldPrice;
    p.changed = false;
    p.skipped = BIG_MOVE_HOLD;
  }
}
for (const { result } of results) {
  result.changed = result.proposals.some((p) => p.changed);
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
  say(`| المنتج | الطبقة | التكلفة | من | إلى | الربح بعد | السبب |`);
  say(`| --- | --- | --- | --- | --- | --- | --- |`);
  for (const { product, result } of moving) {
    for (const p of result.proposals) {
      if (!p.changed) continue;
      say(
        `| ${label(result)} | \`${p.kind}\` | ${money(p.cost)} | ${money(p.oldPrice)} | **${money(p.newPrice)}** | ${money(p.newPrice - p.cost)} | ${p.reason} |`,
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

say(
  INCLUDE_BIG_MOVES
    ? `## 5. حركات كبيرة — ستُكتب (\`--include-big-moves\`)`
    : `## 5. حركات كبيرة — محجوزة، لم تُكتب`,
);
say();
say(
  `الشرط: تغيّر ${Math.round(BIG_MOVE_RATIO * 100)}% أو أكثر، أو ${money(BIG_MOVE_ABSOLUTE)} دينار أو أكثر.`,
);
say();
say(
  INCLUDE_BIG_MOVES
    ? `هذا التشغيل يكتبها بناءً على \`--include-big-moves\`.`
    : `القاعدة تمرّ عليها، لكن حركة بهذا الحجم سؤال عن **التكلفة** لا عن السعر: سعر Super Smash Bros. Ultimate صحيح والتكلفة المسجّلة (1,750) هي تكلفة الأوفلاين. لذلك تبقى هذه الأسعار كما هي حتى تُراجَع تكلفتها، وبقية الحركات تُكتب. بعد إصلاح التكلفة أعد التشغيل، أو استخدم \`--include-big-moves\` لاعتمادها كما هي.`,
);
say();
if (!outliers.length) {
  say(`لا شيء. كل الحركات صغيرة.`);
} else {
  say(`عددها: **${outliers.length}**`);
  say();
  say(`| المنتج | الطبقة | التكلفة | السعر الآن | القاعدة تقترح | التغيّر | الحالة |`);
  say(`| --- | --- | --- | --- | --- | --- | --- |`);
  for (const row of outliers.slice(0, 40)) {
    const direction = row.proposed > row.p.oldPrice ? "▲" : "▼";
    say(
      `| ${label(row.result)} | \`${row.p.kind}\` | ${money(row.p.cost)} | ${money(row.p.oldPrice)} | **${money(row.proposed)}** | ${direction} ${Math.round(row.ratio * 100)}% | ${INCLUDE_BIG_MOVES ? "ستُكتب" : "محجوزة"} |`,
    );
  }
  if (outliers.length > 40) say(`| … | ${outliers.length - 40} أخرى | | | | |`);
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
  say(
    `- حركات كبيرة ${INCLUDE_BIG_MOVES ? "ستُكتب" : "**محجوزة** حتى تُراجع تكلفتها"}: **${outliers.length}**`,
  );
  say(`- طبقات أونلاين بتكلفة تبدو للأوفلاين (لم تُسعَّر): **${suspectCosts.length}**`);
  say(`- طبقات لم تُعرَف ولن تُمَس: **${unknownTiers}**`);
};

if (!APPLY) {
  say(`**تشغيل جاف. لم يُكتب شيء.**`);
  const frozen = moving.filter(({ result }) => overlayIds.has(result.id));
  say();
  say(
    `منتجات ستتحرك ولها صف \`store:product:<id>\` منفصل (يجب أن يُكتب هو لا الكتل): **${frozen.length}**`,
  );
  digest();
  rmSync(outfile, { force: true });
  flush();
  process.exit(0);
}

if (!moving.length) {
  say("**لا شيء ليُكتب.**");
  rmSync(outfile, { force: true });
  flush();
  process.exit(0);
}

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
      id: String(p.id ?? ""),
      name: String(p.name ?? ""),
      cost: Number(p.cost),
      oldPrice: Number(p.oldPrice),
      newPrice: Number(p.newPrice),
    }));
  if (changes.length) wanted.set(result.id, changes);
}

const byId = new Map(products.map((p) => [String(p["id"] ?? ""), p]));

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

/** A product with the wanted tier prices applied, and nothing else changed. */
const patchProduct = (before, targets) => {
  const types = (Array.isArray(before["types"]) ? before["types"] : []).map((tier, index) =>
    targets.has(index) ? { ...tier, price: targets.get(index) } : tier,
  );
  return { ...before, types };
};

/*
  THE RAW DOCUMENTS, READ BEFORE THE REHEARSAL AND NOT DURING THE WRITE.

  The rehearsal used to run against the normalized product while the write ran
  against the raw one, so the one document that could go wrong was the one
  never rehearsed. Every overlay row is fetched here so the rehearsal below
  sees exactly what will be written.
*/
const overlayWrites = [...wanted.keys()].filter((id) => overlayIds.has(id));
const chunkWrites = [...wanted.keys()].filter((id) => !overlayIds.has(id));
const rawOverlay = new Map();
for (const id of overlayWrites) {
  const rows = await app.d1All("SELECT value FROM store_kv WHERE key = ?", `store:product:${id}`);
  let stored = null;
  try {
    stored = rows?.[0]?.value ? JSON.parse(String(rows[0].value)) : null;
  } catch {
    stored = null;
  }
  if (!stored || String(stored.id ?? "") !== id) {
    fail(`${id}: صف \`store:product:\` غير قابل للقراءة — لن أكتب فوقه`);
  }
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
  const targets = resolveTargets(id, source, changes);
  plan.set(id, targets);

  const before = JSON.parse(JSON.stringify(source));
  const patched = patchProduct(source, targets);

  for (const key of new Set([...Object.keys(before), ...Object.keys(patched)])) {
    if (key === "types") continue;
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(patched[key] ?? null)) {
      fail(`البروفة: ${id}.${key} تغيّر، وهذا السكربت لا يملك تغييره`);
    }
  }

  const beforeTiers = Array.isArray(before["types"]) ? before["types"] : [];
  const afterTiers = patched["types"];
  if (beforeTiers.length !== afterTiers.length) fail(`البروفة: ${id}.types غيّر طوله`);
  if (!afterTiers.length) fail(`البروفة: ${id}.types صار فارغًا`);
  for (let i = 0; i < beforeTiers.length; i += 1) {
    for (const key of new Set([
      ...Object.keys(beforeTiers[i] ?? {}),
      ...Object.keys(afterTiers[i] ?? {}),
    ])) {
      if (key === "price" && targets.has(i)) continue;
      if (
        JSON.stringify(beforeTiers[i]?.[key] ?? null) !== JSON.stringify(afterTiers[i]?.[key] ?? null)
      ) {
        fail(`البروفة: ${id}.types[${i}].${key} تغيّر، وهذا السكربت لا يملك تغييره`);
      }
    }
    if (targets.has(i) && Number(afterTiers[i].price) !== Number(targets.get(i))) {
      fail(`البروفة: ${id}.types[${i}].price لم يُضبط`);
    }
  }
  /* Every change asked for landed somewhere. */
  if (targets.size !== changes.length) {
    fail(`البروفة: ${id} — ${changes.length} تغييرًا مطلوبًا و${targets.size} فقط وجدت مكانها`);
  }
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
say(`## 6. الكتابة`);
say();
say(`- عبر صفوف \`store:product:<id>\`: **${overlayWrites.length}**`);
say(`- عبر كتل الكتالوج: **${chunkWrites.length}**`);
say();

for (const id of overlayWrites) {
  const patched = patchProduct(rawOverlay.get(id), plan.get(id));
  await app.d1Run(
    "INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)" +
      " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    `store:product:${id}`,
    JSON.stringify(patched),
    new Date().toISOString(),
  );
}

/*
  THE REVISION, AFTER AN OVERLAY WRITE.

  `updateStore` writes `store_rev` inside its own transaction, so the chunk
  path already moves the catalogue version that `/api/data` serves as
  `catalogVersion` and as its ETag. The bare INSERT above moves nothing, so a
  browser and the edge would go on serving the OLD price from a cache keyed on
  a version that did not change — a write that succeeded and that nobody sees.
*/
if (overlayWrites.length) await app.bumpCatalogVersion();
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
      return patchProduct(item, plan.get(id));
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

  for (const key of new Set([...Object.keys(was ?? {}), ...Object.keys(now)])) {
    if (key === "types") continue;
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
