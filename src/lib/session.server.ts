import { getRequestHeader } from "@tanstack/react-start/server";

/**
 * `getRequestHeader` reads TanStack's request-scoped store and throws when
 * there is no active server event. These helpers also run with an explicit
 * Request in hand (queue consumers, scheduled jobs, tests), where the absence
 * of that store means "no header", not "crash".
 */
function ambientHeader(name: string): string | undefined {
  try {
    return getRequestHeader(name);
  } catch {
    return undefined;
  }
}

import { signValue, unsignValue } from "./crypto.server.ts";
import { constantTimeEqual } from "./security.server";
import { findUserById, toPublicUser } from "./db.server";
import type { User } from "./types";

const COOKIE = "banana_session";
const MAX_AGE = 60 * 60 * 24 * 30;

/** `Secure` breaks cookies on plain-http local dev, so only set it over https. */
function isSecureRequest(request?: Request) {
  const proto = request?.headers.get("x-forwarded-proto") ?? ambientHeader("x-forwarded-proto");
  if (proto) return proto.split(",")[0]!.trim() === "https";
  if (request) {
    try {
      if (new URL(request.url).protocol === "https:") return true;
    } catch {
      // Fall through to host detection for non-standard request URLs.
    }
  }
  const host = request?.headers.get("host") ?? ambientHeader("host") ?? "";
  return !host.startsWith("localhost") && !host.startsWith("127.0.0.1");
}

function cookieAttrs(request?: Request, maxAge = MAX_AGE) {
  const secure = isSecureRequest(request);
  const sameSite = secure ? "None" : "Lax";
  const secureFlag = secure ? "; Secure" : "";

  // messenger, Instagram, and Telegram in-app browsers on Android and iOS
  // have many quirks with cookies. "Partitioned" is required for Chrome-based
  // browsers (Android) when in a 3rd-party context, and Lax is safer than None
  // for these specific embedded views if they lose the "Secure" context.
  const partitioned = secure ? "; Partitioned" : "";

  // Domain handling: never use Domain=.banan.to for session cookies
  // to ensure they aren't rejected by in-app browsers with strict isolation.

  return `Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secureFlag}${partitioned}`;
}

export async function setSessionCookie(userId: string, request?: Request) {
  const user = await findUserById(userId);
  if (!user) throw new Error("SESSION_USER_NOT_FOUND");
  const expiresAt = Math.floor(Date.now() / 1000) + MAX_AGE;
  const fingerprint = await sessionFingerprint(user);
  const signed = await signValue(`v2:${userId}:${expiresAt}:${fingerprint}`);
  return `${COOKIE}=${encodeURIComponent(signed)}; ${cookieAttrs(request)}`;
}

/**
 * Start a session, and carry a referral into it.
 *
 * Every way an account is signed in — password, phone code, the OAuth
 * callback, the account created during verification — ends at
 * `setSessionCookie`, so this wrapper is the one place a referral captured
 * while the visitor was still a guest can be moved onto the account. Doing it
 * here rather than at each of those call sites is what stops the next new
 * sign-in path from quietly forgetting to.
 *
 * The move is best-effort by construction: `bindAttributionToUser` swallows
 * its own failures, because nobody should be unable to sign in over a
 * referral.
 */
export async function establishSession(userId: string, request?: Request): Promise<string> {
  const cookie = await setSessionCookie(userId, request);
  if (request) {
    const { bindAttributionToUser } = await import("./referral/service.server");
    await bindAttributionToUser(request, userId);
  }
  return cookie;
}

export function clearSessionCookie(request?: Request) {
  return `${COOKIE}=; ${cookieAttrs(request, 0)}`;
}

function readCookie(request?: Request) {
  const header = request?.headers.get("cookie") ?? ambientHeader("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export async function getSessionUser(request?: Request): Promise<User | undefined> {
  const raw = readCookie(request);
  if (!raw) return undefined;
  const userId = await unsignValue(raw);
  if (!userId) return undefined;
  const [version, id, expiresAt, fingerprint] = userId.split(":");
  if (
    version !== "v2" ||
    !id ||
    !/^\d{10}$/.test(expiresAt ?? "") ||
    !/^[a-f0-9]{24}$/.test(fingerprint ?? "") ||
    Number(expiresAt) <= Math.floor(Date.now() / 1000)
  ) {
    return undefined;
  }
  const user = await findUserById(id);
  if (!user) return undefined;
  const expected = await sessionFingerprint(user);
  return constantTimeEqual(fingerprint!, expected) ? user : undefined;
}

async function sessionFingerprint(user: User): Promise<string> {
  const material = [
    user.passwordHash,
    user.provider ?? "password",
    user.providerId ?? "",
    user.createdAt,
  ].join("\u0000");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function requireUser(request?: Request) {
  const user = await getSessionUser(request);
  if (!user) throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  return user;
}

/**
 * Admin guard for route handlers.
 *
 * The admin flag is re-read from the database on every call rather than trusted
 * from the session payload, so revoking `is_admin` takes effect immediately
 * even while an old session cookie is still valid.
 */
export async function requireAdmin(request?: Request) {
  const user = await requireUser(request);
  const current = await findUserById(user.id);
  if (!current?.isAdmin) {
    throw new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return current;
}

export { toPublicUser };
