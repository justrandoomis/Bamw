#!/usr/bin/env node
/**
 * Finishing the supplier catalogue import from a runner, not a browser.
 *
 * The import posts a batch at a time to `/api/admin/catalogue-import`, and that
 * is a Worker request. This shop is on the Cloudflare Workers **Free** plan —
 * `wrangler deploy` said so itself, refusing a `limits` block with
 * `CPU limits are not supported for the Free plan [code: 100328]` — and a
 * catalogue write does not fit in the CPU a request on that plan is allowed.
 * The owner's run died at batch 12 of 16 with an HTML 503, and nine
 * `exceededCpu` kills for that route are in the telemetry.
 *
 * A GitHub Actions runner has no such ceiling. It can take as long as the work
 * takes. So this does the same import, through the same code, from there.
 *
 * ## Same code, deliberately
 *
 * The rows are parsed by `parseCatalogueCsv` — the function the browser preview
 * uses, so what a preview showed is what this does. Which existing product a
 * row matches is decided by `decide` — the function the Worker route uses. The
 * write goes through `updateStore` — the path the route writes through, with
 * its revision guard, its 400 KB chunking and its admin-listing projection.
 *
 * None of that is reimplemented here. A second implementation of "which product
 * is this row?" is how an import creates a duplicate of a game already on sale.
 *
 * ## What it will not do
 *
 * `create-only` is the default, and it returns `action: "skip"` for every row
 * matching an existing product — so nothing already in the shop can be touched
 * at all. Two modes go further, and each is a separate, named decision:
 *
 *   - `refresh-content` writes the title, the cover, the publisher, the
 *     languages, the store link and the NSUID, and provably nothing else. It
 *     is what the owner's second sheet is for: bring the artwork across, leave
 *     the product «نفسه من حيث التكلفه والبيع».
 *   - `refresh-prices` writes the price and the cost, and nothing else.
 *
 * Neither touches stock, visibility, options, types, trade-in values or
 * ordering, and a blank cell never overwrites anything — see
 * `-a-content-refresh-cannot-move-money.test.ts`, which compares the whole
 * stored product before and after and fails on any field outside the allowed
 * set.
 *
 * Dry run is the default. `--apply` is a separate, deliberate word.
 *
 * ## The torn-write hazard, and why batches stay small
 *
 * Over the REST adapter a "batch" is a plain for-loop, not a transaction
 * (`d1.server.ts`), and `persistStore` DELETEs the catalogue chunk rows before
 * re-inserting them. A run interrupted between those two is a catalogue with
 * missing chunks. So: the count of products is read back after every batch and
 * the run stops on any decrease, rather than continuing to write on top of a
 * catalogue that just lost rows.
 *
 * Usage:
 *   node scripts/catalogue-import-runner.mjs --file import-sources/catalogue.csv
 *   node scripts/catalogue-import-runner.mjs --file ... --apply
 */

import { build } from "esbuild";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 && process.argv[at + 1] && !process.argv[at + 1].startsWith("--")
    ? process.argv[at + 1]
    : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const FILE = arg("file", "import-sources/catalogue.csv");
const APPLY = flag("apply");
const MODE = arg("mode", "create-only");
const BATCH = Math.max(1, Math.min(Number(arg("batch", "100")), 250));
/*
  `unique-only` drops the cover from any row whose URL also sits on a different
  game — a wrong picture is worse than none. `all` trusts the sheet.
*/
const COVERS = arg("covers", "unique-only");
/*
  A committed one-shot authorisation, for the same reason `.db-console` has one.

  GitHub only accepts a `workflow_dispatch` for a workflow already on the
  default branch, so until this merges the only trigger is a push — and a push
  must never be able to write casually, or every later edit to this script would
  re-import the catalogue. The token in this file is claimed in the database
  before anything is written, so it authorises exactly one run, and the commit
  that adds it is the reviewable record of who asked for it.
*/
const APPLY_TOKEN_FILE = arg("apply-token-file", "import-sources/apply.txt");
const OUT = process.env.IMPORT_OUT || "catalogue-import-runner.md";

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
const finish = (code) => {
  writeFileSync(OUT, lines.join("\n") + "\n");
  process.exit(code);
};

say(`# Catalogue import — from a runner`);
say();
say(`Run at ${new Date().toISOString()} — mode: **${APPLY ? "APPLY" : "dry run"}**, ${MODE}.`);
say();

