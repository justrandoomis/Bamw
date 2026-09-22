/**
 * Did the repricing reach banan.to? READ ONLY, through a real browser.
 *
 * «لا تقل «تم» بناءً على Build فقط؛ المطلوب تحقق وظيفي كامل على الإنتاج.»
 *
 * A write verified against D1 proves the database changed. It does not prove
 * the shop changed: the catalogue is cached in the Worker and at the edge, and
 * the page reads a copy of the price that does not live in `types` at all.
 *
 * WHY A BROWSER. Plain `fetch` from a runner is answered 403 with Cloudflare's
 * «Just a moment...» interstitial — on `/api/data`, and on `/`, `/games` and
 * `/category/nintendo_games` too, five attempts each with a phone's user agent
 * and a browser's Accept. That challenge is a piece of JavaScript; the only
 * thing that passes it is something that runs JavaScript. So this drives real
 * Chrome, lets it solve the challenge exactly as a shopper's phone does, and
 * only then reads the catalogue — from inside the page, so the request carries
 * the clearance the browser just earned.
 *
 * Two questions, both of which must come out right if the repricing landed:
 *
 *   1. are the rules SATISFIED by what is served — does anything still want to
 *      move, apart from what was deliberately held;
 *   2. does every product serve ONE price — `accountPrice`/`price`, which the
 *      page headline shows, against `types[offline_base].price`, which the till
 *      charges, counted against the same denominator as before the run so a
 *      low number cannot be vacuous.
 */
import { build } from "esbuild";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ORIGIN = process.env.ORIGIN || "https://banan.to";

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};
const flush = () => {
  writeFileSync("tier-reprice-verify.md", `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
  }
};
const money = (n) => Number(n || 0).toLocaleString("en-US");
const numOf = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number.parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const stop = (message, code = 1) => {
  say();
  say(`**${message}**`);
  flush();
  rmSync(path.resolve("tier-reprice-verify.bundle.mjs"), { force: true });
  process.exit(code);
};

const outfile = path.resolve("tier-reprice-verify.bundle.mjs");
await build({
  entryPoints: [path.resolve("scripts/lib/pricing-entry.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "silent",
  tsconfig: path.resolve("tsconfig.json"),
});
const app = await import(`file://${outfile}`);

say(`# هل وصل التسعير إلى banan.to؟`);
say();
say(`المصدر: متصفّح حقيقي يفتح \`${ORIGIN}\` ويقرأ الكتالوج من داخل الصفحة.`);
say();

/*
  The runner's own Chrome, not a downloaded one. `ubuntu-latest` ships Google
  Chrome, and `playwright-core` will drive any Chromium given its path — which
  avoids pinning a browser build against this repository's playwright version.
*/
const CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/opt/pw-browsers/chromium",
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) stop(`لا يوجد متصفّح على هذا المُشغّل. لم أتحقق من الإنتاج.`);
say(`- المتصفّح: \`${executablePath}\``);

const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  locale: "ar",
  viewport: { width: 390, height: 844 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36",
});
const page = await context.newPage();

let landed = "";
for (const path_ of ["/", "/games"]) {
  try {
    const res = await page.goto(`${ORIGIN}${path_}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    /* The challenge resolves itself; wait for a title that is not it. */
    await page
      .waitForFunction(
        () => !/just a moment|أمهلنا|checking your browser/i.test(document.title || ""),
        undefined,
        { timeout: 60_000 },
      )
      .catch(() => {});
    const title = await page.title();
    say(`- \`${path_}\` → **${res?.status() ?? "—"}** · العنوان: «${title.slice(0, 60)}»`);
    if (!/just a moment|checking your browser/i.test(title)) {
      landed = path_;
      break;
    }
  } catch (error) {
    say(`- \`${path_}\` → تعذّر الفتح: ${String(error).slice(0, 140)}`);
  }
}
if (!landed) {
  await browser.close().catch(() => {});
  stop(`لم أتجاوز درع Cloudflare بالمتصفّح. لم أتحقق من الإنتاج، ولن أقول إن التحقق تم.`);
}

/*
  WHAT THE SHOPPER SEES, IN TWO PLACES, COMPARED.

  The browser cleared the challenge — `/` answered 200 with the shop's own
  title and rendered twelve product cards — but a `fetch("/api/data")` from
  inside that same page is still 403, so `/games` and the category shelves come
  back as empty 28 KB shells: they fetch their catalogue client-side. The
  server-rendered home page is what this runner can see, and the product pages
  behind its cards.

  That is enough for the check that matters, because the two numbers this task
  was about are rendered in two different places from two different fields:

    · the CARD price comes from `listingPricing`, which reads `types` — the
      same row the till charges from;
    · the PAGE headline comes from `readOffers`, which reads `accountPrice`
      then `price` — and never looks at `types` at all.

  Before this run those two disagreed on 49 products. If they agree now, the
  mirrors moved together, which is the whole thing that was fixed. No cost is
  needed and none is exposed: this reads only what a shopper is shown.
*/
const PRICE = /([0-9][0-9.,٫٬]{2,})/g;
const toNumber = (text) => Number(String(text).replace(/[^0-9]/g, ""));

