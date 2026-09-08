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
 * Both of those turned out to be challenged from a runner: the page passes,
 * and then `/api/banana` comes back 403 with `cf-mitigated: challenge` and
 * Cloudflare's "Just a moment..." HTML. So the market renders `$0.00` for this
 * client — which is the reported symptom, arrived at by a cause that has
 * nothing to do with the shop. A checker that stopped there would report the
 * bug as live every time.
 *
 * So there is a third route, and it is the authoritative one:
 *
 *  3. production's own D1, read through the Cloudflare API with the same
 *     credentials the deploy uses, and priced by the application's own
 *     `getMarketConfig` and `spotPriceAt`. No edge in between, so nothing to
 *     challenge — and it computes the price the way the customer's page does
 *     rather than reading a number out of a row.
 *
 * The screen reading is kept as corroboration, but a `$0.00` observed while
 * the API was challenged is explicitly *not* evidence of the bug, and is
 * reported as such.
 *
 * Usage: node scripts/banana-live-check.mjs [--base https://banan.to]
 */
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

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
      if (!res.ok) {
        /*
          A refusal is only useful if you can tell who wrote it. Cloudflare
          stamps a mitigated request with `cf-mitigated` and answers in HTML;
          the Worker answers in JSON. Carry back enough to say which.
        */
        return {
          __status: res.status,
          __type: res.headers.get("content-type") || "",
          __mitigated: res.headers.get("cf-mitigated") || "",
          __body: (await res.text()).replace(/\s+/g, " ").slice(0, 200),
        };
      }
      return res.json();
    });

    if (snapshot?.__status) {
      out.apiStatus = snapshot.__status;
      out.apiType = snapshot.__type;
      out.apiMitigated = snapshot.__mitigated;
      out.apiBody = snapshot.__body;
    } else {
      out.source = "page";
      readSnapshot(out, snapshot);
    }
    /*
      The screen the customer actually reads — recorded whether or not the
      snapshot came back, because a page that loaded and then got nothing from
      its API is exactly the case worth seeing.
    */
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    out.screenShowsZeroPrice = /\$\s*0\.00\b/.test(text);
    out.screenTextLength = text.length;
    out.screenSample = text.slice(0, 240);
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
    out.directApiStatus = res.status;
    out.directApiType = res.headers.get("content-type") || "";
    out.directApiMitigated = res.headers.get("cf-mitigated") || "";
    if (res.ok) {
      out.source = "api";
      readSnapshot(out, await res.json());
      out.challenged = false;
    } else {
      out.directApiBody = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
    }
  } catch (error) {
    out.apiError = String(error).split("\n")[0];
  }
}

/*
  Production's own database, priced by production's own code.

  This is the only route with no edge in front of it, so it is the one that can
  actually answer the question. It runs when the deploy credentials are present
  and is skipped silently otherwise, so the script still works against a local
  origin.
*/
async function readFromD1() {
  /*
    Which credentials arrived — presence only, never a value.

    `d1All` answers an empty array when it has no database rather than
    throwing, so a missing secret and a healthy-but-empty table look identical
    from the outside. That is how a run reported "D1 unreachable" three times
    without saying which of the three names was absent.
  */
  const NEEDED = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "D1_DATABASE_ID"];
  out.d1Credentials = Object.fromEntries(
    NEEDED.map((name) => [name, Boolean(process.env[name])]).concat([
      ["CLOUDFLARE_D1_DATABASE_ID", Boolean(process.env["CLOUDFLARE_D1_DATABASE_ID"])],
    ]),
  );
  const haveDatabase =
    Boolean(process.env["D1_DATABASE_ID"]) || Boolean(process.env["CLOUDFLARE_D1_DATABASE_ID"]);
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID || !haveDatabase) {
    out.d1Error = "missing credentials: " + JSON.stringify(out.d1Credentials);
    return;
  }
  const outfile = path.resolve(".banana-bundle.mjs");
  try {
    await build({
      entryPoints: ["scripts/lib/banana-entry.ts"],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      logLevel: "silent",
      alias: { "@": path.resolve("src") },
      external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
      /*
        TanStack Start's server core imports three specifiers that only the
        app's own build can resolve. They arrive through `db.server` and are
        never called here — the price is computed from the store document, not
        by running a request handler — so they are resolved to an empty module
        rather than left to fail the build.
      */
      plugins: [
        {
          name: "stub-start-virtuals",
          setup(pluginBuild) {
            const virtual =
              /^(#tanstack-router-entry|#tanstack-start-entry|tanstack-start-manifest:)/;
            pluginBuild.onResolve({ filter: virtual }, (a) => ({
              path: a.path,
              namespace: "start-virtual",
            }));
            pluginBuild.onLoad({ filter: /.*/, namespace: "start-virtual" }, () => ({
              contents: "export default {}; export const getStartManifest = () => ({});",
              loader: "js",
            }));
          },
        },
      ],
    });
    const app = await import(outfile);
    const reach = await app.d1All("SELECT count(*) AS n FROM store_kv");
    if (!reach.length) throw new Error("D1 unreachable — refusing to report on nothing");

    const config = await app.getMarketConfig();
    out.d1Price = app.spotPriceAt(config);
    out.d1Change24h = app.changePercent24h(config);
    out.d1BasePrice = Number(config?.basePrice ?? 0);
    const offers = await app.d1All(
      "SELECT count(*) AS n FROM banana_market_offers WHERE status = 'active'",
    );
    out.d1ActiveOffers = Number(offers?.[0]?.n ?? 0);
  } catch (error) {
    out.d1Error = String(error).split("\n")[0];
  } finally {
    rmSync(outfile, { force: true });
  }
}

