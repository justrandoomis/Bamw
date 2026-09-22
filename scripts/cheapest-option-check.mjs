#!/usr/bin/env node
/**
 * Does the card on banan.to show the CHEAPEST option in the product?
 *
 * The owner, with a screenshot of Super Mario Odyssey reading 35,000:
 *
 *   «اريد يعرض ارخص خيار ( ليش اجباري سعر اوفلاين )
 *    السعر الذي اريده ان يظهر على البطاقه يجب ان يكون سعر ارخص خيار في المنتج»
 *
 * READ ONLY. It writes nothing anywhere, and it is not a second copy of the
 * rule: it imports the very `listingPricing` the card calls, and then goes and
 * reads the card.
 *
 * TWO HALVES, AND BOTH ARE NEEDED.
 *
 *   1. The catalogue, out of D1. For every game it computes the cheapest
 *      BUYABLE price — the base the till charges with nothing selected, plus
 *      every priced option, type and variant — and compares it to what
 *      `listingPricing` leads with. Any product where the card leads with more
 *      than the cheapest thing a customer can actually buy is a failure, named.
 *
 *   2. The live site, in a real browser. «لا تقل «تم» بناءً على Build فقط؛
 *      المطلوب تحقق وظيفي كامل على الإنتاج» — so the expected number is then
 *      looked for on the shopper's own screen: the search page's card, which is
 *      the surface the owner photographed, and the product page behind it.
 *
 * The second half can be defeated by Cloudflare's bot challenge from a runner.
 * When that happens this says so and FAILS, rather than reporting the first
 * half as a verification of production — a check that cannot see the site has
 * not seen the site.
 */
import { build } from "esbuild";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);
const ORIGIN = String(args.origin ?? process.env.ORIGIN ?? "https://banan.to").replace(/\/$/, "");
/** How many of the catalogue's own findings to open BEYOND the named six. */
const OPEN = Number(args.open ?? 2);
/**
 * A wall-clock ceiling on the browser half.
 *
 * NOT because a run hung — one did not. I cancelled the first run believing it
 * had, having read elapsed time from a sandbox whose clock does not track the
 * runner's; GitHub's own timestamps said two minutes. The bound is here on its
 * own merits, which the misreading only made me look at: fourteen games × two
 * navigations × a 90-second budget is 42 minutes of permission inside a job
 * that is allowed 30, so a slow enough site really can end the job before the
 * report is written — and a check that cannot finish has verified nothing.
 *
 * Now the clock stops it, the report is written either way, and the number of
 * games opened is printed beside the number planned, so a short run says so
 * instead of looking like a complete pass.
 */
