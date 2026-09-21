#!/usr/bin/env node
/**
 * Which build is actually serving banan.to — asked of the deployed code.
 *
 * Production is deployed two ways: this repository's `deploy.yml`, and
 * somebody running `wrangler` on a laptop. Cloudflare records a commit message
 * for the first and nothing at all for the second, so after a laptop deploy
 * the deployment list cannot say what is running. Two branches have since
 * fixed several of the same faults in opposite ways, which makes "which one is
 * live?" a question with real consequences.
 *
 * The first version of this asked banan.to over HTTP and was answered by the
 * edge's bot challenge five times out of five — it fired its requests
 * back-to-back from a runner IP, which is exactly what a challenge is for. So
 * it asks Cloudflare for the deployed script instead: no challenge, no
 * guessing, and it reads the code that is actually running rather than
 * behaviour that might be cached.
 *
 * READ ONLY. Fetches script content and metadata; writes nothing.
 */
import { writeFileSync } from "node:fs";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const SCRIPT = process.env.WORKER_NAME || "pixel-cart-cloud";
if (!ACCOUNT || !TOKEN) throw new Error("missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN");

const SECRETS = [TOKEN, ACCOUNT].filter((v) => v && v.length >= 8);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const lines = [];
const say = (t = "") => {
  const safe = redact(t);
  lines.push(safe);
  console.log(safe);
};

async function api(path, asText = false) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (asText) {
    return {
      status: res.status,
      text: await res.text(),
      type: res.headers.get("content-type") ?? "",
    };
  }
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: null, text };
  }
}

say(`# Which build is live`);
say();
say(`Run at ${new Date().toISOString()}. Read only — the deployed script, not the site.`);
say();

/* ------------------------------------------------------------------ */
/* Which version is serving                                            */
/* ------------------------------------------------------------------ */

