#!/usr/bin/env node
/**
 * The owner's price rise for the yuan at 280, applied to the live catalogue.
 *
 *   «رفع الاسعار التكلفه وسعر البيع · ارفع الاسعار كلها خصوصا التي ترى عليها
 *    طلب حتى لو قليل · مثلا mario kart world سعرها الحالي ٩ الف فبعد الزباده
 *    تصبح ١٢ الف · وهكذا مع البقيه»
 *
 * Every selling price of every game — offline, online, add-ons, editions,
 * hidden games included — becomes ceil1000(price × 1.25), and every supplier
 * cost moves with the yuan, × 280 / 220. Game bundles rise with their games.
 * The rule and its tests are in `scripts/lib/yuan-reprice.mjs`; this script
 * only decides WHERE each product lives and proves the write landed.
 *
 * Dry run unless told otherwise. A write needs either `--apply` on the command
 * line or, on the runner, an unspent token in `scripts/yuan-reprice.apply-token`
 * — claimed in the `console_runs` ledger, so a second push of the same token
 * finds it spent and writes nothing. Even then:
 *
 *   - every product is planned against the document that will actually be
 *     written — the raw `store:product:<id>` row where one exists — and the
 *     plan must change exactly the paths it reports and nothing else;
 *   - every product carries `priceRevision: "yuan-220-280"` once raised, and a
 *     raised product is never raised again: a re-run after a failure finishes
 *     the job instead of doubling it;
 *   - after a complete run the ledger records the rise as done, and every later
 *     run refuses to write;
 *   - every price is read back from D1 through the shop's own `getStore`, and
 *     every product the run did NOT plan is checked to still carry the prices
 *     it had.
 *
 * NOT IN ANY PUBLIC OUTPUT: supplier costs. This repository is public, so its
 * job logs, step summaries and artifacts are readable by anyone. Prices are
 * already public on banan.to; costs are the owner's. The report and the JSON
 * carry prices only, and a moved cost is recoverable exactly by the rule
 * itself (× 220 / 280).
 *
 * Usage:
 *   node scripts/yuan-reprice-apply.mjs                    # dry run
 *   node scripts/yuan-reprice-apply.mjs --apply            # write
 *   node scripts/yuan-reprice-apply.mjs --only id1,id2     # those products / bundles only
 */
import { build } from "esbuild";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  overlayProductIds,
  readOverlayProduct,
  writeOverlayProduct,
} from "./lib/store-overlay.mjs";
import {
  HANDLED_PATTERNS,
  MARK_KEY,
  NOT_YUAN_PRICED,
  amountOf,
  canonical,
  diffPaths,
  isRaised,
  markFor,
  planBundle,
  planProduct,
  priceLikePatterns,
} from "./lib/yuan-reprice.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);

const OLD_RATE = Number(args.old ?? 220);
const NEW_RATE = Number(args.new ?? 280);
/* The owner's 25% — «اليوان صعد بنسبه 25%» — and his example, 9,000 → 12,000. */
const RISE = Number(args.rise ?? 0.25);
const FACTOR = NEW_RATE / OLD_RATE;
const MARK = markFor(OLD_RATE, NEW_RATE);
const OPTS = { rise: RISE, factor: FACTOR, mark: MARK };
const DONE_ID = `yuan-reprice-done:${MARK}`;
const TOKEN_FILE = "scripts/yuan-reprice.apply-token";
const OUT_REPORT = "yuan-reprice-apply.md";
const OUT_JSON = "yuan-reprice-apply.json";
/* A game's own price at or above this is a console filed as a game, not a game. */
const OUTLIER = 100_000;
/* Stamped by the shop on read and never moved by this run. */
const VOLATILE = ["createdAt", "created_at", "updatedAt", "updated_at"];

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
const money = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US"));

if (!(OLD_RATE > 0 && NEW_RATE > OLD_RATE)) fail(`سعر صرف غير صالح: ${args.old} → ${args.new}`);
if (!(RISE > 0 && RISE < 1)) fail(`نسبة رفع غير صالحة: ${args.rise}`);

const ONLY = args.only && args.only !== "true" ? new Set(String(args.only).split(",")) : null;

/* --------------------------------------------------------------- the token */

/*
  The token file, if this checkout carries one: its first line is the token,
  and an optional `only=<id>,<id>` line narrows the write. It is only READ
  here; nothing is claimed until every check below has passed.
*/
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

