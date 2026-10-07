#!/usr/bin/env node
/**
 * One ordinary offline price per game: every stale lower copy lifted to the
 * highest. The rule and its tests are in `scripts/lib/offline-price-copies.mjs`.
 *
 *   «هنالك العاب لم تتأثر بالصعود او صعودها قليل حل المشكلة، بقيت على الاسعار
 *    القديمه بالرغم السعر صعد مثل zelda و lego batman و بعض اجزاء ماريو»
 *
 * Dry run unless the commit carries an unspent token in
 * `scripts/offline-price-copies.apply-token` (claimed in `console_runs`
 * first), or `--apply` is passed by hand. The write path is the yuan rise's,
 * which was verified on production: each game planned against the document
 * that will actually be written, re-read and re-planned immediately before
 * its write, read back from D1 through the shop's own `getStore`, every game
 * it did not plan checked to still carry its prices, and the catalogue
 * version moved after the last statement. No member is read and no Telegram
 * message is prepared.
 *
 * Idempotent by construction: once a game's copies agree there is nothing to
 * plan for it, so a second run plans nothing.
 *
 * Public outputs carry prices only — this repository is public.
 *
 * Usage:
 *   node scripts/offline-price-copies.mjs                 # dry run
 *   node scripts/offline-price-copies.mjs --apply         # write
 *   node scripts/offline-price-copies.mjs --only id1,id2  # those games only
 */
import { build } from "esbuild";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { offlineCopies, planOfflineSync } from "./lib/offline-price-copies.mjs";
import {
  overlayProductIds,
  readOverlayProduct,
  writeOverlayProduct,
} from "./lib/store-overlay.mjs";
import { amountOf, canonical, diffPaths } from "./lib/yuan-reprice.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);
const TOKEN_FILE = "scripts/offline-price-copies.apply-token";
const OUT_REPORT = "offline-price-copies.md";
const OUT_JSON = "offline-price-copies.json";
/* A game's own price at or above this is a console filed as a game. */
const OUTLIER = 100_000;
/* Stamped by the shop on read and never moved by this run. */
const VOLATILE = ["createdAt", "created_at", "updatedAt", "updated_at"];
/* The owner's own examples, shown in full whatever the plan says about them. */
const NAMED = [
  ["Zelda", /zelda|زيلدا/i],
  ["LEGO Batman", /lego.*batman|ليغو.*باتمان/i],
  ["Mario", /mario|ماريو/i],
];

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
const money = (n) => (Number(n) > 0 ? Number(n).toLocaleString("en-US") : "—");

const ONLY = args.only && args.only !== "true" ? new Set(String(args.only).split(",")) : null;

let token = null;
let tokenOnly = null;
if (existsSync(TOKEN_FILE)) {
  const fileLines = readFileSync(TOKEN_FILE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  token = fileLines[0] && /^[\w.-]{6,80}$/.test(fileLines[0]) ? fileLines[0] : null;
  const onlyLine = fileLines.find((l) => l.startsWith("only="));
  if (onlyLine) tokenOnly = new Set(onlyLine.slice("only=".length).split(",").filter(Boolean));
}
const SCOPE = ONLY ?? tokenOnly;
const WANT_APPLY = args.apply === "true" || Boolean(token);

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

/*
  The price alerts stay unsent, and the member list unread — exactly as in
  the yuan rise (`yuan-reprice-apply.mjs` says why at length): `updateStore`
  would message every member whose favourite changed price, and before that
  it reads every member. The one statement is answered here with no rows, and
  in the bundle `sendTelegramMessage` counts and sends nothing.
*/
const silenced = { count: 0 };
globalThis.__offlineCopiesSilenced = silenced;
const membersUnread = { count: 0 };
const fetchThrough = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : String(input?.url ?? "");
  if (/\/d1\/database\/[^/]+\/query$/.test(url) && typeof init?.body === "string") {
    let sql = "";
    try {
      sql = String(JSON.parse(init.body)?.sql ?? "");
    } catch {
      sql = "";
    }
    if (/^\s*SELECT \* FROM users ORDER BY created_at ASC\s*$/i.test(sql)) {
      membersUnread.count += 1;
      return new Response(
        JSON.stringify({ success: true, result: [{ success: true, results: [], meta: {} }] }),
        { headers: { "content-type": "application/json" } },
      );
    }
  }
  return fetchThrough(input, init);
};
const realTelegram = path.resolve("src/lib/telegram.server.ts");

