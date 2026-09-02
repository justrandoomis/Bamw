/**
 * The three cookies the referral programme keeps, and why none of them is
 * trusted as data.
 *
 * `bnt_ref` carries the attribution itself. It is a value **signed by the
 * server**, not a JSON blob: a friend who edits it to name a different
 * referrer, a longer expiry or someone else's code produces a signature that
 * does not verify, and the whole cookie is discarded. Local storage is never
 * consulted for any of this — it is editable from the browser's console, so a
 * referral read from it would be a referral the customer wrote themselves.
 *
 * `bnt_ref_sid` is the guest session: an opaque id minted here so an
 * attribution captured before sign-in has something stable to hang on.
 *
 * `bnt_did` is a device id, also minted here. It is a *second* opinion about
 * the device — the primary one is derived from the request itself
 * (identity.server.ts) precisely so that deleting these cookies changes
 * nothing about what the anti-abuse checks can see.
 */

import { signValue, unsignValue } from "../crypto.server.ts";
import { randomId } from "../crypto.server";

const ATTRIBUTION_COOKIE = "bnt_ref";
const SESSION_COOKIE = "bnt_ref_sid";
const DEVICE_COOKIE = "bnt_did";

/** Thirty days, the programme's default attribution window. */
export const DEFAULT_ATTRIBUTION_MAX_AGE = 60 * 60 * 24 * 30;
/** The device id outlives any single attribution on purpose. */
const DEVICE_MAX_AGE = 60 * 60 * 24 * 400;

/**
 * `Secure` cannot be sent over plain http or the browser drops the cookie, so
 * it is set for https requests only — the same rule the session cookie uses.
 */
function isSecureRequest(request?: Request): boolean {
  const proto = request?.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]!.trim() === "https";
  if (request) {
    try {
      if (new URL(request.url).protocol === "https:") return true;
    } catch {
      // Non-standard request URL: fall through to the host check.
    }
  }
  const host = request?.headers.get("host") ?? "";
  return Boolean(host) && !host.startsWith("localhost") && !host.startsWith("127.0.0.1");
}

/**
 * `SameSite=Lax` as specified.
 *
 * A referral link is a top-level navigation from wherever it was shared, which
 * Lax allows; everything that reads the cookie afterwards is same-origin. Lax
 * is also what stops the cookie riding along on a cross-site POST.
 */
function attrs(request: Request | undefined, maxAge: number): string {
  const secure = isSecureRequest(request);
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function readCookie(request: Request | undefined, name: string): string | undefined {
  const header = request?.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      const value = rest.join("=");
      if (!value) return undefined;
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** What the signed attribution cookie says. Verified before it is believed. */
export interface AttributionToken {
  attributionId: string;
  referralCodeId: string;
  referrerUserId: string;
  /** The product the link was for, or an empty string for a general link. */
  productId: string;
  capturedAt: number;
  expiresAt: number;
}

const FIELD = /^[A-Za-z0-9_.:-]{0,64}$/;

export async function signAttributionToken(token: AttributionToken): Promise<string> {
  const parts = [
    "v1",
    token.attributionId,
    token.referralCodeId,
    token.referrerUserId,
    token.productId || "-",
    String(Math.floor(token.capturedAt)),
    String(Math.floor(token.expiresAt)),
  ];
  return signValue(parts.join(":"));
}

/**
 * Read the cookie back, or `undefined`.
 *
 * Every failure is the same answer: a bad signature, a shape this version does
 * not recognise, a field with a character that cannot be in an id, or an
 * expiry in the past. There is no partial trust.
 */
export async function verifyAttributionToken(
  signed: string | undefined,
  now = Date.now(),
): Promise<AttributionToken | undefined> {
  if (!signed) return undefined;
  const value = await unsignValue(signed);
  if (!value) return undefined;
  const [version, attributionId, referralCodeId, referrerUserId, productId, capturedAt, expiresAt] =
    value.split(":");
  if (version !== "v1") return undefined;
  if (!attributionId || !referralCodeId || !referrerUserId) return undefined;
  for (const field of [attributionId, referralCodeId, referrerUserId, productId ?? ""]) {
    if (!FIELD.test(field)) return undefined;
  }
  const captured = Number(capturedAt);
  const expires = Number(expiresAt);
  if (!Number.isSafeInteger(captured) || !Number.isSafeInteger(expires)) return undefined;
  if (expires * 1000 <= now) return undefined;

  return {
    attributionId,
    referralCodeId,
    referrerUserId,
    productId: productId === "-" ? "" : (productId ?? ""),
    capturedAt: captured,
    expiresAt: expires,
  };
}

export async function attributionCookie(
  token: AttributionToken,
  request?: Request,
): Promise<string> {
  const maxAge = Math.max(60, Math.floor(token.expiresAt - Date.now() / 1000));
  const signed = await signAttributionToken(token);
  return `${ATTRIBUTION_COOKIE}=${encodeURIComponent(signed)}; ${attrs(request, maxAge)}`;
}

export function clearAttributionCookie(request?: Request): string {
  return `${ATTRIBUTION_COOKIE}=; ${attrs(request, 0)}`;
}

export async function readAttributionCookie(
  request: Request,
  now = Date.now(),
): Promise<AttributionToken | undefined> {
  return verifyAttributionToken(readCookie(request, ATTRIBUTION_COOKIE), now);
}

/** An opaque id read from a signed cookie, minted when there is none. */
async function readOrMint(
  request: Request,
  name: string,
  prefix: string,
  maxAge: number,
): Promise<{ id: string; setCookie?: string }> {
  const existing = await unsignValue(readCookie(request, name) ?? "");
  if (existing && /^[A-Za-z0-9_]{4,64}$/.test(existing)) return { id: existing };
  const id = randomId(prefix);
  const signed = await signValue(id);
  return { id, setCookie: `${name}=${encodeURIComponent(signed)}; ${attrs(request, maxAge)}` };
}

export interface ReferralIdentityCookies {
  /** Guest session id — stable across page loads, gone when the cookie is. */
  sessionId: string;
  /** A device id the server minted. A *second* signal, never the only one. */
  deviceId: string;
  /** `Set-Cookie` values the caller must attach to its response. */
  setCookies: string[];
}

export async function readIdentityCookies(request: Request): Promise<ReferralIdentityCookies> {
  const [session, device] = await Promise.all([
    readOrMint(request, SESSION_COOKIE, "rsid", DEFAULT_ATTRIBUTION_MAX_AGE),
    readOrMint(request, DEVICE_COOKIE, "dev", DEVICE_MAX_AGE),
  ]);
  return {
    sessionId: session.id,
    deviceId: device.id,
    setCookies: [session.setCookie, device.setCookie].filter((value): value is string =>
      Boolean(value),
    ),
  };
}

/** Attach any number of `Set-Cookie` values to a response without losing one. */
export function withCookies(response: Response, cookies: string[]): Response {
  if (!cookies.length) return response;
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