/* ----------------------------------------------------------------- the app */

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
  THE PRICE ALERTS STAY UNSENT.

  `updateStore` messages every member who has a product in their favourites
  when its `price` changes — «🔔 تنبيه تغيير السعر» — and this run changes the
  price of nearly every game in the shop. Hundreds of Telegram messages
  announcing a rise is not something the owner asked for, so in this bundle
  `sendTelegramMessage` counts the message and sends nothing. The workflow
  carries no Telegram token either: two locks, not one.
*/
const silenced = { count: 0 };
globalThis.__yuanRepriceSilenced = silenced;

/*
  AND THE MEMBER LIST STAYS UNREAD.

  Before it sends anything, that alert block reads EVERY member —
  \`SELECT * FROM users\`, names, phones, addresses — and then looks up each
  favourite-keeper's Telegram link, one query each. From a runner that is a
  minute or more of nothing useful, and it is a minute that matters: over the
  REST API the catalogue write is a sequence of statements whose FIRST one
  moves the revision, so a shop isolate that reloads during the write can
  cache a half-written catalogue, and it keeps it until the version moves
  again. This script moves it again only after \`updateStore\` returns.

  So that one statement is answered here, before it leaves the process, with
  no rows: no member is read, no alert is prepared, and the version moves
  seconds after the write instead of a minute. Matched on the exact text
  \`getUsers\` sends; if that text ever changes this matches nothing and the
  run is only slower — the alerts stay silenced either way.
*/
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

const outfile = path.resolve(".yuan-reprice-apply-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/yuan-reprice-apply-entry.ts"],
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
            "  globalThis.__yuanRepriceSilenced.count += 1;",
            '  return { ok: false, description: "silenced by yuan-reprice-apply" };',
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

/** The two prices a shopper reads first: the ordinary offline account and the online one. */
const headline = (doc) => {
  const rows = app.pricingTypeRows(doc);
  const offlineRow = app.ordinaryOfflineRow(rows);
  let online = amountOf(doc?.accountOnlinePrice);
  /*
    The online account is a tier row on most games and an OPTION on others —
    Mario Kart World sells it as the option «حساب أونلاين». Both are asked.
  */
  for (const list of [rows, doc?.options]) {
    if (online || !Array.isArray(list)) continue;
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      if (app.classifyTier(row).kind === "online_base" && amountOf(row.price)) {
        online = amountOf(row.price);
        break;
      }
    }
  }
  return { offline: amountOf(offlineRow?.price) ?? amountOf(doc?.price), online: online ?? null };
};

/** Every price-like leaf with its exact path: what must not move on a product nobody planned. */
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

/** The raw value at one of the planner's paths — `price` or `types[2].price`. */
const sourceValue = (doc, pathText) => {
  const match = /^(\w+)\[(\d+)\]\.(\w+)$/.exec(pathText);
  if (!match) return doc?.[pathText];
  const rows = doc?.[match[1]];
  return Array.isArray(rows) ? rows[Number(match[2])]?.[match[3]] : undefined;
};

/**
 * Every granular row, read in ONE query and held to the same standard as
 * `readOverlayProduct`: a row that will not parse, or whose `id` is not its
 * key's, maps to null — and a null is a product the run refuses to write.
 */
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

/* ----------------------------------------------------------- the catalogue */

