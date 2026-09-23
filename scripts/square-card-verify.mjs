#!/usr/bin/env node
/**
 * Every stored square-card URL, asked whether it is actually there.
 *
 * ## THE FAULT THIS EXISTS FOR
 *
 * The owner, reporting two things that turned out to be one:
 *
 *   «في الإعداد في الألعاب التي ينقصها صورة مربعة بالرغم من رفع الأدمن الصورة
 *    المربعة من القسم إلا أنه يظهر في الشاشة الرئيسية بدون صورة مربعة»
 *   «كما أن في منصة الكارتلج ... طلبنا أن تكون الألعاب يظهر في البداية التي
 *    لديها صورة مربعة لكن يظهر بأنه لا توجد صورة يظهر في البداية»
 *
 * `hasNintendoSquareCard` asks one question: IS A URL STORED. It cannot ask
 * whether the file is there. So a product whose row holds a URL that answers
 * 404 is, to every screen in the shop, a product WITH a picture:
 *
 *   - it leaves the admin's «ألعاب بلا صورة مربعة» queue, so nobody is told to
 *     fix it;
 *   - it sorts to the FRONT of the cartridge shelf, ahead of the games that
 *     really do have one;
 *   - and then the image 404s and the card prints «لم يتم إضافة الصورة بعد».
 *
 * Both of his reports are that one sentence. Clearing the dead URL fixes both
 * at once: the game re-enters the queue, sorts to the back where an image-less
 * card belongs, and stops claiming a picture it has not got.
 *
 * ## WHAT IT WILL AND WILL NOT CLEAR
 *
 * Only a URL proved ABSENT, and proved twice. A 404 or a 410, from a HEAD and
 * then again from a real GET. Anything else — a 403, a 5xx, a timeout, a DNS
 * failure, a body that is not an image — is `unknown` and is NEVER cleared:
 * that is our fault, not the game's, and clearing on it would delete a picture
 * that exists because a network hiccuped.
 *
 * And a blanket refusal. If more than `--max-dead-share` of everything probed
 * comes back not-alive, the run writes nothing at all and fails. A runner that
 * Cloudflare has decided to 403 sees every URL fail identically, and a script
 * that trusted itself there would erase the shop's entire picture library in
 * one pass. This has a real precedent: this same edge answers these runners 403
 * on `/api/data?slim=1` while answering 200 on `/`.
 *
 * ## WHAT IT WRITES
 *
 * The square-card fields, set to "", and nothing else. Every other key of every
 * touched product is compared byte for byte before the write and again after
 * it, and one difference fails the run. Price, cost, stock, hidden, options,
 * types, trade-in values and display order are the owner's data.
 *
 * Writes go through `store-overlay.mjs`, because a product owning a
 * `store:product:<id>` row is served from THAT row and an `updateStore` write
 * is invisible to it — see that file for the day this was learned.
 *
 * Usage:
 *   node scripts/square-card-verify.mjs                  # dry run
 *   node scripts/square-card-verify.mjs --apply          # clear the dead links
 *   node scripts/square-card-verify.mjs --only prd_x     # one product
 *   node scripts/square-card-verify.mjs --limit 50       # first N products
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID
 */
import { build } from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { fetchImage } from "./lib/image-probe.mjs";
import {
  absoluteUrl,
  DEFAULT_MAX_DEAD_SHARE,
  isBlanketFailure,
  verdictFor,
} from "./lib/square-link-verdict.mjs";
import {
  bumpAfterOverlayWrites,
  overlayProductIds,
  readOverlayProduct,
  writeOverlayProduct,
} from "./lib/store-overlay.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);
const APPLY = args.apply === "true";
const ONLY = args.only && args.only !== "true" ? String(args.only) : null;
const LIMIT = args.limit && args.limit !== "true" ? Number(args.limit) : Infinity;
const ORIGIN = (args.origin && args.origin !== "true" ? String(args.origin) : "https://banan.to")
  .replace(/\/+$/, "");