const DEADLINE_MS = Number(args.deadline ?? 9) * 60_000;
/** One navigation's budget. Long enough for a slow page, short enough to lose. */
const NAV_MS = Number(args.nav ?? 40) * 1_000;
const SETTLE_MS = Number(args.settle ?? 2_500);
const startedAt = Date.now();
const timeLeft = () => DEADLINE_MS - (Date.now() - startedAt);

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
  writeFileSync("cheapest-option-check.md", `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
  }
};
const money = (n) => Number(n || 0).toLocaleString("en-US");
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
    /* Reported by the guard below. */
  }
}
if (!process.env["D1_DATABASE_ID"] && process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  process.env["D1_DATABASE_ID"] = process.env["CLOUDFLARE_D1_DATABASE_ID"];
}
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) fail(`مفقود ${key}`);
}

const outfile = path.resolve(".cheapest-option-bundle.mjs");
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

say(`# هل تعرض البطاقة أرخص خيار في المنتج؟`);
say();
say(`المصدر: قاعدة البيانات الحيّة، ثم متصفّح حقيقي على \`${ORIGIN}\`.`);
say();

const store = await app.getStore();
const products = Array.isArray(store?.products) ? store.products : [];
if (products.length < 100) fail(`الكتالوج أعاد ${products.length} منتجًا فقط — هذه ليست قراءة صحيحة`);

const games = products.filter((p) => {
  const kind = String(p?.kind ?? "").toLowerCase();
  const schema = String(p?.schemaId ?? "").toLowerCase();
  return (
    !["hardware", "device", "accessory", "amiibo", "collectible", "gift_card", "used"].includes(kind) &&
    schema !== "gift_card"
  );
});

const numOf = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number.parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Every price a customer can actually pay for this product.
 *
 * The base belongs in here and that is the whole fix: `resolveUnitPrice` with
 * nothing selected charges `product.price`, so on a product whose only option
 * is an online account the base is a real, buyable, cheaper choice — and it
 * was the one the card used to hide.
 */
const buyablePrices = (product) => {
  const out = [];
  const base = numOf(product?.accountPrice) || numOf(product?.price);
  if (base > 0) out.push(base);
  for (const row of Array.isArray(product?.options) ? product.options : []) {
    const price = numOf(row?.price);
    if (price > 0) out.push(price);
  }
  for (const row of app.pricingTypeRows(product) ?? []) {
    const price = numOf(row?.price);
    if (price > 0) out.push(price);
  }
  for (const row of Array.isArray(product?.variants) ? product.variants : []) {
    const price = numOf(row?.price);
    if (price > 0) out.push(price);
  }
  return out;
};

const rows = [];
for (const product of games) {
  const prices = buyablePrices(product);
  if (!prices.length) continue;
  const cheapest = Math.min(...prices);
  const shown = numOf(app.listingPricing(product)?.unitPrice);
  if (shown <= 0) continue;
  rows.push({
    id: String(product.id ?? ""),
    slug: String(app.getProductSlug(product) || product.id || ""),
    title: String(product.titleEn || product.title || product.id || ""),
    shown,
    cheapest,
    dearest: Math.max(...prices),
    ok: shown === cheapest,
  });
}

const wrong = rows.filter((r) => !r.ok);
say(`## القاعدة على كامل الكتالوج`);
say();
say(`- ألعاب لها سعر واحد على الأقل: **${rows.length}**`);
say(`- البطاقة تعرض أرخص خيار قابل للشراء: **${rows.length - wrong.length}**`);
say(`- تعرض أغلى من الأرخص: **${wrong.length}**`);
say();
if (wrong.length) {
  say(`| اللعبة | تعرض | الأرخص |`);
  say(`| --- | ---: | ---: |`);
  for (const r of wrong.slice(0, 30)) {
    say(`| ${r.title.slice(0, 40)} | ${money(r.shown)} | ${money(r.cheapest)} |`);
  }
  say();
}

/*
  WHICH GAMES TO OPEN ON THE SITE.

  The six the owner was looking at, by name, because they are the ones whose
  answer changed — and a check that opened a random sample could pass without
  ever touching them. Any game whose card and cheapest price still disagree is
  added, because that is a live failure and it should be seen on the screen.
*/
const NAMED = [
  "super mario odyssey",
  "mario kart world",
  "super mario party jamboree",
  "cyberpunk 2077",
  "pragmata",
  "resident evil requiem",
];
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const chosen = [];
for (const name of NAMED) {
  const hit = rows.find((r) => norm(r.title).includes(name));
  if (hit && !chosen.some((c) => c.id === hit.id)) chosen.push(hit);
}
for (const r of wrong) {
  if (chosen.length >= OPEN + NAMED.length) break;
  if (!chosen.some((c) => c.id === r.id)) chosen.push(r);
}

say(`## ما تعرضه الشاشة فعلًا`);
say();
if (!chosen.length) fail(`لم أجد أيًّا من الألعاب المذكورة في الكتالوج — لم أتحقق من شيء`);

/*
  THE BROWSER, WHEREVER THIS RUNS.

  A runner that ran `playwright install` has the browser where playwright-core
  looks for it by itself, and naming a path there would miss it. The sandbox
  these sessions run in ships Chromium at a fixed path instead. So an explicit
  path is used only when one of the known ones is really on disk, and otherwise
  the launcher is left to find its own — and a launch that finds nothing is
  reported as "I did not check production", never as a pass.
*/
const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROMIUM_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/opt/pw-browsers/chromium",
].filter(Boolean);
const executablePath = CANDIDATES.find((candidate) => existsSync(candidate));
say(`- المتصفّح: \`${executablePath ?? "الذي يجده playwright بنفسه"}\``);

