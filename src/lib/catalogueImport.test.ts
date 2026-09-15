import { describe, expect, it } from "vitest";

import {
  buildBareListing,
  duplicateNames,
  parseCatalogueCsv,
  parseCsv,
  CATALOGUE_SOURCE,
  OFFLINE_OPTION_ID,
} from "./catalogueImport";
import { isBareListing } from "./bareListing";
import { isProductPurchasable, isVisibleToPublic } from "./purchasable";
import { resolveUnitPrice } from "./productPricing";

/** The header the owner's export actually writes, byte-order mark included. */
const HEADER =
  "\uFEFF#,English Name,Cost IQD,Chinese Name,Platform,Offline Price IQD,English Support";

const SHEET = [
  HEADER,
  "1,Kirby and the Forgotten Land,1711.6,星之卡比 探索发现,Nintendo Switch,9000,نعم",
  "2,Fire Emblem: Three Houses,1496,火焰纹章 风花雪月,Nintendo Switch,8000,نعم",
  "3,Shin chan: Shiro and the Coal Town,1496,蜡笔小新 煤炭镇的小白,Nintendo Switch 2,5000,لا — يابانية/صينية",
].join("\n");

describe("reading the sheet", () => {
  it("reads the owner's file, byte-order mark and all", () => {
    const result = parseCatalogueCsv(SHEET);
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(3);
    const [kirby] = result.rows;
    expect(kirby!.englishName).toBe("Kirby and the Forgotten Land");
    expect(kirby!.offlinePriceIqd).toBe(9000);
    expect(kirby!.costIqd).toBe(1711.6);
    expect(kirby!.chineseName).toBe("星之卡比 探索发现");
    expect(kirby!.platform).toBe("switch1");
    expect(kirby!.englishSupport).toBe(true);
  });

  it("reads «لا — يابانية/صينية» as no English, not as a yes", () => {
    // 17 titles in the real sheet say this. Selling one as English-language is
    // a refund; the safe direction is to believe the «لا».
    const result = parseCatalogueCsv(SHEET);
    expect(result.rows[2]!.englishSupport).toBe(false);
    expect(result.rows[2]!.platform).toBe("switch2");
  });

  it("keeps a comma inside a quoted title", () => {
    const rows = parseCsv('a,b\n"Hello, World",2');
    expect(rows[1]).toEqual(["Hello, World", "2"]);
  });

  it("reads an escaped quote as one quote", () => {
    const rows = parseCsv('a\n"She said ""hi"""');
    expect(rows[1]).toEqual(['She said "hi"']);
  });

  it("accepts a price written with separators or Arabic digits", () => {
    const result = parseCatalogueCsv(
      [HEADER, "1,Game A,1500,名,Nintendo Switch,\"9,000\",نعم", "2,Game B,1500,名,Nintendo Switch,٨٠٠٠,نعم"].join("\n"),
    );
    expect(result.rows.map((r) => r.offlinePriceIqd)).toEqual([9000, 8000]);
  });

  it("names every row it refused, with its line number", () => {
    const result = parseCatalogueCsv(
      [
        HEADER,
        "1,Good Game,1500,名,Nintendo Switch,9000,نعم",
        "2,,1500,名,Nintendo Switch,9000,نعم",
        "3,No Price,1500,名,Nintendo Switch,,نعم",
        "4,Bad Platform,1500,名,PlayStation 5,9000,نعم",
      ].join("\n"),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.issues.map((i) => i.line)).toEqual([3, 4, 5]);
    expect(result.issues[1]!.name).toBe("No Price");
  });

  it("refuses a game priced at or below its cost rather than importing it", () => {
    /*
      The one money rule here, and the same one `publishGate.ts` applies: a
      product selling at its supplier figure loses money on every order, and
      fifteen hundred arriving at once is not something anyone catches by
      reading a list.
    */
    const result = parseCatalogueCsv(
      [HEADER, "1,Loss Maker,9000,名,Nintendo Switch,9000,نعم"].join("\n"),
    );
    expect(result.rows).toEqual([]);
    expect(result.issues[0]!.message).toContain("لا يزيد عن التكلفة");
  });

  it("skips a blank line without calling it an error", () => {
    const result = parseCatalogueCsv([HEADER, "", "1,Game A,1500,名,Nintendo Switch,9000,نعم"].join("\n"));
    expect(result.rows).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });

  it("says which column is missing instead of importing nothing quietly", () => {
    const result = parseCatalogueCsv("Name,Cost\nGame A,1500");
    expect(result.rows).toEqual([]);
    expect(result.issues.map((i) => i.message).join(" ")).toContain("Offline Price IQD");
  });

  it("finds a name that appears twice, because the second would overwrite the first", () => {
    const result = parseCatalogueCsv(
      [
        HEADER,
        "1,Absolute Fear,1500,名,Nintendo Switch,9000,نعم",
        "2,Absolute Fear,1500,名,Nintendo Switch,9500,نعم",
      ].join("\n"),
    );
    expect(duplicateNames(result.rows)).toEqual(["Absolute Fear"]);
  });

  it("does not call the same game on two consoles a duplicate", () => {
    // It is in the owner's sheet, twice, and they are two products with two
    // costs. Calling it one is how the second of them gets dropped.
    const result = parseCatalogueCsv(
      [
        HEADER,
        "1,Absolute Fear,1496,名,Nintendo Switch,5000,نعم",
        "2,Absolute Fear,1496,名,Nintendo Switch 2,5000,نعم",
      ].join("\n"),
    );
    expect(duplicateNames(result.rows)).toEqual([]);
    expect(result.rows.map((r) => r.slug)).toEqual(["absolute-fear-ns1", "absolute-fear-ns2"]);
  });
});

