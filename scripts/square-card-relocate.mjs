#!/usr/bin/env node
/**
 * Puts the shop's pictures in the bucket the shop reads from.
 *
 * ## THE FAULT, MEASURED RATHER THAN GUESSED
 *
 * `square-card-verify.mjs` asked both buckets about every square-card URL the
 * catalogue claims, and got back, five hundred and sixty-three times:
 *
 *     R2 bananto-private 404, bananto 200
 *
 * `media-pipeline.mjs` writes objects to `CLOUDFLARE_R2_BUCKET_NAME || "bananto"`
 * and stores the URL `/api/files/...`. `storage.server.ts` serves that URL by
 * reading `BANANTO_PRIVATE_BUCKET`, which `wrangler.jsonc` names
 * `bananto-private`. Different buckets. So the upload succeeds, the pipeline's
 * own read-back succeeds, the URL is stored — and the shopper gets a 404 for a
 * picture this shop owns.
 *
 * That is both of the owner's remaining reports in one sentence:
 *
 *   «بالرغم من رفع الأدمن الصورة المربعة من القسم إلا أنه يظهر في الشاشة
 *    الرئيسية بدون صورة مربعة»
 *   «طلبنا أن تكون الألعاب يظهر في البداية التي لديها صورة مربعة لكن يظهر
 *    بأنه لا توجد صورة يظهر في البداية»
 *
 * — because `hasNintendoSquareCard` asks whether a URL is STORED. A row whose
 * file is in the wrong bucket is, to every screen, a row with a picture: it
 * leaves the admin queue and sorts to the FRONT of the shelf, and then the
 * image 404s.
 *
 * ## WHAT THIS DOES, AND THE THREE THINGS IT CANNOT DO
 *
 * It copies an object that is in `bananto` and not in `bananto-private` into
 * `bananto-private`, under the same key. That is all.
 *
 *   - IT WRITES NO CATALOGUE FIELD. Not the price, not the cost, not an image
 *     URL, not the hidden flag. Its bundled entry point does not even export
 *     `updateStore`, so it could not if it tried. Every stored URL is already
 *     correct; the bytes were in the wrong place.
 *   - IT DELETES NOTHING, from either bucket. The copy is additive, so a run
 *     that goes wrong leaves the shop exactly as it found it, and whichever
 *     bucket anyone later decides is canonical still has the file.
 *   - AND IT INVENTS NOTHING. Only keys the catalogue actually references are
 *     considered, so a stale object in `bananto` that no product points at is
 *     not resurrected.
 *
 * Every copy is proved: the bytes are fetched, sniffed to confirm they really
 * are an image, put, and then READ BACK from the destination and compared by
 * length. A put that is not read back is not a copy.
 *
 * Dry run unless `--apply` is passed.
 *
 * Usage:
 *   node scripts/square-card-relocate.mjs                 # dry run
 *   node scripts/square-card-relocate.mjs --apply         # copy
 *   node scripts/square-card-relocate.mjs --limit 20      # the first N
 *   node scripts/square-card-relocate.mjs --square-only   # square cards only
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 */
import { build } from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { sniffImage } from "./lib/image-probe.mjs";
import { pacedFetch } from "./lib/cloudflare-pace.mjs";
import { commonPrefix, listPrefix } from "./lib/r2-listing.mjs";
import { SERVING_BUCKET, storageKeyFor, WRITING_BUCKET } from "./lib/square-link-verdict.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);
const APPLY = args.apply === "true";
const SQUARE_ONLY = args["square-only"] === "true";
const LIMIT = args.limit && args.limit !== "true" ? Number(args.limit) : Infinity;
const R2_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const R2_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CONCURRENCY = 6;

/** Fields that can hold a picture. Anything that is a string and looks like one. */
const SQUARE_FIELDS = new Set([
  "nintendoCardImage",
  "nintendo_card_image",
  "squareGameImage",
  "squareImage",
  "square_card_image",
]);

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};
const flush = () => {
  const text = lines.join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, text, { flag: "a" });
  }
  try {
    writeFileSync("square-card-relocate.md", text);
  } catch {
    /* The report is a convenience; failing to write it must not fail the run. */
  }
};
const fail = (message) => {
  say();
  say(`**توقف: ${message}**`);
  flush();
  process.exit(1);
};

const objectUrl = (bucket, key) =>
  `https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT}/r2/buckets/${bucket}/objects/` +
  key.split("/").map(encodeURIComponent).join("/");

