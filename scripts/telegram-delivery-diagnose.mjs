#!/usr/bin/env node
/**
 * Why a Telegram notification did not arrive.
 *
 * The bindings are right — all four topics, one chat, proved by
 * `telegram-binding-status.mjs`. So the failure is somewhere after routing,
 * and there are only a few places it can be. This asks production about each
 * of them in turn, instead of reasoning about the source:
 *
 *   1. Is the release carrying the group routing actually live?
 *   2. Does the queue exist, and does anything consume it?
 *   3. Has the consumer ever processed a notification message?
 *   4. Has anything happened since the bindings were made that *should* have
 *      produced a notification? "No order since 03:04" and "orders that
 *      produced nothing" are different diagnoses and look identical from
 *      the outside.
 *   5. Can a per-user message reach anybody — i.e. does `telegram_links`
 *      hold rows, and do the users who placed those orders have one?
 *
 * READ ONLY. Every statement is a SELECT or a GET. It writes nothing, to D1
 * or to Cloudflare, and it never sends a Telegram message.
 *
 * It prints no chat id, no thread id, no phone, no name and no order code. A
 * six-character fingerprint distinguishes two chats without disclosing either,
 * because this output goes to a CI log.
 *
 * Usage:
 *   node scripts/telegram-delivery-diagnose.mjs
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import path from "node:path";

process.env.D1_DATABASE_ID ||= process.env.CLOUDFLARE_D1_DATABASE_ID || "";
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) throw new Error(`missing ${key}`);
}

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const SCRIPT_NAME = process.env.WORKER_NAME || "pixel-cart-cloud";
const QUEUE_NAME = process.env.QUEUE_NAME || "banana-notifications";

const SECRETS = [TOKEN, ACCOUNT, process.env.D1_DATABASE_ID].filter((v) => v && v.length >= 8);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const say = (t = "") => console.log(redact(t));
const fingerprint = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 6);

const api = async (p) => {
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4${p}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    });
    const text = await res.text();
    try {
      const body = JSON.parse(text);
      return { ok: res.ok && body?.success !== false, status: res.status, body };
    } catch {
      return { ok: false, status: res.status, error: text.slice(0, 200) };
    }
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.message ?? error) };
  }
};

const outfile = path.resolve(".telegram-delivery-diagnose-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/import-entry.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  logLevel: "silent",
  alias: { "@": path.resolve("src") },
  external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
});
const app = await import(outfile);

/** A SELECT whose failure is an answer rather than a crash. */
const ask = async (sql, ...args) => {
  try {
    return { rows: await app.d1All(sql, ...args) };
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
};

const problems = [];
const note = (line) => problems.push(line);

say("# Telegram delivery — READ ONLY");
say();
say(`Run at ${new Date().toISOString()}.`);
say();

/* ------------------------------------------------------------ 1. bindings */
say("## 1. Where notifications are addressed");
const bindings = await ask(
  "SELECT kind, chat_id, message_thread_id, bound_at FROM telegram_topic_bindings",
);
if (bindings.error) {
  say(`  telegram_topic_bindings unreadable: ${redact(bindings.error)}`);
  note("The bindings table could not be read, so routing cannot be trusted.");
} else {
  const chats = new Set(bindings.rows.map((r) => String(r.chat_id)));
  for (const row of bindings.rows) {
    const thread = Number(row.message_thread_id);
    say(
      `  ${String(row.kind).padEnd(8)} chat ${fingerprint(row.chat_id)} · ` +
        (Number.isSafeInteger(thread) && thread > 0 ? `thread set` : `NO THREAD`) +
        ` · ${String(row.bound_at).slice(0, 19)}Z`,
    );
  }
  say(`  ${bindings.rows.length} of 4 bound, across ${chats.size} chat(s).`);
  if (bindings.rows.length !== 4 || chats.size !== 1) {
    note("Bindings are not a finished setup: four kinds, one chat, is the requirement.");
  }
}
say();

/* -------------------------------------------------------------- 2. what is live */
say("## 2. Is the release carrying this code live?");
const versions = await api(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT_NAME}/versions?per_page=3`);
if (!versions.ok) {
  say(`  could not read versions (HTTP ${versions.status}) — token may lack Workers:Read.`);
} else {
  for (const v of versions.body?.result?.items ?? versions.body?.result ?? []) {
    const meta = v?.metadata ?? {};
    const annotations = v?.annotations ?? {};
    say(
      `  ${String(v?.number ?? "?").padStart(4)} · ${String(meta.created_on ?? "").slice(0, 19)}Z` +
        ` · ${annotations["workers/triggered_by"] ?? "?"}` +
        (annotations["workers/tag"] ? ` · ${annotations["workers/tag"]}` : ""),
    );
  }
}
say();

/* -------------------------------------------- 2b. which version is serving */
/*
  A version uploaded and a version serving traffic are different things, and
  Workers Builds reports both as success. "Is the fix live?" is answered by the
  deployment that actually carries traffic, not by the newest upload.
*/
const deployments = await api(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT_NAME}/deployments`);
if (!deployments.ok) {
  say(`  could not read deployments (HTTP ${deployments.status}).`);
} else {
  const items = deployments.body?.result?.deployments ?? [];
  const current = items[0];
  if (!current) {
    say("  no deployment recorded.");
  } else {
    const carrying = (current.versions ?? [])
      .map((v) => `${String(v.version_id ?? "").slice(0, 8)} @${v.percentage ?? 100}%`)
      .join(", ");
    say(`  serving now: ${carrying || "—"} · ${current.created_on ?? "?"} · source ${current.source ?? "?"}`);
  }
}
say();

