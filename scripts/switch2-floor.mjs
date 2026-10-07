#!/usr/bin/env node
/**
 * The Switch 2 floor: flagship Switch 2 games at 12,000, and the rest of the
 * Switch 2 games that are in demand or dear to buy from 10,000. The rule and
 * its tests are in `scripts/lib/switch2-floor.mjs`.
 *
 *   «ليس كل نسخ سويتش ٢ لكن الاسعار الغاليه والتي عليها طلب عالي تبدأ من ١٠
 *    الف للسويتش ٢ · ركز على سويتش ٢ · مثلا زيلدا سويتش ٢ بسعر ١٢ الف ·
 *    دونكي كونك بنانزا ب١٢ الف وغيرها»
 *
 * Which games are Switch 2: the ones the card badges that ARE Switch 2 games
 * (`isSwitch2Game` below). Which are in demand or dear: the shop's own demand
 * tiers (flagship, major), the most-ordered Switch 2 games, those whose
 * offline account costs at least `--expensive-yuan` yuan to buy, and those
 * whose own online account sells for at least `--expensive-online` — what the
 * in-demand games on the 10,000 step sell for online. Every other Switch 2
 * game, and every Switch 1 game, is left exactly as it is.
 *
 * Then the owner's «طبق ما ترى مناسبا»: a short list of games decided one by
 * one, each with its reason (`JUDGED`).
 *
 * Dry run unless the commit carries an unspent token in
 * `scripts/switch2-floor.apply-token`, or `--apply` is passed by hand; the
 * write path is the one the yuan rise and the offline-copies repair were
 * verified on. Prices only go UP, but for a price this rule itself wrote that
 * `JUDGED` takes back. Public outputs carry prices and ranks only — never a
 * cost, never an order count: this repository is public.
 *
 * Usage:
 *   node scripts/switch2-floor.mjs [--apply] [--only id1,id2]
 *                                  [--top-ordered 10] [--expensive-yuan 15]
 *                                  [--expensive-online 44000]
 */
import { build } from "esbuild";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { offlineCopies } from "./lib/offline-price-copies.mjs";
import {
  EXTRAS_STEP,
  FLAGSHIP_PRICE,
  IN_DEMAND_FLOOR,
  floorFor,
  planCorrection,
  planFloor,
} from "./lib/switch2-floor.mjs";
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
const TOKEN_FILE = "scripts/switch2-floor.apply-token";
const OUT_REPORT = "switch2-floor.md";
const OUT_JSON = "switch2-floor.json";
/* How many of the most-ordered Switch 2 games count as «طلب عالي». */
const TOP_ORDERED = Number(args["top-ordered"] ?? 10);
/* An offline account dearer than this, in yuan, is «غالي». */
const EXPENSIVE_YUAN = Number(args["expensive-yuan"] ?? 15);
/*
  A game whose own online account sells for this much is «غالي» too: 44,000
  is what Yoshi and the Mysterious Book and Mario Tennis Fever — in-demand
  games already on the 10,000 step — sell for online.
*/
const EXPENSIVE_ONLINE = Number(args["expensive-online"] ?? 44_000);
/* The rate the costs are stored at since the yuan rise. */
const RATE = 280;
/* A game's own price at or above this is a console filed as a game. */
const OUTLIER = 100_000;
/* Stamped by the shop on read and never moved by this run. */
const VOLATILE = ["createdAt", "created_at", "updatedAt", "updated_at"];
/*
  The owner's own examples, which must come out at 12,000 or the run stops:
  «زيلدا سويتش ٢» — Zelda's Switch 2 EDITIONS, not every Zelda the card badges
  as Switch-2-enhanced — and Donkey Kong Bananza.
*/
const NAMED = [
  ["Zelda Switch 2", (title) => /zelda/i.test(title) && /switch\W*2/i.test(title)],
  ["Donkey Kong Bananza", (title) => /donkey\s*kong\s*bananza/i.test(title)],
];

