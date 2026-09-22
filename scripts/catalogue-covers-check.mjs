#!/usr/bin/env node
/**
 * Does every cover URL in the sheet actually resolve to an image?
 *
 * The owner asked for this before importing, and the reason is worth stating:
 * a listing whose `coverImage` points at a 404 looks *worse* than one with no
 * picture at all. A bare listing renders a placeholder the shop designed; a
 * broken URL renders the browser's torn-image icon on a product page somebody
 * is being asked to pay for.
 *
 * READ ONLY. It fetches the URLs in the file and writes a report. It touches
 * neither the database nor the catalogue.
 *
 * ## What counts as working
 *
 * A `200` **and** an image content type. Both, because Nintendo's CDN answers
 * some missing assets with a 200 and an HTML error page, and a check that only
 * read the status would call those fine and let them through to the shop.
 *
 * `HEAD` first because 607 images is a lot of bytes to download to learn a
 * status; a CDN that refuses HEAD (405, or a status with no content type) is
 * retried with a ranged GET asking for the first byte only.
 *
 * Usage:
 *   node scripts/catalogue-covers-check.mjs --file import-sources/catalogue.csv
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 && process.argv[at + 1] && !process.argv[at + 1].startsWith("--")
    ? process.argv[at + 1]
    : fallback;
};

const FILE = arg("file", "import-sources/catalogue.csv");
const CONCURRENCY = Math.max(1, Math.min(Number(arg("concurrency", "12")), 32));
const TIMEOUT = Math.max(2000, Number(arg("timeout", "20000")));
const OUT = process.env.COVERS_OUT || "catalogue-covers.md";

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};
const finish = (code) => {
  writeFileSync(OUT, lines.join("\n") + "\n");
  process.exit(code);
};

say(`# Cover links — READ ONLY`);
say();
say(`Run at ${new Date().toISOString()}.`);
say();

if (!existsSync(FILE)) {
  say(`**No file at \`${FILE}\`.**`);
  finish(1);
}

/* ------------------------------------------------------------------ */
/* Reading the sheet                                                   */
/* ------------------------------------------------------------------ */

/*
  A hand-rolled reader rather than the app's `parseCatalogueCsv`.

  That one refuses a row whose price is missing or below cost, which is exactly
  right for an import and exactly wrong here: a row this check drops is a cover
  nobody verified, and the owner asked about *all* the links. This reads the
  two columns it needs and judges nothing.
*/
function readCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const push = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    push();
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") push();
    else if (ch === "\r") continue;
    else if (ch === "\n") endRow();
    else field += ch;
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

const table = readCsv(readFileSync(FILE, "utf8").replace(/^\uFEFF/, ""));
if (table.length < 2) {
  say(`**The file has no rows.**`);
  finish(1);
}
const header = table[0].map((h) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.]+/g, ""),
);
const at = (...names) => header.findIndex((h) => names.includes(h));
const iName = at("englishname", "name", "title");
const iCover = at("coverurl", "cover", "coverimage", "imageurl", "image");

if (iCover < 0) {
  say(`**No cover column in the file.** Headers: ${table[0].join(", ")}`);
  finish(1);
}

const targets = [];
const seen = new Map();
for (let r = 1; r < table.length; r++) {
  const url = String(table[r][iCover] ?? "").trim();
  const name = String(table[r][iName] ?? "").trim();
  if (!url) continue;
  if (!seen.has(url)) seen.set(url, []);
  seen.get(url).push({ line: r + 1, name });
}
for (const [url, rows] of seen) targets.push({ url, rows });

say(`## The file`);
say();
say(`- \`${FILE}\``);
say(`- rows: **${(table.length - 1).toLocaleString("en-US")}**`);
say(`- rows carrying a cover: **${[...seen.values()].reduce((n, r) => n + r.length, 0)}**`);
say(`- distinct URLs to check: **${targets.length.toLocaleString("en-US")}**`);
say();

/* ------------------------------------------------------------------ */
/* Checking                                                            */
/* ------------------------------------------------------------------ */