await readFromD1();

/*
  D1 is the authority when it answered. The browser could only ever say what
  this IP was allowed to see.
*/
if (Number.isFinite(out.d1Price)) {
  if (out.source === null) {
    out.source = "d1";
    out.price = out.d1Price;
    out.change24h = out.d1Change24h;
    out.listings = out.d1ActiveOffers;
  }
  out.ok = out.d1Price > 0;
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

/*
  Did Cloudflare refuse this, or did the app?

  `cf-mitigated` is Cloudflare saying so itself, and the interstitial's own
  HTML says it when the header is stripped. Either one means the refusal is
  about this client, not about the market.
*/
function isChallenge(status, type, mitigated, body) {
  if (!status || status === 200) return false;
  if (mitigated) return true;
  if (CHALLENGE.test(body || "")) return true;
  return status === 403 && /text\/html/i.test(type || "");
}

const apiChallenged = isChallenge(out.apiStatus, out.apiType, out.apiMitigated, out.apiBody);
const directChallenged = isChallenge(
  out.directApiStatus,
  out.directApiType,
  out.directApiMitigated,
  out.directApiBody,
);
out.apiChallenged = apiChallenged || directChallenged;

const WHERE = { page: "من الصفحة", api: "من الواجهة العامة", d1: "من قاعدة البيانات مباشرة" };

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
say(`| نص الصفحة (حروف) | ${out.screenTextLength ?? "—"} |`);
say(`| **السعر من D1 مباشرة** | ${Number.isFinite(out.d1Price) ? out.d1Price : "—"} |`);
say(`| \`basePrice\` المخزّن | ${Number.isFinite(out.d1BasePrice) ? out.d1BasePrice : "—"} |`);
say(`| تغيّر 24 ساعة (D1) | ${Number.isFinite(out.d1Change24h) ? out.d1Change24h : "—"}% |`);
say(`| عروض نشطة (D1) | ${out.d1ActiveOffers ?? "—"} |`);
if (out.d1Error) say(`| قراءة D1 | فشلت: ${out.d1Error} |`);
say();
if (out.apiStatus && out.apiStatus !== 200) {
  say(`**\`/api/banana\` من داخل الصفحة رفض بـ ${out.apiStatus}.**`);
  say(`- \`content-type\`: \`${out.apiType || "—"}\``);
  say(`- \`cf-mitigated\`: \`${out.apiMitigated || "—"}\``);
  say(`- الجسم: \`${out.apiBody || "—"}\``);
  say();
}
if (out.directApiStatus && out.directApiStatus !== 200) {
  say(`**\`/api/banana\` مباشرةً رفض بـ ${out.directApiStatus}.**`);
  say(`- \`content-type\`: \`${out.directApiType || "—"}\``);
  say(`- \`cf-mitigated\`: \`${out.directApiMitigated || "—"}\``);
  say(`- الجسم: \`${out.directApiBody || "—"}\``);
  say();
}
if (out.screenSample) {
  say(`_على الشاشة:_ \`${out.screenSample}\``);
  say();
}
if (errors.length) say(`\n_uncaught: ${[...new Set(errors)].slice(0, 3).join(" · ")}_`);
if (out.error) say(`\n_page failed: ${out.error}_`);
if (out.apiError) say(`\n_api failed: ${out.apiError}_`);
say();

if (out.source === null && out.challenged) {
  say(
    "_Challenged by bot protection on the page and refused on the API — inconclusive, " +
      "not a verdict on the shop._",
  );
} else if (out.source === null && out.apiChallenged) {
  /*
    The page loaded and its API did not. That is still Cloudflare — it says so
    in `cf-mitigated` — just applied to the API path rather than to the
    document. The `$0.00` on screen follows from the page getting no data, so
    it must not be read as the bug being live. Said plainly, because the last
    version of this script drew the opposite conclusion from the same evidence.
  */
  say(
    "_`/api/banana` رُفض بتحدّي بوتات (`cf-mitigated: challenge`) لهذا العنوان. " +
      "الصفحة نفسها فتحت، و`$0.00` الظاهر عليها نتيجةٌ لهذا الرفض — وليس دليلاً " +
      "على أن السعر صفر. غير حاسم._",
  );
} else if (out.source === null) {
  /*
    A refusal that is not a challenge is the app's own, and a market that opens
    with no prices in it is exactly the reported fault.
  */
  say(
    "**الصفحة فتحت (200) لكن `/api/banana` رفض بردٍّ ليس تحدّي بوتات. " +
      "السوق يفتح بلا أسعار.** راجع الترويسات أعلاه.",
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

/*
  One line, last, saying what was actually established.

  The table above scrolls out of a truncated log tail, and three runs in a row
  were read without ever seeing whether the direct database read worked. This
  is the line to look at.
*/
say();
say(
  "SUMMARY " +
    JSON.stringify({
      d1Price: out.d1Price ?? null,
      d1BasePrice: out.d1BasePrice ?? null,
      d1ActiveOffers: out.d1ActiveOffers ?? null,
      d1Error: out.d1Error ?? null,
      d1Credentials: out.d1Credentials ?? null,
      source: out.source,
      pageStatus: out.status ?? null,
      apiStatus: out.apiStatus ?? null,
      apiChallenged,
      screenShowsZeroPrice: out.screenShowsZeroPrice ?? null,
      ok: out.ok,
    }),
);

if (args.json && args.json !== "true") writeFileSync(args.json, JSON.stringify(out, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
}
process.exit(out.ok ? 0 : 1);
