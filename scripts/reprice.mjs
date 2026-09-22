#!/usr/bin/env node
/**
 * The owner's pricing rules, applied to the catalogue.
 *
 * The rules live in `src/lib/repricing.ts` and are tested there against the
 * sentences that produced them. This script does three things and nothing
 * else: read the catalogue, run the rules, and — only when told to — write the
 * `price` field of the products they moved.
 *
 * Dry run unless `--apply` is passed. Even then:
 *
 *   - `price` is the ONLY field this script may write. Every other key of
 *     every touched product is compared byte for byte after the write, and a
 *     single difference fails the run. Cost, stock, hidden, options, types,
 *     trade-in values and display order are the owner's data and this script
 *     has no business in any of them.
 *   - Every proposal passes `decisionProblem` before anything is written. A
 *     price below cost, below a band's floor, above its ceiling, or not a
 *     whole thousand stops the whole run — not just that product.
 *   - Every old price is printed and carried in the JSON artifact, so the
 *     change can be undone exactly.
 *
 * Usage:
 *   node scripts/reprice.mjs                 # dry run
 *   node scripts/reprice.mjs --apply         # write
 *   node scripts/reprice.mjs --only prd_x    # one product
 *   node scripts/reprice.mjs --limit 5       # the first five that move
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
const LIMIT = args.limit && args.limit !== "true" ? Number(args.limit) : Infinity;

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};
const fail = (message) => {
  say();
  say(`**توقف: ${message}**`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
  }
  process.exit(1);
};

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

const outfile = path.resolve(".reprice-bundle.mjs");
let app;
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
          const virtual =
            /^(#tanstack-router-entry|#tanstack-start-entry|tanstack-start-manifest:)/;
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
  app = await import(outfile);
} catch (error) {
  rmSync(outfile, { force: true });
  fail(`تعذّر بناء الأدوات: ${String(error).split("\n")[0]}`);
}

say(`# التسعير حسب التكلفة — ${APPLY ? "**تطبيق**" : "تشغيل جاف"}`);
say();

const reach = await app.d1All("SELECT count(*) AS n FROM store_kv");
if (!reach.length) {
  rmSync(outfile, { force: true });
  fail("قاعدة البيانات غير متاحة — لن أكتب على لا شيء");
}

const store = await app.getStore();
const products = Array.isArray(store?.products) ? store.products : [];
if (!products.length) {
  rmSync(outfile, { force: true });
  fail("الكتالوج فارغ — لن أكتب");
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const inputs = products.map((product) => ({
  id: String(product["id"] ?? ""),
  title: String(product["title"] || product["titleEn"] || ""),
  kind: String(product["kind"] ?? ""),
  schemaId: String(product["schemaId"] ?? product["schema_id"] ?? ""),
  cost: num(product["cost"]) ?? num(product["costPrice"]) ?? num(product["baseCost"]),
  price: num(product["price"]) ?? num(product["basePrice"]),
}));

/*
  The second copy of the offline price, and whether it still agrees.

  `catalogueImport` writes the sheet's offline price into BOTH `price` and
  `accountPrice` — two copies of one number — and `readOffers` in hub.ts reads
  `num(p["accountPrice"]) || num(p["price"])`, the mirror FIRST. So the game
  page's headline comes from `accountPrice` while the product card and the till
  both price through `resolveUnitPrice`, which reads `price`.

  A repricing that moves one and not the other therefore shows the customer one
  number on the game page and charges another at checkout. This counts that,
  because a number is the only honest way to say how bad it is.
*/
const mirrors = products
  .map((product) => ({
    id: String(product["id"] ?? ""),
    title: String(product["title"] || product["titleEn"] || ""),
    price: num(product["price"]),
    accountPrice: num(product["accountPrice"]),
  }))
  .filter((row) => row.accountPrice !== null && row.accountPrice > 0);
const disagreeing = mirrors.filter((row) => Number(row.accountPrice) !== Number(row.price));

const decisions = app.repriceAll(inputs);

