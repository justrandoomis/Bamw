/**
 * The rules `offline-cover-export.mjs` applies, held against the app's own
 * pricing, offer and framing functions — the same ones its bundle carries.
 *
 * The owner wants the ordinary offline account's price beside each game's
 * front box cover. Two things make that easy to get wrong:
 *
 *   - the price lives in three shapes (an offline TYPE row, an offline OPTION
 *     row, or the base price when the only row is the online account), and the
 *     card, the page and the till were once three different answers;
 *   - «has a front box cover» is not «has a URL in the field»: a square card or
 *     a banner can sit in `cartridgeImage`, and a packshot can float in a white
 *     square that only the shop's own crop turns back into a rectangle.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { readOffers } from "../src/lib/hub.ts";
import { ANALYSIS_MAX_SIDE, computeTrimBox, isValidTrim } from "../src/lib/imageTrim.ts";
import { ordinaryOfflineRow, pricingTypeRows, resolveUnitPrice } from "../src/lib/productPricing.ts";
import { classifyTier } from "../src/lib/tierPricing.ts";

import {
  MAX_SIDE,
  REQUESTED,
  filesKey,
  fold,
  foldArabic,
  frameCover,
  matchRequested,
  offlineOf,
  onlineOf,
  safeName,
} from "./lib/offline-cover.mjs";

const app = {
  readOffers,
  ordinaryOfflineRow,
  pricingTypeRows,
  resolveUnitPrice,
  classifyTier,
  computeTrimBox,
  isValidTrim,
  ANALYSIS_MAX_SIDE,
};

describe("the ordinary offline price", () => {
  it("is the offline row, wherever it sits among the rows", () => {
    const product = {
      id: "p1",
      price: 42000,
      types: [
        { id: "t_online", name: "حساب أونلاين", price: 42000 },
        { id: "t_offline", name: "حساب أوفلاين", price: 12000 },
      ],
    };
    expect(offlineOf(app, product)).toMatchObject({ price: 12000, from: "type" });
  });

  it("is not the add-ons edition of the offline account", () => {
    const product = {
      id: "p2",
      price: 15000,
      types: [
        { id: "dlc_offline", name: "حساب أوفلاين مع الاضافات", price: 22000 },
        { id: "standard_offline", name: "Regular / Offline", price: 15000 },
        { id: "standard_online", name: "حساب أونلاين", price: 40000 },
      ],
    };
    expect(offlineOf(app, product)).toMatchObject({ price: 15000, from: "type" });
  });

  /* The shape 65 games had: one ONLINE row, the offline account in `price`. */
  it("is the base price when the only row is the online account", () => {
    const product = {
      id: "p3",
      price: 12000,
      types: [{ id: "t_online", name: "حساب أونلاين", price: 42000 }],
    };
    expect(offlineOf(app, product)).toMatchObject({ price: 12000, from: "base" });
    expect(onlineOf(app, product)).toBe(42000);
  });

  it("is the offline option when the product prices through options", () => {
    const product = {
      id: "p4",
      price: 30000,
      options: [
        { id: "online_account", name: "حساب أونلاين", price: 30000 },
        { id: "offline_account", name: "حساب أوفلاين", price: 9000 },
      ],
    };
    expect(offlineOf(app, product)).toMatchObject({ price: 9000, from: "option" });
  });

  it("charges what the till charges, and keeps the offer's number beside it", () => {
    const product = { id: "p5", price: 12000, accountPrice: 9000 };
    expect(offlineOf(app, product)).toMatchObject({ price: 12000, from: "base", offerPrice: 9000 });
  });

  it("is absent when the page does not sell an offline account at all", () => {
    expect(offlineOf(app, { id: "p6", price: 12000, accountEnabled: false })).toBeNull();
    expect(offlineOf(app, { id: "p7" })).toBeNull();
  });
});

describe("where a stored cover is read from", () => {
  it("maps the shop's own file URLs to the key the bucket holds", () => {
    expect(filesKey("/api/files/products/zelda-front.webp")).toBe("files/products/zelda-front.webp");
    expect(filesKey("https://banan.to/api/files/covers/a_b.png?w=300")).toBe("files/covers/a_b.png");
    expect(filesKey("https://www.banan.to/api/files/x.jpg")).toBe("files/x.jpg");
  });

  it("leaves every other address to be fetched as it is", () => {
    expect(filesKey("https://www.nintendo.com/eu/media/images/packshot.jpg")).toBeNull();
    expect(filesKey("https://assets.banan.to/Images/Brand/logo.webp")).toBeNull();
    expect(filesKey("https://evil.example/api/files/x.jpg")).toBeNull();
  });
});

