#!/usr/bin/env node
/**
 * Which picture each gift card actually shows, and which field decided it.
 * Read-only.
 *
 * The owner replaces a card's artwork in «صورة بطاقة الشحن (Card Artwork)» and
 * the home page goes on showing the old one. The editor writes `coverImage`
 * and `mainImage`; the home-page strip resolves its picture through the
 * `listing` chain, which reads `listingImage` **first**. So a card carrying a
 * `listingImage` from its original import can never be re-pictured from that
 * control, however many times it is uploaded.
 *
 * This asks the live catalogue which of those fields each card carries and
 * which one wins on each surface, so the fix is aimed at what is really there.
 *
 * URLs are truncated to their last segment: enough to tell two pictures apart,
 * not enough to turn the artifact into a copy of the media library.
 */

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const DB_NAME = "bananto";
const CONFIG = "wrangler.jsonc";

const WRANGLER =
  process.env.WRANGLER_BIN ||
  (existsSync("node_modules/.bin/wrangler") ? "node_modules/.bin/wrangler" : "wrangler");
const ENV = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" };

const MUTATING =
  /(^|[^_\w])(insert|update|delete|replace|upsert|alter|drop|attach|detach|vacuum|reindex|truncate)([^_\w]|$)/i;
function d1(sql) {
  if (!/^\s*select\b/i.test(sql) || MUTATING.test(sql) || sql.replace(/;\s*$/, "").includes(";")) {
    throw new Error(`REFUSED: ${sql.slice(0, 60)}`);
  }
  const raw = execFileSync(
    WRANGLER,
    ["d1", "execute", DB_NAME, "--remote", "--json", "--yes", "--config", CONFIG, "--command", sql],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: ENV, timeout: 120_000 },
  );
  const i = raw.search(/[[{]/);
  const parsed = JSON.parse(raw.slice(i));
  return (Array.isArray(parsed) ? parsed[0] : parsed)?.results ?? [];
}

const lines = [];
const say = (t = "") => {
  lines.push(t);
  console.log(t);
};

/* The catalogue is one JSON array split across numbered rows, not a row each. */
const keys = d1(
  "SELECT key FROM store_kv WHERE key = 'store:products' OR key LIKE 'store:products#%' ORDER BY key",
).map((row) => String(row.key));
const numbered = keys.filter((key) => /^store:products#\d+$/.test(key));
let raw = "";
for (const key of numbered.length ? numbered : ["store:products"]) {
  raw += d1(`SELECT value FROM store_kv WHERE key = '${key.replace(/'/g, "''")}'`)?.[0]?.value ?? "";
}
let products = [];
try {
  products = JSON.parse(raw);
} catch (error) {
  say(`_the catalogue would not parse: ${String(error).slice(0, 120)}_`);
}

const isCard = (p) => {
  const hay = `${p.category ?? ""} ${p.categoryId ?? ""} ${p.kind ?? ""}`.toLowerCase();
  return /gift|card|eshop|بطاق/.test(hay);
};

/** The field names each role reads, newest spelling first — as `productImages`. */
const FIELDS = {
  /*
    What the home page actually reads. `ProductStrip` does not use the `image`
    its caller computes — it renders `NintendoCover` with the default
    `front-box` role, and that role is `cartridgeImage` first. No gift-card
    admin control writes it.
  */
  frontBox: ["cartridgeImage", "cartridge_image", "front_image", "frontImage", "box_front_url", "boxFrontUrl", "front_box_cover"],
  listing: ["listingImage", "listing_image"],
  main: ["mainImage", "main_image"],
  front: ["frontImage", "front_image"],
  packagingFront: ["packagingFrontImage", "packaging_front_image"],
  cover: ["coverImage", "cover_image"],
  artwork: ["cardArtwork", "card_artwork"],
  banner: ["bannerImage", "banner_image"],
  thumbnail: ["thumbnailImage", "thumbnail_image"],
};

/** The chains, copied from `src/lib/productImages.ts`. */
const CHAINS = {
  "listing card (home page)": ["listing", "main", "front", "packagingFront"],
  "product hero": ["main", "front", "packagingFront", "listing"],
  "details background": ["cover", "banner", "main"],
};

const usable = (v) => typeof v === "string" && v.trim().length > 5 && !/^data:/i.test(v.trim());
const readRole = (p, role) => {
  for (const name of FIELDS[role]) if (usable(p[name])) return String(p[name]).trim();
  return null;
};
/** Enough of a URL to tell two pictures apart, and no more. */
const tail = (url) => (url ? String(url).split("/").pop().split("?")[0].slice(-34) : "—");

const cards = products.filter(isCard);
say("# Which picture each gift card shows, and which field decided it");
say();
say(`${cards.length} gift card(s) of ${products.length} products.`);
say();
say("## Fields present on each card");
say();
say("| card | cartridgeImage (home page) | listingImage | mainImage | coverImage |");
say("|---|---|---|---|---|");
for (const p of cards) {
  say(
    `| ${String(p.title ?? p.slug ?? p.id).slice(0, 30)} | ${tail(readRole(p, "frontBox"))} | ` +
      `${tail(readRole(p, "listing"))} | ${tail(readRole(p, "main"))} | ${tail(readRole(p, "cover"))} |`,
  );
}
say();

/*
  The blast radius of routing non-game products away from the box-art role.

  Every non-game product currently renders on the home page through
  `front-box` — `cartridgeImage` — and would render through the listing chain
  instead. This counts, per category, how many would change picture.
*/
const isGame = (p) => {
  const hay = `${p.category ?? ""} ${p.categoryId ?? ""} ${p.kind ?? ""}`.toLowerCase();
  if (/gift|card|eshop|بطاق/.test(hay)) return false;
  if (/amiibo|bundle|used|مستعمل|accessor|ملحق|hardware|device|console|جهاز|حزم/.test(hay)) return false;
  return true;
};
const categoryOf = (p) => {
  const hay = `${p.category ?? ""} ${p.categoryId ?? ""} ${p.kind ?? ""}`.toLowerCase();
  if (/gift|card|eshop|بطاق/.test(hay)) return "gift_card";
  if (/amiibo/.test(hay)) return "amiibo";
  if (/bundle|حزم/.test(hay)) return "bundle";
  if (/used|مستعمل/.test(hay)) return "used";
  if (/accessor|ملحق/.test(hay)) return "accessory";
  if (/hardware|device|console|جهاز/.test(hay)) return "hardware";
  return "game";
};
/** The gift-card listing chain as this change would define it. */
const listingChain = (p) =>
  categoryOf(p) === "gift_card"
    ? ["cover", "artwork", "main", "listing", "front", "packagingFront"]
    : ["listing", "main", "front", "packagingFront"];

const nonGames = products.filter((p) => !isGame(p));
const moved = new Map();
for (const p of nonGames) {
  const now = readRole(p, "frontBox");
  let next = null;
  for (const role of listingChain(p)) {
    const hit = readRole(p, role);
    if (hit) { next = hit; break; }
  }
  const key = categoryOf(p);
  const bucket = moved.get(key) ?? { total: 0, changes: 0, gainsPicture: 0, losesPicture: 0 };
  bucket.total += 1;
  if (now !== next) {
    bucket.changes += 1;
    if (!now && next) bucket.gainsPicture += 1;
    if (now && !next) bucket.losesPicture += 1;
  }
  moved.set(key, bucket);
}

say("## If the home page stopped resolving non-games through the box-art role");
say();
say("| category | products | picture would change | gains one | loses one |");
say("|---|---:|---:|---:|---:|");
for (const [key, b] of [...moved].sort((a, b) => b[1].total - a[1].total)) {
  say(`| ${key} | ${b.total} | ${b.changes} | ${b.gainsPicture} | ${b.losesPicture} |`);
}
say();

say("## Which field wins on each surface");
say();
say("| card | " + Object.keys(CHAINS).join(" | ") + " |");
say("|---|" + Object.keys(CHAINS).map(() => "---").join("|") + "|");
for (const p of cards) {
  const cells = Object.values(CHAINS).map((chain) => {
    for (const role of chain) if (readRole(p, role)) return `\`${role}\``;
    return "**placeholder**";
  });
  say(`| ${String(p.title ?? p.slug ?? p.id).slice(0, 34)} | ${cells.join(" | ")} |`);
}
say();

/*
  The question the whole report exists to answer: on how many cards does the
  home page show something other than what the artwork control writes?
*/
const stale = cards.filter((p) => {
  const listing = readRole(p, "listing");
  const editorWrites = readRole(p, "cover") ?? readRole(p, "main");
  return listing && editorWrites && listing !== editorWrites;
});
say("## Cards whose home-page picture is not the artwork the editor writes");
say();
if (!stale.length) {
  say("None — every card's listing picture already matches its artwork field.");
} else {
  say(
    `**${stale.length} of ${cards.length}.** On these, \`listingImage\` outranks the` +
      " `coverImage`/`mainImage` the Card Artwork control writes, so re-uploading" +
      " the artwork cannot change the home page.",
  );
  say();
  for (const p of stale) say(`- ${p.title ?? p.slug} — shows \`${tail(readRole(p, "listing"))}\``);
}
say();

/* A card carrying only `cardArtwork` is invisible to every chain there is. */
const orphan = cards.filter(
  (p) => readRole(p, "artwork") && !readRole(p, "listing") && !readRole(p, "main") && !readRole(p, "cover"),
);
say("## Cards whose only picture is `cardArtwork`");
say();
say(
  orphan.length
    ? `**${orphan.length}.** \`cardArtwork\` is in no chain in \`productImages.ts\`, so these show a placeholder: ${orphan.map((p) => p.title ?? p.slug).join(", ")}`
    : "None.",
);
say();

writeFileSync("card-images.md", lines.join("\n") + "\n");
