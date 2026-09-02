/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearCatalogSnapshot,
  notifyCatalogChanged,
  readCatalogSnapshot,
  rememberCatalogVersion,
  seenCatalogVersion,
  writeCatalogSnapshot,
} from "./catalog-cache";

/**
 * The snapshot exists so the storefront paints products immediately. The bug it
 * caused was that it kept painting a product the admin had already deleted,
 * for one frame, every time — because nothing tied the snapshot to a version of
 * the catalogue.
 */

const snapshot = { products: [{ id: "prd_1", title: "Super Mario Odyssey" }] };

beforeEach(() => {
  localStorage.clear();
});

describe("a snapshot is only trusted while it matches the catalogue", () => {
  it("returns a snapshot stamped with the current version", () => {
    rememberCatalogVersion(7);
    writeCatalogSnapshot(snapshot, 7);
    expect(readCatalogSnapshot()).toEqual(snapshot);
  });

  it("refuses a snapshot older than a version this browser has seen", () => {
    writeCatalogSnapshot(snapshot, 7);
    // The admin deleted something; the server answered a later request with 8.
    rememberCatalogVersion(8);
    expect(readCatalogSnapshot()).toBeUndefined();
  });

  it("accepts a snapshot newer than the last seen version", () => {
    rememberCatalogVersion(7);
    writeCatalogSnapshot(snapshot, 9);
    expect(readCatalogSnapshot()).toEqual(snapshot);
  });

  it("keeps the highest version it has been told about", () => {
    rememberCatalogVersion(4);
    rememberCatalogVersion(9);
    rememberCatalogVersion(6); // an older response arriving late
    expect(seenCatalogVersion()).toBe(9);
  });

  it("ignores a version that is missing or not a number", () => {
    rememberCatalogVersion(5);
    rememberCatalogVersion(undefined);
    rememberCatalogVersion(Number.NaN);
    rememberCatalogVersion(0);
    expect(seenCatalogVersion()).toBe(5);
  });
});

describe("malformed or absent storage never breaks first paint", () => {
  it("returns undefined rather than throwing on corrupt JSON", () => {
    localStorage.setItem("banan_store_cache_v3", "{not json");
    expect(readCatalogSnapshot()).toBeUndefined();
  });

  it("returns undefined for a snapshot with no data", () => {
    localStorage.setItem("banan_store_cache_v3", JSON.stringify({ version: 1, at: 0 }));
    expect(readCatalogSnapshot()).toBeUndefined();
  });

  it("clears the pre-versioning snapshot key on sight", () => {
    localStorage.setItem("banan_store_cache_v2", JSON.stringify({ products: [{ id: "old" }] }));
    readCatalogSnapshot();
    expect(localStorage.getItem("banan_store_cache_v2")).toBeNull();
  });

  it("survives storage that throws on write", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeCatalogSnapshot(snapshot, 3)).not.toThrow();
    setItem.mockRestore();
  });
});

describe("invalidation after a mutation is targeted", () => {
  it("drops the snapshot and tells the service worker, and nothing else", () => {
    const post = vi.fn();
    vi.stubGlobal("navigator", {
      serviceWorker: { controller: { postMessage: post } },
    });
    localStorage.setItem("unrelated-key", "keep me");
    writeCatalogSnapshot(snapshot, 3);

    notifyCatalogChanged(4);

    expect(readCatalogSnapshot()).toBeUndefined();
    expect(seenCatalogVersion()).toBe(4);
    expect(post).toHaveBeenCalledWith({ type: "catalog-changed" });
    // A product update must not cost the visitor every cached image.
    expect(localStorage.getItem("unrelated-key")).toBe("keep me");
    vi.unstubAllGlobals();
  });

  it("works when no service worker is controlling the page", () => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: null } });
    writeCatalogSnapshot(snapshot, 3);
    expect(() => notifyCatalogChanged(4)).not.toThrow();
    expect(readCatalogSnapshot()).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("clearCatalogSnapshot leaves the seen version alone", () => {
    rememberCatalogVersion(6);
    writeCatalogSnapshot(snapshot, 6);
    clearCatalogSnapshot();
    expect(readCatalogSnapshot()).toBeUndefined();
    expect(seenCatalogVersion()).toBe(6);
  });
});
