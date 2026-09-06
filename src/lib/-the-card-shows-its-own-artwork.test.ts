/**
 * @vitest-environment node
 *
 * The picture a gift card shows is the artwork the owner uploaded.
 *
 * The owner replaces a card's picture in «صورة بطاقة الشحن (Card Artwork)»,
 * the record changes, and the home page does not move. Two earlier fixes went
 * at the writer — the control now writes `coverImage` and `mainImage` — and
 * neither could have worked, because the home-page strip resolves through the
 * `listing` chain and `listingImage` is the first field in it.
 *
 * Production, all eight cards, read from the live catalogue on 6 Sep 2026:
 *
 *   | field        | value                              |
 *   |--------------|------------------------------------|
 *   | listingImage | …sd.jpg;maxHeight=1920;maxWidth=900 |  ← a retailer's CDN
 *   | coverImage   | giftcard-main-68bd67c3b0b33646.jpg  |  ← the owner's upload
 *   | mainImage    | mainImage-72ecf4496fd3ef2b.webp     |
 *   | cardArtwork  | cardArtwork-72ecf4496fd3ef2b.webp   |
 *
 * Eight of eight showed `listingImage`. It is not even a picture the shop
 * owns: `productImageVerification.server.ts` already says so in a comment —
 * "The Nintendo gift card is still serving `listingImage` … straight from a
 * retailer's CDN".
 */
import { describe, expect, it } from "vitest";

import { productImageUrl, resolveProductImage } from "./productImages";

/** One of the eight, with the exact field set production has. */
const CARD = {
  id: "prd_eshop_5",
  title: "Nintendo eShop Gift Card $5 — USA",
  category: "cat_gift_cards",
  kind: "digital_code",
  listingImage: "https://m.media-amazon.com/images/I/61sd.jpg;maxHeight=1920;maxWidth=900",
  mainImage: "https://cdn.banan.to/mainImage-72ecf4496fd3ef2b.webp",
  coverImage: "https://cdn.banan.to/giftcard-main-68bd67c3b0b33646.jpg",
  cardArtwork: "https://cdn.banan.to/cardArtwork-72ecf4496fd3ef2b.webp",
};

describe("a gift card on the home page", () => {
  it("shows the artwork the owner uploaded, not the retailer's listing photo", () => {
    /*
      `coverImage` is what the Card Artwork control writes — the upload lands
      in the `giftcards` folder under the `giftcard-main` role, which is why
      every one of them is named `giftcard-main-…`.
    */
    expect(productImageUrl(CARD, "listing")).toBe(CARD.coverImage);
  });

  it("names the field it used, so a wrong picture is traceable", () => {
    expect(resolveProductImage(CARD, "listing").source).toBe("cover");
  });

  it("keeps the retailer photo as a fallback rather than throwing it away", () => {
    // A card with no artwork yet is better off showing something of itself.
    const { fallbackUrls } = resolveProductImage(CARD, "listing");
    expect(fallbackUrls).toContain(CARD.listingImage);
  });

  it("falls back to cardArtwork, which no chain could reach before", () => {
    /*
      The gift-card import schema writes `card_artwork` → `cardArtwork`, and
      that field appeared in no chain in this module. A card imported through
      the schema editor with only its artwork filled in showed a placeholder.
    */
    const imported = {
      category: "cat_gift_cards",
      kind: "digital_code",
      cardArtwork: "https://cdn.banan.to/cardArtwork-only.webp",
    };
    expect(productImageUrl(imported, "listing")).toBe(imported.cardArtwork);
  });

  it("still shows something when the card has only the retailer photo", () => {
    const old = { category: "cat_gift_cards", kind: "digital_code", listingImage: CARD.listingImage };
    expect(productImageUrl(old, "listing")).toBe(CARD.listingImage);
  });
});

