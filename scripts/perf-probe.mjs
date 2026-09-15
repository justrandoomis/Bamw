#!/usr/bin/env node
/**
 * What production actually costs, measured rather than reasoned about.
 *
 * READ ONLY: SELECTs, unauthenticated GETs, and one read query against Workers
 * Logs. It deploys nothing and writes nothing.
 *
 * Three questions the code cannot answer from here:
 *
 *   1. **Where does the CPU go.** Cloudflare records an `outcome` and a
 *      `cpuTimeMs` for every invocation. Tallied per route that says which path
 *      is expensive and which is merely slow — and whether the `exceededCpu`
 *      kills cluster on the cron, on `/api/data`, or on the import.
 *   2. **What the catalogue costs to serve.** The size and timing of
 *      `/api/data`, with and without `?slim=1`, and whether a second request
 *      gets a 304 or pays again.
 *   3. **How big the document is now.** Rows, bytes and product count in
 *      `store_kv`, which is the number every one of those costs scales with.
 *
 * Nothing a request carried is printed: paths are taken apart from their query
 * strings and every run of five or more digits is masked.
 *
 * Usage: node scripts/perf-probe.mjs [--hours 6] [--windows 8]
 */

import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const HOURS = Number(arg("hours", "6"));
const WINDOWS = Number(arg("windows", "8"));
const ORIGIN = process.env.SITE_ORIGIN || "https://banan.to";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const WORKER = process.env.WORKER_NAME || "pixel-cart-cloud";

const SECRETS = [TOKEN, ACCOUNT].filter((v) => v && v.length >= 8);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
/** Digits are addresses here — ids, order codes, phone numbers. */
const mask = (t) => redact(t).replace(/\d{5,}/g, "«n»");
const lines = [];
const say = (t = "") => {
  const s = redact(t);
  lines.push(s);
  console.log(s);
};
const finish = (code) => {
  writeFileSync("perf-probe.md", lines.join("\n") + "\n");
  process.exit(code);
};
const kb = (n) => `${Math.round(Number(n || 0) / 1024).toLocaleString("en-US")} KB`;

say(`# What production costs — READ ONLY`);
say();
say(`Run at ${new Date().toISOString()} against \`${ORIGIN}\`.`);
say();

/* ------------------------------------------------------------------ */
/* 1. What the catalogue costs to serve                                */
/* ------------------------------------------------------------------ */

/*
  Node's fetch rather than curl: the edge challenges curl whatever user agent it
  sends, and a 403 from the challenge would be read as the shop being slow.
*/
async function timed(pathname, headers = {}) {
  const at = Date.now();
  try {
    const res = await fetch(`${ORIGIN}${pathname}`, {
      redirect: "manual",
      headers: { "user-agent": "bananto-perf/1.0", "accept-encoding": "gzip, br", ...headers },
    });
    const head = Date.now() - at;
    const body = await res.arrayBuffer();
    return {
      status: res.status,
      ttfbish: head,
      total: Date.now() - at,
      bytes: body.byteLength,
      encoding: res.headers.get("content-encoding") || "identity",
      cache: res.headers.get("cache-control") || "",
      etag: res.headers.get("etag") || "",
      age: res.headers.get("age") || "",
      cfCache: res.headers.get("cf-cache-status") || "",
      timing: res.headers.get("server-timing") || "",
      challenged: (res.headers.get("content-type") || "").includes("text/html") && res.status === 403,
    };
  } catch (err) {
    return { status: 0, error: String(err).slice(0, 120) };
  }
}

const ROUTES = [
  "/api/data?slim=1",
  "/api/data",
  "/api/health",
  "/",
  "/search?q=zelda",
];

say(`## What each request costs from a runner`);
say();
say(`| path | status | ms | bytes on the wire | encoding | cf-cache | cache-control |`);
say(`| --- | --- | --- | --- | --- | --- | --- |`);
const first = {};
for (const route of ROUTES) {
  const r = await timed(route);
  first[route] = r;
  if (r.status === 0) {
    say(`| \`${route}\` | fetch failed | — | — | — | — | ${r.error} |`);
    continue;
  }
  say(
    `| \`${route}\` | ${r.status}${r.challenged ? " (challenged)" : ""} | ${r.total} | ${
      r.bytes.toLocaleString("en-US")
    } (${kb(r.bytes)}) | ${r.encoding} | ${r.cfCache || "—"} | ${r.cache || "—"} |`,
  );
  if (r.timing) say(`|   ↳ server-timing: ${mask(r.timing)} | | | | | | |`);
}
say();

