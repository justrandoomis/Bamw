/**
 * The login code: an account's whole key, for a member who would rather type
 * nothing at all.
 *
 *   «يمكن تسجيل الدخول بدون إدخال أي بيانات ... ينشئ النظام له كود تسجيل
 *    الدخول بحيث عند تسجيل الدخول عندما يضع الكود يسجل مباشرة»
 *
 * The member picks a username; the shop hands back a code; the code signs
 * them in, on any device, with nothing else. So the code carries the weight a
 * password and an email would share, and it is built for that:
 *
 * - 16 characters from Crockford's base-32 alphabet: 80 random bits, far past
 *   guessing even before the server's rate limit;
 * - no I, L, O or U, so nothing on the screen or on paper can be read two
 *   ways, and a typed O, I or L is taken as the 0 or 1 it must have been;
 * - shown in four groups of four, the way a member copies it by hand.
 *
 * Shared by the browser (formatting what is typed) and the server (making and
 * checking codes); nothing here touches storage.
 */

/** Crockford's base-32: digits and letters, without I, L, O and U. */
export const LOGIN_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LOGIN_CODE_LENGTH = 16;

/** A fresh code, as the bare 16 characters. 256 is a multiple of 32: no bias. */
export function generateLoginCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(LOGIN_CODE_LENGTH));
  let code = "";
  for (const byte of bytes) code += LOGIN_CODE_ALPHABET[byte % 32];
  return code;
}

/** «A7K2-9QXM-…»: the form a member reads, copies and writes down. */
export function formatLoginCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join("-");
}

/** What is being typed into the code field, grouped as it was shown: «A7K2-9Q». */
export function formatTypedCode(value: string): string {
  const bare = String(value ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, LOGIN_CODE_LENGTH);
  return formatLoginCode(bare);
}

/**
 * What the member typed, as the bare code — or null when it cannot be one.
 *
 * Case, spaces and dashes do not matter, and the letters Crockford leaves out
 * are read as the digits they look like, so a code copied by hand from paper
 * still signs in.
 */
export function normalizeLoginCode(input: string): string | null {
  const bare = String(input ?? "")
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (bare.length !== LOGIN_CODE_LENGTH) return null;
  for (const char of bare) if (!LOGIN_CODE_ALPHABET.includes(char)) return null;
  return bare;
}

/** The username a code account is known by. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/*
  Names that would let one member pass for the shop, or for its staff.
  Compared after lower-casing and after dropping dots and underscores, so
  «ad.min» and «Support_» are caught too.
*/
const RESERVED = [
  "admin",
  "administrator",
  "support",
  "help",
  "staff",
  "moderator",
  "owner",
  "system",
  "root",
  "bananto",
  "banana",
  "bananto_support",
  "official",
  "security",
  "billing",
  "wallet",
];

export type UsernameProblem = "short" | "long" | "characters" | "edges" | "reserved";

/** The username as stored: trimmed, lower-case, without a leading @. */
export function normalizeUsername(input: string): string {
  return String(input ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

/**
 * Why a username cannot be used, or null when it can.
 *
 * English letters, digits, dots and underscores — the characters every
 * keyboard has and every person can read back over the phone — starting with
 * a letter, and never beginning or ending on a dot or an underscore.
 */
export function usernameProblem(input: string): UsernameProblem | null {
  const name = normalizeUsername(input);
  if (name.length < USERNAME_MIN) return "short";
  if (name.length > USERNAME_MAX) return "long";
  if (!/^[a-z0-9._]+$/.test(name)) return "characters";
  if (!/^[a-z]/.test(name) || /[._]$/.test(name) || /[._]{2}/.test(name)) return "edges";
  const bare = name.replace(/[._]/g, "");
  if (RESERVED.some((word) => bare === word.replace(/[._]/g, "") || bare.startsWith("admin")))
    return "reserved";
  return null;
}

/** The problem in words, in the member's language. */
export function usernameProblemText(problem: UsernameProblem, lang: "ar" | "en"): string {
  const ar: Record<UsernameProblem, string> = {
    short: `اسم المستخدم ${USERNAME_MIN} أحرف على الأقل`,
    long: `اسم المستخدم ${USERNAME_MAX} حرفاً على الأكثر`,
    characters: "استخدم حروفاً إنجليزية وأرقاماً فقط، ويمكن النقطة والشرطة السفلية",
    edges: "ابدأ بحرف إنجليزي، ولا تنهِ الاسم بنقطة أو شرطة",
    reserved: "هذا الاسم محجوز، اختر اسماً آخر",
  };
  const en: Record<UsernameProblem, string> = {
    short: `At least ${USERNAME_MIN} characters`,
    long: `At most ${USERNAME_MAX} characters`,
    characters: "English letters and digits only; a dot or underscore is fine",
    edges: "Start with a letter, and don't end with a dot or underscore",
    reserved: "This name is reserved — pick another",
  };
  return (lang === "ar" ? ar : en)[problem];
}
