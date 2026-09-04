#!/usr/bin/env node
/**
 * Read production's own logs, for the lines that say why a send failed.
 *
 * `wrangler tail` only shows what happens while somebody is watching, and the
 * failure being investigated happened hours ago. Workers Logs is enabled on
 * this script (`observability.enabled` in wrangler.jsonc), so the lines are
 * retained and can be asked for after the fact — which is the only way to
 * answer "why did that notification not arrive" about a top-up that already
 * happened.
 *
 * READ ONLY. One POST to the observability query endpoint, which reads.
 *
 * ## What it will and will not print
 *
 * Worker logs contain whatever the application logged, and some of that is
 * customer data. This never prints a log line as it found it. A line is
 * printed only if it begins with one of a fixed list of diagnostic prefixes,
 * and even then every run of five or more digits is replaced — a chat id, a
 * phone number, an order code and a user id are all digit runs, and none of
 * them belongs in a CI log.
 *
 * Usage:
 *   node scripts/worker-logs-query.mjs [--hours 12] [--needle telegram]
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
 */

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const SCRIPT_NAME = process.env.WORKER_NAME || "pixel-cart-cloud";
if (!ACCOUNT || !TOKEN) throw new Error("missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const HOURS = Number(arg("hours", "12"));
const NEEDLE = arg("needle", "telegram");
/*
  Exception mode.

  The prefix allowlist below exists because a Worker's logs are full of
  customer data, and a diagnostic that prints them is a leak. An *unhandled*
  exception is a different kind of record: its name, its message and its stack
  are facts about our code, and a page that answers 500 with an empty body
  cannot be diagnosed from anything else. So this mode prints only the
  exception fields — never a log line — and still masks digit runs, because a
  message can quote an id it was handed.
*/
const EXCEPTIONS_ONLY = process.argv.includes("--exceptions");

const SECRETS = [TOKEN, ACCOUNT].filter((v) => v && v.length >= 8);
const redactSecrets = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const say = (t = "") => console.log(redactSecrets(t));

/*
  The prefixes worth reading out loud. Anything else the Worker logged is
  somebody's data until proven otherwise, and this job has no reason to see it.
*/
const ALLOWED = [
  "[telegram:error]",
  "[telegram:admin_notification_failed]",
  "[telegram:admin_notification_blocked]",
  "[telegram:admin_notification_threw]",
  "[telegram:notify]",
  "[outbox:",
  "[queue:",
  "[order:admin_telegram_notify_failed]",
  "[order:telegram_notify_failed]",
  "[worker:queue",
  "[worker:scheduled_error]",
];

/** Digits are addresses here — chat ids, phones, order codes, user ids. */
const scrub = (line) => redactSecrets(String(line)).replace(/\d{5,}/g, "«n»");

const to = Date.now();
const from = to - HOURS * 3600 * 1000;

const body = {
  view: "events",
  queryId: "telegram-delivery",
  limit: 100,
  dry: false,
  parameters: {
    datasets: ["cloudflare-workers"],
    filters: [
      { key: "$metadata.service", operation: "eq", type: "string", value: SCRIPT_NAME },
    ],
    ...(EXCEPTIONS_ONLY ? {} : { needle: { value: NEEDLE, isRegex: false, matchCase: false } }),
  },
  timeframe: { from, to },
};

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/observability/telemetry/query`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  },
);

const text = await res.text();
let payload = null;
try {
  payload = JSON.parse(text);
} catch {
  say(`HTTP ${res.status}, and the body was not JSON:`);
  say(scrub(text.slice(0, 500)));
  process.exit(1);
}

if (!res.ok || payload?.success === false) {
  say(`HTTP ${res.status} — the query was refused.`);
  for (const e of payload?.errors ?? []) say(`  ${scrub(e?.message ?? JSON.stringify(e))}`);
  say();
  say("Most likely the API token lacks 'Workers Observability: Read'.");
  process.exit(1);
}

const events = payload?.result?.events?.events ?? payload?.result?.events ?? [];
say(
  EXCEPTIONS_ONLY
    ? `# Worker exceptions — last ${HOURS}h — READ ONLY`
    : `# Worker logs — last ${HOURS}h, matching '${NEEDLE}' — READ ONLY`,
);
say();
say(`${events.length} event(s) returned.`);
say();

