#!/usr/bin/env node
/**
 * Does the live site actually serve these pages? Read-only, over HTTP.
 *
 * The four help pages are the ones a customer is sent to from an order, a
 * delivery card or a support reply, and a link that 404s there costs a sale
 * and a support ticket at the same time. The claim "the route exists" is a
 * claim about the repository; this asks the deployed site.
 *
 * Each page is fetched the way a customer reaches it:
 *
 *  - cold, with no referrer, which is what a pasted link or a refresh does —
 *    the case a single-page app gets wrong when its fallback is missing;
 *  - with an anchor, which must not change what the server returns;
 *  - signed out, since none of these pages may require an account.
 *
 * And one path that does not exist, because a fallback that answers 200 for
 * everything is not a fix — it is a site with no 404.
 *
 * Usage: node scripts/page-smoke.mjs [origin]
 */
const ORIGIN = (process.argv[2] || process.env.SMOKE_ORIGIN || "https://banan.to").replace(/\/$/, "");

/**
 * A page, and strings that prove *this* page rendered — not the shell, and not
 * the previous release.
 *
 * A status of 200 says the route answers. It says nothing about whether the
 * content reached it: the four help pages spent months returning 200 with an
 * empty state, because they rendered whatever an admin had typed and an admin
 * had typed nothing. So each entry names a sentence and an anchor that only
 * exist if the content is really being served.
 */
const PAGES = [
  {
    path: "/policy",
    must: ["السياس", "banan", "ضمان الحظر", 'id="no-delete"', 'id="no-refund"', "الملخص"],
  },
  {
    path: "/faq",
    must: ["الأسئلة", "banan", "ما الفرق بين Offline وOnline؟", "/policy#warranty"],
  },
  {
    path: "/account_guides",
    must: [
      "banan",
      'id="login-method-1"',
      'id="offline-play"',
      "Link a Nintendo Account",
      "Download Data",
    ],
  },
  {
    path: "/problem",
    must: ["banan", "Can’t play this software right now", "2124-8006", "ما لا يجب فعله"],
  },
];

const ANCHORS = [
  "/policy#no-delete",
  "/account_guides#login-method-1",
  "/account_guides#resend-verification",
  "/problem#RELOGIN_REQUIRED",
];

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};

/*
  Every failure is also kept for a block at the very end.

  A CI log is read from its tail, and the upload step that follows this script
  is long enough to push the interesting lines out of view — which is how two
  runs went by knowing only how many checks failed, not which.
*/
const failed = [];
const fail = (message) => {
  failed.push(message);
  say(`  ✗ ${message}`);
};

async function fetchPage(path) {
  const url = `${ORIGIN}${path}`;
  const started = Date.now();
  const res = await fetch(url, {
    redirect: "manual",
    headers: {
      // A real browser's first request for a pasted link: no referrer, HTML only.
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "ar,en;q=0.8",
      /*
        A browser's user agent, because the site sits behind bot protection and
        a self-identifying script is challenged: the first `/policy` fetch of
        the previous run came back 403 and the same URL answered 200 three
        seconds later. A smoke test that reports the shield rather than the
        site is worse than no smoke test.
      */
      "user-agent":
        "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36",
    },
  });
  /*
    The body of a failure is read too. A 500 from the app carries its own
    error page, and that page usually names the throw — which is the whole
    difference between "the page is broken" and knowing which line broke it.
  */
  const body = await res.text().catch(() => "");
  return { res, body, ms: Date.now() - started };
}

/** One retry for the statuses a shield returns, never for the app's own. */
async function fetchPageWithRetry(path) {
  const first = await fetchPage(path);
  if (first.res.status !== 403 && first.res.status !== 429) return first;
  await new Promise((resolve) => setTimeout(resolve, 3000));
  return fetchPage(path);
}

say(`# Page smoke — ${ORIGIN}`);
say();

for (const page of PAGES) {
  say(`## ${page.path}`);
  try {
    const { res, body, ms } = await fetchPageWithRetry(page.path);
    say(`- status ${res.status} in ${ms}ms`);
    if (res.status !== 200) {
      fail(`expected 200, got ${res.status}${res.headers.get("location") ? ` → ${res.headers.get("location")}` : ""}`);
      const excerpt = body
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 700);
      if (excerpt) say(`  body: ${excerpt}`);
    } else {
      for (const needle of page.must) {
        if (!body.includes(needle)) fail(`the response does not mention ${JSON.stringify(needle)}`);
      }
      /*
        A shell with no content is a 200 that still fails the customer. These
        pages render server-side, so their text is in the first response —
        which is also what a search engine and a link preview see.
      */
      if (body.length < 2000) fail(`response is only ${body.length} bytes — the shell, not the page`);
      if (/\[object Object\]/.test(body)) fail("the page renders [object Object]");
      /*
        The note written for whoever uploads a screenshot. It is stored beside
        every empty slot and must never be rendered to a customer — finding it
        in the HTML means the admin's side of the editor has leaked onto the
        shop's side.
      */
      if (body.includes("أضف صورة")) fail("an admin-only image note reached the page");
      if (/<img[^>]+src=["']["']/.test(body)) fail("the page renders an image with no source");
      if (/\bundefined\b\s*<\//.test(body)) fail("the page renders a bare `undefined`");
    }
  } catch (err) {
    fail(`request threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  say();
}

say(`## anchors`);
for (const path of ANCHORS) {
  /*
    The fragment never reaches the server, so this proves the *path* still
    answers when a customer is deep-linked to a section — which is how every
    link from an order card is written.
  */
  const [bare] = path.split("#");
  try {
    const { res } = await fetchPageWithRetry(bare);
    say(`- \`${path}\` → ${res.status}`);
    if (res.status !== 200) fail(`${bare} answered ${res.status}`);
  } catch (err) {
    fail(`${bare}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
say();

say(`## a path that does not exist`);
try {
  const { res } = await fetchPage("/definitely-not-a-page-9f3a2b");
  say(`- status ${res.status}`);
  if (res.status !== 404) {
    fail(`an unknown path answered ${res.status} — a fallback that answers everything is a site with no 404`);
  }
} catch (err) {
  fail(`request threw: ${err instanceof Error ? err.message : String(err)}`);
}
say();

if (failed.length === 0) {
  say("## All checks passed.");
} else {
  say(`## ${failed.length} check(s) failed`);
  say();
  for (const message of failed) say(`- ${message}`);
}
const { writeFileSync } = await import("node:fs");
writeFileSync("page-smoke.md", lines.join("\n") + "\n");
if (failed.length > 0) process.exitCode = 1;
