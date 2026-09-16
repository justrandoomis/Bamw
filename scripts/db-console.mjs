#!/usr/bin/env node
/**
 * A console onto the production database and object store.
 *
 * The sandbox this agent runs in has no route to `api.cloudflare.com`, so
 * every look at production costs a workflow run. Up to now each question
 * needed its own script and its own workflow — one to count rows, one to read
 * a key, one to repair media. This is the general one: arbitrary SQL against
 * D1 and arbitrary listings of R2, from a runner, with the guards that keep a
 * console from becoming an incident.
 *
 * ## Reading is the default and writing is not
 *
 * A statement is classified before it is sent. `SELECT`, `WITH`, `EXPLAIN` and
 * `PRAGMA` run as they are. Anything else is a write and is refused unless the
 * run was dispatched with apply set — which is a separate, deliberate act in
 * the workflow's own form, not a flag buried in a string.
 *
 * A write can arrive two ways. A dispatched run with apply set carries it as
 * an input. A pushed run carries it in `.db-console/apply.sql`, committed —
 * which is the better of the two, because then the statement is in the diff
 * where it can be read before it runs. Either way it is checked here, and
 * either way the run-once token at the top of the file is recorded in the
 * database, so the same write cannot be replayed by a later push that happened
 * to touch this script.
 *
 * Three shapes are refused even then, because there is no version of them that
 * is a considered decision taken through a console:
 *
 *   - `DROP` or `TRUNCATE` of anything
 *   - `DELETE` with no `WHERE`
 *   - `UPDATE` with no `WHERE`
 *
 * The catalogue, the prices, the costs and the stock all live in `store_kv`.
 * An `UPDATE store_kv SET value = …` with a slipped `WHERE` is the whole shop.
 *
 * ## What it is allowed to print
 *
 * The owner's standing rule is that customer data does not get kept in GitHub,
 * in logs, or in artifacts. A console that prints whatever a SELECT returns
 * breaks that rule the first time someone selects from `users`. So every cell
 * printed passes two filters:
 *
 *   - **By column name.** A column whose name looks like a credential, a
 *     contact detail, or the Chinese supplier name — private by the owner's
 *     instruction, and never outside the protected admin endpoint — prints as
 *     `«hidden»` and its length, never its content.
 *   - **By content.** A cell that *looks* like an email, a phone number, a
 *     token or a long opaque blob is masked whatever its column is called. A
 *     denylist only knows the names somebody thought of; this catches the rest.
 *
 * Long values are cut to a preview, because the point of looking at
 * `store:products#003` is its shape and its size, not its 400 KB.
 *
 * Counts, lengths and keys are not customer data and are printed in full —
 * they are the facts a diagnosis is actually made of.
 */

import { readFileSync, writeFileSync } from "node:fs";

import {
  isReadOnly,
  maskDigits,
  present as presentCell,
  refusal,
  statementsIn,
} from "./lib/console-guards.mjs";

/* ------------------------------------------------------------------ */
/* Redaction                                                           */
/* ------------------------------------------------------------------ */

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const SECRETS = [TOKEN, ACCOUNT, process.env.CLOUDFLARE_D1_DATABASE_ID].filter(
  (v) => v && v.length >= 8,
);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));

const lines = [];
const say = (t = "") => {
  const s = redact(t);
  lines.push(s);
  console.log(s);
};

const PREVIEW = Number(process.env.CONSOLE_PREVIEW || 220);
const present = (column, value) => presentCell(column, value, { preview: PREVIEW, redact });

/* ------------------------------------------------------------------ */
/* D1                                                                  */
/* ------------------------------------------------------------------ */

/*
  The database id is committed in `wrangler.jsonc` — it is the binding this
  Worker deploys against — and the `CLOUDFLARE_D1_DATABASE_ID` secret the
  workflows pass is empty. Reading the config when the environment has none is
  what stops a report printing `undefined` for every count and calling it a
  finding.
*/
function databaseId() {
  const fromEnv = process.env.CLOUDFLARE_D1_DATABASE_ID || process.env.D1_DATABASE_ID;
  if (fromEnv) return fromEnv;
  const found = /"database_id"\s*:\s*"([^"]+)"/.exec(readFileSync("wrangler.jsonc", "utf8"));
  return found ? found[1] : "";
}

const DATABASE = databaseId();
const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`;

async function d1(sql, params = []) {
  const started = Date.now();
  const res = await fetch(D1_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.success === false) {
    const message =
      (payload?.errors || []).map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(message);
  }
  const result = payload?.result?.[0] ?? {};
  return {
    rows: result.results ?? [],
    changes: result.meta?.changes ?? 0,
    ms: Date.now() - started,
  };
}

/* ------------------------------------------------------------------ */
/* R2                                                                  */
/* ------------------------------------------------------------------ */

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || "bananto";

async function r2List(prefix, limit) {
  const url = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects`,
  );
  if (prefix) url.searchParams.set("prefix", prefix);
  url.searchParams.set("per_page", String(Math.min(limit, 1000)));
  const res = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` } });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.success === false) {
    const message =
      (payload?.errors || []).map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return payload?.result ?? [];
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

const APPLY = String(process.env.CONSOLE_APPLY || "").toLowerCase() === "true";
const MAX_ROWS = Number(process.env.CONSOLE_MAX_ROWS || 40);
const OUT = process.env.CONSOLE_OUT || "db-console.md";

say(`# D1 / R2 console`);
say();
say(
  `Run at ${new Date().toISOString()} — mode: **${APPLY ? "apply (writes allowed)" : "read only"}**.`,
);
say();