/* ------------------------------------------------------------------ 3. queue */
say("## 3. The notification queue");
const queues = await api(`/accounts/${ACCOUNT}/queues`);
if (!queues.ok) {
  say(`  could not list queues (HTTP ${queues.status}) — token may lack Queues:Read.`);
  say("  Skipped, not failed: the D1 evidence below answers the same question.");
} else {
  const found = (queues.body?.result ?? []).find((q) => q?.queue_name === QUEUE_NAME);
  if (!found) {
    say(`  '${QUEUE_NAME}' does not exist in this account.`);
    note(
      `The queue '${QUEUE_NAME}' does not exist, so every enqueue fails and ` +
        "notifications fall back to the inline send.",
    );
  } else {
    const consumers = found.consumers ?? [];
    say(`  '${QUEUE_NAME}' exists · producers ${found.producers?.length ?? 0} · consumers ${consumers.length}`);
    for (const c of consumers) {
      say(`    consumer: ${c?.script ?? c?.service ?? "?"} (${c?.type ?? "worker"})`);
    }
    if (consumers.length === 0) {
      note(
        `'${QUEUE_NAME}' has no consumer. Messages are accepted and never delivered, ` +
          "which is exactly 'the notification vanished'.",
      );
    }
    const backlog = found.queue_backlog_bytes ?? found.backlog_bytes;
    if (backlog !== undefined) say(`    backlog: ${backlog} bytes`);
  }
}
say();

/* ------------------------------------------- 4. has the consumer ever run? */
say("## 4. What the consumer has actually processed");
const processed = await ask(
  `SELECT message_type, COUNT(*) AS n, MAX(processed_at) AS last
     FROM processed_queue_messages
    GROUP BY message_type
    ORDER BY last DESC
    LIMIT 12`,
);
if (processed.error) {
  say(`  processed_queue_messages unreadable: ${redact(processed.error)}`);
  note("The dedupe ledger is missing, so the queue consumer has never completed a message.");
} else if (processed.rows.length === 0) {
  say("  empty — the consumer has never marked a message processed.");
  note(
    "processed_queue_messages is empty. Either nothing has ever been enqueued, " +
      "or the consumer is not attached to the queue.",
  );
} else {
  for (const row of processed.rows) {
    say(`  ${String(row.message_type).padEnd(34)} ${String(row.n).padStart(5)} · last ${String(row.last).slice(0, 19)}Z`);
  }
}
say();