/*
  Decided one by one at the owner's «اكمل وطبق ما ترى مناسبا». `step` is the
  price the game belongs on; `correctFrom`, the price this rule wrote that it
  is taken back from — and only while every copy still carries exactly that.
*/
const JUDGED = new Map([
  /*
    Hollow Knight: Silksong. In demand, but its online account sells for
    33,000 where every other game on 12,000 sells for 48,000 to 58,000: it
    belongs with the in-demand games on 10,000, where it stood before this
    rule's flagship step lifted it.
  */
  [
    "prd_ebcb11cda2854251",
    { step: IN_DEMAND_FLOOR, correctFrom: FLAGSHIP_PRICE, why: "judged-step" },
  ],
  /*
    Sonic X Shadow Generations, listed twice: this copy at 9,000 and
    `prd_cat_sonic-x-shadow-generations-0-39-switch-2` at 10,000. One game,
    one price — the higher, as in the offline-copies repair.
  */
  ["prd_8404c32e2c544ea4", { step: IN_DEMAND_FLOOR, why: "twin" }],
]);

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
/* Why a game's price moves, as the report says it. */
const WHY = {
  flagship: "رئيسية",
  major: "مطلوبة",
  orders: "من الأكثر طلبًا",
  cost: "غالية باليوان",
  online: `غالية: أونلاين ≥ ${money(EXPENSIVE_ONLINE)}`,
  "judged-step": "تصحيح: في الطلب، وثمنها أقل من ألعاب الـ12,000",
  twin: "نسخة مكررة: بسعر نسختها الأخرى",
};

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
globalThis.__switch2FloorSilenced = silenced;
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

const outfile = path.resolve(".switch2-floor-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/switch2-floor-entry.ts"],
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
            "  globalThis.__switch2FloorSilenced.count += 1;",
            '  return { ok: false, description: "silenced by switch2-floor" };',
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
const isOfflineExtras = (row) => app.classifyTier(row).kind === "offline_extras";
/**
 * What the game's own online account sells for — the nearest thing in the
 * catalogue to what the game itself costs, and a public price.
 */
const onlinePrice = (doc) => {
  const lists = ["types", "variants", "options"].flatMap((list) =>
    Array.isArray(doc?.[list]) ? doc[list] : [],
  );
  const row = lists.find(
    (r) =>
      r && typeof r === "object" && app.classifyTier(r).kind === "online_base" && amountOf(r.price),
  );
  return amountOf(row?.price) ?? amountOf(doc?.accountOnlinePrice) ?? 0;
};
/** The yuan an ordinary offline account costs: its row's cost, else the game's. */
const offlineYuan = (doc) => {
  const lists = ["types", "variants", "options"].flatMap((list) =>
    Array.isArray(doc?.[list]) ? doc[list] : [],
  );
  const row = lists.find(
    (r) => r && typeof r === "object" && isOrdinaryOffline(r) && amountOf(r.cost),
  );
  const cost = amountOf(row?.cost) ?? amountOf(doc?.cost);
  return cost ? cost / RATE : null;
};
const titleOf = (p) =>
  String(p?.titleEn || p?.title || p?.titleAr || p?.slug || p?.id || "")
    .replace(/\s+/g, " ")
    .trim();
/*
  «ركز على سويتش ٢». The card's badge also marks Switch 1 games that merely
  RUN on a Switch 2 — Super Mario Odyssey, Galaxy 1 + 2 — and pricing those
  like Mario Kart World is not «منطقي». So a game is held to this floor only
  when it IS a Switch 2 game: its platform says so, it is flagged a Switch 2
  Edition, or its own name or slug says Switch 2.
*/
const isSwitch2Game = (product) => {
  const platform = String(product.platform ?? "")
    .trim()
    .toLowerCase();
  if (/switch[\s_-]*2|^ns2$/.test(platform)) return true;
  if (product.switch2?.isSwitch2Edition === true) return true;
  return /switch\W*2/i.test(`${titleOf(product)} ${app.getProductSlug(product) ?? ""}`);
};
/** Why the card badges a game this run leaves out as Switch 1. */
const badgeWhy = (product) => {
  if (/^(both|dual)$/i.test(String(product.platform ?? "").trim())) return "للجهازين";
  if (product.switch2Enhanced === true) return "محسّنة لسويتش ٢";
  return "وسم سويتش ٢";
};
/*
  Switch 2 games the owner listed among the shop's Nintendo titles when asking
  for the offline-price covers (`lib/offline-cover.mjs`, «ألعاب نينتندو») that
  the demand list does not carry: Pokémon Legends Z-A, Switch 2 Edition. Named
  by the owner, so flagship; matched by title.
*/
const OWNER_FLAGSHIPS = [/pok[eé]mon\s+legends:?\s*z-?a/i];
const ownerFlagship = (product) => OWNER_FLAGSHIPS.some((re) => re.test(titleOf(product)));
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