/** A textured block, so the crop has artwork to find and not a flat field. */
async function artwork(width, height) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 3] = 30 + ((i * 7) % 90);
    pixels[i * 3 + 1] = 60 + ((i * 13) % 70);
    pixels[i * 3 + 2] = 120 + ((i * 3) % 60);
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe("the picture that goes in the ZIP", () => {
  it("crops a packshot out of a white square, and it is then a box front", async () => {
    const inset = await sharp({
      create: { width: 800, height: 800, channels: 3, background: "#ffffff" },
    })
      .composite([{ input: await artwork(440, 720), left: 180, top: 40 }])
      .png()
      .toBuffer();
    const framed = await frameCover(app, inset, undefined);
    expect(framed.framed).toBe("computed");
    expect(framed.portrait).toBe(true);
    expect(framed.aspect).toBeGreaterThan(1.45);
    expect(framed.aspect).toBeLessThan(1.75);
    const out = await sharp(framed.jpeg).metadata();
    expect(out.format).toBe("jpeg");
    expect(out.width).toBeLessThan(500);
  });

  it("refuses a square card filed in the cover field", async () => {
    const framed = await frameCover(app, await artwork(600, 600), undefined);
    expect(framed.portrait).toBe(false);
  });

  it("refuses a wide banner", async () => {
    const framed = await frameCover(app, await artwork(900, 400), undefined);
    expect(framed.portrait).toBe(false);
  });

  it("keeps a tall cover whole and scales it to the ZIP's size", async () => {
    const framed = await frameCover(app, await artwork(1000, 1600), undefined);
    expect(framed.framed).toBe("whole");
    expect(framed.portrait).toBe(true);
    const out = await sharp(framed.jpeg).metadata();
    expect(out.height).toBe(MAX_SIDE);
    expect(out.width).toBe(750);
  });

  it("uses the crop the admin editor stored when there is one", async () => {
    const trim = { left: 0.25, top: 0, width: 0.5, height: 1 };
    const framed = await frameCover(app, await artwork(800, 800), trim);
    expect(framed.framed).toBe("stored");
    expect(framed.aspect).toBeCloseTo(2, 1);
  });

  it("throws on bytes that are not a picture", async () => {
    await expect(frameCover(app, Buffer.from("<html>not found</html>"), undefined)).rejects.toThrow();
  });
});

describe("the games the owner named", () => {
  const byLabel = (label) => REQUESTED.find((ask) => ask.label.startsWith(label));

  it("recognises the names the way the catalogue spells them", () => {
    expect(byLabel("Pokémon Legends Z-A").match.test(fold("Pokémon Legends: Z-A – Nintendo Switch 2 Edition"))).toBe(true);
    expect(byLabel("Luigi's Mansion 3").match.test(fold("Luigi’s Mansion 3"))).toBe(true);
    expect(byLabel("Super Smash Bros.").match.test(fold("Super Smash Bros.™ Ultimate"))).toBe(true);
    expect(byLabel("Final Fantasy VII").match.test(fold("FINAL FANTASY VII REMAKE INTERGRADE"))).toBe(true);
    expect(byLabel("Minecraft").match.test(fold("Minecraft"))).toBe(true);
    expect(byLabel("Minecraft").match.test(fold("Minecraft Dungeons"))).toBe(false);
    expect(byLabel("Minecraft").match.test(fold("Minecraft Legends"))).toBe(false);
  });

  it("puts the game on sale, on the platform named, with the plainest title first", () => {
    const row = (title, extra = {}) => ({
      title,
      folded: fold(title),
      game: true,
      hidden: false,
      switch2: false,
      offline: { price: 10000 },
      ...extra,
    });
    const rows = [
      row("Mario Kart World", { hidden: true, switch2: true }),
      row("Mario Kart World + Bonus Pack", { switch2: true }),
      row("Mario Kart World", { switch2: true }),
      row("Mario Kart World (Switch 1 port)"),
    ];
    const hits = matchRequested(byLabel("Mario Kart World"), rows);
    expect(hits[0]).toBe(rows[2]);
    expect(hits.at(-1)).toBe(rows[0]);
  });

  /*
    «Not in the shop» is an answer about the shop, so it is not given from one
    field: a product can carry the name only in its slug or its Arabic title.
  */
  it("finds a game by its slug or its Arabic title, and ranks a non-game last", () => {
    const base = { game: true, hidden: false, switch2: true, offline: { price: 9000 } };
    const bySlug = { ...base, title: "ماريو بارتي", folded: "", slugFolded: fold("super-mario-party-jamboree-switch-2-edition") };
    const byArabic = { ...base, title: "x", folded: "x", arabicFolded: foldArabic("سوبر ماريو بارتي جامبوري — إصدار سويتش 2") };
    const merch = { ...base, game: false, title: "Super Mario Party Jamboree Poster", folded: fold("Super Mario Party Jamboree Poster") };
    const unrelated = { ...base, title: "Mario Party Superstars", folded: fold("Mario Party Superstars") };
    const hits = matchRequested(byLabel("Super Mario Party Jamboree"), [merch, unrelated, bySlug, byArabic]);
    expect(hits).toContain(bySlug);
    expect(hits).toContain(byArabic);
    expect(hits).not.toContain(unrelated);
    expect(hits.at(-1)).toBe(merch);
  });

  it("folds the Arabic spellings of one name together", () => {
    expect(foldArabic("أُوكارينا")).toBe(foldArabic("اوكارينا"));
    expect(byLabel("Zelda Ocarina").ar.test(foldArabic("أسطورة زيلدا: أوكارينا الزمن"))).toBe(true);
    expect(byLabel("Minecraft").ar.test(foldArabic("ماين كرافت دانجنز"))).toBe(false);
  });
});

describe("a file name any system opens", () => {
  it("drops marks and accents, and never leaves a path separator", () => {
    expect(safeName("Pokémon™ Legends: Z-A")).toBe("Pokemon Legends - Z-A");
    expect(safeName("Fate/Samurai Remnant")).toBe("Fate - Samurai Remnant");
    expect(safeName("Pokémon Legends: Z-A – Nintendo Switch 2 Edition")).toBe(
      "Pokemon Legends - Z-A - Nintendo Switch 2 Edition",
    );
    expect(safeName("Luigi’s Mansion 3")).toBe("Luigi's Mansion 3");
    expect(safeName("ゼルダの伝説")).toBe("game");
  });
});
