#!/usr/bin/env node
/**
 * How often does the shield answer instead of the shop?
 *
 * banan.to sits behind Cloudflare bot protection, and a browser-shaped request
 * is sometimes answered with "Performing security verification" — an HTTP 403
 * carrying an interstitial instead of the page. A customer has no retry. They
 * tap "الأسئلة الشائعة", get the verification screen, and the page does not
 * open.
 *
 * `page-smoke.mjs` hid this: it retried a 403 once, three seconds later, and
 * reported the second answer. Every run came back green while some share of
 * real visits were being turned away — a monitor that reports the shield
 * rather than the site is worse than no monitor.
 *
 * So this measures the rate rather than papering over it. Each path is sampled
 * a few times, sequentially, with a real phone's headers, and the counts are
 * printed per path and in total.
 *
 * ## Why it is slow on purpose
 *
 * The first version fired forty-eight requests in thirty-seven seconds from one
 * address and reported that 100% were challenged. That number was worthless:
 * a burst from a single IP is itself enough to raise a bot score, so the tool
 * was measuring its own impatience. A customer opening a help page is one
 * request every several seconds at most, so the default pacing is that — and
 * the answer means something.
 *
 * Usage:
 *   node scripts/edge-challenge-rate.mjs [--base https://banan.to]
 *                                        [--paths /faq,/policy]
 *                                        [--samples 6] [--gap 700]
 *                                        [--json rate.json]
 */
import { writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);

const BASE = (args.base ?? process.env.SMOKE_ORIGIN ?? "https://banan.to").replace(/\/$/, "");
const PATHS = (
  args.paths ?? "/,/add_game,/disc_trade,/problem,/account_guides,/faq,/policy,/support"
).split(",");
const SAMPLES = Number(args.samples ?? 3);
/** Seconds apart, not milliseconds: see "Why it is slow on purpose" above. */
const GAP = Number(args.gap ?? 6000);

/** A phone, because that is what the shop's customers are on. */
const BROWSER_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ar,en;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko)" +
    " Chrome/122.0 Mobile Safari/537.36",
};

/** The interstitial, by the words it puts on the screen. */
const CHALLENGE = /(Performing security verification|security service to protect|cf-browser-verification|Just a moment|challenge-platform)/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rows = [];
let totalChallenged = 0;
let totalRequests = 0;

for (const path of PATHS) {
  const row = { path, ok: 0, challenged: 0, other: [] };
  for (let i = 0; i < SAMPLES; i++) {
    try {
      const res = await fetch(BASE + path, { redirect: "manual", headers: BROWSER_HEADERS });
      const body = await res.text().catch(() => "");
      totalRequests++;
      if (res.status === 403 || CHALLENGE.test(body)) {
        row.challenged++;
        totalChallenged++;
      } else if (res.status === 200) {
        row.ok++;
      } else {
        row.other.push(res.status);
      }
    } catch (error) {
      row.other.push(String(error).split("\n")[0]);
      totalRequests++;
    }
    if (i < SAMPLES - 1) await sleep(GAP);
  }
  rows.push(row);
  const verdict = row.challenged === 0 ? "ok  " : "BLOCKED";
  console.log(
    `${verdict.padEnd(8)} ${path.padEnd(18)} served ${row.ok}/${SAMPLES}` +
      `  challenged ${row.challenged}/${SAMPLES}` +
      (row.other.length ? `  other ${row.other.join(",")}` : ""),
  );
}

const rate = totalRequests ? Math.round((totalChallenged / totalRequests) * 100) : 0;
console.log(
  `\n${totalChallenged} of ${totalRequests} requests were answered with a security` +
    ` challenge instead of the page — ${rate}%.`,
);
if (totalChallenged) {
  console.log(
    "A customer has no retry: a challenged request is a page that did not open." +
      " This is a Cloudflare edge setting (Bot Fight Mode / a WAF managed rule /" +
      " Under Attack), not application code.",
  );
  console.log(
    "Read the rate as a floor, not a forecast: these requests come from a data" +
      " centre address, which scores worse than a phone on a home or mobile" +
      " network. It shows the rule is challenging ordinary browser requests; it" +
      " does not say what share of real customers are caught.",
  );
}

if (args.json) writeFileSync(args.json, JSON.stringify({ base: BASE, samples: SAMPLES, rows, rate }, null, 2));

// A single challenge is a customer turned away, so any is a failure.
process.exit(totalChallenged ? 1 : 0);
