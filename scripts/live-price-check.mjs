#!/usr/bin/env node
/**
 * The prices a shopper's browser receives, read from banan.to itself.
 *
 * Every other price check in this repository reads D1, and D1 is not what a
 * customer sees: between them sit the Worker's own catalogue cache, keyed on
 * the catalogue version, and the browser's revalidation of `/api/data`. A
 * price that is right in the database and stale on the screen is still a
 * wrong price. So this opens the real site in a real browser and asks
 * `/api/data` FROM THE PAGE — same origin, the request the storefront itself
 * makes, past the bot challenge a bare fetch from a runner is answered with.
 *
 * Written for the yuan rise («مثلا mario kart world سعرها الحالي ٩ الف فبعد
 * الزباده تصبح ١٢ الف»), and kept general: `--expect id=price,…` names the
 * products and bundles to hold to a price, and the run fails on any that the
 * live shop serves differently.
 *
 * READ ONLY. It signs in as nobody and presses nothing. It prints prices,
 * which the shop shows to anyone, and counts — never a cost.
 *
 * Usage:
 *   node scripts/live-price-check.mjs [--origin https://banan.to]
 *                                     [--expect prd_x=12000,bnd_y=12000]
 */
import { existsSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);
const ORIGIN = String(args.origin ?? process.env.ORIGIN ?? "https://banan.to").replace(/\/$/, "");
const EXPECT = new Map(
  String(args.expect ?? process.env.EXPECT ?? "")
    .split(",")
    .map((pair) => pair.trim().split("="))
    .filter(([id, price]) => id && Number(price) > 0)
    .map(([id, price]) => [id, Number(price)]),
);
const OUT = "live-price-check.md";

const lines = [];
const say = (t = "") => {
  lines.push(String(t));
  console.log(String(t));
};
const flush = () => {
  writeFileSync(OUT, `${lines.join("\n")}\n`);
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
const amount = (v) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
/** The online account's price, wherever this product keeps it. */
const onlineOf = (p) => {
  if (amount(p?.accountOnlinePrice)) return amount(p.accountOnlinePrice);
  for (const list of [p?.types, p?.variants, p?.options]) {
    for (const row of Array.isArray(list) ? list : []) {
      const name = `${row?.id ?? ""} ${row?.name ?? ""}`;
      if (/online|أونلاين|اونلاين/i.test(name) && !/dlc|إضاف|اضاف|expansion|deluxe/i.test(name)) {
        if (amount(row?.price)) return amount(row.price);
      }
    }
  }
  return 0;
};

say(`# الأسعار كما يستلمها متصفّح الزبون`);
say();
say(`- الموقع: ${ORIGIN}`);
say(`- شُغّل في ${new Date().toISOString()} — قراءة فقط.`);

const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate));

let browser;
try {
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
} catch (error) {
  fail(`تعذّر تشغيل متصفّح (${String(error).slice(0, 120)})`);
}
const context = await browser.newContext({
  locale: "ar",
  viewport: { width: 390, height: 844 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
const home = await page
  .goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  .catch((error) => fail(`تعذّر فتح ${ORIGIN} (${String(error).split("\n")[0].slice(0, 120)})`));
await page
  .waitForFunction(() => !/just a moment|checking your browser/i.test(document.title || ""), undefined, {
    timeout: 30_000,
  })
  .catch(() => {});
if (!home || home.status() >= 400) fail(`الصفحة الرئيسية ردّت ${home ? home.status() : "بلا رد"}`);

const served = await page.evaluate(async () => {
  const res = await fetch("/api/data", { headers: { accept: "application/json" }, cache: "no-store" });
  return {
    status: res.status,
    version: res.headers.get("x-catalog-version"),
    cache: res.headers.get("x-cache-status"),
    body: await res.text(),
  };
});
await browser.close();

let data;
try {
  data = JSON.parse(served.body);
} catch {
  fail(`\`/api/data\` ردّ ${served.status} بغير JSON (${served.body.length} حرفًا)`);
}
const products = Array.isArray(data?.products) ? data.products : [];
const bundles = Array.isArray(data?.bundles) ? data.bundles : [];

say(`- \`/api/data\`: HTTP ${served.status} · نسخة الكتالوج ${served.version ?? "—"} · ${served.cache ?? "—"}`);
say(`- منتجات ظاهرة للزبون: **${products.length}** · حزم: ${bundles.length}`);
say();

/* The ladder the shop now quotes for its ordinary offline accounts. */
const ladder = new Map();
for (const p of products) {
  const price = amount(p?.price);
  if (price) ladder.set(price, (ladder.get(price) ?? 0) + 1);
}
say(`## أكثر الأسعار الأساسية شيوعًا`);
say();
say(`| السعر | عدد المنتجات |`);
say(`| ---: | ---: |`);
for (const [price, n] of [...ladder].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  say(`| ${money(price)} | ${n} |`);
}
say();

const misses = [];
if (EXPECT.size) {
  say(`## المنتجات المسمّاة`);
  say();
  say(`| | السعر المعروض | المتوقع | الأونلاين | |`);
  say(`| --- | ---: | ---: | ---: | :---: |`);
  for (const [id, want] of EXPECT) {
    const item = products.find((p) => String(p?.id) === id) ?? bundles.find((b) => String(b?.id) === id);
    if (!item) {
      misses.push(`${id}: ليس في ما يستلمه الزبون`);
      say(`| \`${id}\` | — | ${money(want)} | — | ✗ |`);
      continue;
    }
    const got = amount(item.price);
    const ok = got === want;
    if (!ok) misses.push(`${item.title ?? id}: ${money(got)} والمتوقع ${money(want)}`);
    say(
      `| ${String(item.title ?? id).slice(0, 48)} | ${money(got)} | ${money(want)} | ${money(onlineOf(item))} | ${ok ? "✓" : "✗"} |`,
    );
  }
  say();
}

if (misses.length) fail(`الموقع يعرض غير المتوقع: ${misses.join("؛ ")}`);
say(EXPECT.size ? `**كل سعر مسمّى يعرضه الموقع كما هو متوقع.**` : `**قُرئ الكتالوج المعروض.**`);
flush();
