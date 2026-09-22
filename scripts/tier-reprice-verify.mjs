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
  Read from INSIDE the page. The clearance the browser just earned rides on the
  request, so this is the same call the shop's own JavaScript makes.
*/
const payload = await page.evaluate(async () => {
  const attempt = async (url) => {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) return { url, status: res.status };
      return { url, status: res.status, body: await res.json() };
    } catch (error) {
      return { url, status: 0, error: String(error) };
    }
  };
  const slim = await attempt("/api/data?slim=1");
  if (slim.body) return slim;
  return await attempt("/api/data");
});
await browser.close().catch(() => {});

say(`- \`${payload.url}\` من داخل الصفحة → **${payload.status}**`);
say();
if (!payload.body) stop(`لم أستطع قراءة الكتالوج من الموقع. لم أتحقق من الإنتاج.`);

const store = payload.body?.store ?? payload.body;
const products = Array.isArray(store?.products) ? store.products : [];
say(`- منتجات يخدمها الموقع: **${products.length}**`);

const withTiers = products.filter((p) => Array.isArray(p?.types) && p.types.length > 0);
say(`- منها تحمل طبقات \`types\`: **${withTiers.length}**`);
say();
if (!withTiers.length) stop(`الموقع لا يخدم أي منتج بطبقات — لا يمكن التحقق.`);

/* 1. Are the rules satisfied by what is live? */
const stillMoving = [];
for (const product of withTiers) {
  const result = app.repriceTiers({
    id: String(product.id ?? ""),
    title: String(product.title || product.titleEn || ""),
    kind: String(product.kind ?? ""),
    schemaId: String(product.schemaId ?? product.schema_id ?? ""),
    types: product.types,
  });
  for (const p of result.proposals) if (p.changed) stillMoving.push({ title: result.title, p });
}

say(`## 1. هل القواعد مستقرة على ما يُخدَم؟`);
say();
say(`طبقات ما زالت تريد الحركة: **${stillMoving.length}**`);
say();
if (stillMoving.length) {
  say(`| المنتج | الطبقة | التكلفة | الآن | تريد |`);
  say(`| --- | --- | --- | --- | --- |`);
  for (const row of stillMoving.slice(0, 40)) {
    say(
      `| ${String(row.title).slice(0, 44)} | \`${row.p.kind}\` | ${money(row.p.cost)} | ${money(row.p.oldPrice)} | ${money(row.p.newPrice)} |`,
    );
  }
  if (stillMoving.length > 40) say(`| … | ${stillMoving.length - 40} أخرى | | | |`);
  say();
  say(
    `المتوقع هنا طبقتا Super Smash Bros. Ultimate وحدهما — محجوزتان لأن تكلفتهما موضع شك. أي شيء آخر يعني أن الكتابة لم تصل.`,
  );
  say();
}

/* 2. Does the page show what the till charges? */
let oneNumber = 0;
const mismatched = [];
let variantsPresent = 0;
let variantsStale = 0;
for (const product of withTiers) {
  const tiers = app.classifyTiers(product.types);
  const offline = app.tierOf(tiers, "offline_base");
  if (!offline || offline.price <= 0) continue;
  const shown = numOf(product.accountPrice) || numOf(product.price);
  if (shown <= 0) continue;
  if (shown === offline.price) oneNumber += 1;
  else {
    mismatched.push({
      title: String(product.title || product.titleEn || ""),
      id: String(product.id ?? ""),
      shown,
      charged: offline.price,
    });
  }
  /*
    `variants` is the older name for the same list, and `resolveUnitPrice`
    falls back to it whenever `types` is not an array. Nothing serves it while
    `types` holds, so this is counted rather than fixed — a number to know, not
    a live fault.
  */
  if (Array.isArray(product.variants) && product.variants.length) {
    variantsPresent += 1;
    const mirror = app.tierOf(app.classifyTiers(product.variants), "offline_base");
    if (mirror && mirror.price > 0 && mirror.price !== offline.price) variantsStale += 1;
  }
}

say(`## 2. هل يُعرض السعر الذي يُحاسَب به؟`);
say();
say(
  `الواجهة تقرأ \`accountPrice\` ثم \`price\`؛ والسلة تحاسب بـ \`types[offline_base].price\`. هنا تُقارن الاثنتان على كل منتج يخدمه الموقع.`,
);
say();
say(`- يعرض ويحاسب بالرقم نفسه: **${oneNumber}**`);
say(`- يعرض رقمًا ويحاسب بآخر: **${mismatched.length}**`);
say(`- يحمل \`variants\` كذلك: **${variantsPresent}** · منها متأخرة عن \`types\`: **${variantsStale}**`);
say();
if (mismatched.length) {
  mismatched.sort((a, b) => Math.abs(b.charged - b.shown) - Math.abs(a.charged - a.shown));
  say(`| المنتج | يُعرض | يُحاسَب | الفرق |`);
  say(`| --- | --- | --- | --- |`);
  for (const row of mismatched.slice(0, 40)) {
    const gap = row.charged - row.shown;
    say(
      `| ${row.title.slice(0, 44)} \`${row.id.slice(-6)}\` | ${money(row.shown)} | ${money(row.charged)} | ${gap > 0 ? `+${money(gap)}` : money(gap)} |`,
    );
  }
  if (mismatched.length > 40) say(`| … | ${mismatched.length - 40} أخرى | | |`);
  say();
}

say(`## الخلاصة`);
say();
say(`- منتجات بطبقات على الموقع: **${withTiers.length}**`);
say(`- طبقات ما زالت تريد الحركة: **${stillMoving.length}**`);
say(`- تعرض وتحاسب بالرقم نفسه: **${oneNumber}**`);
say(`- تعرض رقمًا وتحاسب بآخر: **${mismatched.length}**`);
say(`- \`variants\` متأخرة عن \`types\`: **${variantsStale}** من ${variantsPresent}`);

flush();
rmSync(outfile, { force: true });
process.exit(0);
