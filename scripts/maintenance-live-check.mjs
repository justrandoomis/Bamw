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
  { path: "/", feature: "discTrade", words: "تحت الصيانة", what: "بطاقة الاستبدال في الرئيسية" },
  { path: "/disc_trade", feature: "discTrade", words: "استبدال الأقراص تحت الصيانة" },
  { path: "/wheel", feature: "roulette", words: "الروليت تحت الصيانة" },
  { path: "/banana_market", feature: "bananaMarket", words: "سوق الموز تحت الصيانة" },
];

/*
  The edge's bot challenge, by every name it answers with. A challenge is not a
  verdict on the page: Cloudflare refusing a runner's IP says nothing about
  what a customer is shown.
*/
const CHALLENGE =
  /just a moment|checking your browser|security verification|attention required|cf-chl|challenge-platform/i;

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

const looksChallenged = async () =>
  CHALLENGE.test(await page.title().catch(() => "")) ||
  CHALLENGE.test((await page.content().catch(() => "")).slice(0, 20_000));
/** Up to `seconds` for a challenge to clear, the way a visitor's browser waits. */
const waitOutChallenge = async (seconds) => {
  for (let i = 0; i < seconds && (await looksChallenged()); i += 1)
    await page.waitForTimeout(1_000);
  return !(await looksChallenged());
};
const open = (path) =>
  page
    .goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
    .catch((error) => ({ error }));

/*
  ONE PAGE LOAD, AND EVERYTHING ELSE FROM INSIDE IT.

  The first run went straight to `/disc_trade` and was answered 403 on every
  request after it. The second opened the home page first and got it — the
  trade card read «تحت الصيانة» — and then 403 on every fresh page load and on
  `/api/health`. The edge lets a runner's browser in once; it does not let it
  keep knocking. So, as the market checker found before: the home page is the
  only document requested, the two server questions are asked from it at
  once, and every other screen is reached the way a member reaches it — inside
  the app, by `pushState` + `popstate`, the transition TanStack Router listens
  for, with nothing new for the edge to refuse.
*/
await open("/");
await waitOutChallenge(30);
const homeChallenged = await looksChallenged();

/* The build the site says it is, so the screens below can be tied to a commit. */
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

const routeTo = (to) =>
  page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, to);

const results = [];
for (const screen of SCREENS) {
  const label = screen.what ?? screen.path;
  if (homeChallenged) {
    results.push({
      label,
      ok: false,
      skipped: true,
      detail: "حماية الحافة اعترضت المتصفح — غير حاسم",
    });
    continue;
  }
  if (screen.path !== "/") await routeTo(screen.path).catch(() => {});
  /*
    Waited for, not read at once: the screen is drawn by the client, and a
    notice that has not rendered YET is not a notice that is missing.

    And waited for BY ITS OWN WORDS. The home card's label and the trade page's
    notice share `data-maintenance="discTrade"`, and right after an in-app
    move the card is still on screen — so a bare attribute match read the
    card and called it the page. A screen's notice is the `role="status"`
    element carrying that screen's sentence; the card is neither.
  */
  const selector =
    screen.path === "/"
      ? `[data-maintenance="${screen.feature}"]`
      : `[role="status"][data-maintenance="${screen.feature}"]`;
  const notice = page.locator(selector).filter({ hasText: screen.words }).first();
  const seen = await notice
    .waitFor({ state: "attached", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  const text = seen ? (await notice.innerText().catch(() => "")).replace(/\s+/g, " ").trim() : "";
  const onScreen = seen
    ? ""
    : (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
  results.push({
    label,
    ok: seen && text.includes(screen.words),
    detail: text.slice(0, 90) || `لا إشعار صيانة${onScreen ? ` — على الشاشة: «${onScreen}»` : ""}`,
  });
}
await browser.close();

const quoteClosed =
  quote.status === 503 && quote.code === "maintenance" && quote.feature === "discTrade";
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
for (const r of results)
  say(`| ${r.label} | ${r.skipped ? "—" : r.ok ? "✓" : "✗"} | ${r.detail} |`);
say();

const failed = results.filter((r) => !r.ok && !r.skipped);
if (failed.length)
  fail(`${failed.length} فحصًا لم يجد الإغلاق: ${failed.map((r) => r.label).join("، ")}`);
/* A run in which nothing reached a verdict proved nothing, and must not read as a pass. */
if (!results.some((r) => r.ok)) fail(`لم يصل أي فحص إلى حكم — حماية الحافة اعترضت كل طلب`);
const unsure = results.filter((r) => r.skipped).length;
say(
  unsure
    ? `**كل فحص وصل إلى حكم وجد الإغلاق على ${ORIGIN}** — و${unsure} غير حاسم بسبب حماية الحافة.`
    : `**كل ميزة مغلقة تظهر مغلقة على ${ORIGIN}.**`,
);
flush();
