#!/usr/bin/env node
/**
 * What the shop paid for what it sells.
 *
 * «لكن قبل كل شيء أعطني التكلفة للمنتجات مثلا مائة منتج بسعر كذا أو خمسمائة
 * منتج بسعر وهكذا حتى نحسب على أساسها وحسب القوة على تخفيض.»
 *
 * The owner wants to reprice the catalogue against cost, and asked for the
 * cost picture first. This prints it and writes nothing: every distinct cost
 * with how many products carry it, the bands, and — because a repricing rule
 * is only as good as what it would actually move — how many products the
 * proposed rules would leave alone, raise, or lower.
 *
 * Read-only. No supplier name, no member, no credential: a product's id,
 * title, cost and price, which is what a pricing decision is made of.
 *
 * Usage: node scripts/cost-report.mjs [--json cost-report.json] [--full]
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

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};

/*
  The database id is committed in wrangler.jsonc — it is where wrangler itself
  reads it to deploy — so there is no secret to add for a value already in the
  tree. Matched by pattern because the file is JSONC, which JSON.parse refuses.
*/
if (!process.env["D1_DATABASE_ID"] && !process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  try {
    const config = readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    const found = config.match(/"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/);
    if (found) process.env["D1_DATABASE_ID"] = found[1];
  } catch {
    /* Reported below as an unreachable database. */
  }
}
if (!process.env["D1_DATABASE_ID"] && process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  process.env["D1_DATABASE_ID"] = process.env["CLOUDFLARE_D1_DATABASE_ID"];
}

const outfile = path.resolve(".catalogue-bundle.mjs");
let products = [];
let readError = null;
try {
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
  const reach = await app.d1All("SELECT count(*) AS n FROM store_kv");
  if (!reach.length) throw new Error("D1 unreachable — refusing to report on nothing");
  const store = await app.getStore();
  products = Array.isArray(store?.products) ? store.products : [];
} catch (error) {
  readError = String(error).split("\n")[0];
} finally {
  rmSync(outfile, { force: true });
}

if (readError || !products.length) {
  say("# التكلفة — تعذّرت القراءة");
  say();
  say(`\`${readError ?? "no products"}\``);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
  }
  process.exit(1);
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/*
  A game, in the sense the owner means.

  The repricing is about games with a supplier cost. A console, a gift card, an
  accessory and a bundle are priced by different rules and must not be swept
  into a margin histogram with them — the same list `wheel-pool.server` refuses
  for the same reason.
*/
const NOT_A_GAME = new Set([
  "hardware",
  "device",
  "accessory",
  "amiibo",
  "collectible",
  "bundle",
  "gift_card",
  "digital_code",
  "used",
]);

const rows = [];
for (const product of products) {
  const kind = String(product["kind"] ?? "")
    .trim()
    .toLowerCase();
  const price = num(product["price"]) ?? num(product["basePrice"]);
  const cost = num(product["cost"]) ?? num(product["costPrice"]) ?? num(product["baseCost"]);
  rows.push({
    id: String(product["id"] ?? ""),
    title: String(product["title"] || product["titleEn"] || ""),
    kind,
    isGame: !NOT_A_GAME.has(kind),
    platform: String(product["platform"] ?? ""),
    price,
    cost,
    sales: num(product["sales"]) ?? 0,
    metacritic: num(product["metacriticRating"]),
    hidden: product["isHidden"] === true || String(product["status"] ?? "") === "hidden",
  });
}

const games = rows.filter((row) => row.isGame);
const priced = games.filter((row) => row.cost !== null && row.cost > 0);
const noCost = games.filter((row) => row.cost === null || row.cost <= 0);

say("# تكلفة المنتجات");
say();
say(
  `${rows.length.toLocaleString("en-US")} منتج في الكتالوج · ` +
    `${games.length.toLocaleString("en-US")} منها لعبة · ` +
    `${priced.length.toLocaleString("en-US")} لعبة تحمل تكلفة · ` +
    `${noCost.length.toLocaleString("en-US")} بلا تكلفة مسجّلة.`,
);
say();

/* ---- Every distinct cost, and how many carry it. ---- */
const byCost = new Map();
for (const row of priced) byCost.set(row.cost, (byCost.get(row.cost) ?? 0) + 1);
const distinct = [...byCost.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);

say("## كل تكلفة، وكم منتجًا يحملها");
say();
say("| التكلفة (د.ع) | عدد المنتجات | النسبة |");
say("|---:|---:|---:|");
for (const [cost, count] of distinct) {
  say(
    `| ${cost.toLocaleString("en-US")} | ${count.toLocaleString("en-US")} | ` +
      `${((count / priced.length) * 100).toFixed(1)}% |`,
  );
}
say();
say(`إجمالي التكاليف المختلفة: **${distinct.length}**.`);
say();

/* ---- The bands the owner's rules are written in. ---- */
const BANDS = [
  { label: "0 – 1,000", min: 0, max: 1_000 },
  { label: "1,001 – 1,500", min: 1_001, max: 1_500 },
  { label: "1,501 – 2,000", min: 1_501, max: 2_000 },
  { label: "2,001 – 3,000", min: 2_001, max: 3_000 },
  { label: "3,001 – 5,000", min: 3_001, max: 5_000 },
  { label: "5,001 فما فوق", min: 5_001, max: Number.POSITIVE_INFINITY },
];
const bandOf = (cost) => BANDS.find((band) => cost >= band.min && cost <= band.max) ?? null;

say("## التكلفة بالفئات");
say();
say("| فئة التكلفة | عدد الألعاب | أقل سعر حالي | وسيط السعر | أعلى سعر حالي |");
say("|---|---:|---:|---:|---:|");
for (const band of BANDS) {
  const inBand = priced.filter((row) => bandOf(row.cost) === band);
  if (!inBand.length) {
    say(`| ${band.label} | 0 | — | — | — |`);
    continue;
  }
  const prices = inBand
    .map((row) => row.price)
    .filter((p) => p !== null)
    .sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  say(
    `| ${band.label} | ${inBand.length.toLocaleString("en-US")} | ` +
      `${prices.length ? prices[0].toLocaleString("en-US") : "—"} | ` +
      `${median !== null ? median.toLocaleString("en-US") : "—"} | ` +
      `${prices.length ? prices[prices.length - 1].toLocaleString("en-US") : "—"} |`,
  );
}
say();

/* ---- Current selling prices, so the repricing starts from what is there. ---- */
const priceCounts = new Map();
for (const row of priced) {
  if (row.price === null) continue;
  priceCounts.set(row.price, (priceCounts.get(row.price) ?? 0) + 1);
}
const priceRows = [...priceCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
say("## الأسعار الحالية لتلك الألعاب");
say();
say("| السعر الحالي (د.ع) | عدد الألعاب |");
say("|---:|---:|");
for (const [price, count] of priceRows.slice(0, 40)) {
  say(`| ${price.toLocaleString("en-US")} | ${count.toLocaleString("en-US")} |`);
}
if (priceRows.length > 40) say(`| … و${priceRows.length - 40} سعرًا آخر | |`);
say();

/* ---- What the owner's two rules would actually move. ---- */
const CHEAP_FLOOR = 5_000;
const CHEAP_CEILING = 12_000;
const MIN_MARGIN = 5_000;

const cheap = priced.filter((row) => row.cost <= 2_000);
const dear = priced.filter((row) => row.cost > 2_000);

const belowFloor = cheap.filter((row) => row.price !== null && row.price < CHEAP_FLOOR);
const aboveCeiling = cheap.filter((row) => row.price !== null && row.price > CHEAP_CEILING);
const thinMargin = dear.filter((row) => row.price !== null && row.price - row.cost < MIN_MARGIN);

say("## ماذا ستحرّك القاعدتان");
say();
say(
  `**التكلفة حتى 2,000** — ${cheap.length.toLocaleString("en-US")} لعبة. ` +
    `القاعدة: السعر من ${CHEAP_FLOOR.toLocaleString("en-US")} فما فوق، وسقف ` +
    `${CHEAP_CEILING.toLocaleString("en-US")} للأقوى.`,
);
say();
say(`- تحت الأرضية الآن (سترتفع): **${belowFloor.length.toLocaleString("en-US")}**`);
say(`- فوق السقف الآن (ستنخفض): **${aboveCeiling.length.toLocaleString("en-US")}**`);
say(
  `- داخل النطاق أصلاً: **${(cheap.length - belowFloor.length - aboveCeiling.length).toLocaleString("en-US")}**`,
);
say();
say(
  `**التكلفة 2,001 فما فوق** — ${dear.length.toLocaleString("en-US")} لعبة. ` +
    `القاعدة: أقل ربح ${MIN_MARGIN.toLocaleString("en-US")}، أي السعر ≥ التكلفة + ` +
    `${MIN_MARGIN.toLocaleString("en-US")}.`,
);
say();
say(`- ربحها الآن أقل من ${MIN_MARGIN.toLocaleString("en-US")} (سترتفع): **${thinMargin.length}**`);
say();

if (dear.length && dear.length <= 60) {
  say("### الألعاب التي تكلفتها فوق 2,000");
  say();
  say("| اللعبة | التكلفة | السعر الآن | الربح الآن | أقل سعر بالقاعدة |");
  say("|---|---:|---:|---:|---:|");
  for (const row of [...dear].sort((a, b) => b.cost - a.cost)) {
    const margin = row.price === null ? null : row.price - row.cost;
    say(
      `| ${row.title.slice(0, 48)} | ${row.cost.toLocaleString("en-US")} | ` +
        `${row.price === null ? "—" : row.price.toLocaleString("en-US")} | ` +
        `${margin === null ? "—" : margin.toLocaleString("en-US")} | ` +
        `${(row.cost + MIN_MARGIN).toLocaleString("en-US")} |`,
    );
  }
  say();
}

/* ---- The strength signals a repricing would lean on. ---- */
const withSales = priced.filter((row) => row.sales > 0).length;
const withMetacritic = priced.filter((row) => row.metacritic !== null).length;
say("## ما يمكن الاعتماد عليه لقياس «قوة» اللعبة");
say();
say(`- لعبة سُجّلت لها مبيعات: **${withSales.toLocaleString("en-US")}**`);
say(`- لعبة تحمل تقييم Metacritic: **${withMetacritic.toLocaleString("en-US")}**`);
say(`- لعبة بلا تكلفة مسجّلة إطلاقًا: **${noCost.length.toLocaleString("en-US")}**`);
say();

say(
  "SUMMARY " +
    JSON.stringify({
      products: rows.length,
      games: games.length,
      gamesWithCost: priced.length,
      gamesWithoutCost: noCost.length,
      distinctCosts: distinct.length,
      topCosts: distinct.slice(0, 12).map(([cost, count]) => ({ cost, count })),
      cheapCount: cheap.length,
      dearCount: dear.length,
      belowFloor: belowFloor.length,
      aboveCeiling: aboveCeiling.length,
      thinMargin: thinMargin.length,
      withSales,
      withMetacritic,
    }),
);

if (args.json && args.json !== "true") {
  writeFileSync(
    args.json,
    JSON.stringify(
      {
        distinct: distinct.map(([cost, count]) => ({ cost, count })),
        prices: priceRows.map(([price, count]) => ({ price, count })),
        games: priced.map((row) => ({
          id: row.id,
          title: row.title,
          cost: row.cost,
          price: row.price,
          platform: row.platform,
          sales: row.sales,
          metacritic: row.metacritic,
          hidden: row.hidden,
        })),
      },
      null,
      2,
    ),
  );
}
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
}
