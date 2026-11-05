#!/usr/bin/env node
/**
 * Catalogue enrichment: Nintendo's own facts and pictures onto the shop's
 * games — description, genres, publisher, release date, PEGI, players,
 * languages, size, codes, and the front box / square / wide artwork, each in
 * its own role.
 *
 *   node scripts/catalogue-enrich.mjs [--file import-sources/enrichment/<file>.json]
 *                                     [--settings <settings file>] [--apply true]
 *
 * The patches are generated from public data by `scripts/nintendo-eu-enrich.mjs`
 * and committed under `import-sources/enrichment/`.
 *
 * FILL ONLY, re-checked live: every field is compared with the product as it is
 * in production at the moment of writing (`planFill`), so nothing an admin has
 * written — before or since the patch was made — is ever replaced.
 *
 * One exception, and only for pictures (`planRepair`): a picture whose stored
 * link points at a file absent from both buckets — a link to nothing, which
 * the page shows as «لم يتم إضافة الصورة بعد» — is replaced by Nintendo's
 * picture for the same role. A live stored picture, one only in the older
 * bucket, and one whose listing could not be read are all left alone.
 *
 * DRY unless the pushed commit carries an unspent token in
 * `scripts/catalogue-enrich.apply-token` (claimed in `console_runs` before the
 * first write, so a re-run cannot write twice) or `--apply true` is passed by
 * hand. A product with an overlay row is written there — the row every read
 * prefers, and the one the admin's editor writes — and the rest in one
 * catalogue write; the revision moves once, so every cache refreshes.
 *
 * Outputs (no customer data — this repository is public):
 * `catalogue-enrich.md` and `catalogue-enrich.json`.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

import { planFill, planRepair } from "./lib/catalogue-enrich.mjs";
import { commonPrefix, listPrefix } from "./lib/r2-listing.mjs";
import {
  SERVING_BUCKET,
  WRITING_BUCKET,
  isBlanketFailure,
  r2ListVerdictFor,
  storageKeyFor,
} from "./lib/square-link-verdict.mjs";
import { overlayProductIds, readOverlayProduct, writeOverlayProduct } from "./lib/store-overlay.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);
const PATCH_FILE = args.file && args.file !== "true" ? args.file : "import-sources/enrichment/nintendo-eu-2026-11.json";
/*
  Owner-approved settings, written by the same run-once token: the one dollar
  rate and the occasion-deal campaigns. Only these keys are accepted.

  Only when named (`--settings <file>`). The first run (2026-11-05) applied
  `import-sources/enrichment/settings-2026-11.json`; applied by default on
  every later run, it would put back the rate and the campaigns as they were
  that morning over whatever the owner has set since.
*/
const SETTINGS_FILE = args.settings && args.settings !== "true" ? args.settings : "";
const SETTINGS_KEYS = new Set(["usdExchangeRate", "usd_iqd_rate", "deals"]);
const TOKEN_FILE = "scripts/catalogue-enrich.apply-token";
const OUT_REPORT = "catalogue-enrich.md";
const OUT_JSON = "catalogue-enrich.json";

const lines = [];
const say = (text = "") => {
  lines.push(text);
  console.log(text);
};
const finish = (summary) => {
  writeFileSync(OUT_REPORT, lines.join("\n") + "\n");
  writeFileSync(OUT_JSON, JSON.stringify(summary, null, 1));
};
const fail = (message) => {
  say(`**توقف:** ${message}`);
  finish({ error: message });
  process.exit(1);
};

let token = null;
if (existsSync(TOKEN_FILE)) {
  const first = readFileSync(TOKEN_FILE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  token = first && /^[\w.-]{6,80}$/.test(first) ? first : null;
}
const WANT_APPLY = args.apply === "true" || Boolean(token);

if (!process.env["D1_DATABASE_ID"] && process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  process.env["D1_DATABASE_ID"] = process.env["CLOUDFLARE_D1_DATABASE_ID"];
}
if (!process.env["D1_DATABASE_ID"]) {
  const found = readFileSync(path.resolve("wrangler.jsonc"), "utf8").match(
    /"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/,
  );
  if (found) process.env["D1_DATABASE_ID"] = found[1];
}
for (const key of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"]) {
  if (!process.env[key]) fail(`مفقود ${key}`);
}

/*
  Same guards as every catalogue writer here: `updateStore` would message the
  members whose favourite changed price (none do — enrichment touches no
  price — but nothing is sent from this job either way), and it reads the
  member list first; that one statement is answered with no rows.
*/
globalThis.__enrichSilenced = { count: 0 };
const fetchThrough = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : String(input?.url ?? "");
  if (/\/d1\/database\/[^/]+\/query$/.test(url) && typeof init?.body === "string") {
    let sql = "";
    try {
      sql = String(JSON.parse(init.body)?.sql ?? "");
    } catch {
      sql = "";
    }
    if (/^\s*SELECT \* FROM users ORDER BY created_at ASC\s*$/i.test(sql)) {
      return new Response(
        JSON.stringify({ success: true, result: [{ success: true, results: [], meta: {} }] }),
        { headers: { "content-type": "application/json" } },
      );
    }
  }
  return fetchThrough(input, init);
};
const realTelegram = path.resolve("src/lib/telegram.server.ts");

