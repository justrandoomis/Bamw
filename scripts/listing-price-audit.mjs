#!/usr/bin/env node
/**
 * Which price does a customer see on a card, and is it the cheapest one?
 *
 * The owner, looking at /category/nintendo_games:
 *
 *   «اجعل السعر الارخص يعرض افتراضيا في البطاقه ( حساب اوفلاين عادي )
 *    المشكله يعرض سعر حساب الاونلاين»
 *
 * READ-ONLY. It writes nothing to the catalogue and never will: it imports the
 * same `listingPricing` the card calls and the same `classifyTiers` the pricing
 * rules use, asks each of them about every game, and counts the answers. A
 * report that reasoned about the rule instead of running it would be a second
 * copy of the rule agreeing with itself.
 *
 *   node scripts/listing-price-audit.mjs
 *   node scripts/listing-price-audit.mjs --limit=40      # a sample
 *   node scripts/listing-price-audit.mjs --only=prd_x    # one product
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
const ONLY = args.only && args.only !== "true" ? String(args.only) : null;
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
  writeFileSync("listing-price-audit.md", `${lines.join("\n")}\n`);
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

const outfile = path.resolve(".listing-price-audit-bundle.mjs");
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

const money = (n) => Number(n || 0).toLocaleString("en-US");
const label = (title) => {
  const t = String(title ?? "").trim();
  return t.length <= 44 ? t : `${t.slice(0, 26)}…${t.slice(-14)}`;
};

const reachable = await app.d1All("SELECT count(*) AS n FROM store_kv");
if (!reachable.length) fail("قاعدة البيانات غير متاحة — لن أكتب تقريرًا عن لا شيء");

const store = await app.getStore();
const products = Array.isArray(store?.products) ? store.products : [];
if (products.length < 100) fail(`الكتالوج أعاد ${products.length} منتجًا فقط — هذا ليس الكتالوج`);

const KIND_AR = {
  offline_base: "أوفلاين عادي",
  offline_extras: "أوفلاين مع الإضافات",
  online_base: "أونلاين عادي",
  online_extras: "أونلاين مع الإضافات",
  unknown: "غير مصنّف",
};

let games = products.filter((p) => {
  const kind = String(p?.kind ?? "").toLowerCase();
  const schema = String(p?.schemaId ?? "").toLowerCase();
  return !["hardware", "device", "accessory", "amiibo", "collectible", "gift_card", "used"].includes(
    kind,
  ) && schema !== "gift_card";
});
if (ONLY) {
  games = games.filter((p) => String(p.id) === ONLY || String(p.slug ?? "") === ONLY);
  if (!games.length) fail(`لا يوجد منتج بالمعرّف «${ONLY}»`);
}

/*
  A product's own price fields, printed in full for `--only`.

  A first run measured only games carrying more than one price and found the
  card leading with the right one every single time — which means the games the
  owner was looking at are somewhere else entirely. So the report has to be able
  to show ONE product completely, rather than leaving the question open.
*/
const dumpOne = (product) => {
  const tiers = app.classifyTiers(app.pricingTypeRows(product));
  const { unitPrice } = app.listingPricing(product);
  say(`## ${String(product.titleEn || product.title || product.id)}`);
  say();
  say(`- المعرّف: \`${product.id}\``);
  say(`- ما تعرضه البطاقة: **${money(unitPrice)}**`);
  say(`- \`price\`: ${money(product.price)}`);
  say(`- \`accountPrice\`: ${money(product.accountPrice)}`);
  say(`- \`accountOnlineEnabled\`: ${String(product.accountOnlineEnabled)}`);
  say(`- \`accountOnlinePrice\`: ${money(product.accountOnlinePrice)}`);
  say(`- \`cost\`: ${money(product.cost)}`);
  say(`- \`kind\`: ${String(product.kind ?? "")} · \`schemaId\`: ${String(product.schemaId ?? "")}`);
  say();
  if (!tiers.length) {
    say("لا توجد طبقات أسعار على هذا المنتج — سعر واحد فقط.");
  } else {
    say("| الطبقة | الاسم | السعر | التكلفة |");
    say("| --- | --- | ---: | ---: |");
    for (const t of tiers) {
      say(`| ${KIND_AR[t.kind] ?? t.kind} | ${String(t.name ?? "")} | ${money(t.price)} | ${money(t.cost)} |`);
    }
  }
  say();
};

if (ONLY) {
  say("# سعر منتج واحد، كاملًا");
  say();
  for (const product of games) dumpOne(product);
  rmSync(outfile, { force: true });
  flush();
  process.exit(0);
}

/*
  Games carrying exactly one price.

  1,530 of these came in as name-and-price-only rows, so this is most of the
  catalogue — and a single price cannot be "the wrong one of several". What it
  CAN be is an online account's price standing alone with nothing cheaper beside
  it, which looks identical on a shelf. Counted separately, and the online field
  is checked for each.
*/
const singles = [];
for (const product of games) {
  const priced = app.classifyTiers(app.pricingTypeRows(product)).filter((t) => Number(t.price) > 0);
  if (priced.length >= 2) continue;
  const { unitPrice } = app.listingPricing(product);
  const shown = Number(unitPrice) || 0;
  if (shown <= 0) continue;
  const onlinePrice = Number(product.accountOnlinePrice) || 0;
  singles.push({
    id: String(product.id),
    title: String(product.titleEn || product.english_name || product.title || product.id),
    shown,
    cost: Number(product.cost) || 0,
    onlineEnabled: Boolean(product.accountOnlineEnabled),
    matchesOnline: onlinePrice > 0 && shown === onlinePrice,
  });
}

