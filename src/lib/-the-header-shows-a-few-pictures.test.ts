/**
 * The category header's picture pool is bounded, and fair about it.
 *
 * It used to hand back every screenshot, gallery image, hero and wallpaper URL
 * in the category. On the games shelf, with 1,714 products, that is thousands
 * of strings — which the page then preloaded ALL AT ONCE, one `new Image()`
 * each, every `onload` writing state nothing read. These tests pin the two
 * things that matters about the replacement: it keeps only a poolful, and it
 * does not keep only the first poolful.
 */
import { describe, expect, it } from "vitest";

import {
  BANNER_POOL_LIMIT,
  bannerCandidates,
  bannerCategoryMatch,
  categoryBannerPool,
} from "./categoryBanners";

/** A deterministic stand-in for Math.random, so a sample can be asserted. */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length] ?? 0;
    i++;
    return v;
  };
}

const game = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `g${n}`,
  category: "nintendo_games",
  screenshots: [`https://cdn.example/shot-${n}-a.jpg`, `https://cdn.example/shot-${n}-b.jpg`],
  ...extra,
});

describe("which products dress the header", () => {
  it("matches on category, on kind, and on the games category's three spellings", () => {
    expect(bannerCategoryMatch({ category: "nintendo_games" }, "nintendo_games")).toBe(true);
    expect(bannerCategoryMatch({ category: "cat_nintendo" }, "nintendo_games")).toBe(true);
    expect(bannerCategoryMatch({ category: "nintendo-switch-games" }, "nintendo_games")).toBe(true);
    expect(bannerCategoryMatch({ kind: "nintendo-switch-games" }, "nintendo_games")).toBe(true);
    expect(bannerCategoryMatch({ category: "amiibo" }, "nintendo_games")).toBe(false);
  });

  it("lets every product through on the all shelf", () => {
    expect(bannerCategoryMatch({ category: "amiibo" }, "all")).toBe(true);
  });
});

describe("which pictures a product offers", () => {
  it("reads banners, galleries and screenshots in every shape the catalogue spells them", () => {
    const urls = bannerCandidates({
      banner: "https://cdn.example/banner.jpg",
      gallery: "https://cdn.example/one.jpg, https://cdn.example/two.jpg",
      galleryImages: [{ url: "https://cdn.example/three.jpg" }],
      screenshots: ["https://cdn.example/four.jpg", { imageUrl: "https://cdn.example/five.jpg" }],
      metadata: {
        screenshots: ["https://cdn.example/six.jpg"],
        images: { screenshots: [{ url: "https://cdn.example/seven.jpg" }] },
      },
    });

    expect(urls).toContain("https://cdn.example/banner.jpg");
    expect(urls).toContain("https://cdn.example/two.jpg");
    expect(urls).toContain("https://cdn.example/three.jpg");
    expect(urls).toContain("https://cdn.example/five.jpg");
    expect(urls).toContain("https://cdn.example/six.jpg");
    expect(urls).toContain("https://cdn.example/seven.jpg");
  });

  it("refuses cartridge art and cover thumbnails, because the header wants a scene", () => {
    const urls = bannerCandidates({
      banner: "https://cdn.example/cartridge-front.png",
      heroImage: "https://cdn.example/cover_thumb_x.png",
      wallpaper: "https://cdn.example/cart_123.png",
      keyArt: "https://cdn.example/cartridges/abc.png",
      background: "https://cdn.example/scene.jpg",
    });
    expect(urls).toEqual(["https://cdn.example/scene.jpg"]);
  });

  it("refuses an empty, missing or absurdly short url", () => {
    expect(bannerCandidates({ banner: "", heroImage: null, wallpaper: "a.jpg" })).toEqual([]);
  });
});

describe("the pool the slideshow flips through", () => {
  it("never exceeds the limit, however many pictures the category has", () => {
    const products = Array.from({ length: 900 }, (_, i) => game(i));
    // 900 products x 2 screenshots = 1,800 eligible pictures.
    const pool = categoryBannerPool(products, "nintendo_games");
    expect(pool.length).toBe(BANNER_POOL_LIMIT);
  });

  it("keeps every picture when the category has fewer than a poolful", () => {
    const pool = categoryBannerPool([game(1), game(2)], "nintendo_games");
    expect(pool.length).toBe(4);
    expect(new Set(pool).size).toBe(4);
  });

  it("does not repeat a url two products happen to share", () => {
    const shared = { screenshots: ["https://cdn.example/same.jpg"] };
    const pool = categoryBannerPool(
      [game(1, shared), game(2, shared), game(3, shared)],
      "nintendo_games",
    );
    expect(pool).toEqual(["https://cdn.example/same.jpg"]);
  });

  it("ignores products from another category", () => {
    const pool = categoryBannerPool(
      [game(1), { id: "a", category: "amiibo", screenshots: ["https://cdn.example/amiibo.jpg"] }],
      "nintendo_games",
    );
    expect(pool).not.toContain("https://cdn.example/amiibo.jpg");
    expect(pool.length).toBe(2);
  });

  it("samples from the whole catalogue, not from the head of it", () => {
    /*
      The catalogue is sorted, so taking the first two dozen pictures would
      show the same handful of games' screenshots to every visitor forever.
      With `random` pinned at 0 every later candidate wins slot 0, so the
      survivor is the LAST eligible picture — proof the tail is reachable,
      which a head-of-list cap could never be.
    */
    const products = Array.from({ length: 200 }, (_, i) => ({
      id: `g${i}`,
      category: "nintendo_games",
      banner: `https://cdn.example/shot-${i}.jpg`,
    }));
    const pool = categoryBannerPool(products, "nintendo_games", 1, () => 0);
    expect(pool).toEqual(["https://cdn.example/shot-199.jpg"]);
  });

  it("returns a stable pool of the right size under a fixed random source", () => {
    const products = Array.from({ length: 50 }, (_, i) => game(i));
    const a = categoryBannerPool(products, "nintendo_games", 10, sequence([0.1, 0.9, 0.5, 0.3]));
    const b = categoryBannerPool(products, "nintendo_games", 10, sequence([0.1, 0.9, 0.5, 0.3]));
    expect(a).toEqual(b);
    expect(a.length).toBe(10);
    expect(new Set(a).size).toBe(10);
  });

  it("answers an empty list for an empty, missing or zero-limit catalogue", () => {
    expect(categoryBannerPool([], "nintendo_games")).toEqual([]);
    expect(categoryBannerPool(undefined, "nintendo_games")).toEqual([]);
    expect(categoryBannerPool([game(1)], "nintendo_games", 0)).toEqual([]);
  });
});
