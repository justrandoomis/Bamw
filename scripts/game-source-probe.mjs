#!/usr/bin/env node
/**
 * READ ONLY — what Nintendo actually has for a game, before anything is built on it.
 *
 * Answers three questions that cannot be answered from inside the sandbox,
 * because its egress proxy refuses nintendo.com with a 403:
 *
 *   1. Can a runner reach the store at all?
 *   2. Does `resolveProduct` find this exact game — right title, right console?
 *   3. What imagery does the record actually carry, by role?
 *
 * The third is the one that decides whether a promised set of artwork can be
 * delivered honestly. The store record has a box cover, a square, and a
 * gallery of screenshots. It has no key art, and a screenshot must never be
 * promoted into a banner — so if banners are wanted, they have to come from
 * somewhere else, and this says so per game rather than leaving a caller to
 * assume.
 *
 * Writes nothing, anywhere.
 *
 * Usage: node scripts/game-source-probe.mjs --title="Katana ZERO" [--platform=switch1]
 */
import { resolveProduct, galleryFrom, coverFrom, squareFrom, metadataFrom } from "./lib/nintendo-store.mjs";

const arg = (name, fallback = "") => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

/* The first four of the batch, so a push with no inputs still probes something. */
const DEFAULT_TITLES = [
  "Katana ZERO",
  "Shovel Knight: Treasure Trove",
  "Shovel Knight Dig",
  "TRIANGLE STRATEGY",
];

function requestedTitles() {
  if (arg("title")) return [arg("title")];
  const raw = arg("titles", "").trim();
  if (!raw) return DEFAULT_TITLES;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_TITLES;
  } catch {
    /* A bare title passed without JSON quoting is still a usable request. */
    return [raw];
  }
}

const titles = requestedTitles();
const platform = arg("platform", "") || "switch1";

for (const title of titles) {
  console.log("=".repeat(70));
  console.log(`TITLE: ${title}   (looking for ${platform})`);

  /* The shape `identityMatch` compares against: title and console, nothing invented. */
  const stub = { title, platform, slug: "", nsuid: "" };

  let resolved;
  try {
    resolved = await resolveProduct(stub);
  } catch (err) {
    console.log(`  UNREACHABLE: ${err?.message ?? err}`);
    continue;
  }

  if (!resolved || !resolved.product) {
    console.log(`  NOT RESOLVED: ${resolved?.reason ?? "no matching store page"}`);
    continue;
  }

  const p = resolved.product;
  const meta = metadataFrom(p) ?? {};
  const gallery = galleryFrom(p) ?? [];
  const cover = coverFrom(p);
  const square = squareFrom(p);

  console.log(`  RESOLVED via ${resolved.confidence ?? "?"} — ${resolved.reason ?? ""}`);
  console.log(`  store name : ${p.name ?? "?"}`);
  console.log(`  nsuid      : ${p.nsuid ?? "-"}`);
  console.log(`  platform   : ${p.platform?.label ?? p.platform?.code ?? "-"}`);
  console.log("  --- metadata keys present ---");
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const shown = Array.isArray(v) ? `[${v.length}] ${v.slice(0, 4).join(" | ")}` : String(v).slice(0, 110);
    console.log(`    ${k}: ${shown}`);
  }
  console.log("  --- imagery, by role ---");
  console.log(`    cover (box art)   : ${cover ? "yes" : "MISSING"}`);
  console.log(`    square            : ${square ? "yes" : "MISSING"}`);
  console.log(`    gallery shots     : ${gallery.length}`);
  console.log(`    key art / banners : ${0} — the store record carries none`);
  if (cover) console.log(`    cover url   : ${cover}`);
  if (square) console.log(`    square url  : ${square}`);
  gallery.slice(0, 12).forEach((g, i) => console.log(`    shot ${String(i + 1).padStart(2)}    : ${g.url}`));
}
console.log("=".repeat(70));
console.log("Read only. Nothing was written.");
