/**
 * Text normalisation for Arabic, English and Kurdish (Sorani) search input.
 *
 * People type the same problem a dozen ways: with or without diacritics, with
 * "ا" spelled as "أ", with words run together ("مايشتغل"), in Latin letters, or
 * with a typo. Everything here exists to collapse those variants onto one
 * comparable form before scoring.
 */

/* Tashkeel, Quranic marks and tatweel carry no search meaning. */
const DIACRITICS = /[ً-ٰٟۖ-ۭـ]/g;

/* Letters that users interchange freely across Arabic/Kurdish/Farsi keyboards. */
const LETTER_FOLDS: Record<string, string> = {
  أ: "ا", // أ
  إ: "ا", // إ
  آ: "ا", // آ
  ٱ: "ا", // ٱ
  ى: "ي", // ى
  ئ: "ي", // ئ
  ی: "ي", // ی  (Farsi/Kurdish yeh)
  ے: "ي", // ے
  ێ: "ي", // ێ  (Kurdish e)
  ة: "ه", // ة
  ە: "ه", // ە  (Kurdish he)
  ؤ: "و", // ؤ
  ۆ: "و", // ۆ  (Kurdish o)
  ک: "ك", // ک  (Farsi/Kurdish kaf)
  ڵ: "ل", // ڵ  (Kurdish l)
  ڕ: "ر", // ڕ  (Kurdish r)
};

const LETTER_FOLD_RE = new RegExp(`[${Object.keys(LETTER_FOLDS).join("")}]`, "g");

/* Arabic-Indic and extended Arabic-Indic digits. */
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

function foldDigit(char: string): string {
  const code = char.charCodeAt(0);
  const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
  return String((code - base) as number);
}

/** Anything that is not a letter or a number becomes a separator. */
const NON_WORD = /[^\p{L}\p{N}]+/gu;

/**
 * Canonical comparable form: lowercase, undiacritised, letter-folded,
 * punctuation-free, single-spaced.
 */
