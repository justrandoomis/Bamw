/**
 * Which messages a member has asked to receive.
 *
 * ## What this replaces
 *
 * `/telegram/notifications` was a mock. Four toggles, a fake half-second
 * spinner, and `setSettings` on local component state — the comment beside it
 * said "In a real app, fetch actual notification settings here". A member who
 * turned promotional messages off watched the switch slide across and kept
 * receiving them, and had no way to find out that it had done nothing.
 *
 * A preference nothing reads is still a mock, just a persisted one. So this
 * module is both halves: the shape that is stored on the member, and the
 * decision every member-facing send now goes through.
 *
 * ## Why the default is on
 *
 * Every one of these messages is being delivered today. Defaulting a category
 * to off would silently stop notifications for every member who never opens
 * this screen — a change nobody asked for, dressed up as a preference. So an
 * unset preference means what happens now, and only an explicit "off" changes
 * anything.
 *
 * ## Why security cannot be switched off
 *
 * The sign-in code is delivered over Telegram. A member who switches that off
 * is a member who cannot sign in, and who will not connect their own toggle to
 * the code that never arrives. It is shown on the screen as always on rather
 * than as a switch that refuses to move.
 */

export type NotificationCategory = "orders" | "messages" | "promotions" | "security";

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  "orders",
  "messages",
  "promotions",
  "security",
];

/** The categories a member may turn off. `security` is deliberately absent. */
export const SWITCHABLE_CATEGORIES: readonly Exclude<NotificationCategory, "security">[] = [
  "orders",
  "messages",
  "promotions",
];

export interface NotificationPreferences {
  /** Order placed, status changed, account delivered, top-up approved. */
  orders: boolean;
  /** A reply from support. */
  messages: boolean;
  /** A price drop on a favourite, a discount code after a review. */
  promotions: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  orders: true,
  messages: true,
  promotions: true,
};

/** Where the preferences live inside `users.settings`. */
export const NOTIFICATION_SETTINGS_KEY = "notifications";

/**
 * Read the preferences out of a member's settings blob.
 *
 * Anything missing, malformed or of the wrong type reads as the default, so a
 * settings blob written by an older version of the app — or by hand — cannot
 * silence a member by accident.
 */
export function readNotificationPreferences(
  settings: object | undefined | null,
): NotificationPreferences {
  // `object` rather than an index signature, so a declared `UserSettings`
  // passes without every caller casting it first.
  const raw = (settings as Record<string, unknown> | undefined)?.[NOTIFICATION_SETTINGS_KEY];
  if (!raw || typeof raw !== "object") return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  const row = raw as Record<string, unknown>;
  const read = (key: keyof NotificationPreferences) =>
    typeof row[key] === "boolean" ? (row[key] as boolean) : DEFAULT_NOTIFICATION_PREFERENCES[key];
  return {
    orders: read("orders"),
    messages: read("messages"),
    promotions: read("promotions"),
  };
}

/** Only the three switchable keys, as booleans — nothing else is stored. */
export function sanitizeNotificationPreferences(input: unknown): Partial<NotificationPreferences> {
  if (!input || typeof input !== "object") return {};
  const row = input as Record<string, unknown>;
  const clean: Partial<NotificationPreferences> = {};
  for (const key of SWITCHABLE_CATEGORIES) {
    if (typeof row[key] === "boolean") clean[key] = row[key] as boolean;
  }
  return clean;
}

/**
 * May this category be sent to this member?
 *
 * `security` is always true: a sign-in code is not a preference.
 */
export function allowsNotification(
  settings: object | undefined | null,
  category: NotificationCategory,
): boolean {
  if (category === "security") return true;
  return readNotificationPreferences(settings)[category];
}
