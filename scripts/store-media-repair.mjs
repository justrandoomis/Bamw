#!/usr/bin/env node
/**
 * Takes the pasted photographs out of the shop document.
 *
 * Production holds two bundles whose `image` field is the picture itself,
 * base64: `store:bundles` is 10,889,492 bytes and 10,885,716 of them — a
 * hundred percent — are those two strings. Every read of the store parses them,
 * which is why the runtime ended `/api/admin/store` with `exceededCpu` and
 * answered **503**, why the every-minute cron does the same, and why the
 * catalogue import running against that Worker was cut off at batch three.
 *
 * `offloadInlineMedia` stops any *new* save doing this. It cannot undo the two
 * already stored — and the admin page cannot be used to re-save them, because
 * the admin page is the thing answering 503.
 *
 * ## What it does, and what it refuses to do
 *
 * Dry run by default: it reports what it found and writes nothing. `--apply`
 * uploads each picture to R2, **reads it back to prove it is there**, and only
 * then rewrites the section with the URL. An upload that cannot be verified
 * stops the run with the document untouched — replacing a photograph with a
 * link to nothing would be worse than the fault it is fixing.
 *
 * The write goes through the application's own `updateStore`, so it takes the
 * revision guard, the chunking and the projection sync with it rather than
 * reimplementing any of them. That same write folds the granular
 * `store:product:<id>` overlay rows into the document, and `--apply` then
 * clears the ones it has just persisted.
 *
 * Usage: node scripts/store-media-repair.mjs [--apply]
 */

import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createR2 } from "./lib/r2-store.mjs";
import { SERVING_BUCKET } from "./lib/r2-buckets.mjs";

const APPLY = process.argv.includes("--apply");
/* One place names the bucket — see `lib/r2-buckets.mjs` and the 849 it hid. */
const PUBLIC_HOST = process.env.PUBLIC_ASSET_HOST || "https://assets.banan.to";
const WORK_DIR = ".store-media-repair";

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
  writeFileSync("store-media-repair.md", lines.join("\n") + "\n");
  process.exit(code);
};

/*
  The database id is committed in `wrangler.jsonc` — it is the binding this
  Worker deploys against — and the `CLOUDFLARE_D1_DATABASE_ID` secret is empty
  in this repository.
*/
if (!process.env.D1_DATABASE_ID) {
  const found = /"database_id"\s*:\s*"([^"]+)"/.exec(readFileSync("wrangler.jsonc", "utf8"));
  if (found) process.env.D1_DATABASE_ID = found[1];
}

mkdirSync(WORK_DIR, { recursive: true });