export function normalize(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .replace(LETTER_FOLD_RE, (char) => LETTER_FOLDS[char] ?? char)
    .replace(ARABIC_DIGITS, foldDigit)
    .replace(NON_WORD, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Space-free form. This is what makes "ما يشتغل" and "مايشتغل" — and
 * "joy con" / "joycon" / "joy-con" — the same string.
 */
export function squash(input: string): string {
  return normalize(input).replace(/\s+/g, "");
}

/* Definite article and common single-letter proclitics. Stripping "ال" is what
   lets the query "الحساب" reach the keyword "حساب". */
const AL_PREFIX = /^(?:وال|بال|كال|فال|ال)(?=.{3,})/;
const CONJ_PREFIX = /^(?:و|ف)(?=.{4,})/;

/** Conservative Arabic stem: only strips affixes that never change meaning. */
export function stem(token: string): string {
  let out = token.replace(AL_PREFIX, "").replace(CONJ_PREFIX, "");
  if (out.length > 4) {
    out = out.replace(/(?:ات|ين|ون|ها|هم)$/, "");
  }
  if (out.length > 4 && /(?:ing|ies|es|s)$/.test(out)) {
    out = out.replace(/ies$/, "y").replace(/(?:ing|es|s)$/, "");
  }
  return out || token;
}

/* Words that carry no discriminating signal on their own. They are not dropped
   — a query can be nothing but these — just scored far lower. */
const WEAK = new Set([
  "ما",
  "لا",
  "مو",
  "مب",
  "في",
  "من",
  "على",
  "الى",
  "عن",
  "هذا",
  "هذه",
  "هاي",
  "اني",
  "انا",
  "عندي",
  "صار",
  "ليش",
  "شنو",
  "شلون",
  "كيف",
  "ليه",
  "مشكله",
  "مساعده",
  "ساعدوني",
  "the",
  "a",
  "an",
  "is",
  "are",
  "my",
  "i",
  "to",
  "of",
  "in",
  "on",
  "it",
  "for",
  "and",
  "why",
  "how",
  "what",
  // Filler that shows up in almost every complaint — "account not working" and
  // "code not working" differ only in their first word, so the rest must not
  // outvote it.
  "not",
  "no",
  "wont",
  "dont",
  "doesnt",
  "cant",
  "cannot",
  "working",
  "works",
  "work",
  "problem",
  "issue",
  "help",
  "please",
  "with",
  "when",
  "still",
]);

export function isWeakToken(token: string): boolean {
  return WEAK.has(token) || token.length < 2;
}

/**
 * Colloquial and cross-language bridges, applied to the query only.
 *
 * The catalogue already stores Arabic/English/Kurdish keywords per problem, so
 * expanding the query in both directions is enough to connect "login problem"
 * and "الحساب ما يدخل" to the same entry.
 */
const SYNONYMS: Record<string, string[]> = {
  // — colloquial Arabic → standard
  يشتغل: ["يعمل", "working", "work"],
  تشتغل: ["يعمل", "working", "work"],
  اشتغل: ["يعمل", "working"],
  مايشتغل: ["لا يعمل", "not working", "خلل"],
  ماكو: ["لا يوجد", "not found", "مفقود"],
  خربان: ["عطل", "broken", "لا يعمل"],
  خربانه: ["عطل", "broken"],
  يطلع: ["يظهر", "shows"],
  طلع: ["يظهر", "shows"],
  ايرور: ["error", "خطا", "خطأ"],
  خطا: ["error"],
  باسورد: ["password", "كلمه المرور", "كلمه السر"],
  بسورد: ["password", "كلمه المرور"],
  ايميل: ["email", "بريد"],
  حسابي: ["حساب", "account"],
  يعلق: ["تعليق", "freeze", "crash"],
  معلق: ["تعليق", "freeze"],
  علق: ["تعليق", "freeze"],
  طلبيه: ["طلب", "order"],
  طلبي: ["طلب", "order"],
  شحنه: ["شحن", "shipment", "tracking"],
  فيزا: ["visa", "بطاقه", "card"],
  نت: ["انترنت", "internet", "wifi"],
  واي: ["wifi"],
  سويج: ["switch", "نينتندو"],
  سويتش: ["switch", "نينتندو"],
  جويكون: ["joycon", "joy con", "عصا"],
  الجويكون: ["joycon", "عصا"],
  درفت: ["drift", "انحراف"],
  دريفت: ["drift", "انحراف"],
  انالوك: ["joycon", "عصا", "stick"],
  بن: ["pin", "رمز"],
  كود: ["code", "رمز"],
  دوك: ["dock"],
  ريجن: ["region", "منطقه"],
  لعبه: ["لعبة", "game"],
  الالعاب: ["لعبة", "game"],

  // — English → Arabic
  login: ["تسجيل الدخول", "دخول", "حساب"],
  signin: ["تسجيل الدخول", "دخول", "حساب"],
  sign: ["تسجيل الدخول", "دخول"],
  password: ["كلمه المرور", "كلمه السر", "رمز"],
  account: ["حساب"],
  error: ["خطا", "رمز خطا"],
  game: ["لعبة", "لعبه"],
  order: ["طلب", "طلبيه"],
  shipping: ["شحن", "توصيل"],
  shipment: ["شحن", "شحنه"],
  tracking: ["تتبع", "شحن"],
  track: ["تتبع"],
  payment: ["دفع", "بطاقه"],
  pay: ["دفع"],
  card: ["بطاقه", "كارت"],
  declined: ["مرفوضه", "رفض"],
  download: ["تحميل", "تنزيل"],
  slow: ["بطيء", "بطي"],
  broken: ["خربان", "عطل"],
  crash: ["تعليق", "توقف"],
  freeze: ["تعليق", "تجمد"],
  frozen: ["تعليق", "تجمد"],
  working: ["يعمل", "يشتغل"],
  work: ["يعمل", "يشتغل"],
  dock: ["دوك", "تلفزيون"],
  signal: ["اشاره", "صوره"],
  parental: ["رقابه ابويه", "قفل"],
  pin: ["رمز", "بن"],
  code: ["كود", "رمز"],
  redeem: ["استرداد", "كود"],
  region: ["منطقه", "ريجن"],
  controller: ["عصا", "تحكم", "joycon"],
  drift: ["انحراف", "عصا"],
  screen: ["شاشه"],
  black: ["سوداء", "سوده"],
  charging: ["شحن", "بطاريه"],
  battery: ["بطاريه"],
  eshop: ["متجر", "shop"],
  store: ["متجر"],

  // — Kurdish (Sorani) → Arabic/English, after letter folding
  هژمار: ["حساب", "account"],
  وشهي: ["كلمه المرور", "password"],
  نهيني: ["كلمه المرور", "password", "رمز"],
  ياري: ["لعبة", "game"],
  هڵه: ["خطا", "error"],
  هله: ["خطا", "error"],
  داواكاري: ["طلب", "order"],
  گهياندن: ["شحن", "shipping"],
  پارهدان: ["دفع", "payment"],
  داگرتن: ["تحميل", "download"],
  شاشهي: ["شاشه", "screen"],
  ريش: ["سوداء", "black"],
  كار: ["يعمل", "working"],
  ناكات: ["لا يعمل", "not working"],
  قوفڵ: ["قفل", "lock"],
  كۆد: ["كود", "code"],
};

export interface QueryToken {
  /** Normalised surface form the user actually typed. */
  value: string;
  /** Stemmed form used for matching. */
  stem: string;
  /** Down-weights filler words like "ما" or "the". */
  weak: boolean;
  /** True for tokens introduced by synonym expansion, not typed by the user. */
  derived: boolean;
}

/**
 * Splits a raw query into scored, expanded tokens.
 *
 * `extraSynonyms` lets a second catalogue bring its own vocabulary without
 * putting it in everyone's way. The map above is the troubleshooting one —
 * «باسورد», «درفت», «ايرور» — and a shop searching for games has no use for
 * it, while «زيلدا» and «كارت» would be noise in a help search. Each catalogue
 * passes what it knows; neither pollutes the other.
 */
export function tokenizeQuery(
  raw: string,
  extraSynonyms?: Record<string, string[]>,
): QueryToken[] {
  const base = normalize(raw);
  if (!base) return [];

  const seen = new Set<string>();
  const tokens: QueryToken[] = [];

  const push = (value: string, derived: boolean) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    tokens.push({
      value: trimmed,
      stem: stem(trimmed),
      weak: isWeakToken(trimmed),
      derived,
    });
  };

  const words = base.split(" ");
  for (const word of words) {
    push(word, false);
  }

  // Expand from both the raw word and its stem, plus the whole squashed query
  // so a run-together phrase like "مايشتغل" still finds its synonyms.
  const expansionSeeds = [...words, ...words.map(stem), base.replace(/ /g, "")];
  for (const seed of expansionSeeds) {
    for (const synonym of [...(SYNONYMS[seed] ?? []), ...(extraSynonyms?.[seed] ?? [])]) {
      for (const part of normalize(synonym).split(" ")) {
        push(part, true);
      }
    }
  }

  return tokens;
}

/**
 * Bounded Damerau-Levenshtein distance. Returns `limit + 1` as soon as the
 * distance is known to exceed `limit`, which keeps the common "not even close"
 * case cheap.
 */
export function editDistance(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr: number[] = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        curr[j - 1]! + 1, // insertion
        prev[j]! + 1, // deletion
        prev[j - 1]! + cost, // substitution
      );

      // transposition — catches "teh" vs "the", "الحسبا" vs "الحساب"
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] && prev2.length > 0) {
        value = Math.min(value, prev2[j - 2]! + 1);
      }

      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > limit) return limit + 1;

    prev2 = prev;
    prev = curr;
    curr = new Array(b.length + 1);
  }

  return prev[b.length]!;
}

/** How many edits we forgive for a token of this length. */
export function typoBudget(length: number): number {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  return 3;
}
