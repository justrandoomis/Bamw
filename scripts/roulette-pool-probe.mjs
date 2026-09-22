#!/usr/bin/env node
/**
 * Where does the roulette's price line actually belong?
 *
 * The owner wrote the two bands as «حتى 5,000» and «6,000 فما فوق», and then
 * added the sentence that makes this script necessary:
 *
 *   «صمم الحدود وفق الأسعار الفعلية في Bamw، مع الحفاظ على المقصود:
 *    cheap = حتى 5000، higher-price = أعلى من 5000.»
 *
 * The intent is fixed — one cheap band, one dearer one — but WHERE the line
 * falls is a fact about this shop's catalogue, and this shop's catalogue moved
 * today: the repricing put ordinary Switch games at 7,000–9,000. A line at
 * 5,000 might now leave the cheap half of the roulette empty, which would mean
 * four of the seven outcomes redistributing their share every single spin.
 *
 * So this measures rather than assumes. READ-ONLY: it writes nothing to the
 * catalogue, the flags table or anything else, and it never will.
 *
 * It prints, for the live pool:
 *   - how many games are eligible at all, and why the rest were dropped;
 *   - the price distribution in deciles, so the shape is visible;
 *   - how a boundary at each candidate value would split the pool;
 *   - the bucket population at the current default, and the odds that implies.
 *
 * The decision stays the owner's. This gives him the numbers to make it with.
 */
import { build } from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  writeFileSync("roulette-pool-probe.md", `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
  }
};
const fail = (message) => {
  say();
  say(`## توقف: ${message}`);
  flush();
  process.exit(1);
};
const money = (n) => Number(n || 0).toLocaleString("en-US");

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

const outfile = path.resolve(".roulette-pool-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/roulette-entry.ts"],
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

say(`# أين يجب أن يقع خط السعر في الروليت؟`);
say();

const store = await app.getStore();
const products = Array.isArray(store?.products) ? store.products : [];
if (products.length < 100) fail(`الكتالوج أعاد ${products.length} منتجًا فقط — هذه ليست قراءة صحيحة`);

const flags = await app.readGameFlags().catch(() => new Map());
const { games, skipped } = app.buildPool(products, flags, app.DEFAULT_PRICE_BOUNDARY);

say(`- منتجات في الكتالوج: **${products.length}**`);
say(`- مؤهلة كجائزة: **${games.length}**`);
say();
say(`## ما استُبعد، ولماذا`);
say();
say(`| السبب | العدد |`);
say(`| --- | ---: |`);
for (const [reason, count] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) {
  say(`| \`${reason}\` | ${count} |`);
}
say();

/* ------------------------------------------------------------------ *
 * THE SHAPE OF THE PRICES. Deciles rather than a mean: a catalogue with
 * a thousand games at 7,000 and two at 400,000 has a mean nobody would
 * put a boundary at.
 * ------------------------------------------------------------------ */
const prices = games.map((g) => g.price).sort((a, b) => a - b);
say(`## توزيع الأسعار`);
say();
if (prices.length) {
  say(`| النسبة | السعر |`);
  say(`| --- | ---: |`);
  for (const q of [0, 10, 25, 50, 75, 90, 100]) {
    const index = Math.min(prices.length - 1, Math.floor((q / 100) * (prices.length - 1)));
    say(`| ${q}% | ${money(prices[index])} |`);
  }
}
say();

/* ------------------------------------------------------------------ *
 * AND WHAT EACH CANDIDATE LINE WOULD DO. The owner's own two numbers
 * first, then the shop's new ladder, so the choice is between values
 * that mean something rather than round ones.
 * ------------------------------------------------------------------ */
say(`## أثر كل خط محتمل`);
say();
say(`| الخط | رخيصة | أعلى سعرًا |`);
say(`| --- | ---: | ---: |`);
for (const boundary of [5_000, 6_000, 7_000, 8_000, 9_000, 10_000, 12_000, 15_000, 20_000]) {
  const cheap = prices.filter((p) => p <= boundary).length;
  say(`| ${money(boundary)} | ${cheap} | ${prices.length - cheap} |`);
}
say();

/* ------------------------------------------------------------------ *
 * THE BUCKETS THEMSELVES, at the default line, with the odds they
 * produce. An empty bucket is not a failure — `resolveOdds` hands its
 * share to the ones that can pay — but it IS something the owner should
 * see before he decides, because a bucket nobody can win is a prize tier
 * that exists only on the screen.
 * ------------------------------------------------------------------ */
const population = app.populationOf(games);
say(`## الفئات عند الخط الحالي (${money(app.DEFAULT_PRICE_BOUNDARY)})`);
say();
say(`| الفئة | ألعاب مؤهلة |`);
say(`| --- | ---: |`);
for (const [key, count] of Object.entries(population)) {
  say(`| \`${key}\` | ${count} |`);
}
say();

const empty = Object.entries(population).filter(([, n]) => n === 0);
if (empty.length) {
  say(
    `**${empty.length} من الفئات الست فارغة** (\`${empty.map(([k]) => k).join("`, `")}\`) — ` +
      `حصتها تُوزَّع على الفئات القادرة على الدفع في كل دورة.`,
  );
  say();
}

/* Popularity is the other axis, and it has no data yet by design. */
const tiers = { low: 0, medium: 0, high: 0 };
for (const game of games) tiers[game.popularity] += 1;
say(`## الشهرة`);
say();
say(`| التصنيف | ألعاب |`);
say(`| --- | ---: |`);
for (const [tier, count] of Object.entries(tiers)) say(`| ${tier} | ${count} |`);
say();
if (tiers.medium === 0 && tiers.high === 0) {
  say(
    "لم يُصنَّف أي لعبة بعد، فكلها «غير مشهورة» — وهو الافتراض الآمن المقصود. " +
      "حتى يصنّف المالك بعض الألعاب، تبقى أربع فئات من الست فارغة وتذهب حصتها إلى فئتَي «غير مشهورة».",
  );
  say();
}

/*
  LAST IN THE LOG, deliberately: a job log is read as a tail, so the numbers
  that decide the boundary have to be the final lines.
*/
say(`## الخلاصة`);
say();
say(`- ألعاب مؤهلة كجائزة: **${games.length}**`);
const atDefault = prices.filter((p) => p <= app.DEFAULT_PRICE_BOUNDARY).length;
say(
  `- عند الخط الحالي ${money(app.DEFAULT_PRICE_BOUNDARY)}: **${atDefault}** رخيصة · ` +
    `**${prices.length - atDefault}** أعلى سعرًا`,
);
say(`- الوسيط (50%): **${money(prices[Math.floor(prices.length / 2)] ?? 0)}**`);
say(`- فئات فارغة الآن: **${empty.length}** من 6`);

rmSync(outfile, { force: true });
flush();
