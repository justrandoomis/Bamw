import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildProductSavePayload } from "./gameImportForm";
import { categoryBannerPool, bannerCandidates } from "./categoryBanners";

// LIST_FIELDS parsed from the real server source, exactly as the server uses it.
const src = readFileSync("src/routes/api/data.ts", "utf8");
const block = src.slice(src.indexOf("const LIST_FIELDS = ["), src.indexOf("] as const;", src.indexOf("const LIST_FIELDS = [")));
const LIST_FIELDS = [...block.matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1] as string);

const slimOf = (p: any) => {
  const out: Record<string, unknown> = {};
  for (const k of LIST_FIELDS) if (p?.[k] !== undefined) out[k] = p[k];
  return out;
};

describe("slim projection vs banner pool", () => {
  it("shows what LIST_FIELDS keeps of the banner sources", () => {
    console.log("banner in LIST_FIELDS:", LIST_FIELDS.includes("banner"));
    console.log("bannerImage in LIST_FIELDS:", LIST_FIELDS.includes("bannerImage"));
    console.log("bannerImages in LIST_FIELDS:", LIST_FIELDS.includes("bannerImages"));
    console.log("galleryImages in LIST_FIELDS:", LIST_FIELDS.includes("galleryImages"));
  });

  it("a product saved through the admin/import save path keeps a banner under slim", () => {
    const saved: any = buildProductSavePayload({
      title: "Zelda",
      titleEn: "Zelda",
      bannerImages: ["https://cdn.example/zelda-keyart-wide.jpg", "https://cdn.example/zelda-2.jpg"],
      galleryImages: ["https://cdn.example/zelda-shot-1.jpg"],
      category: "nintendo_games",
      categoryId: "nintendo_games",
      price: 10,
    } as any);
    console.log("saved.banner =", saved.banner);
    const slim = slimOf(saved);
    console.log("slim.banner =", (slim as any).banner);
    console.log("bannerCandidates(slim) =", bannerCandidates(slim));
    const pool = categoryBannerPool([slim], "nintendo_games");
    console.log("pool =", pool);
    expect(pool.length).toBeGreaterThan(0);
  });
});
