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
/** How many distinct stored URLs to actually try loading. */
const SAMPLE = Number(args.sample ?? 120);

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

/* ─── 1. What the catalogue STORES ──────────────────────────────────────── */
/*
  The same five field names, in the same order, that
  `getNintendoMedia(product, "square-card")` reads — copied rather than
  imported because this runs inside the page, where the app's modules are not
  reachable by name.
*/
const stored = await page.evaluate(async () => {
  const FIELDS = [
    "nintendoCardImage",
    "nintendo_card_image",
    "squareGameImage",
    "squareImage",
    "square_card_image",
  ];
  const res = await fetch("/api/data?slim=1", { headers: { accept: "application/json" } });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const data = await res.json();
  const products = Array.isArray(data?.products) ? data.products : [];
  const urls = [];
  let withUrl = 0;
  for (const p of products) {
    let hit = "";
    for (const field of FIELDS) {
      const value = p?.[field];
      if (typeof value === "string" && value.trim()) {
        hit = value.trim();
        break;
      }
    }
    if (!hit) continue;
    withUrl += 1;
    urls.push({ title: String(p?.title ?? p?.titleEn ?? ""), url: hit });
  }
  return { total: products.length, withUrl, urls };
});

if (stored?.error) fail(`تعذّرت قراءة الكتالوج: ${stored.error}`);
say(`- منتجات في الحمولة المختصرة: **${stored.total}**`);
say(`- منها تحمل رابط صورة مربعة مخزّنًا: **${stored.withUrl}**`);
say(`- بلا رابط مخزّن: **${stored.total - stored.withUrl}**`);

/* ─── 2. Do those URLs load? ────────────────────────────────────────────── */
/*
  Loaded the way the card loads them — an `<img>` and its `naturalWidth` —
  rather than with `fetch`, because that is the exact signal `NintendoCover`
  reacts to. A `fetch` can succeed on a response the decoder then refuses.
*/
const unique = [...new Map(stored.urls.map((row) => [row.url, row])).values()];
const sample = unique.slice(0, SAMPLE);
say(`- روابط مميّزة: **${unique.length}** — سأجرّب تحميل **${sample.length}** منها`);

const loadResults = await page.evaluate(async (rows) => {
  const tryOne = (url) =>
    new Promise((resolve) => {
      const img = new Image();
      const done = (ok, why) => resolve({ url, ok, why, width: img.naturalWidth || 0 });
      const timer = setTimeout(() => done(false, "timeout"), 12_000);
      img.onload = () => {
        clearTimeout(timer);
        done(img.naturalWidth > 0, img.naturalWidth > 0 ? "" : "decoded to zero width");
      };
      img.onerror = () => {
        clearTimeout(timer);
        done(false, "error");
      };
      img.referrerPolicy = "no-referrer";
      img.src = url;
    });

  const out = [];
  const queue = [...rows];
  const workers = Array.from({ length: 6 }, async () => {
    for (;;) {
      const row = queue.shift();
      if (!row) return;
      const result = await tryOne(row.url);
      out.push({ ...result, title: row.title });
    }
  });
  await Promise.all(workers);
  return out;
}, sample);

const broken = loadResults.filter((r) => !r.ok);
const okCount = loadResults.length - broken.length;

/* ─── 3. What the shelf actually shows ──────────────────────────────────── */
let shelf = [];
try {
  for (let i = 0; i < 10; i += 1) {
    const found = await page.locator('[aria-label="Nintendo Switch cartridges"]').count();
    if (found > 0) break;
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2_000);
  shelf = await page.evaluate(() => {
    const strip = document.querySelector('[aria-label="Nintendo Switch cartridges"]');
    if (!strip) return [];
    return [...strip.children].slice(0, 12).map((card) => {
      const text = (card.textContent || "").replace(/\s+/g, " ").trim();
      const img = card.querySelector("img");
      return {
        text: text.slice(0, 60),
        placeholderCaption: text.includes("لم يتم إضافة الصورة بعد"),
        src: img ? img.currentSrc || img.src || "" : "",
        complete: img ? img.complete : false,
        width: img ? img.naturalWidth || 0 : -1,
      };
    });
  });
} catch {
  shelf = [];
}

/* ─── The verdict, last in the log because a job log is read as a tail ──── */
say();
say("## ما يعرضه رفّ الكارتلج فعلًا");
say();
if (shelf.length === 0) {
  say("- الرفّ لم يظهر لهذا القارئ — لا حكم عليه.");
} else {
  say("| # | البطاقة | «لم تُضف الصورة» | للصورة رابط | عرضها |");
  say("| --- | --- | :---: | :---: | ---: |");
  shelf.forEach((card, i) => {
    say(
      `| ${i + 1} | ${card.text || "—"} | ${card.placeholderCaption ? "نعم" : "لا"} | ${
        card.src ? "نعم" : "لا"
      } | ${card.width} |`,
    );
  });
}

say();
say("## الحكم");
say();
const withStored = stored.withUrl;
const brokenShare = loadResults.length ? Math.round((broken.length / loadResults.length) * 100) : 0;
say(`- مخزّن: **${withStored}** من **${stored.total}**`);
say(`- جُرّب تحميلها: **${loadResults.length}** — نجحت **${okCount}**، فشلت **${broken.length}** (${brokenShare}%)`);
if (broken.length) {
  say();
  say("أمثلة على روابط مخزّنة لا تُحمَّل:");
  for (const row of broken.slice(0, 10)) {
    say(`  - ${row.title || "—"} → \`${String(row.url).slice(0, 110)}\` (${row.why})`);
  }
}
say();
if (withStored < stored.total * 0.25) {
  say("**(أ)**: الكتالوج نفسه بلا روابط مربعة تقريبًا — الفرز ينهار لأنه لا شيء ليفصله.");
} else if (broken.length > loadResults.length * 0.25) {
  say(
    "**(ب)**: الروابط مخزّنة ولا تُحمَّل. الفرز يرفع الأعطال إلى صدر الرفّ، " +
      "لأن الشرط يسأل «هل هناك رابط؟» بينما البطاقة تسأل «هل ظهر؟».",
  );
} else {
  say("لا (أ) ولا (ب): الروابط مخزّنة وتُحمَّل — فالخلل في مكان آخر، وهذا التقرير يستبعده.");
}

flush();
await browser.close();