const MODES = ["create-only", "refresh-prices", "refresh-content"];
if (!MODES.includes(MODE)) {
  say(`**Refused** — \`--mode\` must be one of ${MODES.map((m) => `\`${m}\``).join(", ")}.`);
  finish(1);
}
if (!existsSync(FILE)) {
  say(`**No catalogue file at \`${FILE}\`.**`);
  say();
  say(`The supplier list is not in this repository — it has only ever existed as a file`);
  say(`uploaded to the admin modal in a browser. Commit it (or pass \`--file\`) and this`);
  say(`finishes the import without anyone clicking through sixteen batches.`);
  finish(1);
}

/*
  The database id is committed in `wrangler.jsonc`; the
  `CLOUDFLARE_D1_DATABASE_ID` secret in this repository is empty.
*/
if (!process.env.D1_DATABASE_ID) {
  const found = /"database_id"\s*:\s*"([^"]+)"/.exec(readFileSync("wrangler.jsonc", "utf8"));
  if (found) process.env.D1_DATABASE_ID = found[1];
}

const outfile = path.resolve(".catalogue-import-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/catalogue-import-entry.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "silent",
  alias: { "@": path.resolve("src") },
  external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
  plugins: [
    {
      name: "stub-tanstack-start-virtuals",
      setup(pluginBuild) {
        /* Reached by the import graph, never by a call — see the entry's note. */
        const virtual = /^(#tanstack-router-entry|#tanstack-start-entry|tanstack-start-manifest:)/;
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

/* ------------------------------------------------------------------ */
/* What the file says                                                  */
/* ------------------------------------------------------------------ */

const parsed = app.parseCatalogueCsv(readFileSync(FILE, "utf8"));
say(`## The file`);
say();
say(`- \`${FILE}\``);
say(`- valid rows: **${parsed.rows.length.toLocaleString("en-US")}**`);
say(`- rows the parser refused: **${parsed.issues.length}**`);
if (parsed.issues.length) {
  say();
  say(`| line | why |`);
  say(`| --- | --- |`);
  for (const issue of parsed.issues.slice(0, 25)) {
    say(`| ${issue.line ?? "—"} | ${String(issue.message).replace(/\|/g, "\\|")} |`);
  }
  if (parsed.issues.length > 25) say(`| … | ${parsed.issues.length - 25} more |`);
}
/* ------------------------------------------------------------------ */
/* Covers that sit on more than one game                               */
/* ------------------------------------------------------------------ */

let rows = parsed.rows;
const { shared } = app.withoutSharedCovers(parsed.rows);
if (shared.size) {
  say();
  say(`### ${shared.size} cover${shared.size === 1 ? "" : "s"} on more than one game`);
  say();
  say(`| games | cover |`);
  say(`| --- | --- |`);
  for (const [url, names] of [...shared].slice(0, 30)) {
    say(`| ${names.join(" · ").replace(/\|/g, "\\|").slice(0, 90)} | \`…${url.slice(-52)}\` |`);
  }
  if (shared.size > 30) say(`| … | ${shared.size - 30} more |`);
  say();
  if (COVERS === "unique-only") {
    const applied = app.withoutSharedCovers(parsed.rows);
    rows = applied.rows;
    say(
      `Dropping the cover from **${applied.dropped}** row(s). Every link in this file ` +
        `works, so these are not broken images — they are rows matched to the wrong ` +
        `page, and the shop would show one game's artwork on another. A listing with ` +
        `no picture falls back to the placeholder the shop designed.`,
    );
    say(`Pass \`--covers all\` to import them anyway.`);
  } else {
    say(`\`--covers all\` was given: these are being imported as the sheet has them.`);
  }
}

const dupes = app.duplicateNames(parsed.rows);
if (dupes.length) {
  say();
  say(`- names appearing more than once in the file: **${dupes.length}**`);
}
say();
if (!parsed.rows.length) {
  say(`Nothing to import.`);
  finish(1);
}

/*
  The database comes after the file on purpose: a malformed CSV is worth
  reporting whether or not this runner can reach production, and that makes the
  file checkable from anywhere the repository is.
*/
const reachable = await app.d1All("SELECT count(*) AS n FROM store_kv").catch(() => []);
if (!reachable.length) {
  say(`**D1 unreachable from this runner.** The file above was read; nothing was written.`);
  finish(1);
}

/* ------------------------------------------------------------------ */
/* What it would do                                                    */
/* ------------------------------------------------------------------ */

const before = await app.getStore();
const beforeCount = (before.products ?? []).length;
say(`## The catalogue now`);
say();
say(`- products: **${beforeCount.toLocaleString("en-US")}**`);
say();

const preview = app.decide(before, rows, MODE);
say(`## What this run would do`);
say();
say(`- create: **${preview.created.toLocaleString("en-US")}**`);
say(`- update: **${preview.updated.toLocaleString("en-US")}**`);
say(
  `- leave alone: **${(rows.length - preview.created - preview.updated).toLocaleString("en-US")}**`,
);
say();
if (MODE === "create-only" && preview.updated > 0) {
  say(`**Refused** — create-only decided to update ${preview.updated} rows, which it must never`);
  say(`do. Something has changed in \`buildListing\`; stopping rather than writing.`);
  finish(1);
}
/*
  Claimed against the same `console_runs` ledger the D1 console writes to, with
  the same statement: `ON CONFLICT DO NOTHING RETURNING id` hands a row only to
  the run that inserted it, so a second push finds the token spent and does
  nothing.
*/
let apply = APPLY;
if (!apply && existsSync(APPLY_TOKEN_FILE)) {
  const token = readFileSync(APPLY_TOKEN_FILE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  if (token) {
    say(`## Apply token`);
    say();
    await app.d1Run(
      `CREATE TABLE IF NOT EXISTS console_runs (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
    );
    const claimed = await app
      .d1All(
        `INSERT INTO console_runs (id, applied_at) VALUES (?, ?)
           ON CONFLICT(id) DO NOTHING RETURNING id`,
        `import:${token}`,
        Math.floor(Date.now() / 1000),
      )
      .catch(() => []);
    if (claimed.length) {
      say(`Claimed \`${token}\`. Writing.`);
      apply = true;
    } else {
      say(`Token \`${token}\` was used before. This run stays a dry run.`);
    }
    say();
  }
}

if (!apply) {
  say(`Dry run. Nothing was written. Re-run with \`--apply\` to write.`);
  finish(0);
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

say(`## Writing`);
say();
say(`| batch | rows | created | updated | products after | ms |`);
say(`| --- | --- | --- | --- | --- | --- |`);

let created = 0;
let updated = 0;
let last = beforeCount;

for (let at = 0; at < rows.length; at += BATCH) {
  const slice = rows.slice(at, at + BATCH);
  const started = Date.now();
  let decision;
  try {
    await app.updateStore((current) => {
      decision = app.decide(current, slice, MODE);
      return { ...current, products: decision.products };
    });
    app.invalidateStoreCache();
  } catch (err) {
    say(`| ${at / BATCH + 1} | ${slice.length} | — | — | — | failed |`);
    say();
    say(`**Stopped:** ${redact(String(err).slice(0, 300))}`);
    say(`What was written before this batch stays written; re-running skips it.`);
    finish(1);
  }

  /*
    The supplier's Chinese name, through the same guarded writer the route uses.
    It is private by the owner's instruction and never printed here.
  */
  if (decision?.names?.length) {
    try {
      const statements = app.supplierNameStatements(decision.names);
      if (statements.length) {
        await app.d1Batch(statements.map((s) => ({ sql: s.sql, binds: s.params })));
      }
    } catch {
      /* A supplier name is metadata; a failure here does not fail the import. */
    }
  }

  created += decision?.created ?? 0;
  updated += decision?.updated ?? 0;

  const after = await app.getStore();
  const count = (after.products ?? []).length;
  say(
    `| ${at / BATCH + 1} | ${slice.length} | ${decision?.created ?? 0} | ${decision?.updated ?? 0} | ${count.toLocaleString("en-US")} | ${Date.now() - started} |`,
  );

  /*
    A REST "batch" is a for-loop, not a transaction, and `persistStore` deletes
    the catalogue chunk rows before rewriting them. If the count ever falls, a
    write was torn — and the worst thing to do then is write again on top of it.
  */
  if (count < last) {
    say();
    say(`**Stopped: the catalogue lost products.** ${last} before this batch, ${count} after.`);
    say(`Nothing further is written. Check \`store_kv\` chunk rows before re-running.`);
    finish(1);
  }
  last = count;
}

say();
say(
  `Created **${created.toLocaleString("en-US")}**, updated **${updated.toLocaleString("en-US")}**.`,
);
say(
  `Catalogue: ${beforeCount.toLocaleString("en-US")} → **${last.toLocaleString("en-US")}** products.`,
);
finish(0);
