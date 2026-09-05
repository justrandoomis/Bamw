/**
 * Referral codes: the stable identifier behind a shareable link.
 *
 * A link may show `?ref=username` because that is what a person will recognise
 * — but a username can be changed, and a link already sent to a friend must
 * keep working and keep paying the same member. So the shared text is only a
 * lookup key: the server resolves it to a code row, and the code row to a
 * `referrer_user_id` that never moves.
 */

/** Characters a code is drawn from: unambiguous in a screenshot or by voice. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Length of a generated code. 8 of a 32-symbol alphabet is 40 bits. */
const CODE_LENGTH = 8;

/** What a code may look like once normalised. */
export const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{6,16}$/;

/** What a username may look like when it stands in for a code in a link. */
export const REFERRAL_ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{1,30}$/;

/** Upper-cased, stripped of the separators people paste along with a code. */
export function normalizeReferralCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "")
    .slice(0, 16);
}

/** Lower-cased, with the `@` a person naturally types removed. */
export function normalizeReferralAlias(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .slice(0, 32);
}

export function isValidReferralCode(value: unknown): boolean {
  return REFERRAL_CODE_PATTERN.test(normalizeReferralCode(value));
}

export function isValidReferralAlias(value: unknown): boolean {
  return REFERRAL_ALIAS_PATTERN.test(normalizeReferralAlias(value));
}

/**
 * What the member typed, split into the two things it could be.
 *
 * The manual field in the cart accepts either, so the server has to try both
 * without letting a malformed value reach a query.
 */
export function parseReferralInput(value: unknown): { code?: string; alias?: string } {
  const raw = String(value ?? "").trim();
  if (!raw) return {};
  const code = normalizeReferralCode(raw);
  const alias = normalizeReferralAlias(raw);
  return {
    ...(REFERRAL_CODE_PATTERN.test(code) ? { code } : {}),
    ...(REFERRAL_ALIAS_PATTERN.test(alias) ? { alias } : {}),
  };
}

/** A fresh code, drawn from the platform's CSPRNG. */
export function generateReferralCode(length = CODE_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/**
 * The public link for a code.
 *
 * A product-specific link carries the game, because the offer the friend is
 * shown is tied to it; the member's general link carries only the code.
 */
export function referralLink(params: {
  origin: string;
  code: string;
  alias?: string;
  productSlug?: string;
}): string {
  const origin = params.origin.replace(/\/+$/, "");
  const ref = params.alias || params.code;
  if (params.productSlug) {
    return `${origin}/product/${encodeURIComponent(params.productSlug)}?ref=${encodeURIComponent(ref)}`;
  }
  /*
    The shop's front door, not the referral page.

    This pointed at `/refer`, which is the *referrer's* own screen — "invite a
    friend, here is your link". A friend who followed an invitation arrived at
    a page telling them to invite somebody, with nothing to buy on it, and the
    discount they had just earned sitting invisibly in a cookie. The capture
    runs on whatever page they land on, so the landing may as well be the one
    with the games on it.
  */
  return `${origin}/?ref=${encodeURIComponent(ref)}`;
}
