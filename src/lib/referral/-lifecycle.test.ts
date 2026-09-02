/**
 * @vitest-environment node
 */
/**
 * The referral programme, end to end, against a real SQLite database created
 * by the application's own schema.
 *
 * Everything here runs through the real modules: the real cookie signing, the
 * real D1 statements, the real order path, the real wallet. A fake would only
 * prove the fake agrees with itself, and the properties that matter — pay
 * once, never to yourself, nothing before the order completes — are all
 * properties of what the database actually does.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__TEST_D1__"] = db;

/** A signing key, so the attribution cookie is genuinely signed and verified. */
const SECRETS: Record<string, string> = {
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  ACCOUNT_ENC_KEY: "test-account-encryption-key-0123456789ab",
  IP_SALT: "test-ip-salt-0123456789abcdefghijklmn",
  REFERRAL_HASH_SALT: "test-referral-salt-0123456789abcdefghij",
};

vi.mock("@/lib/env.server", () => ({
  env: (name: string) => SECRETS[name],
  getEnv: () => ({
    ...SECRETS,
    bananto: (globalThis as Record<string, unknown>)["__TEST_D1__"],
  }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

vi.mock("@/lib/telegram.server", () => ({
  sendTelegramMessage: vi.fn(async () => ({ ok: true })),
  telegramMiniAppDeepLink: (value: string) => `https://t.me/bananto?start=${value}`,
}));
vi.mock("@/lib/whatsapp.server", () => ({ sendWhatsappMessage: vi.fn(async () => undefined) }));

const GAME = {
  id: "prd_odyssey",
  title: "Super Mario Odyssey",
  titleEn: "Super Mario Odyssey",
  slug: "super-mario-odyssey",
  price: 10_000,
  cost: 4_000,
  stock: 99,
  kind: "account",
  category: "cat_nintendo",
  status: "نشط",
  isActive: true,
  releaseDate: "2017-10-27",
  options: [
    { id: "offline_account", name: "حساب أوفلاين", price: 10_000 },
    { id: "online_account", name: "حساب أونلاين", price: 14_000 },
  ],
  types: [
    { id: "standard_offline", name: "أوفلاين عادي" },
    { id: "dlc_offline", name: "أوفلاين مع الإضافات" },
  ],
};

/** A gift card: priced, sellable, and never part of the programme. */
const GIFT_CARD = {
  id: "prd_eshop",
  title: "بطاقة نينتندو eShop",
  slug: "nintendo-eshop-card",
  price: 20_000,
  stock: 99,
  kind: "digital_code",
  category: "cat_gift_cards",
  status: "نشط",
  isActive: true,
};

const OFFLINE_LINE = {
  productId: GAME.id,
  quantity: 1,
  optionId: "offline_account",
  typeId: "standard_offline",
};

let store: typeof import("@/lib/db.server");
let service: typeof import("@/lib/referral/service.server");
let rewards: typeof import("@/lib/referral/rewards.server");
let orders: typeof import("@/lib/orders.server");
let completion: typeof import("@/lib/order-completion.server");

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
  store = await import("@/lib/db.server");
  service = await import("@/lib/referral/service.server");
  rewards = await import("@/lib/referral/rewards.server");
  orders = await import("@/lib/orders.server");
  completion = await import("@/lib/order-completion.server");
});

interface SeedUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  username: string;
  /** The Telegram *person*, which two store accounts can share. */
  telegramId?: string;
  /** The Telegram *chat*, which they cannot: the column is unique. */
  telegramChatId?: number;
  walletBalance?: number;
}

/** A small stable number, so each seeded account gets its own chat id. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return hash;
}

function seedUser(user: SeedUser) {
  db.raw
    .prepare(
      `INSERT OR REPLACE INTO users
        (id, name, email, phone, password_hash, username, wallet_balance, is_admin,
         provider, settings, addresses, favorites, created_at)
       VALUES (?, ?, ?, ?, 'x', ?, ?, 0, 'password', '{}', '[]', '[]', ?)`,
    )
    .run(
      user.id,
      user.name,
      user.email,
      user.phone,
      user.username,
      user.walletBalance ?? 0,
      new Date().toISOString(),
    );

  /*
    Telegram lives in `telegram_links`, not on the user row — that is where
    every Telegram feature reads it, and where the referral checks look.
  */
  if (user.telegramId) {
    /*
      `telegram_chat_id` is unique per store account, so two accounts can never
      share one — the identity that can repeat is `telegram_user_id`, the
      person behind the chat, which is what the check compares.
    */
    db.raw
      .prepare(
        `INSERT OR REPLACE INTO telegram_links
           (user_id, telegram_chat_id, telegram_user_id, verified, linked_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run(
        user.id,
        user.telegramChatId ?? Math.abs(hashString(user.id)),
        user.telegramId,
        new Date().toISOString(),
        new Date().toISOString(),
      );
  }
}

function seedCatalogue() {
  db.raw.exec("DELETE FROM store_kv");
  db.raw.exec("DELETE FROM store_rev");
  const insert = db.raw.prepare(
    `INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)`,
  );
  insert.run(
    "store",
    JSON.stringify({
      categories: [{ id: "cat_nintendo", title: "ألعاب" }],
      settings: { referral: { enabled: true, buyerPercent: 10, referrerPercent: 10 } },
    }),
    "now",
  );
  insert.run("store:products", JSON.stringify([GAME, GIFT_CARD]), "now");
  db.raw.prepare(`INSERT INTO store_rev (rev, updated_at) VALUES (1, 'now')`).run();
  store.invalidateStoreCache();
}

/** A request as it arrives from one browser on one connection. */
function request(options: {
  cookies?: string[];
  ip?: string;
  userAgent?: string;
  url?: string;
} = {}): Request {
  const headers = new Headers({
    host: "banan.to",
    "x-forwarded-proto": "https",
    "cf-connecting-ip": options.ip ?? "37.236.0.1",
    "user-agent":
      options.userAgent ??
      "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36",
    "accept-language": "ar,en;q=0.9",
  });
  if (options.cookies?.length) headers.set("cookie", options.cookies.join("; "));
  return new Request(options.url ?? "https://banan.to/product/super-mario-odyssey", { headers });
}

/** `Set-Cookie` values reduced to what a browser would send back. */
function cookieJar(setCookies: string[], existing: string[] = []): string[] {
  const jar = new Map<string, string>();
  for (const pair of existing) {
    const [name, ...rest] = pair.split("=");
    if (name) jar.set(name, rest.join("="));
  }
  for (const header of setCookies) {
    const [pair] = header.split(";");
    const [name, ...rest] = (pair ?? "").split("=");
    if (!name) continue;
    const value = rest.join("=");
    if (value === "") jar.delete(name);
    else jar.set(name, value);
  }
  return Array.from(jar, ([name, value]) => `${name}=${value}`);
}

const REFERRER: SeedUser = {
  id: "usr_referrer",
  name: "سامي",
  email: "sami@example.com",
  phone: "+9647701111111",
  username: "sami",
};
const BUYER: SeedUser = {
  id: "usr_buyer",
  name: "علي",
  email: "ali@example.com",
  phone: "+9647702222222",
  username: "ali",
  walletBalance: 500_000,
};

/** The referrer's own device and address, as recorded when they got their link. */
const REFERRER_DEVICE = {
  ip: "37.236.10.10",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) AppleWebKit/605.1 Version/17.4 Mobile Safari/604.1",
};
/** The friend: a different phone on a different connection. */
const BUYER_DEVICE = {
  ip: "37.236.20.20",
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36",
};

async function referrerCode(): Promise<string> {
  const owner = await store.findUserById(REFERRER.id);
  const code = await service.getOrCreateReferralCode(owner!);
  return code!.code;
}

/** Put the referrer's device and address on record, as their own visit does. */
async function referrerVisits() {
  const identity = await service.requestIdentity(request(REFERRER_DEVICE));
  await service.bindIdentitiesToUser(REFERRER.id, identity);
}

beforeEach(async () => {
  for (const table of [
    "referral_rewards",
    "referral_attributions",
    "referral_risk_events",
    "referral_identity_links",
    "referral_blocklist",
    "referral_codes",
    "telegram_links",
    "orders",
    "wallet_transactions",
    "order_items_snapshot",
    "order_queue",
    "product_reviews",
    "threads",
    "messages",
    "coupons",
    "coupon_redemptions",
    "coupon_user_usage",
  ]) {
    try {
      db.raw.exec(`DELETE FROM ${table}`);
    } catch {
      // A table this build does not create is nothing to clear.
    }
  }
  seedUser(REFERRER);
  seedUser(BUYER);
  seedCatalogue();
});

/* -------------------------------------------------------------------------- */
/* 1–2. Capture, and surviving sign-in                                        */
/* -------------------------------------------------------------------------- */

describe("opening a referral link", () => {
  it("saves the attribution and hands back a signed cookie", async () => {
    const code = await referrerCode();
    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });

    expect(capture.ok).toBe(true);
    expect(capture.message).toContain("@sami");
    expect(capture.message).toContain("10%");

    const rows = db.raw.prepare(`SELECT * FROM referral_attributions`).all() as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!["referrer_user_id"]).toBe(REFERRER.id);
    expect(rows[0]!["product_id"]).toBe(GAME.id);
    expect(rows[0]!["status"]).toBe("captured");

    // The cookie is signed, not a readable blob of the referrer's id.
    const attribution = capture.setCookies.find((cookie) => cookie.startsWith("bnt_ref="));
    expect(attribution).toBeDefined();
    expect(attribution).toContain("HttpOnly");
    expect(attribution).toContain("SameSite=Lax");
    expect(attribution).toContain("Secure");
  });

  it("resolves a username in the link to the code behind it", async () => {
    await referrerCode();
    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: "@sami",
      productRef: "super-mario-odyssey",
    });
    expect(capture.ok).toBe(true);

    const row = db.raw.prepare(`SELECT referrer_user_id FROM referral_attributions`).get() as
      | Record<string, unknown>
      | undefined;
    expect(row?.["referrer_user_id"]).toBe(REFERRER.id);
  });

  it("survives a rename, because the link points at a code and not a handle", async () => {
    const code = await referrerCode();
    db.raw.prepare(`UPDATE users SET username = 'sami_new' WHERE id = ?`).run(REFERRER.id);

    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
    });
    expect(capture.ok).toBe(true);
    const row = db.raw.prepare(`SELECT referrer_user_id FROM referral_attributions`).get() as
      | Record<string, unknown>
      | undefined;
    expect(row?.["referrer_user_id"]).toBe(REFERRER.id);
  });

  it("refuses a code that does not exist, in the same words as every refusal", async () => {
    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: "NOTACODE",
    });
    expect(capture.ok).toBe(false);
    expect(capture.message).toBe(service.REFERRAL_REFUSAL_MESSAGE);
  });
});

describe("the attribution and the account", () => {
  it("moves from the guest session onto the account at sign-in", async () => {
    const code = await referrerCode();
    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });
    const jar = cookieJar(capture.setCookies);

    // Signing in: the same browser, now with an account.
    await service.bindAttributionToUser(request({ ...BUYER_DEVICE, cookies: jar }), BUYER.id);

    const row = db.raw.prepare(`SELECT * FROM referral_attributions`).get() as Record<
      string,
      unknown
    >;
    expect(row["referred_user_id"]).toBe(BUYER.id);
    expect(row["status"]).toBe("eligible");
    expect(row["bound_at"]).toBeTruthy();
  });

  it("is still in force after browsing on, with the cookie the only thing carried", async () => {
    const code = await referrerCode();
    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });
    const jar = cookieJar(capture.setCookies);

    const buyer = await store.findUserById(BUYER.id);
    const later = request({ ...BUYER_DEVICE, cookies: jar, url: "https://banan.to/cart" });
    const attribution = await service.activeAttribution(later, buyer);
    expect(attribution?.referrerUserId).toBe(REFERRER.id);
  });
});

/* -------------------------------------------------------------------------- */
/* 3–5, 17–19. Pricing                                                        */
/* -------------------------------------------------------------------------- */

describe("what the referral is worth", () => {
  async function quoteFor(lines: Parameters<typeof service.quoteReferral>[0]["lines"]) {
    const code = await referrerCode();
    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });
    const jar = cookieJar(capture.setCookies);
    await service.bindAttributionToUser(request({ ...BUYER_DEVICE, cookies: jar }), BUYER.id);

    const buyer = (await store.findUserById(BUYER.id))!;
    const attribution = await service.activeAttribution(
      request({ ...BUYER_DEVICE, cookies: jar }),
      buyer,
    );
    return service.quoteReferral({ buyer, attribution: attribution!, lines });
  }

  it("takes 10% off a 10,000 dinar game and owes the referrer 1,000", async () => {
    const quote = await quoteFor([
      {
        productId: GAME.id,
        kind: "account",
        quantity: 1,
        unitPriceIqd: 10_000,
        optionId: "offline_account",
        typeId: "standard_offline",
      },
    ]);

    expect(quote.applicable).toBe(true);
    expect(quote.originalPriceIqd).toBe(10_000);
    expect(quote.buyerDiscountIqd).toBe(1_000);
    expect(quote.referrerRewardIqd).toBe(1_000);
    expect(quote.referrerAlias).toBe("sami");
  });

  it("reads the price from the catalogue, not from the request", async () => {
    const quote = await quoteFor([
      {
        productId: GAME.id,
        kind: "account",
        quantity: 1,
        // A browser claiming the game costs a million.
        unitPriceIqd: 1_000_000,
        optionId: "offline_account",
        typeId: "standard_offline",
      },
    ]);

    expect(quote.originalPriceIqd).toBe(10_000);
    expect(quote.buyerDiscountIqd).toBe(1_000);
  });

  it("pays on one copy however many are in the basket", async () => {
    const quote = await quoteFor([
      {
        productId: GAME.id,
        kind: "account",
        quantity: 10,
        unitPriceIqd: 10_000,
        optionId: "offline_account",
        typeId: "standard_offline",
      },
    ]);

    expect(quote.buyerDiscountIqd).toBe(1_000);
    expect(quote.referrerRewardIqd).toBe(1_000);
  });

  it("refuses an online account: the offer is for offline ones", async () => {
    const quote = await quoteFor([
      {
        productId: GAME.id,
        kind: "account",
        quantity: 1,
        unitPriceIqd: 14_000,
        optionId: "online_account",
        typeId: "standard_online",
      },
    ]);
    expect(quote.applicable).toBe(false);
    expect(quote.buyerDiscountIqd).toBe(0);
  });

  it("takes the offline account with add-ons, which is still an offline account", async () => {
    const quote = await quoteFor([
      {
        productId: GAME.id,
        kind: "account",
        quantity: 1,
        unitPriceIqd: 10_000,
        optionId: "offline_account",
        typeId: "dlc_offline",
      },
    ]);
    expect(quote.applicable).toBe(true);
    expect(quote.buyerDiscountIqd).toBe(1_000);
  });

  it("refuses an eShop card, which is not in the programme", async () => {
    const quote = await quoteFor([
      {
        productId: GIFT_CARD.id,
        kind: "digital_code",
        quantity: 1,
        unitPriceIqd: 20_000,
        optionId: "offline_account",
      },
    ]);
    expect(quote.applicable).toBe(false);
    expect(quote.buyerDiscountIqd).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 6–11. Abuse                                                                */
/* -------------------------------------------------------------------------- */

describe("who a referral must not pay", () => {
  /**
   * Walk a whole attempt and report whether it ended in a discount.
   *
   * A referral can be refused at three different moments — when the link is
   * opened, when the friend signs in, and when the cart is priced — and which
   * one catches a given abuse is an implementation detail. What matters is
   * that no discount survives and that the reason was written down for the
   * admin, so this collects the outcome across all three.
   */
  async function attempt(options: {
    device?: { ip: string; userAgent: string };
    buyerId?: string;
    dropCookies?: boolean;
  }): Promise<{ applied: boolean; reasons: string[]; message: string }> {
    const device = options.device ?? BUYER_DEVICE;
    const buyerId = options.buyerId ?? BUYER.id;
    const code = await referrerCode();
    await referrerVisits();

    const reasons = new Set<string>();
    let message = "";

    const capture = await service.captureAttribution({
      request: request(device),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });
    for (const reason of capture.reasons ?? []) reasons.add(reason);
    if (!capture.ok) {
      message = capture.message;
      return { applied: false, reasons: [...reasons, ...recordedReasons()], message };
    }

    let jar = cookieJar(capture.setCookies);
    await service.bindAttributionToUser(request({ ...device, cookies: jar }), buyerId);

    /*
      "Deleting the cookie" is exactly that: the browser comes back with an
      empty jar. Whether an offer survives that is decided by the database, not
      by anything the browser kept.
    */
    if (options.dropCookies) jar = [];

    const buyer = (await store.findUserById(buyerId))!;
    const attribution = await service.activeAttribution(
      request({ ...device, cookies: jar }),
      buyer,
    );
    if (!attribution) {
      return { applied: false, reasons: [...reasons, ...recordedReasons()], message };
    }

    const identity = await service.requestIdentity(request({ ...device, cookies: jar }));
    const quote = await service.quoteReferral({
      buyer,
      attribution,
      lines: [{ ...OFFLINE_LINE, unitPriceIqd: 10_000, kind: "account" }],
      identity: {
        deviceHash: identity.deviceHash,
        ipHash: identity.ipHash,
        sessionHash: identity.sessionHash,
      },
    });
    for (const reason of quote.reasons) reasons.add(reason);
    if (quote.message) message = quote.message;

    return {
      applied: quote.applicable && quote.buyerDiscountIqd > 0,
      reasons: [...reasons, ...recordedReasons()],
      message,
    };
  }

  /** Every reason the admin trail recorded during this attempt. */
  function recordedReasons(): string[] {
    const rows = db.raw
      .prepare(`SELECT metadata FROM referral_risk_events`)
      .all() as Record<string, unknown>[];
    const found: string[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(String(row["metadata"] ?? "{}")) as { reasons?: string[] };
        for (const reason of parsed.reasons ?? []) found.push(reason);
      } catch {
        // A row we cannot parse tells us nothing; the assertions still hold.
      }
    }
    return found;
  }

  it("refuses a member their own code", async () => {
    const result = await attempt({ buyerId: REFERRER.id });
    expect(result.applied).toBe(false);
    expect(result.reasons).toContain("self_referral");
  });

  it("refuses the referrer's own device, whoever is signed in on it", async () => {
    const result = await attempt({ device: REFERRER_DEVICE });
    expect(result.applied).toBe(false);
    expect(result.reasons).toContain("same_device");
  });

  it("refuses the referrer's own address", async () => {
    // A different phone, the same home connection.
    const result = await attempt({
      device: { ip: REFERRER_DEVICE.ip, userAgent: BUYER_DEVICE.userAgent },
    });
    expect(result.applied).toBe(false);
    expect(result.reasons).toContain("same_ip");
  });

  it("refuses two accounts whose numbers are one subscriber spelled twice", async () => {
    /*
      The column is unique, so two accounts can never hold the identical
      string — which is precisely why the comparison is on the normalised
      number. `07701111111` and `+9647701111111` are one phone.
    */
    seedUser({ ...BUYER, phone: "07702222222" });
    seedUser({ ...REFERRER, phone: "+9647702222222" });
    const result = await attempt({});
    expect(result.applied).toBe(false);
    expect(result.reasons).toContain("same_phone");
  });

  it("refuses two accounts that share a mailbox after normalisation", async () => {
    seedUser({ ...REFERRER, email: "a.user+shop@gmail.com" });
    seedUser({ ...BUYER, email: "auser@googlemail.com" });
    const result = await attempt({});
    expect(result.applied).toBe(false);
    expect(result.reasons).toContain("same_email");
  });

  it("refuses two accounts behind one Telegram account", async () => {
    seedUser({ ...REFERRER, telegramId: "556677", telegramChatId: 1001 });
    seedUser({ ...BUYER, telegramId: "556677", telegramChatId: 1002 });
    const result = await attempt({});
    expect(result.applied).toBe(false);
    expect(result.reasons).toContain("same_telegram");
  });

  it("notices several accounts appearing on one device", async () => {
    const { accountsForIdentity } = await import("./risk.server");
    await referrerVisits();
    const identity = await service.requestIdentity(request(REFERRER_DEVICE));
    await service.bindIdentitiesToUser(BUYER.id, identity);

    const accounts = await accountsForIdentity("device", identity.deviceHash);
    expect(accounts).toContain(REFERRER.id);
    expect(accounts).toContain(BUYER.id);
  });

  it("is not bypassed by deleting the cookie", async () => {
    /*
      The offer stays refused with the cookie gone, because the refusal was
      never in the cookie: the device is re-derived from the request and the
      account's history is in the database.
    */
    const result = await attempt({ device: REFERRER_DEVICE, dropCookies: true });
    expect(result.applied).toBe(false);
  });

  it("refuses a circular referral: A brought B, so B cannot bring A", async () => {
    // A (the referrer) brought B (the buyer).
    const code = await referrerCode();
    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });
    await service.bindAttributionToUser(
      request({ ...BUYER_DEVICE, cookies: cookieJar(capture.setCookies) }),
      BUYER.id,
    );

    // Now B tries to bring A back.
    const buyer = (await store.findUserById(BUYER.id))!;
    const buyerCode = (await service.getOrCreateReferralCode(buyer))!;
    const third = { ip: "37.236.30.30", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/124.0" };
    const back = await service.captureAttribution({
      request: request(third),
      codeInput: buyerCode.code,
      productRef: "super-mario-odyssey",
    });
    const jar = cookieJar(back.setCookies);
    await service.bindAttributionToUser(request({ ...third, cookies: jar }), REFERRER.id);

    const row = db.raw
      .prepare(`SELECT status, blocked_reason FROM referral_attributions WHERE referrer_user_id = ?`)
      .get(BUYER.id) as Record<string, unknown> | undefined;
    expect(row?.["status"]).toBe("blocked");
    expect(String(row?.["blocked_reason"] ?? "")).toContain("circular_referral");

    // And nothing usable is left for the return trip.
    const referrer = (await store.findUserById(REFERRER.id))!;
    const attribution = await service.activeAttribution(
      request({ ...third, cookies: jar }),
      referrer,
    );
    expect(attribution).toBeUndefined();
  });

  it("refuses a member the admin has taken out of the programme", async () => {
    db.raw
      .prepare(
        `INSERT INTO referral_blocklist (user_id, reason, blocked_by, created_at) VALUES (?, 'abuse', 'admin', ?)`,
      )
      .run(REFERRER.id, new Date().toISOString());

    const result = await attempt({});
    expect(result.applied).toBe(false);
    expect(result.reasons).toContain("referrer_blocked");
  });

  it("says the same thing whatever the reason, and never names the check", async () => {
    for (const options of [
      { buyerId: REFERRER.id },
      { device: REFERRER_DEVICE },
      { device: { ip: REFERRER_DEVICE.ip, userAgent: BUYER_DEVICE.userAgent } },
    ]) {
      db.raw.exec("DELETE FROM referral_attributions");
      db.raw.exec("DELETE FROM referral_risk_events");
      const result = await attempt(options);
      expect(result.applied).toBe(false);
      if (result.message) {
        expect(result.message).toBe(service.REFERRAL_REFUSAL_MESSAGE);
        expect(result.message).not.toMatch(/device|جهاز|ip|عنوان|hash|same_/i);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 12–16, 18, 22. The order                                                   */
/* -------------------------------------------------------------------------- */

describe("the order, the wallet and the reward", () => {
  /** Take a referral all the way to a placed order, and return it. */
  async function buyThroughReferral(options: { couponCode?: string } = {}) {
    const code = await referrerCode();
    await referrerVisits();

    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });
    expect(capture.ok).toBe(true);
    const jar = cookieJar(capture.setCookies);
    const checkoutRequest = request({ ...BUYER_DEVICE, cookies: jar, url: "https://banan.to/cart" });
    await service.bindAttributionToUser(checkoutRequest, BUYER.id);

    const buyer = (await store.findUserById(BUYER.id))!;
    const order = await orders.createOrderForUser(
      buyer,
      [OFFLINE_LINE],
      undefined,
      options.couponCode,
      true,
      undefined,
      undefined,
      "checkout_web",
      undefined,
      { request: checkoutRequest },
    );
    return { order, code };
  }

  const walletRows = (userId: string) =>
    db.raw
      .prepare(`SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at`)
      .all(userId) as Record<string, unknown>[];

  const balanceOf = (userId: string) =>
    Number(
      (db.raw.prepare(`SELECT wallet_balance FROM users WHERE id = ?`).get(userId) as
        | Record<string, unknown>
        | undefined)?.["wallet_balance"] ?? 0,
    );

  const rewardRow = (orderId: string) =>
    db.raw.prepare(`SELECT * FROM referral_rewards WHERE order_id = ?`).get(orderId) as
      | Record<string, unknown>
      | undefined;

  it("charges the discounted price and records both sides on the order", async () => {
    const { order } = await buyThroughReferral();

    expect(order.discountAmount).toBe(1_000);
    expect(order.total).toBe(9_000);
    expect(order.referral?.originalPriceIqd).toBe(10_000);
    expect(order.referral?.buyerDiscountIqd).toBe(1_000);
    expect(order.referral?.referrerRewardIqd).toBe(1_000);
    expect(order.referral?.referrerUserId).toBe(REFERRER.id);
    expect(order.referral?.referredUserId).toBe(BUYER.id);
    expect(order.referral?.productId).toBe(GAME.id);
    expect(order.referral?.buyerPercentBps).toBe(1000);
    expect(order.referral?.riskVerdict).toBe("clear");
    expect(order.referral?.rewardStatus).toBe("pending");

    // The wallet was debited 9,000 — the discounted price, not the list price.
    expect(balanceOf(BUYER.id)).toBe(491_000);
  });

  it("does not pay the referrer before the order completes", async () => {
    const { order } = await buyThroughReferral();

    expect(rewardRow(order.id)?.["status"]).toBe("pending");
    expect(balanceOf(REFERRER.id)).toBe(0);
    expect(walletRows(REFERRER.id)).toHaveLength(0);
  });

  it("pays the referrer once when the order completes", async () => {
    const { order } = await buyThroughReferral();
    await completion.completeOrder(order, {
      by: "admin_1",
      role: "ADMIN",
      note: "done",
      message: "تم إكمال الطلب",
    });

    expect(rewardRow(order.id)?.["status"]).toBe("approved");
    expect(balanceOf(REFERRER.id)).toBe(1_000);

    const ledger = walletRows(REFERRER.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!["kind"]).toBe("referral_reward");
    expect(ledger[0]!["amount"]).toBe(1_000);
    expect(String(ledger[0]!["description"])).toContain("مكافأة إحالة");
    // The idempotency key: the order and the game.
    expect(ledger[0]!["reference_type"]).toBe("referral_reward");
    expect(ledger[0]!["reference_id"]).toBe(`${order.id}:${GAME.id}`);
  });

  it("does not pay twice when the order is completed again", async () => {
    const { order } = await buyThroughReferral();
    const complete = () =>
      completion.completeOrder(order, {
        by: "admin_1",
        role: "ADMIN",
        note: "done",
        message: "تم إكمال الطلب",
      });

    await complete();
    const first = balanceOf(REFERRER.id);
    await complete();
    await rewards.approveRewardsForOrder({ ...order, status: "completed" });

    expect(balanceOf(REFERRER.id)).toBe(first);
    expect(walletRows(REFERRER.id)).toHaveLength(1);
  });

  it("writes one reward per order, whatever is retried", async () => {
    const { order } = await buyThroughReferral();
    const rows = db.raw
      .prepare(`SELECT COUNT(*) AS total FROM referral_rewards WHERE order_id = ?`)
      .get(order.id) as Record<string, unknown>;
    expect(Number(rows["total"])).toBe(1);

    // A second reward for the same order is refused by the database itself.
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO referral_rewards
             (id, order_id, order_item_id, product_id, referrer_user_id, buyer_user_id,
              status, created_at, updated_at)
           VALUES ('rrw_dup', ?, 'itm_other', ?, ?, ?, 'pending', 'now', 'now')`,
        )
        .run(order.id, GAME.id, REFERRER.id, BUYER.id),
    ).toThrow();
  });

  it("re-submitting the same checkout returns the first order and pays once", async () => {
    const code = await referrerCode();
    await referrerVisits();
    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });
    const jar = cookieJar(capture.setCookies);
    const checkoutRequest = request({ ...BUYER_DEVICE, cookies: jar });
    await service.bindAttributionToUser(checkoutRequest, BUYER.id);

    const buyer = (await store.findUserById(BUYER.id))!;
    const key = "idem_referral_1";
    const first = await orders.createOrderForUser(
      buyer,
      [OFFLINE_LINE],
      undefined,
      undefined,
      true,
      key,
      undefined,
      "checkout_web",
      undefined,
      { request: checkoutRequest },
    );
    const again = await orders.createOrderForUser(
      (await store.findUserById(BUYER.id))!,
      [OFFLINE_LINE],
      undefined,
      undefined,
      true,
      key,
      undefined,
      "checkout_web",
      undefined,
      { request: checkoutRequest },
    );

    expect(again.id).toBe(first.id);
    const total = db.raw.prepare(`SELECT COUNT(*) AS total FROM referral_rewards`).get() as Record<
      string,
      unknown
    >;
    expect(Number(total["total"])).toBe(1);
  });

  it("cannot be spent twice: a second order gets no referral", async () => {
    const { order } = await buyThroughReferral();
    expect(order.referral).toBeDefined();

    // The attribution is spent, so the same cookie buys nothing more.
    const attribution = db.raw
      .prepare(`SELECT status, converted_order_id FROM referral_attributions`)
      .get() as Record<string, unknown>;
    expect(attribution["status"]).toBe("converted");
    expect(attribution["converted_order_id"]).toBe(order.id);
  });

  it("pays nothing for a cancelled order", async () => {
    const { order } = await buyThroughReferral();
    await rewards.reverseRewardsForOrder({
      order: { id: order.id, code: order.code },
      refundedIqd: order.total,
      paidIqd: order.total,
      reason: "order_cancelled",
    });

    expect(rewardRow(order.id)?.["status"]).toBe("reversed");
    expect(balanceOf(REFERRER.id)).toBe(0);
    expect(walletRows(REFERRER.id)).toHaveLength(0);
  });

  it("takes an approved reward back when the order is refunded", async () => {
    const { order } = await buyThroughReferral();
    await completion.completeOrder(order, {
      by: "admin_1",
      role: "ADMIN",
      note: "done",
      message: "تم إكمال الطلب",
    });
    expect(balanceOf(REFERRER.id)).toBe(1_000);

    await rewards.reverseRewardsForOrder({
      order: { id: order.id, code: order.code },
      refundedIqd: order.total,
      paidIqd: order.total,
      reason: "order_refunded",
    });

    expect(rewardRow(order.id)?.["status"]).toBe("reversed");
    expect(balanceOf(REFERRER.id)).toBe(0);

    const ledger = walletRows(REFERRER.id);
    expect(ledger).toHaveLength(2);
    expect(ledger[1]!["kind"]).toBe("referral_reversal");
    expect(ledger[1]!["amount"]).toBe(-1_000);
  });

  it("reverses only the refunded share of a partial refund", async () => {
    const { order } = await buyThroughReferral();
    await completion.completeOrder(order, {
      by: "admin_1",
      role: "ADMIN",
      note: "done",
      message: "تم إكمال الطلب",
    });

    // Half the order came back.
    await rewards.reverseRewardsForOrder({
      order: { id: order.id, code: order.code },
      refundedIqd: Math.floor(order.total / 2),
      paidIqd: order.total,
      reason: "partial_refund",
    });

    expect(balanceOf(REFERRER.id)).toBe(500);
    const row = rewardRow(order.id);
    expect(row?.["reversed_amount_iqd"]).toBe(500);
    // Still approved: half of it is still earned.
    expect(row?.["status"]).toBe("approved");
  });

  it("never reverses more than the wallet holds", async () => {
    const { order } = await buyThroughReferral();
    await completion.completeOrder(order, {
      by: "admin_1",
      role: "ADMIN",
      note: "done",
      message: "تم إكمال الطلب",
    });
    // The referrer spent it before the refund landed.
    db.raw.prepare(`UPDATE users SET wallet_balance = 200 WHERE id = ?`).run(REFERRER.id);

    await rewards.reverseRewardsForOrder({
      order: { id: order.id, code: order.code },
      refundedIqd: order.total,
      paidIqd: order.total,
      reason: "order_refunded",
    });

    expect(balanceOf(REFERRER.id)).toBe(0);
    expect(rewardRow(order.id)?.["status"]).toBe("reversed");
  });
});

