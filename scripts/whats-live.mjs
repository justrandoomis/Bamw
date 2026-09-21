#!/usr/bin/env node
/**
 * Which build is actually serving banan.to.
 *
 * Production is deployed by two paths: this repository's `deploy.yml`, and
 * somebody's laptop running `wrangler` directly. Cloudflare records a commit
 * message for the first and nothing at all for the second, so after a laptop
 * deploy the honest answer to "what is live?" is "unknown" — and two lines of
 * work have since fixed the same faults in opposite ways.
 *
 * So this asks the running Worker instead of the deployment list, using
 * fingerprints that only one of the two trees can produce.
 *
 * READ ONLY. Signed out, no cookies, nothing written.
 */
import { writeFileSync } from "node:fs";

const ORIGIN = process.env.ORIGIN || "https://banan.to";
const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};

/*
  A browser-ish user agent, because the edge challenges a bare fetch from a
  runner IP and a 403 challenge page would be read as a failing site.
*/
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

async function get(path, init = {}) {
  const started = Date.now();
  try {
    const res = await fetch(`${ORIGIN}${path}`, {
      ...init,
      headers: { "user-agent": UA, accept: "application/json,text/html", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
    return { ok: true, res, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), ms: Date.now() - started };
  }
}

say(`# What is actually live on ${ORIGIN}`);
say();
say(`Run at ${new Date().toISOString()}. Read only.`);
say();

/* ------------------------------------------------------------------ */
/* 1. The Worker cache header                                          */
/* ------------------------------------------------------------------ */

/*
  `x-cache-status: worker-hit` is written by the revision-keyed Worker cache
  added on the claude branch. No other tree sets that value, so seeing it is
  proof; not seeing it is only evidence, because the first request after a
  deploy legitimately answers `fresh`.
*/
say(`## The Worker cache (claude branch only)`);
say();
let sawWorkerHit = false;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const probe = await get("/api/data?slim=1");
  if (!probe.ok) {
    say(`- attempt ${attempt}: unreachable — ${probe.error}`);
    continue;
  }
  const status = probe.res.headers.get("x-cache-status") ?? "—";
  const version = probe.res.headers.get("x-catalog-version") ?? "—";
  say(
    `- attempt ${attempt}: HTTP ${probe.res.status}, \`x-cache-status: ${status}\`, catalogue version ${version}, ${probe.ms} ms`,
  );
  if (status === "worker-hit") sawWorkerHit = true;
  await probe.res.arrayBuffer();
}
say();
say(
  sawWorkerHit
    ? `**\`worker-hit\` seen — the claude branch's revision-keyed cache is live.**`
    : `\`worker-hit\` not seen. Not conclusive on its own; the payload below decides.`,
);
say();

/* ------------------------------------------------------------------ */
/* 2. Fields only one tree puts in the slim payload                    */
/* ------------------------------------------------------------------ */

/*
  `main` widened the slim payload's field list for its square-card artwork:
  `switch2Enhanced`, `nintendoCardImageTrim` and the legacy spellings
  `nintendo_card_image` / `squareGameImage` / `squareImage` /
  `square_card_image`. The claude branch never added any of them. A product
  carrying one can only have been serialised by main's build.
*/
say(`## Fields in the slim payload`);
say();
const MAIN_ONLY = [
  "switch2Enhanced",
  "nintendoCardImageTrim",
  "nintendo_card_image",
  "squareGameImage",
  "squareImage",
  "square_card_image",
  "originalPrice",
];

const payload = await get("/api/data?slim=1");
if (!payload.ok) {
  say(`- could not read the payload: ${payload.error}`);
} else if (payload.res.status !== 200) {
  say(`- HTTP ${payload.res.status} — the edge answered instead of the Worker.`);
} else {
  const body = await payload.res.json().catch(() => null);
  const products = Array.isArray(body?.products) ? body.products : [];
  say(`- products in the payload: **${products.length.toLocaleString("en-US")}**`);
  const present = new Set();
  for (const product of products) {
    if (!product || typeof product !== "object") continue;
    for (const field of MAIN_ONLY) if (field in product) present.add(field);
  }
  say();
  say(`| field | present |`);
  say(`| --- | --- |`);
  for (const field of MAIN_ONLY) say(`| \`${field}\` | ${present.has(field) ? "**yes**" : "no"} |`);
  say();
  say(
    present.size > 0
      ? `**${present.size} of ${MAIN_ONLY.length} main-only fields present — production is serving \`main\`'s build, not the claude branch.**`
      : `No main-only field present — production is *not* serving main's square-card work.`,
  );
}
say();

/* ------------------------------------------------------------------ */
/* 3. What a signed-out visitor is told                                */
/* ------------------------------------------------------------------ */

/*
  The claude branch answers every 401 with «سجّل الدخول للمتابعة» and gates
  /wallet behind a sign-in. Before it, the wallet rendered for anybody and the
  first action returned the English word «unauthorised».
*/
say(`## What a signed-out visitor is told`);
say();
const wallet = await get("/api/wallet?action=transactions");
if (!wallet.ok) {
  say(`- \`/api/wallet\` unreachable: ${wallet.error}`);
} else {
  const text = (await wallet.res.text()).slice(0, 300);
  say(`- \`GET /api/wallet\` → HTTP ${wallet.res.status}`);
  say(`- body: \`${text.replace(/`/g, "'")}\``);
  say();
  say(
    /سجّل الدخول للمتابعة/.test(text)
      ? `**The Arabic 401 is live — the claude branch's api.ts is serving.**`
      : `The Arabic 401 is not in this answer.`,
  );
}

writeFileSync("whats-live.md", lines.join("\n") + "\n");