/* --------------------------------------- 5. was there anything to notify about? */
say("## 5. Was there anything to notify about?");
const since = bindings.rows?.length
  ? bindings.rows.map((r) => String(r.bound_at)).sort()[0]
  : "1970-01-01T00:00:00Z";
say(`  Bindings were made at ${since.slice(0, 19)}Z. Counting what happened after that.`);

const orders = await ask(
  `SELECT COUNT(*) AS n, MAX(created_at) AS last FROM orders WHERE created_at > ?`,
  since,
);
if (orders.error) say(`  orders unreadable: ${redact(orders.error)}`);
else {
  const n = Number(orders.rows[0]?.n ?? 0);
  say(`  orders since binding: ${n}${n ? ` · last ${String(orders.rows[0]?.last).slice(0, 19)}Z` : ""}`);
  if (n === 0) {
    say("  Nothing has been ordered since the topics were bound.");
    note(
      "No order exists after the bindings were made, so no order notification " +
        "was ever due. 'It did not arrive' cannot be judged from orders alone yet.",
    );
  }
}

const allOrders = await ask(`SELECT COUNT(*) AS n, MAX(created_at) AS last FROM orders`);
if (!allOrders.error) {
  say(
    `  orders in total: ${allOrders.rows[0]?.n ?? 0} · last ${String(allOrders.rows[0]?.last ?? "never").slice(0, 19)}Z`,
  );
}
say();

/* --------------------------------------------- 6. can a user be reached at all? */
say("## 6. Can a per-user message reach anybody?");
const links = await ask(`SELECT COUNT(*) AS n FROM telegram_links`);
if (links.error) {
  say(`  telegram_links unreadable: ${redact(links.error)}`);
  note("telegram_links cannot be read, so no per-user Telegram message can be addressed.");
} else {
  const n = Number(links.rows[0]?.n ?? 0);
  say(`  linked accounts: ${n}`);
  if (n === 0) {
    note(
      "telegram_links is empty. No member has connected Telegram, so every " +
        "per-user notification has nowhere to go regardless of the code.",
    );
  }
}

const users = await ask(`SELECT COUNT(*) AS n FROM users`);
if (!users.error) say(`  registered users: ${users.rows[0]?.n ?? 0}`);

/*
  The lookup the app performs, run here against the buyers who actually
  ordered. A count of links means nothing if the people placing orders are
  not among them.
*/
const buyers = await ask(
  `SELECT COUNT(*) AS n
     FROM (SELECT DISTINCT user_id FROM orders ORDER BY rowid DESC LIMIT 20) o
     LEFT JOIN telegram_links l ON l.user_id = o.user_id
    WHERE l.user_id IS NOT NULL`,
);
if (!buyers.error) {
  say(`  of the 20 most recent distinct buyers, ${buyers.rows[0]?.n ?? 0} have a Telegram link.`);
  if (Number(buyers.rows[0]?.n ?? 0) === 0) {
    note(
      "None of the recent buyers has a Telegram link, so the buyer half of the " +
        "notification has no address to send to even once the code is fixed.",
    );
  }
}
say();

/* ------------------------------------- 6b. linked, but reachable? */
say("## 6b. Links that exist but cannot be used");
/*
  A member can finish the Telegram flow and still be unreachable, because
  `telegram_links.user_id` is not always a user id. Anonymous signups share the
  owner key `guest:<phone>` and are re-keyed later by `adoptGuestTelegramLink`;
  if that never runs, the row is real, the member sees themselves as linked, and
  `getUserTelegramChatId(user.id)` finds nothing.
*/
const guestKeyed = await ask(
  `SELECT COUNT(*) AS n FROM telegram_links WHERE user_id LIKE 'guest:%'`,
);
if (!guestKeyed.error) {
  const n = Number(guestKeyed.rows[0]?.n ?? 0);
  say(`  links still keyed to a guest phone rather than a user: ${n}`);
  if (n > 0) {
    note(
      `${n} Telegram link(s) are keyed \`guest:<phone>\` instead of a user id. Those members ` +
        "are linked as far as they can tell, and no per-user message can reach them.",
    );
  }
}

