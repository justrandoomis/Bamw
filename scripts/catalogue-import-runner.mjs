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
/*
  The supplier names, and only the supplier names.

  The import that published 1,714 games carried a Chinese name for every row
  and wrote none of them: it handed `d1Batch` `{ sql, binds }` where that
  function reads `s.params`, so every statement threw before it reached D1 and
  a bare `catch {}` ate the error. The names have to be carried across on their
  own now, and this is the narrowest possible way to do it — `decide` resolves
  which product each row is, `updateStore` is never called, and the only table
  written is `product_admin_metadata`. No product document is opened.

  It has its own token file and its own ledger prefix so that authorising a
  name backfill can never be mistaken for authorising a catalogue write.
*/
const NAMES_TOKEN_FILE = arg("names-token-file", "import-sources/names-apply.txt");
const NAMES_ONLY = flag("names-only");
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
/*
  Two rows of the same sheet naming one product with two different Chinese
  names. `decide` keeps the first and refuses the second rather than letting
  the later write win silently, because the admin copies that name to the
  supplier and the wrong one orders the wrong game. The English titles are
  printed so they can be corrected in the sheet; the names themselves are not.
*/
if (preview.nameConflicts?.length) {
  say(`### Supplier names that disagree`);
  say();
  say(`${preview.nameConflicts.length} row(s) name a product another row already named,`);
  say(`with a different Chinese name. The first name stands; these are not written.`);
  say();
  say(`| line | English name |`);
  say(`| --- | --- |`);
  for (const conflict of preview.nameConflicts.slice(0, 40)) {
    say(`| ${conflict.line} | ${String(conflict.englishTitle).replace(/\|/g, "\\|").slice(0, 70)} |`);
  }
  say();
}
if (MODE === "create-only" && preview.updated > 0) {
  say(`**Refused** — create-only decided to update ${preview.updated} rows, which it must never`);
  say(`do. Something has changed in \`buildListing\`; stopping rather than writing.`);
  finish(1);
}
/* ------------------------------------------------------------------ */
/* The supplier names, on their own                                     */
/* ------------------------------------------------------------------ */

/*
  Runs before the catalogue-write token is even looked at, and exits. A names
  backfill and a catalogue import are never the same run.
*/
const namesToken =
  existsSync(NAMES_TOKEN_FILE) &&
  readFileSync(NAMES_TOKEN_FILE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));

if (NAMES_ONLY || namesToken) {
  say(`## Supplier names only`);
  say();
  /*
    `create-only` on purpose. It is the mode that returns `skip` for every row
    matching a product the shop already has, so `decide` cannot propose a
    single product change — and the names are collected from the resolved
    product either way. Even if the write below were wrong, there is no
    product write for it to be wrong about.
  */
  const resolved = app.decide(before, rows, "create-only");
  const names = resolved.names ?? [];
  say(`- rows in the file: **${rows.length.toLocaleString("en-US")}**`);
  say(`- rows that resolve to a product in the shop: **${names.length.toLocaleString("en-US")}**`);
  say(
    `- rows the file names but the shop does not have: **${(rows.length - names.length).toLocaleString("en-US")}**`,
  );
  say();
  if (resolved.created || resolved.updated) {
    say(`**Refused** — create-only proposed ${resolved.created} creates and ${resolved.updated}`);
    say(`updates. It must propose neither. Stopping rather than writing anything.`);
    finish(1);
  }

  let claimed = NAMES_ONLY && APPLY;
  if (!claimed && namesToken) {
    await app.d1Run(
      `CREATE TABLE IF NOT EXISTS console_runs (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
    );
    const rowsClaimed = await app
      .d1All(
        `INSERT INTO console_runs (id, applied_at) VALUES (?, ?)
           ON CONFLICT(id) DO NOTHING RETURNING id`,
        `names:${namesToken}`,
        Math.floor(Date.now() / 1000),
      )
      .catch(() => []);
    if (rowsClaimed.length) {
      say(`Claimed \`${namesToken}\`. Writing names.`);
      claimed = true;
    } else {
      say(`Token \`${namesToken}\` was used before. This run stays a dry run.`);
    }
    say();
  }

  if (!claimed) {
    say(`Dry run. Nothing was written.`);
    finish(0);
  }

  /*
    The statements are built by the same function the admin route uses, and the
    name itself is never printed — it is the supplier's, and private by the
    owner's instruction. What is printed is how many landed.
  */
  const statements = app.supplierNameStatements(names);
  let written = 0;
  for (let at = 0; at < statements.length; at += 20) {
    const group = statements.slice(at, at + 20);
    try {
      await app.d1Batch(group.map((st) => ({ sql: st.sql, binds: st.params })));
      written += group.length;
    } catch (err) {
      say(
        `**Stopped at statement ${at + 1} of ${statements.length}.** ${redact(String(err).slice(0, 300))}`,
      );
      say(`What was written before it stays written; re-running is an upsert and repeats safely.`);
      finish(1);
    }
  }
  /*
    Read back rather than assume. A count is not a name, so nothing private is
    printed — but "the write returned without throwing" is what the last import
    believed too.
  */
  const [count] = await app
    .d1All(
      `SELECT count(*) AS n FROM product_admin_metadata
        WHERE supplier_name_zh_cn IS NOT NULL AND length(trim(supplier_name_zh_cn)) > 0`,
    )
    .catch(() => [{ n: -1 }]);
  say();
  say(`Statements: **${written}** of ${statements.length}.`);
  say(`Products in the shop that now carry a supplier name: **${count?.n ?? "unknown"}**.`);
  finish(0);
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
let namesWritten = 0;
let namesFailed = 0;
let nameError = "";
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

    The `catch {}` that used to be here reported nothing, and that was the
    defect whatever else is wrong: an import can finish green having written
    not one name, and the first person to find out is an admin with an empty
    copy button in front of a customer. A name is still not worth failing the
    import over, so the count and the first error are printed at the end
    instead.
  */
  if (decision?.names?.length) {
    try {
      const statements = app.supplierNameStatements(decision.names);
      if (statements.length) {
        await app.d1Batch(statements.map((s) => ({ sql: s.sql, binds: s.params })));
        namesWritten += decision.names.length;
      }
    } catch (err) {
      namesFailed += decision.names.length;
      if (!nameError) nameError = redact(String(err).slice(0, 200));
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
/*
  The supplier names, counted rather than assumed. The name itself is private
  and is never printed; how many of them landed is not.
*/
say(
  `Supplier names written: **${namesWritten.toLocaleString("en-US")}**` +
    (namesFailed ? `, failed: **${namesFailed.toLocaleString("en-US")}** — ${nameError}` : `.`),
);
finish(namesFailed ? 1 : 0);