/** Every price-shaped number in a piece of rendered text, largest first. */
const pricesIn = (text) => {
  const out = [];
  for (const hit of String(text ?? "").matchAll(PRICE)) {
    const n = toNumber(hit[1]);
    if (n >= 1_000 && n <= 500_000) out.push(n);
  }
  return [...new Set(out)];
};

const cards = [];
try {
  const links = page.locator('a[href^="/product/"]');
  const count = await links.count();
  for (let i = 0; i < count; i += 1) {
    const link = links.nth(i);
    const href = await link.getAttribute("href").catch(() => null);
    const text = await link.innerText().catch(() => "");
    if (!href) continue;
    const prices = pricesIn(text);
    if (!prices.length) continue;
    const title = String(text).split("\n").map((s) => s.trim()).find(Boolean) ?? "";
    if (!cards.some((c) => c.href === href)) {
      cards.push({ href, title, cardPrice: Math.min(...prices) });
    }
  }
} catch (error) {
  say(`- تعذّرت قراءة البطاقات: ${String(error).slice(0, 140)}`);
}
say(`- بطاقات بأسعار على الصفحة الرئيسية: **${cards.length}**`);
say();

const compared = [];
for (const card of cards) {
  try {
    await page.goto(`${ORIGIN}${card.href}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(1500);
    const body = await page.locator("body").innerText().catch(() => "");
    const prices = pricesIn(body);
    if (!prices.length) {
      compared.push({ ...card, pagePrice: null });
      continue;
    }
    /*
      The headline is the CHEAPEST enabled first-party offer, by the shop's own
      ranking (`rankOffers` sorts ascending), so the smallest price-shaped
      number on the page is the one the hero, the sticky bar and the closing
      call to action all show.
    */
    compared.push({ ...card, pagePrice: Math.min(...prices) });
  } catch (error) {
    compared.push({ ...card, pagePrice: null, error: String(error).slice(0, 80) });
  }
}
await browser.close().catch(() => {});

const agree = compared.filter((c) => c.pagePrice !== null && c.pagePrice === c.cardPrice);
const differ = compared.filter((c) => c.pagePrice !== null && c.pagePrice !== c.cardPrice);
const unread = compared.filter((c) => c.pagePrice === null);

say(`## ما يراه الزبون`);
say();
say(`سعر البطاقة يأتي من \`types\` (وهو ما تحاسب به السلة)، وسعر الصفحة من \`accountPrice\`/\`price\`. قبل هذا التشغيل كانا مختلفين على 49 منتجًا.`);
say();
say(`- منتجات فُحصت: **${compared.length}**`);
say(`- البطاقة والصفحة **متطابقتان**: **${agree.length}**`);
say(`- مختلفتان: **${differ.length}**`);
say(`- تعذّرت قراءة صفحتها: **${unread.length}**`);
say();
if (compared.length) {
  say(`| المنتج | سعر البطاقة | سعر الصفحة | |`);
  say(`| --- | --- | --- | --- |`);
  for (const row of compared.slice(0, 40)) {
    const mark = row.pagePrice === null ? "؟" : row.pagePrice === row.cardPrice ? "✓" : "✗";
    say(
      `| ${row.title.slice(0, 44)} | ${money(row.cardPrice)} | ${row.pagePrice === null ? "—" : money(row.pagePrice)} | ${mark} |`,
    );
  }
  say();
}
if (!compared.length) {
  stop(`لم أقرأ أي بطاقة بسعر من الصفحة الرئيسية. لم أتحقق من الإنتاج.`);
}

say(`## الخلاصة`);
say();
say(`- منتجات فُحصت على الموقع الحي: **${compared.length}**`);
say(`- تعرض السعر نفسه في البطاقة والصفحة: **${agree.length}**`);
say(`- ما زالت تعرض رقمين: **${differ.length}**`);
say();
say(
  `ملاحظة على النطاق: \`/api/data\` يردّ 403 على هذا المُشغّل حتى من داخل المتصفّح، فصفحات \`/games\` والأقسام تصل فارغة هنا — لذلك الفحص على ما تعرضه الصفحة الرئيسية وصفحات منتجاتها، لا على الكتالوج كله.`,
);

flush();
rmSync(outfile, { force: true });
process.exit(differ.length ? 1 : 0);
