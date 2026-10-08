#!/usr/bin/env node
/**
 * Is the build banan.to serves the one on `main`? READ ONLY.
 *
 * `whats-live` asks Cloudflare which version is serving, and a deploy made by
 * Workers Builds records no commit, so it cannot say what that version holds.
 * This asks the shop itself, in a real browser, for things only a recent build
 * does — one probe per change, each named for what it proves:
 *
 *  - `header-bar`  — the top bar is a solid strip of its own (`data-header-bar`),
 *                    so nothing scrolls visibly behind it;
 *  - `header-height` — the page reserves the bar's own height plus the phone's
 *                    notch (`--header-h`), which the same change added;
 *  - `chat-attach` — the chat's composer attaches with one labelled paperclip
 *                    («إرفاق صورة»), where it had an unlabelled lightning bolt;
 *  - `security-headers` — the home page arrives with the shop's security
 *                    headers (none were sent before), the referrer policy
 *                    YouTube embeds need, and no framing ban, which would shut
 *                    the Telegram Mini App out.
 *
 * And one reading that is not a probe of the build: whether «الدخول عبر Google»
 * reaches Google at all. That depends on two secrets in Cloudflare, not on the
 * code, so it is reported and never fails the run.
 *
 * It signs in as nobody and presses nothing.
 *
 * Usage:
 *   node scripts/live-build-fingerprint.mjs [--origin https://banan.to]
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);
const ORIGIN = String(args.origin ?? process.env.ORIGIN ?? "https://banan.to").replace(/\/$/, "");
const OUT = "live-build-fingerprint.md";

/* A default headless agent gets the edge's challenge page; a phone does not. */
const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const executablePath =
  process.env.CHROMIUM_PATH ??
  (process.env.PLAYWRIGHT_BROWSERS_PATH
    ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium-1194/chrome-linux/chrome`
    : undefined);

const lines = [];
const say = (text = "") => {
  lines.push(String(text));
  console.log(String(text));
};

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: PHONE_UA });

let response = null;
let challenged = false;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  response = await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(5_000);
  const title = await page.title().catch(() => "");
  challenged = /just a moment|security verification|attention required/i.test(title);
  if (!challenged) break;
}

const documentHeaders = (await response?.allHeaders().catch(() => ({}))) ?? {};
const securityHeaders = {
  nosniff: documentHeaders["x-content-type-options"] === "nosniff",
  referrer: documentHeaders["referrer-policy"] === "strict-origin-when-cross-origin",
  microphone: /microphone=\(self\)/.test(documentHeaders["permissions-policy"] ?? ""),
  frameable: !documentHeaders["x-frame-options"],
};

const headerHeight = await page
  .evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--header-h").trim())
  .catch(() => "");
const headerBar = await page
  .locator("[data-header-bar]")
  .count()
  .catch(() => 0);

/*
  The chat renders for a visitor who is not signed in, composer and all.

  Reached inside the app, by `pushState` + `popstate` — the transition
  TanStack Router listens for — not as a second page load. The edge lets a
  runner's browser in once and answers its next document request 403, which
  is what the first run of this probe read: «/chat HTTP 403», a verdict on the
  edge and none on the build. `maintenance-live-check.mjs` found the same.
*/
let chatAttach = 0;
let chatRefused = 0;
page.on("response", (res) => {
  if (res.status() === 403) chatRefused += 1;
});
if (!challenged) {
  await page
    .evaluate(() => {
      window.history.pushState({}, "", "/chat");
      window.dispatchEvent(new PopStateEvent("popstate"));
    })
    .catch(() => {});
  chatAttach = await page
    .locator('button[aria-label="إرفاق صورة"], button[aria-label="Attach a photo"]')
    .first()
    .waitFor({ state: "attached", timeout: 30_000 })
    .then(() => 1)
    .catch(() => 0);
}
const chatPath = await page.evaluate(() => location.pathname).catch(() => "—");

/*
  Where «الدخول عبر Google» lands, from a browser of its own — a first visit,
  which the edge lets through. Google's sign-in page means the two secrets are
  set; the shop's own «not configured» answer means they are not.
*/
let google = "unknown";
try {
  const context = await browser.newContext({ userAgent: PHONE_UA });
  const tab = await context.newPage();
  await tab
    .goto(`${ORIGIN}/api/oauth/google?next=/auth`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    })
    .catch(() => null);
  await tab.waitForTimeout(3_000);
  const landed = new URL(tab.url());
  google = /(^|\.)google\.com$/.test(landed.hostname)
    ? "configured — reaches Google's sign-in"
    : landed.searchParams.get("error") === "google_not_configured"
      ? "NOT configured — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing"
      : `unclear — landed on ${landed.hostname}${landed.pathname}`;
  await context.close();
} catch {
  google = "unknown — the check could not run";
}

const probes = [
  { name: "header-bar", live: headerBar > 0, seen: `${headerBar} element(s)` },
  {
    name: "header-height",
    live: /4rem/.test(headerHeight),
    seen: headerHeight ? `\`--header-h: ${headerHeight}\`` : "no `--header-h`",
  },
  {
    name: "chat-attach",
    live: chatAttach > 0,
    seen: `in-app ${chatPath} · ${chatAttach ? "labelled paperclip" : "no labelled paperclip"}${chatRefused ? ` · ${chatRefused} request(s) refused 403` : ""}`,
  },
  {
    name: "security-headers",
    live: Object.values(securityHeaders).every(Boolean),
    seen: Object.entries(securityHeaders)
      .map(([what, ok]) => `${what} ${ok ? "✓" : "✗"}`)
      .join(" · "),
  },
];

say("# Is the new build live");
say();
say(`- origin: ${ORIGIN}`);
say(`- run at ${new Date().toISOString()} — read only.`);
say(`- home page: HTTP ${response?.status() ?? "—"}${challenged ? " · **edge challenge**" : ""}`);
say();
say("| probe | live | seen |");
say("| --- | :---: | --- |");
for (const probe of probes) say(`| ${probe.name} | ${probe.live ? "✓" : "✗"} | ${probe.seen} |`);
say();
const allLive = !challenged && probes.every((probe) => probe.live);
say(`- Google sign-in: ${google}`);
say();
say(
  allLive
    ? "**Every probe is live: banan.to serves the new build.**"
    : challenged
      ? "**The edge challenged the checker — no verdict.**"
      : "**Not every probe is live.**",
);
writeFileSync(OUT, `${lines.join("\n")}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, { flag: "a" });
}
await browser.close();
process.exit(allLive ? 0 : 1);
