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
 * AND BECAUSE IT SIGNS IN AS NOBODY, IT CANNOT SEE EVERYTHING.
 *
 * `GET /api/roulette` requires a session, so a signed-out visitor gets no
 * pool, no strip and no odds rows — by design, not by fault. Anything that
 * needs a member is therefore recorded as «تحتاج جلسة» and counted apart from
 * the failures: a check that could not run must not be reported as a pass, and
 * it must not be reported as a defect either. Both would be untrue.
 *
 * What is left is still decisive, because none of these strings exist on the
 * OLD market or the OLD wheel: the page headings, the sections, the 1–10
 * ticket selector, the absence of the listing form, and the two redirects.
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
/** How long a screen may take to bring its data back before we call it late. */
const WAIT_MS = Number(args.wait ?? 25) * 1_000;

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
const routeTo = async (to, settled) => {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, to);

  /*
    WAIT FOR THE PAGE, DO NOT GUESS AT IT.

    This used to be a flat `waitForTimeout(SETTLE_MS)` — three seconds — and
    that is not a wait, it is a bet. `/api/health` on this shop reports
    `productsLatencyMs` around 2,700ms, so three seconds is a coin flip against
    its own backend, and both screens render a spinner until their data lands.

    A run that lost the toss reported a page of ~160 characters and every
    assertion on it failed. That reads exactly like a broken page and is not
    one, which is the worst kind of wrong: I acted on it.

    So the caller names a string that only appears once the screen has its
    data, and this polls for it. The timeout is generous because a slow answer
    is not a failure — and when it DOES expire, the report says so and prints
    what was actually on the screen, so the next reader does not have to guess
    the way I did.
  */
  const deadline = Date.now() + WAIT_MS;
  let seen = "";
  while (Date.now() < deadline) {
    seen = (await page.locator("body").innerText().catch(() => "")) || "";
    if (!settled || seen.includes(settled)) return { ok: true, text: seen, waited: true };
    await page.waitForTimeout(250);
  }
  return { ok: !settled, text: seen, waited: false };
};
const here = async () => await page.evaluate(() => window.location.pathname);

let failures = 0;
let skipped = 0;
const results = [];
/** One assertion, recorded either way, so the table shows the whole picture. */
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
};
/**
 * Something only a signed-in member can see.
 *
 * Recorded and shown, but not counted as a failure — and never as a pass. The
 * summary names how many there were, so a run that verified less than it
 * looks like cannot be mistaken for a full one.
 */
const needsSession = (name, detail = "") => {
  results.push({ name, skip: true, detail });
  skipped += 1;
};

// ─── 1 & 2. The market ────────────────────────────────────────────────────
const marketLanded = await routeTo("/banana_market", "سوق الموز");
const market = marketLanded.text;
if (!market.trim()) {
  fail("صفحة سوق الموز لم تُقرأ — لم أتحقق من الإنتاج");
}
say(`- طول نص سوق الموز: ${market.length} حرفًا${marketLanded.waited ? "" : " — **لم تكتمل خلال المهلة**"}`);
if (!marketLanded.waited) {
  /*
    Print what was on the screen. A length alone cannot tell a spinner from a
    crash, and that distinction is the whole difference between «the page is
    broken» and «the shop was slow».
  */
  say();
  say("النص الذي ظهر فعلًا:");
  say("```");
  say(market.slice(0, 400) || "(فارغ)");
  say("```");
  say();
}

check("العنوان «سوق الموز»", market.includes("سوق الموز"));
check(
  "مدى الرسم البياني الخمسة",
  ["1H", "4H", "12H", "1D", "7D"].every((r) => market.includes(r)),
  ["1H", "4H", "12H", "1D", "7D"].filter((r) => !market.includes(r)).join(" ") || "كلها",
);
/*
  The three buttons the owner named, by their exact labels. «بيع» on its own
  matched the OLD marketplace too, which would have made this look verified
  when nothing had shipped.
*/
check("زر «بيع الموز»", market.includes("بيع الموز"));
check("قسم «تذاكر عجلة الحظ»", market.includes("تذاكر عجلة الحظ"));
check("زر «الاستبدال»", market.includes("الاستبدال"));

/*
  The removal, checked as a removal. «أوقف endpoints/actions التي تسمح بإنشاء
  Listings جديدة» — so the words that only ever appeared on a listing form must
  be absent from the shipped page.
*/
const REMOVED = ["السعر لكل موزة", "عروضي", "عرض جديد", "أنشئ عرضًا"];
const stillThere = REMOVED.filter((w) => market.includes(w));
check("لا سوق بين الأعضاء", stillThere.length === 0, stillThere.join(" / "));

// ─── 3. The roulette ──────────────────────────────────────────────────────
const wheelLanded = await routeTo("/wheel", "روليت بنانتو");
const wheel = wheelLanded.text;
if (!wheel.trim()) {
  fail("صفحة الروليت لم تُقرأ — لم أتحقق من الإنتاج");
}
say(`- طول نص الروليت: ${wheel.length} حرفًا${wheelLanded.waited ? "" : " — **لم تكتمل خلال المهلة**"}`);

check("العنوان «روليت بنانتو»", wheel.includes("روليت بنانتو"));
check("قسم الاحتمالات", wheel.includes("فرصك بـ"));
/* «قبل تشغيل الروليت يستطيع المستخدم اختيار 1..10 تذاكر». */
check("منتقي عدد التذاكر", wheel.includes("عدد التذاكر لهذه الدورة"));
check("رصيد التذاكر معروض", wheel.includes("التذاكر") && wheel.includes("الموز"));

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
  needsSession("مجموع النسب = 100%", "الصفوف لا تُرسم لزائر غير مسجّل");
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
if (strip > 0) {
  check("شريط الروليت موجود", true, `${strip} عنصر`);
} else if (wheel.includes("لا توجد ألعاب متاحة في الروليت")) {
  /*
    The pool is empty for a visitor with no session, and the page says so in
    its own words rather than drawing a blank box. That IS the correct
    signed-out rendering, so it is a pass for the section and a skip for the
    strip — not a silent success for either.
  */
  check("قسم الروليت يرسم حالته الفارغة بنصّها", true);
  needsSession("شريط الروليت", "المجمّع فارغ بدون جلسة");
} else {
  check("شريط الروليت موجود", false, "لا شريط ولا رسالة فراغ");
}

// ─── 4. The two old addresses ─────────────────────────────────────────────
for (const old of ["/banana_buy", "/banana_redeem"]) {
  await routeTo(old, "سوق الموز");
  const landed = await here();
  check(`${old} ← ${landed}`, landed === "/banana_market", landed);
}

await browser.close();

// ─── The report ───────────────────────────────────────────────────────────
say();
say(`| الفحص | النتيجة | ملاحظة |`);
say(`| --- | :---: | --- |`);
for (const r of results) {
  const mark = r.skip ? "—" : r.ok ? "✓" : "✗";
  say(`| ${r.name} | ${mark} | ${r.detail || ""} |`);
}
say();

/*
  The denominator, last and on its own line, because these logs are read as a
  TAIL and a count with nothing to divide it by is not a measurement.
*/
const checkable = results.length - skipped;
const passed = checkable - failures;
say(`## ${passed} من ${checkable} فحصًا نجح على ${ORIGIN}`);
if (skipped > 0) {
  say();
  say(`و${skipped} فحصًا لم يُجرَ لأنه يحتاج حسابًا مسجّلًا — لم يُحتسب نجاحًا ولا فشلًا.`);
}
flush();
if (failures > 0) process.exit(1);
