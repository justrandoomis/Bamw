import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HOME = readFileSync(resolve(process.cwd(), "src/components/HomeView.tsx"), "utf8");
const CATEGORY = readFileSync(
  resolve(process.cwd(), "src/routes/category.$categoryId.tsx"),
  "utf8",
);
const CARD = readFileSync(resolve(process.cwd(), "src/components/NintendoGameCard.tsx"), "utf8");
const DATA = readFileSync(resolve(process.cwd(), "src/routes/api/data.ts"), "utf8");

describe("Nintendo sections on home", () => {
  it("orders services, square games, bundles, then the existing cartridge shelf", () => {
    const services = HOME.indexOf('sectionName="StoreServices"');
    const squareGames = HOME.indexOf('sectionName="NintendoGameShelf"');
    const bundles = HOME.indexOf('sectionName="BundleStrip"');
    const cartridges = HOME.indexOf('sectionName="CartridgeShelf"');

    expect(services).toBeGreaterThan(-1);
    expect(squareGames).toBeGreaterThan(services);
    expect(bundles).toBeGreaterThan(squareGames);
    expect(cartridges).toBeGreaterThan(bundles);
  });

  it("keeps View all on the square shelf and removes it from the cartridge shelf", () => {
    const squareStart = HOME.indexOf('sectionName="NintendoGameShelf"');
    const bundleStart = HOME.indexOf('sectionName="BundleStrip"');
    const cartridgeStart = HOME.indexOf('sectionName="CartridgeShelf"');
    const dynamicStart = HOME.indexOf("{/* Dynamic / Custom Categories */}");

    expect(HOME.slice(squareStart, bundleStart)).toContain('t("common.viewAll")');
    expect(HOME.slice(squareStart, bundleStart)).toContain(
      'params={{ categoryId: "nintendo_games" }}',
    );
    expect(HOME.slice(cartridgeStart, dynamicStart)).not.toContain('t("common.viewAll")');
  });
});

describe("Nintendo catalogue grid", () => {
  it("uses the shared square card and a three-column phone grid", () => {
    expect(CATEGORY).toContain("<NintendoGameCard");
    expect(CATEGORY).toContain("grid-cols-3");
    expect(CATEGORY).toContain("sm:grid-cols-4");
    expect(CATEGORY).toContain('className="min-w-0 flex-1"');
    expect(CARD).toContain("flex min-w-0 flex-col");
    expect(CARD).toContain("aspect-square");
  });

  it("keeps legacy Switch 2 flags in the slim storefront payload", () => {
    expect(DATA).toContain('"switch2Enhanced"');
    expect(DATA).toContain("p?.switch2?.isSwitch2Edition === true");
  });
});
