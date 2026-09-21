/**
 * What winning a game actually gets you: a coupon that pays for it.
 *
 * The alternatives were worse. Creating a zero-price order would put a
 * giveaway into the shop's sales figures, and the owner's standing rule is
 * that sales data is not to be moved by anything I build. A separate
 * fulfilment queue would mean a second delivery surface for the admin to
 * remember, beside the one they already work in every day.
 *
 * A coupon reuses everything: the member claims the prize by going through
 * checkout as usual, the order lands in the normal digital-delivery queue, and
 * the admin prepares it exactly like any other. The coupon engine already
 * enforces every guarantee this needs — one member (`eligible_users`), one
 * product (`eligible_products`), one use (`usage_limit`), and an expiry — and
 * `checkCoupon` already refuses anybody else who learns the code.
 */

import { d1Run, d1RunChanges, ensureCouponsSchema } from "./d1.server";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** No O/0 or I/1: this gets read aloud and typed off a screenshot. */
function mintCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return `WIN-${code}`;
}

/**
 * A 100% coupon for one game, one member, one use.
 *
 * `coupons.code` is UNIQUE, so a collision is retried — three attempts,
 * because a fourth would mean the CSPRNG is broken rather than unlucky.
 */
export async function issuePrizeCoupon(input: {
  userId: string;
  productId: string;
  issuedAt: string;
  expiresAt: string;
}): Promise<string> {
  await ensureCouponsSchema();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = mintCode();
    try {
      const inserted = await d1RunChanges(
        `INSERT OR IGNORE INTO coupons (
           id, code, discount_type, discount_value, start_at, expiration_at,
           usage_limit, per_user_limit, eligible_products, eligible_categories,
           eligible_users, min_order_amount, max_discount_amount, is_active,
           only_digital_products, is_stackable, once_per_user_lifetime, created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        `cpn_wheel_${code}`,
        code,
        "percentage",
        100,
        input.issuedAt,
        input.expiresAt,
        1,
        1,
        JSON.stringify([input.productId]),
        "[]",
        JSON.stringify([input.userId]),
        0,
        null,
        1,
        0,
        /*
          Not stackable. A prize that pays the whole price cannot also be
          combined with a discount, and letting it would make the order total
          negative rather than free.
        */
        0,
        0,
        input.issuedAt,
      );
      if (inserted === 1) return code;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  throw new Error("WHEEL_PRIZE_COUPON_FAILED");
}

/**
 * Revoke a prize coupon that was issued for a spin that then failed.
 *
 * Only ever called on a code this module minted moments earlier and only when
 * the spin it belonged to could not be recorded — which is why it is a delete
 * rather than a deactivation: there is no history worth keeping for a prize
 * nobody was ever told about.
 */
export async function revokePrizeCoupon(code: string): Promise<void> {
  if (!code) return;
  await d1Run(`DELETE FROM coupons WHERE code = ? AND id = ?`, code, `cpn_wheel_${code}`).catch(
    () => undefined,
  );
}
