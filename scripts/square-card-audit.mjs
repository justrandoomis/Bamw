#!/usr/bin/env node
/**
 * Do the stored square covers actually LOAD?
 *
 * The owner reported two things that read as one fault: a square image he saves
 * in «ألعاب بلا صورة مربعة» never appears on the storefront, and the cartridge
 * shelf «ألعاب نينتندو سويتش» leads with cards that say «لم يتم إضافة الصورة
 * بعد» — the opposite of the order he asked for.
 *
 * Two mutually exclusive explanations fit that, and guessing between them is
 * how this session has already wasted a revert:
 *
 *   (A) NO square URL reaches the home page. `hasNintendoSquareCard` is then
 *       false for everything, `squareCardFirst` degenerates to the identity
 *       (src/lib/listingOrder.ts:84 returns the input order in BOTH degenerate
 *       directions), and the shelf keeps arrival order.
 *
 *   (B) The square URL IS stored for most of the catalogue, so those products
 *       are sorted to the FRONT — and then fail to load in the browser, so
 *       `NintendoCover` prints the «no image yet» caption on exactly the cards
 *       that lead the shelf. `hasNintendoSquareCard` asks «is a URL stored?»;
 *       the card asks «did a URL render?». Under (B) the ordering rule is doing
 *       the opposite of what was asked, promoting broken artwork to the head.
 *
 * The admin queue already hints at (B) — it counts 282 games missing a square
 * card out of roughly 1,712 — but that is a count of what is STORED, which is
 * the very thing (B) says is not the question. So this reads the rendered page:
 * for every cartridge on the shelf, the title, whether the card is showing the
 * placeholder caption, and for each `<img>` its `src` and its `naturalWidth`.
 *
 * `naturalWidth === 0` on a complete image is a browser telling you, without
 * ambiguity, that it was handed a URL and could not draw it. That is the
 * measurement neither reading the code nor counting the database can give.
 *
 * STRICTLY READ-ONLY. It opens public pages, loads images, and writes nothing
 * anywhere. It signs in to nothing, so it sees the shop as a stranger does —
 * which is the population the owner is complaining about.
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
const NAV_MS = Number(args.nav ?? 60) * 1_000;

const lines = [];
const say = (t = "") => {
  lines.push(String(t));
  console.log(String(t));
};
const flush = () => {
  writeFileSync("square-card-audit.md", `${lines.join("\n")}\n`);
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

say("# هل تُحمَّل الصور المربّعة المخزّنة فعلًا؟");
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

try {
  const res = await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: NAV_MS });
  await page
    .waitForFunction(() => !/just a moment|checking your browser/i.test(document.title || ""),
      undefined, { timeout: 30_000 })
    .catch(() => {});
  if (!res || res.status() >= 400) fail(`الرئيسية ردّت ${res ? res.status() : "بلا رد"}`);
  say(`- الرئيسية: ${res.status()}`);
} catch (error) {
  fail(`تعذّر فتح الموقع (${String(error).slice(0, 120)})`);
}

const build = await page
  .evaluate(async () => {
    try {
      const res = await fetch("/api/health", { headers: { accept: "application/json" } });
      const body = await res.json();
      return typeof body?.build === "string" ? body.build : "الحقل غير موجود";
    } catch {
      return "تعذّرت القراءة";
    }
  })
  .catch(() => "تعذّرت القراءة");
say(`- البناء الذي يخدم: \`${build}\``);

/* ─── 1. What the SHELVES actually drew ────────────────────────────────── */
/*
  Read from the DOM, not from `/api/data`.

  The first version of this fetched `/api/data?slim=1` from inside the page and
  got HTTP 403: Cloudflare refuses that request from this runner even though it
  serves the page itself, which the app then renders perfectly well from its own
  fetch. Asking a second time, from a script, is asking a different question of
  the WAF — and the answer to that question is not the one being measured.

  It is also unnecessary. Everything that separates (أ) from (ب) is on screen:
  a card either was handed a URL or it was not, and a URL either drew or it did
  not. `naturalWidth === 0` on a complete `<img>` is the browser saying it was
  given an address and could not draw it — which no count of stored rows can
  tell you.
*/
const readShelf = async (label) => {
  for (let i = 0; i < 14; i += 1) {
    const found = await page.locator(`[aria-label="${label}"]`).count();
    if (found > 0) break;
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(500);
  }
  /* Give the cards time to try their images — a failure takes a round trip. */
  await page.waitForTimeout(6_000);
  return await page.evaluate((name) => {
    const strip = document.querySelector(`[aria-label="${name}"]`);
    if (!strip) return [];
    return [...strip.children].slice(0, 12).map((card) => {
      const text = (card.textContent || "").replace(/\s+/g, " ").trim();
      const img = card.querySelector("img");
      return {
        text: text.slice(0, 54),
        placeholderCaption: text.includes("لم يتم إضافة الصورة بعد"),
        src: img ? img.currentSrc || img.getAttribute("src") || "" : "",
        complete: img ? img.complete : false,
        width: img ? img.naturalWidth || 0 : -1,
      };
    });
  }, label);
};

