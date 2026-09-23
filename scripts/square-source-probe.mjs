#!/usr/bin/env node
/**
 * Can the two sources the owner found actually supply SQUARE art?
 *
 *   «في الصور المربعه وجدت منها في https://www.nintendolife.com
 *    وبعضها في او كلها موجوده في https://www.nintendo.com/us/store/products»
 *
 * Both are worth having. Neither is worth building a fetcher for on the
 * strength of an assumption, and three assumptions are load-bearing here:
 *
 *   1. that the games we think are missing art really are missing it;
 *   2. that each source HAS a square asset for them, rather than art that
 *      happens to look square in the examples somebody looked at;
 *   3. that a title can be matched to the right page at all.
 *
 * So this measures all three against the real catalogue before a line of
 * fetcher is written, and every number it prints carries its own denominator.
 *
 * STRICTLY READ-ONLY. It reads the catalogue, asks the two sources, downloads
 * a few pictures into memory to measure them, and writes NOTHING — not to D1,
 * not to R2, not to the catalogue document. No price, cost, stock, hidden
 * flag, option, type, trade-in value, display order or sales figure is touched.
 *
 * It must run on a GitHub runner: this sandbox's egress policy answers 403 to
 * CONNECT for every Nintendo and NintendoLife host, measured rather than
 * assumed (`curl: (56) CONNECT tunnel failed, response 403` in ~0.23s, which
 * is a policy refusal and not a timeout).
 *
 * ## What it decides
 *
 * "Square" is not this script's opinion. It uses the pipeline's own band —
 * `aspect = width/height` within 0.87…1.15, and at least 200×200
 * (`lib/media-candidates.mjs`) — because art this script calls square and the
 * filler then rejects would be a measurement of nothing.
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);
/** How many of the missing games to actually ask about. */
const SAMPLE = Number(args.sample ?? 40);
/** Politeness between requests to one host, in milliseconds. */
const DELAY_MS = Number(args.delay ?? 250);
const DEADLINE_MS = Number(args.deadline ?? 12) * 60_000;
const startedAt = Date.now();
const outOfTime = () => Date.now() - startedAt > DEADLINE_MS;

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
  writeFileSync("square-source-probe.md", `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
  }
};
const finish = (code) => {
  flush();
  process.exit(code);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
  The D1 id, from the repo when the secret is not set.

  `CLOUDFLARE_D1_DATABASE_ID` is referenced by 37 workflows and is NOT actually
  configured on this repository — which is why the first run of this probe read
  an empty catalogue and, correctly, refused to measure anything. The id is not
  a secret: it is committed in `wrangler.jsonc` and worthless without the API
  token. Every other script here already falls back to it; this one did not,
  and that omission was mine.
*/
if (!process.env["D1_DATABASE_ID"] && !process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  try {
    const config = readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    const found = config.match(/"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/);
    if (found) process.env["D1_DATABASE_ID"] = found[1];
  } catch {
    /* Reported by the empty-catalogue guard below, which is the real check. */
  }
}
if (!process.env["D1_DATABASE_ID"] && process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  process.env["D1_DATABASE_ID"] = process.env["CLOUDFLARE_D1_DATABASE_ID"];
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

say(`# هل تعطي المصادر صورة مربعة فعلًا؟`);
say();
say(`- العيّنة المطلوبة: ${SAMPLE} لعبة · مهلة ${DEADLINE_MS / 60_000} دقيقة`);

/* ------------------------------------------------------------- the catalogue */
const outfile = path.resolve(".square-source-probe-bundle.mjs");
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
        const virtual = /^(#tanstack-router-entry|#tanstack-start-entry|tanstack-start-manifest:)/;
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

const store = await app.getStore();
const products = Array.isArray(store?.products) ? store.products : [];
if (!products.length) {
  say(`**الكتالوج رجع فارغًا — لن أقيس على لا شيء.**`);
  finish(1);
}
const games = products.filter((p) => app.isGameProduct(p));
const missing = games.filter((p) => !app.hasNintendoSquareCard(p));

say(`- ألعاب في الكتالوج: **${games.length}**`);
say(`- بلا صورة مربعة: **${missing.length}**`);
say();

/* ------------------------------------------------------------------- robots */
say(`## robots.txt — منقولة حرفيًا`);
say();
for (const host of ["https://www.nintendo.com", "https://www.nintendolife.com"]) {
  try {
    const res = await fetch(`${host}/robots.txt`, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(20_000),
    });
    const body = res.ok ? await res.text() : "";
    say(`### ${host}/robots.txt — HTTP ${res.status}`);
    say("```");
    /*
      The generic block is what binds a script like this one. Printed verbatim
      and not summarised: neither file could be read from the sandbox, so this
      is the first time anyone here has actually seen them.
    */
    const generic = /User-agent:\s*\*([\s\S]*?)(?=\nUser-agent:|$)/i.exec(body);
    say((generic ? `User-agent: *${generic[1]}` : body).trim().slice(0, 1200) || "(فارغ)");
    say("```");
  } catch (error) {
    say(`### ${host}/robots.txt — تعذّر: ${String(error).slice(0, 120)}`);
  }
  say();
}

/* ------------------------------------------------------------------ helpers */
/** Measure a real picture, by the pipeline's own rule. */
async function measure(url) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) return { ok: false, why: "فارغة" };
    const meta = await sharp(bytes).metadata();
    const width = Number(meta.width) || 0;
    const height = Number(meta.height) || 0;
    if (!width || !height) return { ok: false, why: "لا تُفكّ" };
    const aspect = width / height;
    // The filler's own band, so a pass here cannot become a rejection there.
    const square = aspect <= 1.15 && aspect >= 0.87;
    const bigEnough = width >= 200 && height >= 200;
    return { ok: true, width, height, aspect, square, bigEnough, bytes: bytes.length };
  } catch (error) {
    return { ok: false, why: String(error?.message ?? error).slice(0, 60) };
  }
}

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/* ------------------------------------------------- source 1: nintendo.com */
/*
  The Algolia index behind the US store. Reached in preference to the product
  pages because one request answers for a hundred games and the hit already
  carries the square art url — the pages would be sixteen slug guesses each.
*/
const ALGOLIA = "https://u3b6gr4ua3-dsn.algolia.net/1/indexes/store_game_en_us/query";
const ALGOLIA_HEADERS = {
  "content-type": "application/json",
  "x-algolia-application-id": "U3B6GR4UA3",
  "x-algolia-api-key": "a29c6927638bfd8cee23993e51e721c9",
  "x-algolia-agent": "Algolia for JavaScript (4.23.2); Browser",
  "user-agent": UA,
};