let browser;
try {
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
} catch (error) {
  fail(`تعذّر تشغيل متصفّح على هذا المُشغّل (${String(error).slice(0, 100)}) — لم أتحقق من الإنتاج`);
}
const context = await browser.newContext({
  locale: "ar",
  viewport: { width: 390, height: 844 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();

const challenged = (title) => /just a moment|checking your browser|أمهلنا/i.test(title || "");

let reached = false;
try {
  const res = await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: NAV_MS });
  await page
    .waitForFunction(() => !/just a moment|checking your browser/i.test(document.title || ""), undefined, {
      timeout: 30_000,
    })
    .catch(() => {});
  reached = !challenged(await page.title()) && (res?.status() ?? 0) < 400;
  say(`- الصفحة الرئيسية: **${res?.status() ?? "—"}** · «${(await page.title()).slice(0, 50)}»`);
} catch (error) {
  say(`- تعذّر فتح الصفحة الرئيسية: ${String(error).slice(0, 120)}`);
}
if (!reached) {
  await browser.close().catch(() => {});
  fail(`لم أتجاوز درع Cloudflare بالمتصفّح — لم أقرأ الشاشة، ولن أقول إن التحقق تم`);
}
say();

/**
 * Move to a page the way a shopper does: INSIDE the app, not by asking for a
 * new document.
 *
 * Cloudflare answers this runner 403 on `/product/<slug>` and `/search`, while
 * serving `/` at 200 — so the first version of this check read six «تعذّرت
 * القراءة (403)» and verified nothing on the screen. That is a fact about
 * where the runner sits, not about the shop: a customer's phone is served
 * these pages perfectly well.
 *
 * A shopper does not request those documents either. They land once, and every
 * tap after that is the router swapping the view from a catalogue the browser
 * already holds. `pushState` + `popstate` is exactly that transition — TanStack
 * Router listens for it — so the page under test is the real one, rendered by
 * the real code, with no second request for Cloudflare to refuse.
 */
const routeTo = async (path) => {
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await page.waitForTimeout(SETTLE_MS);
};

/** Every price-shaped number inside one element's text. */
const numbersIn = (text) =>
  Array.from(String(text ?? "").matchAll(/\d[\d,]{2,}/g))
    .map((m) => Number(m[0].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n >= 500);

say(`| اللعبة | المتوقع | البطاقة | الصفحة |`);
say(`| --- | ---: | ---: | ---: |`);
let cardOk = 0;
let cardBad = 0;
let cardUnread = 0;
let pageOk = 0;
let pageBad = 0;
let pageUnread = 0;
const misses = [];

let opened = 0;
for (const row of chosen) {
  if (timeLeft() <= 0) break;
  opened += 1;
  let cardCell = "تعذّرت القراءة";
  let pageCell = "تعذّرت القراءة";

  /* The card, on the surface the owner photographed. */
  try {
    await routeTo(`/search?q=${encodeURIComponent(row.title)}`);
    const card = page.locator(`a[href*="/product/${row.slug}"]`).first();
    const text = (await card.innerText({ timeout: 6_000 }).catch(() => "")) || "";
    const found = numbersIn(text);
    if (!text) {
      cardUnread += 1;
    } else if (found.includes(row.cheapest)) {
      cardOk += 1;
      cardCell = `✓ ${money(row.cheapest)}`;
    } else {
      cardBad += 1;
      cardCell = `✗ ${found.map(money).join(" / ") || "—"}`;
      misses.push({ ...row, where: "البطاقة", saw: found });
    }
  } catch (error) {
    cardUnread += 1;
    cardCell = `تعذّر: ${String(error).slice(0, 30)}`;
  }

  /* And the page the card opens. */
  try {
    await routeTo(`/product/${encodeURIComponent(row.slug)}`);
    const text = (await page.locator("body").innerText().catch(() => "")) || "";
    if (!text) {
      pageUnread += 1;
      pageCell = "تعذّرت القراءة";
    } else if (numbersIn(text).includes(row.cheapest)) {
      pageOk += 1;
      pageCell = `✓ ${money(row.cheapest)}`;
    } else {
      pageBad += 1;
      pageCell = "✗";
      misses.push({ ...row, where: "الصفحة", saw: numbersIn(text).slice(0, 6) });
    }
  } catch (error) {
    pageUnread += 1;
    pageCell = `تعذّر: ${String(error).slice(0, 30)}`;
  }

  say(`| ${row.title.slice(0, 34)} | ${money(row.cheapest)} | ${cardCell} | ${pageCell} |`);
}
await browser.close().catch(() => {});
say();

if (misses.length) {
  say(`## ما لم يظهر`);
  say();
  for (const m of misses.slice(0, 12)) {
    say(`- **${m.title.slice(0, 44)}** — ${m.where}: متوقع ${money(m.cheapest)}، وجدت ${m.saw.map(money).join(" / ") || "لا شيء"}`);
  }
  say();
}

/*
  LAST IN THE LOG, deliberately: a job log is read as a tail, so the numbers
  that decide whether this shipped have to be the final lines.
*/
say(`## الخلاصة`);
say();
say(`- ألعاب قِيست: **${rows.length}**`);
say(`- البطاقة = أرخص خيار قابل للشراء: **${rows.length - wrong.length}** · مخالفة: **${wrong.length}**`);
say(`- كان المخطط فتحها: **${chosen.length}** · فُتحت فعلًا قبل انتهاء المهلة: **${opened}**`);
say(`- بطاقة تعرض الرقم المتوقع: **${cardOk}** · لا تعرضه: **${cardBad}** · تعذّرت قراءتها: **${cardUnread}**`);
say(`- صفحة تعرض الرقم المتوقع: **${pageOk}** · لا تعرضه: **${pageBad}** · تعذّرت قراءتها: **${pageUnread}**`);

flush();
rmSync(outfile, { force: true });

/* Nothing read is not a pass. */
if (cardOk + cardBad === 0 && pageOk + pageBad === 0) process.exit(1);
process.exit(wrong.length || cardBad || pageBad ? 1 : 0);
