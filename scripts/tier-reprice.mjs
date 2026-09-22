#!/usr/bin/env node
/**
 * The owner's four pricing rules, applied to a game's four prices.
 *
 * `src/lib/tierRepricing.ts` holds the rules and is tested there against the
 * owner's own worked example. This script reads the catalogue, runs those
 * exact functions, reports the COST BREAKDOWN first — «قبل كل شيء أعطني
 * التكلفة للمنتجات» — and only when told to, writes the `price` field of the
 * tier rows they moved.
 *
 * Dry run unless `--apply`. Even then:
 *
 *   - `types[i].price` is the ONLY thing this script may write. Every other
 *     key of every touched product, and every other key of every touched
 *     tier — its cost above all — is compared after the write and a single
 *     difference fails the run.
 *   - Every proposal passes `tierProblem` before anything is written. A price
 *     below its cost, not a whole thousand, outside the online band, or an
 *     add-ons edition not dearer than the plain one, stops the WHOLE run.
 *   - Every old price is printed and carried in the JSON artifact, so the
 *     change can be undone exactly.
 *
 * Usage:
 *   node scripts/tier-reprice.mjs               # dry run: the cost report
 *   node scripts/tier-reprice.mjs --apply       # write
 *   node scripts/tier-reprice.mjs --only prd_x  # one product
 *   node scripts/tier-reprice.mjs --limit 5     # the first five that move
 */
import { build } from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

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

const SECRETS = [process.env.CLOUDFLARE_API_TOKEN, process.env.CLOUDFLARE_ACCOUNT_ID].filter(
  (v) => v && v.length >= 8,
);
const redact = (t) => SECRETS.reduce((s, x) => s.split(x).join("«redacted»"), String(t ?? ""));
const lines = [];
const say = (t = "") => {
  const safe = redact(t);
  lines.push(safe);
  console.log(safe);
};
const flush = () => {
  writeFileSync("tier-reprice.md", `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
  }
};
const fail = (message) => {
  say();
  say(`## توقف: ${message}`);
  say();
  say("**لم يُكتب شيء بعد هذه النقطة.**");
  flush();
  process.exit(1);
};

if (!process.env["D1_DATABASE_ID"] && !process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  try {
    const config = readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    const found = config.match(/"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/);
    if (found) process.env["D1_DATABASE_ID"] = found[1];
  } catch {
    /* Reported below. */
  }
}
if (!process.env["D1_DATABASE_ID"] && process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  process.env["D1_DATABASE_ID"] = process.env["CLOUDFLARE_D1_DATABASE_ID"];
}
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) fail(`مفقود ${key}`);
}

const outfile = path.resolve(".tier-reprice-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/catalogue-entry.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "silent",
  alias: { "@": path.resolve("src") },
  external: ["cloudflare:workers", "node:async_hooks", "node:crypto", "sharp"],
});
const app = await import(outfile);

const money = (n) => Number(n || 0).toLocaleString("en-US");

/* ------------------------------------------------------------ the catalogue */

const reachable = await app.d1All("SELECT count(*) AS n FROM store_kv");
if (!reachable.length) fail("قاعدة البيانات غير متاحة — لن أكتب تقريرًا عن لا شيء");

const store = await app.getStore();
const products = Array.isArray(store?.products) ? store.products : [];
if (products.length < 100) fail(`الكتالوج أعاد ${products.length} منتجًا فقط — هذا ليس الكتالوج`);

/*
  Which products live in a granular `store:product:<id>` row.

  `loadStore` merges the chunked catalogue with these rows and lets the
  granular one WIN. `updateStore` writes only the chunks — so a product with a
  granular row is frozen: the write lands, the read-back shows the old value,
  and nothing says why. Measured here rather than assumed, and the apply below
  writes whichever row actually wins for each product.
*/
const overlayRows = await app.d1All(
  "SELECT key FROM store_kv WHERE key LIKE 'store:product:%'",
);
const overlayIds = new Set(
  overlayRows.map((row) => String(row.key).slice("store:product:".length)).filter(Boolean),
);

/* ------------------------------------------------------------- the proposals */

const results = [];
for (const product of products) {
  const id = String(product?.["id"] ?? "");
  if (!id) continue;
  if (ONLY && id !== ONLY) continue;
  if (!Array.isArray(product?.["types"]) || product["types"].length === 0) continue;

  const result = app.repriceTiers({
    id,
    title: String(product["title"] || product["titleEn"] || ""),
    kind: String(product["kind"] ?? ""),
    schemaId: String(product["schemaId"] ?? product["schema_id"] ?? ""),
    types: product["types"],
  });
  results.push({ product, result });
}