const outfile = path.resolve(".offline-price-copies-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/offline-price-copies-entry.ts"],
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
      /* The same stub the pricing scripts use: no request handler runs here. */
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
    {
      name: "silence-telegram",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /telegram\.server(\.ts)?$/ }, (a) =>
          a.namespace === "silenced-telegram"
            ? { path: realTelegram }
            : { path: "telegram.server", namespace: "silenced-telegram" },
        );
        pluginBuild.onLoad({ filter: /.*/, namespace: "silenced-telegram" }, () => ({
          contents: [
            `export * from ${JSON.stringify(realTelegram)};`,
            "export async function sendTelegramMessage() {",
            "  globalThis.__offlineCopiesSilenced.count += 1;",
            '  return { ok: false, description: "silenced by offline-price-copies" };',
            "}",
          ].join("\n"),
          loader: "js",
          resolveDir: path.dirname(realTelegram),
        }));
      },
    },
  ],
});
const app = await import(outfile);
rmSync(outfile, { force: true });

/* ----------------------------------------------------------------- helpers */

const isOrdinaryOffline = (row) => app.classifyTier(row).kind === "offline_base";
const titleOf = (p) =>
  String(p?.titleEn || p?.title || p?.titleAr || p?.slug || p?.id || "")
    .replace(/\s+/g, " ")
    .trim();
const label = (p) => {
  const t = titleOf(p);
  return `${t.length > 52 ? `${t.slice(0, 51)}…` : t || "—"} \`${String(p?.id ?? "").slice(-6)}\``;
};
const strip = (doc) => {
  const out = { ...doc };
  for (const key of VOLATILE) delete out[key];
  return out;
};
/** What the card prints and what the product page offers as the offline account. */
const seen = (doc) => ({
  card: Number(app.listingPricing(doc)?.unitPrice) || 0,
  offer: Number((app.readOffers(doc) ?? []).find((o) => o.kind === "account")?.price) || 0,
});
/** Every price-like leaf with its exact path. */
const priceLeaves = (doc, prefix = "", out = {}) => {
  if (!doc || typeof doc !== "object") return out;
  for (const [key, value] of Object.entries(doc)) {
    const here = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      value.forEach((row, i) => {
        if (row && typeof row === "object") priceLeaves(row, `${here}[${i}]`, out);
      });
    } else if (value && typeof value === "object") {
      priceLeaves(value, here, out);
    } else if (/price|cost/i.test(key)) {
      out[here] = value;
    }
  }
  return out;
};
const sameJson = (a, b) => canonical(a) === canonical(b);
const readAllOverlayRows = async () => {
  const rows = await app.d1All("SELECT key, value FROM store_kv WHERE key LIKE 'store:product:%'");
  const out = new Map();
  for (const row of rows ?? []) {
    const id = String(row.key).slice("store:product:".length);
    let doc = null;
    try {
      doc = row.value ? JSON.parse(String(row.value)) : null;
    } catch {
      doc = null;
    }
    out.set(id, doc && typeof doc === "object" && String(doc.id ?? "") === id ? doc : null);
  }
  return out;
};

/* ------------------------------------------------------------ the catalogue */