const deployments = await api(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/deployments`);
const current = deployments.body?.result?.deployments?.[0];
const serving = current?.versions?.[0]?.version_id ?? null;
say(`## The serving version`);
say();
if (!current) {
  say(`- could not read the deployment list (HTTP ${deployments.status}).`);
} else {
  say(`- deployed at: \`${current.created_on ?? "—"}\``);
  say(`- by: \`${current.author_email ?? "— (no author recorded)"}\``);
  say(`- source: \`${current.source ?? "—"}\``);
  say(`- version: \`${String(serving ?? "—").slice(0, 8)}\``);
  /*
    A deployment made by `wrangler` from somebody's machine carries no commit
    message; one made by the pipeline carries the commit it was built from.
    That difference is the whole reason this script exists.
  */
  const message = current.versions?.[0]?.version?.annotations?.["workers/message"];
  say(`- commit recorded: ${message ? `\`${message}\`` : "**none — deployed outside the pipeline**"}`);
}
say();

/* ------------------------------------------------------------------ */
/* What is in the deployed bundle                                      */
/* ------------------------------------------------------------------ */

/*
  Strings that only one of the two trees can put in the bundle. They are
  deliberately literal user-facing text and field names, because a minifier
  renames identifiers but never rewrites a string literal or an object key
  that is read dynamically.
*/
/*
  Strings that survive a build and a minifier, and that live in the *Worker*.

  The first attempt at this list was wrong in two ways and the wrongness was
  invisible, which is worse than a missing answer. Three of its eight entries
  were client-side — the Arabic 401 is in `lib/api.ts`, the photo refusal is in
  `ChatView.tsx` — so they are in the browser bundle the Worker serves as a
  static asset, not in the Worker script at all. Two more were bare identifiers
  (`listUnfinishedOrderIds`, `DIGITAL_ORDER_KINDS`), which a minifier renames
  by design. Five of eight could never have matched whatever was deployed.

  What is left is string literals emitted by server code: header values,
  URL fragments, and object keys read dynamically from a field list.
*/
const CONTROL = [
  /*
    Present in every build of this app, from either branch, for years. If the
    control does not match, the response is not the Worker's code and every
    other row below is meaningless rather than negative.
  */
  { what: "`x-catalog-version` header", needle: "x-catalog-version" },
  { what: "`catalog_unavailable` refusal", needle: "catalog_unavailable" },
];

const FINGERPRINTS = [
  { tree: "claude", what: "Worker cache hit header (`worker-hit`)", needle: "worker-hit" },
  { tree: "claude", what: "revision-keyed cache path (`__catalogue/`)", needle: "__catalogue/" },
  { tree: "claude", what: "`orders_status_idx`", needle: "orders_status_idx" },
  { tree: "claude", what: "AVIF admitted to member uploads", needle: "gif|avif|mp4" },
  { tree: "main", what: "slim field `squareGameImage`", needle: "squareGameImage" },
  { tree: "main", what: "slim field `square_card_image`", needle: "square_card_image" },
  { tree: "main", what: "slim field `nintendoCardImageTrim`", needle: "nintendoCardImageTrim" },
  { tree: "main", what: "slim field `switch2Enhanced`", needle: "switch2Enhanced" },
];

say(`## Fingerprints in the deployed bundle`);
say();

/*
  Three ways to ask for the code, because which one answers depends on how the
  Worker was uploaded. A modules Worker refuses the old `/content` path with
  405 — the method is not allowed there, which is not the same as the script
  being missing — so the version-scoped endpoint is tried first and the plain
  one is kept as the last resort.
*/
const ENDPOINTS = [
  serving ? `/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/versions/${serving}/content` : null,
  `/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/content/v2`,
  `/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/content`,
].filter(Boolean);

let content = null;
for (const endpoint of ENDPOINTS) {
  const attempt = await api(endpoint, true);
  const where = endpoint.replace(ACCOUNT, "«account»");
  if (attempt.status === 200 && attempt.text) {
    say(`- read from \`${where}\``);
    content = attempt;
    break;
  }
  say(`- \`${where}\` → HTTP ${attempt.status}`);
}
say();

if (!content) {
  say(`**Could not read the deployed script from any endpoint.** The deployment`);
  say(`facts above still stand; only the fingerprinting below is unavailable.`);
} else {
  const bundle = content.text;
  say(`- content-type: \`${content.type || "—"}\``);
  say(`- bundle read: **${bundle.length.toLocaleString("en-US")}** characters`);

  /*
    A modules Worker comes back as multipart/form-data, one part per module.
    The first read of this returned 31,990 characters for an application whose
    built Worker is megabytes — so it was an envelope, not the code, and the
    "no fingerprints found" it produced meant nothing at all. Listing the parts
    is what makes that visible instead of quietly wrong.
  */
  const parts = [...bundle.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  if (parts.length) {
    say(`- modules in the response: ${parts.map((n) => `\`${n}\``).join(", ")}`);
  }
  /*
    The control decides whether anything below is worth reading. A response
    that does not contain strings every build of this app emits is not this
    app's code, and a table of "no" drawn from it would be a guess wearing a
    verdict.
  */
  say();
  const controlHits = CONTROL.filter((c) => bundle.includes(c.needle));
  say(`| control | in the response |`);
  say(`| --- | --- |`);
  for (const c of CONTROL) say(`| ${c.what} | ${bundle.includes(c.needle) ? "**yes**" : "no"} |`);
  say();
  if (controlHits.length === 0) {
    say(`**Refusing to draw a conclusion.** Not one string that every build of`);
    say(`this app emits is in this response, so it is an envelope or a stub`);
    say(`rather than the running code. The first 400 characters, so the shape`);
    say(`can be seen:`);
    say();
    say("```");
    say(redact(bundle.slice(0, 400)));
    say("```");
    writeFileSync("whats-live.md", lines.join("\n") + "\n");
    process.exit(0);
  }
  say(`Control matched — this is the Worker's code, so the rows below mean something.`);
  say();
  say(`| tree | fingerprint | in the deployed bundle |`);
  say(`| --- | --- | --- |`);
  const score = { claude: 0, main: 0 };
  for (const fp of FINGERPRINTS) {
    const found = bundle.includes(fp.needle);
    if (found) score[fp.tree] += 1;
    say(`| ${fp.tree} | ${fp.what} | ${found ? "**yes**" : "no"} |`);
  }
  say();
  const claudeTotal = FINGERPRINTS.filter((f) => f.tree === "claude").length;
  const mainTotal = FINGERPRINTS.filter((f) => f.tree === "main").length;
  say(`**claude branch: ${score.claude}/${claudeTotal} · main: ${score.main}/${mainTotal}**`);
  say();
  if (score.claude > 0 && score.main > 0) {
    say(`Both trees are present — the running build already carries work from each.`);
  } else if (score.claude > 0) {
    say(`Only the claude branch's work is live. Main's PR #64 is **not** in production.`);
  } else if (score.main > 0) {
    say(`Only main's work is live. The eight fixes from the claude branch are **not** in production.`);
  } else {
    say(`Neither tree's fingerprints are present — this build predates both.`);
  }
}

writeFileSync("whats-live.md", lines.join("\n") + "\n");
