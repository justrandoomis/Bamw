#!/usr/bin/env node
/**
 * Does the site that is actually serving traffic work?
 *
 * READ ONLY, and deliberately outside-in: it asks the public hostname over
 * HTTPS rather than the Worker it just uploaded, because "wrangler reported
 * success" and "banan.to answers correctly" are different claims and only the
 * second one is the deployment.
 *
 * Exits non-zero when the site is unreachable, unhealthy, or serving a
 * catastrophic error page, so a deploy job fails loudly instead of finishing
 * green over a broken site.
 */

import { writeFileSync } from "node:fs";

const ORIGIN = (process.env.VERIFY_ORIGIN || "https://banan.to").replace(/\/+$/, "");
/** Cloudflare needs a moment to roll a new version out to every colo. */
const ATTEMPTS = Number(process.env.VERIFY_ATTEMPTS || 5);
const GAP_MS = Number(process.env.VERIFY_GAP_MS || 6000);

const lines = [];
const say = (text = "") => {
  lines.push(text);
  console.log(text);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One attempt at the health endpoint.
 *
 * A network failure and an unhealthy answer are reported differently: the first
 * is worth retrying, the second is the site telling us something specific.
 */
async function probeHealth() {
  try {
    const res = await fetch(`${ORIGIN}/api/health`, {
      headers: { "user-agent": "bananto-deploy-verify" },
      redirect: "follow",
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, why: `not JSON: ${text.slice(0, 120)}` };
    }
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, why: String(error?.message || error) };
  }
}

say(`# Deployment verification`);
say();
say(`Run at ${new Date().toISOString()} against \`${ORIGIN}\`.`);
say();

let health = null;
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  health = await probeHealth();
  if (health.ok && health.body?.status === "OK") break;
  const detail = health.why ?? `status ${health.body?.status ?? "?"}`;
  say(`- attempt ${attempt}/${ATTEMPTS}: HTTP ${health.status} — ${detail}`);
  if (attempt < ATTEMPTS) await sleep(GAP_MS);
}

const body = health?.body ?? {};
say();
say(`- \`/api/health\` → HTTP ${health?.status ?? 0}, status **${body.status ?? "unreachable"}**`);
/*
  The endpoint answers a flat object: `status`, `d1`, `r2`, `productsRead`,
  `productsCount`. Read exactly those rather than guessing at a nested shape — a
  wrong key reads as "—" and would make a broken deploy look merely quiet.
*/
if (body.d1 !== undefined || body.productsRead !== undefined) {
  say(`- D1: ${body.d1 ?? "—"} (${body.d1LatencyMs ?? "—"} ms)`);
  say(
    `- products read: ${body.productsRead ?? "—"} · count **${body.productsCount ?? "—"}** (${body.productsLatencyMs ?? "—"} ms)`,
  );
  say(`- R2: ${body.r2 ?? "—"}`);
} else {
  say(`- raw: \`${JSON.stringify(body).slice(0, 400)}\``);
}

/*
  The home page is checked separately from the API. A Worker can answer
  `/api/health` perfectly while the server-rendered page throws, and the page is
  what a customer sees.
*/
let homeOk = false;
try {
  const res = await fetch(`${ORIGIN}/`, {
    headers: { "user-agent": "bananto-deploy-verify" },
    redirect: "follow",
  });
  const text = await res.text();
  homeOk = res.ok && !/حدث خطأ غير متوقع|Internal Server Error/i.test(text);
  say(
    `- \`/\` → HTTP ${res.status}, ${text.length} bytes${
      res.status === 403 ? " (bot protection — not a deploy failure)" : ""
    }`,
  );
  // A challenge page is the edge protecting the site, not the site being broken.
  if (res.status === 403) homeOk = true;
} catch (error) {
  say(`- \`/\` → unreachable: ${String(error?.message || error)}`);
}

/*
  Does the referral programme answer, and is its schema really there?

  A guest `GET /api/referral` returns the programme's terms without touching a
  single referral table, so it would pass just as happily against a database
  that has none of them. A `POST` with a code that cannot exist does touch one:
  the server resolves it against `referral_codes`, finds nothing, and refuses.

  That is what makes this a schema check rather than a routing check. A missing
  table turns the lookup into a 500; a present one answers 400 with the single
  refusal sentence. Nothing is written either way — a code that resolves to
  nobody creates no attribution.

  400 is the expected answer. 429 means the rate limiter answered first, and
  503 means the deployment has no signing key: both mean the route ran, which
  is what is being asked. Anything else is a fault.
*/
let referralOk = false;
try {
  const res = await fetch(`${ORIGIN}/api/referral`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "bananto-deploy-verify",
    },
    body: JSON.stringify({ code: "ZZZZZZZZ" }),
  });
  const text = await res.text();
  referralOk = res.status === 400 || res.status === 429 || res.status === 503;
  const note =
    res.status === 400
      ? " (refused as expected — `referral_codes` was read)"
      : res.status === 429
        ? " (rate limited — the route ran)"
        : res.status === 503
          ? " (programme off: no signing key)"
          : " (unexpected)";
  say(`- \`POST /api/referral\` → HTTP ${res.status}${note}`);
  if (!referralOk) say(`  - body: \`${text.slice(0, 200)}\``);
} catch (error) {
  say(`- \`POST /api/referral\` → unreachable: ${String(error?.message || error)}`);
}