say(`# سعر أوفلاين واحد لكل لعبة — ${WANT_APPLY ? "تطبيق" : "تشغيل جاف"}`);
say();
say(`شُغّل في ${new Date().toISOString()}.`);
say();
say(
  `كل نسخ سعر «الحساب الأوفلاين العادي» في اللعبة — السعر الأساسي، سعر الحساب، وصف الأوفلاين العادي —`,
);
say(
  `تُرفع إلى **أعلاها**، ولا تُخفَّض أبدًا. نسخ متباعدة أكثر من 1.6 ضعف لا تُلمس وتُعرض للمراجعة.`,
);
if (SCOPE) say(`النطاق: ${[...SCOPE].map((id) => `\`${id}\``).join("، ")} فقط.`);
say();

const store = await app.getStore();
const products = (Array.isArray(store?.products) ? store.products : []).filter(
  (p) => p && typeof p === "object" && p.id && p._deleted !== true && p.isDeleted !== true,
);
if (products.length < 100)
  fail(`الكتالوج أعاد ${products.length} منتجًا فقط — هذه ليست قراءة صحيحة`);
const overlayIds = await overlayProductIds(app);
const overlayRows = await readAllOverlayRows();
const beforeById = new Map(products.map((p) => [String(p.id), p]));

const planned = [];
const held = [];
let games = 0;
let agreed = 0;
for (const product of products) {
  const id = String(product.id);
  if (SCOPE && !SCOPE.has(id)) continue;
  if (app.getProductCategory(product) !== "game") continue;
  const notGame = app.skipReason({
    id,
    title: titleOf(product),
    kind: product.kind,
    schemaId: product.schemaId ?? product.schema_id,
    cost: 1,
    price: 1,
  });
  if (notGame || (amountOf(product.price) ?? 0) >= OUTLIER) continue;
  games += 1;

  const overlay = overlayIds.has(id);
  const source = overlay ? overlayRows.get(id) : product;
  if (!source) {
    held.push({ product, why: "صف `store:product:` غير قابل للقراءة" });
    continue;
  }
  const plan = planOfflineSync(source, isOrdinaryOffline);
  if (plan.held) {
    held.push({ product, why: plan.held });
    continue;
  }
  if (!plan.changes.length) {
    agreed += 1;
    continue;
  }

  /* 1. The plan changes exactly what it says. */
  const moved = diffPaths(source, plan.next);
  const said = new Set(plan.changes.map((c) => c.path));
  if (moved.length !== said.size || moved.some((p) => !said.has(p))) {
    held.push({ product, why: `البروفة غيّرت ما لم تقله: ${moved.join(", ")}` });
    continue;
  }
  /* 2. What the shop will serve, computed on the served copy and on the written one. */
  const expectedPlan = planOfflineSync(product, isOrdinaryOffline);
  const expected = strip(expectedPlan.changes.length ? expectedPlan.next : product);
  const served = strip(app.normalizeProductRecord(JSON.parse(JSON.stringify(plan.next))));
  if (!sameJson(priceLeaves(expected), priceLeaves(served))) {
    held.push({ product, why: "الخطة على المستند الخام لا تطابقها على النسخة التي يعرضها المتجر" });
    continue;
  }
  planned.push({
    id,
    product,
    overlay,
    source,
    plan,
    expected,
    now: seen(product),
    after: seen(expected),
  });
}

/* ---------------------------------------------------------------- the report */

const cardMoves = planned.filter((e) => e.after.card !== e.now.card).length;
say(`## 1. الخلاصة`);
say();
say(`| | العدد |`);
say(`| --- | ---: |`);
say(`| ألعاب | ${games} |`);
say(`| نسخ سعرها الأوفلاين متطابقة | ${agreed} |`);
say(`| **نسخ متخلّفة ستُرفع إلى الأعلى** | **${planned.length}** |`);
say(`| — منها يتغيّر سعر بطاقتها فعلًا | ${cardMoves} |`);
say(`| نسخ متباعدة تُركت للمراجعة | ${held.length} |`);
say();

say(`## 2. أمثلة المالك — ما يُعرض الآن وما سيُعرض`);
say();
say(`| | اللعبة | البطاقة الآن → بعد | صفحة اللعبة (أوفلاين) الآن → بعد | النسخ الآن |`);
say(`| --- | --- | ---: | ---: | --- |`);
for (const [family, re] of NAMED) {
  for (const product of products.filter((p) => re.test(`${titleOf(p)} ${p.titleAr ?? ""}`))) {
    if (app.getProductCategory(product) !== "game") continue;
    const entry = planned.find((e) => e.id === String(product.id));
    const now = seen(product);
    const after = entry ? entry.after : now;
    const copies = offlineCopies(product, isOrdinaryOffline)
      .map((c) => `${c.path} ${money(c.amount)}`)
      .join(" · ");
    say(
      `| ${family} | ${label(product)} | ${money(now.card)} → ${entry && after.card !== now.card ? `**${money(after.card)}**` : money(after.card)} | ${money(now.offer)} → ${entry && after.offer !== now.offer ? `**${money(after.offer)}**` : money(after.offer)} | ${copies || "—"} |`,
    );
  }
}
say();

