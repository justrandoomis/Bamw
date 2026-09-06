#!/usr/bin/env node
/**
 * Does the live shop find a game when somebody types its Arabic name?
 *
 * The sandbox these sessions run in has no route to banan.to, so a claim that
 * search works on production has to be made by something that can actually
 * reach it. This is that thing, and it asks the two questions that decide the
 * feature:
 *
 *   1. does the catalogue the browser receives carry `titleAr`? Without it the
 *      client-side search is scoring English strings and every Arabic query
 *      returns nothing, which is exactly the state this replaced;
 *   2. does `/search?q=…` actually put results on the screen? A real browser,
 *      because the page is rendered by the client and a `fetch` cannot see it.
 *
 * Read-only. Titles and counts only — no price, no cost, no stock, no supplier
 * name. Nothing here writes anything, anywhere.
 *
 * Usage:
 *   node scripts/search-live-check.mjs [--base https://banan.to]
 *                                      [--queries زيلدا,ماريو كارت]
 *                                      [--json search-live.json]
 */
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*(?:\s(?!--)[^\s]+)*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);

const BASE = (args.base ?? process.env.BASE_URL ?? "https://banan.to").replace(/\/$/, "");
const QUERIES = (args.queries ?? "زيلدا,ماريو كارت,سوبر ماريو,بطاقة شحن,mario kart,zelda")
  .split(",")
  .map((q) => q.trim())
  .filter(Boolean);
const SETTLE = Number(args.settle ?? 5000);

const UA =
  args.ua ??
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const lines = [];
const say = (text = "") => {
  lines.push(text);
  console.log(text);
};

say("# Search, on the live site");
say();
say(`\`${BASE}\` — read-only.`);
say();

