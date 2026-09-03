#!/usr/bin/env node
/**
 * Read-only production diagnosis for the referral programme.
 *
 * The customer is shown one sentence when a referral is refused — "تعذر تطبيق
 * كود الإحالة على هذه العملية." — on purpose: naming the check that caught
 * someone tells them which one to change. The reason is written to
 * `referral_risk_events` instead. This script reads that table so the actual
 * recorded reason can be looked at rather than guessed.
 *
 * Read-only by construction. Every statement passes an allowlist that accepts
 * a single SELECT and rejects anything carrying a mutating keyword or a second
 * statement, so a typo here cannot become a migration.
 *
 * Nothing identifying reaches stdout. Device, address, session and contact
 * hashes are never selected; user ids are compared in memory and reported as
 * counts and yes/no, never printed. That holds the programme's own rule — no
 * customer data in GitHub, logs or artifacts — for its diagnostics too.
 *
 *   node scripts/referral-diagnose.mjs [--days 30]
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";

const DB_NAME = "bananto";
const CONFIG = "wrangler.jsonc";

/* ------------------------------------------------------------------ safety */

const READ_SHAPE = /^\s*select\b/i;
const MUTATING =
  /(^|[^_\w])(insert|update|delete|replace|upsert|alter|drop|create|attach|detach|vacuum|reindex|begin|commit|rollback|truncate)([^_\w]|$)/i;

function assertReadOnly(sql) {
  const s = String(sql).trim();
  if (!READ_SHAPE.test(s)) throw new Error(`REFUSED (not a SELECT): ${s.slice(0, 60)}`);
  if (MUTATING.test(s)) throw new Error(`REFUSED (mutating keyword): ${s.slice(0, 60)}`);
  if (s.replace(/;\s*$/, "").includes(";")) throw new Error("REFUSED (multiple statements)");
  return s;
}

const SECRETS = [
  process.env.CLOUDFLARE_API_TOKEN,
  process.env.CLOUDFLARE_ACCOUNT_ID,
  process.env.CLOUDFLARE_D1_DATABASE_ID,
].filter((v) => v && v.length >= 8);

function redact(text) {
  let out = String(text ?? "");
  for (const secret of SECRETS) out = out.split(secret).join("«redacted»");
  out = out.replace(/\b[0-9a-f]{32}\b/gi, "«redacted-id»");
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "«redacted-id»");
  return out;
}

const lines = [];
function say(text = "") {
  const safe = redact(text);
  lines.push(safe);
  console.log(safe);
}

/* ----------------------------------------------------------------- wrangler */

const WRANGLER =
  process.env.WRANGLER_BIN ||
  (existsSync("node_modules/.bin/wrangler") ? "node_modules/.bin/wrangler" : "wrangler");

const WRANGLER_ENV = {
  ...process.env,
  // Wrangler's first-run telemetry prompt blocks on stdin; with stdin closed
  // that is an indefinite hang rather than an error.
  WRANGLER_SEND_METRICS: "false",
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? "",
  CI: "true",
};

const COMMAND_TIMEOUT_MS = 120_000;

function wrangler(args, { allowFail = false } = {}) {
  try {
    return execFileSync(WRANGLER, [...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: COMMAND_TIMEOUT_MS,
      killSignal: "SIGKILL",
      env: WRANGLER_ENV,
    });
  } catch (err) {
    if (allowFail) return null;
    const detail = redact(err?.stderr || err?.stdout || err?.message || String(err));
    throw new Error(detail.slice(0, 1200));
  }
}

/** Wrangler prints warnings before the JSON body; take from the first bracket. */
function parseJson(raw) {
  if (raw == null) return null;
  const start = raw.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(raw.slice(start));
  } catch {
    return null;
  }
}

let queryCount = 0;

function d1(sql, { allowFail = false } = {}) {
  const statement = assertReadOnly(sql);
  queryCount++;
  process.stderr.write(`[q${queryCount}] ${statement.slice(0, 70).replace(/\s+/g, " ")}\n`);
  const raw = wrangler(
    ["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", statement],
    { allowFail },
  );
  const parsed = parseJson(raw);
  if (!parsed) {
    if (allowFail) return null;
    throw new Error(`unparseable D1 response for: ${statement.slice(0, 80)}`);
  }
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first?.results ?? [];
}

