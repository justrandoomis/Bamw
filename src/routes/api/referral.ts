import { createFileRoute } from "@tanstack/react-router";

import { body, guard, json } from "@/lib/http.server";
import { sessionSecretConfigured } from "@/lib/crypto.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";
import { getSessionUser, requireUser } from "@/lib/session.server";
import { getStore } from "@/lib/db.server";
import { readReferralSettings } from "@/lib/referral/config";
import { bpsToPercent, REFERRER_PERCENT_BPS } from "@/lib/referral/money";
import { withCookies } from "@/lib/referral/cookies.server";
import {
  activeAttribution,
  bindIdentitiesToUser,
  captureAttribution,
  forgetAttributionCookie,
  quoteReferral,
  referralShareInfo,
  referralStats,
  referrerPublicName,
  requestIdentity,
  REFERRAL_REFUSAL_MESSAGE,
  type ReferralQuoteLine,
} from "@/lib/referral/service.server";
import { recordRiskEvent } from "@/lib/referral/risk.server";
import {
  canStillUseReferral,
  hasSpentDiscount,
  referralBinding,
} from "@/lib/referral/binding.server";
import type { DeviceHints } from "@/lib/referral/identity.server";

/**
 * The referral programme's public surface.
 *
 * `GET` answers "what is in force for me right now" — the member's own code
 * and totals when signed in, and the attribution the visitor is carrying
 * whoever they are. `POST` applies a code (from a link or from the cart's
 * field) and `DELETE` drops one.
 *
 * Everything is decided here, on the server. The request may name a code; it
 * can never name a referrer, a rate or an amount, and none of those is read
 * from the body on any path below.
 */

/** The cart's lines, as the client may send them. Prices are ignored. */
interface IncomingLine {
  productId?: unknown;
  kind?: unknown;
  quantity?: unknown;
  optionId?: unknown;
  optionName?: unknown;
  typeId?: unknown;
  typeName?: unknown;
  editionId?: unknown;
  dlcIds?: unknown;
  offerKind?: unknown;
  title?: unknown;
}

/**
 * Read the cart from the request without believing its money.
 *
 * `unitPriceIqd` is deliberately zeroed: the quote reads the price from the
 * catalogue, and leaving a client-supplied number in the shape at all invites
 * a later change to start trusting it.
 */
function toQuoteLines(raw: unknown): ReferralQuoteLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).flatMap((entry): ReferralQuoteLine[] => {
    const line = entry as IncomingLine;
    const productId = String(line.productId ?? "").trim();
    if (!productId) return [];
    return [
      {
        productId,
        kind: line.kind === undefined ? null : String(line.kind),
        quantity: Math.max(1, Math.min(99, Math.floor(Number(line.quantity) || 1))),
        unitPriceIqd: 0,
        optionId: line.optionId === undefined ? null : String(line.optionId),
        optionName: line.optionName === undefined ? null : String(line.optionName),
        typeId: line.typeId === undefined ? null : String(line.typeId),
        typeName: line.typeName === undefined ? null : String(line.typeName),
        editionId: line.editionId === undefined ? null : String(line.editionId),
        /*
          Ids only, capped, and resolved against the stored product like every
          other part of the selection — an id naming no add-on adds nothing.
        */
        dlcIds: Array.isArray(line.dlcIds)
          ? line.dlcIds.slice(0, 20).map((id) => String(id)).filter(Boolean)
          : null,
        offerKind: line.offerKind === undefined ? null : String(line.offerKind),
        title: line.title === undefined ? undefined : String(line.title),
      },
    ];
  });
}

/**
 * The programme needs a signing key, because the attribution is a signed
 * cookie and the identity comparisons are keyed hashes.
 *
 * Without one there is nothing safe to do, and every referral surface would
 * otherwise fail with a 500 on a read the cart makes on every visit. A
 * deployment in that state answers "the programme is off" instead, so the
 * storefront simply does not show it.
 */
function referralUnavailable(): boolean {
  return !sessionSecretConfigured();
}

const DISABLED_TERMS = {
  enabled: false,
  buyerPercent: 0,
  referrerPercent: 0,
  linkTtlDays: 0,
  firstPurchaseOnly: true,
  stackWithCoupon: false,
  maxRewardIqd: 0,
};