/* -------------------------------------------------------------------------- */
/* 18. Coupons                                                                */
/* -------------------------------------------------------------------------- */

describe("a coupon and a referral in the same cart", () => {
  function seedCoupon(code: string, percent: number) {
    db.raw
      .prepare(
        `INSERT INTO coupons (id, code, discount_type, discount_value, is_active, per_user_limit, created_at)
         VALUES (?, ?, 'percentage', ?, 1, 5, ?)`,
      )
      .run(`cpn_${code}`, code, percent, new Date().toISOString());
  }

  async function checkout(couponCode?: string) {
    const code = await referrerCode();
    await referrerVisits();
    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });
    const jar = cookieJar(capture.setCookies);
    const checkoutRequest = request({ ...BUYER_DEVICE, cookies: jar });
    await service.bindAttributionToUser(checkoutRequest, BUYER.id);

    const buyer = (await store.findUserById(BUYER.id))!;
    return orders.createOrderForUser(
      buyer,
      [OFFLINE_LINE],
      undefined,
      couponCode,
      true,
      undefined,
      undefined,
      "checkout_web",
      undefined,
      { request: checkoutRequest },
    );
  }

  it("does not stack them: the buyer gets the better one", async () => {
    // A 25% coupon beats the 10% referral.
    seedCoupon("BIG25", 25);
    const order = await checkout("BIG25");

    expect(order.discountAmount).toBe(2_500);
    expect(order.total).toBe(7_500);
    // 2,500 + 1,000 would be stacking; it is not.
    expect(order.discountAmount).not.toBe(3_500);
    expect(order.couponCode).toBe("BIG25");
    expect(order.referral).toBeUndefined();
    // The referral was not spent, so it is still available.
    const attribution = db.raw
      .prepare(`SELECT status FROM referral_attributions`)
      .get() as Record<string, unknown>;
    expect(attribution["status"]).not.toBe("converted");
  });

  it("keeps the referral when it beats the coupon, and leaves the coupon unspent", async () => {
    // A 5% coupon loses to the 10% referral.
    seedCoupon("SMALL5", 5);
    const order = await checkout("SMALL5");

    expect(order.discountAmount).toBe(1_000);
    expect(order.total).toBe(9_000);
    expect(order.couponCode).toBeUndefined();
    expect(order.referral?.buyerDiscountIqd).toBe(1_000);

    // The coupon was never claimed, so the member still has its single use.
    const redemptions = db.raw
      .prepare(`SELECT COUNT(*) AS total FROM coupon_redemptions`)
      .get() as Record<string, unknown>;
    expect(Number(redemptions["total"])).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 19–20. What the server decides, and what it never says                     */
/* -------------------------------------------------------------------------- */

describe("nothing sensitive escapes", () => {
  it("stores addresses and devices as hashes, never in the clear", async () => {
    const code = await referrerCode();
    await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });

    const row = db.raw.prepare(`SELECT * FROM referral_attributions`).get() as Record<
      string,
      unknown
    >;
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(BUYER_DEVICE.ip);
    expect(stored).not.toContain("Pixel 8");
    expect(stored).not.toContain("Mozilla");
    // What is stored is a keyed digest, and it is not reversible.
    expect(String(row["ip_hash"])).toMatch(/^[0-9a-f]{32}$/);
    expect(String(row["device_hash"])).toMatch(/^[0-9a-f]{32}$/);
    expect(String(row["ip_hash"])).not.toBe(String(row["device_hash"]));
  });

  it("keeps the risk trail free of raw identifiers too", async () => {
    const code = await referrerCode();
    await referrerVisits();
    await service.captureAttribution({
      request: request(REFERRER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });

    const events = db.raw.prepare(`SELECT * FROM referral_risk_events`).all();
    const stored = JSON.stringify(events);
    expect(stored).not.toContain(REFERRER_DEVICE.ip);
    expect(stored).not.toContain("iPhone");
    expect(stored).not.toContain(REFERRER.phone);
    expect(stored).not.toContain(REFERRER.email);
  });

  it("hashes the same address differently for a different purpose", async () => {
    const { referralHash } = await import("./identity.server");
    const asIp = await referralHash("ip", "37.236.0.1");
    const asDevice = await referralHash("device", "37.236.0.1");
    expect(asIp).not.toBe(asDevice);
  });

  it("gives an unknown contact detail an empty hash, not the hash of nothing", async () => {
    const { contactHashes } = await import("./identity.server");
    const hashes = await contactHashes({ phone: null, email: null, telegramId: null });
    expect(hashes.phoneHash).toBe("");
    expect(hashes.emailHash).toBe("");
    expect(hashes.telegramHash).toBe("");
  });

  it("puts nothing readable in the attribution cookie", async () => {
    const code = await referrerCode();
    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });
    const cookie = capture.setCookies.find((entry) => entry.startsWith("bnt_ref="))!;
    const value = decodeURIComponent(cookie.split(";")[0]!.split("=").slice(1).join("="));

    // It carries ids and a signature — no name, no address, no device.
    expect(value).not.toContain(BUYER_DEVICE.ip);
    expect(value).not.toContain(REFERRER.name);
    expect(value).not.toContain("Pixel");
  });

  it("refuses a cookie whose contents were edited", async () => {
    const { verifyAttributionToken } = await import("./cookies.server");
    const code = await referrerCode();
    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
    });
    const cookie = capture.setCookies.find((entry) => entry.startsWith("bnt_ref="))!;
    const signed = decodeURIComponent(cookie.split(";")[0]!.split("=").slice(1).join("="));

    expect(await verifyAttributionToken(signed)).toBeDefined();

    // Name a different referrer, keeping the signature: it no longer verifies.
    const forged = signed.replace(REFERRER.id, "usr_attacker");
    expect(await verifyAttributionToken(forged)).toBeUndefined();

    // Extend the window by hand: same answer.
    const parts = signed.split(":");
    const stretched = [...parts];
    stretched[6] = String(Number(parts[6]) + 999_999);
    expect(await verifyAttributionToken(stretched.join(":"))).toBeUndefined();
  });

  it("expires on its own once the window has passed", async () => {
    const { signAttributionToken, verifyAttributionToken } = await import("./cookies.server");
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await signAttributionToken({
      attributionId: "rat_1",
      referralCodeId: "rfc_1",
      referrerUserId: REFERRER.id,
      productId: GAME.id,
      capturedAt: past - 100,
      expiresAt: past,
    });
    expect(await verifyAttributionToken(token)).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 16. One code, and only before the order                                    */
/* -------------------------------------------------------------------------- */

describe("only one referral can touch an order", () => {
  const THIRD: SeedUser = {
    id: "usr_third",
    name: "حسن",
    email: "hasan@example.com",
    phone: "+9647703333333",
    username: "hasan",
  };

  it("replaces the first code rather than adding a second", async () => {
    seedUser(THIRD);
    const first = await referrerCode();
    const other = (await service.getOrCreateReferralCode((await store.findUserById(THIRD.id))!))!;

    const capture1 = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: first,
      productRef: "super-mario-odyssey",
    });
    let jar = cookieJar(capture1.setCookies);
    await service.bindAttributionToUser(request({ ...BUYER_DEVICE, cookies: jar }), BUYER.id);

    const capture2 = await service.captureAttribution({
      request: request({ ...BUYER_DEVICE, cookies: jar }),
      codeInput: other.code,
      productRef: "super-mario-odyssey",
      viewer: (await store.findUserById(BUYER.id))!,
    });
    expect(capture2.ok).toBe(true);
    jar = cookieJar(capture2.setCookies, jar);

    // Exactly one referral is in force, and it is the one most recently applied.
    const checkoutRequest = request({ ...BUYER_DEVICE, cookies: jar });
    const attribution = await service.activeAttribution(
      checkoutRequest,
      (await store.findUserById(BUYER.id))!,
    );
    expect(attribution?.referrerUserId).toBe(THIRD.id);

    const order = await orders.createOrderForUser(
      (await store.findUserById(BUYER.id))!,
      [OFFLINE_LINE],
      undefined,
      undefined,
      true,
      undefined,
      undefined,
      "checkout_web",
      undefined,
      { request: checkoutRequest },
    );

    // One discount, one reward, one beneficiary.
    expect(order.discountAmount).toBe(1_000);
    expect(order.referral?.referrerUserId).toBe(THIRD.id);
    const rows = db.raw
      .prepare(`SELECT referrer_user_id FROM referral_rewards WHERE order_id = ?`)
      .all(order.id) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!["referrer_user_id"]).toBe(THIRD.id);
  });

  it("cannot be attached to an order that already exists", async () => {
    // An order placed with no referral at all.
    const buyer = (await store.findUserById(BUYER.id))!;
    const plain = await orders.createOrderForUser(buyer, [OFFLINE_LINE], undefined, undefined, true);
    expect(plain.referral).toBeUndefined();
    expect(plain.total).toBe(10_000);

    // Applying a code afterwards captures an attribution for *next* time; it
    // changes nothing about the order that was already paid.
    const code = await referrerCode();
    await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
      viewer: buyer,
    });

    const stored = await store.getOrder(plain.id);
    expect(stored?.referral).toBeUndefined();
    expect(stored?.total).toBe(10_000);
    expect(db.raw.prepare(`SELECT COUNT(*) AS total FROM referral_rewards`).get()).toEqual({
      total: 0,
    });
  });

  it("does not let a second checkout re-use a spent referral", async () => {
    const code = await referrerCode();
    const capture = await service.captureAttribution({
      request: request(BUYER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });
    const jar = cookieJar(capture.setCookies);
    const checkoutRequest = request({ ...BUYER_DEVICE, cookies: jar });
    await service.bindAttributionToUser(checkoutRequest, BUYER.id);

    const buy = async () =>
      orders.createOrderForUser(
        (await store.findUserById(BUYER.id))!,
        [OFFLINE_LINE],
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        "checkout_web",
        undefined,
        { request: checkoutRequest },
      );

    const first = await buy();
    const second = await buy();

    expect(first.referral?.buyerDiscountIqd).toBe(1_000);
    expect(second.referral).toBeUndefined();
    expect(second.total).toBe(10_000);
    expect(db.raw.prepare(`SELECT COUNT(*) AS total FROM referral_rewards`).get()).toEqual({
      total: 1,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Opening your own link, and the address rule                                */
/* -------------------------------------------------------------------------- */

describe("a member opening their own share link", () => {
  it("is told it is their own link, not that something failed", async () => {
    const code = await referrerCode();
    const owner = (await store.findUserById(REFERRER.id))!;

    const capture = await service.captureAttribution({
      request: request(REFERRER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
      viewer: owner,
    });

    expect(capture.ok).toBe(false);
    expect(capture.selfReferral).toBe(true);
    // Named, because a member cannot learn anything from being told a link is
    // theirs — every other refusal keeps the single generic sentence.
    expect(capture.message).not.toBe(service.REFERRAL_REFUSAL_MESSAGE);
    expect(capture.message).toContain("رابط دعوتك");
    expect(capture.reasons).toContain("self_referral");
  });

  it("writes no attribution for it", async () => {
    const code = await referrerCode();
    const owner = (await store.findUserById(REFERRER.id))!;
    await service.captureAttribution({
      request: request(REFERRER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
      viewer: owner,
    });

    expect(db.raw.prepare(`SELECT COUNT(*) AS total FROM referral_attributions`).get()).toEqual({
      total: 0,
    });
  });

  it("still refuses a stranger who is genuinely on the referrer's device", async () => {
    // The named message is for the owner only; everyone else gets the one line.
    await referrerVisits();
    const code = await referrerCode();
    const capture = await service.captureAttribution({
      request: request(REFERRER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
      viewer: (await store.findUserById(BUYER.id))!,
    });

    expect(capture.ok).toBe(false);
    expect(capture.selfReferral).toBeUndefined();
    expect(capture.message).toBe(service.REFERRAL_REFUSAL_MESSAGE);
  });
});

describe("two people behind one network address", () => {
  /** Same connection, different phones — the ordinary case on a home line. */
  const SAME_NETWORK = { ip: REFERRER_DEVICE.ip, userAgent: BUYER_DEVICE.userAgent };

  async function captureFromSameNetwork() {
    await referrerVisits();
    const code = await referrerCode();
    return service.captureAttribution({
      request: request(SAME_NETWORK),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });
  }

  it("is refused while the rule is on, which is the default", async () => {
    const capture = await captureFromSameNetwork();
    expect(capture.ok).toBe(false);
    expect(capture.reasons).toContain("same_ip");
  });

  it("is allowed once the admin switches the rule off", async () => {
    db.raw.prepare(`UPDATE store_kv SET value = ? WHERE key = 'store'`).run(
      JSON.stringify({
        categories: [{ id: "cat_nintendo", title: "ألعاب" }],
        settings: {
          referral: { enabled: true, buyerPercent: 10, referrerPercent: 10, blockSameIp: false },
        },
      }),
    );
    store.invalidateStoreCache();

    const capture = await captureFromSameNetwork();
    expect(capture.ok).toBe(true);
    expect(capture.reasons ?? []).not.toContain("same_ip");
  });

  it("keeps refusing the referrer's own device even with the rule off", async () => {
    db.raw.prepare(`UPDATE store_kv SET value = ? WHERE key = 'store'`).run(
      JSON.stringify({
        settings: {
          referral: { enabled: true, buyerPercent: 10, referrerPercent: 10, blockSameIp: false },
        },
      }),
    );
    store.invalidateStoreCache();

    await referrerVisits();
    const code = await referrerCode();
    const capture = await service.captureAttribution({
      request: request(REFERRER_DEVICE),
      codeInput: code,
      productRef: "super-mario-odyssey",
    });

    // The device check is the sharper of the two and is not switchable.
    expect(capture.ok).toBe(false);
    expect(capture.reasons).toContain("same_device");
  });
});
