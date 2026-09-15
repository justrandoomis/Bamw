#!/usr/bin/env node
/**
 * Why the catalogue import stopped at batch three, and why `/api/admin/store`
 * answers 503.
 *
 * READ ONLY. Every SQL statement below is a SELECT, and the production probes
 * are unauthenticated GETs. Nothing here writes, deploys or migrates.
 *
 * ## The one question it exists to settle
 *
 * A 503 carrying `<!DOCTYPE html>` can come from two very different places,
 * and the fix is different for each:
 *
 *   - **The edge.** Cloudflare never ran the Worker, or the Worker was killed
 *     before it could answer. Then the endpoint's own code is irrelevant.
 *   - **The Worker.** It ran, and something inside it failed in a way the
 *     app's own error path did not catch.
 *
 * An unauthenticated request separates them. `/api/admin/store` begins with
 * `requireAdmin`, so a request that reaches the handler answers **401 JSON**.
 * A 503 with an HTML body to the same request never reached it.
 *
 * The rest measures the two things that changed on the day it started: how
 * many rows the store-metadata read now has to walk, and how many bytes it
 * brings back.
 */

import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SECRETS = [process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID].filter(
  (v) => v && v.length >= 8,
);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const lines = [];
const say = (t = "") => {
  const s = redact(t);
  lines.push(s);
  console.log(s);
};

const ORIGIN = process.env.SITE_ORIGIN || "https://banan.to";

/** Digits are addresses here — ids, phone numbers, order codes. */
const mask = (t) => redact(String(t ?? "")).replace(/\d{5,}/g, "«n»");

/* ------------------------------------------------------------------ */
/* 1. What production answers, and from where                          */
/* ------------------------------------------------------------------ */

/*
  Node's fetch rather than curl: the edge challenges curl whatever user agent
  it sends, and a 403 from the challenge would be read as the fault.
*/
async function probe(pathname) {
  const started = Date.now();
  try {
    const res = await fetch(`${ORIGIN}${pathname}`, {
      redirect: "manual",
      headers: { accept: "application/json,text/html", "user-agent": "bananto-diagnostics/1.0" },
    });
    const ms = Date.now() - started;
    const body = await res.text();
    return {
      pathname,
      status: res.status,
      ms,
      type: res.headers.get("content-type") || "",
      /*
        `cf-mitigated` names a challenge; the numeric error code Cloudflare
        puts in its own error pages says which runtime limit was hit. Both are
        facts about the edge, not about anybody's data.
      */
      mitigated: res.headers.get("cf-mitigated") || "",
      code: (body.match(/Error\s*(\d{4})/) || body.match(/"code"\s*:\s*(\d+)/) || [])[1] || "",
      head: body.replace(/\s+/g, " ").slice(0, 200),
      html: body.trimStart().toLowerCase().startsWith("<!doctype"),
    };
  } catch (err) {
    return { pathname, status: 0, ms: Date.now() - started, error: String(err).slice(0, 160) };
  }
}

say(`# Import incident — READ ONLY`);
say();
say(`Run at ${new Date().toISOString()} against \`${ORIGIN}\`.`);
say();
say(`## What production answers`);
say();
say(`| path | status | ms | content-type | html? | cf code |`);
say(`| --- | --- | --- | --- | --- | --- |`);
for (const p of [
  "/api/health",
  "/api/admin/store",
  "/api/admin/products?limit=1",
  "/api/data?slim=1",
]) {
  const r = await probe(p);
  say(
    `| \`${r.pathname}\` | ${r.status || `fetch failed: ${r.error}`} | ${r.ms} | ${r.type || "—"} | ${
      r.html ? "**yes**" : "no"
    } | ${r.code || "—"} |`,
  );
  if (r.head) say(`|   ↳ ${r.head.replace(/\|/g, "\\|")} | | | | | |`);
}
say();
say(
  `> \`/api/admin/store\` answering **401 JSON** means the request reached the handler and the ` +
    `503 is produced inside it. Answering **503 HTML** means it never got there.`,
);
say();

/* ------------------------------------------------------------------ */
/* 2. What the store-metadata read now has to walk                     */
/* ------------------------------------------------------------------ */

