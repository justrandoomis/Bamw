import { describe, expect, it, vi } from "vitest";

import { parseStatusHistory, toProductRequest, type ProductRequestRow } from "./product-requests";

/**
 * The blank game name, pinned.
 *
 * `/api/game-requests` returned `SELECT *` rows straight from D1, cast as the
 * camelCase `ProductRequest` the whole app reads. Every multi-word column was
 * therefore missing at every reader: the admin's requests screen showed no game
 * name, "Invalid Date" and "-" for the contact method, and the customer's own
 * history showed the same — while `platform`, `notes` and `status` came through
 * fine, because those column names are one word. That mix is what made it look
 * like a rendering bug rather than a shape mismatch.
 */

const row: ProductRequestRow = {
  id: "prq_1",
  user_id: "usr_9",
  request_type: "game",
  product_name: "Final Fantasy VII Rebirth",
  game_id: "gm_ff7",
  platform: "switch2",
  product_category: "game",
  reference_url: "https://example.com/ff7",
  notes: "بشرفكم ضيفوها",
  preferred_version: "standard",
  preferred_region: "US",
  contact_method: "+9647700000000",
  status: "submitted",
  admin_note: "supplier asked 40k",
  user_visible_note: "طلبك قيد المراجعة",
  linked_product_id: "prd_77",
  status_history: JSON.stringify([{ status: "submitted", timestamp: "2026-09-01T10:00:00.000Z" }]),
  created_at: "2026-09-01T10:00:00.000Z",
  updated_at: "2026-09-02T08:00:00.000Z",
};

describe("toProductRequest", () => {
  it("carries every column the screens read", () => {
    const request = toProductRequest(row);

    // The four the admin screen showed as blank / "Invalid Date" / "-".
    expect(request.productName).toBe("Final Fantasy VII Rebirth");
    expect(request.createdAt).toBe("2026-09-01T10:00:00.000Z");
    expect(request.contactMethod).toBe("+9647700000000");
    expect(request.requestType).toBe("game");

    // And the rest of the multi-word columns, which were equally absent.
    expect(request.userId).toBe("usr_9");
    expect(request.gameId).toBe("gm_ff7");
    expect(request.productCategory).toBe("game");
    expect(request.referenceUrl).toBe("https://example.com/ff7");
    expect(request.preferredVersion).toBe("standard");
    expect(request.preferredRegion).toBe("US");
    expect(request.adminNote).toBe("supplier asked 40k");
    expect(request.userVisibleNote).toBe("طلبك قيد المراجعة");
    expect(request.linkedProductId).toBe("prd_77");
    expect(request.updatedAt).toBe("2026-09-02T08:00:00.000Z");
  });

  it("keeps the single-word columns that happened to work before", () => {
    const request = toProductRequest(row);
    expect(request.id).toBe("prq_1");
    expect(request.platform).toBe("switch2");
    expect(request.notes).toBe("بشرفكم ضيفوها");
    expect(request.status).toBe("submitted");
  });

  it("produces a date a browser can actually format", () => {
    // `new Date(undefined)` is what put "Invalid Date" on every card.
    expect(Number.isNaN(new Date(toProductRequest(row).createdAt).getTime())).toBe(false);
  });

  it("turns an absent column into undefined, not null or an empty string", () => {
    const bare = toProductRequest({
      ...row,
      game_id: null,
      admin_note: null,
      user_visible_note: "   ",
      linked_product_id: "",
    });

    // The screens test these with `req.x && ...` and `req.x || "-"`; a null
    // would render as nothing and an empty string would defeat the fallback.
    expect(bare.gameId).toBeUndefined();
    expect(bare.adminNote).toBeUndefined();
    expect(bare.userVisibleNote).toBeUndefined();
    expect(bare.linkedProductId).toBeUndefined();
  });

  it("never returns undefined for the fields the app treats as always present", () => {
    const empty = toProductRequest({} as ProductRequestRow);
    expect(empty.productName).toBe("");
    expect(empty.status).toBe("submitted");
    expect(empty.requestType).toBe("game");
    expect(empty.statusHistory).toEqual([]);
  });
});

describe("parseStatusHistory", () => {
  it("reads the trail the app writes", () => {
    const trail = parseStatusHistory(
      JSON.stringify([
        { status: "submitted", timestamp: "2026-09-01T10:00:00.000Z" },
        { status: "accepted", timestamp: "2026-09-02T08:00:00.000Z", note: "جارٍ التجهيز" },
      ]),
    );
    expect(trail).toHaveLength(2);
    expect(trail[1]).toEqual({
      status: "accepted",
      timestamp: "2026-09-02T08:00:00.000Z",
      note: "جارٍ التجهيز",
    });
  });

  it("survives a column that is not readable JSON", () => {
    // It is text in a database. One truncated value must not take the whole
    // requests screen down with a parse error.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseStatusHistory('[{"status":"submitted"')).toEqual([]);
    expect(parseStatusHistory("not json at all")).toEqual([]);
    warn.mockRestore();
  });

  it("treats an empty, missing or wrongly-shaped column as no trail", () => {
    expect(parseStatusHistory(null)).toEqual([]);
    expect(parseStatusHistory(undefined)).toEqual([]);
    expect(parseStatusHistory("")).toEqual([]);
    expect(parseStatusHistory('{"status":"submitted"}')).toEqual([]);
    expect(parseStatusHistory("[]")).toEqual([]);
  });

  it("drops entries that name no status rather than rendering blanks", () => {
    const trail = parseStatusHistory('[{"timestamp":"x"},null,"accepted",{"status":"added"}]');
    expect(trail).toEqual([{ status: "added", timestamp: "" }]);
  });
});