say(`# سعر أدنى لألعاب سويتش ٢ المطلوبة — ${WANT_APPLY ? "تطبيق" : "تشغيل جاف"}`);
say();
say(`شُغّل في ${new Date().toISOString()}.`);
say();
say(
  `- ألعاب سويتش ٢ «الرئيسية» (flagship في قائمة الطلب): **${FLAGSHIP_PRICE.toLocaleString("en-US")}**`,
);
say(
  `- ألعاب سويتش ٢ المطلوبة (major، أو من أكثر ${TOP_ORDERED} طلبًا، أو تكلفتها ≥ ¥${EXPENSIVE_YUAN}، أو سعرها أونلاين ≥ ${money(EXPENSIVE_ONLINE)}): **تبدأ من 10,000**`,
);
say(
  `- سعر الحساب الأوفلاين العادي فقط، بكل نسخه، ولا يُخفَّض شيء إلا سعرًا رفعه هذا التشغيل نفسه ويصحّحه قرار مسمّى أدناه. «مع الإضافات» يبقى أعلى بـ${EXTRAS_STEP.toLocaleString("en-US")} على الأقل. الأونلاين كما هو.`,
);
say(
  `- قرارات لعبة بلعبة («طبق ما ترى مناسبا»): ${[...JUDGED].map(([id, j]) => `\`${id.slice(-6)}\` ${WHY[j.why]}`).join(" · ")}`,
);
if (SCOPE) say(`- النطاق: ${[...SCOPE].map((id) => `\`${id}\``).join("، ")} فقط.`);
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

/* Orders per game — every non-cancelled order. Only the RANK is ever printed. */
const orders = new Map();
try {
  const rows = await app.d1All(
    `SELECT json_extract(item.value, '$.productId') AS product_id, COUNT(DISTINCT o.id) AS orders
       FROM orders o, json_each(o.doc, '$.items') AS item
      WHERE o.cancelled_at IS NULL
      GROUP BY product_id`,
  );
  for (const row of rows ?? []) {
    if (row.product_id != null) orders.set(String(row.product_id), Number(row.orders) || 0);
  }
} catch {
  /* Without orders the floor still follows the demand tiers and the cost. */
}

const isGame = (product) => {
  if (app.getProductCategory(product) !== "game") return false;
  const notGame = app.skipReason({
    id: String(product.id),
    title: titleOf(product),
    kind: product.kind,
    schemaId: product.schemaId ?? product.schema_id,
    cost: 1,
    price: 1,
  });
  return !notGame && (amountOf(product.price) ?? 0) < OUTLIER;
};
const badged = products.filter((p) => isGame(p) && app.isNintendoSwitch2Product(p));
const switch2 = badged.filter((p) => isSwitch2Game(p) || ownerFlagship(p));
const switch1Badged = badged.filter((p) => !switch2.includes(p));
const orderedRank = new Map(
  switch2
    .filter((p) => (orders.get(String(p.id)) ?? 0) >= 2)
    .sort((a, b) => (orders.get(String(b.id)) ?? 0) - (orders.get(String(a.id)) ?? 0))
    .map((p, i) => [String(p.id), i + 1]),
);

const planned = [];
const held = [];
const left = [];
const already = [];
const yuanBuckets = { 10: 0, 12: 0, 15: 0, 20: 0 };
for (const product of switch2) {
  const id = String(product.id);
  if (SCOPE && !SCOPE.has(id)) continue;
  const tier = ownerFlagship(product)
    ? "flagship"
    : app.demandTierFor(String(app.getProductSlug(product) || "")).tier;
  const rank = orderedRank.get(id) ?? null;
  const yuan = offlineYuan(product);
  for (const step of Object.keys(yuanBuckets))
    if (yuan !== null && yuan >= Number(step)) yuanBuckets[step] += 1;
  const dearInYuan = yuan !== null && yuan >= EXPENSIVE_YUAN;
  /* Not a game the shop judged niche: no price brings those buyers. */
  const dearOnline = tier !== "niche" && onlinePrice(product) >= EXPENSIVE_ONLINE;
  const judged = JUDGED.get(id) ?? null;
  let floor = judged
    ? { target: judged.step, why: judged.why }
    : floorFor({
        isSwitch2: true,
        tier,
        inDemand: rank !== null && rank <= TOP_ORDERED,
        expensive: dearInYuan || dearOnline,
      });
  if (floor?.why === "cost" && !dearInYuan) floor = { ...floor, why: "online" };
  if (!floor) {
    left.push({ product, tier, rank });
    continue;
  }

  const overlay = overlayIds.has(id);
  const source = overlay ? overlayRows.get(id) : product;
  if (!source) {
    held.push({ product, why: "صف `store:product:` غير قابل للقراءة" });
    continue;
  }
  /* The same plan for the row as read now, as read again before the write, and as served. */
  const replan = judged?.correctFrom
    ? (doc) =>
        planCorrection(doc, { from: judged.correctFrom, to: floor.target, isOrdinaryOffline })
    : (doc) => planFloor(doc, { target: floor.target, isOrdinaryOffline, isOfflineExtras });
  const plan = replan(source);
  if (plan === null) {
    held.push({ product, why: "سعره تغيّر منذ أن رفعه هذا التشغيل — التصحيح لا يمسّه" });
    continue;
  }
  if (plan.base === null) {
    held.push({ product, why: "لا سعر أوفلاين عادي فيها" });
    continue;
  }
  if (!plan.changes.length) {
    already.push({ product, floor, base: plan.base });
    continue;
  }
  const moved = diffPaths(source, plan.next);
  const said = new Set(plan.changes.map((c) => c.path));
  if (moved.length !== said.size || moved.some((p) => !said.has(p))) {
    held.push({ product, why: `البروفة غيّرت ما لم تقله: ${moved.join(", ")}` });
    continue;
  }
  const expectedPlan = replan(product);
  if (expectedPlan === null) {
    held.push({ product, why: "النسخة التي يعرضها المتجر لا تحمل السعر الذي يُصحَّح" });
    continue;
  }
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
    floor,
    replan,
    expected,
    now: seen(product),
    after: seen(expected),
  });
}

/* The owner's own examples are not a matter of judgement: they come out at 12,000. */
for (const [family, matches] of NAMED) {
  for (const product of switch2.filter((p) => matches(titleOf(p)))) {
    const entry = planned.find((e) => e.id === String(product.id));
    const base = entry ? entry.plan.base : already.find((a) => a.product === product)?.base;
    if (base !== FLAGSHIP_PRICE) {
      fail(`${family}: ${titleOf(product)} يخرج بـ${money(base)} لا 12,000 كما قال المالك`);
    }
  }
}

/* ---------------------------------------------------------------- the report */

say(`## 1. الخلاصة`);
say();
say(`| | العدد |`);
say(`| --- | ---: |`);
say(`| ألعاب سويتش ٢ | ${switch2.length} |`);
say(`| ألعاب سويتش ١ تحمل شارة سويتش ٢ (تعمل عليه فقط) — خارج القاعدة | ${switch1Badged.length} |`);
say(`| **يتغيّر سعرها** | **${planned.length}** |`);
for (const why of Object.keys(WHY)) {
  const n = planned.filter((e) => e.floor.why === why).length;
  if (n) say(`| — ${WHY[why]} | ${n} |`);
}
say(`| مشمولة وسعرها أصلًا عند الحد أو فوقه | ${already.length} |`);
say(`| غير مشمولة (عادية، بلا طلب عالٍ، غير غالية) — تبقى كما هي | ${left.length} |`);
say(`| تُركت للمراجعة | ${held.length} |`);
say();
say(
  `تكلفة الحساب الأوفلاين لألعاب سويتش ٢ (عدد فقط): ≥¥10: ${yuanBuckets[10]} · ≥¥12: ${yuanBuckets[12]} · ≥¥15: ${yuanBuckets[15]} · ≥¥20: ${yuanBuckets[20]}`,
);
say();

