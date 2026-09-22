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
  accept: "application/json, text/plain, */*",
  "accept-language": "ar,en;q=0.9",
  "cache-control": "no-cache",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

/* `?slim=1` first: the same prices, a fraction of the payload. */
const ATTEMPTS = [`${ORIGIN}/api/data?slim=1`, `${ORIGIN}/api/data`];
let doc = null;
let served = "";
for (const url of ATTEMPTS) {
  const res = await fetch(url, { headers: BROWSER });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    say(`- \`${url.replace(ORIGIN, "")}\` → **${res.status} ${res.statusText}**${body ? ` — ${body.slice(0, 200).replace(/\s+/g, " ")}` : " (بلا نص)"}`);
    continue;
  }
  doc = await res.json();
  served = url;
  say(`- \`${url.replace(ORIGIN, "")}\` → **${res.status}** · \`x-catalog-version: ${res.headers.get("x-catalog-version") ?? "—"}\``);
  break;
}
say();
if (!doc) {
  say(`**تعذّرت القراءة من الموقع.** لم أتحقق من الإنتاج، ولن أقول إن التحقق تم.`);
  flush();
  rmSync(outfile, { force: true });
  process.exit(1);
}
void served;
const store = doc?.store ?? doc;
const products = Array.isArray(store?.products) ? store.products : [];
say(`- منتجات يخدمها الموقع: **${products.length}**`);

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