say(`# رفع الأسعار لليوان بـ${NEW_RATE} — ${WANT_APPLY ? "تطبيق" : "تشغيل جاف"}`);
say();
say(`شُغّل في ${new Date().toISOString()}.`);
say();
say(
  `- القاعدة: كل سعر بيع × ${1 + RISE} ثم يُقرَّب **للألف الأعلى** — مثال المالك Mario Kart World: 9,000 → 12,000.`,
);
say(
  `- كل تكلفة × ${NEW_RATE}/${OLD_RATE} (= ×${FACTOR.toFixed(4)}). التكاليف لا تُطبع هنا: هذا المستودع عام.`,
);
say(`- علامة كل منتج يُرفع: \`${MARK_KEY}: "${MARK}"\` — منتج يحملها لا يُرفع مرة ثانية.`);
if (SCOPE) say(`- النطاق: ${[...SCOPE].map((id) => `\`${id}\``).join("، ")} فقط.`);
say();

const reachable = await app.d1All("SELECT count(*) AS n FROM store_kv");
if (!reachable.length) fail("قاعدة البيانات غير متاحة");

const doneRows = await app
  .d1All("SELECT id, applied_at FROM console_runs WHERE id = ?", DONE_ID)
  .catch(() => []);
const alreadyDone = doneRows[0] ?? null;
if (alreadyDone) {
  say(
    `**هذا الرفع سُجّل مكتملًا في ${new Date(Number(alreadyDone.applied_at) * 1000).toISOString()}.** لن يُكتب شيء — رفع ثانٍ يحتاج قرارًا جديدًا من المالك، لا إعادة تشغيل.`,
  );
  say();
}

const store = await app.getStore();
const products = (Array.isArray(store?.products) ? store.products : []).filter(
  (p) => p && typeof p === "object" && p.id && p._deleted !== true && p.isDeleted !== true,
);
if (products.length < 100)
  fail(`الكتالوج أعاد ${products.length} منتجًا فقط — هذه ليست قراءة صحيحة`);
const bundles = Array.isArray(store?.bundles) ? store.bundles : [];
const overlayIds = await overlayProductIds(app);
const overlayRows = await readAllOverlayRows();
const beforeById = new Map(products.map((p) => [String(p.id), p]));

/* ------------------------------------------------------------- the scope */

const excluded = new Map(); // category → [products]
const held = []; // { product, why }
let alreadyRaised = 0;
let nothingPriced = 0;
const planned = []; // { id, product, overlay, source, plan, expected }
const patterns = new Map();
let textPrices = 0;

for (const product of products) {
  const id = String(product.id);
  if (SCOPE && !SCOPE.has(id)) continue;

  const category = app.getProductCategory(product);
  if (category !== "game") {
    if (!excluded.has(category)) excluded.set(category, []);
    excluded.get(category).push(product);
    continue;
  }
  /*
    The pricing rules' own test for «this is not a game», asked with a stand-in
    cost and price so only the kind, the template and the gift-card name speak.
  */
  const notGame = app.skipReason({
    id,
    title: titleOf(product),
    kind: product.kind,
    schemaId: product.schemaId ?? product.schema_id,
    cost: 1,
    price: 1,
  });
  if (notGame) {
    held.push({ product, why: notGame });
    continue;
  }
  if ((amountOf(product.price) ?? 0) >= OUTLIER) {
    held.push({ product, why: `سعره ${money(product.price)} — جهاز مسجّل كلعبة، لا لعبة` });
    continue;
  }
  if (isRaised(product, MARK)) {
    alreadyRaised += 1;
    continue;
  }

  const overlay = overlayIds.has(id);
  /*
    The document that will actually be written. For a product served from its
    own `store:product:<id>` row that is the RAW row — rehearsing against the
    normalized copy `getStore()` returns rehearses a document that never
    existed. For the rest it is the catalogue item `updateStore` hands back.
  */
  const source = overlay ? overlayRows.get(id) : product;
  if (!source) {
    held.push({ product, why: "صف `store:product:` غير قابل للقراءة — لن أكتب فوقه" });
    continue;
  }
  if (isRaised(source, MARK)) {
    alreadyRaised += 1;
    continue;
  }

  for (const [pattern, n] of priceLikePatterns(source))
    patterns.set(pattern, (patterns.get(pattern) ?? 0) + n);

  const plan = planProduct(source, OPTS);
  if (!plan.changes.length) {
    nothingPriced += 1;
    continue;
  }
  textPrices += plan.changes.filter(
    (c) => c.kind === "price" && typeof sourceValue(source, c.path) === "string",
  ).length;

  /* 1. The plan changes exactly what it says, and the mark. */
  const moved = new Set(diffPaths(source, plan.next));
  const said = new Set([...plan.changes.map((c) => c.path), MARK_KEY]);
  if (moved.size !== said.size || [...moved].some((p) => !said.has(p))) {
    held.push({
      product,
      why: `البروفة غيّرت ما لم تقله: ${[...moved].filter((p) => !said.has(p)).join(", ") || "مسارات ناقصة"}`,
    });
    continue;
  }

  /*
    2. What the shop will SERVE after the write, computed two ways that must
    agree: the plan applied to the normalized product the shop serves now, and
    the written document normalized the way the shop normalizes it on read.
    The read-back compares against the first; if the two disagree here, the
    read-back would have failed anyway, so the product is held instead.
  */
  const expected = strip(planProduct(product, OPTS).next);
  const served = strip(app.normalizeProductRecord(JSON.parse(JSON.stringify(plan.next))));
  if (
    !sameJson(priceLeaves(expected), priceLeaves(served)) ||
    expected[MARK_KEY] !== served[MARK_KEY]
  ) {
    held.push({ product, why: "الخطة على المستند الخام لا تطابقها على النسخة التي يعرضها المتجر" });
    continue;
  }

  planned.push({ id, product, overlay, source, plan, expected });
}

const plannedBundles = [];
let bundlesRaised = 0;
for (const bundle of bundles) {
  if (!bundle || typeof bundle !== "object" || !bundle.id) continue;
  if (SCOPE && !SCOPE.has(String(bundle.id))) continue;
  if (isRaised(bundle, MARK)) {
    bundlesRaised += 1;
    continue;
  }
  const plan = planBundle(bundle, OPTS);
  if (plan.changes.length) plannedBundles.push({ id: String(bundle.id), bundle, plan });
}

/* The fields the catalogue keeps a price in that the rule does not name. */
const unknownPatterns = [...patterns]
  .filter(([pattern]) => !HANDLED_PATTERNS.has(pattern))
  .sort((a, b) => b[1] - a[1]);
const leafOf = (pattern) => pattern.split(".").pop().replace(/\[\]$/, "");
const blockingPatterns = unknownPatterns.filter(
  ([pattern]) => !NOT_YUAN_PRICED.has(leafOf(pattern)),
);

/* ---------------------------------------------------------------- the plan */

const priceChanges = planned.flatMap((e) => e.plan.changes.filter((c) => c.kind === "price"));
const costChanges = planned.flatMap((e) => e.plan.changes.filter((c) => c.kind === "cost"));
const guarded = planned.flatMap((e) => e.plan.guarded.map((g) => ({ ...g, entry: e })));
const overlayPlanned = planned.filter((e) => e.overlay);
const chunkPlanned = planned.filter((e) => !e.overlay);
const hiddenPlanned = planned.filter((e) => app.isProductHidden(e.product)).length;

say(`## 1. ما سيُرفع`);
say();
say(`| | العدد |`);
say(`| --- | ---: |`);
say(`| منتجات في الكتالوج | ${products.length} |`);
say(`| ألعاب سيُرفع سعرها | **${planned.length}** (منها ${hiddenPlanned} مخفية) |`);
say(`| — تُكتب عبر صفّها المنفصل \`store:product:<id>\` | ${overlayPlanned.length} |`);
say(`| — تُكتب عبر كتل الكتالوج | ${chunkPlanned.length} |`);
say(`| أسعار تتحرك (كل النسخ: العادي، الأونلاين، الإضافات، الخيارات…) | ${priceChanges.length} |`);
say(`| تكاليف تتحرك (× ${FACTOR.toFixed(4)}) | ${costChanges.length} |`);
say(`| حزم ألعاب سيُرفع سعرها | ${plannedBundles.length} |`);
say(`| رُفعت سابقًا بهذه العلامة (لن تُلمس) | ${alreadyRaised} لعبة · ${bundlesRaised} حزمة |`);
say(`| ألعاب بلا أي سعر مسجّل | ${nothingPriced} |`);
say(`| أسعار مخزّنة كنص (ستبقى نصًا) | ${textPrices} |`);
say();