const outfile = path.resolve(".catalogue-enrich-bundle.mjs");
await build({
  entryPoints: ["scripts/lib/catalogue-enrich-entry.ts"],
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
        const virtual = /^(#tanstack-router-entry|#tanstack-start-entry|tanstack-start-manifest:)/;
        pluginBuild.onResolve({ filter: virtual }, (a) => ({ path: a.path, namespace: "start-virtual" }));
        pluginBuild.onLoad({ filter: /.*/, namespace: "start-virtual" }, () => ({
          contents: "export default {}; export const getStartManifest = () => ({});",
          loader: "js",
        }));
      },
    },
    {
      name: "silence-telegram",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /telegram\.server(\.ts)?$/ }, (a) =>
          a.namespace === "silenced-telegram"
            ? { path: realTelegram }
            : { path: "telegram.server", namespace: "silenced-telegram" },
        );
        pluginBuild.onLoad({ filter: /.*/, namespace: "silenced-telegram" }, () => ({
          contents: [
            `export * from ${JSON.stringify(realTelegram)};`,
            "export async function sendTelegramMessage() {",
            "  globalThis.__enrichSilenced.count += 1;",
            '  return { ok: false, description: "silenced by catalogue-enrich" };',
            "}",
          ].join("\n"),
          loader: "js",
          resolveDir: path.dirname(realTelegram),
        }));
      },
    },
  ],
});
const app = await import(outfile);
rmSync(outfile, { force: true });

/* -------------------------------------------------------------------- plan */
if (!existsSync(PATCH_FILE)) fail(`لا يوجد ملف ${PATCH_FILE}`);
const patches = JSON.parse(readFileSync(PATCH_FILE, "utf8"));
const store = await app.getStore();
const live = new Map((store.products ?? []).map((p) => [String(p.id), p]));
const overlays = await overlayProductIds(app);

/*
  Which stored pictures are links to nothing. Every `/api/files/...` link a
  repair could replace is looked up in ONE listing per bucket — the bucket the
  site serves from and the one older scripts wrote to — never by asking the
  site picture by picture. «dead» is absent from both; a file only in the
  older bucket is «misplaced» (square-card-relocate copies those) and is left
  alone. A listing that did not complete, or a share of dead and unknown past
  the shared guard, turns every repair off: a checker that cannot see must
  not erase the shop's pictures.
*/
const repairKeys = new Set();
for (const patch of patches) {
  const product = live.get(String(patch.id));
  if (!product || !patch.repair) continue;
  for (const field of Object.keys(patch.repair)) {
    const key = storageKeyFor(product[field]);
    if (key) repairKeys.add(key);
  }
}
const verdicts = new Map();
let repairsOff = "";
let pictureCounts = null;
if (repairKeys.size) {
  const root = commonPrefix(repairKeys);
  const r2 = { account: process.env["CLOUDFLARE_ACCOUNT_ID"], token: process.env["CLOUDFLARE_API_TOKEN"] };
  const servingKeys = await listPrefix(SERVING_BUCKET, root, r2);
  const writingKeys = await listPrefix(WRITING_BUCKET, root, r2);
  const counts = { alive: 0, misplaced: 0, dead: 0, unknown: 0 };
  for (const key of repairKeys) {
    const verdict = r2ListVerdictFor(key, servingKeys, writingKeys);
    verdicts.set(key, verdict);
    counts[verdict] = (counts[verdict] ?? 0) + 1;
  }
  if (!servingKeys || !writingKeys) repairsOff = "تعذّرت قراءة قائمة الملفات";
  else if (isBlanketFailure(counts)) repairsOff = `نسبة المفقود كبيرة على نحو مريب (${counts.dead + counts.unknown} من ${repairKeys.size})`;
  pictureCounts = counts;
  /*
    Counts only, as a GitHub notice: the run page shows notices to anyone,
    while the report needs a signed-in account. No title, id or address.
  */
  console.log(
    `::notice title=Stored pictures::${repairKeys.size} checked under ${root || "(no shared folder)"}; ` +
      `listing ${SERVING_BUCKET}: ${servingKeys ? servingKeys.size : "failed"}, ${WRITING_BUCKET}: ${writingKeys ? writingKeys.size : "failed"}; ` +
      `alive ${counts.alive}, misplaced ${counts.misplaced}, dead ${counts.dead}, unknown ${counts.unknown}; ` +
      `repairs ${repairsOff ? "OFF" : "on"}`,
  );
} else {
  console.log(`::notice title=Stored pictures::none to check (${patches.filter((p) => p.repair).length} patches offer a repair)`);
}
const isDead = (url) => !repairsOff && verdicts.get(storageKeyFor(url)) === "dead";

