/**
 * Refer a Friend — دعوة صديق.
 *
 * The rules of the programme, in the one place that is allowed to decide them:
 * the server. Nothing a browser sends is trusted here. The code is resolved
 * against the database, the price is read from the catalogue, the rates come
 * from the store settings, and the discount is arithmetic on those — a request
 * that carries an amount, a rate or a referrer is ignored on all three counts.
 *
 * The visitor's half of the story lives in a signed cookie (cookies.server.ts)
 * and the identity checks in risk.server.ts; this module is what ties them to
 * a member, a product and, eventually, an order.
 */

import { randomId } from "../crypto.server";
import { d1All, d1First, d1Run } from "../d1.server";
import { findUserById, getStore } from "../db.server";
import { resolveUnitPrice } from "../productPricing";
import { findProductByIdOrSlug, getProductSlug } from "../productRouting";
import type { Product, User } from "../types";
import { readReferralSettings, type ReferralSettings } from "./config";
import {
  generateReferralCode,
  normalizeReferralAlias,
  parseReferralInput,
  referralLink,
} from "./codes";
import {
  attributionCookie,
  clearAttributionCookie,
  readAttributionCookie,
  readIdentityCookies,
  type AttributionToken,
} from "./cookies.server";
import {
  evaluateReferralLine,
  type ReferralIneligibleReason,
  type ReferralLineSelection,
} from "./eligibility";
import {
  deviceFingerprintHash,
  hashIpForReferral,
  referralHash,
  type DeviceHints,
} from "./identity.server";
import { referralAmounts } from "./money";
import { toReferralAttribution, toReferralCode, type ReferralAttribution, type ReferralCode } from "./rows";
import {
  assessReferralRisk,
  recordRiskEvent,
  rememberRequestIdentities,
  type ReferralRiskReason,
  type ReferralRiskVerdict,
} from "./risk.server";

/**
 * The one sentence a customer is ever shown when a code does not apply.
 *
 * Naming the check that caught them would tell an abuser exactly what to
 * change, so every refusal — self-referral, a shared device, an address match,
 * a spent code — reads the same.
 */
export const REFERRAL_REFUSAL_MESSAGE = "تعذر تطبيق كود الإحالة على هذه العملية.";

/** Read the programme's settings out of the live store document. */
export async function getReferralSettings(): Promise<ReferralSettings> {
  const store = await getStore();
  return readReferralSettings(store?.settings);
}

/* -------------------------------------------------------------------------- */
/* Codes                                                                      */
/* -------------------------------------------------------------------------- */

