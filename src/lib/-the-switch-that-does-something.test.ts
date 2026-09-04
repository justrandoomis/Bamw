/**
 * The notification toggles, which used to do nothing at all.
 *
 * `/telegram/notifications` was four switches over local component state, a
 * fake half-second spinner, and a comment reading "In a real app, fetch actual
 * notification settings here". A member who turned promotional messages off
 * watched the switch slide across and kept receiving them, with no way to find
 * out that it had done nothing.
 *
 * A preference nothing reads is still a mock, just a persisted one — so the
 * half that matters is the guard at the point of sending, and that is most of
 * what is checked here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  allowsNotification,
  readNotificationPreferences,
  sanitizeNotificationPreferences,
  SWITCHABLE_CATEGORIES,
} from "./notification-preferences";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");

describe("a member who has set nothing", () => {
  it("keeps every message they get today", () => {
    /*
      Every one of these is being delivered right now. Defaulting a category to
      off would silently stop notifications for every member who never opens
      the screen — a change nobody asked for, dressed up as a preference.
    */
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({
      orders: true,
      messages: true,
      promotions: true,
    });
    for (const category of SWITCHABLE_CATEGORIES) {
      expect(allowsNotification(undefined, category), category).toBe(true);
      expect(allowsNotification({}, category), category).toBe(true);
      expect(allowsNotification({ notifications: {} }, category), category).toBe(true);
    }
  });

  it("is not silenced by a settings blob written by an older version", () => {
    for (const junk of [
      { notifications: null },
      { notifications: "off" },
      { notifications: [] },
      { notifications: { orders: "no", messages: 0, promotions: null } },
    ]) {
      expect(readNotificationPreferences(junk), JSON.stringify(junk)).toEqual(
        DEFAULT_NOTIFICATION_PREFERENCES,
      );
    }
  });
});

describe("a member who has switched one off", () => {
  const settings = { notifications: { orders: true, messages: false, promotions: false } };

  it("stops getting that category", () => {
    expect(allowsNotification(settings, "messages")).toBe(false);
    expect(allowsNotification(settings, "promotions")).toBe(false);
  });

  it("keeps the ones they left on", () => {
    expect(allowsNotification(settings, "orders")).toBe(true);
  });

  it("still gets their sign-in code", () => {
    /*
      The code arrives over Telegram. A member who could switch it off is a
      member who cannot sign in, and who will never connect their own toggle to
      the code that does not arrive.
    */
    expect(allowsNotification({ notifications: { security: false } }, "security")).toBe(true);
    expect(SWITCHABLE_CATEGORIES).not.toContain("security");
  });
});

describe("what may be stored", () => {
  it("is the three booleans and nothing else", () => {
    expect(
      sanitizeNotificationPreferences({
        orders: false,
        messages: true,
        promotions: false,
        security: false,
        admin: true,
        nested: { anything: 1 },
      }),
    ).toEqual({ orders: false, messages: true, promotions: false });
  });

  it("ignores a value that is not a boolean rather than coercing it", () => {
    expect(sanitizeNotificationPreferences({ orders: "false", messages: 1 })).toEqual({});
    expect(sanitizeNotificationPreferences(null)).toEqual({});
    expect(sanitizeNotificationPreferences("orders")).toEqual({});
  });

  it("is filtered where the profile is written", () => {
    const profile = withoutComments(source("src/routes/api/profile.ts"));
    expect(profile).toContain("sanitizeNotificationPreferences");
  });
});

describe("every member-facing send", () => {
  /*
    The mapping the screen promises, and where each one is enforced. A send
    that is not on this list and not deliberately exempt below is a switch that
    does nothing for that message.
  */
  const GUARDED: { file: string; what: string; category: string }[] = [
    { file: "src/lib/orders.server.ts", what: "the order confirmation", category: "orders" },
    {
      file: "src/lib/telegram-notifications.server.ts",
      what: "the order status and the delivered account",
      category: "orders",
    },
    { file: "src/lib/review-reward.server.ts", what: "the completed order", category: "orders" },
    { file: "src/lib/db.server.ts", what: "the support reply and the top-up verdict", category: "orders" },
  ];

  for (const entry of GUARDED) {
    it(`asks before sending ${entry.what}`, () => {
      const text = withoutComments(source(entry.file));
      expect(text).toContain("memberAllowsNotification");
    });
  }

  it("checks the price alert against the rows it already loaded", () => {
    /*
      The watchers are read out of the users table a few lines above, so
      honouring the preference there costs no extra query — a per-member lookup
      inside that loop would be one query per watcher per repriced product.
    */
    const db = withoutComments(source("src/lib/db.server.ts"));
    expect(db).toContain('allowsNotification(u.settings, "promotions")');
  });

  it("leaves a release alert and a referral payout alone", () => {
    /*
      Neither is a promotion. A release alert is a message the member asked for
      by name, by pre-registering for that one game — folding it into a blanket
      switch would let a toggle set months ago cancel a request made yesterday.
      A referral payout is their money.
    */
    const jobs = withoutComments(source("src/lib/scheduled-jobs.server.ts"));
    const referral = withoutComments(source("src/lib/referral/notifications.server.ts"));
    expect(jobs).not.toContain("memberAllowsNotification");
    expect(referral).not.toContain("memberAllowsNotification");
  });

  it("never lets the check itself silence a message", () => {
    /*
      A failed lookup allows the send. These messages are the shop keeping its
      side of a transaction, and a database hiccup must not be able to drop
      one. The preference exists to honour an explicit "no", not to invent one.
    */
    const guard = source("src/lib/notification-preferences.server.ts");
    expect(guard).toContain("if (!user) return true;");
    expect(guard).toContain("return true;\n  }\n}");
  });
});

describe("the screen", () => {
  const screen = withoutComments(source("src/routes/telegram/notifications.tsx"));

  it("reads the member's real settings", () => {
    // Prettier splits the call across lines, so match the method, not the chain.
    expect(screen).toMatch(/api\s*\.\s*me\(\)/);
    expect(screen).toContain("readNotificationPreferences");
  });

  it("saves the change instead of only moving the switch", () => {
    expect(screen).toContain("api.updateProfile({ settings: { notifications: next } })");
  });

  it("puts the switch back when the save fails", () => {
    expect(screen).toContain("setSettings(settings);");
    expect(screen).toContain("لم يتم حفظ التغيير");
  });

  it("has no fake spinner left in it", () => {
    expect(screen).not.toContain("setTimeout(() => setLoading(false)");
    expect(screen).not.toContain("In a real app");
  });

  it("shows security as mandatory rather than as a switch that will not move", () => {
    expect(screen).toContain("إلزامي");
    expect(screen).not.toContain('toggleSetting("security")');
  });
});