say(`## 3. كل لعبة ستُصحَّح — ${planned.length}`);
say();
say(`| اللعبة | النسخ المتخلّفة | البطاقة | صفحة اللعبة |`);
say(`| --- | --- | ---: | ---: |`);
for (const e of [...planned].sort(
  (a, b) => b.after.card - b.now.card - (a.after.card - a.now.card),
)) {
  const moves = e.plan.changes
    .map((c) => `${c.path} ${money(c.before)}→${money(c.after)}`)
    .join(" · ");
  say(
    `| ${label(e.product)} | ${moves} | ${money(e.now.card)} → ${money(e.after.card)} | ${money(e.now.offer)} → ${money(e.after.offer)} |`,
  );
}
say();

say(`## 4. تُركت للمراجعة — ${held.length}`);
say();
for (const h of held.slice(0, 60))
  say(`- ${label(h.product)} · ${money(h.product.price)} — ${h.why}`);
say();

const report = {
  generatedAt: new Date().toISOString(),
  rule: "Every stored copy of a game's ordinary offline price lifted to the highest copy; never lowered.",
  applied: false,
  games: planned.map((e) => ({
    id: e.id,
    title: titleOf(e.product),
    overlay: e.overlay,
    changes: e.plan.changes,
    card: { now: e.now.card, after: e.after.card },
    offer: { now: e.now.offer, after: e.after.offer },
  })),
  held: held.map((h) => ({ id: String(h.product.id), title: titleOf(h.product), why: h.why })),
};
const writeJson = () => writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 1)}\n`);

if (!WANT_APPLY) {
  say(`**تشغيل جاف. لم يُكتب شيء.**`);
  writeJson();
  flush();
  process.exit(0);
}
if (!planned.length) {
  say(`لا شيء ليُكتب: نسخ كل لعبة متطابقة.`);
  writeJson();
  flush();
  process.exit(0);
}

if (token && args.apply !== "true") {
  await app.d1Run(
    `CREATE TABLE IF NOT EXISTS console_runs (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  );
  const claimed = await app
    .d1All(
      `INSERT INTO console_runs (id, applied_at) VALUES (?, ?)
         ON CONFLICT(id) DO NOTHING RETURNING id`,
      `offline-copies:${token}`,
      Math.floor(Date.now() / 1000),
    )
    .catch(() => []);
  if (!claimed.length) {
    say(`الرمز \`${token}\` استُخدم من قبل. هذا التشغيل يبقى جافًا — لم يُكتب شيء.`);
    writeJson();
    flush();
    process.exit(0);
  }
  say(`استُلم الرمز \`${token}\`. الكتابة تبدأ.`);
  say();
}

/* --------------------------------------------------------------- the write */

const writeFailed = (err) => {
  report.applied = "partial";
  report.error = redact(String(err?.message ?? err)).slice(0, 300);
  writeJson();
  fail(`الكتابة توقفت: ${report.error}. ما كُتب قبلها صحيح؛ تشغيل تالٍ برمز جديد يُكمل الباقي.`);
};
process.on("unhandledRejection", writeFailed);
process.on("uncaughtException", writeFailed);

say(`## 5. الكتابة`);
say();
const skipped = [];
const writtenIds = new Set();
for (const entry of planned.filter((e) => e.overlay)) {
  const fresh = await readOverlayProduct(app, entry.id);
  const again = fresh ? planOfflineSync(fresh, isOrdinaryOffline) : null;
  if (!again || canonical(again.changes) !== canonical(entry.plan.changes)) {
    skipped.push({ entry, why: "تغيّرت أسعاره أثناء التشغيل" });
    continue;
  }
  await writeOverlayProduct(app, entry.id, again.next);
  writtenIds.add(entry.id);
}
const chunkPlan = new Map(planned.filter((e) => !e.overlay).map((e) => [e.id, e]));
const overlayNow = await overlayProductIds(app);
let chunkWritten = new Set();
let chunkSkipped = [];
if (chunkPlan.size) {
  await app.updateStore((current) => {
    chunkWritten = new Set();
    chunkSkipped = [];
    const nextProducts = (Array.isArray(current?.products) ? current.products : []).map((item) => {
      const id = String(item?.id ?? "");
      const entry = chunkPlan.get(id);
      if (!entry) return item;
      if (overlayNow.has(id)) {
        chunkSkipped.push({ entry, why: "صار له صف منفصل أثناء التشغيل" });
        return item;
      }
      const again = planOfflineSync(item, isOrdinaryOffline);
      if (canonical(again.changes) !== canonical(entry.plan.changes)) {
        chunkSkipped.push({ entry, why: "تغيّرت أسعاره أثناء التشغيل" });
        return item;
      }
      chunkWritten.add(id);
      return again.next;
    });
    return { ...current, products: nextProducts };
  });
}
for (const id of chunkWritten) writtenIds.add(id);
skipped.push(...chunkSkipped);
/* After the last statement, so no isolate keeps a snapshot taken mid-write. */
if (writtenIds.size) await app.bumpCatalogVersion();
say(`- كُتبت: ${writtenIds.size} من ${planned.length}`);
say(
  `- تنبيهات «تغيّر السعر»: لم يُرسل شيء — قائمة الأعضاء لم تُقرأ (${membersUnread.count})، وإرسال تيليجرام معطّل (${silenced.count} محاولة)`,
);
say();