/* ------------------------------------------------------------------ helpers */

const n = (value) => (value == null ? 0 : Number(value));

function table(rows, columns) {
  if (!rows.length) return ["_(no rows)_"];
  const out = [`| ${columns.join(" | ")} |`, `| ${columns.map(() => "---").join(" | ")} |`];
  for (const row of rows) out.push(`| ${columns.map((c) => String(row[c] ?? "")).join(" | ")} |`);
  return out;
}

const days = (() => {
  const i = process.argv.indexOf("--days");
  const raw = i > -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(raw) && raw > 0 && raw <= 365 ? Math.floor(raw) : 30;
})();
const since = new Date(Date.now() - days * 86_400_000).toISOString();

/* --------------------------------------------------------------------- main */

say("# Referral programme — read-only diagnosis");
say();
say(`Run at ${new Date().toISOString()}, covering the last **${days} days**. **No statement in this run mutates anything.**`);
say();

/* 1 — do the tables exist at all ------------------------------------------- */

say("## 1. Schema");
say();
const REFERRAL_TABLES = [
  "referral_codes",
  "referral_attributions",
  "referral_rewards",
  "referral_risk_events",
  "referral_identity_links",
  "referral_blocklist",
];
const tables = d1(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
).map((r) => String(r.name));
const missing = REFERRAL_TABLES.filter((t) => !tables.includes(t));
say(`- Referral tables present: **${REFERRAL_TABLES.length - missing.length} of ${REFERRAL_TABLES.length}**`);
if (missing.length) {
  say(`- **MISSING: ${missing.join(", ")}** — \`ensureSchema()\` has not created them, so every referral write fails and every read throws. This alone refuses every code.`);
} else {
  say("- All six tables exist.");
}
const counts = [];
for (const t of REFERRAL_TABLES) {
  if (!tables.includes(t)) {
    counts.push({ table: t, rows: "— absent —" });
    continue;
  }
  const r = d1(`SELECT COUNT(*) AS rows FROM ${t}`, { allowFail: true });
  counts.push({ table: t, rows: r ? n(r[0]?.rows) : "error" });
}
say();
for (const line of table(counts, ["table", "rows"])) say(line);
say();

/* 2 — the settings actually in force --------------------------------------- */

say("## 2. Settings in force");
say();
/*
  `readReferralSettings` merges the whole settings bag underneath the nested
  `referral` block, so an unrelated top-level key with a colliding name — most
  dangerously a bare `enabled` — is read as the programme's own switch. That
  collision is checked explicitly below, not assumed absent.
*/
const REFERRAL_KEYS = [
  "enabled", "buyerPercentBps", "referrerPercentBps", "buyerPercent", "referrerPercent",
  "maxRewardIqd", "maxReward", "linkTtlDays", "attributionDays", "eligibleCategories",
  "firstPurchaseOnly", "stackWithCoupon", "holdDays", "dailyInviteLimit",
  "dailyRewardCapIqd", "monthlyRewardCapIqd", "blockSameIp",
];
const FLAT_KEYS = [
  "referralEnabled", "referralBuyerPercentBps", "referralOwnerPercentBps", "referralBuyerPercent",
  "referralOwnerPercent", "ownerPercent", "referralMaxReward", "referralLinkTtlDays",
  "referralEligibleCategories", "referralFirstPurchaseOnly", "referralStackWithCoupon",
  "referralHoldDays", "referralDailyInviteLimit", "referralDailyRewardCap",
  "referralMonthlyRewardCap", "referralBlockSameIp",
];

