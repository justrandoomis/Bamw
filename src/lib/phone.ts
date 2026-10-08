/**
 * Phone helpers shared by the auth UI and the server.
 *
 * Numbers are stored in one canonical E.164 form (`+9647701234567`) so a user
 * can sign in with whatever local spelling they typed at signup.
 */

/** Default country dialling code used when the user types a local number. */
export const DEFAULT_DIAL_CODE = "964";

export const COUNTRY_PHONE_CONFIG: Record<string, { len: number; startsWith?: string[] }> = {
  "964": { len: 10, startsWith: ["7"] }, // Iraq
  "966": { len: 9, startsWith: ["5"] }, // Saudi Arabia
  "971": { len: 9, startsWith: ["5"] }, // UAE
  "965": { len: 8 }, // Kuwait
  "974": { len: 8 }, // Qatar
  "973": { len: 8 }, // Bahrain
  "968": { len: 8 }, // Oman
  "962": { len: 9, startsWith: ["7"] }, // Jordan
  "963": { len: 9, startsWith: ["9"] }, // Syria
  "961": { len: 8 }, // Lebanon
  "20": { len: 10, startsWith: ["1"] }, // Egypt
  "967": { len: 9, startsWith: ["7"] }, // Yemen
  "970": { len: 9, startsWith: ["5"] }, // Palestine
  "218": { len: 9, startsWith: ["9"] }, // Libya
  "249": { len: 9 }, // Sudan
  "216": { len: 8 }, // Tunisia
  "213": { len: 9 }, // Algeria
  "212": { len: 9 }, // Morocco
  "90": { len: 10, startsWith: ["5"] }, // Turkey
  "98": { len: 10, startsWith: ["9"] }, // Iran
  "1": { len: 10 }, // US/Canada
  "44": { len: 10, startsWith: ["7"] }, // UK mobile
  "49": { len: 11 }, // Germany
  "46": { len: 9 }, // Sweden
};

export function getExpectedPhoneLength(dial: string): number {
  return COUNTRY_PHONE_CONFIG[dial]?.len ?? 10;
}

export function cleanPhoneInput(rawInput: string, dial: string): string {
  if (!rawInput) return "";

  // 1. Convert Arabic and Persian digits to English 0-9
  let val = rawInput
    .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1632 + 48))
    .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1776 + 48));

  // 2. Remove all non-digits (except potential initial + which we clean)
  val = val.replace(/[^\d]/g, "");

  // 3. If user pasted dial code (e.g. 964783... or 00964783...), strip it
  if (val.startsWith("00" + dial)) {
    val = val.slice(2 + dial.length);
  } else if (val.startsWith(dial) && val.length > dial.length + 6) {
    val = val.slice(dial.length);
  }

  // 4. Strip any leading zeros (e.g. 0783 -> 783)
  while (val.startsWith("0")) {
    val = val.slice(1);
  }

  // 5. Enforce max length based on dial code
  const maxLen = getExpectedPhoneLength(dial);
  if (val.length > maxLen) {
    val = val.slice(0, maxLen);
  }

  return val;
}

export function normalizePhone(input: string, dialCode = DEFAULT_DIAL_CODE): string | undefined {
  if (!input) return undefined;

  // Convert Arabic/Persian digits to English
  const englishInput = input
    .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1632 + 48))
    .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1776 + 48));

  let digits = englishInput.replace(/[^\d+]/g, "");
  if (!digits) return undefined;

  // Clean country code or prefix
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Check if digits already start with any known country dial code
  const knownDials = Object.keys(COUNTRY_PHONE_CONFIG).sort((a, b) => b.length - a.length);
  const matchedDial = knownDials.find((d) => digits.startsWith(d));

  if (matchedDial) {
    let rest = digits.slice(matchedDial.length);
    while (rest.startsWith("0")) rest = rest.slice(1);
    digits = `${matchedDial}${rest}`;
  } else if (digits.startsWith(dialCode)) {
    let rest = digits.slice(dialCode.length);
    while (rest.startsWith("0")) rest = rest.slice(1);
    digits = `${dialCode}${rest}`;
  } else {
    // Strip leading 0 from local part and prepend dialCode
    while (digits.startsWith("0")) digits = digits.slice(1);
    digits = `${dialCode}${digits}`;
  }

  digits = digits.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return undefined;
  return `+${digits}`;
}

/**
 * Canonical phone comparison (strict match of E.164 form).
 * The legacy end-matches (suffix/slice) are removed to prevent identity collisions.
 */
export function arePhonesEqual(phoneA?: string | null, phoneB?: string | null): boolean {
  if (!phoneA || !phoneB) return false;
  const normA = normalizePhone(phoneA);
  const normB = normalizePhone(phoneB);
  return !!normA && !!normB && normA === normB;
}

/**
 * LOOSE phone comparison used ONLY for admin searching and UI filtering.
 * NEVER use this for authentication or identity matching.
 */
export function arePhonesLooselyEqual(phoneA?: string | null, phoneB?: string | null): boolean {
  if (!phoneA || !phoneB) return false;
  if (arePhonesEqual(phoneA, phoneB)) return true;

  const clean = (p: string) =>
    p
      .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1632 + 48))
      .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1776 + 48))
      .replace(/\D/g, "")
      .replace(/^0+/, "");

  const ca = clean(phoneA);
  const cb = clean(phoneB);

  if (!ca || !cb || ca.length < 8 || cb.length < 8) return false;
  return ca.endsWith(cb) || cb.endsWith(ca) || ca.slice(-9) === cb.slice(-9);
}

export function isPhoneLike(value: string) {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed.includes("@")) return false;
  return /^[+\d][\d\s\-()]{6,}$/.test(trimmed);
}

/** Masked form used in confirmation copy: +96477***4567 */
export function maskPhone(phone: string) {
  if (phone.length < 8) return phone;
  return `${phone.slice(0, 6)}***${phone.slice(-4)}`;
}

/**
 * Accounts created with a phone number only still need a unique email key in
 * the database, so we derive a deterministic internal address. It is never
 * shown to the user and can be replaced from the profile page.
 */
export function phonePlaceholderEmail(phone: string) {
  return `${phone.replace(/\D/g, "")}@phone.banana.local`;
}

/**
 * The email an account made with a login code is stored under: it has none,
 * and the column cannot be empty — an empty email would match every other
 * account without one. Unique by the account's id, and in a domain that
 * cannot receive mail.
 */
export function codePlaceholderEmail(userId: string) {
  return `${userId.replace(/[^\w-]/g, "")}@code.banana.local`;
}

export function isPlaceholderEmail(email: string) {
  return email.endsWith("@phone.banana.local") || email.endsWith("@code.banana.local");
}