let shown = 0;
for (const event of events) {
  const stamp = new Date(Number(event?.timestamp ?? event?.$metadata?.timestamp ?? 0)).toISOString();
  /*
    A console.log with several arguments arrives as an array; the message is
    the first, and the rest are the structured detail that actually names the
    Telegram error code.
  */
  const raw = event?.$workers?.event?.rayId
    ? event?.source ?? event
    : (event?.source ?? event);
  const message = raw?.message ?? raw?.$workers?.message ?? "";
  const flat =
    typeof message === "string"
      ? message
      : Array.isArray(message)
        ? message.map((m) => (typeof m === "string" ? m : JSON.stringify(m))).join(" ")
        : JSON.stringify(message ?? raw);

  if (EXCEPTIONS_ONLY) {
    const outcome = raw?.$workers?.outcome ?? raw?.outcome ?? "";
    const exception =
      raw?.$workers?.event?.error ??
      raw?.$workers?.exception ??
      raw?.exception ??
      (outcome && outcome !== "ok" ? { name: outcome, message: "" } : null);
    if (!exception) continue;
    const name = exception?.name ?? exception?.type ?? "exception";
    const detail = exception?.message ?? exception?.reason ?? "";
    const stack = exception?.stack ?? "";
    const path = raw?.$workers?.event?.request?.url ?? raw?.url ?? "";
    say(`${stamp.slice(0, 19)}Z  ${scrub(name)}: ${scrub(detail).slice(0, 300)}`);
    if (path) say(`                     ↳ ${scrub(String(path)).slice(0, 200)}`);
    if (stack) say(`                     ↳ ${scrub(String(stack)).replace(/\n/g, " | ").slice(0, 600)}`);
    shown += 1;
    continue;
  }

  if (!ALLOWED.some((prefix) => flat.includes(prefix))) continue;
  say(`${stamp.slice(0, 19)}Z  ${scrub(flat).slice(0, 400)}`);

  /*
    `console.error("...", { error_code, description })` logs two arguments,
    and the second is the one that says what Telegram actually refused. It
    arrives beside the message rather than inside it, so printing the message
    alone gives "sendMessage failed" and no reason — which is the same dead
    end this whole script exists to get past.
  */
  const detail = raw?.$workers?.event?.additionalMessages ?? raw?.additionalMessages ?? [];
  for (const extra of Array.isArray(detail) ? detail : [detail]) {
    if (extra === undefined || extra === null) continue;
    const rendered = typeof extra === "string" ? extra : JSON.stringify(extra);
    say(`                     ↳ ${scrub(rendered).slice(0, 400)}`);
  }
  shown += 1;
}

if (shown === 0) {
  say("Nothing matched the diagnostic prefixes.");
  say();
  say("The shape of one raw event, with digits removed, so the filter can be corrected:");
  say(scrub(JSON.stringify(events[0] ?? {}, null, 2)).slice(0, 1500));
} else if (process.argv.includes("--raw")) {
  /*
    Only ever for events that already passed the prefix filter, so this cannot
    become a way to print a customer's message by asking for it.
  */
  say();
  say("── raw, for the events above, digits removed ──");
  for (const event of events) {
    const raw = event?.source ?? event;
    const message = raw?.message ?? "";
    const flat = typeof message === "string" ? message : JSON.stringify(message);
    if (!ALLOWED.some((prefix) => flat.includes(prefix))) continue;
    say(scrub(JSON.stringify(event, null, 2)).slice(0, 2000));
    say();
  }
}