const planned = [];
const missingProducts = [];
const fieldCounts = {};
const repairCounts = {};
for (const patch of patches) {
  const product = live.get(String(patch.id));
  if (!product) {
    missingProducts.push(patch.id);
    continue;
  }
  const fill = planFill(product, patch.fill);
  const repair = planRepair(product, patch.repair, isDead);
  if (!Object.keys(fill).length && !Object.keys(repair).length) continue;
  for (const field of Object.keys(fill)) fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
  for (const field of Object.keys(repair)) repairCounts[field] = (repairCounts[field] ?? 0) + 1;
  planned.push({
    id: String(patch.id),
    title: patch.title,
    how: patch.how,
    overlay: overlays.has(String(patch.id)),
    fill: patch.fill,
    repair: patch.repair ?? {},
    write: { ...fill, ...repair },
  });
}
/** What may be written onto `product` now, checked again at the moment of writing. */
const writeFor = (product, entry) => ({ ...planFill(product, entry.fill), ...planRepair(product, entry.repair, isDead) });
console.log(
  `::notice title=Plan::${planned.length} products to write; ` +
    `fields ${Object.values(fieldCounts).reduce((a, b) => a + b, 0)}; ` +
    `repairs ${Object.entries(repairCounts).map(([f, n]) => `${f} ${n}`).join(", ") || "none"}`,
);

let settingsPatch = null;
if (SETTINGS_FILE) {
  if (!existsSync(SETTINGS_FILE)) fail(`لا يوجد ملف ${SETTINGS_FILE}`);
  const raw = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
  settingsPatch = Object.fromEntries(Object.entries(raw).filter(([key]) => SETTINGS_KEYS.has(key)));
  const rate = Number(settingsPatch.usdExchangeRate ?? settingsPatch.usd_iqd_rate);
  if (("usdExchangeRate" in settingsPatch || "usd_iqd_rate" in settingsPatch) && !(rate >= 100 && rate <= 100_000)) {
    fail(`سعر صرف غير مقبول في ${SETTINGS_FILE}`);
  }
  const current = store.settings ?? {};
  for (const key of Object.keys(settingsPatch)) {
    if (JSON.stringify(current[key]) === JSON.stringify(settingsPatch[key])) delete settingsPatch[key];
  }
  if (!Object.keys(settingsPatch).length) settingsPatch = null;
}

