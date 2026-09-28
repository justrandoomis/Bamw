/**
 * The rules `offline-cover-export.mjs` applies, kept apart from its I/O so a
 * test can hold them against the app's real functions.
 *
 * Every function that needs a shop rule takes `app` — the bundle of
 * `offline-cover-entry.ts` in the export, the same modules imported directly
 * in the test — so nothing here is a second implementation of the pricing or
 * the cover resolver. What IS decided here is only what the export adds on
 * top: which of the owner's named games a product is, and whether a downloaded
 * picture is the shape of a box front.
 */
import sharp from "sharp";

/** The longest side a cover keeps in the ZIP. Larger sources are scaled down. */
export const MAX_SIDE = 1200;

/**
 * Height ÷ width a framed cover must reach to count as a box front. A Switch
 * case is about 1.6; a square card is 1.0 and a banner is under 1.
 */
export const PORTRAIT_MIN = 1.15;

export const amount = (value) => {
  const n =
    typeof value === "number" ? value : Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/*
  The marks go BEFORE the decomposition: NFKD spells «™» as the letters «TM»,
  so «Super Smash Bros.™ Ultimate» would fold to «… bros tm ultimate» and stop
  matching the name the owner wrote.
*/
const MARKS = /[™®©℠]/g;

/** Accent-free, lower-case, punctuation as single spaces: «Pokémon Legends: Z-A» → «pokemon legends z a». */
export const fold = (s) =>
  String(s ?? "")
    .replace(MARKS, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const hasArabic = (s) => /[\u0600-\u06ff]/.test(String(s ?? ""));

export function englishTitle(product) {
  for (const value of [product?.titleEn, product?.english_name, product?.canonical_name, product?.title]) {
    const text = String(value ?? "").trim();
    if (text && !hasArabic(text)) return text;
  }
  return String(product?.titleEn || product?.title || product?.id || "");
}

export function arabicTitle(product) {
  for (const value of [product?.titleAr, product?.title_ar, product?.arabicName, product?.title]) {
    const text = String(value ?? "").trim();
    if (text && hasArabic(text)) return text;
  }
  return "";
}

/**
 * What the ordinary offline account costs, as the till charges it — or null
 * when the product's page does not sell one.
 *
 * `from` says which of the three shapes priced it, so the report can show its
 * working: an ordinary offline TYPE row (the row the card and the buy sheet
 * lead with), an offline OPTION row, or — with neither — the base price, which
 * is what `resolveUnitPrice` charges with nothing selected. `offerPrice` is
 * what the page prints beside «حساب أوفلاين»; where it differs from the till
 * it is the offer that is out of step, and the report lists it.
 */
export function offlineOf(app, product) {
  const offer = (app.readOffers(product) ?? []).find((o) => o?.kind === "account");
  if (!offer) return null;

  const typeRow = app.ordinaryOfflineRow(app.pricingTypeRows(product));
  if (typeRow) {
    const id = String(typeRow.id ?? "").trim();
    const optionId = String(typeRow.optionId ?? typeRow.option_id ?? "").trim();
    const price = id
      ? app.resolveUnitPrice(product, {
          typeId: id,
          ...(optionId && optionId !== "all" ? { optionId } : {}),
        }).unitPrice
      : amount(typeRow.price);
    return { price, from: "type", row: String(typeRow.name ?? id), offerPrice: amount(offer.price) };
  }

  const optionRow = app.ordinaryOfflineRow(product?.options);
  if (optionRow?.id) {
    const price = app.resolveUnitPrice(product, { optionId: String(optionRow.id) }).unitPrice;
    return {
      price,
      from: "option",
      row: String(optionRow.name ?? optionRow.id),
      offerPrice: amount(offer.price),
    };
  }

  const till = app.resolveUnitPrice(product).unitPrice;
  return { price: till || amount(offer.price), from: "base", row: "", offerPrice: amount(offer.price) };
}

/** The online account's price — context for the named games, never the answer. */
export function onlineOf(app, product) {
  const types = app.pricingTypeRows(product);
  const rows = [
    ...(Array.isArray(types) ? types : []),
    ...(Array.isArray(product?.options) ? product.options : []),
  ];
  for (const row of rows) {
    if (app.classifyTier(row).kind === "online_base" && amount(row?.price) > 0) return amount(row.price);
  }
  const offer = (app.readOffers(product) ?? []).find((o) => o?.kind === "accountOnline");
  return offer ? amount(offer.price) : 0;
}

/** The R2 key a stored `/api/files/...` URL is served from, or null. */
export function filesKey(url) {
  let pathname = String(url ?? "");
  if (/^https?:\/\//i.test(pathname)) {
    let parsed;
    try {
      parsed = new URL(pathname);
    } catch {
      return null;
    }
    if (!/(^|\.)banan\.to$/i.test(parsed.hostname)) return null;
    pathname = parsed.pathname;
  }
  const match = /^\/api\/files\/([^?#]+)/.exec(pathname);
  if (!match) return null;
  try {
    return `files/${decodeURIComponent(match[1])}`;
  } catch {
    return `files/${match[1]}`;
  }
}

/**
 * Decode a downloaded cover, frame the artwork the way the shop's cover cards
 * do, and encode a JPEG — the one format every phone, editor and printer opens.
 *
 * The frame is the product's stored `cartridgeImageTrim` when it has a valid
 * one, else `computeTrimBox` on a small copy — the same analysis the admin
 * editor stores and the cards apply. Its answer is `null` whenever the
 * evidence is thin, and then the picture is kept whole. Throws when the bytes
 * are not an image.
 */
export async function frameCover(app, bytes, storedTrim) {
  const meta = await sharp(bytes, { failOn: "none" }).metadata();
  if (!meta.width || !meta.height) throw new Error("not an image");
  const turned = Number(meta.orientation ?? 1) >= 5;
  const W = turned ? meta.height : meta.width;
  const H = turned ? meta.width : meta.height;

  let trim = app.isValidTrim(storedTrim) ? storedTrim : null;
  let framed = trim ? "stored" : "whole";
  if (!trim) {
    const scale = Math.min(1, app.ANALYSIS_MAX_SIDE / Math.max(W, H));
    const { data, info } = await sharp(bytes, { failOn: "none" })
      .rotate()
      .resize(Math.max(1, Math.round(W * scale)), Math.max(1, Math.round(H * scale)), {
        fit: "fill",
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    trim = app.computeTrimBox(
      new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
      info.width,
      info.height,
    );
    if (trim) framed = "computed";
  }

  let box = { left: 0, top: 0, width: W, height: H };
  if (trim) {
    const left = Math.max(0, Math.min(W - 1, Math.round(trim.left * W)));
    const top = Math.max(0, Math.min(H - 1, Math.round(trim.top * H)));
    box = {
      left,
      top,
      width: Math.max(1, Math.min(W - left, Math.round(trim.width * W))),
      height: Math.max(1, Math.min(H - top, Math.round(trim.height * H))),
    };
  }

  let pipeline = sharp(bytes, { failOn: "none" }).rotate();
  if (trim) pipeline = pipeline.extract(box);
  if (Math.max(box.width, box.height) > MAX_SIDE) {
    pipeline = pipeline.resize(box.height >= box.width ? { height: MAX_SIDE } : { width: MAX_SIDE });
  }
  const jpeg = await pipeline
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const out = await sharp(jpeg).metadata();
  return {
    jpeg,
    aspect: box.height / box.width,
    portrait: box.height / box.width >= PORTRAIT_MIN,
    framed,
    format: meta.format,
    source: `${W}x${H}`,
    size: `${out.width}x${out.height}`,
  };
}

/** A file name any system accepts, from an English title. */
export const safeName = (title) =>
  String(title ?? "")
    .replace(MARKS, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " - ")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*(-\s*)+/g, " - ")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    .slice(0, 90)
    .trim() || "game";

/*
  The owner's two lists, as he wrote them. `want` is the platform he named;
  where he named none the Switch 1 game is the natural reading, and any Switch 2
  Edition that also exists is printed beside it rather than silently dropped.
*/
const NINTENDO = "ألعاب نينتندو";
const PUBLISHERS = "ناشرون آخرون";
export const REQUESTED = [
  { group: NINTENDO, label: "Zelda Breath of the Wild", match: /breath of the wild/, want: "switch1" },
  { group: NINTENDO, label: "Mario Kart World (Switch 2)", match: /mario kart world/, want: "switch2" },
  { group: NINTENDO, label: "Donkey Kong Bananza (Switch 2)", match: /donkey kong bananza/, want: "switch2" },
  { group: NINTENDO, label: "Pokémon Legends Z-A (Switch 2 Edition)", match: /pokemon legends z a/, want: "switch2" },
  { group: NINTENDO, label: "Super Smash Bros. Ultimate", match: /smash bros ultimate/, want: "switch1" },
  { group: NINTENDO, label: "Splatoon Raiders (Switch 2)", match: /splatoon raiders/, want: "switch2" },
  { group: NINTENDO, label: "Super Mario Party Jamboree (Switch 2 Edition)", match: /mario party jamboree/, want: "switch2" },
  { group: NINTENDO, label: "Zelda Ocarina of Time (Switch 2)", match: /ocarina of time/, want: "switch2" },
  { group: NINTENDO, label: "Luigi's Mansion 3", match: /luigi ?s mansion 3/, want: "switch1" },
  { group: NINTENDO, label: "Metroid Dread", match: /metroid dread/, want: "switch1" },
  { group: NINTENDO, label: "Pokémon Scarlet", match: /pokemon scarlet/, want: "switch1" },
  { group: NINTENDO, label: "Mario Kart 8 Deluxe", match: /mario kart 8 deluxe/, want: "switch1" },
  { group: PUBLISHERS, label: "Resident Evil Requiem (Switch 2)", match: /resident evil requiem/, want: "switch2" },
  { group: PUBLISHERS, label: "Cyberpunk 2077 (Switch 2)", match: /cyberpunk 2077/, want: "switch2" },
  { group: PUBLISHERS, label: "Final Fantasy VII Remake (Switch 2)", match: /final fantasy (vii|7) remake/, want: "switch2" },
  { group: PUBLISHERS, label: "Pragmata (Switch 2)", match: /pragmata/, want: "switch2" },
  { group: PUBLISHERS, label: "Minecraft (Switch 2)", match: /^minecraft(?! (dungeons|legends|story|blast))/, want: "switch2" },
];

/**
 * Every product a named game could be, best first: on sale before hidden, sold
 * offline before not, the platform he named before the other, and the plainest
 * title before a bundle or an edition that merely contains the name.
 */
export function matchRequested(ask, rows) {
  return rows
    .filter((row) => row.game && ask.match.test(row.folded))
    .map((row) => ({
      row,
      rank: [
        row.hidden ? 1 : 0,
        row.offline?.price > 0 ? 0 : 1,
        ask.want === "any" || (ask.want === "switch2") === row.switch2 ? 0 : 1,
        row.folded.length,
      ],
    }))
    .sort((a, b) => {
      for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
      return 0;
    })
    .map((hit) => hit.row);
}
