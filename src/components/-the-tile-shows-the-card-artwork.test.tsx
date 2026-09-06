/**
 * @vitest-environment jsdom
 *
 * The picture on the home-page tile is the artwork the owner uploaded.
 *
 * Three fixes went at this and none of them could have worked, because none of
 * them was on the path the tile actually takes. `HomeView` computes
 * `productImageUrl(p, "listing")` and hands it to `ProductStrip`; the strip
 * ignores it and renders `NintendoCover` itself, with the default `front-box`
 * role — `cartridgeImage`, a Nintendo *game* box-art field that no gift-card
 * admin control writes.
 *
 * On the live catalogue every card's `cartridgeImage` held a `giftcard-main-…`
 * file with a *different hash* from its `coverImage`: an earlier upload of the
 * same artwork. So the tile showed a picture that looked right, and replacing
 * the artwork moved `coverImage` and left the tile alone.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useImageTrim", () => ({
  useImageTrim: () => ({ trim: undefined, naturalAspect: null }),
}));
vi.mock("@/lib/cdnImage", () => ({ cdnImage: (url: string) => url }));

const { NintendoCover } = await import("./NintendoCover");

/** The $20 card, with the exact fields production carries. */
const CARD = {
  id: "prd_eshop_20",
  title: "Nintendo eShop Gift Card $20 — USA",
  category: "cat_gift_cards",
  kind: "digital_code",
  // An earlier upload of the artwork — what the tile showed and nothing could change.
  cartridgeImage: "https://cdn.banan.to/giftcard-main-cad9d60f8e5f9dae.jpg",
  // What «صورة بطاقة الشحن (Card Artwork)» writes today.
  coverImage: "https://cdn.banan.to/giftcard-main-9bbd880aaa809d64.jpg",
  mainImage: "https://cdn.banan.to/mainImage-a571d77eb92c1b3d.webp",
  listingImage: "https://m.media-amazon.com/images/I/61sd.jpg;maxHeight=1920;maxWidth=900",
};

const srcOf = () => screen.getByRole("img").getAttribute("src") ?? "";

afterEach(cleanup);

describe("a gift card tile", () => {
  it("shows the current artwork on the home page, not the older upload", () => {
    // `front-box` is the default role every ProductStrip renders with.
    render(<NintendoCover product={CARD} usage="front-box" alt={CARD.title} />);
    expect(srcOf()).toContain("giftcard-main-9bbd880aaa809d64");
  });

  it("shows the same artwork in the cart, so one purchase is one picture", () => {
    render(<NintendoCover product={CARD} usage="cart" alt={CARD.title} />);
    expect(srcOf()).toContain("giftcard-main-9bbd880aaa809d64");
  });

  it("never falls back to the retailer's listing photograph while artwork exists", () => {
    render(<NintendoCover product={CARD} usage="front-box" alt={CARD.title} />);
    expect(srcOf()).not.toContain("media-amazon");
  });
});

describe("everything that is a Nintendo box still is one", () => {
  /*
    Scoped to gift cards on purpose. The same measurement that justified the
    change bounded it: seven of eight cards move, and one hardware product
    would have moved with them for no reason anybody reported.
  */
  const game = {
    id: "prd_game",
    title: "Super Mario Odyssey",
    category: "cat_nintendo",
    kind: "account",
    cartridgeImage: "https://cdn.banan.to/cartridge-odyssey.webp",
    coverImage: "https://cdn.banan.to/cover-odyssey.webp",
  };

  it("keeps a game on its box cover", () => {
    render(<NintendoCover product={game} usage="front-box" alt={game.title} />);
    expect(srcOf()).toContain("cartridge-odyssey");
  });

  it("keeps a console on the picture it already had", () => {
    const console_ = {
      id: "prd_switch2",
      title: "Nintendo Switch 2",
      category: "cat_hardware",
      kind: "hardware",
      cartridgeImage: "https://cdn.banan.to/cartridge-switch2.webp",
      listingImage: "https://cdn.banan.to/listing-switch2.webp",
    };
    render(<NintendoCover product={console_} usage="front-box" alt={console_.title} />);
    expect(srcOf()).toContain("cartridge-switch2");
  });
});
