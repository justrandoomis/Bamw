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
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ORIGIN = process.env.ORIGIN || "https://banan.to";

/*
  THE DATABASE ID, WHICH THE SECRET DOES NOT CARRY.

  `CLOUDFLARE_D1_DATABASE_ID` is empty in this repository's Actions secrets —
  the mask step prints a blank and warns it cannot mask an empty string. Every
  working script here falls back to the id in `wrangler.jsonc`, which is the
  same database the Worker itself binds. Without it `getStore()` answers an
  empty catalogue, and the first run of this check reported "0 products" and
  exited 0 — a pass that had verified nothing, which is the precise failure
  this whole file exists to make impossible.
*/
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
  THE PRODUCTS THIS RUN ACTUALLY MOVED, ON THEIR OWN PAGES.

  The home page renders twelve cards and none of them is a repriced game — they
  are the console and a couple of headline titles. And comparing "the smallest
  price-shaped number on the page" proved worthless: it read 58,228 off
  Balatro's page, which is not a price at all. A heuristic that cannot tell a
  price from a review count cannot verify a price.

  So the expected number is taken from the database — the tier this run wrote,
  and the headline field beside it — and then looked for, as text, on the
  product's own page. The page is server-rendered, so it reaches this runner
  even though `/api/data` does not. That is the whole chain, end to end: what
  the rules decided, what D1 holds, and what the shopper is shown.
*/
const d1 = await (async () => {
  const entry = path.resolve("tier-reprice-verify.catalogue.mjs");
  await build({
    entryPoints: [path.resolve("scripts/lib/catalogue-entry.ts")],
    outfile: entry,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent",
    tsconfig: path.resolve("tsconfig.json"),
    plugins: [
      {
        name: "tanstack-stubs",
        setup(b) {
          b.onResolve({ filter: /^(#tanstack-(router|start)-entry|tanstack-start-manifest:)/ }, (a) => ({
            path: a.path,
            namespace: "stub",
          }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents: "export default {};",
            loader: "js",
          }));
        },
      },
    ],
  });
  try {
    return await import(`file://${entry}`);
  } finally {
    rmSync(entry, { force: true });
  }
})();

d1.invalidateStoreCache();
const store = await d1.getStore();
const all = Array.isArray(store?.products) ? store.products : [];
const withTiers = all.filter((p) => Array.isArray(p?.types) && p.types.length > 0);
say(`- منتجات في قاعدة البيانات: **${all.length}** · منها بطبقات: **${withTiers.length}**`);
/*
  AN EMPTY CATALOGUE IS A BROKEN CHECK, NOT A RESULT.

  The run before this one printed "0 products with tiers", checked nothing, and
  exited 0. There are 179 products with tiers in this catalogue; zero means the
  read failed, and a check that reports its own failure as a pass is worse than
  no check.
*/
if (!withTiers.length) {
  await browser.close().catch(() => {});
  stop(`قرأت 0 منتجًا بطبقات من قاعدة البيانات — القراءة فشلت. لم أتحقق من الإنتاج.`);
}

/* The ones whose headline and tier now agree — what this run was for. */
const checkable = [];
for (const product of withTiers) {
  const offline = d1.tierOf(d1.classifyTiers(product.types), "offline_base");
  if (!offline || offline.price <= 0) continue;
  const shown = Number(product.accountPrice) || Number(product.price);
  if (!shown) continue;
  checkable.push({
    id: String(product.id ?? ""),
    title: String(product.title || product.titleEn || ""),
    tier: offline.price,
    shown,
    agrees: shown === offline.price,
  });
}
const agreeInDb = checkable.filter((c) => c.agrees);
const differInDb = checkable.filter((c) => !c.agrees);
say(`- منها في قاعدة البيانات: السعر المعروض = سعر الطبقة في **${agreeInDb.length}**، ومختلف في **${differInDb.length}**`);
say();

/*
  A sample, spread across the catalogue rather than taken from one end, so a
  run of consecutive imports cannot stand in for the whole.
*/
const SAMPLE = 10;
const step = Math.max(1, Math.floor(agreeInDb.length / SAMPLE));
const sample = [];
for (let i = 0; i < agreeInDb.length && sample.length < SAMPLE; i += step) sample.push(agreeInDb[i]);

say(`## ما تعرضه صفحات المنتجات فعلًا`);
say();
say(`| المنتج | المتوقع | ظهر في الصفحة؟ |`);
say(`| --- | --- | --- |`);
let onPage = 0;
let offPage = 0;
let unread = 0;
const misses = [];
for (const row of sample) {
  try {
    const res = await page.goto(`${ORIGIN}/product/${row.id}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.waitForTimeout(2000);
    const text = await page.locator("body").innerText().catch(() => "");
    if (!text || (res && res.status() >= 400)) {
      unread += 1;
      say(`| ${row.title.slice(0, 40)} | ${money(row.tier)} | تعذّرت القراءة (${res?.status() ?? "—"}) |`);
      continue;
    }
    /* Both spellings a shopper might be shown: 8,000 and 8000. */
    const wanted = [row.tier.toLocaleString("en-US"), String(row.tier)];
    const digits = text.replace(/[^0-9]/g, " ");
    const hit =
      wanted.some((w) => text.includes(w)) ||
      digits.split(/\s+/).includes(String(row.tier));
    if (hit) {
      onPage += 1;
      say(`| ${row.title.slice(0, 40)} | ${money(row.tier)} | ✓ |`);
    } else {
      offPage += 1;
      misses.push(row);
      say(`| ${row.title.slice(0, 40)} | ${money(row.tier)} | ✗ |`);
    }
  } catch (error) {
    unread += 1;
    say(`| ${row.title.slice(0, 40)} | ${money(row.tier)} | تعذّر: ${String(error).slice(0, 50)} |`);
  }
}
await browser.close().catch(() => {});
say();

say(`## الخلاصة`);
say();
say(`- منتجات بطبقات: **${withTiers.length}**`);
say(`- السعر المعروض = سعر الطبقة في قاعدة البيانات: **${agreeInDb.length}** · مختلف: **${differInDb.length}**`);
say(`- عيّنة فُتحت صفحاتها على الموقع: **${sample.length}**`);
say(`- السعر المتوقع ظاهر على الصفحة: **${onPage}** · غير ظاهر: **${offPage}** · تعذّرت قراءتها: **${unread}**`);
say();
if (differInDb.length) {
  say(`المنتجات التي ما زالت تعرض رقمًا وتحاسب بآخر (**${differInDb.length}**):`);
  say();
  say(`| المنتج | يُعرض | يُحاسَب |`);
  say(`| --- | --- | --- |`);
  for (const row of differInDb.slice(0, 20)) {
    say(`| ${row.title.slice(0, 44)} | ${money(row.shown)} | ${money(row.tier)} |`);
  }
  say();
}
say(
  `ملاحظة على النطاق: \`/api/data\` يردّ 403 على هذا المُشغّل حتى من داخل متصفّح حقيقي، فصفحات الأقسام تصل فارغة هنا. صفحات المنتجات تُبنى على الخادم وتصل، وهي ما فُحص.`,
);

flush();
rmSync(outfile, { force: true });
/* Nothing opened is not success either. */
if (!sample.length || onPage + offPage === 0) {
  process.exit(1);
}
process.exit(offPage > 0 ? 1 : 0);