say(`## 2. سلّم الأسعار — كل سعر قبل وبعد`);
say();
const ladder = new Map();
for (const change of priceChanges) {
  const key = `${change.before}→${change.after}`;
  ladder.set(key, (ladder.get(key) ?? 0) + 1);
}
say(`| قبل | بعد | الزيادة | عدد النسخ |`);
say(`| ---: | ---: | ---: | ---: |`);
for (const [key, n] of [...ladder].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  const [before, after] = key.split("→").map(Number);
  say(
    `| ${money(before)} | ${money(after)} | +${Math.round(((after - before) / before) * 100)}% | ${n} |`,
  );
}
if (ladder.size > 40) say(`| … | | | ${ladder.size - 40} زوجًا آخر في الملف |`);
say();

/* The owner's own example, checked against the live catalogue rather than assumed. */
const marioKartWorld = planned.filter((e) => /mario\s*kart\s*world/i.test(titleOf(e.product)));
say(`## 3. مثال المالك على البيانات الحية`);
say();
if (!marioKartWorld.length) say(`- Mario Kart World ليس في خطة هذا التشغيل.`);
for (const e of marioKartWorld) {
  const a = headline(e.product);
  const b = headline(e.expected);
  say(
    `- ${label(e.product)}: أوفلاين ${money(a.offline)} → **${money(b.offline)}** · أونلاين ${money(a.online)} → **${money(b.online)}**`,
  );
  if (a.offline === 9_000 && b.offline !== 12_000) {
    fail(`Mario Kart World 9,000 لا يصبح 12,000 كما قال المالك — القاعدة مخطئة`);
  }
}
say();

