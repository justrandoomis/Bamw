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
  if (asText) return { status: res.status, text: await res.text() };
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
const FINGERPRINTS = [
  { tree: "claude", what: "Arabic 401 («سجّل الدخول للمتابعة»)", needle: "سجّل الدخول للمتابعة" },
  { tree: "claude", what: "Worker cache hit header", needle: "worker-hit" },
  { tree: "claude", what: "revision-keyed cache path", needle: "__catalogue/" },
  { tree: "claude", what: "chat refuses an unconvertible photo", needle: "تعذر تحويل هذه الصورة على جهازك" },
  { tree: "claude", what: "queue counts unfinished orders only", needle: "listUnfinishedOrderIds" },
  { tree: "main", what: "square-card slim field `squareGameImage`", needle: "squareGameImage" },
  { tree: "main", what: "square-card slim field `square_card_image`", needle: "square_card_image" },
  { tree: "main", what: "allow-list `DIGITAL_ORDER_KINDS`", needle: "DIGITAL_ORDER_KINDS" },
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
  say(`- bundle read: **${bundle.length.toLocaleString("en-US")}** characters`);
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
