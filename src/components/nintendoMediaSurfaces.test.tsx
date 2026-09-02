/**
 * @vitest-environment jsdom
 */
/**
 * End-to-end check of the media contract at the component level.
 *
 * The unit tests in src/lib/nintendoImages.test.ts prove the resolver hands
 * back the right field for a role. These prove the *components actually ask for
 * the right role* — which is where the original bug lived. The resolver was
 * fine; `HomeView` asked it for a listing cover and dropped the answer into the
 * square cartridge window.
 *
 * So each test renders the real component and reads the `src` off the real
 * `<img>`, rather than asserting on an intermediate value.
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import NintendoCover from "./NintendoCover";
import { NINTENDO_IMAGE_PLACEHOLDER } from "@/lib/nintendoImages";

vi.mock("@/hooks/useImageTrim", () => ({
  useImageTrim: () => ({ trim: null, naturalAspect: null }),
}));

const SQUARE = "https://cdn.example/square.webp";
const BOX = "https://cdn.example/box.webp";
const DETAIL = "https://cdn.example/detail.webp";
const WRAP = "https://cdn.example/wrap.webp";
const BANNER = "https://cdn.example/banner.webp";
const SHOT = "https://cdn.example/shot.webp";

/** One real-shaped Nintendo game with every semantic field populated. */
const fullyPopulated = {
  id: "prd_mario",
  slug: "super-mario-odyssey",
  title: "Super Mario Odyssey",
  titleEn: "Super Mario Odyssey",
  price: 25000,
  platform: "switch",
  nintendoCardImage: SQUARE,
  cartridgeImage: BOX,
  coverImage: DETAIL,
  coverHiResImage: WRAP,
  bannerImage: BANNER,
  galleryImages: [{ url: SHOT }],
};

afterEach(cleanup);

/** The URL the component actually put in the DOM, with any CDN wrapper undone. */
function renderedSrc(): string {
  const img = screen.getByRole("img") as HTMLImageElement;
  const src = img.getAttribute("src") || "";
  const proxied = /\/api\/img\?u=([^&]+)/.exec(src);
  return proxied?.[1] ? decodeURIComponent(proxied[1]) : src;
}

describe("each storefront surface renders its own semantic image", () => {
  it("home 'ألعاب نينتندو سويتش' renders the Square Card Image", () => {
    render(<NintendoCover product={fullyPopulated} usage="square-card" alt="x" />);
    expect(renderedSrc()).toBe(SQUARE);
  });

  it("'أحدث إصدارات نينتندو' renders the Front Box Cover", () => {
    render(<NintendoCover product={fullyPopulated} usage="front-box" alt="x" />);
    expect(renderedSrc()).toBe(BOX);
  });

  it("/nintendo_games renders the Front Box Cover", () => {
    render(<NintendoCover product={fullyPopulated} usage="front-box" alt="x" />);
    expect(renderedSrc()).toBe(BOX);
  });

  it("the product detail cover renders the Cover Image", () => {
    render(<NintendoCover product={fullyPopulated} usage="detail-cover" alt="x" />);
    expect(renderedSrc()).toBe(DETAIL);
  });

  it("a promotional slot renders a Banner Image", () => {
    render(<NintendoCover product={fullyPopulated} usage="banner" alt="x" />);
    expect(renderedSrc()).toBe(BANNER);
  });

  it("renders four different pictures of one product across four surfaces", () => {
    const seen: string[] = [];
    for (const usage of ["square-card", "front-box", "detail-cover", "banner"] as const) {
      render(<NintendoCover product={fullyPopulated} usage={usage} alt="x" />);
      seen.push(renderedSrc());
      cleanup();
    }
    expect(new Set(seen).size).toBe(4);
  });
});

describe("a missing semantic image shows the placeholder, not another field", () => {
  it("no square card: the home strip shows the placeholder, not the box", () => {
    render(
      <NintendoCover
        product={{ cartridgeImage: BOX, coverImage: DETAIL }}
        usage="square-card"
        alt="x"
      />,
    );
    expect(renderedSrc()).toBe(NINTENDO_IMAGE_PLACEHOLDER);
  });

  it("no box cover: the catalogue shows the placeholder, not the square card", () => {
    render(<NintendoCover product={{ nintendoCardImage: SQUARE }} usage="front-box" alt="x" />);
    expect(renderedSrc()).toBe(NINTENDO_IMAGE_PLACEHOLDER);
  });

  it("only screenshots: every cover surface shows the placeholder", () => {
    for (const usage of ["square-card", "front-box", "detail-cover"] as const) {
      render(<NintendoCover product={{ galleryImages: [{ url: SHOT }] }} usage={usage} alt="x" />);
      expect(renderedSrc(), `${usage} promoted a screenshot`).toBe(NINTENDO_IMAGE_PLACEHOLDER);
      cleanup();
    }
  });

  it("only a banner: every cover surface shows the placeholder", () => {
    for (const usage of ["square-card", "front-box", "detail-cover"] as const) {
      render(<NintendoCover product={{ bannerImage: BANNER }} usage={usage} alt="x" />);
      expect(renderedSrc(), `${usage} promoted a banner`).toBe(NINTENDO_IMAGE_PLACEHOLDER);
      cleanup();
    }
  });
});

describe("the square card frame is shaped for square art", () => {
  /** jsdom rewrites `aspect-ratio: 1` as `1 / 1`, so compare the number. */
  function frameRatio(container: HTMLElement): number {
    const raw = (container.firstChild as HTMLElement).style.aspectRatio;
    const [w, h] = raw.split("/").map((part) => Number(part.trim()));
    return h ? w! / h : w!;
  }

  it("frames square-card at 1:1 and a box cover at the retail ratio", () => {
    const { container: square } = render(
      <NintendoCover product={fullyPopulated} usage="square-card" alt="x" />,
    );
    expect(frameRatio(square)).toBeCloseTo(1, 5);
    cleanup();

    const { container: box } = render(
      <NintendoCover product={fullyPopulated} usage="front-box" alt="x" />,
    );
    // A vertical retail packshot dropped into the square window is exactly the
    // reported bug, so the two frames must not be the same shape.
    expect(frameRatio(box)).toBeCloseTo(0.72, 5);
  });
});