const rows = [];
for (const product of games) {
  const tiers = app.classifyTiers(app.pricingTypeRows(product));
  const priced = tiers.filter((t) => Number(t.price) > 0);
  if (priced.length < 2) continue; // One price cannot lead with the wrong one.

  const { unitPrice } = app.listingPricing(product);
  const shown = Number(unitPrice) || 0;
  const cheapest = priced.reduce((min, t) => (Number(t.price) < Number(min.price) ? t : min));
  const offline = priced.find((t) => t.kind === "offline_base");
  const leading = priced.find((t) => Number(t.price) === shown);

  rows.push({
    id: String(product.id),
    title: String(product.titleEn || product.english_name || product.title || product.id),
    shown,
    leadKind: leading ? leading.kind : "unknown",
    cheapest: Number(cheapest.price),
    cheapestKind: cheapest.kind,
    offline: offline ? Number(offline.price) : null,
    tiers: priced.map((t) => `${KIND_AR[t.kind] ?? t.kind} ${money(t.price)}`),
  });
}

say("# أي سعر تعرضه البطاقة");
say();
say(`- منتجات في الكتالوج: **${products.length}**`);
say(`- منها ألعاب: **${games.length}**`);
say(`- ألعاب تحمل أكثر من سعر واحد: **${rows.length}**`);
say();

const leadingOnline = rows.filter((r) => r.leadKind === "online_base" || r.leadKind === "online_extras");
const notCheapest = rows.filter((r) => r.shown > r.cheapest);
const notOffline = rows.filter((r) => r.offline !== null && r.shown !== r.offline);

say(`- **البطاقة تعرض سعر الأونلاين: ${leadingOnline.length}**`);
say(`- البطاقة تعرض سعرًا أغلى من الأرخص: **${notCheapest.length}**`);
say(`- البطاقة لا تعرض سعر الأوفلاين العادي رغم وجوده: **${notOffline.length}**`);
say();

const byKind = new Map();
for (const r of rows) byKind.set(r.leadKind, (byKind.get(r.leadKind) ?? 0) + 1);
say("| الطبقة التي تتصدّر البطاقة | عدد الألعاب |");
say("| --- | ---: |");
for (const [kind, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
  say(`| ${KIND_AR[kind] ?? kind} | ${n} |`);
}
say();

const sample = notCheapest
  .slice()
  .sort((a, b) => b.shown - b.cheapest - (a.shown - a.cheapest))
  .slice(0, Number.isFinite(LIMIT) ? LIMIT : 40);
if (sample.length) {
  say(`## أكبر ${sample.length} فرق بين المعروض والأرخص`);
  say();
  say("| اللعبة | المعروض | الأرخص | الفرق | الطبقات |");
  say("| --- | ---: | ---: | ---: | --- |");
  for (const r of sample) {
    say(
      `| ${label(r.title)} | ${money(r.shown)} | ${money(r.cheapest)} | ${money(r.shown - r.cheapest)} | ${r.tiers.join(" · ")} |`,
    );
  }
  say();
}

/* --------------------------------------------------- the single-price games */

const BANDS = [
  [0, 5_000],
  [5_001, 8_000],
  [8_001, 12_000],
  [12_001, 20_000],
  [20_001, 30_000],
  [30_001, 50_000],
  [50_001, Infinity],
];
say("## الألعاب ذات السعر الواحد");
say();
say(`- عددها: **${singles.length}**`);
say(`- منها سعرها يساوي سعر حساب الأونلاين المسجّل: **${singles.filter((s) => s.matchesOnline).length}**`);
say(`- منها بلا تكلفة مسجّلة: **${singles.filter((s) => s.cost <= 0).length}**`);
say();
say("| النطاق | عدد الألعاب |");
say("| --- | ---: |");
for (const [low, high] of BANDS) {
  const n = singles.filter((s) => s.shown >= low && s.shown <= high).length;
  say(`| ${money(low)}${high === Infinity ? " فما فوق" : ` – ${money(high)}`} | ${n} |`);
}
say();

const dearest = singles
  .slice()
  .sort((a, b) => b.shown - a.shown)
  .slice(0, Number.isFinite(LIMIT) ? LIMIT : 40);
say(`## أغلى ${dearest.length} لعبة بسعر واحد`);
say();
say("| اللعبة | السعر | التكلفة | الربح |");
say("| --- | ---: | ---: | ---: |");
for (const r of dearest) {
  say(
    `| ${label(r.title)} | ${money(r.shown)} | ${r.cost > 0 ? money(r.cost) : "—"} | ${r.cost > 0 ? money(r.shown - r.cost) : "—"} |`,
  );
}
say();

rmSync(outfile, { force: true });

say("## الخلاصة");
say();
say(`- ألعاب متعددة الأسعار: **${rows.length}**`);
say(`- تعرض سعر أونلاين على البطاقة: **${leadingOnline.length}**`);
say(`- تعرض سعرًا أغلى من أرخص طبقة: **${notCheapest.length}**`);
say(`- تعرض غير سعر الأوفلاين العادي: **${notOffline.length}**`);
say(`- ألعاب بسعر واحد: **${singles.length}**`);
say(`- منها فوق 20,000: **${singles.filter((s) => s.shown > 20_000).length}**`);
say(`- منها فوق 12,000: **${singles.filter((s) => s.shown > 12_000).length}**`);
flush();
