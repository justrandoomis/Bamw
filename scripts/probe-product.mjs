#!/usr/bin/env node
/**
 * Why will one product not take a new price?
 *
 * A hundred and four of a hundred and five prices were written and read back
 * from D1. `prd_34be2de35cbe4d6b` — Mario Kart World [Switch 2] — came back at
 * its old price on three consecutive runs, so this is not a lost race with
 * another writer; something about this record refuses the write, every time.
 *
 * Reading the code found nothing: `isValidProductRecord` is lenient enough to
 * pass it, `normalizeProductRecord` copies `price` straight through, and
 * `normalizeProductCompareAtPrices` does not touch `price` at all. So this
 * stops reading and asks the database.
 *
 * It does exactly one write, of one field, on one product, and only when
 * `--write` is passed. Everything else is a read.
 */
import { build } from "esbuild";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .matchAll(/--([\w-]+)(?:[= ]([^\s-][^\s]*))?/g)
    .map((m) => [m[1], m[2] ?? "true"]),
);
const ID = args.id && args.id !== "true" ? String(args.id) : "prd_34be2de35cbe4d6b";
const WRITE = args.write === "true";
const NEW_PRICE = Number(args.price ?? 12000);

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};

if (!process.env["D1_DATABASE_ID"] && !process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  try {
    const config = readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    const found = config.match(/"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/);
    if (found) process.env["D1_DATABASE_ID"] = found[1];
  } catch {
    /* Reported by the reachability check below. */
  }
}
if (!process.env["D1_DATABASE_ID"] && process.env["CLOUDFLARE_D1_DATABASE_ID"]) {
  process.env["D1_DATABASE_ID"] = process.env["CLOUDFLARE_D1_DATABASE_ID"];
}

const outfile = path.resolve(".probe-bundle.mjs");
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

const fresh = async () => {
  app.invalidateStoreCache();
  const store = await app.getStore();
  return Array.isArray(store?.products) ? store.products : [];
};

say(`# ${ID}`);
say();

let products = await fresh();
say(`الكتالوج: **${products.length}** منتج.`);
say();

const byId = products.filter((p) => String(p?.["id"] ?? "") === ID);
say(`## كم منتجًا يحمل هذا المعرّف؟ **${byId.length}**`);
say();
if (byId.length !== 1) {
  say("**هذا هو السبب المرشّح: معرّف مكرّر.**");
  say();
}

for (const [index, product] of byId.entries()) {
  say(`### النسخة ${index + 1}`);
  say();
  say("| حقل | قيمة |");
  say("|---|---|");
  for (const key of [
    "id",
    "title",
    "titleEn",
    "slug",
    "price",
    "basePrice",
    "originalPrice",
    "cost",
    "kind",
    "schemaId",
    "status",
    "isHidden",
    "stock",
    "platform",
    "updatedAt",
  ]) {
    const value = product[key];
    if (value === undefined) continue;
    say(`| \`${key}\` | \`${JSON.stringify(value)}\` |`);
  }
  const optionish = ["options", "types", "variants", "editions", "dlcs"].filter(
    (key) => Array.isArray(product[key]) && product[key].length,
  );
  say(`| صفوف بأسعار | \`${optionish.join(", ") || "لا شيء"}\` |`);
  for (const key of optionish) {
    for (const row of product[key]) {
      if (row && typeof row === "object" && "price" in row) {
        say(`| \`${key}[].price\` | \`${JSON.stringify(row["price"])}\` (${row["name"] ?? ""}) |`);
      }
    }
  }
  say(`| \`isValidProductRecord\` | **${app.isValidProductRecord(product)}** |`);
  try {
    const normalized = app.normalizeProductRecord({ ...product, price: NEW_PRICE });
    say(`| السعر بعد التطبيع لو كُتب ${NEW_PRICE} | **${normalized.price}** |`);
  } catch (error) {
    say(`| التطبيع | فشل: ${String(error).split("\n")[0]} |`);
  }
  say();
}

/* Anything else calling itself the same game, under another id. */
const sameTitle = products.filter(
  (p) =>
    String(p?.["id"] ?? "") !== ID &&
    /mario\s*kart\s*world/i.test(String(p?.["title"] ?? p?.["titleEn"] ?? "")),
);
if (sameTitle.length) {
  say(`## منتجات أخرى بنفس الاسم: **${sameTitle.length}**`);
  say();
  for (const p of sameTitle) {
    say(`- \`${p["id"]}\` — ${p["title"]} — سعر ${p["price"]}، تكلفة ${p["cost"]}`);
  }
  say();
}

if (WRITE) {
  say(`## كتابة ${NEW_PRICE} ثم قراءة من قاعدة البيانات`);
  say();
  const before = byId[0]?.["price"];
  let touched = 0;
  await app.updateStore((current) => {
    touched = 0;
    const list = Array.isArray(current?.products) ? current.products : [];
    const next = list.map((item) => {
      if (String(item?.["id"] ?? "") !== ID) return item;
      touched += 1;
      return { ...item, price: NEW_PRICE };
    });
    return { ...current, products: next };
  });
  say(`- صفوف لمسها التعديل داخل \`updateStore\`: **${touched}**`);

  products = await fresh();
  const after = products.filter((p) => String(p?.["id"] ?? "") === ID);
  say(`- نسخ المنتج بعد الكتابة: **${after.length}**`);
  for (const [index, p] of after.entries()) {
    say(`- النسخة ${index + 1}: السعر **${p["price"]}** (كان ${before})`);
  }
  say();
  say(
    after.every((p) => Number(p["price"]) === NEW_PRICE)
      ? "**الكتابة ثبتت.**"
      : "**الكتابة لم تثبت — السعر عاد كما كان.**",
  );
  say();

  /*
    What is actually IN the database, byte for byte.

    `updateStore` patched one row, threw nothing, and a fresh read returned the
    old price. Everything above this point is the application talking to
    itself; these are the rows. The catalogue is stored as JSON split across
    `store:products` and `store:products#NNN`, so the question is simply which
    chunks mention this id and what price sits beside it in each.

    A single id in two chunks would explain all of it: the loader returns one
    copy, the mutator patches that one, and the reader keeps finding the other.
  */
  /*
    The other place a product can live.

    `loadStore` reads the chunked catalogue AND any `store:product:<id>` rows,
    and its own comment says which wins: "Deduplicate: granular products
    overwrite chunked products". `persistStore` writes only the chunks. So a
    product that has a granular row is frozen at whatever that row says, and
    no amount of writing the catalogue will move it — the write lands, the
    read overlays it, and the run reports a success.

    This counts them: for this product, and for the shop.
  */
  say("## الصفوف الفردية `store:product:<id>`");
  say();
  const granularAll = await app.d1All(
    "SELECT count(*) AS n FROM store_kv WHERE key LIKE 'store:product:%'",
  );
  say(
    `- صفوف فردية في المتجر كله: **${Number(granularAll?.[0]?.n ?? 0).toLocaleString("en-US")}**`,
  );
  const mine = await app.d1All(
    "SELECT value FROM store_kv WHERE key = ? LIMIT 1",
    `store:product:${ID}`,
  );
  if (!mine.length) {
    say("- لهذا المنتج: **لا يوجد**");
  } else {
    let parsedRow = null;
    try {
      parsedRow = JSON.parse(String(mine[0].value));
    } catch (error) {
      say(`- لهذا المنتج: صفّ موجود لكنه لا يُحلَّل — ${String(error).split("\n")[0]}`);
    }
    if (parsedRow) {
      say(
        `- لهذا المنتج: **موجود**، \`price\` = **${JSON.stringify(parsedRow.price)}**، ` +
          `\`accountPrice\` = ${JSON.stringify(parsedRow.accountPrice)}، ` +
          `\`_deleted\` = ${JSON.stringify(parsedRow._deleted)}`,
      );
      say();
      say(
        Number(parsedRow.price) === NEW_PRICE
          ? "**الصفّ الفردي محدَّث أيضًا.**"
          : "**هذا هو السبب: الصفّ الفردي يحمل السعر القديم، والقارئ يُقدّمه على الأجزاء.**",
      );
    }
  }
  say();

  say("## الصفوف الخام في `store_kv`");
  say();
  const rows = await app.d1All(
    "SELECT key, length(value) AS n FROM store_kv WHERE key LIKE 'store:products%' ORDER BY key",
  );
  say(`- أجزاء الكتالوج المخزّنة: **${rows.length}**`);
  for (const row of rows)
    say(`  - \`${row.key}\` — ${Number(row.n).toLocaleString("en-US")} حرفًا`);
  say();

  /*
    Does the stored catalogue parse at all?

    `chunkJson` slices the serialised JSON at fixed 400,000-character offsets,
    and `loadStore` sorts the parts, joins them and parses. If that parse
    fails it does NOT fail the read — it falls through to `parseArraySafely`,
    a scanner that salvages the items it can recognise and silently drops the
    rest, behind a `console.warn` nobody reads.

    That is a mechanism which could leave exactly one product stale or mangled
    while every other product is fine, which is precisely the shape of this
    fault. So: join the chunks the way the loader does, parse them the way the
    loader tries to first, and say whether it works.
  */
  say("## هل يُقرأ المستند المخزّن أصلاً؟");
  say();
  const parts = [];
  for (const row of rows) {
    const m = String(row.key).match(/^store:products#(\d+)$/);
    if (!m) continue;
    const full = await app.d1All("SELECT value FROM store_kv WHERE key = ? LIMIT 1", row.key);
    parts.push({ index: Number(m[1]), value: String(full?.[0]?.value ?? "") });
  }
  parts.sort((a, b) => a.index - b.index);
  const joined = parts.map((p) => p.value).join("");
  say(`- الطول المجموع: **${joined.length.toLocaleString("en-US")}** حرفًا`);

  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(joined);
  } catch (error) {
    parseError = String(error).split("\n")[0];
  }
  if (parseError) {
    say(`- \`JSON.parse\` على الأجزاء المدموجة: **فشل** — \`${parseError}\``);
    say();
    say(
      "**هذا هو الجواب: المستند المخزّن ليس JSON صالحًا، والقارئ يعمل على مسار " +
        "الإنقاذ الصامت. كل كتابة تمرّ من هنا تُعيد كتابة ما أنقذه القارئ، لا ما في " +
        "قاعدة البيانات.**",
    );
  } else if (!Array.isArray(parsed)) {
    say(`- \`JSON.parse\` نجح لكن الناتج ليس مصفوفة: \`${typeof parsed}\``);
  } else {
    say(`- \`JSON.parse\` نجح: **${parsed.length.toLocaleString("en-US")}** منتجًا في المستند`);
    const stored = parsed.filter((p) => String(p?.id ?? "") === ID);
    say(`- نسخ هذا المنتج داخل المستند المخزّن: **${stored.length}**`);
    for (const [index, p] of stored.entries()) {
      say(
        `  - النسخة ${index + 1}: \`price\` = **${JSON.stringify(p.price)}**، ` +
          `\`cost\` = ${JSON.stringify(p.cost)}`,
      );
    }
    if (stored.some((p) => Number(p.price) === NEW_PRICE)) {
      say();
      say("**قاعدة البيانات تحمل السعر الجديد. إذن الكتابة وصلت، والخلل في القراءة.**");
    } else {
      say();
      say("**قاعدة البيانات ما زالت تحمل السعر القديم. إذن الكتابة لم تصل.**");
    }
  }
  say();

  let hits = 0;
  for (const row of rows) {
    const full = await app.d1All("SELECT value FROM store_kv WHERE key = ? LIMIT 1", row.key);
    const value = String(full?.[0]?.value ?? "");
    if (!value.includes(ID)) continue;
    hits += 1;
    /*
      Print only this product's own fragment, and only its pricing fields. The
      chunk holds the whole catalogue including supplier data, and none of that
      belongs in a log.
    */
    let from = 0;
    let seen = 0;
    while (true) {
      const at = value.indexOf(ID, from);
      if (at < 0) break;
      seen += 1;
      // A product record runs to thousands of characters, so a small window
      // finds a mention without its price. Widened, and read as evidence of
      // WHERE the id appears rather than what it is priced at.
      const window = value.slice(Math.max(0, at - 400), at + 4000);
      const price = window.match(/"price"\s*:\s*("?[\d.]+"?)/);
      const cost = window.match(/"cost"\s*:\s*("?[\d.]+"?)/);
      say(
        `- \`${row.key}\` ذكر رقم ${seen}: \`price\` = \`${price?.[1] ?? "—"}\`، ` +
          `\`cost\` = \`${cost?.[1] ?? "—"}\``,
      );
      from = at + ID.length;
    }
  }
  say();
  say(
    hits === 1
      ? "المعرّف موجود في جزء واحد فقط."
      : `**المعرّف موجود في ${hits} أجزاء — وهذا يفسّر كتابةً تُلمَس وقراءةً تخالفها.**`,
  );
}

rmSync(outfile, { force: true });
if (process.env.GITHUB_STEP_SUMMARY) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), { flag: "a" });
}