async function once(url, method, extra = {}) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      signal: control.signal,
      headers: { "user-agent": "bananto-cover-check/1.0", ...extra },
    });
    return {
      status: res.status,
      type: (res.headers.get("content-type") || "").split(";")[0].trim(),
      length: Number(res.headers.get("content-length") ?? 0),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function check(url) {
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, why: "not an https URL" };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let r = await once(url, "HEAD");
      /*
        A CDN that will not answer HEAD, or answers it without saying what the
        body is, gets one ranged GET — one byte, not the whole picture.
      */
      if (r.status === 405 || r.status === 501 || (r.status < 400 && !r.type)) {
        r = await once(url, "GET", { range: "bytes=0-0" });
      }
      if (r.status >= 400) return { ok: false, why: `HTTP ${r.status}`, ...r };
      if (!r.type.startsWith("image/")) {
        /* A 200 that is not an image is the failure this check exists for. */
        return { ok: false, why: `HTTP ${r.status} but ${r.type || "no content type"}`, ...r };
      }
      return { ok: true, ...r };
    } catch (err) {
      if (attempt === 1) {
        return {
          ok: false,
          why: String(err?.name === "AbortError" ? "timed out" : err).slice(0, 80),
        };
      }
    }
  }
  return { ok: false, why: "unreachable" };
}

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    const mine = targets[cursor++];
    results.push({ ...mine, ...(await check(mine.url)) });
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

const broken = results.filter((r) => !r.ok);
const working = results.filter((r) => r.ok);

/*
  "Every single link is broken" is almost never true, and is almost always this
  machine having no route to the host.

  Twice tonight a tool reported its own failed request as a finding about the
  shop — a 403 challenge became "no ETag offered", a missing field became a
  count of zero. This is the same trap with higher stakes, because acting on it
  means stripping the artwork off six hundred products. A total failure with no
  HTTP status anywhere in it is a network verdict, not a catalogue verdict, and
  it says so and stops.
*/
const reasons = new Set(broken.map((r) => r.why));
if (results.length > 1 && working.length === 0 && reasons.size === 1) {
  say(`## Inconclusive — everything failed the same way`);
  say();
  say(`All ${results.length} requests failed, every one of them with \`${[...reasons][0]}\`.`);
  say();
  say(
    `Six hundred links do not break simultaneously and identically. One verdict ` +
      `repeated across every distinct URL is a verdict about the network between ` +
      `here and the host — a proxy refusing the host answers 403 just as readily ` +
      `as a CDN does — not about the catalogue.`,
  );
  say();
  say(`Run this where outbound HTTPS is open; the \`Catalogue covers\` workflow does.`);
  say(`**No conclusion about the links has been drawn, and nothing should be stripped.**`);
  finish(1);
}

say(`## Result`);
say();
say(`| | URLs | rows |`);
say(`| --- | --- | --- |`);
say(`| working | **${working.length}** | ${working.reduce((n, r) => n + r.rows.length, 0)} |`);
say(`| broken | **${broken.length}** | ${broken.reduce((n, r) => n + r.rows.length, 0)} |`);
say();

if (broken.length) {
  say(`### Broken`);
  say();
  say(`| line | game | why | url |`);
  say(`| --- | --- | --- | --- |`);
  for (const r of broken) {
    for (const row of r.rows.slice(0, 3)) {
      say(
        `| ${row.line} | ${row.name.replace(/\|/g, "\\|").slice(0, 60)} | ${r.why} | \`${r.url.slice(0, 110)}\` |`,
      );
    }
  }
  say();
  say(
    `> These are the rows to strip the cover from before importing, or to fix. ` +
      `A listing pointing at a broken URL is worse than one with no picture: the ` +
      `shop has a placeholder for the second and not for the first.`,
  );
  say();
}

/*
  Two games sharing one picture is not a broken link, and it is not nothing: it
  usually means the title was matched to the wrong eShop page, and the shop
  would show the wrong box art on a product somebody is buying.
*/
const shared = results.filter((r) => r.ok && r.rows.length > 1);
if (shared.length) {
  say(`### The same picture on more than one game`);
  say();
  say(`| games | url |`);
  say(`| --- | --- |`);
  for (const r of shared.slice(0, 40)) {
    say(
      `| ${r.rows
        .map((x) => x.name.slice(0, 34))
        .join(" · ")
        .replace(/\|/g, "\\|")} | \`${r.url.slice(0, 80)}\` |`,
    );
  }
  if (shared.length > 40) say(`| … | ${shared.length - 40} more |`);
  say();
  say(`> Worth a look before importing: usually a row matched to the wrong page.`);
  say();
}

say(
  broken.length
    ? `**${broken.length} of ${results.length} links do not work.**`
    : `**All ${results.length} links work.**`,
);
/*
  A broken link is a finding, not a failure of this job: it has done exactly
  what it was asked to. Exiting non-zero would paint the run red and bury the
  report behind a failure nobody needs to investigate.
*/
finish(0);
