#!/usr/bin/env node
/**
 * What the owner's own pricing rules say every game should cost once the yuan
 * costs 280 dinars instead of 220. READ ONLY — a proposal, not a repricing.
 *
 * The owner:
 *
 *   «قم برفع الاسعار الالعاب اغلبها لان التكلفه صعدت من ٢٢٠ لليوان الى ٢٨٠
 *    لليوان … خصوصا الالعاب الغاليه … وخصوصا نسخه الاونلاين … والصعود كم
 *    النسبه بما ان اليوان صعد بنسبه 25% هل نزيد بهذه النسبه ام ماهو الانسب ؟»
 *
 * The supplier sells in yuan, so every stored cost moves by the same factor,
 * 280 / 220 = 1.2727. What the SELLING price should do is a different question,
 * and the shop already has an answer to it: the four tier rules in
 * `tierRepricing.ts` — the cheap offline band with its 12,000 ceiling, profit
 * of at least 5,000 above a 2,000 cost, the add-ons increase from the cost
 * gap, and online profit between 10,000 and 15,000. This re-runs exactly
 * those functions on the moved costs, so the proposal is the owner's policy
 * applied to the new rate, not a percentage picked from the air.
 *
 * Beside it, the two simple answers the owner asked about, so the choice can
 * be made on numbers: every price +25%, and every price + its cost increase.
 *
 * WRITES NOTHING. Its only statements are the SELECTs `getStore` makes. The
 * per-game table it uploads carries cost beside price — the same shape as
 * `cost-report.mjs`'s artifact — because a pricing decision is made of both.
 *
 * Usage: node scripts/yuan-reprice-proposal.mjs [--old 220] [--new 280]
 */

import { build } from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { amount, englishTitle, offlineOf, onlineOf } from "./lib/offline-cover.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);
const OLD_RATE = Number(args.old ?? 220);
const NEW_RATE = Number(args.new ?? 280);
const FACTOR = NEW_RATE / OLD_RATE;
const OUT_JSON = "yuan-reprice.json";
const OUT_REPORT = "yuan-reprice.md";

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
  writeFileSync(OUT_REPORT, `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, { flag: "a" });
  }
};
const fail = (message) => {
  say();
  say(`## توقف: ${message}`);
  flush();
  process.exit(1);
};
const money = (n) => Number(n || 0).toLocaleString("en-US");

if (!(OLD_RATE > 0 && NEW_RATE > 0)) fail(`سعر صرف غير صالح: ${args.old} → ${args.new}`);

if (!process.env["D1_DATABASE_ID"] && process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  process.env["D1_DATABASE_ID"] = process.env["CLOUDFLARE_D1_DATABASE_ID"];
}
if (!process.env["D1_DATABASE_ID"]) {
  try {
    const config = readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    const found = config.match(/"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/);
    if (found) process.env["D1_DATABASE_ID"] = found[1];
  } catch {
    /* Reported by the guard below. */
  }
}
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) fail(`مفقود ${key}`);
}

const outfile = path.resolve(".yuan-reprice-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/yuan-reprice-entry.ts"],
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
      /* The same stub the pricing reports use: no request handler runs here. */
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
rmSync(outfile, { force: true });

const store = await app.getStore();
const products = (Array.isArray(store?.products) ? store.products : []).filter(
  (p) => p && typeof p === "object" && p.id && !p._deleted,
);
if (products.length < 100) fail(`الكتالوج أعاد ${products.length} منتجًا فقط — هذه ليست قراءة صحيحة`);

/** Costs at the new rate, rounded to the dinar. Prices are left exactly as they are. */
const moveCost = (cost) => (amount(cost) > 0 ? Math.round(amount(cost) * FACTOR) : cost);
const withMovedCosts = (rows) =>
  Array.isArray(rows) ? rows.map((row) => (row && typeof row === "object" ? { ...row, cost: moveCost(row.cost) } : row)) : rows;

const round500Up = (n) => Math.ceil(n / 500) * 500;

