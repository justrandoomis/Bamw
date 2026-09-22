#!/usr/bin/env node
/**
 * Is the rebuilt market — and the roulette — really on banan.to?
 *
 * «لا تقل «تم» بناءً على Build فقط؛ المطلوب تحقق وظيفي كامل على الإنتاج.»
 *
 * A green CI run proves the code compiles and the tests pass. It does not
 * prove the owner can open banan.to and find the thing he asked for, and this
 * session has twice now found production behaving differently from a passing
 * build. So this opens the real site in a real mobile browser and reads the
 * real screens.
 *
 * STRICTLY READ-ONLY, and deliberately so. It signs in as nobody, presses no
 * button that spends anything, and never spins: a spin costs a ticket and
 * awards a prize, so a verification that spun would be creating commercial
 * data to prove a page renders. Every assertion below is about what is DRAWN.
 *
 * What it checks, one per thing the owner asked for:
 *
 *   1. `/banana_market` is one page — the price, the chart's five ranges, the
 *      ticket shop and the rewards shelf are all on it.
 *   2. The member-to-member marketplace is GONE from it. «احذف مفهوم
 *      Marketplace بين المستخدمين بالكامل» is a removal, and a removal is only
 *      verified by looking for what must not be there.
 *   3. `/wheel` is a roulette: the strip, the 1–10 ticket selector, and the
 *      odds printed as real chances with losing among them.
 *   4. `/banana_buy` and `/banana_redeem` land on the market rather than 404.
 *
 * WHEN IT CANNOT SEE THE SITE IT SAYS SO AND FAILS. Cloudflare answers this
 * runner 403 on some paths, and a check that was refused has not verified
 * anything — reporting it as a pass would be the exact lie the owner's rule
 * exists to prevent.
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
const NAV_MS = Number(args.nav ?? 45) * 1_000;
const SETTLE_MS = Number(args.settle ?? 3_000);

const lines = [];
const say = (t = "") => {
  lines.push(String(t));
  console.log(String(t));
};
const flush = () => {
  writeFileSync("market-roulette-check.md", `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
  }
};
const fail = (message) => {
  say();
  say(`## توقف: ${message}`);
  flush();
  process.exit(1);
};

say(`# سوق الموز والروليت على الإنتاج`);
say();
say(`- الموقع: ${ORIGIN}`);

const CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "/opt/pw-browsers/chromium-headless-shell",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
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
  fail(`تعذّر تشغيل متصفّح (${String(error).slice(0, 120)}) — لم أتحقق من الإنتاج`);
}
/* A phone, because «التصميم يجب أن يكون Mobile-first». */
const context = await browser.newContext({
  locale: "ar",
  viewport: { width: 390, height: 844 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();

try {
  const res = await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: NAV_MS });
  await page
    .waitForFunction(
      () => !/just a moment|checking your browser/i.test(document.title || ""),
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => {});
  if (!res || res.status() >= 400) {
    fail(`الصفحة الرئيسية ردّت ${res ? res.status() : "بلا رد"} — لم أتحقق من الإنتاج`);
  }
  say(`- الصفحة الرئيسية: ${res.status()}`);
} catch (error) {
  fail(`تعذّر فتح الموقع (${String(error).slice(0, 120)}) — لم أتحقق من الإنتاج`);
}

/*
  In-app navigation, not a fresh document request.

  Cloudflare answers this runner 403 on several paths while answering `/` with
  200. A single-page app does not need a second request to change screens, and
  `pushState` + `popstate` is the transition TanStack Router listens for — so
  the screen under test is the real one, rendered by the real deployed code,
  with nothing for Cloudflare to refuse.
*/
const routeTo = async (to) => {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, to);
  await page.waitForTimeout(SETTLE_MS);
};
const bodyText = async () => (await page.locator("body").innerText().catch(() => "")) || "";
const here = async () => await page.evaluate(() => window.location.pathname);

let failures = 0;
const results = [];
/** One assertion, recorded either way, so the table shows the whole picture. */
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
};