const baseRow = d1("SELECT value FROM store_kv WHERE key = 'store'", { allowFail: true });
let storeSettings = null;
try {
  const doc = JSON.parse(baseRow?.[0]?.value ?? "{}");
  storeSettings = doc && typeof doc.settings === "object" && doc.settings ? doc.settings : {};
} catch (err) {
  say(`- Base store document unparseable: ${err.message}`);
}
if (storeSettings) {
  const nested = storeSettings["referral"];
  const hasNested = nested && typeof nested === "object" && !Array.isArray(nested);
  say(`- Nested \`settings.referral\` block present: **${hasNested ? "yes" : "no — defaults apply"}**`);
  if (hasNested) {
    const rows = REFERRAL_KEYS.filter((k) => nested[k] !== undefined).map((k) => ({
      key: k,
      value: JSON.stringify(nested[k]).slice(0, 60),
    }));
    for (const line of table(rows, ["key", "value"])) say(line);
  }
  const flat = FLAT_KEYS.filter((k) => storeSettings[k] !== undefined).map((k) => ({
    key: k,
    value: JSON.stringify(storeSettings[k]).slice(0, 60),
  }));
  say();
  say(`- Legacy flat \`referral*\` keys set: **${flat.length}**`);
  for (const line of table(flat, ["key", "value"])) say(line);

  /*
    The collision check. A top-level `enabled: false` meant for something else
    entirely would silently switch the whole programme off.
  */
  const collisions = REFERRAL_KEYS.filter(
    (k) => storeSettings[k] !== undefined && !(hasNested && nested[k] !== undefined),
  ).map((k) => ({ key: k, value: JSON.stringify(storeSettings[k]).slice(0, 60) }));
  say();
  say(`- **Top-level settings keys the referral reader would adopt as its own: ${collisions.length}**`);
  for (const line of table(collisions, ["key", "value"])) say(line);
  if (collisions.some((c) => c.key === "enabled")) {
    say();
    say("  - ⚠️ A top-level `enabled` is being read as the referral master switch.");
  }
}
say();

/* 3 — why referrals were refused ------------------------------------------- */

say("## 3. Refusals — what `referral_risk_events` actually recorded");
say();
if (!tables.includes("referral_risk_events")) {
  say("_Table absent; no refusal history exists._");
} else {
  const byType = d1(
    `SELECT event_type, COUNT(*) AS events, MAX(created_at) AS latest
     FROM referral_risk_events WHERE created_at >= '${since}'
     GROUP BY event_type ORDER BY events DESC`,
  );
  for (const line of table(byType, ["event_type", "events", "latest"])) say(line);
  say();

  /*
    The reasons live inside the metadata JSON. SQLite's json_each would unroll
    them server-side, but D1 rejects it on some builds and a failed query here
    loses the whole report, so the array is tallied in memory instead.
  */
  const events = d1(
    `SELECT id, event_type, risk_score, metadata, created_at,
            referrer_user_id, buyer_user_id, order_id, attribution_id
     FROM referral_risk_events WHERE created_at >= '${since}'
     ORDER BY created_at DESC LIMIT 400`,
  );
  const reasonTally = new Map();
  const soloTally = new Map();
  for (const row of events) {
    let meta = {};
    try {
      meta = JSON.parse(String(row.metadata ?? "{}"));
    } catch {
      meta = {};
    }
    const reasons = Array.isArray(meta.reasons) ? meta.reasons.map(String) : [];
    for (const reason of reasons) reasonTally.set(reason, (reasonTally.get(reason) ?? 0) + 1);
    // A refusal carrying exactly one reason is one this signal caused alone —
    // the honest measure of a check's false-positive cost.
    if (reasons.length === 1) soloTally.set(reasons[0], (soloTally.get(reasons[0]) ?? 0) + 1);
    row._reasons = reasons;
    row._stage = String(meta.stage ?? "");
  }
  say("### Reasons recorded");
  say();
  const reasonRows = [...reasonTally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({
      reason,
      times_cited: count,
      sole_reason: soloTally.get(reason) ?? 0,
    }));
  for (const line of table(reasonRows, ["reason", "times_cited", "sole_reason"])) say(line);
  say();
  say("`sole_reason` is the count of refusals this signal caused **on its own** — with no other signal agreeing.");
  say();

  say("### The most recent refusals");
  say();
  const recent = events
    .filter((e) => /blocked|not_applicable/.test(String(e.event_type)))
    .slice(0, 25)
    .map((e) => ({
      when: String(e.created_at).replace("T", " ").slice(0, 19),
      event: e.event_type,
      stage: e._stage,
      score: n(e.risk_score),
      reasons: e._reasons.join(", ") || "—",
      // Ids are compared here and never printed.
      same_party:
        e.referrer_user_id && e.buyer_user_id
          ? e.referrer_user_id === e.buyer_user_id
            ? "yes"
            : "no"
          : "unknown (guest)",
    }));
  for (const line of table(recent, ["when", "event", "stage", "score", "reasons", "same_party"])) say(line);
  say();
  say(`- Refusal events in the window: **${events.filter((e) => /blocked|not_applicable/.test(String(e.event_type))).length}** of ${events.length} risk events read.`);
  say();
}