function toHints(raw: unknown): DeviceHints | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const hints = raw as Record<string, unknown>;
  return {
    timezone: hints["timezone"] === undefined ? null : String(hints["timezone"]).slice(0, 64),
    screen: hints["screen"] === undefined ? null : String(hints["screen"]).slice(0, 32),
    platform: hints["platform"] === undefined ? null : String(hints["platform"]).slice(0, 64),
    language: hints["language"] === undefined ? null : String(hints["language"]).slice(0, 16),
  };
}

export const Route = createFileRoute("/api/referral")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          if (referralUnavailable()) {
            return json({ terms: DISABLED_TERMS, share: null, stats: null, attribution: null });
          }
          const url = new URL(request.url);
          const viewer = await getSessionUser(request);
          const store = await getStore();
          const settings = readReferralSettings(store?.settings);

          const identity = await requestIdentity(request);
          if (viewer?.id) await bindIdentitiesToUser(viewer.id, identity);

          const attribution = await activeAttribution(request, viewer);
          const terms = {
            enabled: settings.enabled,
            buyerPercent: bpsToPercent(settings.buyerPercentBps),
            // Fixed at 5% in code, not read from the settings: the rule is
            // that it is fixed, and the stored value is from an older one.
            referrerPercent: bpsToPercent(REFERRER_PERCENT_BPS),
            linkTtlDays: settings.linkTtlDays,
            firstPurchaseOnly: true,
            stackWithCoupon: settings.stackWithCoupon,
            maxRewardIqd: settings.maxRewardIqd,
          };

          if (!viewer) {
            return withCookies(
              json({
                terms,
                share: null,
                stats: null,
                attribution: attribution
                  ? { productId: attribution.productId, expiresAt: attribution.expiresAt }
                  : null,
              }),
              identity.setCookies,
            );
          }

          const product = url.searchParams.get("product");
          const productRecord = product
            ? ((store?.products ?? []).find(
                (entry) => String(entry.id) === product || String(entry.slug ?? "") === product,
              ) as Record<string, unknown> | undefined)
            : undefined;

          const [share, stats, binding] = await Promise.all([
            referralShareInfo(viewer, url.origin, productRecord),
            referralStats(viewer.id),
            referralBinding(viewer.id),
          ]);

          /*
            What the cart is allowed to show.

            `canApply` is the whole of the field's visibility rule and it is
            decided here, on the database, because the browser must not be the
            one deciding whether a discount is still available. Once a member
            has spent the discount or been bound to somebody, the field is gone
            for good — not disabled, not greyed out: a second code can change
            nothing at all, so offering one would be a lie.

            `supporting` is the public username of whoever they are with, and
            it is the *server's* answer, resolved from the binding or from the
            live attribution — never the text out of the link.
          */
          const supportingUserId = binding.referrerUserId || attribution?.referrerUserId || "";
          const supporting = supportingUserId
            ? await referrerPublicName(supportingUserId)
            : null;

          return withCookies(
            json({
              terms,
              share: share ?? null,
              stats,
              canApply: canStillUseReferral(binding),
              discountUsed: hasSpentDiscount(binding),
              supporting,
              attribution: attribution
                ? { productId: attribution.productId, expiresAt: attribution.expiresAt }
                : null,
            }),
            identity.setCookies,
          );
        }),

      /**
       * Apply a code — from a link the friend opened, or typed into the cart.
       *
       * Rate limited hard: guessing codes is exactly the attack an eight
       * character alphabet invites, and a refusal costs an attempt whether the
       * code exists or not, so a probe learns nothing from the count either.
       */
      POST: async ({ request }) =>
        guard(async () => {
          if (referralUnavailable()) {
            return json({ ok: false, message: REFERRAL_REFUSAL_MESSAGE }, { status: 503 });
          }
          const viewer = await getSessionUser(request);
          const data = await body<{
            code?: unknown;
            product?: unknown;
            lines?: unknown;
            hints?: unknown;
          }>(request);

          const throttle = await consumeRateLimit(
            request,
            "referral-apply",
            12,
            15 * 60,
            viewer?.id ?? "",
          );
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);

          const capture = await captureAttribution({
            request,
            codeInput: data.code,
            productRef: data.product === undefined ? null : String(data.product),
            viewer,
            ...(toHints(data.hints) ? { hints: toHints(data.hints)! } : {}),
          });

          if (!capture.ok) {
            /*
              A member opening their own link is not an error — it is the
              answer to a question they asked. It comes back 200 with
              `selfReferral`, so the page can say so calmly instead of
              flashing a failure at the person who owns the link.
            */
            return withCookies(
              json(
                {
                  ok: false,
                  selfReferral: Boolean(capture.selfReferral),
                  message: capture.message,
                },
                { status: capture.selfReferral ? 200 : 400 },
              ),
              capture.setCookies,
            );
          }

          /*
            When the cart sent its lines, answer with the money as well as the
            confirmation — the same quote checkout will recompute, so what the
            member reads here is what they will be charged.
          */
          let quote = null as Awaited<ReturnType<typeof quoteReferral>> | null;
          if (viewer) {
            const attribution = await activeAttribution(request, viewer);
            const lines = toQuoteLines(data.lines);
            if (attribution && lines.length) {
              quote = await quoteReferral({ buyer: viewer, attribution, lines });
              /*
                A refusal the anti-abuse checks did not cause.

                The code is fine and so are the two members; the purchase
                itself is not in the programme — an accessory, a marketplace
                listing, or a selection that is not an offline account. It
                reads to the customer exactly like every other refusal, and
                until this it was the one kind that left no record at all:
                nothing here becomes an order, so nothing here becomes a
                reward, and the admin screen had nothing to show.

                Recorded here rather than in `quoteReferral`, which re-runs on
                every edit to the cart — this path is a deliberate act by the
                customer and is rate limited to twelve attempts a quarter hour.
              */
              if (!quote.applicable) {
                await recordRiskEvent({
                  attributionId: attribution.id,
                  referrerUserId: attribution.referrerUserId,
                  buyerUserId: viewer.id,
                  eventType: "checkout_not_applicable",
                  riskScore: quote.riskScore,
                  metadata: {
                    reasons: quote.reasons,
                    verdict: quote.riskVerdict,
                    stage: "apply",
                  },
                });
              }
            }
          }

          return withCookies(
            json({
              ok: true,
              message: capture.message,
              referrerAlias: capture.referrerAlias ?? null,
              productId: capture.productId ?? null,
              productTitle: capture.productTitle ?? null,
              buyerPercent: bpsToPercent(capture.buyerPercentBps ?? 0),
              quote: quote
                ? {
                    applicable: quote.applicable,
                    productId: quote.productId ?? null,
                    productTitle: quote.productTitle ?? null,
                    originalPriceIqd: quote.originalPriceIqd,
                    buyerDiscountIqd: quote.buyerDiscountIqd,
                    referrerAlias: quote.referrerAlias ?? null,
                    message: quote.applicable ? null : REFERRAL_REFUSAL_MESSAGE,
                  }
                : null,
            }),
            capture.setCookies,
          );
        }),

      /** Price the current attribution against the cart, without changing it. */
      PUT: async ({ request }) =>
        guard(async () => {
          if (referralUnavailable()) return json({ applicable: false, quote: null });
          const viewer = await requireUser(request);
          /*
            Pricing is a read, but it records the identities this request
            carries — so it is bounded like every other write. Generous enough
            that a member editing their cart never meets it.
          */
          const throttle = await consumeRateLimit(request, "referral-quote", 60, 15 * 60, viewer.id);
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);

          const data = await body<{ lines?: unknown }>(request);
          const attribution = await activeAttribution(request, viewer);
          if (!attribution) return json({ applicable: false, quote: null });

          const lines = toQuoteLines(data.lines);
          if (!lines.length) return json({ applicable: false, quote: null });

          const identity = await requestIdentity(request);
          await bindIdentitiesToUser(viewer.id, identity);
          const quote = await quoteReferral({
            buyer: viewer,
            attribution,
            lines,
            identity: {
              deviceHash: identity.deviceHash,
              deviceIdHash: identity.deviceIdHash,
              ipHash: identity.ipHash,
              sessionHash: identity.sessionHash,
            },
          });

          return withCookies(
            json({
              applicable: quote.applicable,
              quote: {
                referrerAlias: quote.referrerAlias ?? null,
                referralCode: quote.referralCode ?? null,
                productId: quote.productId ?? null,
                productTitle: quote.productTitle ?? null,
                originalPriceIqd: quote.originalPriceIqd,
                buyerDiscountIqd: quote.buyerDiscountIqd,
                buyerPercent: bpsToPercent(quote.buyerPercentBps),
                message: quote.applicable ? null : REFERRAL_REFUSAL_MESSAGE,
              },
            }),
            identity.setCookies,
          );
        }),

      /** Remove the referral before paying. */
      DELETE: async ({ request }) =>
        guard(async () =>
          withCookies(json({ ok: true }), [forgetAttributionCookie(request)]),
        ),
    },
  },
});