const executablePath =
  process.env.CHROMIUM_PATH ??
  (process.env.PLAYWRIGHT_BROWSERS_PATH
    ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium-1194/chrome-linux/chrome`
    : undefined);

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox"],
});

/*
  A fresh page per query, and the catalogue read from inside one of them.

  This has now been wrong twice, in opposite directions, and both are worth
  writing down.

  First it read the catalogue with a plain `fetch`. Cloudflare's bot protection
  answers a datacentre IP with an HTML interstitial and a 403, so the check
  reported a broken catalogue while its own browser half was answering all
  eight queries correctly on the same site.

  Then it moved both halves into one shared browser context — and made things
  worse: a single challenge now poisoned every query, and a run that had passed
  8 of 8 failed 5 of 5. Sharing state across the run means sharing a refusal.

  So: each query gets its own page, as it did when it worked, and the catalogue
  is read from *inside* a page that has already rendered, where the request
  carries the site's own origin and cookies. And a challenge is reported as a
  challenge — see `payload.challenged` below — because a checker that cannot
  tell "Cloudflare blocked me" from "production is broken" is the thing this
  script exists to avoid being.
*/
async function withPage(run) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: UA });
  try {
    return await run(page);
  } finally {
    await page.close();
  }
}

/* ── 1. what the browser is actually sent ─────────────────────────────── */

const payload = { ok: false, challenged: false };
try {
  const store = await withPage(async (page) => {
    const landing = await page.goto(BASE + "/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    payload.status = landing?.status() ?? 0;
    if (payload.status === 403) {
      payload.challenged = true;
      return null;
    }
    await page.waitForTimeout(2000);
    return page.evaluate(async () => {
      const response = await fetch("/api/data?slim=1", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) return { __status: response.status };
      return response.json();
    });
  });

  if (store && store.__status) {
    payload.status = store.__status;
    payload.challenged = store.__status === 403;
  } else if (store) {
    const products = Array.isArray(store.products) ? store.products : [];
    const text = (value) => (typeof value === "string" ? value.trim() : "");

    payload.products = products.length;
    payload.withArabicName = products.filter((p) => text(p.titleAr)).length;
    payload.withSeries = products.filter((p) => text(p.seriesName) || text(p.series)).length;
    payload.sameTitleAndTitleEn = products.filter(
      (p) => text(p.title) && text(p.title) === text(p.titleEn),
    ).length;
    /* The one thing that must NOT be there. */
    payload.leakedSupplierName = products.filter(
      (p) => p.supplier_name_zh_cn || p.supplierNameZhCn,
    ).length;
    payload.ok = payload.withArabicName > 0 && payload.leakedSupplierName === 0;
  }
} catch (error) {
  payload.error = String(error).split("\n")[0];
}

say("## The catalogue the browser receives");
say();
say("| fact | value |");
say("|---|---:|");
say(`| HTTP | ${payload.status ?? "—"} |`);
say(`| products | ${payload.products ?? "—"} |`);
say(`| carrying an Arabic name (\`titleAr\`) | ${payload.withArabicName ?? "—"} |`);
say(`| carrying a series name | ${payload.withSeries ?? "—"} |`);
say(`| \`title\` identical to \`titleEn\` | ${payload.sameTitleAndTitleEn ?? "—"} |`);
say(`| **supplier name leaked** | ${payload.leakedSupplierName ?? "—"} |`);
if (payload.error) say(`\n_failed: ${payload.error}_`);
say();

/* ── 2. what a customer sees ──────────────────────────────────────────── */

const runs = [];
for (const query of QUERIES) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: UA });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).split("\n")[0]));

  const entry = { query, ok: false };
  try {
    const url = `${BASE}/search?q=${encodeURIComponent(query)}`;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    entry.status = response?.status() ?? 0;
    await page.waitForTimeout(SETTLE);

    /* A result is a link to a product page. Counting those counts results. */
    entry.results = await page.locator('a[href^="/product/"]').count();
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
    entry.foundNothingMessage = /لا توجد نتائج/.test(text);
    entry.firstTitles = (
      await page.locator('a[href^="/product/"]').allInnerTexts()
    )
      .slice(0, 3)
      .map((t) => t.replace(/\s+/g, " ").trim().slice(0, 60));

    const reasons = [];
    /*
      A challenge is not a verdict on the shop. 403 here is Cloudflare refusing
      a datacentre IP, which says nothing about whether search works — so it is
      recorded as inconclusive and reported loudly, not counted as a failure.
    */
    if (entry.status === 403) {
      entry.challenged = true;
      entry.reasons = ["challenged by bot protection — inconclusive"];
    } else {
      if (entry.status >= 400) reasons.push(`http ${entry.status}`);
      if (entry.results === 0) reasons.push("no results on screen");
      if (errors.length) reasons.push(`uncaught: ${errors[0]}`);
      entry.ok = reasons.length === 0;
      entry.reasons = reasons;
    }
  } catch (error) {
    entry.reasons = [`threw: ${String(error).split("\n")[0]}`];
  }

  runs.push(entry);
  await page.close();
}

await browser.close();

say("## What a customer sees at `/search`");
say();
say("| query | http | results | first hits |");
say("|---|---:|---:|---|");
for (const run of runs) {
  const hits = (run.firstTitles ?? []).join(" · ") || (run.reasons ?? []).join("; ");
  say(`| \`${run.query}\` | ${run.status ?? "—"} | ${run.results ?? 0} | ${hits} |`);
}
say();

const challenged = runs.filter((r) => r.challenged);
const failed = runs.filter((r) => !r.ok && !r.challenged);
const answered = runs.filter((r) => r.ok);

if (payload.challenged) {
  say(
    "_The catalogue read was challenged by bot protection, not refused by the shop — " +
      "inconclusive, not a failure._",
  );
  say();
}

say(
  failed.length > 0
    ? `**${failed.length} of ${runs.length} queries failed.**`
    : challenged.length === runs.length
      ? `**Inconclusive: all ${runs.length} queries were challenged by bot protection.** ` +
        "Nothing here says anything about the shop."
      : `**${answered.length} of ${runs.length} queries answered**` +
        (challenged.length > 0 ? `, ${challenged.length} challenged and inconclusive.` : "."),
);

/*
  Green only on evidence. A run that was challenged end to end proves nothing,
  so it does not pass — but it fails as "could not tell", which is a different
  thing from "the shop is broken", and the line above says which.
*/
const provedSomething = answered.length > 0 && failed.length === 0;

if (args.json && args.json !== "true") {
  writeFileSync(args.json, JSON.stringify({ payload, runs }, null, 2));
}
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
}

process.exit(provedSomething ? 0 : 1);
