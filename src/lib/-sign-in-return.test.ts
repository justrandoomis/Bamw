/**
 * Where a visitor lands after signing in, and where they can never be sent.
 *
 * A stored "come back here" path is an open redirect waiting to happen: any
 * value that a browser reads as an absolute URL sends the member off this site
 * with the sign-in they just completed. These pin the shape of what is allowed.
 */
import { describe, expect, it, beforeEach } from "vitest";

import { rememberAfterSignIn, takeAfterSignIn } from "./signInReturn";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { sessionStorage?: Storage }).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
});

describe("the page to return to after signing in", () => {
  it("remembers a page inside the site", () => {
    rememberAfterSignIn("/wallet");
    expect(takeAfterSignIn()).toBe("/wallet");
  });

  it("forgets it once it has been used", () => {
    rememberAfterSignIn("/wallet");
    takeAfterSignIn();
    expect(takeAfterSignIn()).toBeNull();
  });

  it("refuses anything that leaves the site", () => {
    for (const hostile of [
      "https://example.com/steal",
      "//example.com/steal",
      "/\\example.com/steal",
      "javascript:alert(1)",
      "wallet",
    ]) {
      rememberAfterSignIn(hostile);
      expect(takeAfterSignIn(), hostile).toBeNull();
    }
  });

  it("refuses the sign-in page itself, which would be a loop", () => {
    rememberAfterSignIn("/auth");
    expect(takeAfterSignIn()).toBeNull();
  });

  it("survives storage being unavailable", () => {
    (globalThis as { sessionStorage?: Storage }).sessionStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(() => rememberAfterSignIn("/wallet")).not.toThrow();
    expect(takeAfterSignIn()).toBeNull();
  });
});