/*
  The second request is the one that says whether anything is cached at all. A
  payload that costs the same twice is a payload nobody is caching — and at this
  catalogue size that is the difference between a shop that opens and one that
  spins.
*/
say(`## The same request again`);
say();
say(`| path | status | ms | bytes | conditional (If-None-Match) |`);
say(`| --- | --- | --- | --- | --- |`);
for (const route of ["/api/data?slim=1", "/api/data"]) {
  const again = await timed(route);
  const conditional = first[route]?.etag
    ? await timed(route, { "if-none-match": first[route].etag })
    : null;
  say(
    `| \`${route}\` | ${again.status} | ${again.total} | ${(again.bytes ?? 0).toLocaleString("en-US")} | ${
      conditional ? `${conditional.status} in ${conditional.total} ms, ${(conditional.bytes ?? 0).toLocaleString("en-US")} bytes` : "no ETag offered"
    } |`,
  );
}
say();

/* ------------------------------------------------------------------ */
/* 2. How big the document is now                                      */
/* ------------------------------------------------------------------ */

/*
  The database id is committed in `wrangler.jsonc`; the
  `CLOUDFLARE_D1_DATABASE_ID` secret in this repository is empty.
*/
if (!process.env.D1_DATABASE_ID) {
  const found = /"database_id"\s*:\s*"([^"]+)"/.exec(readFileSync("wrangler.jsonc", "utf8"));
  if (found) process.env.D1_DATABASE_ID = found[1];
}

const outfile = path.resolve(".perf-probe-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/import-entry.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "silent",
  alias: { "@": path.resolve("src") },
  external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
});
const app = await import(outfile);

const reachable = await app.d1All("SELECT count(*) AS n FROM store_kv").catch(() => []);
if (!reachable.length) {
  say(`## D1`);
  say();
  say(`**Unreachable from this runner** — no counts would mean anything, so none are printed.`);
  finish(1);
}

say(`## The catalogue document`);
say();
const kv = (
  await app.d1All(
    `SELECT
       SUM(CASE WHEN key = 'store:products' OR key LIKE 'store:products#%' THEN 1 ELSE 0 END) AS chunks,
       SUM(CASE WHEN key = 'store:products' OR key LIKE 'store:products#%' THEN LENGTH(value) ELSE 0 END) AS chunkBytes,
       SUM(CASE WHEN key LIKE 'store:product:%' THEN 1 ELSE 0 END) AS overlays,
       SUM(CASE WHEN key LIKE 'store:product:%' THEN LENGTH(value) ELSE 0 END) AS overlayBytes,
       count(*) AS rows,
       SUM(LENGTH(value)) AS bytes
     FROM store_kv`,
  )
)[0];
say(`| what | value |`);
say(`| --- | --- |`);
say(`| \`store_kv\` rows | ${Number(kv.rows).toLocaleString("en-US")} |`);
say(`| \`store_kv\` bytes | ${Number(kv.bytes).toLocaleString("en-US")} (${kb(kv.bytes)}) |`);
say(`| catalogue chunks | ${kv.chunks} — ${Number(kv.chunkBytes).toLocaleString("en-US")} bytes (${kb(kv.chunkBytes)}) |`);
say(`| per-product overlay rows | ${kv.overlays} — ${Number(kv.overlayBytes ?? 0).toLocaleString("en-US")} bytes |`);
say();
say(
  `> Every cold isolate that calls \`getStore()\` reads the chunks *and* the overlays, ` +
    `parses them, and runs \`normalizeProductRecord\` once per product.`,
);
say();

const idx = (
  await app.d1All(
    `SELECT count(*) AS n,
            SUM(CASE WHEN bare_listing = 1 THEN 1 ELSE 0 END) AS bare,
            SUM(CASE WHEN hidden = 1 THEN 1 ELSE 0 END) AS hidden
       FROM product_index`,
  )
)[0];
say(`\`product_index\`: **${Number(idx.n).toLocaleString("en-US")}** rows — ${idx.bare} bare, ${idx.hidden} hidden.`);
say();

/* ------------------------------------------------------------------ */
/* 3. Where the CPU goes                                               */
/* ------------------------------------------------------------------ */