say(`## 4. ما عليه طلب — «خصوصا التي ترى عليها طلب حتى لو قليل»`);
say();
/*
  Demand is read from the ORDERS, not from a product's \`sales\` field: the
  first live dry run found that field at 0 on every game, so a ranking by it
  ranked nothing. Every non-cancelled order counts, however small.

  Only the ranking is printed, never a count — this log is public, and how
  many copies of a game the shop sells is the owner's business.
*/
const demand = new Map();
let demandRead = true;
try {
  const rows = await app.d1All(
    `SELECT json_extract(item.value, '$.productId') AS product_id,
            COUNT(DISTINCT o.id) AS orders
       FROM orders o, json_each(o.doc, '$.items') AS item
      WHERE o.cancelled_at IS NULL
      GROUP BY product_id`,
  );
  for (const row of rows ?? []) {
    if (row.product_id !== null && row.product_id !== undefined) {
      demand.set(String(row.product_id), Number(row.orders) || 0);
    }
  }
} catch {
  demandRead = false;
}
const plannedIds = new Set(planned.map((e) => e.id));
const demanded = [...planned]
  .filter((e) => (demand.get(e.id) ?? 0) > 0)
  .sort((a, b) => (demand.get(b.id) ?? 0) - (demand.get(a.id) ?? 0));
const demandedLeftOut = [...demand.keys()]
  .filter((id) => !plannedIds.has(id) && beforeById.has(id))
  .map((id) => beforeById.get(id));
if (!demandRead) {
  say(`تعذّرت قراءة الطلبات — القسم فارغ، والخطة نفسها لا تعتمد عليه: كل لعبة تُرفع.`);
} else {
  say(
    `**${demanded.length}** لعبة عليها طلب واحد على الأقل، وكلها في الخطة. خارج الخطة منها: **${demandedLeftOut.length}**${demandedLeftOut.length ? " (أدناه)" : ""}.`,
  );
  say();
  say(`مرتبة من الأكثر طلبًا (الترتيب فقط، بلا أعداد — هذا السجل عام):`);
  say();
  say(`| # | اللعبة | أوفلاين قبل → بعد | أونلاين قبل → بعد |`);
  say(`| ---: | --- | ---: | ---: |`);
  demanded.slice(0, 40).forEach((e, i) => {
    const a = headline(e.product);
    const b = headline(e.expected);
    say(
      `| ${i + 1} | ${label(e.product)} | ${money(a.offline)} → ${money(b.offline)} | ${a.online ? `${money(a.online)} → ${money(b.online)}` : "—"} |`,
    );
  });
  for (const p of demandedLeftOut.slice(0, 20)) {
    say(`- خارج الخطة وعليها طلب: ${label(p)} · ${money(p.price)}`);
  }
}
say();

say(`## 5. أسعار رُفعت فوق الرفع العادي — ${guarded.length}`);
say();
if (!guarded.length) {
  say(`لا شيء: الرفع ${Math.round(RISE * 100)}% يُبقي كل سعر فوق تكلفته الجديدة.`);
} else {
  say(
    `سعر كان سيصبح ≤ تكلفته الجديدة، فرُفع إلى أول ألف فوقها — ومعه كل نسخة من نفس السعر في المنتج.`,
  );
  say();
  say(`| اللعبة | المسار | قبل | الرفع العادي | بعد | السبب |`);
  say(`| --- | --- | ---: | ---: | ---: | --- |`);
  for (const g of guarded.slice(0, 60)) {
    say(
      `| ${label(g.entry.product)} | \`${g.path}\` | ${money(g.before)} | ${money(g.rose)} | **${money(g.after)}** | ${g.why === "own-cost" ? "تكلفته" : "نسخة من سعر مرفوع"} |`,
    );
  }
}
say();

say(`## 6. حزم الألعاب`);
say();
if (!plannedBundles.length) say(`لا حزم تحتاج رفعًا.`);
for (const b of plannedBundles) {
  const parts = b.plan.changes.map(
    (c) => `\`${c.path}\` ${money(c.before)} → **${money(c.after)}**`,
  );
  say(`- ${label(b.bundle)}: ${parts.join(" · ")}`);
}
say();

say(`## 7. ما لا يشمله الرفع`);
say();
for (const [category, list] of [...excluded].sort((a, b) => b[1].length - a[1].length)) {
  say(
    `- **${category}**: ${list.length} منتجًا — ليست ألعابًا (أجهزة، إكسسوارات، بطاقات، أميبو، مستعمل…)، وتكلفتها ليست باليوان.`,
  );
}
if (excluded.has("bundle")) {
  say();
  say(`منتجات قسم «bundle» — للمراجعة، لأن بعضها قد يكون حزم حسابات:`);
  for (const p of excluded.get("bundle").slice(0, 30)) say(`  - ${label(p)} · ${money(p.price)}`);
}
say();
say(`ألعاب مستبعدة بالاسم أو النوع أو السعر — ${held.length}:`);
for (const h of held.slice(0, 40))
  say(`- ${label(h.product)} · ${money(h.product.price)} — ${h.why}`);
