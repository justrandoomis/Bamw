import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveProductImage } from "@/lib/productImages";

function slimFields(): string[] {
  const s = readFileSync(resolve(process.cwd(), "src/routes/api/data.ts"), "utf8");
  const a = s.indexOf("const LIST_FIELDS = [");
  const b = s.indexOf("] as const;", a);
  return [...s.slice(a, b).matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1] as string);
}
function slimOf(p: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of slimFields()) if (p[k] !== undefined) out[k] = p[k];
  return out;
}

const hardware = {
  id: "hw1",
  title: "Switch 2 Dock",
  category: "hardware",
  price: 100,
  gallery: [{ url: "https://cdn.example/dock-1.jpg" }],
  lifestyleImages: ["https://cdn.example/dock-life.jpg"],
};

describe("gallery-only non-game product", () => {
  it("full vs slim", () => {
    const full = resolveProductImage(hardware as any, "listing");
    const slim = resolveProductImage(slimOf(hardware as any) as any, "listing");
    expect({
      fullSource: full.source,
      fullUrl: full.url,
      fullPlaceholder: full.isPlaceholder,
      slimKeys: Object.keys(slimOf(hardware as any)),
      slimSource: slim.source,
      slimUrl: slim.url,
      slimPlaceholder: slim.isPlaceholder,
    }).toEqual("SHOW ME");
  });
});
