#!/usr/bin/env node
/**
 * What the four `/bind_*` commands have actually recorded.
 *
 * Setup is four messages sent from inside the four topics, because a Telegram
 * update already carries `chat.id` and `message_thread_id` — the two numbers
 * Telegram shows nobody, arriving from the one place they cannot be typed
 * wrong. This reads back what those commands wrote, so "did it work" is
 * answered by the database rather than by asking again.
 *
 * READ ONLY. It runs one SELECT and writes nothing.
 *
 * It never prints a chat id or a thread id. They are not a customer's data,
 * but they are the address of the shop's private admin group and this output
 * goes to a CI log; "bound" and "all four in the same chat" is everything the
 * question needs. A short fingerprint distinguishes two different chats
 * without disclosing either.
 *
 * Usage:
 *   node scripts/telegram-binding-status.mjs
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import path from "node:path";

process.env.D1_DATABASE_ID ||= process.env.CLOUDFLARE_D1_DATABASE_ID || "";
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) throw new Error(`missing ${key}`);
}

const SECRETS = [process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID].filter(
  (v) => v && v.length >= 8,
);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const say = (t = "") => console.log(redact(t));

const outfile = path.resolve(".telegram-binding-status-bundle.mjs");
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

/* The tab is called Chat; the traffic it carries is support. */
const LABEL = {
  wallet: "Wallet   (/bind_wallet)",
  general: "General  (/bind_general)",
  support: "Chat     (/bind_chat)",
  order: "Order    (/bind_order)",
};

let rows = [];
try {
  rows = await app.d1All(
    `SELECT kind, chat_id, message_thread_id, bound_at FROM telegram_topic_bindings`,
  );
} catch (error) {
  /*
    The table is created by the schema bootstrap. Not finding it means the
    release carrying it has not reached production, which is a different
    answer from "nobody has run the commands yet" and worth saying so.
  */
  say(`could not read telegram_topic_bindings: ${redact(error?.message ?? error)}`);
  say("");
  say("If that is 'no such table', the release adding it is not live yet.");
  process.exit(1);
}

const byKind = new Map(rows.map((r) => [String(r.kind), r]));
const fingerprint = (chatId) => createHash("sha256").update(String(chatId)).digest("hex").slice(0, 6);

say("── topic bindings ──");
for (const kind of ["wallet", "general", "support", "order"]) {
  const row = byKind.get(kind);
  say(
    row
      ? `  ${LABEL[kind]}  bound · chat ${fingerprint(row.chat_id)} · ${String(row.bound_at).slice(0, 19)}Z`
      : `  ${LABEL[kind]}  NOT BOUND`,
  );
}
say();

const chats = new Set(rows.map((r) => String(r.chat_id)));
const complete = byKind.size === 4 && chats.size === 1;

if (complete) {
  say("All four topics are bound, and all four are in the same chat.");
  say("The binding commands are closed: they answer nobody from here on.");
} else if (byKind.size === 4) {
  /*
    Four topics across two chats would otherwise look finished and send half
    the notifications somewhere nobody reads.
  */
  say(`All four are bound, but across ${chats.size} different chats — that is not a finished setup.`);
  say("Send the four commands again, all inside the one admin group.");
} else {
  const missing = ["wallet", "general", "support", "order"].filter((k) => !byKind.has(k));
  say(`${byKind.size} of 4 bound. Still to send: ${missing.map((k) => LABEL[k].split(" ")[0]).join(", ")}`);
}

process.exit(complete ? 0 : 1);