const cartridges = await readShelf("Nintendo Switch cartridges");
const squares = await readShelf("Nintendo Switch games");

const table = (rows, title) => {
  say();
  say(`## ${title}`);
  say();
  if (rows.length === 0) {
    say("- لم يظهر لهذا القارئ — لا حكم عليه.");
    return;
  }
  say("| # | البطاقة | «لم تُضف الصورة» | رابط الصورة | عرضها |");
  say("| --- | --- | :---: | :---: | ---: |");
  rows.forEach((card, i) => {
    const where = card.src ? `\`${String(card.src).slice(0, 48)}…\`` : "—";
    say(
      `| ${i + 1} | ${card.text || "—"} | ${card.placeholderCaption ? "نعم" : "لا"} | ${where} | ${card.width} |`,
    );
  });
};

/* ─── The verdict, last in the log because a job log is read as a tail ──── */
table(cartridges, "رفّ الكارتلج «ألعاب نينتندو سويتش»");
table(squares, "الرفّ المربّع «Nintendo Switch games» — للمقارنة");

const head = cartridges.slice(0, 8);
const withSrc = head.filter((c) => c.src);
const brokenHead = head.filter((c) => c.src && c.complete && c.width === 0);
const captioned = head.filter((c) => c.placeholderCaption);

say();
say("## الحكم");
say();
if (head.length === 0) {
  say("- رفّ الكارتلج لم يظهر — لا حكم.");
} else {
  say(`- أول **${head.length}** بطاقة في رفّ الكارتلج`);
  say(`- منها تحمل رابط صورة: **${withSrc.length}**`);
  say(`- منها رابطٌ اكتمل تحميله بعرض صفر (أي فشل الرسم): **${brokenHead.length}**`);
  say(`- منها تكتب «لم يتم إضافة الصورة بعد»: **${captioned.length}**`);
  say();
  if (brokenHead.length >= 2) {
    say(
      "**(ب)**: الروابط مخزّنة ولا تُرسم. الفرز يرفع الأعطال إلى صدر الرفّ، " +
        "لأن الشرط يسأل «هل هناك رابط؟» بينما البطاقة تسأل «هل ظهر؟».",
    );
  } else if (withSrc.length === 0) {
    say("**(أ)**: بطاقات الصدارة بلا رابط أصلًا — الفرز ينهار لأنه لا شيء ليفصله.");
  } else if (captioned.length === 0) {
    say("لا (أ) ولا (ب): صدر الرفّ يعرض صورًا سليمة — الخلل ليس هنا الآن.");
  } else {
    say(
      "غير حاسم: هناك تسمية «لم تُضف الصورة» بلا فشل تحميل مؤكَّد. " +
        "الجدول أعلاه هو الدليل، ولا أبني عليه استنتاجًا.",
    );
  }
}

flush();
await browser.close();
