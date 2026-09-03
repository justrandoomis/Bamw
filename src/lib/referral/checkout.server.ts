/**
 * The referral decision at checkout.
 *
 * Everything the order path needs, behind one call, so `orders.server.ts` gains
 * a decision rather than a programme. The decision is made here and nowhere
 * else: the same quote the cart previewed is recomputed from the catalogue and
 * the settings, the identity checks run again on the request that is actually
 * placing the order, and the counting rules — first purchase only, the daily
 * and monthly ceilings — are applied last, because they are the only ones that
 * need to know the amount.
 */

import type { Product, User } from "../types";
import { readReferralSettings, type ReferralSettings } from "./config";
import {
  activeAttribution,
  captureAttribution,
  quoteReferral,
  requestIdentity,
  type ReferralQuote,
  type ReferralQuoteLine,
} from "./service.server";
import { checkProgrammeLimits, recordRiskEvent } from "./risk.server";
import type { ReferralAttribution } from "./rows";
import { referralBinding } from "./binding.server";

export interface ReferralCheckoutDecision {
  quote: ReferralQuote;
  attribution: ReferralAttribution;
  settings: ReferralSettings;
}

/**
 * A stand-in attribution for a member who is already bound.
 *
 * Not written to the database and never will be: it exists so the quote, the
 * risk assessment and the limits all take the same argument whether the
 * referral arrived on a cookie today or was settled a year ago. The id is
 * empty, which is what keeps it out of every `WHERE id = ?` downstream.
 */
function boundAttribution(
  buyerId: string,
  binding: { referrerUserId: string; firstOrderId: string },
  now?: Date,
): ReferralAttribution {
  const stamp = (now ?? new Date()).toISOString();
  return {
    id: "",
    referrerUserId: binding.referrerUserId,
    referredUserId: buyerId,
    referralCodeId: "",
    productId: "",
    guestSessionHash: "",
    deviceHash: null,
    ipHash: null,
    status: "pending",
    capturedAt: stamp,
    // Far enough ahead that the expiry check cannot refuse a standing binding:
    // a permanent relationship does not expire, only a link does.
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    boundAt: stamp,
    convertedOrderId: binding.firstOrderId || null,
    convertedAt: null,
    riskScore: 0,
    blockedReason: null,
    updatedAt: stamp,
  };
}

/**
 * Resolve, price and vet the referral for this checkout.
 *
 * Returns `undefined` when there is nothing to apply — no attribution, the
 * programme off, no eligible line. Returns a decision whose `quote.applicable`
 * is false when there *is* an attribution but it must not pay, so the caller
 * can still record why on the order.
 */
export async function resolveReferralForCheckout(params: {
  request?: Request;
  buyer: User;
  lines: ReferralQuoteLine[];
  storeSettings?: unknown;
  products?: Product[];
  /** A code typed into the cart's field, when the cookie has none. */
  explicitCode?: string | undefined;
  now?: Date;
}): Promise<ReferralCheckoutDecision | undefined> {
  const request = params.request;
  if (!request) return undefined;

  const settings = readReferralSettings(params.storeSettings);
  if (!settings.enabled) return undefined;

  /*
    A code typed at the last moment still counts.

    Applying it goes through the same capture path as opening a link, so it
    gets the same validation and writes the same attribution row — there is no
    second, weaker way in.
  */
  if (params.explicitCode) {
    await captureAttribution({
      request,
      codeInput: params.explicitCode,
      viewer: params.buyer,
    }).catch(() => undefined);
  }

  /*
    Two ways a referral reaches this checkout.

    The cookie is how a *first* order finds one. Every order after that has no
    cookie and no live attribution — the link was clicked once, months ago —
    and yet the referrer is still owed 5%. So when there is no attribution the
    member's permanent binding is used instead, and a stand-in attribution is
    built from it purely so the rest of this path has one shape to work with.

    Its status is `pending`, meaning the relationship is live — which it is,
    permanently. It does *not* mean a discount is waiting: that is decided by
    `referral_discount_used_at` on the member, which the quote reads for
    itself. Marking this `used` instead would have been the more literal
    reading and was wrong, because `isAttributionUsable` refuses a `used` row
    outright and the quote would never have been reached at all — no reward on
    any order after the first, which is the rule this exists to serve.
  */
  const binding = await referralBinding(params.buyer.id);
  const bound = binding.referrerUserId
    ? boundAttribution(params.buyer.id, binding, params.now)
    : undefined;
  const live = await activeAttribution(request, params.buyer);

  /*
    A binding cannot be replaced, and the fallback is the binding — not
    nothing.

    Once a member belongs to somebody, any attribution naming anyone else is
    ignored and the standing relationship is used in its place. Refusing the
    whole referral instead would have been the easy reading of rule 4 and is
    wrong twice over: it would let a stale cookie, or a link the member opened
    out of curiosity, quietly stop paying the person who actually brought them
    in — punishing the referrer for something the buyer clicked.
  */
  const attribution =
    bound && (!live || live.referrerUserId !== binding.referrerUserId) ? bound : live;
  if (!attribution) return undefined;

  const identity = await requestIdentity(request);
  const quote = await quoteReferral({
    buyer: params.buyer,
    attribution,
    lines: params.lines,
    settings,
    ...(params.products ? { products: params.products } : {}),
    identity: {
      deviceHash: identity.deviceHash,
      deviceIdHash: identity.deviceIdHash,
      ipHash: identity.ipHash,
      sessionHash: identity.sessionHash,
    },
    ...(params.now ? { now: params.now } : {}),
  });

  if (!quote.applicable) {
    await recordRiskEvent({
      attributionId: attribution.id,
      referrerUserId: attribution.referrerUserId,
      buyerUserId: params.buyer.id,
      eventType: "checkout_not_applicable",
      riskScore: quote.riskScore,
      deviceHash: identity.deviceHash,
      ipHash: identity.ipHash,
      metadata: { reasons: quote.reasons, verdict: quote.riskVerdict },
    });
    return { quote, attribution, settings };
  }

  const limitReasons = await checkProgrammeLimits({
    settings,
    referrerUserId: quote.referrerUserId ?? attribution.referrerUserId,
    buyerUserId: params.buyer.id,
    rewardIqd: quote.referrerRewardIqd,
    ...(params.now ? { now: params.now } : {}),
  });

  if (limitReasons.length) {
    await recordRiskEvent({
      attributionId: attribution.id,
      referrerUserId: attribution.referrerUserId,
      buyerUserId: params.buyer.id,
      eventType: "checkout_limit_blocked",
      riskScore: Math.max(quote.riskScore, 40),
      deviceHash: identity.deviceHash,
      ipHash: identity.ipHash,
      metadata: { reasons: limitReasons },
    });
    return {
      attribution,
      settings,
      quote: {
        ...quote,
        applicable: false,
        buyerDiscountIqd: 0,
        referrerRewardIqd: 0,
        reasons: [...quote.reasons, ...limitReasons],
        riskVerdict: [quote.riskVerdict, ...limitReasons].filter(Boolean).join(","),
      },
    };
  }

  return { quote, attribution, settings };
}