const rows = [];
for (const product of products) {
  if (!app.isGameProduct(product)) continue;
  const slug = String(app.getProductSlug(product) || product.id);
  const isSwitch2 = app.isNintendoSwitch2Product(product);
  const typeRows = app.pricingTypeRows(product);
  const tiers = app.classifyTiers(typeRows);
  const input = {
    id: String(product.id),
    title: englishTitle(product),
    ...(product.kind !== undefined ? { kind: product.kind } : {}),
    ...(product.schemaId !== undefined ? { schemaId: product.schemaId } : {}),
    isSwitch2,
  };
  const now = app.repriceTiers({ ...input, types: typeRows });
  const moved = app.repriceTiers({ ...input, types: withMovedCosts(typeRows) });

  /*
    A product with no tier rows is priced by its own fields: the offline
    account is `price`, its cost the product-level `cost`. The same rule
    module prices it through `repriceOne`, which is what the tier rules call
    for a plain offline row.
  */
  const productCost = amount(product.cost) || amount(product.costPrice) || amount(product.baseCost);
  let single = null;
  if (!tiers.length && productCost > 0 && amount(product.price) > 0) {
    const base = { ...input, cost: productCost, price: amount(product.price) };
    const before = app.repriceOne(base);
    const after = app.repriceOne({ ...base, cost: moveCost(productCost) });
    single = {
      cost: productCost,
      newCost: moveCost(productCost),
      price: amount(product.price),
      rulesNow: before.skipped ? null : Number(before.newPrice),
      rulesAtNewCost: after.skipped ? null : Number(after.newPrice),
      skipped: after.skipped || before.skipped || null,
    };
  }

  const demand = app.demandTierFor(slug);
  rows.push({
    id: String(product.id),
    slug,
    title: englishTitle(product),
    platform: isSwitch2 ? "Switch 2" : "Switch",
    publisher: String(product.publisher ?? "").trim() || null,
    demand: demand.tier,
    demandDefaulted: demand.defaulted,
    hidden: app.isProductHidden(product),
    sales: amount(product.sales) || 0,
    offline: offlineOf(app, product)?.price ?? null,
    online: onlineOf(app, product) || null,
    single,
    tiers: tiers.map((tier, index) => {
      const a = now.proposals[index];
      const b = moved.proposals[index];
      return {
        kind: tier.kind,
        name: tier.name,
        price: tier.price,
        cost: tier.cost,
        newCost: moveCost(tier.cost),
        rulesNow: a && !a.skipped ? a.newPrice : null,
        rulesAtNewCost: b && !b.skipped ? b.newPrice : null,
        skipped: (b && b.skipped) || null,
      };
    }),
  });
}

/* --------------------------------------------------------------- summary */

const visible = rows.filter((r) => !r.hidden);
const tierRows = visible.flatMap((r) =>
  r.tiers.map((t) => ({ ...t, game: r })).concat(
    r.single
      ? [{ kind: "offline_base", name: "(السعر الأساسي)", price: r.single.price, cost: r.single.cost, newCost: r.single.newCost, rulesNow: r.single.rulesNow, rulesAtNewCost: r.single.rulesAtNewCost, skipped: r.single.skipped, game: r }]
      : [],
  ),
);
const priced = tierRows.filter((t) => t.price > 0 && t.cost > 0 && !t.skipped && t.rulesAtNewCost);

say(`# اقتراح الأسعار بعد صعود اليوان من ${OLD_RATE} إلى ${NEW_RATE} — قراءة فقط`);
say();
say(`- معامل التكلفة: ×${FACTOR.toFixed(4)} (+${((FACTOR - 1) * 100).toFixed(1)}%)`);
say(`- ألعاب في الكتالوج: ${rows.length} · ظاهرة: ${visible.length}`);
say(`- أسعار (طبقات) لها تكلفة وسعر وتفهمها القواعد: ${priced.length}`);
say();

const KINDS = ["offline_base", "offline_extras", "online_base", "online_extras"];
const KIND_AR = {
  offline_base: "أوفلاين عادي",
  offline_extras: "أوفلاين مع الإضافات",
  online_base: "أونلاين عادي",
  online_extras: "أونلاين مع الإضافات",
};
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

say(`| الطبقة | العدد | متوسط السعر الحالي | متوسط التكلفة القديمة → الجديدة | خاسرة بالسعر الحالي | ربح أقل من 5,000 | القواعد ترفع | متوسط الرفع بالقواعد | +25% يرفع بمتوسط |`);
say(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
for (const kind of KINDS) {
  const set = priced.filter((t) => t.kind === kind);
  if (!set.length) continue;
  const avg = (f) => Math.round(set.reduce((s, t) => s + f(t), 0) / set.length);
  const losing = set.filter((t) => t.price < t.newCost).length;
  const thin = set.filter((t) => t.price - t.newCost < 5000).length;
  const raised = set.filter((t) => t.rulesAtNewCost > t.price);
  const rise = raised.length
    ? `${money(Math.round(raised.reduce((s, t) => s + (t.rulesAtNewCost - t.price), 0) / raised.length))} (${(median(raised.map((t) => (t.rulesAtNewCost - t.price) / t.price)) * 100).toFixed(0)}%)`
    : "—";
  say(
    `| ${KIND_AR[kind]} | ${set.length} | ${money(avg((t) => t.price))} | ${money(avg((t) => t.cost))} → ${money(avg((t) => t.newCost))} | ${losing} | ${thin} | ${raised.length} | ${rise} | ${money(avg((t) => round500Up(t.price * 1.25) - t.price))} |`,
  );
}
say();

writeFileSync(
  OUT_JSON,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      oldRate: OLD_RATE,
      newRate: NEW_RATE,
      factor: FACTOR,
      note: "Read-only proposal. rulesAtNewCost = repriceTiers/repriceOne on costs × factor. Nothing was written.",
      games: rows,
    },
    null,
    1,
  ),
);
say(`الجدول الكامل لكل لعبة في \`${OUT_JSON}\`.`);
flush();