/** Run `worker` over `items`, a few at a time, in order. */
const inBatches = async (items, worker) => {
  const out = new Array(items.length);
  let next = 0;
  const run = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await worker(items[i], i);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return out;
};

/**
 * Copy one object, and prove it arrived.
 *
 * The sniff is not ceremony. These bytes are about to become the copy of
 * record for a picture on the storefront, and an error page saved under a
 * `.webp` key would replace a 404 with something worse: a broken image the
 * checker now calls healthy.
 */
const copyOne = async (key) => {
  let bytes;
  try {
    const res = await pacedFetch(objectUrl(WRITING_BUCKET, key), {
      headers: { authorization: `Bearer ${R2_TOKEN}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { key, ok: false, why: `قراءة ${WRITING_BUCKET}: ${res.status}` };
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (error) {
    return {
      key,
      ok: false,
      why: `قراءة ${WRITING_BUCKET}: ${String(error?.message ?? error).slice(0, 60)}`,
    };
  }
  if (!bytes.length) return { key, ok: false, why: "المصدر فارغ" };
  const kind = sniffImage(bytes);
  if (!kind) return { key, ok: false, why: "المصدر ليس صورة" };

  try {
    const res = await pacedFetch(objectUrl(SERVING_BUCKET, key), {
      method: "PUT",
      headers: { authorization: `Bearer ${R2_TOKEN}`, "content-type": kind },
      body: bytes,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { key, ok: false, why: `كتابة ${SERVING_BUCKET}: ${res.status}` };
  } catch (error) {
    return {
      key,
      ok: false,
      why: `كتابة ${SERVING_BUCKET}: ${String(error?.message ?? error).slice(0, 60)}`,
    };
  }

  /* Read back from the DESTINATION. A put nobody re-read is not a copy. */
  try {
    const res = await pacedFetch(objectUrl(SERVING_BUCKET, key), {
      headers: { authorization: `Bearer ${R2_TOKEN}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { key, ok: false, why: `قراءة بعد الكتابة: ${res.status}` };
    const back = Buffer.from(await res.arrayBuffer());
    if (back.length !== bytes.length) {
      return { key, ok: false, why: `الحجم بعد الكتابة ${back.length} بدل ${bytes.length}` };
    }
  } catch (error) {
    return {
      key,
      ok: false,
      why: `قراءة بعد الكتابة: ${String(error?.message ?? error).slice(0, 60)}`,
    };
  }
  return { key, ok: true, bytes: bytes.length, kind };
};

const outfile = path.resolve(".relocate-bundle.mjs");

if (!process.env["D1_DATABASE_ID"] && !process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  try {
    const config = readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    const found = config.match(/"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/);
    if (found) process.env["D1_DATABASE_ID"] = found[1];
  } catch {
    /* Reported below as an unreachable database. */
  }
}
if (!process.env["D1_DATABASE_ID"] && process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  process.env["D1_DATABASE_ID"] = process.env["CLOUDFLARE_D1_DATABASE_ID"];
}

let app;
try {
  await build({
    entryPoints: ["scripts/lib/bucket-relocate-entry.ts"],
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
  app = await import(outfile);
} catch (error) {
  rmSync(outfile, { force: true });
  fail(`تعذّر بناء الأدوات: ${String(error).split("\n")[0]}`);
}

say(`# نقل صور المنتجات إلى \`${SERVING_BUCKET}\` — ${APPLY ? "**تطبيق**" : "تشغيل جاف"}`);
say();
if (!R2_ACCOUNT || !R2_TOKEN) {
  rmSync(outfile, { force: true });
  fail("لا يوجد حساب أو مفتاح Cloudflare — لن أحكم على شيء");
}

const store = await app.getStore();
const products = Array.isArray(store?.products) ? store.products : [];
if (!products.length) {
  rmSync(outfile, { force: true });
  fail("الكتالوج فارغ — لن أنقل شيئًا");
}

/*
  Every `/api/files/...` key the catalogue points at.

  All image roles by default, not just the square card. The owner reported the
  square one because that is the one a card shouts about, but the bucket is
  wrong for whatever `media-pipeline.mjs` stored — the front box and the detail
  cover went to the same place by the same line of code. `--square-only`
  narrows it to his exact report when a smaller first run is wanted.
*/
const wantedKeys = new Map();
for (const product of products) {
  const id = String(product?.id ?? "");
  for (const [field, value] of Object.entries(product ?? {})) {
    if (typeof value !== "string") continue;
    if (SQUARE_ONLY && !SQUARE_FIELDS.has(field)) continue;
    const key = storageKeyFor(value);
    if (!key) continue;
    if (!wantedKeys.has(key)) wantedKeys.set(key, { key, id, field });
  }
}
say(`- ملفات يشير إليها الكتالوج: **${wantedKeys.size.toLocaleString("en-US")}**`);

/*
  ONE listing per bucket, over the folder the keys share.

  THIS SCRIPT ALREADY MADE THE MISTAKE ONCE, on its first real run, and its
  numbers are how it was caught: 894 present, 428 to copy — and 656 «مجلد
  تعذّرت قراءته». Six hundred and fifty-six files it could not decide about,
  because listing `files/products/<id>/` per product is about twelve hundred
  authenticated calls inside a minute and the API's rate limit refused them.
  The checker had been fixed for exactly this and the fix was never applied
  here; the commit that fixed it claimed both scripts had it.

  The folder count that used to be printed above is gone with it. It measured
  the instrument, not the shop.
*/
const root = commonPrefix([...wantedKeys.keys()]);
const r2 = { account: R2_ACCOUNT, token: R2_TOKEN };
const serving = await listPrefix(SERVING_BUCKET, root, r2);
const writing = await listPrefix(WRITING_BUCKET, root, r2);
say(
  `- \`${root}\` في \`${SERVING_BUCKET}\`: **${serving ? `${serving.size} ملف` : "لم تُقرأ"}**، ` +
    `وفي \`${WRITING_BUCKET}\`: **${writing ? `${writing.size} ملف` : "لم تُقرأ"}**`,
);
say();

/*
  Either listing failing stops the whole run rather than skipping rows. A copy
  decided from half a listing would be a copy decided from a guess, and the
  count printed afterwards would not add up to the catalogue.
*/
if (!serving || !writing) {
  rmSync(outfile, { force: true });
  fail("تعذّرت قراءة إحدى الحاويتين — لن أنقل شيئًا بناءً على قائمة ناقصة");
}

let present = 0;
let absentEverywhere = 0;
const toCopy = [];
for (const row of wantedKeys.values()) {
  if (serving.has(row.key)) {
    present += 1;
    continue;
  }
  if (writing.has(row.key)) toCopy.push(row);
  else absentEverywhere += 1;
}

say("| الحالة | ملفات |");
say("|---|---:|");
say(`| موجودة في \`${SERVING_BUCKET}\` | ${present.toLocaleString("en-US")} |`);
say(`| في \`${WRITING_BUCKET}\` فقط — تُنقل | ${toCopy.length.toLocaleString("en-US")} |`);
say(`| ليست في أي حاوية | ${absentEverywhere.toLocaleString("en-US")} |`);
say();

const chosen = toCopy.slice(0, Number.isFinite(LIMIT) ? LIMIT : toCopy.length);
const payload = {
  apply: APPLY,
  referenced: wantedKeys.size,
  present,
  toCopy: toCopy.length,
  absentEverywhere,
  keys: chosen.map((row) => row.key),
};
if (args.json && args.json !== "true") writeFileSync(args.json, JSON.stringify(payload, null, 2));

if (!chosen.length) {
  rmSync(outfile, { force: true });
  say("**لا شيء يُنقل.**");
  flush();
  process.exit(0);
}

say(`## أول 20 مما سيُنقل`);
say();
for (const row of chosen.slice(0, 20)) say(`- \`${row.key}\` — ${row.id} · \`${row.field}\``);
say();

if (!APPLY) {
  rmSync(outfile, { force: true });
  say(`**تشغيل جاف. لم يُنقل شيء.** ${chosen.length} ملفًا جاهزة للنقل.`);
  flush();
  process.exit(0);
}

const results = await inBatches(chosen, (row) => copyOne(row.key));
const copied = results.filter((r) => r?.ok);
const refused = results.filter((r) => r && !r.ok);

rmSync(outfile, { force: true });

say(`- نُقلت وتم التحقق منها بقراءة من \`${SERVING_BUCKET}\`: **${copied.length}**`);
say(`- تعذّر نقلها: **${refused.length}**`);
say();
if (refused.length) {
  say("## ما لم يُنقل");
  say();
  for (const row of refused.slice(0, 40)) say(`- \`${row.key}\` — ${row.why}`);
  say();
}

if (refused.length) {
  say("**انتهى بأخطاء. لم يُحذف أي ملف من أي حاوية، ولم يتغيّر أي حقل في الكتالوج.**");
  flush();
  process.exit(1);
}
say("**تم. كل ملف نُسخ وقُرئ من الحاوية التي يقرأ منها الموقع.**");
flush();
