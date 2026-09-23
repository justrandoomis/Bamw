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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  WHICH COMMIT IS THIS?

  Every run of this file used to report on «الإنتاج» without ever establishing
  which build «الإنتاج» was. That sounds like a detail and it is not: a second
  deploy path was putting commits live about fifty seconds after a push to
  `main`, so a report could describe one build while I reasoned about another —
  and for twenty minutes, it did.

  Read from the page's own origin, so it is the same deployment that rendered
  the screens below. A build with no stamp says «unknown», and that is printed
  as-is rather than smoothed over: an unstamped build is exactly the one whose
  provenance nobody can check.
*/
const liveBuild = await page
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
say(`- البناء الذي يخدم: \`${liveBuild}\``);

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
  /*
    `settled` is a string when one sentence means «this screen has its data»,
    and a RegExp when several different sentences all do — a signed-out prompt
    and a signed-in strip are both settled states, and insisting on one of them
    would fail honest renderings of the other.
  */
  const arrived = (text) =>
    !settled || (settled instanceof RegExp ? settled.test(text) : text.includes(settled));

  const deadline = Date.now() + WAIT_MS;
  let seen = "";
  while (Date.now() < deadline) {
    seen = (await page.locator("body").innerText().catch(() => "")) || "";
    if (arrived(seen)) return { ok: true, text: seen, waited: true };
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

/*
  ─── THE HOME SHELF ──────────────────────────────────────────────────────

  «الشريط الذي تحت خدمات المتجر يجب أن يعرض الالعاب المشهورة وليس العشوائية».

  That ask was shipped and then never verified anywhere a customer can see. It
  is the easiest of the four to get wrong silently, too: nothing crashes when a
  shelf is in the wrong order, so a broken sort looks exactly like a working
  one until somebody opens the page and does not recognise a single game.

  The list of world best-sellers is read out of `src/lib/bestSellers.ts` rather
  than copied here, so there is ONE list. A copy would drift, and a drifted copy
  would eventually pass this check against a shelf the owner would still call
  random.
*/
const FAMOUS = (() => {
  if (!existsSync("src/lib/bestSellers.ts")) return [];
  const source = readFileSync("src/lib/bestSellers.ts", "utf8");
  /* The entries are plain lowercase strings, already in comparable form. */
  return [...source.matchAll(/^\s*"([a-z0-9 ]+)",/gm)].map((m) => m[1]);
})();

/* The same shape `comparableTitle` reduces a title to, so `includes` matches. */
const comparable = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const shelf = await (async () => {
  try {
    /* The section is lazy — it does not exist until it is scrolled to. */
    for (let i = 0; i < 8; i += 1) {
      const found = await page.locator('[aria-label="Nintendo Switch games"] h3').count();
      if (found > 0) break;
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(500);
    }
    return await page.locator('[aria-label="Nintendo Switch games"] h3').allInnerTexts();
  } catch {
    return [];
  }
})();

if (FAMOUS.length === 0) {
  check("قائمة الأكثر مبيعًا قُرئت", false, "تعذّرت قراءة src/lib/bestSellers.ts");
} else if (shelf.length === 0) {
  /*
    Not a pass and not a failure: the shelf never appeared for this reader, and
    a shelf that was not seen cannot be judged. Said plainly rather than
    counted either way.
  */
  needsSession("ترتيب شريط ألعاب Switch", "الشريط لم يظهر لهذا القارئ");
} else {
  const head = shelf.slice(0, 12);
  const ranked = head.filter((title) =>
    FAMOUS.some((entry) => comparable(title).includes(entry)),
  );
  say("");
  say(`أول ${head.length} بطاقة في شريط ألعاب Switch (منها ${ranked.length} على قائمة الأكثر مبيعًا):`);
  for (const title of head) {
    const known = FAMOUS.some((entry) => comparable(title).includes(entry));
    say(`  ${known ? "★" : "·"} ${title.replace(/\s+/g, " ").trim()}`);
  }
  say("");
  /*
    Two of twelve. About a hundred of the catalogue's ~1,712 games are on the
    list, so a shelf in a random order would be expected to show under one —
    two is a signal, and it is low enough not to fail over a day when the
    owner's own square-image coverage moves the head around. The titles are
    printed above either way, because the number is not the interesting part.
  */
  check(
    `شريط Switch يقود بألعاب مشهورة (${ranked.length} من ${head.length})`,
    ranked.length >= 2,
    ranked.length ? ranked[0].replace(/\s+/g, " ").trim() : "لا شيء منها على القائمة",
  );
}

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
/*
  SETTLE ON THE SECTION, NOT ON THE TITLE.

  «روليت بنانتو» is the `<h1>`. It is on screen the instant the route mounts,
  before `/api/roulette` has said a word — so waiting for it was waiting for
  nothing, and the run that read this page caught the prize section mid-spinner
  and reported «لا شريط ولا رسالة فراغ»: a failure that was really a stopwatch.
  Exactly the fault the market half of this file already had fixed, one screen
  along, unnoticed because that screen was passing.

  So the wait is for whatever the section RESOLVES to, whichever it is — the
  sign-in prompt for a visitor with no session, the empty-pool sentence, or the
  strip's own first card. A regex, because any of the three means the answer
  has landed and none of them means the page is broken.
*/
const wheelLanded = await routeTo("/wheel", /سجّل الدخول لتشغيل الروليت|لا توجد ألعاب متاحة في الروليت|ابدأ —/);
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
} else if (wheel.includes("سجّل الدخول لتشغيل الروليت")) {
  /*
    THE CORRECT SIGNED-OUT RENDERING, and the one this checker used to read as
    a fault.

    `/api/roulette` answers 401 without a session, so this visitor was never
    going to see a strip. What matters is what the screen says instead, and the
    screen used to say «لا توجد ألعاب متاحة في الروليت الآن» — the shop's stock
    is empty — to someone whose only problem was that they were not logged in.
    That sentence is now reserved for a pool that really is empty, and this is a
    PASS for saying the true thing, with the strip skipped rather than failed.
  */
  check("الروليت يطلب تسجيل الدخول بدل ادّعاء أن المجمّع فارغ", true);
  needsSession("شريط الروليت", "لا جلسة — الشريط لا يُرسم لزائر");
} else if (wheel.includes("لا توجد ألعاب متاحة في الروليت")) {
  /*
    A genuinely empty pool, said in the page's own words rather than drawn as a
    blank box. Recorded as its own line so it can never be mistaken for the
    signed-out case above — those two look identical on screen and mean
    completely different things about the shop.
  */
  check("قسم الروليت يرسم حالته الفارغة بنصّها", true);
  needsSession("شريط الروليت", "المجمّع فارغ");
} else {
  check("شريط الروليت موجود", false, "لا شريط ولا رسالة — الصفحة لم تحسم حالتها");
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
