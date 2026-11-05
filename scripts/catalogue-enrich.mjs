#!/usr/bin/env node
/**
 * Catalogue enrichment: Nintendo's own facts and pictures onto the shop's
 * games — description, genres, publisher, release date, PEGI, players,
 * languages, size, codes, and the front box / square / wide artwork, each in
 * its own role.
 *
 *   node scripts/catalogue-enrich.mjs [--file import-sources/enrichment/<file>.json] [--apply true]
 *
 * The patches are generated from public data by `scripts/nintendo-eu-enrich.mjs`
 * and committed under `import-sources/enrichment/`.
 *
 * FILL ONLY, re-checked live: every field is compared with the product as it is
 * in production at the moment of writing (`planFill`), so nothing an admin has
 * written — before or since the patch was made — is ever replaced.
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

import { planFill } from "./lib/catalogue-enrich.mjs";
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
*/
const SETTINGS_FILE =
  args.settings && args.settings !== "true" ? args.settings : "import-sources/enrichment/settings-2026-11.json";
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

const planned = [];
const missingProducts = [];
const fieldCounts = {};
for (const patch of patches) {
  const product = live.get(String(patch.id));
  if (!product) {
    missingProducts.push(patch.id);
    continue;
  }
  const fill = planFill(product, patch.fill);
  if (!Object.keys(fill).length) continue;
  for (const field of Object.keys(fill)) fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
  planned.push({ id: String(patch.id), title: patch.title, how: patch.how, overlay: overlays.has(String(patch.id)), fill });
}

let settingsPatch = null;
if (existsSync(SETTINGS_FILE)) {
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
say("أمثلة:");
for (const p of planned.slice(0, 8)) say(`- ${p.title} (${p.how}): ${Object.keys(p.fill).join("، ")}`);
say();

const summary = {
  file: PATCH_FILE,
  planned: planned.length,
  fieldCounts,
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
  const fill = planFill(fresh, entry.fill);
  if (!Object.keys(fill).length) continue;
  await writeOverlayProduct(app, entry.id, { ...fresh, ...fill, updatedAt: now }, now);
  overlayWrites += 1;
}

const chunkIds = new Map(planned.filter((e) => !e.overlay).map((e) => [e.id, e.fill]));
let chunkWrites = 0;
let settingsWritten = false;
if (chunkIds.size || settingsPatch) {
  await app.updateStore((doc) => {
    chunkWrites = 0;
    doc.products = (doc.products ?? []).map((product) => {
      const fillFor = chunkIds.get(String(product.id));
      if (!fillFor) return product;
      const fill = planFill(product, fillFor);
      if (!Object.keys(fill).length) return product;
      chunkWrites += 1;
      return { ...product, ...fill, updatedAt: now };
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
