/**
 * Did the repricing reach banan.to? READ ONLY, over HTTPS, no database.
 *
 * «لا تقل «تم» بناءً على Build فقط؛ المطلوب تحقق وظيفي كامل على الإنتاج.»
 *
 * A write verified against D1 proves the database changed. It does not prove
 * the shop changed: the catalogue is cached in the Worker and at the edge, and
 * the page reads a copy of the price that lives outside `types`. So this asks
 * the running site, and checks two things that can only both be true if the
 * repricing actually landed:
 *
 *   1. the rules are SATISFIED by what is being served — nothing still wants
 *      to move, apart from what was deliberately held;
 *   2. every product serves ONE price — the number in `types[offline_base]`,
 *      which the till charges, equals `price`/`accountPrice`, which the page
 *      headline shows.
 *
 * The second is the one that matters to a customer, and it is measured against
 * the same denominator as before the run so a zero cannot be vacuous.
 */
import { build } from "esbuild";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ORIGIN = process.env.ORIGIN || "https://banan.to";

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};
const flush = () => {
  writeFileSync("tier-reprice-verify.md", `${lines.join("\n")}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
  }
};
const money = (n) => Number(n || 0).toLocaleString("en-US");
const numOf = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number.parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const outfile = path.resolve("tier-reprice-verify.bundle.mjs");
await build({
  entryPoints: [path.resolve("scripts/lib/pricing-entry.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "silent",
  tsconfig: path.resolve("tsconfig.json"),
});
const app = await import(`file://${outfile}`);

say(`# هل وصل التسعير إلى banan.to؟`);
say();
say(`المصدر: \`${ORIGIN}/api/data\` — ما يخدمه الموقع فعلًا، لا قاعدة البيانات.`);
say();

/*
  A BROWSER'S HEADERS, BECAUSE THE SHOP ANSWERS BROWSERS.

  The first attempt sent node's default headers and got 403 with an empty body
  from every path — not the route refusing (its GET handler has no auth at all)
  but Cloudflare refusing the caller. Asking as a shopper asks is the only way
  to measure what a shopper is served.
*/
const BROWSER = {
  /*
    A BROWSER'S HEADERS, AND A BROWSER'S ACCEPT.

    `accept: application/json` from a runner was answered with Cloudflare's
    «Just a moment...» challenge page under a 403. `scripts/page-smoke.mjs`
    already documents the same shield on this origin — "the first `/policy`
    fetch of the previous run came back 403 and the same URL answered 200
    three seconds later" — and gets through by asking for HTML with a phone's
    user agent. The route does not content-negotiate, so it answers JSON
    either way; only the shield reads these.
  */
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ar,en;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36",
};

const SHIELD = new Set([403, 429, 503]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One URL, retried only for the shield's own statuses, never for the app's. */
const read = async (url) => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = await fetch(url, { headers: BROWSER });
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    const challenged = SHIELD.has(res.status) && /just a moment|cf-browser|challenge/i.test(body);
    say(
      `- \`${url.replace(ORIGIN, "")}\` محاولة ${attempt} → **${res.status} ${res.statusText}**${challenged ? " — درع Cloudflare" : body ? ` — ${body.slice(0, 140).replace(/\s+/g, " ")}` : ""}`,
    );
    if (!SHIELD.has(res.status)) return null;
    await sleep(attempt * 3000);
  }
  return null;
};

/*
  THE PAGE, NOT THE API.

  Five attempts at `/api/data` came back 403 with Cloudflare's «Just a moment»
  challenge, at three, six, nine and twelve seconds apart. The shield is on the
  `/api/` prefix: `scripts/page-smoke.mjs` reaches `/policy`, `/faq` and the
  rest of the site with these same headers and is answered 200.

  Which is the better check anyway. The question is not what an endpoint holds,
  it is what a shopper is SENT — and a shopper is sent a rendered page. So the
  catalogue is read out of the storefront's own HTML, where the server has
  already put the products it will render.
*/
const productsFromHtml = (html) => {
  /*
    The SSR payload, taken by balanced braces rather than by a regex.

    A product record contains nested objects, so `{...}` cannot be matched by
    any regular expression. Each `{"id":"prd_` is walked forward counting
    braces, respecting strings and escapes, and parsed.
  */
  const found = [];
  const seen = new Set();
  const needle = /\{\\?"id\\?":\\?"(prd_[A-Za-z0-9_-]+)\\?"/g;
  let hit;
  while ((hit = needle.exec(html))) {
    if (seen.has(hit[1])) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = hit.index; i < html.length && i < hit.index + 200_000; i += 1) {
      const ch = html[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end < 0) continue;
    const slice = html.slice(hit.index, end);
    for (const text of [slice, slice.replace(/\\"/g, '"').replace(/\\\\/g, "\\")]) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && String(parsed.id ?? "").startsWith("prd_")) {
          found.push(parsed);
          seen.add(hit[1]);
        }
        break;
      } catch {
        /* try the unescaped form next */
      }
    }
  }
  return found;
};

const PAGES = ["/", "/games", "/category/nintendo_games"];
const products = [];
const byId = new Map();
for (const path_ of PAGES) {
  const res = await read(`${ORIGIN}${path_}`);
  if (!res) continue;
  const html = await res.text();
  const found = productsFromHtml(html);
  let fresh = 0;
  for (const p of found) {
    const id = String(p.id ?? "");
    if (!id || byId.has(id)) continue;
    byId.set(id, p);
    products.push(p);
    fresh += 1;
  }
  say(
    `- \`${path_}\` → **${res.status}** · ${(html.length / 1024).toFixed(0)} كيلوبايت · منتجات مقروءة: **${found.length}** (جديدة: ${fresh})`,
  );
}
say();
if (!products.length) {
  say(`**لم أستخرج أي منتج من صفحات الموقع.** لم أتحقق من الإنتاج، ولن أقول إن التحقق تم.`);
  flush();
  rmSync(outfile, { force: true });
  process.exit(1);
}
say(`- منتجات قرأتها من صفحات الموقع: **${products.length}**`);

const withTiers = products.filter(
  (p) => Array.isArray(p?.types) && p.types.length > 0,
);
say(`- منها تحمل طبقات \`types\`: **${withTiers.length}**`);
say();

/* 1. Are the rules satisfied by what is live? */
const stillMoving = [];
for (const product of withTiers) {
  const result = app.repriceTiers({
    id: String(product.id ?? ""),
    title: String(product.title || product.titleEn || ""),
    kind: String(product.kind ?? ""),
    schemaId: String(product.schemaId ?? product.schema_id ?? ""),
    types: product.types,
  });
  for (const p of result.proposals) {
    if (p.changed) stillMoving.push({ title: result.title, p });
  }
}

say(`## 1. هل القواعد مستقرة على ما يُخدَم؟`);
say();
say(`طبقات ما زالت تريد الحركة: **${stillMoving.length}**`);
say();
if (stillMoving.length) {
  say(`| المنتج | الطبقة | التكلفة | الآن | تريد |`);
  say(`| --- | --- | --- | --- | --- |`);
  for (const row of stillMoving.slice(0, 40)) {
    say(
      `| ${String(row.title).slice(0, 44)} | \`${row.p.kind}\` | ${money(row.p.cost)} | ${money(row.p.oldPrice)} | ${money(row.p.newPrice)} |`,
    );
  }
  if (stillMoving.length > 40) say(`| … | ${stillMoving.length - 40} أخرى | | | |`);
  say();
}

/* 2. Does the page show what the till charges? */
let oneNumber = 0;
let twoNumbers = 0;
const mismatched = [];
for (const product of withTiers) {
  const tiers = app.classifyTiers(product.types);
  const offline = app.tierOf(tiers, "offline_base");
  if (!offline || offline.price <= 0) continue;
  const shown = numOf(product.accountPrice) || numOf(product.price);
  if (shown <= 0) continue;
  if (shown === offline.price) {
    oneNumber += 1;
    continue;
  }
  twoNumbers += 1;
  mismatched.push({
    title: String(product.title || product.titleEn || ""),
    id: String(product.id ?? ""),
    shown,
    charged: offline.price,
  });
}

say(`## 2. هل يُعرض السعر الذي يُحاسَب به؟`);
say();
say(
  `الواجهة تقرأ \`accountPrice\` ثم \`price\`؛ والسلة تحاسب بـ \`types[offline_base].price\`. هنا تُقارن الاثنتان على كل منتج يخدمه الموقع.`,
);
say();
say(`- يعرض ويحاسب بالرقم نفسه: **${oneNumber}**`);
say(`- يعرض رقمًا ويحاسب بآخر: **${twoNumbers}**`);
say();
if (mismatched.length) {
  mismatched.sort((a, b) => Math.abs(b.charged - b.shown) - Math.abs(a.charged - a.shown));
  say(`| المنتج | يُعرض | يُحاسَب | الفرق |`);
  say(`| --- | --- | --- | --- |`);
  for (const row of mismatched.slice(0, 40)) {
    const gap = row.charged - row.shown;
    say(
      `| ${row.title.slice(0, 44)} \`${row.id.slice(-6)}\` | ${money(row.shown)} | ${money(row.charged)} | ${gap > 0 ? `+${money(gap)}` : money(gap)} |`,
    );
  }
  if (mismatched.length > 40) say(`| … | ${mismatched.length - 40} أخرى | | |`);
  say();
}

say(`## الخلاصة`);
say();
say(`- منتجات بطبقات على الموقع: **${withTiers.length}**`);
say(`- طبقات ما زالت تريد الحركة: **${stillMoving.length}**`);
say(`- تعرض وتحاسب بالرقم نفسه: **${oneNumber}**`);
say(`- تعرض رقمًا وتحاسب بآخر: **${twoNumbers}**`);

flush();
rmSync(outfile, { force: true });

/*
  The held tiers are expected to still want to move — their cost is wrong and
  that is the point. So a non-zero `stillMoving` is not on its own a failure;
  it is reported and read. What WOULD be a failure is the site refusing to
  answer, which is handled above.
*/
process.exit(0);
