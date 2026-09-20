import { describe, expect, it } from "vitest";

import { isDigitalOrderKind, isFullyDigitalOrder } from "./delivery-kinds";

describe("digital order kinds", () => {
  it("puts imported Nintendo games in the digital fulfilment queue", () => {
    expect(isDigitalOrderKind("game")).toBe(true);
    expect(isFullyDigitalOrder([{ kind: "game" }])).toBe(true);
  });

  it("keeps physical and mixed orders out of the digital-only queue", () => {
    expect(isDigitalOrderKind("hardware")).toBe(false);
    expect(isFullyDigitalOrder([{ kind: "game" }, { kind: "hardware" }])).toBe(false);
    expect(isFullyDigitalOrder([])).toBe(false);
  });

  it("retains every existing digital kind", () => {
    for (const kind of [
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
});
