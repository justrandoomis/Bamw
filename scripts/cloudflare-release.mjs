#!/usr/bin/env node
/**
 * The deploy command Cloudflare Workers Builds runs, and why it is not
 * `wrangler deploy`.
 *
 * Workers Builds defaults its deploy step to `npx wrangler deploy`. On THIS
 * account that command has already failed once, after taking the traffic:
 *
 *   «the first release run uploaded the Worker, took 100% of traffic, and
 *    *then* failed on GET /zones/…/workers/routes with "Authentication error
 *    [code: 10000]"»
 *
 * `wrangler deploy` uploads and shifts traffic in one call and then reconciles
 * the zone's worker routes, which the token is not permitted to read. A red
 * build for a deploy that already succeeded is worse than useless — it invites
 * someone to roll back a release that was fine.
 *
 * So this does what `.github/workflows/deploy.yml` has done ever since: the two
 * halves as two commands. Upload the version, then give it the traffic. The
 * routes for banan.to already exist and nothing here changes them, so the
 * reconciliation had nothing to do anyway.
 *
 * ## WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not apply D1 migrations. Applying a migration is the only step in
 * the old pipeline that touches customer data and cannot be undone by
 * re-running the job, which is why it has always been an explicit opt-in on a
 * human-triggered workflow. A build that runs on every push to the
 * production branch must never be the thing that alters the database.
 *
 * Migrations stay where they were: `.github/workflows/deploy.yml`, behind the
 * `migrate` input, run by a person who meant it.
 */
import { execFileSync } from "node:child_process";

const CONFIG = ["--config", "wrangler.jsonc"];
const say = (t = "") => console.log(t);

/** Whatever the build system tells us about the commit, without inventing it. */
const sha = process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA || "";
const branch = process.env.WORKERS_CI_BRANCH || process.env.GITHUB_REF_NAME || "";
const message =
  [sha && sha.slice(0, 12), branch && `from ${branch}`].filter(Boolean).join(" ") ||
  "cloudflare build";

const run = (args, opts = {}) =>
  execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: opts.capture ? ["inherit", "pipe", "inherit"] : "inherit",
    env: process.env,
  });

say(`→ uploading a version — ${message}`);
const uploaded = run(["versions", "upload", ...CONFIG, "--message", message], { capture: true });
process.stdout.write(uploaded);

/*
  Wrangler prints "Worker Version ID: <uuid>". Read it from there rather than
  asking for the newest version, which would race anything else uploading.
*/
const found = [...uploaded.matchAll(/Worker Version ID:\s*([0-9a-f-]{8,})/gi)].pop();
const version = found?.[1];
if (!version) {
  console.error("could not read the uploaded version id from wrangler output");
  process.exit(1);
}

say();
say(`→ sending 100% of traffic to ${version}`);
run(["versions", "deploy", `${version}@100%`, ...CONFIG, "--yes"]);

say();
say(`deployed ${version}`);