describe("everything that is not a gift card", () => {
  /*
    `productImages` serves every non-game product — hardware, accessories,
    amiibo, used stock, bundles. Their `listingImage` is a real listing
    photograph of the object and must keep winning: a console's `coverImage`
    is not a better picture of it, and reordering the shared chain to fix a
    gift card would move the picture on products nobody reported.
  */
  const hardware = {
    category: "cat_hardware",
    kind: "hardware",
    listingImage: "https://cdn.banan.to/listing-switch2.webp",
    coverImage: "https://cdn.banan.to/cover-switch2.webp",
    mainImage: "https://cdn.banan.to/main-switch2.webp",
  };

  it("leaves a console's listing photograph exactly where it was", () => {
    expect(productImageUrl(hardware, "listing")).toBe(hardware.listingImage);
  });

  it("leaves an accessory alone too", () => {
    const accessory = { ...hardware, category: "cat_accessories", kind: "accessory" };
    expect(productImageUrl(accessory, "listing")).toBe(accessory.listingImage);
  });

  it("shows the same artwork on the product page, not a second picture", () => {
    /*
      The hero read `mainImage` first, which on seven of the eight cards is the
      artwork from the original import rather than the one the owner uploaded —
      the two are different files with different hashes in production. That is
      the other half of «الصوره الرئيسية لا يمكنني تغيرها»: one card, two
      pictures, depending which screen you were on.
    */
    expect(resolveProductImage(CARD, "hero").source).toBe("cover");
    expect(resolveProductImage(CARD, "background").source).toBe("cover");
    expect(resolveProductImage(CARD, "thumbnail").source).toBe("cover");
  });
});

describe("the admin table and the shop show one product with one face", () => {
  /*
    `product-index.server.ts` had a third hand-written order —
    `listingImage → cartridgeImage → mainImage → …` — under a comment saying
    that picking a different field here from the storefront's "is how the same
    product ended up with two faces". It agreed with the storefront by
    coincidence, and stopped agreeing the moment a category needed its own
    chain: the admin table showed a card's retailer photograph while the shop
    showed the artwork.

    Games are deliberately not routed through the shared resolver — they are
    served from `nintendoImages`, and they carry a `cartridgeImage` the
    non-game chain has never heard of.
  */
  it("gives a gift card the same picture in the table as on the shelf", async () => {
    const { toIndexRow } = await import("./product-index.server");
    expect(toIndexRow(CARD as never).image).toBe(productImageUrl(CARD, "listing"));
    expect(toIndexRow(CARD as never).image).toBe(CARD.coverImage);
  });

  it("leaves a game's admin picture exactly where it was", async () => {
    const { toIndexRow } = await import("./product-index.server");
    const game = {
      id: "prd_game",
      title: "Super Mario Odyssey",
      category: "cat_nintendo",
      kind: "account",
      cartridgeImage: "https://cdn.banan.to/cartridge-odyssey.webp",
      mainImage: "https://cdn.banan.to/main-odyssey.webp",
    };
    // `cartridgeImage` outranks `mainImage` for a game, as it always has.
    expect(toIndexRow(game as never).image).toBe(game.cartridgeImage);
  });
});

describe("the picture survives the trip to the home page", () => {
  /*
    The home page fetches `/api/data?slim=1`, which copies a fixed list of
    fields off each product. A field the resolver reads and the projection
    omits is a field the home page cannot resolve from — so the two pages
    disagree about the same product, and no amount of fixing the resolver
    shows up on the one the owner is looking at.
  */
  it("carries every field the non-game resolver reads", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/routes/api/data.ts", "utf8"),
    );
    const listFields = source.slice(
      source.indexOf("const LIST_FIELDS = ["),
      source.indexOf("] as const;", source.indexOf("const LIST_FIELDS = [")),
    );
    for (const field of [
      "coverImage",
      "cardArtwork",
      "card_artwork",
      "listingImage",
      "listing_image",
      "mainImage",
      "main_image",
      "cover_image",
      "cartridgeImage",
    ]) {
      expect(listFields).toContain(`"${field}"`);
    }
  });
});
