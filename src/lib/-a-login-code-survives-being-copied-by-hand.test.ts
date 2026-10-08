/**
 * «يحفظه يصور الشاشة أو يكتبه على ورقة ويحفظه في مكان آمن»
 *
 * The login code is written down by hand, read back off a photo, typed on a
 * phone keyboard. These hold the properties that make that work: nothing in
 * it can be read two ways, and whatever reasonable shape it comes back in, it
 * is the same code.
 */
import { describe, expect, it } from "vitest";

import {
  LOGIN_CODE_ALPHABET,
  LOGIN_CODE_LENGTH,
  formatLoginCode,
  formatTypedCode,
  generateLoginCode,
  normalizeLoginCode,
  normalizeUsername,
  usernameProblem,
} from "./loginCode";

describe("a login code", () => {
  it("is 16 characters with nothing that reads two ways", () => {
    expect(LOGIN_CODE_ALPHABET).toHaveLength(32);
    for (const ambiguous of ["I", "L", "O", "U"])
      expect(LOGIN_CODE_ALPHABET).not.toContain(ambiguous);
    const code = generateLoginCode();
    expect(code).toHaveLength(LOGIN_CODE_LENGTH);
    for (const char of code) expect(LOGIN_CODE_ALPHABET).toContain(char);
  });

  it("is never the same twice", () => {
    const codes = new Set(Array.from({ length: 2000 }, generateLoginCode));
    expect(codes.size).toBe(2000);
  });

  it("is shown in four groups of four", () => {
    expect(formatLoginCode("A7K29QXMPH3T6WZB")).toBe("A7K2-9QXM-PH3T-6WZB");
    expect(formatTypedCode("a7k2 9q")).toBe("A7K2-9Q");
    expect(formatTypedCode("A7K2-9QXM-PH3T-6WZB-EXTRA")).toBe("A7K2-9QXM-PH3T-6WZB");
  });

  it("comes back the same however it was copied", () => {
    const code = "A7K29QXMPH3T6WZB";
    for (const copied of [
      "A7K2-9QXM-PH3T-6WZB",
      "a7k2-9qxm-ph3t-6wzb",
      " A7K2 9QXM PH3T 6WZB ",
      "A7K2_9QXM.PH3T-6WZB",
    ]) {
      expect(normalizeLoginCode(copied)).toBe(code);
    }
    // An O written for a 0, an I or an L for a 1.
    expect(normalizeLoginCode("A0K1-9QXM-PH3T-6WZB")).toBe("A0K19QXMPH3T6WZB");
    expect(normalizeLoginCode("AOKI-9QXM-PH3T-6WZB")).toBe("A0K19QXMPH3T6WZB");
    expect(normalizeLoginCode("AOKL-9QXM-PH3T-6WZB")).toBe("A0K19QXMPH3T6WZB");
  });

  it("is refused when it cannot be a code at all", () => {
    expect(normalizeLoginCode("A7K2-9QXM-PH3T")).toBeNull();
    expect(normalizeLoginCode("A7K2-9QXM-PH3T-6WZB-1")).toBeNull();
    expect(normalizeLoginCode("U7K2-9QXM-PH3T-6WZB")).toBeNull();
    expect(normalizeLoginCode("")).toBeNull();
  });
});

describe("a username", () => {
  it("is stored lower-case, without a leading @", () => {
    expect(normalizeUsername("  @Ali_Gamer ")).toBe("ali_gamer");
  });

  it("takes English letters, digits, dots and underscores, starting with a letter", () => {
    for (const ok of ["ali_gamer", "ali.g", "mario64", "abc"])
      expect(usernameProblem(ok)).toBeNull();
    expect(usernameProblem("ab")).toBe("short");
    expect(usernameProblem("a".repeat(21))).toBe("long");
    expect(usernameProblem("علي")).toBe("characters");
    expect(usernameProblem("ali gamer")).toBe("characters");
    expect(usernameProblem("1ali")).toBe("edges");
    expect(usernameProblem("ali_")).toBe("edges");
    expect(usernameProblem("ali..g")).toBe("edges");
  });

  it("cannot pass for the shop or its staff", () => {
    for (const taken of ["admin", "Ad.Min", "support", "bananto", "administrator", "admin123"]) {
      expect(usernameProblem(taken)).toBe("reserved");
    }
  });
});