/*
  The database id comes from `wrangler.jsonc` when the environment has none.

  It is committed there — it is the binding this Worker deploys against — and
  the `CLOUDFLARE_D1_DATABASE_ID` secret these workflows pass is empty, which
  is why this report's first run printed `undefined` for every count instead of
  saying it could not reach the database.
*/
if (!process.env.D1_DATABASE_ID) {
  const config = readFileSync("wrangler.jsonc", "utf8");
  const found = /"database_id"\s*:\s*"([^"]+)"/.exec(config);
  if (found) process.env.D1_DATABASE_ID = found[1];
}

const outfile = path.resolve(".diagnose-bundle.mjs");
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

const one = async (sql) => (await app.d1All(sql))[0] ?? {};
const reachable = await app.d1All("SELECT count(*) AS n FROM store_kv").catch(() => []);
if (!reachable.length) {
  say(`## D1`);
  say();
  say(`**Unreachable from this runner** — no counts below would mean anything, so none are printed.`);
  say(`Check \`CLOUDFLARE_API_TOKEN\` and that the token can read the \`bananto\` database.`);
  writeFileSync("import-incident.md", lines.join("\n") + "\n");
  process.exit(1);
}
const timed = async (sql) => {
  const at = Date.now();
  const rows = await app.d1All(sql);
  return { ms: Date.now() - at, rows };
};

const kv = await one(
  `SELECT count(*) AS total,
          SUM(CASE WHEN key LIKE 'store:product:%' THEN 1 ELSE 0 END) AS overlays,
          SUM(CASE WHEN key = 'store:products' OR key LIKE 'store:products#%' THEN 1 ELSE 0 END) AS chunks
     FROM store_kv`,
);
say(`## store_kv`);
say();
say(`- rows: **${kv.total}**`);
say(`- catalogue chunks: **${kv.chunks}**`);
say(`- per-product overlay rows (\`store:product:<id>\`): **${kv.overlays}**`);
say();
if (Number(kv.overlays) > 0) {
  say(
    `> Overlays are what an interrupted import leaves behind. \`loadStore()\` reads and ` +
      `re-parses every one of them on each cold start until a full write folds them in.`,
  );
  say();
}

/*
  The metadata read's exact footprint. `NON_PRODUCT_ROWS_SQL` in `db.server.ts`
  excludes the product rows — this counts what is left, which is what
  `/api/admin/store` transfers and parses on every cold isolate.
*/
const META_WHERE = `(key = 'store' OR key LIKE 'store:%' OR key LIKE 'analytics:%')
     AND key NOT LIKE 'store:product:%'
     AND key <> 'store:products'
     AND key NOT LIKE 'store:products#%'`;

const meta = await one(
  `SELECT count(*) AS n, SUM(LENGTH(value)) AS bytes FROM store_kv WHERE ${META_WHERE}`,
);
const metaTimed = await timed(
  `SELECT key, value FROM store_kv WHERE ${META_WHERE} ORDER BY key ASC`,
);
say(`## What \`/api/admin/store\` reads`);
say();
say(`- rows matched: **${meta.n}**`);
say(`- bytes returned: **${Number(meta.bytes ?? 0).toLocaleString("en-US")}**`);
say(`- round trip from a runner: **${metaTimed.ms} ms**`);
say();
const big = await app.d1All(
  `SELECT key, LENGTH(value) AS len FROM store_kv WHERE ${META_WHERE} ORDER BY len DESC LIMIT 15`,
);
say(`| key | bytes |`);
say(`| --- | --- |`);
for (const r of big) say(`| \`${r.key}\` | ${Number(r.len).toLocaleString("en-US")} |`);
say();

/* ------------------------------------------------------------------ */
/* 2b. Whatever is making that read eleven megabytes                    */
/* ------------------------------------------------------------------ */

/*
  Sizes and field names only, never a value.

  The heavy sections are shop data — bundles, banners, page content — but a
  `description` or a `note` in one is somebody's writing and a `data:` URI is
  an image nobody needs to see in a CI log. What matters here is which field is
  carrying the megabytes, and that is answered by its name and its length.
*/
const heavy = await app.d1All(
  `SELECT key, value FROM store_kv
     WHERE key LIKE 'store:bundles%' OR key LIKE 'store:banners%' OR key LIKE 'store:content%'
     ORDER BY key ASC`,
);
const sections = new Map();
for (const row of heavy) {
  const section = String(row.key).split("#")[0];
  sections.set(section, (sections.get(section) ?? "") + String(row.value ?? ""));
}

