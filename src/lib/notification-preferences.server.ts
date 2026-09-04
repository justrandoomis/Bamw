/**
 * The preference check, at the point of sending.
 *
 * Every member-facing Telegram message goes through this, so "turn promotions
 * off" is a fact about the shop rather than a claim on a screen.
 *
 * ## What it refuses to gate
 *
 * A release alert and a referral payout are not promotions, and they are not
 * gated here:
 *
 *   - a release alert is a message the member asked for by name, by
 *     pre-registering for that one game. Folding it into a blanket
 *     "promotions" switch would let a toggle they set months ago cancel a
 *     request they made yesterday;
 *   - a referral payout is their money.
 *
 * ## Never louder than the send it guards
 *
 * A failed lookup allows the send. These messages are the shop keeping its side
 * of a transaction — an order confirmation, an account delivered, a support
 * reply — and a database hiccup must not be able to silence one. The preference
 * exists to honour a member's explicit "no", not to invent one.
 */

import { allowsNotification, type NotificationCategory } from "./notification-preferences";

export async function memberAllowsNotification(
  userId: string,
  category: NotificationCategory,
): Promise<boolean> {
  if (category === "security") return true;
  if (!userId) return true;
  try {
    const { findUserById } = await import("./db.server");
    const user = await findUserById(userId);
    // A member the lookup cannot find is not a member who said no.
    if (!user) return true;
    return allowsNotification(user.settings, category);
  } catch (error) {
    console.warn("[notifications:preference_lookup_failed]", {
      category,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}