describe("two games, one slug", () => {
  /*
    Both of these are in the owner's real file, and both would have silently
    become one listing: the shop would have lost a 9,000 د.ع product and a
    Switch 2 one, with nothing anywhere saying so.
  */
  it("separates two different games whose slug collides", () => {
    const result = parseCatalogueCsv(
      [
        HEADER,
        "1,Railway Nippon! Real Pro,1927.2,名,Nintendo Switch 2,7000,نعم",
        "2,Railway Nippon! Real Pro (特快专通),3652,名,Nintendo Switch 2,9000,نعم",
      ].join("\n"),
    );
    const slugs = result.rows.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(2);
  });

  it("assigns those slugs by name, not by the order of the spreadsheet", () => {
    /*
      Order-independence is what makes a re-import an update. A counter handed
      out by file position moves between the two games the moment the owner
      sorts their sheet differently, and the next import then creates a
      duplicate of each instead of updating either.
    */
    const rowsOf = (lines: string[]) =>
      Object.fromEntries(
        parseCatalogueCsv([HEADER, ...lines].join("\n")).rows.map((r) => [r.englishName, r.slug]),
      );
    const a = "1,Railway Nippon! Real Pro,1927.2,名,Nintendo Switch 2,7000,نعم";
    const b = "2,Railway Nippon! Real Pro (特快专通),3652,名,Nintendo Switch 2,9000,نعم";
    expect(rowsOf([a, b])).toEqual(rowsOf([b, a]));
  });
});

