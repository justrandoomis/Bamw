import { describe, expect, it } from "vitest";

import {
  buildListing,
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
    const slugs = result.rows.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(2);
    for (const slug of slugs) expect(slug).toMatch(/^absolute-fear-[a-z0-9]{1,5}$/);
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
  const outcome = buildListing(row, {
    categoryId: "nintendo-switch-games",
    categoryTitle: "ألعاب نينتندو سويتش",
  });
  if (outcome.action === "skip") throw new Error("a new row must not be skipped");
  const built = outcome;

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
  const created = buildListing(row, { categoryId: "nintendo-switch-games" });
  if (created.action === "skip") throw new Error("a new row must not be skipped");
  const first = created.product;

  it("produces the same id from the same name, so nothing is duplicated", () => {
    const second = buildListing(row, { categoryId: "nintendo-switch-games" });
    expect(second.action).toBe("create");
    expect(second.action === "create" && second.product["id"]).toBe(first["id"]);
  });

  it("leaves a game that is already in the shop completely alone", () => {
    /*
      The rule that makes a re-run safe, and the one the first draft of this
      file broke. It rebuilt the record and spread it over the stored one,
      which carried `isHidden: false`, `stock: 9999`, `status: "active"` and a
      fresh `options` array along with the price — so an admin who took a game
      off sale because the supplier ran out would find the next import had
      quietly put it back on sale, in stock, at the sheet's price.
    */
    const hiddenByAdmin = {
      ...first,
      isHidden: true,
      isActive: false,
      status: "غير نشط",
      stock: 0,
      isInfiniteStock: false,
      price: 12000,
      options: [{ id: OFFLINE_OPTION_ID, name: "حساب أوفلاين", price: 12000 }],
    };
    const again = buildListing(row, {
      categoryId: "nintendo-switch-games",
      existing: hiddenByAdmin,
    });
    expect(again.action).toBe("skip");
    expect(again.action === "skip" && again.reason).toContain("لم يتغيّر");
  });

  it("refuses to touch a product somebody built by hand, whatever its name", () => {
    // A bundle, a hardware product or a written-up game that happens to share
    // a title must never be turned into a bare account listing by a
    // spreadsheet. It is reported as skipped so the admin can see the clash.
    const handMade = { id: "prd_manual", title: row.englishName, price: 25000, kind: "bundle" };
    const outcome = buildListing(row, {
      categoryId: "nintendo-switch-games",
      existing: handMade,
      mode: "refresh-prices",
    });
    expect(outcome.action).toBe("skip");
    expect(outcome.action === "skip" && outcome.reason).toContain("يدوياً");
  });

  it("updates only the price and the cost when a refresh is asked for", () => {
    const edited = {
      ...first,
      coverImage: "https://cdn.example/kirby.webp",
      description: "وصف كتبه الأدمن",
      accountOnlineEnabled: true,
      accountOnlinePrice: 14000,
      isHidden: true,
      stock: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      options: [
        { id: OFFLINE_OPTION_ID, name: "حساب أوفلاين" },
        { id: "online_account", name: "حساب أونلاين", price: 14000 },
      ],
    };
    const again = buildListing(
      { ...row, offlinePriceIqd: 9500, costIqd: 1800 },
      { categoryId: "nintendo-switch-games", existing: edited, mode: "refresh-prices" },
    );
    expect(again.action).toBe("update");
    if (again.action !== "update") return;

    expect(again.product["price"]).toBe(9500);
    expect(again.product["cost"]).toBe(1800);

    // And nothing else moved — not the work, not the state, not the options.
    expect(again.product["coverImage"]).toBe("https://cdn.example/kirby.webp");
    expect(again.product["description"]).toBe("وصف كتبه الأدمن");
    expect(again.product["accountOnlinePrice"]).toBe(14000);
    expect(again.product["isHidden"]).toBe(true);
    expect(again.product["stock"]).toBe(0);
    expect(again.product["createdAt"]).toBe("2026-01-01T00:00:00.000Z");
    expect(again.product["options"]).toEqual(edited.options);
  });
});

