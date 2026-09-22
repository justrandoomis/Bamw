#!/usr/bin/env node
/**
 * Which NEW source could actually answer for the games still without a card.
 *
 * The owner: «الصور المربعه تستطيع البحث في مصادر أخرى مثل ويكيبيديا أو البحث
 * في جوجل أو أي مصدر آخر يجلب الصورة للعبة الصحيحة».
 *
 * READ-ONLY. It writes nothing, anywhere. It exists because every candidate
 * source has one question that decides it and that cannot be answered from
 * here: not "does this API exist" but "does the shop hold the KEY that source
 * needs, for the games that are actually missing a card". A source with
 * perfect identity and perfect square art is worth nothing if the 372 games
 * carry no id to look them up by.
 *
 * So this counts the denominators first, from the live catalogue, and only
 * then spends a request. Everything it prints is a number or a raw field name
 * — no judgement, because the judgement belongs in the report that follows it.
 */
import { build } from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { sheetSquareCover } from "./lib/nintendo-sheet-cover.mjs";

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

if (!process.env["D1_DATABASE_ID"] && process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  process.env["D1_DATABASE_ID"] = process.env["CLOUDFLARE_D1_DATABASE_ID"];
}
if (!process.env["D1_DATABASE_ID"]) {
  try {
    const config = readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    const found = config.match(/"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/);
    if (found) process.env["D1_DATABASE_ID"] = found[1];
  } catch {
    /* Reported below as an unreachable database. */
  }
}

const outfile = path.resolve(".square-probe-bundle.mjs");
let app;
try {
  await build({
    entryPoints: ["scripts/lib/square-card-entry.ts"],
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

say("# ما الذي يمكن لمصدر جديد أن يجيب عنه فعلًا");
say();

const store = await app.getStore();
const products = Array.isArray(store?.products) ? store.products : [];
if (products.length < 100) {
  rmSync(outfile, { force: true });
  fail(`الكتالوج أعاد ${products.length} منتجًا فقط — هذا ليس الكتالوج`);
}

const games = products.filter((p) => {
  const kind = String(p?.kind ?? "").toLowerCase();
  const schema = String(p?.schemaId ?? p?.schema_id ?? "").toLowerCase();
  return !["hardware", "device", "accessory", "gift_card", "digital_code"].includes(kind) &&
    !["hardware", "gift_card"].includes(schema);
});
const missing = games.filter((p) => !app.hasNintendoSquareCard(p));

say(`- ألعاب في الكتالوج: **${games.length}**`);
say(`- بلا صورة مربعة: **${missing.length}**`);
say();

/* ------------------------------------------------------------------ *
 * THE DENOMINATORS. Which key does each candidate source need, and how
 * many of the missing games carry it? A source nothing can be looked up
 * by is worth nothing however good it is.
 * ------------------------------------------------------------------ */
const has = (p, key) => String(p?.[key] ?? "").trim().length > 0;
const counts = {
  nsuid: missing.filter((p) => has(p, "nsuid")).length,
  productCode: missing.filter((p) => has(p, "productCode") || has(p, "product_code")).length,
  canonicalTitle: missing.filter((p) => has(p, "canonicalTitle")).length,
  chineseName: missing.filter((p) => has(p, "chineseName") || has(p, "supplierNameZhCn")).length,
  coverImage: missing.filter((p) => has(p, "coverImage")).length,
  sheetSquare: missing.filter((p) => sheetSquareCover(p?.coverImage)).length,
  officialStoreUrl: missing.filter((p) => has(p, "officialStoreUrl")).length,
  titleEn: missing.filter((p) => has(p, "titleEn") || has(p, "title")).length,
};

say("## المفتاح الذي يحتاجه كل مصدر، وكم لعبة تحمله");
say();
say("| المفتاح | ألعاب بلا صورة تحمله | من أصل |");
say("| --- | ---: | ---: |");
for (const [key, n] of Object.entries(counts)) {
  say(`| \`${key}\` | ${n} | ${missing.length} |`);
}
say();

/* ------------------------------------------------------------------ *
 * NINTENDO OF JAPAN. The repo already talks to `search.nintendo.jp` for
 * languages and throws every other field away. Nobody here has ever
 * looked at whether its rows carry an image, so this prints the raw key
 * names of a real response rather than claiming one.
 * ------------------------------------------------------------------ */
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function getJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25_000);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json,*/*" },
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body: text.slice(0, 200) };
    try {
      return { ok: true, status: res.status, json: JSON.parse(text) };
    } catch {
      return { ok: false, status: res.status, body: text.slice(0, 200) };
    }
  } catch (err) {
    return { ok: false, status: 0, body: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

say("## نينتندو اليابان — ما الحقول التي يعيدها فعلًا");
say();
const jp = await getJson("https://search.nintendo.jp/nintendo_soft/search.json?limit=3&opt_sshow=1");
if (!jp.ok) {
  say(`تعذّر الوصول: HTTP ${jp.status} ${String(jp.body ?? "").slice(0, 120)}`);
} else {
  const items = jp.json?.result?.items ?? [];
  say(`- صفوف أعيدت: **${items.length}**`);
  if (items.length) {
    const keys = Object.keys(items[0]).sort();
    say(`- مفاتيح الصف الأول (${keys.length}):`);
    say();
    say("```");
    say(keys.join(", "));
    say("```");
    say();
    const imageish = keys.filter((k) => /img|image|icon|thumb|url|banner|photo|pic/i.test(k));
    say(`- منها ما يبدو صورة: \`${imageish.join("`, `") || "لا شيء"}\``);
    for (const key of imageish.slice(0, 8)) {
      const value = items[0][key];
      say(`  - \`${key}\` = ${JSON.stringify(value).slice(0, 160)}`);
    }
  }
}
say();

/* ------------------------------------------------------------------ *
 * STEAMGRIDDB. The one source on the list whose square art is a
 * server-side filter rather than a hope. It needs a key; whether the
 * shop has one is a fact, not a guess, so it is checked rather than
 * assumed.
 * ------------------------------------------------------------------ */
say("## SteamGridDB — هل المفتاح موجود");
say();
const sgdbKey = String(process.env["STEAMGRIDDB_API_KEY"] ?? "").trim();
if (!sgdbKey) {
  say("- لا يوجد `STEAMGRIDDB_API_KEY` في أسرار المستودع، فلم يُرسل أي طلب.");
  say("- المفتاح مجاني ويُنشأ من حساب على steamgriddb.com؛ بدونه لا يمكن تجربة المصدر.");
} else {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(
      "https://www.steamgriddb.com/api/v2/search/autocomplete/" + encodeURIComponent("Celeste"),
      { headers: { authorization: `Bearer ${sgdbKey}`, "user-agent": UA }, signal: ctl.signal },
    );
    const body = await res.text();
    say(`- المفتاح موجود. طلب تجريبي واحد: HTTP **${res.status}**`);
    if (res.ok) {
      let rows = [];
      try {
        rows = JSON.parse(body)?.data ?? [];
      } catch {
        rows = [];
      }
      say(`- صفوف أعادها البحث عن «Celeste»: **${rows.length}**`);
      if (rows[0]) say(`  - أول صف: ${JSON.stringify(rows[0]).slice(0, 200)}`);
    } else {
      say(`- الرد: ${body.slice(0, 160)}`);
    }
  } catch (err) {
    say(`- فشل الطلب: ${String(err?.message ?? err).slice(0, 120)}`);
  } finally {
    clearTimeout(timer);
  }
}
say();

/*
  LAST IN THE LOG, deliberately. A job log is read as a tail and the upload
  step prints thirty lines of its own after this finishes, so the numbers that
  decide which source to build have to be the last thing written.
*/
say("## الخلاصة");
say();
say(`- بلا صورة مربعة: **${missing.length}**`);
say(`- منها يحمل صورة مربعة في سجلّه أصلًا (المصدر الجديد): **${counts.sheetSquare}**`);
say(`- منها يحمل \`nsuid\` (يفتح نينتندو اليابان وهونغ كونغ بهوية مؤكدة): **${counts.nsuid}**`);
say(`- منها يحمل \`productCode\` (يفتح بحث اليابان بالـ icode): **${counts.productCode}**`);
say(`- منها يحمل اسمًا إنجليزيًا فقط (يحتاج مصدرًا يبحث بالاسم): **${counts.titleEn}**`);

rmSync(outfile, { force: true });
flush();