say();

say(`## 8. حقول أسعار لا تعرفها القاعدة`);
say();
if (!unknownPatterns.length) {
  say(`لا شيء: كل حقل سعر أو تكلفة في هذه الألعاب تعرفه القاعدة.`);
} else {
  say(`| الحقل | عدد المرات | |`);
  say(`| --- | ---: | --- |`);
  for (const [pattern, n] of unknownPatterns) {
    const why = NOT_YUAN_PRICED.get(leafOf(pattern));
    say(
      `| \`${pattern}\` | ${n} | ${why ? `يُترك عمدًا: ${why}` : "**غير معروف — يمنع التطبيق**"} |`,
    );
  }
}
say();

const report = {
  generatedAt: new Date().toISOString(),
  rule: { rise: RISE, round: "ceil to 1,000", oldRate: OLD_RATE, newRate: NEW_RATE, mark: MARK },
  costs:
    "Every cost moved × newRate/oldRate, to two decimals. Not listed: this repository is public. " +
    "The exact previous cost is the current one × oldRate/newRate.",
  applied: false,
  products: planned.map((e) => ({
    id: e.id,
    title: titleOf(e.product),
    overlay: e.overlay,
    prices: e.plan.changes
      .filter((c) => c.kind === "price")
      .map((c) => ({ path: c.path, before: c.before, after: c.after })),
  })),
  bundles: plannedBundles.map((b) => ({
    id: b.id,
    title: titleOf(b.bundle),
    prices: b.plan.changes,
  })),
};
const writeJson = () => writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 1)}\n`);

/* --------------------------------------------------------------- the gate */

if (!WANT_APPLY || alreadyDone) {
  say(`**تشغيل جاف. لم يُكتب شيء.** البروفة تمّت على المستند الذي سيُكتب فعلًا لكل منتج، ونجحت.`);
  writeJson();
  flush();
  process.exit(0);
}

if (blockingPatterns.length) {
  fail(
    `حقول أسعار لا تعرفها القاعدة (${blockingPatterns.map(([p]) => p).join("، ")}) — رفعها هنا وترك هذه يترك المنتج بسعرين`,
  );
}
if (!planned.length && !plannedBundles.length) {
  say(`لا شيء ليُكتب.`);
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
      `yuan-reprice:${token}`,
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

say(`## 9. الكتابة`);
say();

/*
  A failure from here on is reported, not thrown past the report. Whatever was
  written before it carries the mark, so the next run with a fresh token
  finishes the job and raises nothing twice.
*/
const writeFailed = (err) => {
  report.applied = "partial";
  report.error = redact(String(err?.message ?? err)).slice(0, 300);
  writeJson();
  fail(
    `الكتابة توقفت: ${report.error}. ما كُتب قبلها يحمل العلامة؛ تشغيل تالٍ برمز جديد يُكمل الباقي بلا ازدواج.`,
  );
};
process.on("unhandledRejection", writeFailed);
process.on("uncaughtException", writeFailed);

/*
  The granular rows first, one product per statement — each write is whole or
  absent, never half. Each row is read again IMMEDIATELY before it is written
  and planned afresh: an order or an admin edit that landed since the plan was
  made is kept, and a product whose PRICES moved meanwhile is left for the
  owner rather than overwritten.
*/
const skipped = [];
const writtenIds = new Set();
for (const entry of overlayPlanned) {
  const fresh = await readOverlayProduct(app, entry.id);
  if (!fresh) {
    skipped.push({ entry, why: "الصف لم يعد قابلًا للقراءة" });
    continue;
  }
  if (isRaised(fresh, MARK)) {
    skipped.push({ entry, why: "رُفع بالفعل" });
    continue;
  }
  const again = planProduct(fresh, OPTS);
  if (canonical(again.changes) !== canonical(entry.plan.changes)) {
    skipped.push({ entry, why: "تغيّرت أسعاره أثناء التشغيل" });
    continue;
  }
  await writeOverlayProduct(app, entry.id, again.next);
  writtenIds.add(entry.id);
}
say(`- عبر الصفوف المنفصلة: ${writtenIds.size} من ${overlayPlanned.length}`);

