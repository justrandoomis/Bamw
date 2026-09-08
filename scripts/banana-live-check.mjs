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
 * wallet contents. It reads through a browser page rather than a bare `fetch`,
 * because Cloudflare answers a datacentre IP with a challenge and a checker
 * that cannot tell a challenge from an outage is worse than none.
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

const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: UA });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));

const out = { ok: false, challenged: false };
try {
  const landing = await page.goto(`${BASE}/banana_market`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  out.status = landing?.status() ?? 0;
  if (out.status === 403) {
    out.challenged = true;
  } else {
    await page.waitForTimeout(5000);
    const snapshot = await page.evaluate(async () => {
      const res = await fetch("/api/banana?range=1D", { headers: { accept: "application/json" } });
      if (!res.ok) return { __status: res.status };
      return res.json();
    });

    if (snapshot?.__status) {
      out.status = snapshot.__status;
      out.challenged = snapshot.__status === 403;
    } else {
      out.price = Number(snapshot?.price ?? 0);
      out.change24h = Number(snapshot?.change24h ?? 0);
      out.listings = Array.isArray(snapshot?.listings) ? snapshot.listings.length : 0;
      out.chartPoints = Array.isArray(snapshot?.chart) ? snapshot.chart.length : 0;
      out.chartAllZero =
        out.chartPoints > 0 && snapshot.chart.every((p) => Number(p?.price ?? 0) === 0);
      /* The screen the customer actually reads. */
      const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      out.screenShowsZeroPrice = /\$\s*0\.00\b/.test(text);
      out.ok = out.price > 0 && !out.chartAllZero;
    }
  }
} catch (error) {
  out.error = String(error).split("\n")[0];
}

await page.close();
await browser.close();

say("| fact | value |");
say("|---|---:|");
say(`| HTTP | ${out.status ?? "—"} |`);
say(`| **سعر الموزة** | ${out.price ?? "—"} |`);
say(`| تغيّر 24 ساعة | ${out.change24h ?? "—"}% |`);
say(`| عروض في السوق | ${out.listings ?? "—"} |`);
say(`| نقاط المخطط | ${out.chartPoints ?? "—"} |`);
say(`| المخطط كله أصفار | ${out.chartAllZero === undefined ? "—" : out.chartAllZero} |`);
say(`| الشاشة تعرض \`$0.00\` | ${out.screenShowsZeroPrice === undefined ? "—" : out.screenShowsZeroPrice} |`);
if (errors.length) say(`\n_uncaught: ${[...new Set(errors)].slice(0, 3).join(" · ")}_`);
if (out.error) say(`\n_failed: ${out.error}_`);
say();

if (out.challenged) {
  say("_Challenged by bot protection — inconclusive, not a verdict on the shop._");
} else {
  say(
    out.ok
      ? `**سعر الموزة على الإنتاج: ${out.price} — ليس صفراً.**`
      : "**السعر ما زال صفراً أو المخطط مسطّح على الصفر.**",
  );
}

if (args.json && args.json !== "true") writeFileSync(args.json, JSON.stringify(out, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
}
process.exit(out.ok ? 0 : 1);