const orphaned = await ask(
  `SELECT COUNT(*) AS n
     FROM telegram_links l
     LEFT JOIN users u ON u.id = l.user_id
    WHERE u.id IS NULL AND l.user_id NOT LIKE 'guest:%'`,
);
if (!orphaned.error) {
  const n = Number(orphaned.rows[0]?.n ?? 0);
  say(`  links whose user_id matches no user at all: ${n}`);
  if (n > 0) note(`${n} Telegram link(s) point at a user id that does not exist.`);
}

const unverified = await ask(`SELECT COUNT(*) AS n FROM telegram_links WHERE verified != 1`);
if (!unverified.error) say(`  links marked unverified: ${unverified.rows[0]?.n ?? 0}`);

const noChat = await ask(
  `SELECT COUNT(*) AS n FROM telegram_links WHERE telegram_chat_id IS NULL OR telegram_chat_id = 0`,
);
if (!noChat.error) {
  const n = Number(noChat.rows[0]?.n ?? 0);
  say(`  links with no chat id: ${n}`);
  if (n > 0) note(`${n} Telegram link(s) carry no chat id, so there is no address to send to.`);
}

/*
  The half-finished flow: a verification session that got as far as knowing the
  member's chat id, and never became a link. From the member's side the bot
  answered them, so they believe they are connected.
*/
const stranded = await ask(
  `SELECT COUNT(*) AS n
     FROM telegram_verification_sessions s
     LEFT JOIN telegram_links l ON l.telegram_chat_id = s.telegram_chat_id
    WHERE s.telegram_chat_id IS NOT NULL AND l.telegram_chat_id IS NULL`,
);
if (!stranded.error) {
  const n = Number(stranded.rows[0]?.n ?? 0);
  say(`  verification sessions that knew a chat id but never became a link: ${n}`);
  if (n > 0) {
    note(
      `${n} member(s) got far enough for the bot to know their chat id and never got a link row — ` +
        "the flow stops before the contact share, and they have no reason to think it did.",
    );
  }
}
say();

/* ------------------------------------------------- 7. what production wrote down */
say("## 7. Refusals production recorded");
const failures = await ask(
  `SELECT kind, route, error_code, description, failed_at
     FROM telegram_send_failures
    ORDER BY id DESC
    LIMIT 10`,
);
if (failures.error) {
  /*
    Absent until the release carrying the table is live and something has
    failed since. That is not itself a problem — it only means this section
    cannot answer yet.
  */
  say("  no telegram_send_failures table yet — the release carrying it is not live,");
  say("  or nothing has failed since it shipped.");
} else if (failures.rows.length === 0) {
  say("  none recorded.");
} else {
  for (const row of failures.rows) {
    say(
      `  ${String(row.failed_at).slice(0, 19)}Z  ${String(row.kind).padEnd(8)}` +
        ` ${String(row.route ?? "?").padEnd(18)} ${row.error_code ?? ""} ${row.description ?? ""}`,
    );
  }
  note(`${failures.rows.length} refusal(s) recorded — the newest is the one to read.`);
}
say();

/* ------------------------------------------------------------------ verdict */
say("## Verdict");
if (problems.length === 0) {
  say("  Nothing in production contradicts the notification path.");
  say("  The remaining possibility is Telegram itself refusing the send, which");
  say("  only the Worker's own logs can show: run the worker-tail workflow and");
  say("  send /selftest in the group.");
} else {
  for (const line of problems) say(`  - ${line}`);
}

process.exit(0);