describe("a line that appears twice in the sheet", () => {
  const twice = parseCatalogueCsv(
    [
      HEADER,
      "1,Absolute Fear,1496,名,Nintendo Switch,5000,نعم",
      "2,Absolute Fear,1496,名,Nintendo Switch,5000,نعم",
    ].join("\n"),
  );

  it("becomes one product, which is what the warning promises", () => {
    /*
      The modal tells the owner «سيُحفظ آخر صف فقط لكل اسم». That has to be
      true. An earlier version of the slug assignment gave the two rows
      different tags — `-ns1` and `-2` — so both were created, as two live
      products with one title, two URLs and the same price, while the warning
      said data would be dropped. In a 1,530-row export an accidentally
      repeated line is exactly what that warning exists to catch.
    */
    const slugs = twice.rows.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(1);

    const ids = twice.rows.map((r) => {
      const outcome = buildListing(r, { categoryId: "nintendo-switch-games" });
      return outcome.action === "skip" ? "" : String(outcome.product["id"]);
    });
    // One id, so the second write upserts over the first rather than adding.
    expect(new Set(ids).size).toBe(1);
  });

  it("is still reported, so the owner knows the sheet has a repeat in it", () => {
    expect(duplicateNames(twice.rows)).toEqual(["Absolute Fear"]);
  });
});

describe("a cost the sheet does not state", () => {
  it("refuses a row whose cost cell is unreadable rather than publishing it unchecked", () => {
    /*
      `money()` stripped non-digits and called `Number("")`, which is 0 — so
      «N/A» parsed as a cost of zero, the «التكلفة غير صالحة» branch was
      unreachable, and the loss guard below it is fenced behind `cost > 0` and
      was skipped too. A row whose real cost is 12,000 against a price of 9,000
      is refused when the cost parses, and was published at a loss when
      somebody typed «N/A».
    */
    const result = parseCatalogueCsv(
      [HEADER, "1,Mystery Cost,N/A,名,Nintendo Switch,9000,نعم"].join("\n"),
    );
    expect(result.rows).toEqual([]);
    expect(result.issues[0]!.message).toContain("غير مقروءة");
  });

  it("treats an empty cost cell as «not stated», not as zero", () => {
    const result = parseCatalogueCsv(
      [HEADER, "1,No Cost Given,,名,Nintendo Switch,9000,نعم"].join("\n"),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.costIqd).toBeNull();
  });

  it("never writes «not stated» over a cost the shop already knows", () => {
    // A file with no Cost column says nothing about cost. Writing a zero would
    // lose the figure and disarm the loss guard on every later run.
    const row = parseCatalogueCsv(
      ["English Name,Platform,Offline Price IQD", "Kirby,Nintendo Switch,9500"].join("\n"),
    ).rows[0]!;
    const existing = {
      id: "prd_cat_kirby",
      catalogueSource: CATALOGUE_SOURCE,
      price: 9000,
      cost: 1711.6,
    };
    const outcome = buildListing(row, {
      categoryId: "nintendo-switch-games",
      existing,
      mode: "refresh-prices",
    });
    expect(outcome.action).toBe("update");
    if (outcome.action !== "update") return;
    expect(outcome.product["price"]).toBe(9500);
    expect(outcome.product["cost"]).toBe(1711.6);
  });
});

describe("a slug that does not move", () => {
  const build = (lines: string[]) =>
    Object.fromEntries(
      parseCatalogueCsv([HEADER, ...lines].join("\n")).rows.map((r) => [r.englishName, r.slug]),
    );

  const a = "1,Railway Nippon! Real Pro,1927.2,名,Nintendo Switch 2,7000,نعم";
  const b = "2,Railway Nippon! Real Pro (特快专通),3652,名,Nintendo Switch 2,9000,نعم";
  const c = "3,Railway Nippon! Real Pro (超特急),2500,名,Nintendo Switch 2,8000,نعم";

  it("does not change when a third colliding game is added to the sheet", () => {
    /*
      A positional counter would have. The third row sorts between the other
      two, every tag after it shifts, their ids change — and the next import
      creates fresh copies of two games that are already in the shop while the
      originals sit there orphaned. The tag is derived from the name instead.
    */
    const before = build([a, b]);
    const after = build([a, b, c]);
    expect(after["Railway Nippon! Real Pro"]).toBe(before["Railway Nippon! Real Pro"]);
    expect(after["Railway Nippon! Real Pro (特快专通)"]).toBe(
      before["Railway Nippon! Real Pro (特快专通)"],
    );
  });

  it("does not change when the sheet is re-sorted", () => {
    expect(build([a, b, c])).toEqual(build([c, b, a]));
  });

  it("gives a title with no Latin letters a stable slug rather than a timestamp", () => {
    // `sanitizeSlug` falls back to `Date.now()`, so every run would mint a new
    // id for the same game and the shop would fill with copies of it.
    const once = build(["1,最恐 青鬼,1496,名,Nintendo Switch,5000,نعم"]);
    const twice = build(["1,最恐 青鬼,1496,名,Nintendo Switch,5000,نعم"]);
    expect(once).toEqual(twice);
    expect(Object.values(once)[0]).not.toMatch(/product-/);
  });
});
