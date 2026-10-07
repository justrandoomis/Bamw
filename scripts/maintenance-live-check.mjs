#!/usr/bin/env node
/**
 * Is every feature the owner closed actually closed on banan.to?
 *
 *   «حاليا الروليت والموز وسوق الموز … ( اجعلها تحت الصيانه )»
 *   «وقف ميزه استبدال الاقراص وجعلها تحت الصيانه · وادمج وانشر»
 *
 * The tests prove the code shuts each door. This proves that code is what
 * banan.to is SERVING: a real phone browser opens each closed screen and looks
 * for the notice the code renders (`data-maintenance="<feature>"`), and then
 * asks the one server door it can ask safely — a disc-trade QUOTE, which reads
 * the trade list and writes nothing even when the feature is open, and which
 * under maintenance must be answered 503 `maintenance`.
 *
 * READ ONLY. It signs in as nobody and never submits, spins, sells or redeems.
 * It prints the build the site reports and what each screen showed — nothing a
 * visitor could not see.
 *
 * Usage: node scripts/maintenance-live-check.mjs [--origin https://banan.to]
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
const OUT = "maintenance-live-check.md";

/** Each closed screen, and the words its notice must carry. */
const SCREENS = [
  { path: "/disc_trade", feature: "discTrade", words: "استبدال الأقراص تحت الصيانة" },
  { path: "/", feature: "discTrade", words: "تحت الصيانة", what: "بطاقة الاستبدال في الرئيسية" },
  { path: "/wheel", feature: "roulette", words: "الروليت تحت الصيانة" },
  { path: "/banana_market", feature: "bananaMarket", words: "سوق الموز تحت الصيانة" },
];

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

say(`# الميزات المغلقة على الإنتاج`);
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

const results = [];
for (const screen of SCREENS) {
  const label = screen.what ?? screen.path;
  const res = await page
    .goto(`${ORIGIN}${screen.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
    .catch((error) => ({ error }));
  if (res?.error || !res || res.status() >= 400) {
    const why = res?.error ? String(res.error).split("\n")[0].slice(0, 100) : `HTTP ${res?.status?.()}`;
    results.push({ label, ok: false, detail: why });
    continue;
  }
  /*
    Waited for, not read at once: the page is drawn by the client, and a
    notice that has not rendered YET is not a notice that is missing.
  */
  const notice = page.locator(`[data-maintenance="${screen.feature}"]`).first();
  const seen = await notice
    .waitFor({ state: "attached", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  const text = seen ? (await notice.innerText().catch(() => "")).replace(/\s+/g, " ").trim() : "";
  const challenged = /just a moment|checking your browser/i.test(await page.title().catch(() => ""));
  results.push({
    label,
    ok: seen && text.includes(screen.words),
    detail: challenged ? "حماية الحافة اعترضت المتصفح — غير حاسم" : text.slice(0, 90) || "لا إشعار صيانة",
  });
}

/* The build the site says it is, so the screens above can be tied to a commit. */
const build = await page
  .evaluate(async () => {
    try {
      const res = await fetch("/api/health", { headers: { accept: "application/json" } });
      if (!res.ok) return `HTTP ${res.status}`;
      const body = await res.json();
      return typeof body?.build === "string" ? body.build : "الحقل غير موجود";
    } catch (error) {
      return `تعذّرت القراءة (${String(error).slice(0, 60)})`;
    }
  })
  .catch(() => "تعذّرت القراءة");

/* The server door: a quote, which writes nothing even when the feature is open. */
const quote = await page
  .evaluate(async () => {
    try {
      const res = await fetch("/api/disc-trade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "quote", game_name: "Mario Kart 8 Deluxe" }),
      });
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: res.status, code: body?.code ?? null, feature: body?.feature ?? null };
    } catch (error) {
      return { status: 0, code: null, feature: null, error: String(error).slice(0, 80) };
    }
  })
  .catch(() => ({ status: 0, code: null, feature: null }));
await browser.close();

const quoteClosed = quote.status === 503 && quote.code === "maintenance" && quote.feature === "discTrade";
const quoteChallenged = quote.status === 403 && !quote.code;
results.push({
  label: "طلب تسعير استبدال عبر الخادم",
  ok: quoteClosed,
  skipped: quoteChallenged,
  detail: quoteChallenged
    ? "HTTP 403 من حماية الحافة — غير حاسم"
    : `HTTP ${quote.status}${quote.code ? ` · ${quote.code}` : ""}${quote.error ? ` · ${quote.error}` : ""}`,
});

say(`- البناء الذي يخدم: \`${build}\``);
say();
say(`| الفحص | النتيجة | ما ظهر |`);
say(`| --- | :---: | --- |`);
for (const r of results) say(`| ${r.label} | ${r.skipped ? "—" : r.ok ? "✓" : "✗"} | ${r.detail} |`);
say();

const failed = results.filter((r) => !r.ok && !r.skipped);
if (failed.length) fail(`${failed.length} فحصًا لم يجد الإغلاق: ${failed.map((r) => r.label).join("، ")}`);
say(`**كل ميزة مغلقة تظهر مغلقة على ${ORIGIN}.**`);
flush();
