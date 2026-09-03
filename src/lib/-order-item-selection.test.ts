/**
 * @vitest-environment node
 */
/**
 * The fulfilment screens must never print "[object Object]".
 *
 * `meta` is written from the checkout request, and the checkout endpoint
 * type-checks nothing inside a line — it validates that `items` is an array of
 * at most fifty and casts. So a non-string option name is storable today, and
 * `String(value)` on an object yields the literal "[object Object]": not a
 * crash, not a blank, and not something anyone notices until it is printed on
 * a card an admin is preparing an account from.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  platformLabel,
  readOrderItemSelection,
  selectionSummary,
} from "./orderItemSelection";

describe("readOrderItemSelection", () => {
  it("reads a normal snapshot", () => {
    expect(
      readOrderItemSelection({
        optionName: "حساب أوفلاين",
        typeName: "عادي",
        platform: "switch2",
        editionId: "ed_std",
        dlcIds: ["dlc_a", "dlc_b"],
      }),
    ).toEqual({
      optionName: "حساب أوفلاين",
      typeName: "عادي",
      platform: "Nintendo Switch 2",
      editionId: "ed_std",
      dlcCount: 2,
    });
  });

  it("reads the JSON string the snapshot tables hold", () => {
    const stored = JSON.stringify({ optionName: "حساب أونلاين", typeName: "ديلوكس" });
    const read = readOrderItemSelection(stored);
    expect(read.optionName).toBe("حساب أونلاين");
    expect(read.typeName).toBe("ديلوكس");
  });

  it("never yields [object Object] from an object-valued field", () => {
    // The actual defect this exists for.
    const read = readOrderItemSelection({
      optionName: { id: "offline", name: "حساب أوفلاين" },
      typeName: ["standard"],
      platform: { value: "switch2" },
      editionId: { id: 1 },
    });
    expect(read.optionName).toBe("");
    expect(read.typeName).toBe("");
    expect(read.platform).toBe("");
    expect(read.editionId).toBe("");
    expect(JSON.stringify(read)).not.toContain("[object Object]");
    expect(selectionSummary(read)).toBe("");
  });

  it("keeps a numeric id, which is a reasonable thing to store", () => {
    expect(readOrderItemSelection({ editionId: 42 }).editionId).toBe("42");
  });

  it("survives unparseable or absent metadata", () => {
    expect(readOrderItemSelection("{not json")).toEqual(EMPTY_SELECTION);
    expect(readOrderItemSelection(null)).toEqual(EMPTY_SELECTION);
    expect(readOrderItemSelection(undefined)).toEqual(EMPTY_SELECTION);
    expect(readOrderItemSelection("[1,2]")).toEqual(EMPTY_SELECTION);
  });

  it("counts only real add-on ids", () => {
    expect(readOrderItemSelection({ dlcIds: ["a", "", null, { x: 1 }, "b"] }).dlcCount).toBe(2);
  });
});

describe("platformLabel", () => {
  it("normalises the spellings that are actually stored", () => {
    for (const value of ["switch2", "Switch 2", "nintendo-switch-2", "NS2"]) {
      expect(platformLabel(value)).toBe("Nintendo Switch 2");
    }
    for (const value of ["switch", "Nintendo Switch", "NS"]) {
      expect(platformLabel(value)).toBe("Nintendo Switch");
    }
  });

  it("shows an unrecognised platform rather than dropping it", () => {
    // An admin can act on a value they do not recognise; not on a blank.
    expect(platformLabel("Switch Lite")).toBe("Switch Lite");
  });
});

describe("selectionSummary", () => {
  it("joins only the parts that exist", () => {
    expect(
      selectionSummary({
        optionName: "حساب أوفلاين",
        typeName: "",
        platform: "Nintendo Switch 2",
        editionId: "",
        dlcCount: 1,
      }),
    ).toBe("حساب أوفلاين • Nintendo Switch 2 • +1 إضافة");
  });

  it("never leaves a dangling separator", () => {
    expect(selectionSummary({ ...EMPTY_SELECTION, optionName: "حساب أوفلاين" })).toBe(
      "حساب أوفلاين",
    );
  });
});
