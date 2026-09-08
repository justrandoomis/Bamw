#!/usr/bin/env node
/**
 * What the Banana Market is worth on the live site.
 *
 * The reported symptom was «موزة واحدة $0.00» to every customer and «السعر
 * الحالي: 0.000 د.ع» to the admin. Two causes were found — an admin route with
 * no handlers, and a stored zero that survived `??` — and only production can
 * say whether the price is real now.
 *
 * Read-only. Prices and counts only: no balances, no member identity, no
 * wallet contents.
 *
 * Getting the number takes two routes, because one of them is not reliable
 * from a runner:
 *
 *  1. the page a customer opens, in a real browser. This is the better
 *     evidence — it sees the rendered `$0.00` as well as the number behind it
 *     — but Cloudflare answers a datacentre IP with a challenge often enough
 *     that two runs in a row got 403 and no number at all;
 *  2. `GET /api/banana`, which is public and needs no session. Weaker evidence
 *     — it says what the server computed, not what the screen shows — but it
 *     answers when the page is challenged.
 *
 * So the page is tried first and given time to clear a challenge on its own,
 * and the API is the fallback rather than the primary. Inconclusive is
 * reported only when *both* are refused: a challenge is still never counted as
 * a verdict on the shop.
 *
 * Usage: node scripts/banana-live-check.mjs [--base https://banan.to]
 */
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);

const BASE = (args.base ?? process.env.BASE_URL ?? "https://banan.to").replace(/\/$/, "");
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
/** The shop is Arabic and Iraqi; asking for it in English is its own tell. */
const LANG = "ar,en-US;q=0.9,en;q=0.8";
/** Cloudflare's interstitial, in the two wordings it ships. */
const CHALLENGE =
  /security verification|Just a moment|Checking your browser|cf-browser-verification/i;
/** How long to let a managed challenge finish reloading itself. */
const CHALLENGE_WAIT = Number(args["challenge-wait"] ?? 30000);

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};

const executablePath =
  process.env.CHROMIUM_PATH ??
  (process.env.PLAYWRIGHT_BROWSERS_PATH
    ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium-1194/chrome-linux/chrome`
    : undefined);

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox"],
});

say("# The Banana Market, live");
say();
say(`\`${BASE}\` — read-only.`);
say();

const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  userAgent: UA,
  locale: "ar-IQ",
  extraHTTPHeaders: { "accept-language": LANG },
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));

/** Is the challenge still on screen? Read the body rather than trust the status. */
async function stillChallenged() {
  try {
    const text = await page.locator("body").innerText();
    return CHALLENGE.test(text);
  } catch {
    return true;
  }
}

const out = { ok: false, challenged: false, source: null };
try {
  const landing = await page.goto(`${BASE}/banana_market`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  out.status = landing?.status() ?? 0;

  /*
    A managed challenge is not a dead end — it runs JS and reloads itself into
    the real page. The previous version returned on the first 403 and so never
    found that out. Give it the time it asks for before calling it refused.
  */
  if (out.status === 403 || (await stillChallenged())) {
    const until = Date.now() + CHALLENGE_WAIT;
    while (Date.now() < until && (await stillChallenged())) {
      await page.waitForTimeout(2000);
    }
    out.challenged = await stillChallenged();
    if (!out.challenged) out.clearedChallenge = true;
  }

  if (!out.challenged) {
    await page.waitForTimeout(5000);
    const snapshot = await page.evaluate(async () => {
      const res = await fetch("/api/banana?range=1D", { headers: { accept: "application/json" } });
      if (!res.ok) return { __status: res.status };
      return res.json();
    });

    if (snapshot?.__status) {
      out.apiStatus = snapshot.__status;
    } else {
      out.source = "page";
      readSnapshot(out, snapshot);
      /* The screen the customer actually reads. */
      const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      out.screenShowsZeroPrice = /\$\s*0\.00\b/.test(text);
    }
  }
} catch (error) {
  out.error = String(error).split("\n")[0];
}

await page.close();
await browser.close();

/*
  The page was refused, so ask the server directly. `GET /api/banana` is public
  — it answers a signed-out visitor — so this reads nothing a customer could
  not read, and it carries the price, the chart and the offer count.
*/
if (out.source === null) {
  try {
    const res = await fetch(`${BASE}/api/banana?range=1D`, {
      headers: { accept: "application/json", "user-agent": UA, "accept-language": LANG },
    });
    out.apiStatus = res.status;
    if (res.ok) {
      out.source = "api";
      readSnapshot(out, await res.json());
      out.challenged = false;
    }
  } catch (error) {
    out.apiError = String(error).split("\n")[0];
  }
}

/** Pull only prices and counts out of a snapshot — never a balance or a member. */
function readSnapshot(target, snapshot) {
  target.price = Number(snapshot?.price ?? 0);
  target.change24h = Number(snapshot?.change24h ?? 0);
  target.listings = Array.isArray(snapshot?.listings) ? snapshot.listings.length : 0;
  target.chartPoints = Array.isArray(snapshot?.chart) ? snapshot.chart.length : 0;
  target.chartAllZero =
    target.chartPoints > 0 && snapshot.chart.every((p) => Number(p?.price ?? 0) === 0);
  target.ok = target.price > 0 && !target.chartAllZero;
}

const WHERE = { page: "من الصفحة", api: "من الواجهة العامة" };

say("| fact | value |");
say("|---|---:|");
say(`| HTTP (الصفحة) | ${out.status ?? "—"} |`);
say(`| HTTP (\`/api/banana\`) | ${out.apiStatus ?? "—"} |`);
say(`| **سعر الموزة** | ${out.price ?? "—"} |`);
say(`| تغيّر 24 ساعة | ${out.change24h ?? "—"}% |`);
say(`| عروض في السوق | ${out.listings ?? "—"} |`);
say(`| نقاط المخطط | ${out.chartPoints ?? "—"} |`);
say(`| المخطط كله أصفار | ${out.chartAllZero === undefined ? "—" : out.chartAllZero} |`);
say(
  `| الشاشة تعرض \`$0.00\` | ${out.screenShowsZeroPrice === undefined ? "— (لم تُقرأ الصفحة)" : out.screenShowsZeroPrice} |`,
);
say(`| مصدر القراءة | ${out.source ? WHERE[out.source] : "—"} |`);
if (errors.length) say(`\n_uncaught: ${[...new Set(errors)].slice(0, 3).join(" · ")}_`);
if (out.error) say(`\n_page failed: ${out.error}_`);
if (out.apiError) say(`\n_api failed: ${out.apiError}_`);
say();

if (out.source === null) {
  say(
    "_Challenged by bot protection on the page and refused on the API — inconclusive, " +
      "not a verdict on the shop._",
  );
} else {
  say(
    out.ok
      ? `**سعر الموزة على الإنتاج: ${out.price} — ليس صفراً.**`
      : "**السعر ما زال صفراً أو المخطط مسطّح على الصفر.**",
  );
  if (out.source === "api") {
    say();
    say(
      "_الصفحة رُفضت بحماية البوتات، فالرقم مقروء من الخادم مباشرة: يقول ما حسبه الخادم، " +
        "لا ما يظهر على الشاشة._",
    );
  }
}

if (args.json && args.json !== "true") writeFileSync(args.json, JSON.stringify(out, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
}
process.exit(out.ok ? 0 : 1);