describe("building a listing", () => {
  const row = parseCatalogueCsv(SHEET).rows[0]!;
  const built = buildBareListing(row, {
    categoryId: "nintendo-switch-games",
    categoryTitle: "ألعاب نينتندو سويتش",
  });

  it("is visible and buyable the moment it is written", () => {
    // The entire point: these go on sale in this state.
    expect(isVisibleToPublic(built.product)).toBe(true);
    expect(isProductPurchasable(built.product)).toBe(true);
  });

  it("carries infinite stock, which is what keeps the buy button alive", () => {
    /*
      Load-bearing rather than cosmetic. `readOffers` resolves the offline
      offer's stock as `accountStock || stock`, so a record with no stock
      resolves to 0 and the derived offer is marked unavailable — a catalogue
      published unbuyable.
    */
    expect(built.product["stock"]).toBe(9999);
    expect(built.product["isInfiniteStock"]).toBe(true);
    expect(built.product["accountStock"]).toBe(9999);
    expect(built.product["accountEnabled"]).toBe(true);
  });

  it("charges the sheet's price for the offline option", () => {
    const { unitPrice } = resolveUnitPrice(built.product as never, {
      optionId: OFFLINE_OPTION_ID,
    });
    expect(unitPrice).toBe(9000);
  });

  it("leaves the option unpriced so one number cannot become two", () => {
    // An unpriced option means "use the price above me". Copying 9000 onto the
    // option as well would give the game two prices that can then disagree.
    const options = built.product["options"] as Record<string, unknown>[];
    expect(options[0]!["id"]).toBe(OFFLINE_OPTION_ID);
    expect(options[0]!["price"]).toBeUndefined();
  });

  it("keeps the Chinese name off the product entirely", () => {
    /*
      Not merely stripped on the way out — never on the record. The product
      document is what `getStore()` loads and `toPublicProduct` serialises, and
      the supplier's name for a game is not a customer's business.
    */
    expect(JSON.stringify(built.product)).not.toContain("星之卡比");
    expect(built.chineseName).toBe("星之卡比 探索发现");
  });

  it("counts as a listing that is still awaiting its details", () => {
    expect(isBareListing(built.product)).toBe(true);
    expect(built.product["catalogueSource"]).toBe(CATALOGUE_SOURCE);
  });

  it("stops counting as one the moment it has a cover and a description", () => {
    const writtenUp = {
      ...built.product,
      coverImage: "https://cdn.example/kirby.webp",
      description: "لعبة مغامرات ثلاثية الأبعاد من نينتندو يقودها كيربي عبر عالم مهجور.",
    };
    expect(isBareListing(writtenUp)).toBe(false);
  });
});

describe("running the import again", () => {
  const row = parseCatalogueCsv(SHEET).rows[0]!;
  const first = buildBareListing(row, { categoryId: "nintendo-switch-games" }).product;

  it("produces the same id, so a second run updates rather than duplicates", () => {
    const second = buildBareListing(row, { categoryId: "nintendo-switch-games" }).product;
    expect(second["id"]).toBe(first["id"]);
    expect(second["slug"]).toBe(first["slug"]);
  });

  it("keeps everything an admin has since written onto the game", () => {
    /*
      The property that makes this safe to re-run. Without it the first
      re-import after somebody spent a week writing up covers and descriptions
      would erase all of it — and that is the kind of thing discovered
      afterwards.
    */
    const edited = {
      ...first,
      coverImage: "https://cdn.example/kirby.webp",
      description: "وصف كتبه الأدمن",
      accountOnlineEnabled: true,
      accountOnlinePrice: 14000,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const again = buildBareListing({ ...row, offlinePriceIqd: 9500 }, {
      categoryId: "nintendo-switch-games",
      existing: edited,
    }).product;

    expect(again["coverImage"]).toBe("https://cdn.example/kirby.webp");
    expect(again["description"]).toBe("وصف كتبه الأدمن");
    expect(again["accountOnlineEnabled"]).toBe(true);
    expect(again["accountOnlinePrice"]).toBe(14000);
    // The six columns the sheet owns do move.
    expect(again["price"]).toBe(9500);
    // And the day it entered the shop does not.
    expect(again["createdAt"]).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not add a second offline option to a game that already has one", () => {
    const edited = {
      ...first,
      options: [
        { id: OFFLINE_OPTION_ID, name: "حساب أوفلاين" },
        { id: "online_account", name: "حساب أونلاين", price: 14000 },
      ],
    };
    const again = buildBareListing(row, {
      categoryId: "nintendo-switch-games",
      existing: edited,
    }).product;
    const options = again["options"] as Record<string, unknown>[];
    expect(options.filter((o) => o["id"] === OFFLINE_OPTION_ID)).toHaveLength(1);
    // The online option an admin added survives.
    expect(options.some((o) => o["id"] === "online_account")).toBe(true);
  });
});