say(`## Which section carries the weight`);
say();
say(`| section | bytes | items |`);
say(`| --- | --- | --- |`);
const parsed = new Map();
for (const [section, raw] of sections) {
  let items = null;
  try {
    items = JSON.parse(raw);
  } catch {
    items = null;
  }
  if (Array.isArray(items)) parsed.set(section, items);
  say(
    `| \`${section}\` | ${raw.length.toLocaleString("en-US")} | ${
      Array.isArray(items) ? items.length : "not an array"
    } |`,
  );
}
say();

for (const [section, items] of parsed) {
  if (!items.length) continue;
  const sized = items
    .map((item, i) => ({
      id: String(item?.id ?? item?.slug ?? `#${i}`),
      bytes: JSON.stringify(item ?? null).length,
      item,
    }))
    .sort((a, b) => b.bytes - a.bytes);
  const total = sized.reduce((sum, row) => sum + row.bytes, 0);
  if (total < 200_000) continue;

  say(`### \`${section}\` — the largest entries`);
  say();
  say(`| id | bytes |`);
  say(`| --- | --- |`);
  for (const row of sized.slice(0, 8)) {
    say(`| \`${mask(row.id)}\` | ${row.bytes.toLocaleString("en-US")} |`);
  }
  say();

  const worst = sized[0];
  if (worst && worst.bytes > 50_000 && worst.item && typeof worst.item === "object") {
    say(`The biggest one, field by field:`);
    say();
    say(`| field | bytes |`);
    say(`| --- | --- |`);
    const fields = Object.entries(worst.item)
      .map(([field, value]) => [field, JSON.stringify(value ?? null).length])
      .sort((a, b) => b[1] - a[1]);
    for (const [field, bytes] of fields.slice(0, 12)) {
      say(`| \`${mask(field)}\` | ${bytes.toLocaleString("en-US")} |`);
    }
    say();
  }

  /*
    Inline images are the usual answer to "why is this section megabytes". A
    `data:` URI in a stored document is the picture itself, base64, read and
    re-parsed on every load of the whole section.
  */
  const raw = sections.get(section) ?? "";
  const uris = raw.match(/"data:[^"]{200,}"/g) ?? [];
  const uriBytes = uris.reduce((sum, uri) => sum + uri.length, 0);
  say(
    `Inline \`data:\` images in this section: **${uris.length}**, ` +
      `**${uriBytes.toLocaleString("en-US")}** bytes ` +
      `(**${raw.length ? Math.round((uriBytes / raw.length) * 100) : 0}%** of it).`,
  );
  say();
}

/* ------------------------------------------------------------------ */
/* 3. The projection table, and the schema stamp                       */
/* ------------------------------------------------------------------ */

say(`## product_index`);
say();
try {
  const idx = await one(
    `SELECT count(*) AS n,
            SUM(CASE WHEN bare_listing = 1 THEN 1 ELSE 0 END) AS bare,
            SUM(CASE WHEN performance_required = 1 THEN 1 ELSE 0 END) AS perf,
            SUM(CASE WHEN hidden = 1 THEN 1 ELSE 0 END) AS hidden
       FROM product_index`,
  );
  say(`- rows: **${idx.n}**`);
  say(`- flagged \`bare_listing\`: **${idx.bare}**`);
  say(`- flagged \`performance_required\`: **${idx.perf}**`);
  say(`- flagged hidden: **${idx.hidden}**`);
} catch (err) {
  say(`- unreadable: \`${String(err).slice(0, 200)}\``);
}
say();

say(`## schema stamp`);
say();
try {
  const stamp = await one(
    `SELECT value FROM app_schema_meta WHERE key = 'runtime_schema_version'`,
  );
  say(`- \`runtime_schema_version\` in D1: **${stamp.value ?? "unset"}**`);
} catch (err) {
  say(`- \`app_schema_meta\` unreadable: \`${String(err).slice(0, 200)}\``);
}
try {
  const meta2 = await one(
    `SELECT count(*) AS n FROM product_admin_metadata WHERE supplier_name_zh_cn <> ''`,
  );
  say(`- supplier names stored: **${meta2.n}**`);
} catch (err) {
  say(`- \`product_admin_metadata\` unreadable: \`${String(err).slice(0, 200)}\``);
}
say();