/* ----------------------------------------------------------- the read-back */

app.invalidateStoreCache();
const afterStore = await app.getStore();
const afterById = new Map(
  (Array.isArray(afterStore?.products) ? afterStore.products : []).map((p) => [String(p.id), p]),
);
const faults = [];
let verified = 0;
for (const entry of planned) {
  if (!writtenIds.has(entry.id)) continue;
  const now = afterById.get(entry.id);
  if (!now) {
    faults.push(`${label(entry.product)} اختفى من الكتالوج`);
    continue;
  }
  const amounts = new Set(offlineCopies(now, isOrdinaryOffline).map((c) => c.amount));
  if (amounts.size !== 1 || !amounts.has(entry.plan.target)) {
    faults.push(`${label(entry.product)}: النسخ ${[...amounts].join(" و")} بعد الكتابة`);
    continue;
  }
  if (!sameJson(priceLeaves(entry.expected), priceLeaves(now))) {
    faults.push(`${label(entry.product)}: أسعار أخرى لا تطابق الخطة`);
    continue;
  }
  verified += 1;
}
const skippedIds = new Set(skipped.map((s) => s.entry.id));
let untouched = 0;
for (const [id, before] of beforeById) {
  if (writtenIds.has(id) || skippedIds.has(id)) continue;
  const now = afterById.get(id);
  if (!now) continue;
  untouched += 1;
  if (!sameJson(priceLeaves(before), priceLeaves(now))) {
    faults.push(`${label(before)} لم يخطط له هذا التشغيل وتغيّرت أسعاره`);
  }
}
const indexLag = [];
const writtenList = [...writtenIds];
for (let at = 0; at < writtenList.length; at += 50) {
  const group = writtenList.slice(at, at + 50);
  const rows = await app
    .d1All(
      `SELECT id, price FROM product_index WHERE id IN (${group.map(() => "?").join(",")})`,
      ...group,
    )
    .catch(() => []);
  const priceById = new Map(rows.map((r) => [String(r.id), r.price]));
  for (const id of group) {
    const now = afterById.get(id);
    const want = amountOf(now?.price);
    if (want && Number(priceById.get(id)) !== want) indexLag.push(now);
  }
}
for (const product of indexLag) await app.refreshProductIndexRow(product);

say(`## 6. التحقق بالقراءة من D1`);
say();
say(`- كُتبت وقُرئت كل نسخها على سعر واحد: **${verified}** من ${writtenIds.size}`);
say(`- منتجات لم يكتبها هذا التشغيل وبقيت أسعارها كما هي: ${untouched} فُحصت`);
say(`- قائمة الإدارة: ${indexLag.length ? `${indexLag.length} صفًا أُعيد بناؤه` : "مطابقة"}`);
if (skipped.length) {
  say();
  say(`تُركت ${skipped.length} لعبة لتشغيل تالٍ:`);
  for (const s of skipped.slice(0, 30)) say(`- ${label(s.entry.product)} — ${s.why}`);
}
say();

report.applied = true;
report.written = writtenList;
report.skipped = skipped.map((s) => ({ id: s.entry.id, why: s.why }));
writeJson();
if (faults.length) {
  say(`## أخطاء في التحقق — ${faults.length}`);
  say();
  for (const fault of faults.slice(0, 40)) say(`- ${fault}`);
  fail("القراءة من D1 لا تطابق ما كُتب");
}
say(`**تم. كل لعبة كُتبت صار لسعرها الأوفلاين رقم واحد، وقُرئ من D1.**`);
flush();