/*
  The gate. Every proposal, not only the ones that move — a decision to leave a
  price alone that breaks a rule is still a price on the shelf breaking a rule,
  and the owner should hear about it rather than have it pass silently.
*/
const problems = decisions.map((d) => app.decisionProblem(d)).filter(Boolean);

const skipped = decisions.filter((d) => d.skipped);
let moving = decisions.filter((d) => d.changed);
if (ONLY) moving = moving.filter((d) => d.id === ONLY);
if (Number.isFinite(LIMIT)) moving = moving.slice(0, LIMIT);

const down = moving.filter((d) => d.newPrice < d.oldPrice);
const up = moving.filter((d) => d.newPrice > d.oldPrice);
const revenueDelta = moving.reduce((sum, d) => sum + (d.newPrice - d.oldPrice), 0);

say("## سعر صفحة اللعبة مقابل سعر الصندوق");
say();
say(`- منتجات تحمل \`accountPrice\` (نسخة ثانية من سعر الأوفلاين): **${mirrors.length}**`);
say(`- منها تختلف عن \`price\` الآن: **${disagreeing.length}**`);
if (disagreeing.length) {
  say();
  say(
    "صفحة اللعبة تقرأ `accountPrice` أولًا، والبطاقة والدفع يقرآن `price`. " +
      "فهذه المنتجات تعرض سعرًا وتتقاضى آخر.",
  );
  say();
  say("| اللعبة | صفحة اللعبة | البطاقة والدفع |");
  say("|---|---:|---:|");
  for (const row of disagreeing.slice(0, 40)) {
    say(
      `| ${row.title.slice(0, 44)} | ${Number(row.accountPrice).toLocaleString("en-US")} | ` +
        `${Number(row.price).toLocaleString("en-US")} |`,
    );
  }
  if (disagreeing.length > 40) say(`| …و${disagreeing.length - 40} غيرها | | |`);
}
say();

say("## باختصار");
say();
say(`- منتجات في الكتالوج: **${products.length.toLocaleString("en-US")}**`);
say(`- خارج القواعد (ليست ألعابًا، بطاقات شحن، أجهزة): **${skipped.length}**`);
say(`- ستتغيّر أسعارها: **${moving.length}**`);
say(`  - ستنخفض: **${down.length}**`);
say(`  - سترتفع: **${up.length}**`);
say(
  `- فرق السعر الإجمالي على القائمة: **${revenueDelta >= 0 ? "+" : ""}${revenueDelta.toLocaleString("en-US")}** د.ع`,
);
say();

if (problems.length) {
  say("## مخالفات للقواعد — لن يُكتب شيء");
  say();
  for (const problem of problems.slice(0, 40)) say(`- ${problem}`);
  if (problems.length > 40) say(`- …و${problems.length - 40} غيرها`);
  rmSync(outfile, { force: true });
  fail(`${problems.length} قرارًا يخالف قواعدك`);
}

/* The skipped, grouped, so nothing is silently out of scope. */
if (skipped.length) {
  const grouped = new Map();
  for (const d of skipped) grouped.set(d.skipped, (grouped.get(d.skipped) ?? 0) + 1);
  say("## مستبعَد، ولماذا");
  say();
  for (const [why, count] of [...grouped.entries()].sort((a, b) => b[1] - a[1])) {
    say(`- ${why}: **${count}**`);
  }
  say();
  const named = skipped.filter((d) => /بطاقة|جهاز/.test(d.skipped));
  for (const d of named.slice(0, 12)) {
    say(
      `  - ${d.title.slice(0, 50)} — تكلفة ${(d.cost ?? 0).toLocaleString("en-US")}، ` +
        `سعر ${(d.oldPrice ?? 0).toLocaleString("en-US")} (لم يُمسّ)`,
    );
  }
  say();
}