const moving = results.filter(({ result }) => result.changed).slice(0, LIMIT);

/* ---------------------------------------------------------------- the report */

say(`# التسعير على الطبقات الأربع — ${APPLY ? "تطبيق" : "تشغيل جاف"}`);
say();
say(`شُغّل في ${new Date().toISOString()}.`);
say();
say(`- منتجات في الإنتاج: **${products.length}**`);
say(`- منتجات تحمل طبقات \`types\`: **${results.length}**`);
say(`- منتجات ستتحرك أسعارها: **${moving.length}**`);
say();

/* The cost breakdown the owner asked for first. */
const byKind = {};
let unknownTiers = 0;
let skippedTiers = 0;
for (const { result } of results) {
  for (const p of result.proposals) {
    if (p.kind === "unknown") unknownTiers += 1;
    if (p.skipped) skippedTiers += 1;
    const bucket = (byKind[p.kind] ??= { n: 0, cost: 0, price: 0, moving: 0, marginLow: Infinity, marginHigh: -Infinity });
    bucket.n += 1;
    bucket.cost += Number(p.cost) || 0;
    bucket.price += Number(p.oldPrice) || 0;
    if (p.changed) bucket.moving += 1;
    if (!p.skipped) {
      const margin = Number(p.oldPrice) - Number(p.cost);
      bucket.marginLow = Math.min(bucket.marginLow, margin);
      bucket.marginHigh = Math.max(bucket.marginHigh, margin);
    }
  }
}

say(`## 1. التكلفة والربح الحالي، حسب الطبقة`);
say();
say(`| الطبقة | عدد | مجموع التكلفة | مجموع السعر | الربح الحالي | أقل ربح | أعلى ربح | ستتحرك |`);
say(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
for (const [kind, b] of Object.entries(byKind).sort((a, b) => b[1].n - a[1].n)) {
  const low = Number.isFinite(b.marginLow) ? money(b.marginLow) : "—";
  const high = Number.isFinite(b.marginHigh) ? money(b.marginHigh) : "—";
  say(
    `| \`${kind}\` | ${b.n} | ${money(b.cost)} | ${money(b.price)} | ${money(b.price - b.cost)} | ${low} | ${high} | ${b.moving} |`,
  );
}
say();
say(`طبقات لم تُعرَف (لن تُمَس): **${unknownTiers}** · طبقات خارج النطاق: **${skippedTiers}**`);
say();

/* --------------------------------------------------------------- the changes */

say(`## 2. ما سيتغيّر`);
say();
if (!moving.length) {
  say(`لا شيء. كل الطبقات داخل قواعد المالك أصلًا.`);
} else {
  say(`| المنتج | الطبقة | التكلفة | من | إلى | الربح بعد | السبب |`);
  say(`| --- | --- | --- | --- | --- | --- | --- |`);
  for (const { product, result } of moving) {
    for (const p of result.proposals) {
      if (!p.changed) continue;
      say(
        `| ${String(result.title).slice(0, 34)} | \`${p.kind}\` | ${money(p.cost)} | ${money(p.oldPrice)} | **${money(p.newPrice)}** | ${money(p.newPrice - p.cost)} | ${p.reason} |`,
      );
    }
  }
}
say();

/* The gate. Every proposal, before anything is written. */
const problems = [];
for (const { result } of moving) {
  for (const p of result.proposals) {
    if (!p.changed) continue;
    const problem = app.tierProblem(p, result);
    if (problem) problems.push(`${result.id} · ${p.kind}: ${problem}`);
  }
}
if (problems.length) {
  say(`## اقتراحات تكسر قواعد المالك — ${problems.length}`);
  say();
  for (const problem of problems.slice(0, 40)) say(`- ${problem}`);
  fail("اقتراح واحد على الأقل يكسر القواعد، وهذا خطأ في القواعد لا في الكتالوج");
}

const payload = {
  at: new Date().toISOString(),
  applied: APPLY,
  changes: moving.flatMap(({ result }) =>
    result.proposals
      .filter((p) => p.changed)
      .map((p) => ({
        id: result.id,
        title: result.title,
        tierIndex: p.index,
        tierId: p.id,
        kind: p.kind,
        cost: p.cost,
        from: p.oldPrice,
        to: p.newPrice,
        reason: p.reason,
      })),
  ),
};
if (args.json && args.json !== "true") writeFileSync(args.json, JSON.stringify(payload, null, 2));

if (!APPLY) {
  say(`**تشغيل جاف. لم يُكتب شيء.**`);
  const frozen = moving.filter(({ result }) => overlayIds.has(result.id));
  say();
  say(
    `منتجات ستتحرك ولها صف \`store:product:<id>\` منفصل (يجب أن يُكتب هو لا الكتل): **${frozen.length}**`,
  );
  rmSync(outfile, { force: true });
  flush();
  process.exit(0);
}

if (!moving.length) {
  say("**لا شيء ليُكتب.**");
  rmSync(outfile, { force: true });
  flush();
  process.exit(0);
}

/* ------------------------------------------------------------- the rehearsal */

/*
  Patch a copy of every product in memory and assert that the ONLY thing that
  differs is `price` on the exact tier rows named — before a byte reaches
  production. A tier's COST is what this must protect above all: it is the
  owner's supplier data and the whole margin rests on it.
*/
const wanted = new Map();
for (const { result } of moving) {
  const perTier = new Map();
  for (const p of result.proposals) if (p.changed) perTier.set(p.index, p.newPrice);
  if (perTier.size) wanted.set(result.id, perTier);
}

const byId = new Map(products.map((p) => [String(p["id"] ?? ""), p]));

/** A product with the wanted tier prices applied, and nothing else changed. */
const patchProduct = (before, perTier) => {
  const types = (Array.isArray(before["types"]) ? before["types"] : []).map((tier, index) =>
    perTier.has(index) ? { ...tier, price: perTier.get(index) } : tier,
  );
  return { ...before, types };
};

for (const [id, perTier] of wanted) {
  const before = byId.get(id);
  if (!before) fail(`${id} ليس في الكتالوج`);
  const patched = patchProduct(before, perTier);

  for (const key of new Set([...Object.keys(before), ...Object.keys(patched)])) {
    if (key === "types") continue;
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(patched[key] ?? null)) {
      fail(`البروفة: ${id}.${key} تغيّر، وهذا السكربت لا يملك تغييره`);
    }
  }

  const beforeTiers = Array.isArray(before["types"]) ? before["types"] : [];
  const afterTiers = patched["types"];
  if (beforeTiers.length !== afterTiers.length) fail(`البروفة: ${id}.types غيّر طوله`);
  for (let i = 0; i < beforeTiers.length; i += 1) {
    for (const key of new Set([
      ...Object.keys(beforeTiers[i] ?? {}),
      ...Object.keys(afterTiers[i] ?? {}),
    ])) {
      if (key === "price" && perTier.has(i)) continue;
      if (
        JSON.stringify(beforeTiers[i]?.[key] ?? null) !== JSON.stringify(afterTiers[i]?.[key] ?? null)
      ) {
        fail(`البروفة: ${id}.types[${i}].${key} تغيّر، وهذا السكربت لا يملك تغييره`);
      }
    }
    if (perTier.has(i) && Number(afterTiers[i].price) !== Number(perTier.get(i))) {
      fail(`البروفة: ${id}.types[${i}].price لم يُضبط`);
    }
  }
}