say(`## Where the CPU goes (last ${HOURS}h, ${WINDOWS} sampled windows)`);
say();
if (!ACCOUNT || !TOKEN) {
  say(`- skipped: no Cloudflare credentials in the environment.`);
  finish(0);
}

/*
  One query returns at most a couple of hundred events, which over six hours is
  whatever happened in the last few minutes. Splitting the window and querying
  each slice separately samples the whole period instead of its tail.
*/
async function telemetry(from, to) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/observability/telemetry/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        view: "events",
        queryId: "perf-probe",
        limit: 200,
        dry: false,
        parameters: {
          datasets: ["cloudflare-workers"],
          filters: [{ key: "$metadata.service", operation: "eq", type: "string", value: WORKER }],
        },
        timeframe: { from, to },
      }),
    },
  );
  const raw = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: `HTTP ${res.status}, body was not JSON` };
  }
  if (!res.ok || payload?.success === false) {
    return { error: `HTTP ${res.status}: ${payload?.errors?.[0]?.message ?? "refused"}` };
  }
  return { events: payload?.result?.events?.events ?? payload?.result?.events ?? [] };
}

const now = Date.now();
const span = Math.floor((HOURS * 3600 * 1000) / WINDOWS);
const perRoute = new Map();
const kills = new Map();
let read = 0;
let refused = "";

for (let w = 0; w < WINDOWS; w++) {
  const to = now - w * span;
  const slice = await telemetry(to - span, to);
  if (slice.error) {
    refused = slice.error;
    break;
  }
  for (const event of slice.events) {
    const runtime = event?.$workers ?? event?.source?.$workers ?? {};
    const outcome = String(runtime?.outcome ?? "unknown");
    if (outcome === "unknown") continue;
    read += 1;

    /*
      The path without its query string. A search term is the customer's, and a
      `?q=` is exactly the kind of thing that must not land in a CI log.
    */
    let route = runtime?.event?.path ?? "";
    if (!route) {
      try {
        route = new URL(String(runtime?.event?.request?.url ?? "")).pathname;
      } catch {
        route = "";
      }
    }
    if (runtime?.eventType === "scheduled") route = `cron ${runtime?.event?.cron ?? ""}`;
    /* Asset and image paths carry a product id; the family is what matters. */
    route = route.replace(/^\/api\/files\/.*/, "/api/files/…").replace(/^\/product\/.*/, "/product/…");
    route = route || "(no path)";

    const cpu = Number(runtime?.cpuTimeMs ?? NaN);
    if (outcome !== "ok") {
      const key = `${outcome} · ${route}`;
      kills.set(key, (kills.get(key) ?? 0) + 1);
      continue;
    }
    if (!Number.isFinite(cpu)) continue;
    if (!perRoute.has(route)) perRoute.set(route, []);
    perRoute.get(route).push(cpu);
  }
}

if (refused) {
  say(`The telemetry query was refused (${refused}).`);
  say(`Most likely the API token lacks \`Workers Observability: Read\`.`);
  finish(0);
}

say(`${read.toLocaleString("en-US")} invocations sampled.`);
say();

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
const rows = [...perRoute.entries()]
  .map(([route, cpus]) => {
    const sorted = cpus.slice().sort((a, b) => a - b);
    return {
      route,
      n: sorted.length,
      p50: pct(sorted, 50),
      p95: pct(sorted, 95),
      max: sorted[sorted.length - 1],
      total: sorted.reduce((s, x) => s + x, 0),
    };
  })
  .sort((a, b) => b.total - a.total);

say(`### CPU per route, for invocations that ended \`ok\``);
say();
say(`| route | n | p50 ms | p95 ms | max ms | total ms |`);
say(`| --- | --- | --- | --- | --- | --- |`);
for (const r of rows.slice(0, 25)) {
  say(`| \`${mask(r.route)}\` | ${r.n} | ${r.p50} | ${r.p95} | ${r.max} | ${Math.round(r.total)} |`);
}
say();
say(`> \`total\` is the share of the Worker's whole CPU bill this route is responsible for.`);
say();

say(`### Invocations that did not end \`ok\``);
say();
if (kills.size === 0) {
  say(`None in the sample.`);
} else {
  say(`| outcome · route | count |`);
  say(`| --- | --- |`);
  for (const [key, n] of [...kills.entries()].sort((a, b) => b[1] - a[1])) {
    say(`| \`${mask(key)}\` | ${n} |`);
  }
}
say();

finish(0);