say(`## 2. كل لعبة يتغيّر سعرها — ${planned.length}`);
say();
say(`| اللعبة | السبب | الأوفلاين | مع الإضافات | البطاقة |`);
say(`| --- | --- | ---: | ---: | ---: |`);
for (const e of [...planned].sort(
  (a, b) => b.plan.base - a.plan.base || titleOf(a.product).localeCompare(titleOf(b.product)),
)) {
  const base = e.plan.changes.find((c) => !/extras|إضاف/i.test(c.path) && c.after === e.plan.base);
  const extras = e.plan.changes.filter((c) => c.after === e.plan.base + EXTRAS_STEP);
  say(
    `| ${label(e.product)} | ${WHY[e.floor.why]}${e.floor.why === "orders" ? ` (#${orderedRank.get(e.id)})` : ""} | ${money(base?.before)} → **${money(e.plan.base)}** | ${extras.length ? `${money(extras[0].before)} → ${money(extras[0].after)}` : "—"} | ${money(e.now.card)} → ${money(e.after.card)} |`,
  );
}
say();

say(`## 3. مشمولة وسعرها أصلًا عند الحد — ${already.length}`);
say();
for (const a of already) say(`- ${label(a.product)} · ${money(a.base)} (${WHY[a.floor.why]})`);
say();

say(`## 4. ألعاب سويتش ٢ تبقى كما هي — ${left.length}`);
say();
say(`مرتبة بالأكثر طلبًا أولًا (الترتيب فقط). أي لعبة هنا يمكن إضافتها بالاسم:`);
say();
for (const l of [...left]
  .sort(
    (a, b) =>
      (a.rank ?? 1e9) - (b.rank ?? 1e9) || titleOf(a.product).localeCompare(titleOf(b.product)),
  )
  .slice(0, 80)) {
  say(
    `- ${label(l.product)} · ${money(seen(l.product).card)} · ${l.tier}${l.rank ? ` · #${l.rank} طلبًا` : ""}`,
  );
}
if (left.length > 80) say(`- … و${left.length - 80} أخرى في الملف`);
say();

say(`## 5. ألعاب سويتش ١ تحمل شارة سويتش ٢ — خارج القاعدة (${switch1Badged.length})، أشهرها`);
say();
for (const p of switch1Badged
  .filter((p) =>
    ["flagship", "major"].includes(app.demandTierFor(String(app.getProductSlug(p) || "")).tier),
  )
  .slice(0, 30)) {
  say(`- ${label(p)} · ${money(seen(p).card)} · ${badgeWhy(p)}`);
}
say();

say(`## 6. تُركت للمراجعة — ${held.length}`);
say();
for (const h of held) say(`- ${label(h.product)} — ${h.why}`);
say();

const report = {
  generatedAt: new Date().toISOString(),
  rule: {
    flagship: FLAGSHIP_PRICE,
    inDemandFloor: 10_000,
    topOrdered: TOP_ORDERED,
    expensiveYuan: EXPENSIVE_YUAN,
    extrasStep: EXTRAS_STEP,
  },
  applied: false,
  games: planned.map((e) => ({
    id: e.id,
    title: titleOf(e.product),
    why: e.floor.why,
    overlay: e.overlay,
    changes: e.plan.changes,
    card: { now: e.now.card, after: e.after.card },
    online: onlinePrice(e.product),
  })),
  atFloor: already.map((a) => ({
    id: String(a.product.id),
    title: titleOf(a.product),
    why: a.floor.why,
    card: seen(a.product).card,
    online: onlinePrice(a.product),
  })),
  left: left.map((l) => ({
    id: String(l.product.id),
    title: titleOf(l.product),
    tier: l.tier,
    rank: l.rank,
    card: seen(l.product).card,
    online: onlinePrice(l.product),
  })),
  switch1Badged: switch1Badged.map((p) => ({
    id: String(p.id),
    title: titleOf(p),
    badge: badgeWhy(p),
    card: seen(p).card,
    online: onlinePrice(p),
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
  say(`لا شيء ليُكتب: كل لعبة مشمولة على حدّها أو فوقه.`);
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
      `switch2-floor:${token}`,
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
  fail(
    `الكتابة توقفت: ${report.error}. ما كُتب قبلها صحيح؛ تشغيل تالٍ برمز جديد يُكمل الباقي — ما ارتفع لا يُخطط له ثانية.`,
  );
};
process.on("unhandledRejection", writeFailed);
process.on("uncaughtException", writeFailed);

say(`## 7. الكتابة`);
say();
const skipped = [];
const writtenIds = new Set();
for (const entry of planned.filter((e) => e.overlay)) {
  const fresh = await readOverlayProduct(app, entry.id);
  const again = fresh ? entry.replan(fresh) : null;
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
      const again = entry.replan(item);
      if (!again || canonical(again.changes) !== canonical(entry.plan.changes)) {
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
  if (amounts.size !== 1 || !amounts.has(entry.plan.base)) {
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

say(`## 8. التحقق بالقراءة من D1`);
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
say(`**تم. كل لعبة كُتبت صارت على حدّها، وقُرئت من D1.**`);
flush();
