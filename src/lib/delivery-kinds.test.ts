import { describe, expect, it } from "vitest";

import { isPhysicalKind } from "./coupons";
import { isDigitalOrderKind } from "./delivery-kinds";
import { buildListing, type CatalogueRow } from "./catalogueImport";

/*
  The fault this file exists for.

  An order for a game published by the catalogue import produced no delivery
  slot at all: the tool said «تم تجهيز 0 من 0» and «0 خانة مستقلة», and an
  admin could not prepare the order however many times they opened it. The
  cause was an allow-list of eight "digital" kinds that did not contain "game"
  — the one kind the importer writes.
*/
describe("which order lines get a delivery slot", () => {
  it("gives one to the kind the catalogue import actually writes", () => {
    /*
      Read from `buildListing` rather than written out here, so the day the
      importer changes what it writes, this test is what notices.
    */
    const row: CatalogueRow = {
      line: 1,
      englishName: "Test Game",
      chineseName: "测试游戏",
      platform: "switch1",
      costIqd: null,
      offlinePriceIqd: 10000,
      englishSupport: true,
      slug: "test-game",
      coverUrl: "",
      storeLink: "",
      nsuid: "",
      publisher: "",
      languages: "",
      matchedTitle: "",
    };
    const outcome = buildListing(row, {
      categoryId: "nintendo-switch-games",
      categoryTitle: "ألعاب",
      mode: "create-only",
    });
    expect(outcome.action).toBe("create");
    const kind = String((outcome as { product: Record<string, unknown> }).product["kind"]);
    expect(isDigitalOrderKind(kind)).toBe(true);
  });

  it("gives one to every kind that is handed over", () => {
    for (const kind of [
      "game",
      "account",
      "offline_account",
      "online_account",
      "bundle",
      "preorder",
      "digital_code",
      "code",
      "gift_card",
    ]) {
      expect(isDigitalOrderKind(kind), kind).toBe(true);
    }
  });

  it("gives none to anything that ships", () => {
    for (const kind of ["hardware", "physical", "accessory", "device", "collectible"]) {
      expect(isDigitalOrderKind(kind), kind).toBe(false);
    }
  });

  it("gives one to a kind nobody has invented yet", () => {
    /*
      The direction of the failure is the whole point. An unknown kind that
      produces a slot shows the admin something they can ignore; an unknown
      kind that produces none shows them a zero they cannot act on, and that is
      what happened to every catalogue game that was sold.
    */
    expect(isDigitalOrderKind("something_new")).toBe(true);
    expect(isDigitalOrderKind("")).toBe(true);
    expect(isDigitalOrderKind(undefined)).toBe(true);
  });

  it("asks the same question as the shipping-address rule", () => {
    /*
      `needsAddress` in orders.server.ts and this rule must never disagree: a
      line that needs a postal address is a line nobody hands over as an
      account. Both now read `isPhysicalKind`, and this pins them together.
    */
    for (const kind of [
      "game",
      "account",
      "hardware",
      "physical",
      "accessory",
      "device",
      "collectible",
      "bundle",
      "digital_code",
    ]) {
      expect(isDigitalOrderKind(kind), kind).toBe(!isPhysicalKind(kind));
    }
  });

  it("ignores case and stray spacing on a kind read back from the database", () => {
    expect(isDigitalOrderKind(" Hardware ")).toBe(false);
    expect(isDigitalOrderKind("ACCESSORY")).toBe(false);
    expect(isDigitalOrderKind(" Game ")).toBe(true);
  });
});