const outfile = path.resolve(".store-media-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/store-media-entry.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "silent",
  alias: { "@": path.resolve("src") },
  external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
  /*
    `updateStore` reaches TanStack Start's server core, whose three virtual
    specifiers only the app's own build can resolve. Stubbing them is safe here
    because nothing on this path runs a request handler — the server core is
    reached by the import graph and never by a call.
  */
  plugins: [
    {
      name: "stub-start-virtuals",
      setup(pluginBuild) {
        const virtual =
          /^(#tanstack-router-entry|#tanstack-start-entry|tanstack-start-manifest:)/;
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

say(`# Inline media in the store document — ${APPLY ? "APPLY" : "DRY RUN"}`);
say();
say(`Run at ${new Date().toISOString()}.`);
say();

const reachable = await app.d1All("SELECT count(*) AS n FROM store_kv").catch(() => []);
if (!reachable.length) {
  say(`D1 is unreachable from this runner — nothing was read and nothing was written.`);
  finish(1);
}

const store = await app.getStore();
const SECTIONS = [
  { name: "bundles", folder: "Images/Pages/", prefix: "bundles" },
  { name: "banners", folder: "Images/Banners/", prefix: "banners" },
  { name: "content", folder: "Images/Pages/", prefix: "content" },
];

/* ---- what is in there ---- */
const work = [];
for (const section of SECTIONS) {
  const value = store[section.name];
  if (value === undefined) continue;
  const found = app.findInlineMedia(value, app.INLINE_MEDIA_LIMIT);
  for (const media of found) work.push({ ...media, section });
}

say(`## Found`);
say();
if (work.length === 0) {
  say(`Nothing over ${app.INLINE_MEDIA_LIMIT.toLocaleString("en-US")} bytes. The document is clean.`);
  finish(0);
}
say(`| section · field | media type | bytes |`);
say(`| --- | --- | --- |`);
for (const media of work) {
  say(
    `| \`${media.section.name}.${media.path}\` | ${media.mime} | ${media.bytes.toLocaleString("en-US")} |`,
  );
}
say();
say(
  `Total: **${work
    .reduce((sum, media) => sum + media.bytes, 0)
    .toLocaleString("en-US")}** bytes carried by every read of the store.`,
);
say();

if (!APPLY) {
  say(`Dry run — nothing uploaded, nothing written. Re-run with \`--apply\`.`);
  finish(0);
}

/* ---- move each one, and prove it landed ---- */
const r2 = createR2(SERVING_BUCKET, { tmpDir: WORK_DIR, log: (t) => say(`  ${redact(t)}`) });
say(`## Uploading (R2 mode: ${r2.mode})`);
say();

const urls = new Map();
for (const media of work) {
  const ext = app.ALLOWED_PUBLIC_MIMES[media.mime];
  if (!ext) {
    say(`- \`${media.section.name}.${media.path}\`: **${media.mime} is not a supported type** — stopping.`);
    say();
    say(`Nothing was written. Convert it to JPG, PNG or WebP and re-run.`);
    finish(1);
  }
  const decoded = app.decodeDataUrl(media.dataUrl);
  if (!decoded) {
    say(`- \`${media.section.name}.${media.path}\`: **unreadable base64** — stopping.`);
    finish(1);
  }
  if (!app.validatePublicAssetMagic(decoded.bytes, decoded.mime)) {
    // The declared type and the file's first bytes disagree; R2 would serve it
    // as something it is not.
    say(`- \`${media.section.name}.${media.path}\`: **the bytes are not ${media.mime}** — stopping.`);
    finish(1);
  }

  const name = await app.contentName(decoded.bytes, ext, media.section.prefix);
  const key = `${media.section.folder}${name}`;
  const stored = await r2.put(key, Buffer.from(decoded.bytes), media.mime);
  if (!stored) {
    say(`- \`${key}\`: **upload could not be verified** — stopping, document untouched.`);
    finish(1);
  }
  urls.set(media.dataUrl, `${PUBLIC_HOST}/${key}`);
  say(`- \`${key}\` — ${decoded.bytes.length.toLocaleString("en-US")} bytes, read back OK`);
}
say();

/* ---- rewrite the sections through the store's own write path ---- */
const before = new Date().toISOString();
await app.updateStore((current) => {
  const next = { ...current };
  for (const section of SECTIONS) {
    if (next[section.name] === undefined) continue;
    next[section.name] = app.replaceInlineMedia(next[section.name], urls);
  }
  return next;
});
say(`## Written`);
say();
say(`The store document was rewritten through \`updateStore\`.`);

/*
  The same write folded every `store:product:<id>` overlay into the document,
  so the rows it persisted are now redundant — and they are read and re-parsed
  on every cold start until something clears them. Narrowed by `updated_at`:
  an admin saving a product while this ran wrote a newer row, and that edit is
  not in the document just persisted.
*/
const stale = await app.d1All(
  `SELECT key FROM store_kv WHERE key LIKE 'store:product:%' AND updated_at <= ?`,
  before,
);
let removed = 0;
for (let at = 0; at < stale.length; at += 90) {
  const keys = stale.slice(at, at + 90).map((row) => row.key);
  await app.d1Run(
    `DELETE FROM store_kv WHERE key IN (${keys.map(() => "?").join(",")}) AND updated_at <= ?`,
    ...keys,
    before,
  );
  removed += keys.length;
}
say(`Granular overlay rows folded in and cleared: **${removed}**.`);
say();

/* ---- say what it is now, measured rather than assumed ---- */
const after = await app.d1All(
  `SELECT count(*) AS n, SUM(LENGTH(value)) AS bytes FROM store_kv
     WHERE (key = 'store' OR key LIKE 'store:%' OR key LIKE 'analytics:%')
       AND key NOT LIKE 'store:product:%'
       AND key <> 'store:products'
       AND key NOT LIKE 'store:products#%'`,
);
say(`## After`);
say();
say(`\`/api/admin/store\` now reads **${after[0]?.n}** rows, **${Number(after[0]?.bytes ?? 0).toLocaleString("en-US")}** bytes.`);
say();
finish(0);