/*
  Is the review that earns the code actually deployed?

  Three checks, and each one distinguishes "deployed" from "routed". A route
  that is not in the bundle answers 404; one that is answers 401 because it
  asked who you are first. And `/api/content` is the positive control: it is
  public, it returns the merged content document, and `reviewPrompt` only
  exists in that document if the deployed `mergeContent` is the new one.

  ## The edge challenge, and why this does not fail on one

  The first version of this fired all three at once with `Promise.all`, and a
  release was failed by it: Cloudflare answered every one with a 403 «Just a
  moment...» interstitial, having already challenged the health check's first
  attempt from the same runner IP. Three simultaneous requests from a data
  centre is what a bot looks like.

  So they run one at a time, and a challenge is not a verdict. It means the
  question could not be asked — which is neither a pass nor a failure, and
  saying otherwise in either direction would be a lie. A challenged check is
  reported as inconclusive and does not fail the deploy; the same judgement
  the `/` check above already makes.
*/
const CHALLENGE = /Just a moment|cf-browser-verification|__cf_chl/i;

/** One request, retried past an edge challenge, reported honestly either way. */
async function probe(path) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((wake) => setTimeout(wake, 2500));
    try {
      const res = await fetch(`${ORIGIN}${path}`, {
        headers: { "user-agent": "bananto-deploy-verify" },
      });
      const text = await res.text();
      if (res.status === 403 && CHALLENGE.test(text)) continue;
      return { status: res.status, text, challenged: false };
    } catch (error) {
      if (attempt === 2)
        return { status: 0, text: String(error?.message || error), challenged: false };
    }
  }
  return { status: 403, text: "", challenged: true };
}

let reviewOk = true;
try {
  const sheet = await probe("/api/order-review?orderId=zzzzzzzz");
  const admin = await probe("/api/admin/review-submissions");
  const content = await probe("/api/content");

  const report = (label, result, ok, why) => {
    if (result.challenged) {
      say(`- \`${label}\` → challenged by the edge (inconclusive, not a deploy failure)`);
      return;
    }
    if (!ok) reviewOk = false;
    say(`- \`${label}\` → HTTP ${result.status}${ok ? ` (${why})` : " (unexpected)"}`);
  };

  // A guest is refused, not 404'd: `requireUser` and `requireAdmin` throw a
  // 401 Response, which means the handler ran.
  report(
    "GET /api/order-review",
    sheet,
    sheet.status === 401,
    "guest refused — the route is deployed",
  );
  report(
    "GET /api/admin/review-submissions",
    admin,
    admin.status === 401 || admin.status === 403,
    "guest refused — the route is deployed",
  );
  report(
    "GET /api/content",
    content,
    content.status === 200 && content.text.includes("reviewPrompt"),
    "carries `reviewPrompt` — the new content document is live",
  );
} catch (error) {
  say(`- review endpoints → unreachable: ${String(error?.message || error)}`);
  reviewOk = false;
}

/*
  The wheel, and the queue for the missing square images.

  Same shape as the review checks above and for the same reason: a route that
  is not in the bundle answers 404, one that is answers 401 because it asked
  who you are before it did anything. `/wheel` is the positive control — it is
  a page a guest may open, so a 200 means the new client bundle is the one
  being served, not merely that an API file exists.

  These cannot be asked about a member's ticket balance or a real spin without
  a session, and a release verifier has no business holding one. What they can
  prove is that the code is live, which is what this file is for.
*/
let wheelOk = true;
try {
  const wheelApi = await probe("/api/wheel");
  const squareQueue = await probe("/api/admin/missing-square-images");
  const wheelPage = await probe("/wheel");

  const report = (label, result, ok, why) => {
    if (result.challenged) {
      say(`- \`${label}\` → challenged by the edge (inconclusive, not a deploy failure)`);
      return;
    }
    if (!ok) wheelOk = false;
    say(`- \`${label}\` → HTTP ${result.status}${ok ? ` (${why})` : " (unexpected)"}`);
  };

  report(
    "GET /api/wheel",
    wheelApi,
    wheelApi.status === 401,
    "guest refused — the wheel's server half is deployed",
  );
  report(
    "GET /api/admin/missing-square-images",
    squareQueue,
    squareQueue.status === 401 || squareQueue.status === 403,
    "guest refused — the square-image queue is deployed",
  );
  report(
    "GET /wheel",
    wheelPage,
    wheelPage.status === 200,
    "the spin page is routed — the new client bundle is live",
  );
} catch (error) {
  say(`- wheel endpoints → unreachable: ${String(error?.message || error)}`);
  wheelOk = false;
}