if (!ACCOUNT || !TOKEN || !DATABASE) {
  say(`**Cannot reach Cloudflare.** Account, token or database id is missing from this runner.`);
  writeFileSync(OUT, lines.join("\n") + "\n");
  process.exit(1);
}

let failed = false;

/* --- 1. The standing overview, unless the run asked to skip it ----- */

if (String(process.env.CONSOLE_OVERVIEW || "true").toLowerCase() === "true") {
  say(`## Overview`);
  say();
  try {
    const tables = await d1(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_cf_%' ORDER BY name`,
    );
    say(`| table | rows |`);
    say(`| --- | --- |`);
    for (const t of tables.rows) {
      const n = await d1(`SELECT count(*) AS n FROM "${t.name}"`).catch(() => null);
      say(`| \`${t.name}\` | ${n ? Number(n.rows[0]?.n ?? 0).toLocaleString("en-US") : "?"} |`);
    }
    say();

    const kv = await d1(
      `SELECT count(*) AS total,
              SUM(CASE WHEN key LIKE 'store:product:%' THEN 1 ELSE 0 END) AS overlays,
              SUM(CASE WHEN key = 'store:products' OR key LIKE 'store:products#%' THEN 1 ELSE 0 END) AS chunks,
              SUM(LENGTH(value)) AS bytes
         FROM store_kv`,
    );
    const k = kv.rows[0] ?? {};
    say(`### \`store_kv\``);
    say();
    say(`- rows: **${Number(k.total ?? 0).toLocaleString("en-US")}**`);
    say(`- catalogue chunks: **${Number(k.chunks ?? 0)}**`);
    say(`- per-product overlay rows: **${Number(k.overlays ?? 0)}**`);
    say(`- total bytes: **${Number(k.bytes ?? 0).toLocaleString("en-US")}**`);
    say();

    const big = await d1(
      `SELECT key, LENGTH(value) AS len FROM store_kv ORDER BY len DESC LIMIT 12`,
    );
    say(`| largest keys | bytes |`);
    say(`| --- | --- |`);
    for (const r of big.rows) {
      say(`| \`${r.key}\` | ${Number(r.len).toLocaleString("en-US")} |`);
    }
    say();

    /*
      The catalogue is one JSON document split across the chunk rows. Counting
      its products means assembling and parsing it — which is what the Worker
      does on a cold start, so the time printed here is a real number about
      production and not an artefact of the console.
    */
    const chunks = await d1(
      `SELECT key, value FROM store_kv
        WHERE key = 'store:products' OR key LIKE 'store:products#%' ORDER BY key ASC`,
    );
    if (chunks.rows.length) {
      const at = Date.now();
      const joined = chunks.rows.map((r) => String(r.value ?? "")).join("");
      let products = [];
      try {
        products = JSON.parse(joined);
      } catch (err) {
        say(`> The assembled catalogue does not parse: ${maskDigits(String(err).slice(0, 160))}`);
      }
      if (Array.isArray(products)) {
        const hidden = products.filter((p) => p?.hidden === true).length;
        const priced = products.filter((p) => Number(p?.price) > 0).length;
        /*
          Two stored facts, counted, and nothing derived.

          This printed a "bare listings" count read from `bare_listing` — a
          field that does not exist. `isBareListing()` decides it, from the
          price, the image fields and a description floor, and the first report
          this console produced duly said **0**, which reads like a finding and
          was an artefact of asking for the wrong key. Re-deriving the rule here
          would be a second implementation of it, which is how a report starts
          disagreeing with the shop it describes. So the console counts what is
          actually in the document and leaves the categories to the app.
        */
        say(`### Catalogue`);
        say();
        say(`- products: **${products.length.toLocaleString("en-US")}**`);
        say(`- hidden: **${hidden.toLocaleString("en-US")}**`);
        say(`- with a price above zero: **${priced.toLocaleString("en-US")}**`);
        say(
          `- assembled and parsed in **${Date.now() - at} ms** from ${chunks.rows.length} chunks`,
        );
        say();
      }
    }
  } catch (err) {
    failed = true;
    say(`**Overview failed:** ${maskDigits(redact(String(err).slice(0, 300)))}`);
    say();
  }
}

/* --- 2. Whatever SQL this run carries ----------------------------- */