/* ------------------------------------------------------------------ the write */

/*
  Two paths, because the catalogue has two homes.

  A product with a `store:product:<id>` row is served from THAT row —
  `loadStore` lets the granular document overwrite the chunked one. Writing
  only the chunks for such a product produces a write that reports success and
  changes nothing a shopper will ever see. So each product is written where it
  actually lives.
*/
const overlayWrites = [...wanted.keys()].filter((id) => overlayIds.has(id));
const chunkWrites = [...wanted.keys()].filter((id) => !overlayIds.has(id));

say(`## 3. الكتابة`);
say();
say(`- عبر صفوف \`store:product:<id>\`: **${overlayWrites.length}**`);
say(`- عبر كتل الكتالوج: **${chunkWrites.length}**`);
say();

for (const id of overlayWrites) {
  const rows = await app.d1All("SELECT value FROM store_kv WHERE key = ?", `store:product:${id}`);
  let stored = null;
  try {
    stored = rows?.[0]?.value ? JSON.parse(String(rows[0].value)) : null;
  } catch {
    stored = null;
  }
  if (!stored || String(stored.id ?? "") !== id) {
    fail(`${id}: صف \`store:product:\` غير قابل للقراءة — لن أكتب فوقه`);
  }
  const patched = patchProduct(stored, wanted.get(id));
  await app.d1Run(
    "INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)" +
      " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    `store:product:${id}`,
    JSON.stringify(patched),
    new Date().toISOString(),
  );
}

