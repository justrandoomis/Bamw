/**
 * Who is on the other end of a referral, expressed as hashes.
 *
 * The programme has to answer questions like "is the buyer on the referrer's
 * phone?" and "is this the same address that opened the link?" without ever
 * putting an address, a device or a phone number into a table, a log line or
 * an admin export. Everything here is therefore an HMAC keyed on the
 * deployment's secret and separated by a namespace, so a device hash and an
 * address hash of the same text are different values and neither can be
 * reversed or recognised outside this deployment.
 *
 * The addresses themselves are read from Cloudflare's own header. A client can
 * put anything in `X-Forwarded-For`; `CF-Connecting-IP` is written by the edge
 * and is the only one trusted here.
 */

import { env } from "../env.server";

const encoder = new TextEncoder();

/** Cached per key material, because HMAC import is not free per request. */
const keyCache = new Map<string, Promise<CryptoKey>>();

function secretMaterial(): string {
  const configured = env("REFERRAL_HASH_SALT");
  if (typeof configured === "string" && configured.length >= 24) return configured;
  const session = env("SESSION_SECRET");
  if (typeof session === "string" && session.length >= 16) return session;
  const ipSalt = env("IP_SALT");
  if (typeof ipSalt === "string" && ipSalt.length >= 16) return ipSalt;
  /*
    No secret configured — local preview only. A fixed string keeps the shape
    of the feature working in a sandbox; it is never reached on a deployment,
    where `SESSION_SECRET` is required for sessions to work at all.
  */
  return "referral-local-preview-salt-0000000000";
}

async function hmacKey(namespace: string): Promise<CryptoKey> {
  const material = `${secretMaterial()}::referral::${namespace}`;
  let cached = keyCache.get(material);
  if (!cached) {
    cached = crypto.subtle.importKey(
      "raw",
      encoder.encode(material),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    keyCache.set(material, cached);
  }
  return cached;
}

function hex(buffer: ArrayBuffer, bytes: number): string {
  return Array.from(new Uint8Array(buffer).slice(0, bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * A namespaced, keyed digest of one identifier.
 *
 * Returns an empty string for an empty input rather than the hash of "", so a
 * missing phone number on two accounts can never compare equal to itself and
 * block an honest referral.
 */
export async function referralHash(namespace: string, value: string): Promise<string> {
  const clean = value.trim();
  if (!clean) return "";
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(namespace), encoder.encode(clean));
  return hex(signature, 16);
}

/** The visitor's address as Cloudflare saw it, or an empty string. */
export function trustedClientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf && cf.trim()) return cf.trim();
  /*
    Off Cloudflare (local dev, tests) fall back to the platform header the
    dev server sets. `X-Forwarded-For` straight off the wire is never used on
    a deployment: the edge always sets `CF-Connecting-IP`, so reaching this
    line in production would mean the request did not come through it.
  */
  const real = request.headers.get("x-real-ip");
  return real?.trim() ?? "";
}

export async function hashIpForReferral(request: Request): Promise<string> {
  return referralHash("ip", trustedClientIp(request));
}

/** Iraqi numbers arrive in half a dozen spellings; compare the digits. */
export function normalizePhone(phone: unknown): string {
  const digits = String(phone ?? "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  // 07xx… , 9647xx… and +9647xx… are the same subscriber.
  const withoutCountry = digits.replace(/^00?964/, "").replace(/^964/, "");
  return withoutCountry.replace(/^0+/, "");
}

/**
 * Email as an identity rather than as a string.
 *
 * `A.User+shop@gmail.com` and `auser@googlemail.com` are one mailbox, and
 * treating them as two is exactly the gap a second account is created through.
 */
export function normalizeEmail(email: unknown): string {
  const raw = String(email ?? "").trim().toLowerCase();
  if (!raw.includes("@")) return raw;
  const [localPart = "", domainPart = ""] = raw.split("@");
  const domain = domainPart === "googlemail.com" ? "gmail.com" : domainPart;
  let local = localPart.split("+")[0] ?? "";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return local && domain ? `${local}@${domain}` : raw;
}

export interface ContactHashes {
  phoneHash: string;
  emailHash: string;
  telegramHash: string;
}

/** The contact identities of one account, all hashed. */
export async function contactHashes(user: {
  phone?: string | null;
  email?: string | null;
  telegramId?: string | null;
}): Promise<ContactHashes> {
  const [phoneHash, emailHash, telegramHash] = await Promise.all([
    referralHash("phone", normalizePhone(user.phone)),
    referralHash("email", normalizeEmail(user.email)),
    referralHash("telegram", String(user.telegramId ?? "").trim()),
  ]);
  return { phoneHash, emailHash, telegramHash };
}

/**
 * A user agent with the parts that change on their own taken out.
 *
 * Chrome ships a new major version every four weeks; keeping the full string
 * would make the same phone a different device after an update, which loses
 * exactly the link this is for. Brand, platform and form factor are kept.
 */
export function normalizeUserAgent(userAgent: unknown): string {
  return String(userAgent ?? "")
    .toLowerCase()
    // Version numbers: `chrome/124.0.6367.62` becomes `chrome/#`.
    .replace(/\d+(?:[._]\d+)+/g, "#")
    .replace(/\d{2,}/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** The client-side signals a page may offer. Advisory: never trusted alone. */
export interface DeviceHints {
  timezone?: string | null;
  screen?: string | null;
  platform?: string | null;
  language?: string | null;
}

function cleanHint(value: unknown, max = 64): string {
  return String(value ?? "")
    .trim()
    .replace(/[^\w/:+.,-]/g, "")
    .slice(0, max);
}

/**
 * The device fingerprint, derived on the server.
 *
 * Composed of what the request itself carries — the normalised user agent, the
 * platform and form-factor client hints, the primary accept-language — plus
 * whatever the page volunteered. The client's contribution can be faked, but
 * the header half cannot be removed without changing the browser, which is why
 * clearing a cookie does not produce a new device here: nothing in this value
 * comes from a cookie.
 */
export async function deviceFingerprintHash(
  request: Request,
  hints?: DeviceHints,
): Promise<string> {
  const headers = request.headers;
  const material = [
    normalizeUserAgent(headers.get("user-agent")),
    cleanHint(headers.get("sec-ch-ua-platform")),
    cleanHint(headers.get("sec-ch-ua-mobile"), 8),
    cleanHint(headers.get("accept-language")?.split(",")[0]),
    cleanHint(hints?.platform),
    cleanHint(hints?.timezone),
    cleanHint(hints?.screen, 32),
    cleanHint(hints?.language, 16),
  ].join("|");
  return referralHash("device", material);
}
