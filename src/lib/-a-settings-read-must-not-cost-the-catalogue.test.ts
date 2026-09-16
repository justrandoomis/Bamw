import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reading one setting must not read the whole shop.
 *
 * This fault has now been found four times in four files, and each time it
 * looked harmless at the call site:
 *
 *   - `getMarketConfig()` read 3.8 MB to find five numbers, sixty times an
 *     hour, and was what the every-minute cron was being killed for.
 *   - `getUsedConfig()` did the same to reach `settings.usedMarketplace` —
 *     through `transitionListing()`, which `expireDueListings()` calls on that
 *     same cron for every listing it retires.
 *   - `getReferralSettings()` did it on `/api/referral`.
 *   - the admin banana panel did it to read `settings`.
 *
 * `getStore()` reads all eleven catalogue chunks, parses 3.8 MB of JSON and
 * normalises eight hundred and seventy-six products. `settings` is not in any
 * of that — it is a field on the base `store` row, and `getStoreSettings()`
 * reaches it through a query that excludes the product rows.
 *
 * So the rule is a property, not a review note: a function whose whole job is
 * to read settings calls `getStoreSettings`, and does not call `getStore`.
 * These tests assert exactly that, by failing the catalogue read outright — a
 * call to it is not slow here, it throws.
 */

const CATALOGUE_READ = "getStore() was called for a settings-only read";

const getStore = vi.fn(async () => {
  throw new Error(CATALOGUE_READ);
});
/* The real keys, as `readUsedConfig` and `readReferralSettings` spell them. */
const getStoreSettings = vi.fn(async () => ({
  usedMarketplace: { enabled: true, listingFeeIqd: 5000, maxPhotos: 4 },
  referral: { enabled: true, buyerPercentBps: 1000 },
}));

vi.mock("./db.server", () => ({
  getStore,
  getStoreSettings,
  updateStore: vi.fn(async () => ({})),
  createAuditLog: vi.fn(async () => undefined),
  createNotification: vi.fn(async () => undefined),
  findUserById: vi.fn(async () => undefined),
  randomId: (prefix: string) => `${prefix}_test`,
  d1All: vi.fn(async () => []),
  d1First: vi.fn(async () => null),
  d1Run: vi.fn(async () => ({ meta: { changes: 0 } })),
}));
vi.mock("../db.server", () => ({
  getStore,
  getStoreSettings,
  findUserById: vi.fn(async () => undefined),
}));

vi.mock("./d1.server", () => ({
  d1Ready: async () => false,
  d1All: async () => [],
  d1First: async () => null,
  d1Run: async () => ({ meta: { changes: 0 } }),
  d1Batch: async () => [],
  d1RunChanges: async () => 0,
  getD1: () => undefined,
  ensureSchema: async () => {},
  ensureUsersSchema: async () => {},
}));
vi.mock("./whatsapp.server", () => ({ sendWhatsappMessage: async () => undefined }));
vi.mock("./telegram.server", () => ({
  sendTelegramMessage: async () => undefined,
  escapeHtml: (t: string) => t,
}));

beforeEach(() => {
  getStore.mockClear();
  getStoreSettings.mockClear();
});

describe("the used marketplace's own settings", () => {
  it("reads settings without the catalogue", async () => {
    const { getUsedConfig } = await import("./used-marketplace.server");
    const config = await getUsedConfig();

    expect(getStoreSettings).toHaveBeenCalledTimes(1);
    expect(getStore).not.toHaveBeenCalled();
    expect(config.enabled).toBe(true);
  });

  /*
    The path that made this expensive: every expiry on the every-minute cron
    goes through `transitionListing`, and that reads the config first.
  */
  it("still returns the section's real values, not a default", async () => {
    const { getUsedConfig } = await import("./used-marketplace.server");
    const config = await getUsedConfig();
    expect(config.listingFeeIqd).toBe(5000);
    expect(config.maxPhotos).toBe(4);
  });
});

describe("the referral programme's settings", () => {
  it("reads settings without the catalogue", async () => {
    const { getReferralSettings } = await import("./referral/service.server");
    const settings = await getReferralSettings();

    expect(getStoreSettings).toHaveBeenCalledTimes(1);
    expect(getStore).not.toHaveBeenCalled();
    expect(settings.enabled).toBe(true);
  });

  /*
    `readReferralSettings` takes the whole settings object and looks up its own
    `referral` block inside — which is why handing it `getStoreSettings()`
    rather than `store.settings` is the same value by a cheaper route, and this
    asserts that rather than assuming it.
  */
  it("still reads the percentage the owner set, through the nested block", async () => {
    const { getReferralSettings } = await import("./referral/service.server");
    const settings = await getReferralSettings();
    expect(settings.buyerPercentBps).toBe(1000);
  });
});

describe("the rule itself", () => {
  /*
    Named so the next person who adds a settings reader finds it. If this file
    ever needs a fifth entry, the answer is `getStoreSettings`.
  */
  it("fails loudly if a settings reader reaches for the catalogue", async () => {
    await expect(getStore()).rejects.toThrow(CATALOGUE_READ);
  });
});