// ─── 1 & 2. The market ────────────────────────────────────────────────────
await routeTo("/banana_market");
const market = await bodyText();
if (!market.trim()) {
  fail("صفحة سوق الموز لم تُقرأ — لم أتحقق من الإنتاج");
}
say(`- طول نص سوق الموز: ${market.length} حرفًا`);

check("العنوان «سوق الموز»", market.includes("سوق الموز"));
check(
  "مدى الرسم البياني الخمسة",
  ["1H", "4H", "12H", "1D", "7D"].every((r) => market.includes(r)),
  ["1H", "4H", "12H", "1D", "7D"].filter((r) => !market.includes(r)).join(" ") || "كلها",
);
check("قسم التذاكر", /تذكرة|تذاكر/.test(market));
check("رفّ الاستبدال", /استبدال|المكافآت|استبدل/.test(market));
check("زر البيع للمتجر", /بيع/.test(market));

/*
  The removal, checked as a removal. «أوقف endpoints/actions التي تسمح بإنشاء
  Listings جديدة» — so the words that only ever appeared on a listing form must
  be absent from the shipped page.
*/
const REMOVED = ["السعر لكل موزة", "عروضي", "عرض جديد", "أنشئ عرضًا"];
const stillThere = REMOVED.filter((w) => market.includes(w));
check("لا سوق بين الأعضاء", stillThere.length === 0, stillThere.join(" / "));

// ─── 3. The roulette ──────────────────────────────────────────────────────
await routeTo("/wheel");
const wheel = await bodyText();
if (!wheel.trim()) {
  fail("صفحة الروليت لم تُقرأ — لم أتحقق من الإنتاج");
}
say(`- طول نص الروليت: ${wheel.length} حرفًا`);

check("العنوان «روليت بنانتو»", wheel.includes("روليت بنانتو"));
check("جدول الاحتمالات", /فرصك بـ/.test(wheel));
check("صف الخسارة معروض", /لا شيء|خسارة|حظ/.test(wheel));

/*
  The odds must be real percentages of one hundred — «عرض النسبة الفعلية
  النهائية». Read off the screen and summed, because a screen that prints
  seven numbers adding to 130 is lying to the member whatever the server sent.
*/
const percents = [...wheel.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));
if (percents.length >= 2) {
  const total = percents.reduce((a, b) => a + b, 0);
  check(
    `مجموع النسب المعروضة = ${total.toFixed(2)}%`,
    Math.abs(total - 100) < 1.5,
    `${percents.length} نسبة`,
  );
} else {
  check("النسب معروضة", false, `وجدت ${percents.length} فقط`);
}

/*
  The strip itself, as an element rather than as text.

  Its accessible name goes through `tr()`, so it is matched in either language
  rather than pinned to the Arabic — a check that fails because the site was
  served in English would be reporting the wrong fault.
*/
const strip = await page
  .locator('[aria-label*="شريط"], [aria-label*="strip" i], [aria-label*="Prize" i]')
  .count()
  .catch(() => 0);
check("شريط الروليت موجود", strip > 0, `${strip} عنصر`);

// ─── 4. The two old addresses ─────────────────────────────────────────────
for (const old of ["/banana_buy", "/banana_redeem"]) {
  await routeTo(old);
  const landed = await here();
  check(`${old} ← ${landed}`, landed === "/banana_market", landed);
}

await browser.close();

// ─── The report ───────────────────────────────────────────────────────────
say();
say(`| الفحص | النتيجة | ملاحظة |`);
say(`| --- | :---: | --- |`);
for (const r of results) {
  say(`| ${r.name} | ${r.ok ? "✓" : "✗"} | ${r.detail || ""} |`);
}
say();

/*
  The denominator, last and on its own line, because these logs are read as a
  TAIL and a count with nothing to divide it by is not a measurement.
*/
const passed = results.length - failures;
say(`## ${passed} من ${results.length} فحصًا نجح على ${ORIGIN}`);
flush();
if (failures > 0) process.exit(1);
