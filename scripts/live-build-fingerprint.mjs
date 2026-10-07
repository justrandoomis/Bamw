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
 *  - `microphone`  — the server lets the site's own pages use the microphone
 *                    (`microphone=(self)`), which voice notes need;
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

const headers = (await response?.allHeaders()) ?? {};
const policy = headers["permissions-policy"] ?? "";
const headerBar = await page
  .locator("[data-header-bar]")
  .count()
  .catch(() => 0);

const probes = [
  { name: "header-bar", live: headerBar > 0, seen: `${headerBar} element(s)` },
  {
    name: "microphone",
    live: /microphone=\(self\)/.test(policy),
    seen: policy ? `\`${policy}\`` : "no permissions-policy header",
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