say(`# إثراء الكتالوج من بيانات نينتندو — ${WANT_APPLY ? "تطبيق" : "تشغيل جاف"}`);
if (settingsPatch) {
  say();
  say(`- إعدادات ستُكتب: ${Object.keys(settingsPatch).join("، ")}`);
  if (settingsPatch.usdExchangeRate) say(`  - سعر الدولار: ${settingsPatch.usdExchangeRate} د.ع`);
  if (settingsPatch.deals) {
    say(
      `  - العروض: ${settingsPatch.deals.enabled ? "مشغّلة" : "متوقفة"}، ${(settingsPatch.deals.campaigns ?? []).length} عرض`,
    );
  }
}
say();
say(`- الملف: \`${PATCH_FILE}\` (${patches.length} منتجاً)`);
say(`- منتجات سيُملأ لها شيء الآن: **${planned.length}** (منها ${planned.filter((p) => p.overlay).length} بصف خاص)`);
say(`- منتجات لم تعد في الكتالوج: ${missingProducts.length}`);
say();
say("| الحقل | عدد المنتجات |");
say("| --- | --- |");
for (const [field, n] of Object.entries(fieldCounts).sort((a, b) => b[1] - a[1])) say(`| ${field} | ${n} |`);
say();
say(
  `- صور مخزّنة فُحصت: ${repairKeys.size}` +
    (pictureCounts
      ? ` — موجودة ${pictureCounts.alive}، في الحاوية القديمة ${pictureCounts.misplaced}، ` +
        `مفقودة ${pictureCounts.dead}، غير معروفة ${pictureCounts.unknown}`
      : ""),
);
if (repairsOff) say(`- **الإصلاح متوقف:** ${repairsOff} — لن تُستبدل أي صورة.`);
say(
  `- صور مفقودة ستُستبدل بصورة نينتندو للدور نفسه: ` +
    (Object.entries(repairCounts)
      .map(([field, n]) => `${field} ${n}`)
      .join("، ") || "لا شيء"),
);
say();
say("أمثلة:");
for (const p of planned.slice(0, 8)) say(`- ${p.title} (${p.how}): ${Object.keys(p.write).join("، ")}`);
say();

const summary = {
  file: PATCH_FILE,
  planned: planned.length,
  fieldCounts,
  repairCounts,
  pictures: pictureCounts,
  repairsOff: repairsOff || null,
  missingProducts: missingProducts.length,
  settings: settingsPatch ? Object.keys(settingsPatch) : [],
};

if (!WANT_APPLY) {
  say("تشغيل جاف: لم يُكتب شيء. لإجراء الكتابة ضع رمزاً جديداً في `scripts/catalogue-enrich.apply-token`.");
  finish({ ...summary, applied: false });
  process.exit(0);
}

/* ------------------------------------------------------------------- apply */
if (token && args.apply !== "true") {
  await app.d1Run(`CREATE TABLE IF NOT EXISTS console_runs (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
  try {
    await app.d1Run(`INSERT INTO console_runs (id, applied_at) VALUES (?, ?)`, `catalogue-enrich:${token}`, Date.now());
  } catch {
    say(`الرمز \`${token}\` استُخدم من قبل. هذا التشغيل يبقى جافاً — لم يُكتب شيء.`);
    finish({ ...summary, applied: false, reason: "token_spent" });
    process.exit(0);
  }
  say(`استُلم الرمز \`${token}\`. الكتابة تبدأ.`);
}

const now = new Date().toISOString();
let overlayWrites = 0;
for (const entry of planned.filter((e) => e.overlay)) {
  // Re-read the row itself and plan again: the editor may have saved since.
  const fresh = await readOverlayProduct(app, entry.id);
  if (!fresh) continue;
  const write = writeFor(fresh, entry);
  if (!Object.keys(write).length) continue;
  await writeOverlayProduct(app, entry.id, { ...fresh, ...write, updatedAt: now }, now);
  overlayWrites += 1;
}

const chunkEntries = new Map(planned.filter((e) => !e.overlay).map((e) => [e.id, e]));
let chunkWrites = 0;
let settingsWritten = false;
if (chunkEntries.size || settingsPatch) {
  await app.updateStore((doc) => {
    chunkWrites = 0;
    doc.products = (doc.products ?? []).map((product) => {
      const entry = chunkEntries.get(String(product.id));
      if (!entry) return product;
      const write = writeFor(product, entry);
      if (!Object.keys(write).length) return product;
      chunkWrites += 1;
      return { ...product, ...write, updatedAt: now };
    });
    if (settingsPatch) {
      // Merged key by key, as every settings screen saves — nothing else moves.
      doc.settings = { ...(doc.settings ?? {}), ...settingsPatch };
      settingsWritten = true;
    }
    return doc;
  });
}
if (overlayWrites > 0 && chunkWrites === 0 && !settingsWritten) await app.bumpCatalogVersion();

say(
  `كُتب: ${overlayWrites} بصفوفها الخاصة، و${chunkWrites} ضمن الكتالوج` +
    (settingsWritten ? `، والإعدادات (${Object.keys(settingsPatch).join("، ")})` : "") +
    `. رسائل تيليجرام أُرسلت: ${globalThis.__enrichSilenced.count}.`,
);
finish({ ...summary, applied: true, overlayWrites, chunkWrites, settingsWritten });