if (down.length) {
  say("## الأسعار التي ستنخفض");
  say();
  say("| اللعبة | التكلفة | من | إلى | الفرق | السبب |");
  say("|---|---:|---:|---:|---:|---|");
  for (const d of [...down].sort((a, b) => a.newPrice - a.oldPrice - (b.newPrice - b.oldPrice))) {
    say(
      `| ${d.title.slice(0, 44)} | ${(d.cost ?? 0).toLocaleString("en-US")} | ` +
        `${d.oldPrice.toLocaleString("en-US")} | ${d.newPrice.toLocaleString("en-US")} | ` +
        `${(d.newPrice - d.oldPrice).toLocaleString("en-US")} | ${d.reason} |`,
    );
  }
  say();
}

if (up.length) {
  say("## الأسعار التي سترتفع");
  say();
  say("| اللعبة | التكلفة | من | إلى | الربح الجديد | السبب |");
  say("|---|---:|---:|---:|---:|---|");
  for (const d of [...up].sort((a, b) => b.newPrice - b.oldPrice - (a.newPrice - a.oldPrice))) {
    say(
      `| ${d.title.slice(0, 44)} | ${(d.cost ?? 0).toLocaleString("en-US")} | ` +
        `${d.oldPrice.toLocaleString("en-US")} | ${d.newPrice.toLocaleString("en-US")} | ` +
        `${(d.newPrice - (d.cost ?? 0)).toLocaleString("en-US")} | ${d.reason} |`,
    );
  }
  say();
}

/* Where the catalogue lands, so the shape is visible before the write. */
const after = new Map();
for (const d of decisions) {
  if (d.skipped) continue;
  const final = moving.find((m) => m.id === d.id)?.newPrice ?? d.oldPrice;
  after.set(final, (after.get(final) ?? 0) + 1);
}
say("## شكل الأسعار بعد التطبيق");
say();
say("| السعر | ألعاب |");
say("|---:|---:|");
for (const [price, count] of [...after.entries()].sort((a, b) => a[0] - b[0])) {
  say(`| ${Number(price).toLocaleString("en-US")} | ${count.toLocaleString("en-US")} |`);
}
say();

const payload = {
  apply: APPLY,
  moving: moving.map((d) => ({
    id: d.id,
    title: d.title,
    cost: d.cost,
    from: d.oldPrice,
    to: d.newPrice,
    reason: d.reason,
  })),
};

if (!APPLY) {
  say("**تشغيل جاف. لم يُكتب شيء.**");
  rmSync(outfile, { force: true });
  if (args.json && args.json !== "true") writeFileSync(args.json, JSON.stringify(payload, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
  }
  process.exit(0);
}

if (!moving.length) {
  say("**لا شيء ليُكتب.**");
  rmSync(outfile, { force: true });
  process.exit(0);
}

/*
  The rehearsal. Patch a copy of every product in memory and assert that the
  ONLY key that differs is `price` — before a single byte reaches production.
*/
const byId = new Map(products.map((p) => [String(p["id"] ?? ""), p]));
const wanted = new Map(moving.map((d) => [d.id, d.newPrice]));
for (const [id, price] of wanted) {
  const before = byId.get(id);
  if (!before) fail(`${id} ليس في الكتالوج`);
  const patched = { ...before, price };
  for (const key of new Set([...Object.keys(before), ...Object.keys(patched)])) {
    if (key === "price") continue;
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(patched[key] ?? null)) {
      fail(`البروفة: ${id}.${key} تغيّر، وهذا السكربت لا يملك تغييره`);
    }
  }
  if (patched.price !== price) fail(`البروفة: ${id}.price لم يُضبط`);
}

let written = 0;
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
    if (!wanted.has(id)) return item;
    written += 1;
    return { ...item, price: wanted.get(id) };
  });
  return { ...current, products: next };
});