/** The member's own code, minted on first use and stable ever after. */
export async function getOrCreateReferralCode(user: User): Promise<ReferralCode | undefined> {
  const existing = await d1First<Record<string, unknown>>(
    `SELECT * FROM referral_codes WHERE user_id = ? LIMIT 1`,
    user.id,
  );
  const now = new Date().toISOString();
  const alias = normalizeReferralAlias(user.username) || null;

  if (existing && existing["id"]) {
    const mapped = toReferralCode(existing);
    /*
      The alias follows the username, because a link showing a stale handle is
      confusing. The *code* never moves — it is what the attribution points at,
      so a rename can never redirect earnings that are already in flight.
    */
    if (alias !== mapped.usernameAlias) {
      await d1Run(
        `UPDATE referral_codes SET username_alias = ?, updated_at = ? WHERE id = ?`,
        alias,
        now,
        mapped.id,
      );
      return { ...mapped, usernameAlias: alias, updatedAt: now };
    }
    return mapped;
  }

  /*
    A collision on the eight-character code is a one-in-a-trillion event, and
    the unique index is what decides it rather than a read-then-write race.
    Three attempts is generous.
  */
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateReferralCode();
    try {
      await d1Run(
        `INSERT INTO referral_codes (id, user_id, code, username_alias, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        randomId("rfc"),
        user.id,
        code,
        alias,
        now,
        now,
      );
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Another request created this member's row first: read it back.
      if (/user_id/i.test(message)) break;
      if (attempt === 2) {
        console.warn("[referral:code_mint_failed]", { userId: user.id, message });
        return undefined;
      }
    }
  }

  const created = await d1First<Record<string, unknown>>(
    `SELECT * FROM referral_codes WHERE user_id = ? LIMIT 1`,
    user.id,
  );
  return created?.["id"] ? toReferralCode(created) : undefined;
}

/**
 * A code or a username, resolved to the row behind it.
 *
 * The username path exists because that is what a person recognises in a
 * link — but it is only a lookup. What comes back is a row whose `user_id`
 * does not move when a handle is changed.
 */
export async function resolveReferralCode(input: unknown): Promise<ReferralCode | undefined> {
  const { code, alias } = parseReferralInput(input);
  if (!code && !alias) return undefined;

  if (code) {
    const row = await d1First<Record<string, unknown>>(
      `SELECT * FROM referral_codes WHERE code = ? LIMIT 1`,
      code,
    );
    if (row?.["id"]) return toReferralCode(row);
  }

  if (alias) {
    const byAlias = await d1First<Record<string, unknown>>(
      `SELECT * FROM referral_codes WHERE username_alias = ? LIMIT 1`,
      alias,
    );
    if (byAlias?.["id"]) return toReferralCode(byAlias);

    /*
      A member who has never opened the referral page has no code row yet, but
      their link may already be circulating — a friend can share
      `?ref=<their username>` from a product page. Mint it on demand so the
      first friend through the link is not lost.
    */
    const user = await d1First<{ id?: unknown }>(
      `SELECT id FROM users WHERE lower(username) = ? LIMIT 1`,
      alias,
    );
    const userId = String(user?.id ?? "");
    if (userId) {
      const owner = await findUserById(userId);
      if (owner) return getOrCreateReferralCode(owner);
    }
  }

  return undefined;
}

/** Everything a share sheet needs for one member. */
export async function referralShareInfo(
  user: User,
  origin: string,
  product?: Record<string, unknown>,
): Promise<{ code: string; alias: string | null; link: string; productLink?: string } | undefined> {
  const row = await getOrCreateReferralCode(user);
  if (!row) return undefined;
  const alias = row.usernameAlias;
  const link = referralLink({ origin, code: row.code, ...(alias ? { alias } : {}) });
  const productSlug = product ? getProductSlug(product) : "";
  return {
    code: row.code,
    alias,
    link,
    ...(productSlug
      ? {
          productLink: referralLink({
            origin,
            code: row.code,
            ...(alias ? { alias } : {}),
            productSlug,
          }),
        }
      : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Attribution                                                                */
/* -------------------------------------------------------------------------- */

/** Everything the server knows about who is asking, all of it hashed. */
export interface RequestIdentity {
  sessionId: string;
  deviceId: string;
  sessionHash: string;
  /** The coarse reading: a browser class derived from the request headers. */
  deviceHash: string;
  /** The precise reading: the `bnt_did` cookie, hashed. */
  deviceIdHash: string;
  ipHash: string;
  /** `Set-Cookie` values the caller must attach to its response. */
  setCookies: string[];
}

export async function requestIdentity(
  request: Request,
  hints?: DeviceHints,
): Promise<RequestIdentity> {
  const cookies = await readIdentityCookies(request);
  const [sessionHash, deviceFromRequest, deviceFromCookie, ipHash] = await Promise.all([
    referralHash("session", cookies.sessionId),
    deviceFingerprintHash(request, hints),
    referralHash("device-id", cookies.deviceId),
    hashIpForReferral(request),
  ]);
  /*
    Two readings of "device", kept apart.

    The cookie half is precise but can be deleted; the request half survives
    that but cannot tell two customers holding the same phone model apart.
    Folding them into one value would mean trusting the weaker one as if it
    were the stronger, which is what refused honest referrals in production, so
    each is carried and recorded under its own identity kind.
  */
  return {
    sessionId: cookies.sessionId,
    deviceId: cookies.deviceId,
    sessionHash,
    deviceHash: deviceFromRequest,
    deviceIdHash: deviceFromCookie,
    ipHash,
    setCookies: cookies.setCookies,
  };
}

/**
 * Attach this request's identities to a signed-in account.
 *
 * Called on every referral surface a member touches. It is what builds the
 * history the abuse checks read — and recording the cookie-derived device id
 * as well as the request-derived one means neither clearing cookies nor
 * changing browsers loses the link on its own.
 */
export async function bindIdentitiesToUser(
  userId: string,
  identity: RequestIdentity,
): Promise<void> {
  if (!userId) return;
  await rememberRequestIdentities(userId, {
    deviceHash: identity.deviceHash,
    deviceIdHash: identity.deviceIdHash,
    ipHash: identity.ipHash,
    sessionHash: identity.sessionHash,
  });
}

export interface CaptureResult {
  ok: boolean;
  /** Present when the capture succeeded. */
  token?: AttributionToken;
  referrerName?: string;
  referrerAlias?: string;
  productId?: string;
  productTitle?: string;
  buyerPercentBps?: number;
  /** Cookies the caller must set, including the attribution itself. */
  setCookies: string[];
  /** The single sentence to show, refusal or confirmation. */
  message: string;
  reasons?: ReferralRiskReason[];
  /** The member opened their own link — named, because it is safe to name. */
  selfReferral?: boolean;
}

/**
 * A friend opened a referral link.
 *
 * Validates the code, runs every identity check that can be run before there
 * is an account, writes the attribution and hands back the signed cookie. The
 * attribution is written even when the visitor is a guest — that is the whole
 * point of it — and bound to whoever signs in on that session afterwards.
 */
export async function captureAttribution(params: {
  request: Request;
  codeInput: unknown;
  productRef?: string | null;
  viewer?: User | undefined;
  hints?: DeviceHints;
}): Promise<CaptureResult> {
  const identity = await requestIdentity(params.request, params.hints);
  const settings = await getReferralSettings();
  const refuse = (reasons: ReferralRiskReason[] = []): CaptureResult => ({
    ok: false,
    setCookies: identity.setCookies,
    message: REFERRAL_REFUSAL_MESSAGE,
    reasons,
  });

  if (!settings.enabled) return refuse();

  const code = await resolveReferralCode(params.codeInput);
  if (!code || !code.isActive || !code.userId) return refuse(["code_inactive"]);

  const referrer = await findUserById(code.userId);
  if (!referrer) return refuse(["code_inactive"]);

  /*
    Your own link, opened by you.

    This is the one refusal worth naming. Everything else reads the same
    sentence on purpose — telling somebody which check caught them tells them
    which one to change — but a member cannot learn anything from being told a
    link is theirs, and being told "this could not be applied" instead is how
    an owner testing their own share button concludes the feature is broken.
  */
  if (params.viewer?.id && params.viewer.id === referrer.id) {
    return {
      ok: false,
      setCookies: identity.setCookies,
      message: "هذا رابط دعوتك أنت — شاركه مع صديق ليحصل على الخصم وتحصل أنت على المكافأة.",
      reasons: ["self_referral"],
      selfReferral: true,
    };
  }

  const verdict = await assessReferralRisk({
    settings,
    referrer: {
      id: referrer.id,
      phone: referrer.phone ?? null,
      email: referrer.email ?? null,
      telegramId: referrer.telegramId ?? null,
    },
    ...(params.viewer
      ? {
          buyer: {
            id: params.viewer.id,
            phone: params.viewer.phone ?? null,
            email: params.viewer.email ?? null,
            telegramId: params.viewer.telegramId ?? null,
          },
        }
      : {}),
    buyerDeviceHash: identity.deviceHash,
    buyerDeviceIdHash: identity.deviceIdHash,
    buyerIpHash: identity.ipHash,
    buyerSessionHash: identity.sessionHash,
  });

  /*
    Recorded *after* the verdict, not before.

    Binding first meant the request under assessment taught the system its own
    device, address and session a moment before being asked whether they were
    the referrer's — which is only harmless because self-referral is caught
    above. Assess, then remember.
  */
  if (params.viewer?.id) {
    await bindIdentitiesToUser(params.viewer.id, identity);
  }

  if (verdict.blocked) {
    await recordRiskEvent({
      eventType: "capture_blocked",
      referrerUserId: referrer.id,
      buyerUserId: params.viewer?.id ?? null,
      riskScore: verdict.score,
      deviceHash: identity.deviceHash,
      ipHash: identity.ipHash,
      metadata: { reasons: verdict.reasons, stage: "capture" },
    });
    return refuse(verdict.reasons);
  }

  const store = await getStore();
  const product = params.productRef
    ? (findProductByIdOrSlug(store?.products as unknown[], params.productRef) as
        | Record<string, unknown>
        | undefined)
    : undefined;
  const productId = product ? String(product["id"] ?? "") : "";

  const now = new Date();
  const expiresAt = new Date(now.getTime() + settings.linkTtlDays * 24 * 60 * 60 * 1000);
  const attributionId = randomId("rat");

  /*
    One row per (guest session, code, product).

    Re-opening the same link refreshes the window instead of piling up rows —
    the unique index decides that, not a read-then-write, so two tabs racing
    cannot produce two attributions for one visitor.
  */
  await d1Run(
    `INSERT INTO referral_attributions (
       id, referrer_user_id, referred_user_id, referral_code_id, product_id,
       guest_session_hash, device_hash, ip_hash, status, captured_at, expires_at,
       bound_at, risk_score, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'captured', ?, ?, ?, ?, ?)
     ON CONFLICT(guest_session_hash, referral_code_id, product_id) DO UPDATE SET
       expires_at = excluded.expires_at,
       device_hash = excluded.device_hash,
       ip_hash = excluded.ip_hash,
       referred_user_id = COALESCE(referral_attributions.referred_user_id, excluded.referred_user_id),
       bound_at = COALESCE(referral_attributions.bound_at, excluded.bound_at),
       status = CASE WHEN referral_attributions.status IN ('blocked', 'converted')
                     THEN referral_attributions.status ELSE 'captured' END,
       updated_at = excluded.updated_at`,
    attributionId,
    referrer.id,
    params.viewer?.id ?? null,
    code.id,
    productId,
    identity.sessionHash,
    identity.deviceHash,
    identity.ipHash,
    now.toISOString(),
    expiresAt.toISOString(),
    params.viewer?.id ? now.toISOString() : null,
    verdict.score,
    now.toISOString(),
  );

  const stored = await d1First<Record<string, unknown>>(
    `SELECT * FROM referral_attributions
      WHERE guest_session_hash = ? AND referral_code_id = ? AND product_id = ? LIMIT 1`,
    identity.sessionHash,
    code.id,
    productId,
  );
  const attribution = stored?.["id"] ? toReferralAttribution(stored) : undefined;
  if (!attribution || attribution.status === "blocked") return refuse();

  const token: AttributionToken = {
    attributionId: attribution.id,
    referralCodeId: code.id,
    referrerUserId: referrer.id,
    productId,
    capturedAt: Math.floor(now.getTime() / 1000),
    expiresAt: Math.floor(expiresAt.getTime() / 1000),
  };

  const alias = code.usernameAlias || normalizeReferralAlias(referrer.username) || code.code;
  const percent = settings.buyerPercentBps / 100;
  const productTitle = product ? String(product["title"] ?? "") : "";

  await recordRiskEvent({
    attributionId: attribution.id,
    eventType: "captured",
    referrerUserId: referrer.id,
    buyerUserId: params.viewer?.id ?? null,
    riskScore: verdict.score,
    deviceHash: identity.deviceHash,
    ipHash: identity.ipHash,
    metadata: { productId, stage: "capture" },
  });

  return {
    ok: true,
    token,
    referrerAlias: alias,
    referrerName: referrer.name,
    productId,
    productTitle,
    buyerPercentBps: settings.buyerPercentBps,
    setCookies: [
      ...identity.setCookies,
      await attributionCookie(token, params.request),
    ],
    message: productId
      ? `تم تطبيق إحالة @${alias}. ستحصل على خصم ${percent}% عند شراء هذه اللعبة.`
      : `تم تطبيق إحالة @${alias}. ستحصل على خصم ${percent}% على أول لعبة مؤهلة.`,
  };
}

/**
 * The attribution in force for this request.
 *
 * The cookie is the primary source because it is the only one a guest has. For
 * a signed-in member it is checked against the row — and if the cookie is gone
 * but the account already carries a live attribution, that is used instead, so
 * clearing cookies neither grants nor removes an offer.
 */
export async function activeAttribution(
  request: Request,
  viewer?: User,
): Promise<ReferralAttribution | undefined> {
  const token = await readAttributionCookie(request);
  if (token) {
    const row = await d1First<Record<string, unknown>>(
      `SELECT * FROM referral_attributions WHERE id = ? LIMIT 1`,
      token.attributionId,
    );
    if (row?.["id"]) {
      const attribution = toReferralAttribution(row);
      if (isAttributionUsable(attribution, viewer?.id)) return attribution;
    }
  }

  if (viewer?.id) {
    const row = await d1First<Record<string, unknown>>(
      `SELECT * FROM referral_attributions
        WHERE referred_user_id = ? AND status IN ('captured', 'eligible')
        ORDER BY captured_at DESC LIMIT 1`,
      viewer.id,
    );
    if (row?.["id"]) {
      const attribution = toReferralAttribution(row);
      if (isAttributionUsable(attribution, viewer.id)) return attribution;
    }
  }

  return undefined;
}

/** Live, not spent, not refused, and not somebody else's. */
export function isAttributionUsable(
  attribution: ReferralAttribution,
  viewerId?: string,
  now = Date.now(),
): boolean {
  if (attribution.status === "blocked" || attribution.status === "expired") return false;
  if (attribution.status === "converted") return false;
  const expiry = Date.parse(attribution.expiresAt);
  if (Number.isFinite(expiry) && expiry <= now) return false;
  /*
    An attribution already bound to another account cannot be picked up by a
    second member on the same browser — which is what a shared machine, or a
    signed-out session on a phone that is passed around, would otherwise allow.
  */
  if (attribution.referredUserId && viewerId && attribution.referredUserId !== viewerId) {
    return false;
  }
  return true;
}

/**
 * Move a guest attribution onto an account.
 *
 * Called the moment a session is established — registration, sign-in, the OTP
 * path and the OAuth callback all reach it — so an offer captured before there
 * was an account survives creating one. The identity checks run again here,
 * because signing in is the first moment the two sides can be compared: a
 * self-referral is invisible until there is a `referred_user_id`.
 */
export async function bindAttributionToUser(request: Request, userId: string): Promise<void> {
  if (!userId) return;
  try {
    const user = await findUserById(userId);
    if (!user) return;

    const identity = await requestIdentity(request);
    await bindIdentitiesToUser(userId, identity);

    const token = await readAttributionCookie(request);
    if (!token) return;

    const row = await d1First<Record<string, unknown>>(
      `SELECT * FROM referral_attributions WHERE id = ? LIMIT 1`,
      token.attributionId,
    );
    if (!row?.["id"]) return;
    const attribution = toReferralAttribution(row);
    if (attribution.status === "converted" || attribution.status === "blocked") return;
    if (attribution.referredUserId && attribution.referredUserId !== userId) return;

    const settings = await getReferralSettings();
    const referrer = await findUserById(attribution.referrerUserId);
    const verdict = referrer
      ? await assessReferralRisk({
          settings,
          referrer: {
            id: referrer.id,
            phone: referrer.phone ?? null,
            email: referrer.email ?? null,
            telegramId: referrer.telegramId ?? null,
          },
          buyer: {
            id: user.id,
            phone: user.phone ?? null,
            email: user.email ?? null,
            telegramId: user.telegramId ?? null,
          },
          buyerDeviceHash: identity.deviceHash,
          buyerIpHash: identity.ipHash,
          buyerSessionHash: identity.sessionHash,
          attributionDeviceHash: attribution.deviceHash,
          attributionIpHash: attribution.ipHash,
          attributionExpiresAt: attribution.expiresAt,
        })
      : { blocked: true, score: 100, reasons: ["code_inactive"], verdict: "code_inactive" };

    const now = new Date().toISOString();
    await d1Run(
      `UPDATE referral_attributions
          SET referred_user_id = ?, bound_at = COALESCE(bound_at, ?), status = ?,
              risk_score = ?, blocked_reason = ?, updated_at = ?
        WHERE id = ? AND status IN ('captured', 'eligible')`,
      userId,
      now,
      verdict.blocked ? "blocked" : "eligible",
      verdict.score,
      verdict.blocked ? verdict.verdict : null,
      now,
      attribution.id,
    );

    await recordRiskEvent({
      attributionId: attribution.id,
      eventType: verdict.blocked ? "bind_blocked" : "bound",
      referrerUserId: attribution.referrerUserId,
      buyerUserId: userId,
      riskScore: verdict.score,
      deviceHash: identity.deviceHash,
      ipHash: identity.ipHash,
      metadata: { reasons: verdict.reasons, stage: "bind" },
    });
  } catch (error) {
    // Signing in must never fail because a referral could not be moved.
    console.warn("[referral:bind_failed]", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Drop the attribution — the member pressed "remove" in the cart. */
export function forgetAttributionCookie(request: Request): string {
  return clearAttributionCookie(request);
}

/* -------------------------------------------------------------------------- */
/* Quoting                                                                    */
/* -------------------------------------------------------------------------- */

export interface ReferralQuoteLine extends ReferralLineSelection {
  title?: string;
}

export interface ReferralQuote {
  applicable: boolean;
  attributionId?: string;
  referrerUserId?: string;
  referrerAlias?: string;
  referralCodeId?: string;
  referralCode?: string;
  productId?: string;
  productTitle?: string;
  originalPriceIqd: number;
  buyerDiscountIqd: number;
  referrerRewardIqd: number;
  buyerPercentBps: number;
  referrerPercentBps: number;
  riskScore: number;
  riskVerdict: string;
  reasons: ReferralRiskReason[];
  message?: string;
}

const EMPTY_QUOTE: ReferralQuote = {
  applicable: false,
  originalPriceIqd: 0,
  buyerDiscountIqd: 0,
  referrerRewardIqd: 0,
  buyerPercentBps: 0,
  referrerPercentBps: 0,
  riskScore: 0,
  riskVerdict: "none",
  reasons: [],
};

/**
 * Price one cart against one attribution.
 *
 * Used for the cart's preview and again, unchanged, at checkout — the same
 * function on the same inputs, so what the member is shown and what they are
 * charged cannot drift apart. The catalogue supplies the price; the cart's
 * idea of it is never read.
 */
export async function quoteReferral(params: {
  buyer: User;
  attribution: ReferralAttribution;
  lines: ReferralQuoteLine[];
  settings?: ReferralSettings;
  products?: Product[];
  identity?: { deviceHash: string; deviceIdHash?: string; ipHash: string; sessionHash: string };
  now?: Date;
}): Promise<ReferralQuote> {
  const settings = params.settings ?? (await getReferralSettings());
  if (!settings.enabled) return EMPTY_QUOTE;

  const attribution = params.attribution;
  if (!isAttributionUsable(attribution, params.buyer.id, params.now?.getTime())) {
    return { ...EMPTY_QUOTE, reasons: ["attribution_expired"] };
  }

  const referrer = await findUserById(attribution.referrerUserId);
  if (!referrer) return { ...EMPTY_QUOTE, reasons: ["code_inactive"] };

  const products =
    params.products ?? ((await getStore())?.products as Product[] | undefined) ?? [];
  const productOf = (id: string | number) =>
    products.find((entry) => String(entry.id) === String(id)) as
      | (Product & Record<string, unknown>)
      | undefined;

  /*
    Which line earns.

    A link shared for a specific game only pays on that game. A general link
    pays on the first eligible line — "first" by the order the cart sends,
    which is the order the member sees, so the answer is never surprising.
  */
  let chosen:
    | {
        line: ReferralQuoteLine;
        product: Record<string, unknown>;
        buyerBps: number;
        referrerBps: number;
      }
    | undefined;
  /** Why the last line that was looked at did not qualify, for the log. */
  let ineligibleReason: ReferralIneligibleReason | undefined;
  for (const line of params.lines) {
    const product = productOf(line.productId);
    const decision = evaluateReferralLine({
      settings,
      product,
      line,
      ...(attribution.productId ? { sharedProductId: attribution.productId } : {}),
    });
    if (decision.eligible && product) {
      chosen = {
        line,
        product,
        buyerBps: decision.buyerPercentBps,
        referrerBps: decision.referrerPercentBps,
      };
      break;
    }
    ineligibleReason = decision.reason ?? ineligibleReason;
  }
  if (!chosen) {
    return { ...EMPTY_QUOTE, riskVerdict: ineligibleReason ?? "no_eligible_line" };
  }

  const verdict: ReferralRiskVerdict = await assessReferralRisk({
    settings,
    referrer: {
      id: referrer.id,
      phone: referrer.phone ?? null,
      email: referrer.email ?? null,
      telegramId: referrer.telegramId ?? null,
    },
    buyer: {
      id: params.buyer.id,
      phone: params.buyer.phone ?? null,
      email: params.buyer.email ?? null,
      telegramId: params.buyer.telegramId ?? null,
    },
    buyerDeviceHash: params.identity?.deviceHash ?? null,
    buyerDeviceIdHash: params.identity?.deviceIdHash ?? null,
    buyerIpHash: params.identity?.ipHash ?? null,
    buyerSessionHash: params.identity?.sessionHash ?? null,
    attributionDeviceHash: attribution.deviceHash,
    attributionIpHash: attribution.ipHash,
    attributionSessionHash: attribution.guestSessionHash,
    attributionExpiresAt: attribution.expiresAt,
    ...(params.now ? { now: params.now } : {}),
  });

  /*
    The price is the catalogue's, for exactly one copy of what was actually
    chosen.

    Resolved through `resolveUnitPrice`, the same function checkout charges by.
    Reading `product.price` here instead — which is what this did — priced the
    reward off the record's headline figure while the line was charged at the
    option, type, edition and add-on price the customer picked. An offline
    account with DLC is precisely the selection the programme exists for, and
    it is precisely the one whose price is not the headline one, so the
    discount shown and taken was a percentage of a number nobody was paying.

    Quantity does not multiply the offer: the programme pays on the referred
    purchase, not on however many copies somebody put in the basket, so a line
    of ten earns the same as a line of one.
  */
  const priced = resolveUnitPrice(chosen.product, {
    optionId: chosen.line.optionId ?? null,
    typeId: chosen.line.typeId ?? null,
    editionId: chosen.line.editionId ?? null,
    dlcIds: chosen.line.dlcIds ?? null,
  });
  // The line's own figure is the last resort only: a request deliberately
  // zeroes it, so it is reached when the catalogue has no price at all.
  const unitPrice = priced.unitPrice > 0 ? priced.unitPrice : Number(chosen.line.unitPriceIqd);
  const amounts = referralAmounts({
    originalPriceIqd: unitPrice,
    buyerPercentBps: chosen.buyerBps,
    referrerPercentBps: chosen.referrerBps,
    maxRewardIqd: settings.maxRewardIqd,
  });

  const code = await d1First<Record<string, unknown>>(
    `SELECT * FROM referral_codes WHERE id = ? LIMIT 1`,
    attribution.referralCodeId,
  );
  const codeRow = code?.["id"] ? toReferralCode(code) : undefined;
  if (codeRow && !codeRow.isActive) verdict.reasons.push("code_inactive");

  const blocked = verdict.blocked || verdict.reasons.includes("code_inactive");

  return {
    applicable: !blocked && amounts.buyerDiscountIqd > 0,
    attributionId: attribution.id,
    referrerUserId: referrer.id,
    referrerAlias:
      codeRow?.usernameAlias || normalizeReferralAlias(referrer.username) || codeRow?.code || "",
    ...(codeRow ? { referralCodeId: codeRow.id, referralCode: codeRow.code } : {}),
    productId: String(chosen.product["id"] ?? ""),
    productTitle: String(chosen.product["title"] ?? ""),
    originalPriceIqd: amounts.originalPriceIqd,
    buyerDiscountIqd: blocked ? 0 : amounts.buyerDiscountIqd,
    referrerRewardIqd: blocked ? 0 : amounts.referrerRewardIqd,
    buyerPercentBps: amounts.buyerPercentBps,
    referrerPercentBps: amounts.referrerPercentBps,
    riskScore: verdict.score,
    riskVerdict: verdict.verdict,
    reasons: verdict.reasons,
    ...(blocked ? { message: REFERRAL_REFUSAL_MESSAGE } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* The member's own page                                                      */
/* -------------------------------------------------------------------------- */

export interface ReferralStats {
  invites: number;
  completed: number;
  pendingIqd: number;
  approvedIqd: number;
  reversedIqd: number;
  totalEarnedIqd: number;
}

export async function referralStats(userId: string): Promise<ReferralStats> {
  const [invites, rewards] = await Promise.all([
    d1First<{ total?: number }>(
      `SELECT COUNT(DISTINCT COALESCE(referred_user_id, guest_session_hash)) AS total
         FROM referral_attributions WHERE referrer_user_id = ?`,
      userId,
    ),
    d1All<{ status?: unknown; referrer_reward_iqd?: unknown; reversed_amount_iqd?: unknown }>(
      `SELECT status, referrer_reward_iqd, reversed_amount_iqd
         FROM referral_rewards WHERE referrer_user_id = ?`,
      userId,
    ),
  ]);

  let completed = 0;
  let pendingIqd = 0;
  let approvedIqd = 0;
  let reversedIqd = 0;
  for (const row of rewards) {
    const amount = Number(row.referrer_reward_iqd ?? 0) || 0;
    const reversed = Number(row.reversed_amount_iqd ?? 0) || 0;
    const status = String(row.status ?? "");
    if (status === "pending") pendingIqd += amount;
    if (status === "approved") {
      completed += 1;
      approvedIqd += Math.max(0, amount - reversed);
    }
    if (status === "reversed") reversedIqd += reversed || amount;
  }

  return {
    invites: Number(invites?.total ?? 0),
    completed,
    pendingIqd,
    approvedIqd,
    reversedIqd,
    totalEarnedIqd: approvedIqd,
  };
}