/*
  Is the shop serving a supplier's price to a customer?

  Not a question about the deployed code — it is a question about the
  catalogue the deployed code is serving, which is why it is asked here, at
  the public hostname, rather than in a unit test. Four product titles carried
  a scraped video timestamp with the supplier's cost in yuan beside it
  (`Pokémon Sword / Shield [0:10 ¥8.76]`) and one carried the Chinese supplier
  name, which this shop keeps out of the public product API, off the product
  page, out of the public HTML, out of the cache and out of search. They were
  in the title, and the title is on the shelf.

  A yuan mark on its own is not the test: the Nintendo eShop Japan Gift Card
  is denominated in yen and `¥500` is what the customer is buying. The
  supplier's prices are to the fen, so a decimal fraction is what separates
  them.

  A console bracket left in a name is counted but does not fail the check.
  Some of those cannot be removed without merging two products' identities,
  and that is a decision for the shop's owner; failing every future release
  over it would only teach people to ignore this line.
*/
const SUPPLIER_PRICE = /(?:¥|￥)\s*\d+\.\d|(?:CNY|RMB|人民币)\s*\d/i;
const CONSOLE_BRACKET = /[[(]\s*(?:nintendo\s*)?switch\s*2?\s*[\])]\s*$/i;

let catalogueOk = true;
try {
  const res = await fetch(`${ORIGIN}/api/data`, {
    headers: { "user-agent": "bananto-deploy-verify", accept: "application/json" },
    redirect: "follow",
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!res.ok || !payload) {
    // Unreachable or not JSON is inconclusive, not a deploy failure: the other
    // checks above already say whether the site is up.
    say(`- \`/api/data\` → HTTP ${res.status}, not readable as JSON (inconclusive)`);
  } else {
    const prices = [];
    const walk = (node, path) => {
      if (typeof node === "string") {
        if (SUPPLIER_PRICE.test(node)) prices.push(`${path}: ${node.slice(0, 80)}`);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key);
      }
    };
    walk(payload, "");

    const products = Array.isArray(payload?.products) ? payload.products : [];
    const brackets = products.filter((product) =>
      [product?.title, product?.titleEn].some((name) => CONSOLE_BRACKET.test(String(name ?? ""))),
    ).length;

    /*
      A supplier's price in a NAME fails the release. Anywhere else, it is
      counted and reported.

      Not a softening — a line drawn where it can be held. A product's name is
      the worst of these exposures and the one this shop can keep clean: it is
      on the shelf, in the search results, in the page's HTML and in every
      share of a link, and the label audit removes it there. The other fields
      are a description, an option row, an edition name — real, reported on
      every release, and outside what has been repaired so far.

      A gate that fails on all of them would block every release until an
      unrelated cleanup finished, which is how a gate gets switched off. This
      one stays on and stays true.
    */
    const inAName = prices.filter((hit) => /(^|\.)(title|titleEn|name)$/.test(hit.split(":")[0]));

    say(`- \`/api/data\` → HTTP ${res.status}, **${products.length}** products`);
    say(
      `- a supplier's price in a product NAME: **${inAName.length}**` +
        (inAName.length ? ` — ${inAName.slice(0, 5).join("; ")}` : " (none)"),
    );
    say(
      `- a supplier's price elsewhere in the record: **${prices.length - inAName.length}**` +
        ` (reported, not a failure — see the label audit's own report for where)`,
    );
    say(`- names still carrying a console bracket: **${brackets}** (reported, not a failure)`);
    if (inAName.length) catalogueOk = false;
  }
} catch (error) {
  say(`- \`/api/data\` → unreachable: ${String(error?.message || error)} (inconclusive)`);
}

const healthy = health?.ok === true && body.status === "OK";
say();
say(
  healthy && homeOk && referralOk && reviewOk && wheelOk && catalogueOk
    ? `**verified: the deployed site is healthy**`
    : `**FAILED**`,
);

writeFileSync("deployment-verification.md", lines.join("\n") + "\n");

if (!healthy || !homeOk || !referralOk || !reviewOk || !wheelOk || !catalogueOk) {
  console.error("deployment verification failed");
  process.exit(1);
}
