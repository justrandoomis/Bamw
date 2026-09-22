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
 * A coupon that pays for ONE copy of one game, for one member, once.
 *
 * ## Why this is a `fixed` coupon and not 100%
 *
 * It was `percentage` 100 on `eligible_products: [productId]`, which reads
 * exactly like what was asked for and is not what it does. A product-scoped
 * percentage is taken against `eligibleSubtotal`, and that is
 * `unitPrice × quantity` — so the prize paid for however many copies of the
 * won game were in the cart. `orders.server.ts` clamps a line's quantity to
 * 1..99, which made a single spin worth up to ninety-nine free games.
 *
 * A `fixed` coupon worth the game's price cannot do that: the discount is
 * `min(discountValue, eligibleSubtotal)`, so it is bounded by its own value
 * whatever the quantity, and bounded by the cart when the cart is smaller.
 * The bound is structural rather than a second field somebody has to
 * remember to honour — which is the whole lesson of the bug.
 *
 * `max_discount_amount` is set to the same number anyway. It is redundant
 * today and it is the field that keeps this bounded if the type ever changes
 * back.
 *
 * The price is the one the wheel offered, read from the shop's own catalogue
 * at the moment of the spin. If the owner raises that price inside the
 * fourteen days, the winner pays the difference; if they lower it, the coupon
 * still covers the whole thing. Pinning the amount is what makes the prize a
 * game rather than a blank cheque against whatever that line costs later.
 *
 * `coupons.code` is UNIQUE, so a collision is retried — three attempts,
 * because a fourth would mean the CSPRNG is broken rather than unlucky.
 */
export async function issuePrizeCoupon(input: {
  userId: string;
  productId: string;
  /** What the game cost when it was won. The prize is worth exactly this. */
  price: number;
  issuedAt: string;
  expiresAt: string;
}): Promise<string> {
  await ensureCouponsSchema();

  /*
    A prize with no price is not a prize, and a zero-value coupon would refuse
    itself at checkout with a message about the cart. Refuse here instead,
    where `spinWheel` turns it into a returned ticket.
  */
  const value = Math.floor(Number(input.price));
  if (!Number.isFinite(value) || value <= 0) throw new Error("WHEEL_PRIZE_NO_PRICE");

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
        "fixed",
        value,
        input.issuedAt,
        input.expiresAt,
        1,
        1,
        JSON.stringify([input.productId]),
        "[]",
        JSON.stringify([input.userId]),
        0,
        // The same bound again, through the other lever. See the note above.
        value,
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