/* ------------------------------------------------------------------ */
/* 4. What the runtime recorded for those requests                     */
/* ------------------------------------------------------------------ */

/*
  Workers Logs, read for request *outcomes* rather than for log lines.
  `outcome` is the runtime's own verdict on an invocation — `ok`,
  `exception`, `exceededCpu`, `exceededMemory`, `canceled` — and it is the one
  field that says whether a 503 was the Worker failing or the edge never
  running it. Nothing a request carried is printed: the path is taken apart
  from its query string, and every run of five or more digits is masked,
  because an id is an address.
*/
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const WORKER = process.env.WORKER_NAME || "pixel-cart-cloud";
const HOURS = Number(process.env.INCIDENT_HOURS || "24");

say(`## Request outcomes the runtime recorded (last ${HOURS}h)`);
say();
if (!ACCOUNT || !TOKEN) {
  say(`- skipped: no Cloudflare credentials in the environment.`);
} else {
  const to = Date.now();
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/observability/telemetry/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        view: "events",
        queryId: "import-incident",
        limit: 200,
        dry: false,
        parameters: {
          datasets: ["cloudflare-workers"],
          filters: [
            { key: "$metadata.service", operation: "eq", type: "string", value: WORKER },
          ],
        },
        timeframe: { from: to - HOURS * 3600 * 1000, to },
      }),
    },
  );
  const raw = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }
  if (!res.ok || payload?.success === false || !payload) {
    say(`- the query was refused (HTTP ${res.status}).`);
    for (const e of payload?.errors ?? []) say(`  - ${mask(e?.message ?? JSON.stringify(e))}`);
    say(`  - most likely the API token lacks \`Workers Observability: Read\`.`);
  } else {
    const events = payload?.result?.events?.events ?? payload?.result?.events ?? [];
    say(`${events.length} invocation(s) read.`);
    say();
    const tally = new Map();
    const shown = [];
    for (const event of events) {
      /*
        `$workers` is a sibling of `source`, not a child of it. Reading it
        through `event.source` — which exists, and holds the log line — lost
        every runtime field and reported two hundred invocations as `unknown`.
      */
      const src = event ?? {};
      const w = src?.$workers ?? src?.source?.$workers ?? {};
      const outcome = String(w?.outcome ?? src?.outcome ?? "unknown");
      let route = "";
      try {
        route = new URL(String(w?.event?.request?.url ?? src?.url ?? "")).pathname;
      } catch {
        route = "";
      }
      const status = w?.event?.response?.status ?? "";
      const err = w?.event?.error ?? w?.exception ?? src?.exception ?? null;
      const key = `${outcome} ${route} ${status}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
      if (outcome !== "ok" && shown.length < 15) {
        shown.push({
          at: new Date(Number(event?.timestamp ?? 0)).toISOString().slice(0, 19),
          outcome,
          route,
          status,
          cpu: w?.cpuTimeMs ?? w?.cpuTime ?? "",
          wall: w?.wallTimeMs ?? w?.wallTime ?? "",
          name: err?.name ?? err?.type ?? "",
          message: err?.message ?? "",
          stack: err?.stack ?? "",
        });
      }
    }
    say(`| outcome · path · status | count |`);
    say(`| --- | --- |`);
    for (const [key, n] of [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      say(`| \`${mask(key)}\` | ${n} |`);
    }
    say();
    for (const e of shown) {
      say(
        `- \`${e.at}Z\` **${mask(e.outcome)}** \`${mask(e.route) || "—"}\` → ${e.status || "—"}` +
          ` (cpu ${e.cpu || "—"} ms, wall ${e.wall || "—"} ms)`,
      );
      if (e.name || e.message) say(`  - ${mask(e.name)}: ${mask(e.message).slice(0, 300)}`);
      if (e.stack) say(`  - ${mask(String(e.stack)).replace(/\n/g, " | ").slice(0, 500)}`);
    }
    /*
      When nothing carried a message, print one event's structure so the field
      names can be corrected rather than guessed at a second time.
    */
    if (events.length > 0 && shown.every((e) => !e.message)) {
      say();
      say(`No exception message came through. One event's shape, digits masked:`);
      say("```json");
      say(mask(JSON.stringify(events[0], null, 2)).slice(0, 2000));
      say("```");
    }
  }
}
say();

writeFileSync("import-incident.md", lines.join("\n") + "\n");