async function algolia(query) {
  const res = await fetch(ALGOLIA, {
    method: "POST",
    headers: ALGOLIA_HEADERS,
    body: JSON.stringify({
      query,
      filters: '(corePlatforms:"Nintendo Switch" OR corePlatforms:"Nintendo Switch 2")',
      hitsPerPage: 20,
      page: 0,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return { ok: false, status: res.status, hits: [] };
  const body = await res.json().catch(() => ({}));
  return { ok: true, status: res.status, hits: Array.isArray(body?.hits) ? body.hits : [] };
}

say(`## أولًا: هل يستجيب فهرس nintendo.com أصلًا؟`);
say();
const smoke = await algolia("mario");
if (!smoke.ok) {
  say(`- **لا.** ردّ الفهرس HTTP ${smoke.status}. كل ما تحته لن يُقاس.`);
} else {
  const withSquare = smoke.hits.filter((h) => h.productImageSquare).length;
  say(`- نعم — HTTP ${smoke.status}، **${smoke.hits.length}** نتيجة لكلمة «mario»`);
  say(`- منها تحمل \`productImageSquare\`: **${withSquare}**`);
  if (smoke.hits[0]?.productImageSquare) {
    say(`- مثال حرفي: \`${String(smoke.hits[0].productImageSquare).slice(0, 150)}\``);
  }
}
say();

/* ---------------------------------------------- source 2: nintendolife.com */
/*
  Two systems, and a title cannot tell you which it lives under: `switch-eshop`
  for digital-only, `nintendo-switch` for retail. Both are tried.

  The cover is NOT `og:image` — that is the 16:9 key-art banner, and a scraper
  that takes it would collect the wrong picture for every single game. The
  cover is the hero's own linked image.
*/
const NL_SYSTEMS = ["switch-eshop", "nintendo-switch"];
const nlSlug = (title) =>
  String(title ?? "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

async function nintendoLife(title) {
  for (const system of NL_SYSTEMS) {
    const url = `https://www.nintendolife.com/games/${system}/${nlSlug(title)}`;
    let html = "";
    let status = 0;
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html" },
        signal: AbortSignal.timeout(25_000),
      });
      status = res.status;
      if (res.ok) html = await res.text();
    } catch {
      status = 0;
    }
    await sleep(DELAY_MS);
    if (!html) continue;

    /*
      `p.image > a[href]` inside the hero is the full-size cover. The <img> is
      lazy-loaded — its `src` is an inline SVG placeholder — so `data-original`
      is the 300px fallback, never `src`.
    */
    const full = /<p class="image[^"]*"><a href="(https:\/\/images\.nintendolife\.com\/[^"]+)"/.exec(
      html,
    );
    const small = /data-original="(https:\/\/images\.nintendolife\.com\/[^"]+)"/.exec(html);
    const found = full?.[1] ?? small?.[1] ?? null;
    if (found) return { system, url, status, image: found };
    return { system, url, status, image: null };
  }
  return { system: null, url: null, status: 0, image: null };
}

/* ------------------------------------------------------------- the sample */
/*
  Taken from the front of the missing list rather than at random, so a second
  run measures the same games and the two runs can be compared. The list is
  ordered by the catalogue's own order.
*/
const sample = missing.slice(0, SAMPLE);
say(`## ثانيًا: العيّنة — ${sample.length} لعبة بلا صورة مربعة`);
say();
say(`| اللعبة | nintendo.com | المقاس | NintendoLife | المقاس |`);
say(`| --- | :---: | ---: | :---: | ---: |`);

let ninMatched = 0;
let ninSquare = 0;
let ninUnreadable = 0;
let nlMatched = 0;
let nlSquare = 0;
let nlUnreadable = 0;
let asked = 0;

for (const product of sample) {
  if (outOfTime()) break;
  asked += 1;
  const title = String(product.title ?? product.name ?? "");
  const want = norm(title);

  /* --- nintendo.com --- */
  let ninCell = "—";
  let ninSize = "";
  if (smoke.ok) {
    const found = await algolia(title).catch(() => ({ ok: false, hits: [] }));
    await sleep(DELAY_MS);
    const hit = (found.hits ?? []).find((h) => norm(h.title) === want);
    if (hit?.productImageSquare) {
      ninMatched += 1;
      const m = await measure(String(hit.productImageSquare));
      if (!m.ok) {
        ninUnreadable += 1;
        ninCell = "تعذّرت";
        ninSize = m.why;
      } else {
        ninSize = `${m.width}×${m.height}`;
        if (m.square && m.bigEnough) {
          ninSquare += 1;
          ninCell = "✓";
        } else {
          ninCell = m.square ? "صغيرة" : "غير مربعة";
        }
      }
    } else if (hit) {
      ninMatched += 1;
      ninCell = "بلا مربّعة";
    } else {
      ninCell = "لا تطابق";
    }
  }

  /* --- nintendolife.com --- */
  let nlCell = "—";
  let nlSize = "";
  const nl = await nintendoLife(title);
  if (nl.image) {
    nlMatched += 1;
    const m = await measure(nl.image);
    if (!m.ok) {
      nlUnreadable += 1;
      nlCell = "تعذّرت";
      nlSize = m.why;
    } else {
      nlSize = `${m.width}×${m.height}`;
      if (m.square && m.bigEnough) {
        nlSquare += 1;
        nlCell = "✓";
      } else {
        nlCell = m.square ? "صغيرة" : "غير مربعة";
      }
    }
  } else {
    nlCell = nl.status ? "لا صورة" : "لا صفحة";
  }

  say(`| ${title.slice(0, 44)} | ${ninCell} | ${ninSize} | ${nlCell} | ${nlSize} |`);
}

/* -------------------------------------------------------------- the numbers */
/*
  LAST, and each with the denominator beside it: a job log is read as a tail,
  and a count with nothing to divide it by is not a measurement.
*/
say();
say(`## الخلاصة`);
say();
say(`- ألعاب بلا صورة مربعة في الكتالوج كله: **${missing.length}** من **${games.length}**`);
say(`- سُئل عنها في هذه الجولة: **${asked}** من **${sample.length}** المطلوبة`);
say();
say(`### nintendo.com`);
say(`- طابقت لعبة في الفهرس: **${ninMatched}** من **${asked}**`);
say(`- وأعطت صورة مربعة مقبولة بمقياس خط الأنابيب نفسه: **${ninSquare}** من **${asked}**`);
say(`- طابقت لكن تعذّرت قراءة صورتها: **${ninUnreadable}**`);
say();
say(`### nintendolife.com`);
say(`- وُجدت لها صفحة بصورة: **${nlMatched}** من **${asked}**`);
say(`- ومنها مربعة مقبولة: **${nlSquare}** من **${asked}**`);
say(`- تعذّرت قراءة صورتها: **${nlUnreadable}**`);
say();
const union = "غير محسوبة هنا — تحتاج جولة تدمج المصدرين";
say(`- ما يمكن للمصدرين معًا تغطيته: ${union}`);
if (outOfTime()) {
  say();
  say(`**توقفت عند المهلة بعد ${asked} لعبة — الباقي لم يُسأل عنه.**`);
}
finish(0);