let written = 0;
if (chunkWrites.length) {
  const chunkSet = new Set(chunkWrites);
  await app.updateStore((current) => {
    /*
      Reset, because `updateStore` re-reads and re-applies on a revision
      conflict, up to four times. A counter that only incremented would report
      four times the products it changed.
    */
    written = 0;
    const list = Array.isArray(current?.products) ? current.products : [];
    const next = list.map((item) => {
      const id = String(item?.id ?? "");
      if (!chunkSet.has(id)) return item;
      written += 1;
      return patchProduct(item, wanted.get(id));
    });
    return { ...current, products: next };
  });
}

/* ------------------------------------------------------------ the read-back */

/*
  From D1, not from this process's memory. `updateStore` seeds `storeCache`
  with the document it just wrote and `getStore()` serves it for up to a
  minute — so a read-back without this invalidation confirms a write that may
  never have reached the database. A verification that can only agree with
  itself is not a verification.
*/
app.invalidateStoreCache();
const afterStore = await app.getStore();
const afterList = Array.isArray(afterStore?.products) ? afterStore.products : [];
const afterById = new Map(afterList.map((p) => [String(p["id"] ?? ""), p]));

const faults = [];
let verified = 0;
for (const [id, perTier] of wanted) {
  const was = byId.get(id);
  const now = afterById.get(id);
  if (!now) {
    faults.push(`${id} اختفى من الكتالوج بعد الكتابة`);
    continue;
  }

  for (const key of new Set([...Object.keys(was ?? {}), ...Object.keys(now)])) {
    if (key === "types") continue;
    if (JSON.stringify(was?.[key] ?? null) !== JSON.stringify(now[key] ?? null)) {
      faults.push(`${id}.${key} تغيّر، وهذا السكربت لا يملك تغييره`);
    }
  }

  const wasTiers = Array.isArray(was?.["types"]) ? was["types"] : [];
  const nowTiers = Array.isArray(now["types"]) ? now["types"] : [];
  if (wasTiers.length !== nowTiers.length) {
    faults.push(`${id}.types غيّر طوله`);
    continue;
  }
  let clean = true;
  for (let i = 0; i < wasTiers.length; i += 1) {
    if (perTier.has(i) && Number(nowTiers[i]?.price) !== Number(perTier.get(i))) {
      faults.push(`${id}.types[${i}].price = ${nowTiers[i]?.price}، والمتوقع ${perTier.get(i)}`);
      clean = false;
      continue;
    }
    for (const key of new Set([...Object.keys(wasTiers[i] ?? {}), ...Object.keys(nowTiers[i] ?? {})])) {
      if (key === "price" && perTier.has(i)) continue;
      if (JSON.stringify(wasTiers[i]?.[key] ?? null) !== JSON.stringify(nowTiers[i]?.[key] ?? null)) {
        faults.push(`${id}.types[${i}].${key} تغيّر، وهذا السكربت لا يملك تغييره`);
        clean = false;
      }
    }
  }
  if (clean) verified += 1;
}

/*
  The last word: run the rules again over what the database actually holds.

  Field-by-field equality says the write landed on the products this run knew
  about. It does not say the catalogue now satisfies the rules — a product
  missed entirely would never appear in `wanted` and would sail through the
  loop above. The rules are idempotent by test, so a correct apply leaves
  nothing to do; anything still moving is a product this run failed to move.
*/
const settled = afterList
  .filter((product) => Array.isArray(product?.["types"]) && product["types"].length > 0)
  .map((product) =>
    app.repriceTiers({
      id: String(product["id"] ?? ""),
      title: String(product["title"] || product["titleEn"] || ""),
      kind: String(product["kind"] ?? ""),
      schemaId: String(product["schemaId"] ?? product["schema_id"] ?? ""),
      types: product["types"],
    }),
  )
  .filter((result) => result.changed);

rmSync(outfile, { force: true });

say(`- كُتب عبر الكتل: ${written} · عبر الصفوف المنفصلة: ${overlayWrites.length}`);
say(`- تحقق بالقراءة من D1: ${verified} من ${wanted.size}`);
say();

if (faults.length) {
  say(`## أخطاء في التحقق — ${faults.length}`);
  say();
  for (const fault of faults.slice(0, 40)) say(`- ${fault}`);
  fail("الكتابة لم تُطابق ما طُلب");
}

if (settled.length) {
  say(`## ما زال خارج القواعد بعد التطبيق — ${settled.length}`);
  say();
  for (const result of settled.slice(0, 40)) {
    const which = result.proposals.filter((p) => p.changed).map((p) => p.kind).join(", ");
    say(`- ${result.id} · ${result.title} · ${which}`);
  }
  fail("منتجات لم يحركها هذا التشغيل — القواعد لم تستقر");
}

say(`**تم. كل طبقة تحركت، وتحققت من D1، والقواعد مستقرة.**`);
flush();