/*
  A committed write file is convenient and therefore dangerous: `on.push.paths`
  fires again the next time this script itself is edited, and the statements
  would run a second time. A token at the top of the file, claimed in the
  database before anything else runs, makes that impossible — the second run
  finds the token already recorded and does nothing.

  The claim is one statement. `ON CONFLICT DO NOTHING RETURNING id` returns a
  row only to the run that inserted it, so two runners racing cannot both win.
*/
async function claimRunOnce(token) {
  await d1(
    `CREATE TABLE IF NOT EXISTS console_runs (
       id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
  );
  const out = await d1(
    `INSERT INTO console_runs (id, applied_at) VALUES (?, ?)
       ON CONFLICT(id) DO NOTHING RETURNING id`,
    [token, Math.floor(Date.now() / 1000)],
  );
  return out.rows.length > 0;
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Runs one script's statements and prints what each did.
 *
 * `apply` is the caller's, never the script's: a file cannot talk its way into
 * being allowed to write, only the run-once claim below can grant that.
 */
async function runStatements(heading, script, apply) {
  const statements = statementsIn(script);
  if (!statements.length) return;
  say(`## ${heading}`);
  say();

  for (const statement of statements) {
    const why = refusal(statement, apply);
    say(`\`\`\`sql`);
    say(maskDigits(redact(statement)));
    say(`\`\`\``);
    if (why) {
      failed = true;
      say();
      say(`**Refused** — ${why}.`);
      say();
      continue;
    }
    try {
      const out = await d1(statement);
      say();
      if (!isReadOnly(statement)) {
        say(`Wrote. Rows changed: **${out.changes}** (${out.ms} ms).`);
        say();
        continue;
      }
      if (!out.rows.length) {
        say(`No rows (${out.ms} ms).`);
        say();
        continue;
      }
      const columns = Object.keys(out.rows[0]);
      say(`| ${columns.join(" | ")} |`);
      say(`| ${columns.map(() => "---").join(" | ")} |`);
      for (const row of out.rows.slice(0, MAX_ROWS)) {
        say(`| ${columns.map((c) => present(c, row[c])).join(" | ")} |`);
      }
      say();
      if (out.rows.length > MAX_ROWS) {
        say(`> ${out.rows.length - MAX_ROWS} further rows not printed.`);
        say();
      }
      say(`${out.rows.length} row(s), ${out.ms} ms.`);
      say();
    } catch (err) {
      failed = true;
      say();
      say(`**Error:** ${maskDigits(redact(String(err).slice(0, 300)))}`);
      say();
    }
  }
}

/*
  The write goes first, so the questions after it are asked of the database it
  leaves behind. A repair and the check that it worked in one run, rather than
  a second push ninety seconds later to find out.
*/
const APPLY_FILE = process.env.CONSOLE_APPLY_FILE;
if (APPLY_FILE) {
  const text = read(APPLY_FILE);
  /* Comments stripped first, so a file of nothing but prose counts as empty. */
  if (statementsIn(text.replace(/^[ \t]*--[^\n]*$/gm, "")).length) {
    const token = (/--\s*run-once:\s*(\S+)/.exec(text) || [])[1];
    say(`## Apply file \`${APPLY_FILE}\``);
    say();
    if (!token) {
      failed = true;
      say(`**Refused** — the file carries statements but no \`-- run-once: <id>\` header.`);
      say(`Without one, a later push that touches this script would run them again.`);
      say();
    } else if (!(await claimRunOnce(token).catch(() => false))) {
      say(`Token \`${token}\` was applied before. Nothing was run.`);
      say();
    } else {
      say(`Claimed \`${token}\`. Running its statements with writes allowed.`);
      say();
      await runStatements("Applied", text, true);
    }
  }
}

/*
  A dispatched run types its SQL into the form. A pushed run has no form, so
  its questions are committed in `.db-console/read.sql`. Neither is granted
  anything by being in a file: `APPLY` is the dispatcher's tick box, and a push
  leaves it false, so a write here is refused exactly as it would be inline.
*/
const asked = String(process.env.CONSOLE_SQL || "").trim() || read(process.env.CONSOLE_READ_FILE);
await runStatements("SQL", asked, APPLY);

/* --- 3. R2 ---------------------------------------------------------- */

const PREFIX = process.env.CONSOLE_R2_PREFIX;
if (PREFIX) {
  say(`## R2 \`${BUCKET}\``);
  say();
  try {
    const objects = await r2List(PREFIX === "*" ? "" : PREFIX, MAX_ROWS);
    say(`Objects under \`${PREFIX === "*" ? "(root)" : PREFIX}\`: **${objects.length}**`);
    say();
    if (objects.length) {
      say(`| key | bytes | uploaded |`);
      say(`| --- | --- | --- |`);
      for (const o of objects.slice(0, MAX_ROWS)) {
        say(
          `| \`${maskDigits(String(o.key ?? ""))}\` | ${Number(o.size ?? 0).toLocaleString(
            "en-US",
          )} | ${String(o.uploaded ?? "").slice(0, 19) || "—"} |`,
        );
      }
      say();
    }
  } catch (err) {
    failed = true;
    say(`**R2 listing failed:** ${maskDigits(redact(String(err).slice(0, 300)))}`);
    say();
  }
}

writeFileSync(OUT, lines.join("\n") + "\n");
if (failed) process.exit(1);
