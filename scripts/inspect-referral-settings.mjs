#!/usr/bin/env node
/**
 * What the referral programme is actually set to in production. Read-only.
 *
 * The defaults in `config.ts` are only what a store with no saved settings
 * gets. Once an admin has saved the settings block once, the stored values win
 * for ever — so changing a default fixes nothing on a shop that has one.
 * Before touching the code, this asks the live store document which rules are
 * really in force.
 *
 * It also counts the attribution and reward rows by status, which says whether
 * the programme is refusing at capture, at checkout, or at payout. Counts and
 * refusal reasons only: no user id, phone, email, address or device hash is
 * read, because a workflow artifact outlives the question it was run for.
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const DB_NAME = "bananto";
const CONFIG = "wrangler.jsonc";

const WRANGLER =
  process.env.WRANGLER_BIN ||
  (existsSync("node_modules/.bin/wrangler") ? "node_modules/.bin/wrangler" : "wrangler");
const ENV = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };

const MUTATING =
  /(^|[^_\w])(insert|update|delete|replace|upsert|alter|drop|attach|detach|vacuum|reindex|truncate)([^_\w]|$)/i;
function d1(sql) {
  if (!/^\s*select\b/i.test(sql) || MUTATING.test(sql) || sql.replace(/;\s*$/, "").includes(";")) {
    throw new Error(`REFUSED: ${sql.slice(0, 60)}`);
  }
  const raw = execFileSync(
    WRANGLER,
    ["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", sql],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: ENV, timeout: 120_000 },
  );
  const i = raw.search(/[[{]/);
  const parsed = JSON.parse(raw.slice(i));
  return (Array.isArray(parsed) ? parsed[0] : parsed)?.results ?? [];
}

/** A count query that answers 0 rather than throwing when the table is absent. */
function countSafe(sql) {
  try {
    return d1(sql);
  } catch (error) {
    return [{ _missing: String(error).split("\n")[0].slice(0, 120) }];
  }
}

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};

/* ------------------------------ the settings ------------------------------ */

const settingsRow = d1("SELECT value FROM store_kv WHERE key = 'store:settings'")?.[0]?.value;
let stored;
try {
  stored = settingsRow ? JSON.parse(settingsRow) : undefined;
} catch {
  stored = undefined;
}
const referral = stored?.referral;

say("# Referral programme — what production is actually set to");
say();
if (!settingsRow) {
  say("No `store:settings` row at all: every value below is the code default.");
} else if (!referral) {
  say(
    "`store:settings` exists but carries **no `referral` block**, so the code" +
      " defaults are in force and editing them takes effect.",
  );
} else {
  say(
    "`store:settings.referral` **is stored**, so these values win over the code" +
      " defaults — changing a default in `config.ts` would not move them.",
  );
  say();
  say("| setting | stored value |");
  say("|---|---|");
  for (const [key, value] of Object.entries(referral)) {
    say(`| \`${key}\` | ${JSON.stringify(value)} |`);
  }
}
say();

/* --------------------------- how far rows get ---------------------------- */

say("## Attributions by status");
say();
const attributions = countSafe(
  "SELECT status, COUNT(*) AS n FROM referral_attributions GROUP BY status ORDER BY n DESC",
);
if (attributions[0]?._missing) {
  say(`_could not read: ${attributions[0]._missing}_`);
} else if (!attributions.length) {
  say("_none — nothing has ever been captured_");
} else {
  say("| status | rows |");
  say("|---|---|");
  for (const row of attributions) say(`| ${row.status ?? "(null)"} | ${row.n} |`);
}
say();

say("## Rewards by status");
say();
const rewards = countSafe(
  "SELECT status, COUNT(*) AS n FROM referral_rewards GROUP BY status ORDER BY n DESC",
);
if (rewards[0]?._missing) {
  say(`_could not read: ${rewards[0]._missing}_`);
} else if (!rewards.length) {
  say("_none — no referral has ever produced a reward_");
} else {
  say("| status | rows |");
  say("|---|---|");
  for (const row of rewards) say(`| ${row.status ?? "(null)"} | ${row.n} |`);
}
say();

say("## Referral codes minted");
say();
const codes = countSafe("SELECT COUNT(*) AS n FROM referral_codes");
say(codes[0]?._missing ? `_could not read: ${codes[0]._missing}_` : `${codes[0]?.n ?? 0} code(s)`);
say();

/*
  Members carrying a referrer, and members who have spent their one discount.
  Counts only — the columns themselves identify people.
*/
say("## Members bound to a referrer");
say();
const bound = countSafe(
  "SELECT COUNT(*) AS n FROM users WHERE referred_by_user_id IS NOT NULL AND referred_by_user_id != ''",
);
const spent = countSafe(
  "SELECT COUNT(*) AS n FROM users WHERE referral_discount_used_at IS NOT NULL AND referral_discount_used_at != ''",
);
say(
  bound[0]?._missing
    ? `_could not read: ${bound[0]._missing}_`
    : `${bound[0]?.n ?? 0} member(s) have a referrer recorded`,
);
say(
  spent[0]?._missing
    ? `_could not read: ${spent[0]._missing}_`
    : `${spent[0]?.n ?? 0} member(s) have spent their referral discount`,
);
say();

writeFileSync("referral-settings.md", lines.join("\n") + "\n");