/*
  Then the chunks and the bundles, in one `updateStore` — the shop's own write,
  with its revision guard. It re-reads and re-runs this mutator on a conflict,
  so every counter is reset at the top and every product is planned again
  against the document in front of it.
*/
const chunkPlan = new Map(chunkPlanned.map((e) => [e.id, e]));
const bundlePlan = new Map(plannedBundles.map((b) => [b.id, b]));
let chunkWritten = new Set();
let bundleWritten = new Set();
let chunkSkipped = [];
/*
  A product that gained its own granular row while this ran would be shadowed
  by it: the chunk write would land and never be served. Asked again here, and
  such a product is left for the next run rather than written where nobody looks.
*/
const overlayNow = await overlayProductIds(app);
if (chunkPlan.size || bundlePlan.size) {
  await app.updateStore((current) => {
    chunkWritten = new Set();
    bundleWritten = new Set();
    chunkSkipped = [];
    const nextProducts = (Array.isArray(current?.products) ? current.products : []).map((item) => {
      const id = String(item?.id ?? "");
      const entry = chunkPlan.get(id);
      if (!entry) return item;
      if (overlayNow.has(id)) {
        chunkSkipped.push({ entry, why: "صار له صف منفصل أثناء التشغيل" });
        return item;
      }
      if (isRaised(item, MARK)) {
        chunkSkipped.push({ entry, why: "رُفع بالفعل" });
        return item;
      }
      const again = planProduct(item, OPTS);
      if (canonical(again.changes) !== canonical(entry.plan.changes)) {
        chunkSkipped.push({ entry, why: "تغيّرت أسعاره أثناء التشغيل" });
        return item;
      }
      chunkWritten.add(id);
      return again.next;
    });
    const nextBundles = Array.isArray(current?.bundles)
      ? current.bundles.map((bundle) => {
          const id = String(bundle?.id ?? "");
          const entry = bundlePlan.get(id);
          if (!entry || isRaised(bundle, MARK)) return bundle;
          const again = planBundle(bundle, OPTS);
          if (canonical(again.changes) !== canonical(entry.plan.changes)) return bundle;
          bundleWritten.add(id);
          return again.next;
        })
      : current?.bundles;
    return { ...current, products: nextProducts, bundles: nextBundles };
  });
}
for (const id of chunkWritten) writtenIds.add(id);
skipped.push(...chunkSkipped);
say(`- عبر كتل الكتالوج: ${chunkWritten.size} من ${chunkPlanned.length}`);
say(`- حزم: ${bundleWritten.size} من ${plannedBundles.length}`);
say(
  `- تنبيهات «تغيّر السعر»: لم يُرسل شيء — قائمة الأعضاء لم تُقرأ (${membersUnread.count})، وإرسال تيليجرام معطّل في هذا التشغيل (${silenced.count} محاولة)`,
);

/*
  THE VERSION, AFTER EVERYTHING.

  Over the REST API a catalogue write is a sequence of statements, not one
  transaction, so a shop isolate that reloaded in the middle of it could have
  cached a half-written catalogue under the revision this write took. Moving
  the version once more, after the last statement, retires that snapshot —
  and it is also what makes the granular writes above visible at all.
*/
if (writtenIds.size || bundleWritten.size) await app.bumpCatalogVersion();
say();

/* ----------------------------------------------------------- the read-back */

/*
  From D1, not from this process's memory: `updateStore` seeds the cache with
  the document it just wrote, and a read-back of that can only agree.
*/
app.invalidateStoreCache();
const afterStore = await app.getStore();
const afterProducts = Array.isArray(afterStore?.products) ? afterStore.products : [];
const afterById = new Map(afterProducts.map((p) => [String(p.id), p]));
const afterBundles = new Map(
  (Array.isArray(afterStore?.bundles) ? afterStore.bundles : []).map((b) => [
    String(b?.id ?? ""),
    b,
  ]),
);

const faults = [];
const elsewhere = [];
let verified = 0;
for (const entry of planned) {
  if (!writtenIds.has(entry.id)) continue;
  const now = afterById.get(entry.id);
  if (!now) {
    faults.push(`${label(entry.product)} اختفى من الكتالوج بعد الكتابة`);
    continue;
  }
  if (now[MARK_KEY] !== MARK) {
    faults.push(`${label(entry.product)} لا يحمل العلامة بعد الكتابة`);
    continue;
  }
  /* Every price and cost, by exact path, against what the plan said the shop would serve. */
  const want = priceLeaves(entry.expected);
  const got = priceLeaves(now);
  const wrong = [...new Set([...Object.keys(want), ...Object.keys(got)])].filter(
    (key) => canonical(want[key]) !== canonical(got[key]),
  );
  if (wrong.length) {
    const shown = wrong
      .slice(0, 4)
      .map((key) =>
        /cost/i.test(key) ? `\`${key}\`` : `\`${key}\` = ${got[key]} والمتوقع ${want[key]}`,
      );
    faults.push(`${label(entry.product)}: ${shown.join("، ")}`);
    continue;
  }
  /* Anything else that differs was somebody else's — an order's stock, a sale — and is only reported. */
  const other = diffPaths(strip(entry.expected), strip(now)).filter((p) => !/price|cost/i.test(p));
  if (other.length) elsewhere.push(`${label(entry.product)}: ${other.slice(0, 4).join(", ")}`);
  verified += 1;
}