/*
  Read back, field by field, FROM D1 — not from this process's own memory.

  `updateStore` seeds `storeCache` with the document it just wrote, and
  `getStore()` serves that cache for up to a minute. So the read-back was
  reading back what this process had just put in its own memory: it would have
  confirmed a write that never reached the database, which is exactly what
  happened. One product of a hundred and five came back at its old price on a
  fresh run minutes later, while this check had reported no faults at all.

  A verification that can only agree with itself is not a verification.
*/
app.invalidateStoreCache();
const afterStore = await app.getStore();
const afterList = Array.isArray(afterStore?.products) ? afterStore.products : [];
const afterById = new Map(afterList.map((p) => [String(p["id"] ?? ""), p]));
const faults = [];
let verified = 0;
for (const [id, price] of wanted) {
  const was = byId.get(id);
  const now = afterById.get(id);
  if (!now) {
    faults.push(`${id} اختفى من الكتالوج بعد الكتابة`);
    continue;
  }
  if (Number(now["price"]) !== Number(price)) {
    faults.push(`${id}.price = ${now["price"]}، والمتوقع ${price}`);
    continue;
  }
  for (const key of new Set([...Object.keys(was ?? {}), ...Object.keys(now)])) {
    if (key === "price") continue;
    if (JSON.stringify(was?.[key] ?? null) !== JSON.stringify(now[key] ?? null)) {
      faults.push(`${id}.${key} تغيّر، وهذا السكربت لا يملك تغييره`);
    }
  }
  verified += 1;
}

rmSync(outfile, { force: true });

/*
  The last word: run the rules again over what the database actually holds.

  Field-by-field equality says the write landed. It does not say the catalogue
  now satisfies the rules — a product missed entirely by the write would not
  appear in `wanted` and would sail through the loop above. The rules are
  idempotent by test, so a correct apply leaves nothing to do; anything still
  moving is a product this run failed to move.
*/
const settled = app
  .repriceAll(
    afterList.map((product) => ({
      id: String(product["id"] ?? ""),
      title: String(product["title"] || product["titleEn"] || ""),
      kind: String(product["kind"] ?? ""),
      schemaId: String(product["schemaId"] ?? product["schema_id"] ?? ""),
      cost: num(product["cost"]) ?? num(product["costPrice"]) ?? num(product["baseCost"]),
      price: num(product["price"]) ?? num(product["basePrice"]),
    })),
  )
  .filter((d) => d.changed);

say(`## كُتب: **${written}** · تُحقّق منه حقلًا بحقل: **${verified}**`);
say();
if (settled.length) {
  say(`### ما زال **${settled.length}** منتجًا خارج القاعدة بعد الكتابة`);
  say();
  say("| اللعبة | التكلفة | ما زال | المطلوب |");
  say("|---|---:|---:|---:|");
  for (const d of settled.slice(0, 40)) {
    say(
      `| ${d.title.slice(0, 44)} | ${(d.cost ?? 0).toLocaleString("en-US")} | ` +
        `${d.oldPrice?.toLocaleString("en-US")} | ${d.newPrice?.toLocaleString("en-US")} |`,
    );
  }
  say();
  for (const d of settled) faults.push(`${d.id} ما زال ${d.oldPrice}، والمطلوب ${d.newPrice}`);
} else {
  say("**الكتالوج كله مطابق للقواعد.**");
}
say();
/*
  Name them.

  A canary run writes the first few in catalogue order, and the tables above
  are sorted for reading — so neither says WHICH prices moved on the live shop.
  The owner has to be able to check them, and to put them back.
*/
say("| اللعبة | التكلفة | من | إلى |");
say("|---|---:|---:|---:|");
for (const d of moving) {
  say(
    `| ${d.title.slice(0, 46)} | ${(d.cost ?? 0).toLocaleString("en-US")} | ` +
      `${d.oldPrice.toLocaleString("en-US")} | ${d.newPrice.toLocaleString("en-US")} |`,
  );
}
say();
if (faults.length) {
  say("### أخطاء بعد الكتابة");
  say();
  for (const fault of faults.slice(0, 40)) say(`- ${fault}`);
  say();
}

if (args.json && args.json !== "true") writeFileSync(args.json, JSON.stringify(payload, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
}
process.exit(faults.length ? 1 : 0);