/* 4 — attributions and rewards --------------------------------------------- */

say("## 4. Attributions and rewards");
say();
if (tables.includes("referral_attributions")) {
  const attrs = d1(
    `SELECT status, COUNT(*) AS rows, MAX(captured_at) AS latest
     FROM referral_attributions GROUP BY status ORDER BY rows DESC`,
  );
  say("### `referral_attributions` by status");
  say();
  for (const line of table(attrs, ["status", "rows", "latest"])) say(line);
  say();
  const guestVsBound = d1(
    `SELECT SUM(CASE WHEN referred_user_id IS NULL THEN 1 ELSE 0 END) AS still_guest,
            SUM(CASE WHEN referred_user_id IS NOT NULL THEN 1 ELSE 0 END) AS bound_to_account,
            SUM(CASE WHEN converted_order_id IS NOT NULL THEN 1 ELSE 0 END) AS converted
     FROM referral_attributions`,
  )[0] ?? {};
  say(`- Captured but still a guest: **${n(guestVsBound.still_guest)}** — bound to an account: **${n(guestVsBound.bound_to_account)}** — converted to an order: **${n(guestVsBound.converted)}**`);
  say();
}
if (tables.includes("referral_rewards")) {
  const rewards = d1(
    `SELECT status, COUNT(*) AS rows,
            SUM(referrer_reward_iqd) AS referrer_iqd, SUM(buyer_discount_iqd) AS buyer_iqd
     FROM referral_rewards GROUP BY status ORDER BY rows DESC`,
  );
  say("### `referral_rewards` by status");
  say();
  for (const line of table(rewards, ["status", "rows", "referrer_iqd", "buyer_iqd"])) say(line);
  say();
}
if (tables.includes("referral_codes")) {
  const codes = d1(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active
     FROM referral_codes`,
  )[0] ?? {};
  say(`- Referral codes issued: **${n(codes.total)}** (active: ${n(codes.active)})`);
}
if (tables.includes("referral_identity_links")) {
  const links = d1(
    "SELECT kind, COUNT(*) AS rows, COUNT(DISTINCT user_id) AS accounts FROM referral_identity_links GROUP BY kind ORDER BY rows DESC",
  );
  say();
  say("### `referral_identity_links` (hashes never printed)");
  say();
  for (const line of table(links, ["kind", "rows", "accounts"])) say(line);
  /*
    The false-positive question for `same_ip`: one address hash standing for
    many accounts is carrier NAT, not fraud, and under `blockSameIp` every
    referral across it is refused.
  */
  const shared = d1(
    `SELECT kind, shared_by AS accounts_per_hash, COUNT(*) AS hashes FROM (
       SELECT kind, identity_hash, COUNT(DISTINCT user_id) AS shared_by
       FROM referral_identity_links GROUP BY kind, identity_hash
     ) WHERE shared_by > 1 GROUP BY kind, shared_by ORDER BY kind, shared_by DESC`,
    { allowFail: true },
  );
  say();
  say("### Identities shared by more than one account");
  say();
  for (const line of table(shared ?? [], ["kind", "accounts_per_hash", "hashes"])) say(line);
  say();
  say("An `ip` hash shared by several accounts is ordinary carrier NAT. Under `blockSameIp` every referral across such an address is refused.");
}
say();

say(`_Queries executed: ${queryCount}, all read-only. No hash, address, device or contact detail appears above._`);

const report = lines.join("\n") + "\n";
writeFileSync("referral-diagnosis.md", report);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
}