for (const [id, entry] of bundlePlan) {
  if (!bundleWritten.has(id)) continue;
  const now = afterBundles.get(id);
  if (!now || !sameJson(priceLeaves(entry.plan.next), priceLeaves(now)) || now[MARK_KEY] !== MARK) {
    faults.push(`الحزمة ${label(entry.bundle)} لم تُقرأ كما كُتبت`);
  }
}

/*
  Every product this run did NOT write still carries exactly the prices it
  had. The ones it skipped for moving under it are already listed, and are
  not counted twice.
*/
const skippedIds = new Set(skipped.map((s) => s.entry.id));
let untouchedChecked = 0;
let untouchedMoved = 0;
for (const [id, before] of beforeById) {
  if (writtenIds.has(id) || skippedIds.has(id)) continue;
  const now = afterById.get(id);
  if (!now) continue;
  untouchedChecked += 1;
  if (!sameJson(priceLeaves(before), priceLeaves(now))) {
    untouchedMoved += 1;
    faults.push(`${label(before)} لم يخطط له هذا التشغيل وتغيّرت أسعاره`);
  }
}

/*
  The admin listing reads `product_index`, a projection `updateStore` refreshes
  in the same batch — but a product written only through its granular row is
  refreshed by nobody else. Checked, and repaired where it lags.
*/
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
    const want = amountOf(now?.price) ?? amountOf(now?.basePrice);
    if (want && Number(priceById.get(id)) !== want) indexLag.push(now);
  }
}
for (const product of indexLag) await app.refreshProductIndexRow(product);

say(`## 10. التحقق بالقراءة من D1`);
say();
say(`- ألعاب كُتبت وقُرئت بكل أسعارها كما خُطط: **${verified}** من ${writtenIds.size}`);
say(
  `- منتجات لم يكتبها هذا التشغيل وفُحصت أسعارها فلم تتغير: ${untouchedChecked - untouchedMoved} من ${untouchedChecked}`,
);
say(
  `- قائمة الإدارة (\`product_index\`): ${indexLag.length ? `${indexLag.length} صفًا كان متأخرًا وأُعيد بناؤه` : "مطابقة"}`,
);
if (skipped.length) {
  say();
  say(`تُركت ${skipped.length} لعبة — ستُكمَل في تشغيل تالٍ بلا ازدواج، لأنها لا تحمل العلامة:`);
  for (const s of skipped.slice(0, 30)) say(`- ${label(s.entry.product)} — ${s.why}`);
}
if (elsewhere.length) {
  say();
  say(`تغييرات من خارج هذا التشغيل على ألعاب كتبها (طلبات، مخزون) — للعلم فقط:`);
  for (const line of elsewhere.slice(0, 20)) say(`- ${line}`);
}
say();

report.applied = true;
report.written = writtenList;
report.skipped = skipped.map((s) => ({ id: s.entry.id, why: s.why }));
report.alertsSilenced = silenced.count;
report.memberListReads = membersUnread.count;
writeJson();

if (faults.length) {
  say(`## أخطاء في التحقق — ${faults.length}`);
  say();
  for (const fault of faults.slice(0, 40)) say(`- ${fault}`);
  fail("القراءة من D1 لا تطابق ما كُتب");
}

/*
  The ledger records the rise as DONE only after a complete, verified, full
  run — not after a scoped one, and not after one that left a product behind.
  From then on every run of this script refuses to write.
*/
if (!SCOPE && !skipped.length) {
  await app.d1Run(
    `CREATE TABLE IF NOT EXISTS console_runs (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  );
  await app.d1Run(
    `INSERT INTO console_runs (id, applied_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`,
    DONE_ID,
    Math.floor(Date.now() / 1000),
  );
  say(`سُجّل الرفع مكتملًا في السجل (\`${DONE_ID}\`). أي تشغيل لاحق لن يكتب.`);
}

say(
  skipped.length
    ? `**تم، وتُركت ${skipped.length} لعبة لتشغيل تالٍ. كل سعر كُتب قُرئ من D1 كما خُطط.**`
    : `**تم. كل سعر كُتب وقُرئ من D1 كما خُطط.**`,
);
flush();