/*
  How many probes may fail before the whole run is refused.

  A tenth. The audit that found this fault saw six dead URLs among hundreds, so
  a real breakage is a fraction of a percent; anything approaching a tenth is
  not the catalogue being broken, it is the checker being blocked.
*/
const MAX_DEAD_SHARE = Number(
  args["max-dead-share"] && args["max-dead-share"] !== "true"
    ? args["max-dead-share"]
    : DEFAULT_MAX_DEAD_SHARE,
);
/** An absolute cap, for the case where the share is met but the count is absurd. */
const MAX_CLEAR = Number(args["max-clear"] && args["max-clear"] !== "true" ? args["max-clear"] : 60);
/** How many probes are in flight at once. */
const CONCURRENCY = 8;

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};
const flush = () => {
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
  }
};
const fail = (message) => {
  say();
  say(`**توقف: ${message}**`);
  flush();
  process.exit(1);
};

/**
 * Is this URL there?
 *
 * Three verdicts, and the difference between the last two is the whole point:
 *
 *   - `alive`   — it answered, and the bytes are an image.
 *   - `dead`    — it answered 404 or 410, twice, from two different methods.
 *   - `unknown` — anything else. A 403, a 5xx, a timeout, a body that is not an
 *                 image. Never cleared.
 *
 * The confirming GET is only paid for the handful that look dead, and it is not
 * optional: a HEAD is the cheap question and a destructive answer deserves the
 * expensive one.
 */
