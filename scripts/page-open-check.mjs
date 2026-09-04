#!/usr/bin/env node
/**
 * Does each page actually open, in a real browser?
 *
 * `page-smoke.mjs` asks the server over HTTP, which proves the route answers
 * and the content reached it. It cannot see the failure a customer describes as
 * "the page doesn't open": the HTML arrives, hydration throws, and React
 * unmounts the tree — leaving a blank screen under a perfectly good 200. A
 * `fetch` reads that page as healthy.
 *
 * So this loads each page in Chromium, waits for the client to settle, and
 * measures what is *on the screen* — plus every uncaught error and failed
 * request along the way.
 *
 * Two failures are deliberately not failures here:
 *
 *  - a sign-in gate. `/add_game` and `/disc_trade` show one to a signed-out
 *    visitor by design, so a page is judged by whether it rendered its own
 *    content, not by how much;
 *  - a 401 from an API a signed-out visitor may not read. That is the app
 *    working, not breaking.
 *
 * Usage:
 *   node scripts/page-open-check.mjs [--base https://banan.to]
 *                                    [--paths /,/faq,/support]
 *                                    [--json open.json]
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

const BASE = (args.base ?? process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
/** The seven cards in the "خدمات وإرشادات المتجر" strip, and the home page they sit on. */
const PATHS = (
  args.paths ??
  "/,/add_game,/disc_trade,/problem,/account_guides,/faq,/policy,/support"
).split(",");
const SETTLE = Number(args.settle ?? 4000);

/**
 * How much visible text counts as "the page rendered something of its own".
 *
 * The app chrome — the settings drawer, the language switcher, the address
 * block — is about 150 characters and is present even on a page whose own
 * content failed. So the threshold is above the chrome rather than above zero.
 */
const CHROME_TEXT = 200;

/** Text that means the page rendered a real answer rather than a crash screen. */
const CRASH_MARKERS =
  /(Application error|Unexpected Application Error|حدث خطأ غير متوقع|Something went wrong|Internal Server Error|502 Bad Gateway)/i;

/*
  The sandbox these sessions run in ships Chromium at a fixed path; a CI runner
  installs it where Playwright expects. Resolved the same way
  `check-horizontal-overflow.mjs` resolves it, so one script runs in both.
*/
const executablePath =
  process.env.CHROMIUM_PATH ??
  (process.env.PLAYWRIGHT_BROWSERS_PATH
    ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium-1194/chrome-linux/chrome`
    : undefined);

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox"],
});
const results = [];

for (const path of PATHS) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const badResponses = [];

  page.on("pageerror", (error) => errors.push(String(error).split("\n")[0]));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text().slice(0, 200));
  });
  page.on("response", (response) => {
    const status = response.status();
    // A signed-out visitor is *meant* to be refused by the private APIs.
    if (status >= 400 && status !== 401 && status !== 403) {
      badResponses.push(`${status} ${new URL(response.url()).pathname}`);
    }
  });

  const entry = { path, ok: false };
  try {
    const response = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 60000 });
    entry.status = response?.status() ?? 0;
    await page.waitForTimeout(SETTLE);
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
    entry.textLength = text.length;
    entry.finalPath = new URL(page.url()).pathname;
    entry.sample = text.slice(0, 180);

    const reasons = [];
    if (entry.status >= 400) reasons.push(`http ${entry.status}`);
    if (entry.finalPath !== path) reasons.push(`redirected to ${entry.finalPath}`);
    if (text.length < CHROME_TEXT) reasons.push(`blank (${text.length} chars of text)`);
    if (CRASH_MARKERS.test(text)) reasons.push("crash screen");
    // An uncaught exception is what blanks a hydrated page, so it fails here
    // even when something is still on the screen.
    const fatal = errors.filter((e) => e.startsWith("pageerror"));
    if (fatal.length) reasons.push(`uncaught: ${fatal[0]}`);
    if (badResponses.length) reasons.push(`requests failed: ${badResponses.slice(0, 3).join(", ")}`);

    entry.ok = reasons.length === 0;
    entry.reasons = reasons;
    entry.errors = [...new Set(errors)].slice(0, 6);
  } catch (error) {
    entry.reasons = [`threw: ${String(error).split("\n")[0]}`];
    entry.errors = [...new Set(errors)].slice(0, 6);
  }

  results.push(entry);
  const label = entry.ok ? "ok  " : "FAIL";
  console.log(
    `${label}  ${path.padEnd(18)} http=${entry.status ?? "-"} text=${entry.textLength ?? "-"}` +
      (entry.ok ? "" : `\n        ${entry.reasons.join("\n        ")}`),
  );
  if (!entry.ok && entry.errors?.length) {
    console.log("        errors: " + entry.errors.join("\n                "));
  }
  if (!entry.ok && entry.sample) console.log("        on screen: " + entry.sample);
  await page.close();
}

await browser.close();

if (args.json) writeFileSync(args.json, JSON.stringify({ base: BASE, results }, null, 2));

const failed = results.filter((entry) => !entry.ok);
console.log(
  failed.length ? `\n${failed.length} of ${results.length} pages did not open.` : "\nEvery page opened.",
);
process.exit(failed.length ? 1 : 0);
