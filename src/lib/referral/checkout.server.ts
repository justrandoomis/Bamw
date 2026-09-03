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

export interface ReferralCheckoutDecision {
  quote: ReferralQuote;
  attribution: ReferralAttribution;
  settings: ReferralSettings;
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

  const attribution = await activeAttribution(request, params.buyer);
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