const probe = async (url) => {
  const target = absoluteUrl(url, ORIGIN);
  if (!target) return { verdict: "unknown", detail: "not addressable", url };

  let head;
  try {
    const res = await fetch(target, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    head = res.status;
  } catch (error) {
    return { verdict: "unknown", detail: String(error?.message ?? error).slice(0, 80), url };
  }

  /* The confirming GET is paid only for the handful that look gone. */
  const needsProof = head === 404 || head === 410;
  const got = needsProof ? await fetchImage(target, { timeoutMs: 20_000 }) : null;
  const verdict = verdictFor(head, got);
  const detail = got ? `HEAD ${head}, GET ${got.ok ? got.status : got.kind}` : `HEAD ${head}`;
  return { verdict, detail, url };
};

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

const outfile = path.resolve(".square-card-verify-bundle.mjs");
let app;
try {
  await build({
    entryPoints: ["scripts/lib/square-card-verify-entry.ts"],
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

say(`# روابط الصور المربعة — ${APPLY ? "**تطبيق**" : "تشغيل جاف"}`);
say();

const store = await app.getStore();
const products = Array.isArray(store?.products) ? store.products : [];
if (!products.length) {
  rmSync(outfile, { force: true });
  fail("الكتالوج فارغ — لن أحكم على شيء");
}

/*
  What each game claims. Every one of the five names is read, not just the
  canonical one: an older imported row can carry the URL under any of them, and
  a checker that only looked at the first would call a dead link on
  `squareGameImage` "no link at all".
*/
const claims = [];
for (const product of products) {
  if (!app.isGameProduct(product)) continue;
  const id = String(product?.id ?? "");
  if (!id) continue;
  if (ONLY && id !== ONLY) continue;
  const fields = [];
  for (const field of app.SQUARE_CARD_FIELDS) {
    const value = String(product?.[field] ?? "").trim();
    if (value) fields.push({ field, value });
  }
  if (!fields.length) continue;
  claims.push({
    id,
    title: String(product?.title ?? product?.titleEn ?? id),
    fields,
    /* What the shop would actually render, so the report names the served URL. */
    served: String(app.getNintendoMedia(product, "square-card")?.url ?? ""),
  });
  if (claims.length >= LIMIT) break;
}

say(`- ألعاب تدّعي صورة مربعة: **${claims.length.toLocaleString("en-US")}**`);

const urls = [...new Set(claims.flatMap((c) => c.fields.map((f) => f.value)))];
say(`- روابط مختلفة للفحص: **${urls.length.toLocaleString("en-US")}**`);
say();

const results = await inBatches(urls, probe);
const byUrl = new Map(urls.map((url, i) => [url, results[i]]));

const alive = results.filter((r) => r.verdict === "alive").length;
const dead = results.filter((r) => r.verdict === "dead").length;
const unknown = results.filter((r) => r.verdict === "unknown").length;

say("| الحالة | روابط |");
say("|---|---:|");
say(`| موجودة | ${alive.toLocaleString("en-US")} |`);
say(`| مفقودة (404/410 مرتين) | ${dead.toLocaleString("en-US")} |`);
say(`| غير محسومة — لن تُمسّ | ${unknown.toLocaleString("en-US")} |`);
say();

/*
  THE BLANKET REFUSAL.

  Measured against everything probed, not against the dead alone: a blocked
  runner produces `unknown`, not `dead`, and a guard that only watched the dead
  count would sail straight past the one failure it exists to catch.
*/
const share = urls.length ? (dead + unknown) / urls.length : 0;
if (isBlanketFailure({ alive, dead, unknown }, MAX_DEAD_SHARE)) {
  say(
    `**${(share * 100).toFixed(1)}% من الروابط لم تُجب إجابة سليمة، والحد ${(MAX_DEAD_SHARE * 100).toFixed(0)}%.** ` +
      `هذا شكل جهاز محجوب، لا شكل كتالوج معطوب. لم يُكتب شيء.`,
  );
  const sample = results.filter((r) => r.verdict !== "alive").slice(0, 10);
  say();
  for (const row of sample) say(`- \`${row.url}\` — ${row.detail}`);
  rmSync(outfile, { force: true });
  flush();
  process.exit(1);
}

/** Which products hold at least one proved-dead link, and in which fields. */
const broken = [];
for (const claim of claims) {
  const deadFields = claim.fields.filter((f) => byUrl.get(f.value)?.verdict === "dead");
  if (deadFields.length) broken.push({ ...claim, deadFields });
}

say(`## الألعاب التي تدّعي صورة غير موجودة — ${broken.length}`);
say();
if (broken.length) {
  say("| اللعبة | الحقل | الرابط | الإجابة |");
  say("|---|---|---|---|");
  for (const row of broken) {
    for (const field of row.deadFields) {
      say(
        `| ${row.title} | \`${field.field}\` | \`${field.value}\` | ${byUrl.get(field.value)?.detail} |`,
      );
    }
  }
  say();
}

const payload = {
  apply: APPLY,
  origin: ORIGIN,
  probed: urls.length,
  alive,
  dead,
  unknown,
  broken: broken.map((row) => ({
    id: row.id,
    title: row.title,
    fields: row.deadFields.map((f) => ({ field: f.field, url: f.value })),
  })),
};
if (args.json && args.json !== "true") writeFileSync(args.json, JSON.stringify(payload, null, 2));

if (!APPLY) {
  say("**تشغيل جاف. لم يُكتب شيء.**");
  rmSync(outfile, { force: true });
  flush();
  process.exit(0);
}

if (!broken.length) {
  say("**لا شيء ليُمسح.**");
  rmSync(outfile, { force: true });
  flush();
  process.exit(0);
}

if (broken.length > MAX_CLEAR) {
  rmSync(outfile, { force: true });
  fail(`${broken.length} لعبة تتجاوز الحد ${MAX_CLEAR} — لن أمسح هذا العدد دون مراجعة`);
}

/* ------------------------------------------------------------- the rehearsal */
const byId = new Map(products.map((p) => [String(p?.id ?? ""), p]));
const wanted = new Map(broken.map((row) => [row.id, row.deadFields.map((f) => f.field)]));
const overlayIds = await overlayProductIds(app);

/*
  The raw granular rows, read BEFORE the rehearsal — the rehearsal has to run
  against the document that will actually be written, or it rehearses a
  document that never existed.
*/
const rawOverlay = new Map();
for (const id of wanted.keys()) {
  if (!overlayIds.has(id)) continue;
  const stored = await readOverlayProduct(app, id);
  if (!stored) fail(`${id}: صف \`store:product:\` غير قابل للقراءة — لن أكتب فوقه`);
  rawOverlay.set(id, stored);
}

/**
 * The cleared copy of one document.
 *
 * Emptied rather than deleted, so the key set does not change: a rehearsal that
 * compares key by key can then say plainly that the ONLY difference is the
 * value of a square-card field, and the read-back can prove the new value
 * rather than prove an absence.
 */
const patchOne = (doc, id) => {
  const patched = { ...doc };
  for (const field of wanted.get(id) ?? []) patched[field] = "";
  return patched;
};

for (const id of wanted.keys()) {
  const before = rawOverlay.get(id) ?? byId.get(id);
  if (!before) fail(`${id} ليس في الكتالوج`);
  const patched = patchOne(before, id);
  const allowed = new Set(wanted.get(id) ?? []);
  for (const key of new Set([...Object.keys(before), ...Object.keys(patched)])) {
    if (allowed.has(key)) continue;
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(patched[key] ?? null)) {
      fail(`البروفة: ${id}.${key} تغيّر، وهذا السكربت لا يملك تغييره`);
    }
  }
  for (const field of allowed) {
    if (patched[field] !== "") fail(`البروفة: ${id}.${field} لم يُفرَّغ`);
  }
}

/* ------------------------------------------------------------------ the write */
const overlayWrites = [...wanted.keys()].filter((id) => overlayIds.has(id));
const chunkWrites = [...wanted.keys()].filter((id) => !overlayIds.has(id));
say(`- عبر صفوف \`store:product:<id>\`: **${overlayWrites.length}**`);
say(`- عبر كتل الكتالوج: **${chunkWrites.length}**`);
say();

for (const id of overlayWrites) {
  await writeOverlayProduct(app, id, patchOne(rawOverlay.get(id), id));
}
/* The bare INSERT moves no revision, so the edge would go on serving the old row. */
await bumpAfterOverlayWrites(app, overlayWrites.length);

let written = overlayWrites.length;
if (chunkWrites.length) {
  const chunkSet = new Set(chunkWrites);
  await app.updateStore((current) => {
    /*
      Reset, because `updateStore` re-reads and re-applies on a revision
      conflict. A counter that only incremented would report several times the
      products it changed.
    */
    written = overlayWrites.length;
    const list = Array.isArray(current?.products) ? current.products : [];
    const next = list.map((item) => {
      const id = String(item?.id ?? "");
      if (!chunkSet.has(id)) return item;
      written += 1;
      return patchOne(item, id);
    });
    return { ...current, products: next };
  });
}

/*
  Read back FROM D1, not from this process's memory. `updateStore` seeds
  `storeCache` with the document it just wrote and `getStore()` serves that
  cache for a minute — so a read-back without this line confirms only that the
  script remembers what it meant to do.
*/
app.invalidateStoreCache();
const afterStore = await app.getStore();
const afterList = Array.isArray(afterStore?.products) ? afterStore.products : [];
const afterById = new Map(afterList.map((p) => [String(p?.id ?? ""), p]));

const faults = [];
let verified = 0;
let queued = 0;
for (const [id, fields] of wanted) {
  const was = byId.get(id);
  const now = afterById.get(id);
  if (!now) {
    faults.push(`${id} اختفى من الكتالوج بعد الكتابة`);
    continue;
  }
  for (const field of fields) {
    if (String(now[field] ?? "") !== "") {
      faults.push(`${id}.${field} ما زال «${now[field]}»`);
    }
  }
  for (const key of new Set([...Object.keys(was ?? {}), ...Object.keys(now)])) {
    if (fields.includes(key)) continue;
    if (JSON.stringify(was?.[key] ?? null) !== JSON.stringify(now[key] ?? null)) {
      faults.push(`${id}.${key} تغيّر، وهذا السكربت لا يملك تغييره`);
    }
  }
  /*
    THE POINT OF THE WHOLE RUN, asked of the same predicate the shop asks: the
    game must now be BACK in «ألعاب بلا صورة مربعة», and back at the end of the
    shelf. A cleared field that still reads as "has a picture" would have fixed
    nothing.
  */
  if (app.hasNintendoSquareCard(now)) {
    faults.push(`${id} ما زال يُحسب أن لديه صورة مربعة بعد المسح`);
  } else {
    queued += 1;
  }
  verified += 1;
}

rmSync(outfile, { force: true });

say(`- منتجات كُتبت: **${written}**`);
say(`- تحقّق منها من قاعدة البيانات: **${verified}**`);
say(`- عادت إلى قائمة «ألعاب بلا صورة مربعة»: **${queued}**`);
say();

if (faults.length) {
  say("## أخطاء");
  say();
  for (const fault of faults) say(`- ${fault}`);
  flush();
  process.exit(1);
}

say("**تم. كل رابط ميت مُسح، ولم يتغيّر أي حقل آخر.**");
flush();
