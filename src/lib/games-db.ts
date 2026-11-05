/**
 * The games database: every Nintendo Switch and Switch 2 title in Nintendo
 * Europe's official index, at /games-db — a section of its own, beside the
 * catalogue rather than inside it.
 *
 * One module for the three places that must agree about a title: the loader
 * that writes the rows (`scripts/games-db-load.mjs`), the API that searches
 * them (`src/lib/games-db.server.ts`) and the pages that show them. A search
 * only works if the query is folded exactly the way the stored title was, so
 * there is exactly one `foldTitle`.
 *
 * It imports nothing, on purpose: the loader runs under plain Node, which reads
 * this file directly by stripping its types. An import here would have to
 * resolve without Vite's aliases, and the loader would be the one to find out.
 */

export type GamesDbPlatform = "switch1" | "switch2" | "both";
export type GamesDbPlatformFilter = "" | "switch1" | "switch2";
/**
 * «new» is released games, newest first (upcoming ones after them); «soon» is
 * only the games still to come, soonest first; «az» is everything by name.
 */
export type GamesDbSort = "new" | "soon" | "az";

/** A page of the grid: divisible by 2, 3, 4 and 6, the column counts it has. */
export const GAMES_DB_PAGE_SIZE = 24;
/** Twenty thousand titles is 837 pages; anything past this is not a person paging. */
export const GAMES_DB_MAX_PAGE = 1000;
/** A query is echoed into a cache key and a SQL parameter; it is bounded for both. */
export const GAMES_DB_MAX_QUERY_LENGTH = 80;
/**
 * Every word of a query is one `LIKE` parameter, so the word count is the
 * parameter count — capped here, in the source, rather than by whatever the
 * address bar was pasted full of. D1 refuses past 100.
 */
export const GAMES_DB_MAX_TOKENS = 6;

/* ------------------------------------------------------------------ */
/* Folding                                                             */
/* ------------------------------------------------------------------ */

/* Letters people type interchangeably on Arabic keyboards. */
const ARABIC_FOLDS: Record<string, string> = {
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ى: "ي",
  ئ: "ي",
  ی: "ي",
  ة: "ه",
  ؤ: "و",
  ک: "ك",
};
const ARABIC_FOLD_RE = new RegExp(`[${Object.keys(ARABIC_FOLDS).join("")}]`, "g");

/**
 * A title or a query, folded to the form both are compared in: lowercase, no
 * accents, no trademark signs, Arabic letters and digits folded, and every run
 * of punctuation a single space.
 *
 * The trademark signs go first because NFKD spells ™ out as "TM": «Pokémon™
 * Legends» would otherwise be stored as "pokemon tm legends" and found by
 * nobody who did not type "tm".
 */
export function foldTitle(input: unknown): string {
  return String(input ?? "")
    .replace(/[™®©℠]/g, " ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ـ/g, "")
    .toLowerCase()
    .replace(ARABIC_FOLD_RE, (char) => ARABIC_FOLDS[char] ?? char)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * The address of a title: its name in ASCII, then Nintendo's id.
 *
 * The id makes it unique — the same name exists on both consoles, and some
 * names exist twice on one — and keeps an old link working after Nintendo
 * renames a game, because the page looks the id up when the whole slug does
 * not match (`euIdFromSlug`).
 */
export function slugFor(title: unknown, euId: unknown): string {
  const id = String(euId ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const base = foldTitle(title)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base ? `${base}-${id}` : `game-${id}`;
}

/** The id at the end of a slug, the part that survives a rename. */
export function euIdFromSlug(slug: unknown): string {
  const text = String(slug ?? "")
    .trim()
    .toLowerCase();
  const last = text.slice(text.lastIndexOf("-") + 1);
  return /^[a-z0-9]{1,40}$/.test(last) ? last : "";
}

/* ------------------------------------------------------------------ */
/* Consoles                                                            */
/* ------------------------------------------------------------------ */

/**
 * Nintendo's console codes to ours: HAC is Switch, BEE is Switch 2. A title
 * that lists both runs on both — a Switch game Switch 2 plays, or a Switch 2
 * Edition sold alongside the original.
 */
export function platformFromConsoles(consoles: readonly unknown[]): GamesDbPlatform {
  const codes = consoles.map((c) => String(c).toUpperCase());
  if (codes.includes("BEE") && !codes.includes("HAC")) return "switch2";
  if (codes.includes("BEE")) return "both";
  return "switch1";
}

export function isGamesDbPlatform(value: unknown): value is GamesDbPlatform {
  return value === "switch1" || value === "switch2" || value === "both";
}

export const PLATFORM_LABELS: Record<GamesDbPlatform, string> = {
  switch1: "Nintendo Switch",
  switch2: "Nintendo Switch 2",
  both: "Switch و Switch 2",
};

/** The stored values a console filter accepts: «Switch 2» includes what runs on both. */
export function platformsFor(filter: GamesDbPlatformFilter): GamesDbPlatform[] {
  if (filter === "switch1") return ["switch1", "both"];
  if (filter === "switch2") return ["switch2", "both"];
  return [];
}

/* ------------------------------------------------------------------ */
/* Genres                                                              */
/* ------------------------------------------------------------------ */

/** Nintendo's genre name as a filter value: «Role-Playing» → "role-playing". */
export function genreId(name: unknown): string {
  return foldTitle(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Nintendo Europe's genres, in the shop's Arabic — every name the index used
 * on 2026-11-05, largest first. A genre Nintendo adds later shows in English
 * until it is named here.
 */
export const GENRE_LABELS: Record<string, string> = {
  adventure: "مغامرات",
  action: "أكشن",
  arcade: "أركيد",
  puzzle: "ألغاز",
  simulation: "محاكاة",
  rpg: "آر بي جي",
  strategy: "استراتيجية",
  platformer: "منصات",
  other: "أخرى",
  shooter: "تصويب",
  party: "حفلات",
  "board-game": "ألعاب لوحية",
  racing: "سباق",
  sports: "رياضة",
  education: "تعليمي",
  fighting: "قتال",
  lifestyle: "نمط حياة",
  training: "تدريب",
  "first-person-shooter": "تصويب من منظور الشخص الأول",
  music: "موسيقى",
  communication: "تواصل",
  study: "دراسة",
  utility: "أدوات",
  football: "كرة قدم",
  "shop-shop": "متجر",
  golf: "غولف",
  "system-tool": "أدوات النظام",
  multiplayer: "لعب جماعي",
  "health-fitness": "صحة ولياقة",
  "animal-life": "حياة الحيوانات",
  tennis: "تنس",
  extreme: "رياضات قصوى",
  cooking: "طبخ",
};

export function genreLabel(id: string, fallback = ""): string {
  if (GENRE_LABELS[id]) return GENRE_LABELS[id];
  if (fallback) return fallback;
  return id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Series                                                              */
/* ------------------------------------------------------------------ */

/**
 * Nintendo files a game's series as an internal key («the_legend_of_zelda»),
 * not a name. These are all 26 keys the index used on 2026-11-05, spelled the
 * way the series spells itself; a key added later is spaced and capitalised.
 */
const SERIES_NAMES: Record<string, string> = {
  "51_worldwide_games": "51 Worldwide Games",
  ace_attorney: "Ace Attorney",
  animal_crossing: "Animal Crossing",
  bayonetta: "Bayonetta",
  donkey_kong: "Donkey Kong",
  dr_kawashimas_brain_training: "Dr Kawashima's Brain Training",
  final_fantasy: "Final Fantasy",
  fire_emblem: "Fire Emblem",
  kirby: "Kirby",
  lego: "LEGO",
  mario_kart: "Mario Kart",
  mario_party: "Mario Party",
  mario_sports: "Mario Sports",
  metroid: "Metroid",
  monster_hunter: "Monster Hunter",
  pikmin: "Pikmin",
  pokemon: "Pokémon",
  professor_layton: "Professor Layton",
  sonic_the_hedgehog: "Sonic the Hedgehog",
  splatoon: "Splatoon",
  super_mario: "Super Mario",
  super_smash_bros: "Super Smash Bros.",
  the_legend_of_zelda: "The Legend of Zelda",
  warioware: "WarioWare",
  xenoblade_chronicles: "Xenoblade Chronicles",
  yoshi: "Yoshi",
};

export function seriesLabel(key: string): string {
  const known = SERIES_NAMES[key.trim().toLowerCase()];
  if (known) return known;
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* Languages                                                           */
/* ------------------------------------------------------------------ */

const LANGUAGE_LABELS: Record<string, string> = {
  arabic: "العربية",
  english: "الإنجليزية",
  french: "الفرنسية",
  german: "الألمانية",
  spanish: "الإسبانية",
  italian: "الإيطالية",
  dutch: "الهولندية",
  portuguese: "البرتغالية",
  russian: "الروسية",
  japanese: "اليابانية",
  chinese: "الصينية",
  korean: "الكورية",
  polish: "البولندية",
  turkish: "التركية",
  swedish: "السويدية",
  danish: "الدنماركية",
  norwegian: "النرويجية",
  finnish: "الفنلندية",
  czech: "التشيكية",
  hungarian: "الهنغارية",
  greek: "اليونانية",
  ukrainian: "الأوكرانية",
  thai: "التايلاندية",
  hebrew: "العبرية",
};

/** «Japanese, English, Chinese» → ["Japanese", "English", "Chinese"]. */
export function splitLanguages(value: unknown): string[] {
  return String(value ?? "")
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function languageLabel(name: string): string {
  return LANGUAGE_LABELS[foldTitle(name)] ?? name;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/**
 * The names an Arabic speaker types for a series, one English word each.
 *
 * Nintendo's index is English, so «زيلدا» has to become "zelda" before it can
 * match anything. Each line is one word, not a phrase, because every word of a
 * query must match: «ماريو كارت» works only if «كارت» means "kart" here — in
 * the shop's own search it means a gift card. Two-word names list both halves,
 * and a name written as one English word maps both halves to it («ماين كرافت»
 * → minecraft, minecraft).
 *
 * Keys are folded (أ→ا, ة→ه, ى→ي), as the query is.
 */
const ARABIC_TITLE_WORDS: Record<string, string> = {
  زيلدا: "zelda",
  ماريو: "mario",
  كارت: "kart",
  لويجي: "luigi",
  يوشي: "yoshi",
  واريو: "wario",
  بيتش: "peach",
  دونكي: "donkey",
  كونج: "kong",
  كونغ: "kong",
  بوكيمون: "pokemon",
  بوكمون: "pokemon",
  كيربي: "kirby",
  ميترويد: "metroid",
  سبلاتون: "splatoon",
  سماش: "smash",
  انيمال: "animal",
  كروسنج: "crossing",
  كروسنغ: "crossing",
  بيكمين: "pikmin",
  زينوبليد: "xenoblade",
  فاير: "fire",
  امبلم: "emblem",
  بايونيتا: "bayonetta",
  سونيك: "sonic",
  ماين: "minecraft",
  كرافت: "minecraft",
  ماينكرافت: "minecraft",
  فيفا: "fifa",
  فورتنايت: "fortnite",
  ليغو: "lego",
  ليجو: "lego",
  هاري: "harry",
  بوتر: "potter",
  هوغوارتس: "hogwarts",
  هوجوارتس: "hogwarts",
  باتمان: "batman",
  ناروتو: "naruto",
  دراغون: "dragon",
  دراجون: "dragon",
  بول: "ball",
  ون: "one",
  بيس: "piece",
  ستريت: "street",
  فايتر: "fighter",
  مورتال: "mortal",
  كومبات: "kombat",
  تيكن: "tekken",
  ديزني: "disney",
  سبونج: "spongebob",
  بوب: "spongebob",
  هولو: "hollow",
  نايت: "knight",
  كب: "cuphead",
  هيد: "cuphead",
  كابهيد: "cuphead",
  اوفركوكد: "overcooked",
  مونستر: "monster",
  هنتر: "hunter",
  فاينل: "final",
  فانتسي: "fantasy",
  فانتازي: "fantasy",
  ريزدنت: "resident",
  ايفل: "evil",
  ويتشر: "witcher",
  سكايرم: "skyrim",
  دووم: "doom",
  كرش: "crash",
  سبايرو: "spyro",
  رايمان: "rayman",
  تتريس: "tetris",
  باك: "pac",
  مان: "man",
  ميغا: "mega",
  ميجا: "mega",
  شوفل: "shovel",
  ستاردو: "stardew",
  فالي: "valley",
  تيراريا: "terraria",
  روكيت: "rocket",
  ليغ: "league",
  ليج: "league",
  كول: "call",
  ديوتي: "duty",
  سايبربنك: "cyberpunk",
  هيدز: "hades",
  سيلست: "celeste",
  اوكتوباث: "octopath",
  بيرسونا: "persona",
  كينغدم: "kingdom",
  كنجدم: "kingdom",
  هارتس: "hearts",
  جست: "just",
  دانس: "dance",
  رينغ: "ring",
  رنغ: "ring",
  فت: "fit",
  رابيدز: "rabbids",
};

/**
 * Words that say nothing about which game: the console, the word «game», and
 * English filler. Dropped rather than required, or «لعبة زيلدا» would need a
 * title containing "لعبه".
 */
const STOP_WORDS = new Set([
  "the",
  "of",
  "a",
  "an",
  "and",
  "nintendo",
  "switch",
  "game",
  "games",
  "لعبه",
  "العاب",
  "الالعاب",
  "نينتندو",
  "نينتيندو",
  "ننتندو",
  "سويتش",
  "سويج",
  "سوتش",
]);

const ARABIC_LETTER = /[؀-ۿ]/;

/**
 * A query, as the words every result must contain.
 *
 * An Arabic word with an English name becomes that name. An Arabic word with
 * none is dropped when the query has another word to go on — «زيلدا الجديدة»
 * finds Zelda — and kept when it does not, so «غسالة» finds nothing rather
 * than everything.
 */
export function queryTokens(raw: unknown): string[] {
  const words = foldTitle(String(raw ?? "").slice(0, GAMES_DB_MAX_QUERY_LENGTH))
    .split(" ")
    .filter(Boolean);
  const known: string[] = [];
  const unknownArabic: string[] = [];
  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    const bare = word.replace(/^ال(?=.{3,})/, "");
    const english = ARABIC_TITLE_WORDS[word] ?? ARABIC_TITLE_WORDS[bare];
    if (english) known.push(english);
    else if (ARABIC_LETTER.test(word)) unknownArabic.push(word);
    else known.push(word);
  }
  const chosen = [...new Set(known.length ? known : unknownArabic)];
  /*
    A lone letter — the "s" of «Luigi's», the "x" of «Pokémon X» — matches
    nearly every title, so beside another word it only spends a parameter.
    Digits stay: «mario kart 8» means the 8. A query of nothing but lone
    letters keeps them, or it would filter nothing and answer with everything.
  */
  const useful = chosen.filter((t) => t.length > 1 || /\d/.test(t));
  return (useful.length ? useful : chosen).slice(0, GAMES_DB_MAX_TOKENS);
}

export interface GamesDbQuery {
  /** What was typed, trimmed and bounded — echoed back, never searched raw. */
  q: string;
  /** The words every result must contain (`queryTokens`). */
  tokens: string[];
  platform: GamesDbPlatformFilter;
  genre: string;
  page: number;
  sort: GamesDbSort;
}

type SearchInput = URLSearchParams | Record<string, unknown>;

function read(input: SearchInput, key: string): string {
  const value =
    typeof (input as URLSearchParams).get === "function"
      ? (input as URLSearchParams).get(key)
      : (input as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** A request's filters, validated: anything unrecognised falls back to the default. */
export function parseGamesDbQuery(input: SearchInput): GamesDbQuery {
  const q = read(input, "q").replace(/\s+/g, " ").trim().slice(0, GAMES_DB_MAX_QUERY_LENGTH);
  const platformRaw = read(input, "platform");
  const platform: GamesDbPlatformFilter =
    platformRaw === "switch1" || platformRaw === "switch2" ? platformRaw : "";
  const genre = genreId(read(input, "genre"));
  const pageNumber = Number.parseInt(read(input, "page"), 10);
  const page =
    Number.isFinite(pageNumber) && pageNumber > 1 ? Math.min(pageNumber, GAMES_DB_MAX_PAGE) : 1;
  const sortRaw = read(input, "sort");
  const sort: GamesDbSort = sortRaw === "az" || sortRaw === "soon" ? sortRaw : "new";
  return { q, tokens: queryTokens(q), platform, genre, page, sort };
}

/** The page's URL search, every key optional so a plain `/games-db` link stays valid. */
export interface GamesDbSearch {
  q?: string;
  platform?: "switch1" | "switch2";
  genre?: string;
  page?: number;
  sort?: "soon" | "az";
}

/**
 * The filters as the page's URL keeps them: validated, defaults left out.
 * Returning a key unconditionally would make it required at the type level and
 * break every plain `navigate({ to: "/games-db" })` — the trap /search notes.
 */
export function gamesDbSearch(query: GamesDbQuery): GamesDbSearch {
  const out: GamesDbSearch = {};
  if (query.q) out.q = query.q;
  if (query.platform) out.platform = query.platform;
  if (query.genre) out.genre = query.genre;
  if (query.page > 1) out.page = query.page;
  if (query.sort !== "new") out.sort = query.sort;
  return out;
}

/**
 * The filters as a query string, keys in a fixed order and defaults left out.
 * The API keys its edge cache on this, so two spellings of one question share
 * one cached answer; the page builds its fetch URL with it.
 */
export function gamesDbSearchString(query: Partial<GamesDbQuery>): string {
  const params = new URLSearchParams();
  if (query.genre) params.set("genre", query.genre);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.platform) params.set("platform", query.platform);
  if (query.q) params.set("q", query.q);
  if (query.sort && query.sort !== "new") params.set("sort", query.sort);
  return params.toString();
}

/* ------------------------------------------------------------------ */
/* What the API answers                                                */
/* ------------------------------------------------------------------ */

export interface GamesDbListItem {
  slug: string;
  title: string;
  platform: GamesDbPlatform;
  releaseDate: string;
  publisher: string;
  genres: string[];
  /** The square card, as Nintendo serves it; the page sends it through /api/img. */
  image: string;
  /** The shop's own page for this title, when it sells it and the product is live. */
  shopPath: string | null;
  delisted: boolean;
}

export interface GamesDbFacet {
  id: string;
  label: string;
  count: number;
}

export interface GamesDbListResponse {
  /** False until the loader has written the table: the page says so instead of «no results». */
  ready: boolean;
  items: GamesDbListItem[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  genres: GamesDbFacet[];
}

export interface GamesDbTitle {
  euId: string;
  slug: string;
  title: string;
  platform: GamesDbPlatform;
  releaseDate: string;
  publisher: string;
  developer: string;
  description: string;
  genres: string[];
  series: string[];
  ageRating: string;
  players: string;
  languages: string[];
  size: string;
  nsuid: string;
  productCode: string;
  physical: boolean;
  digital: boolean;
  delisted: boolean;
  images: { box: string; square: string; wide: string };
  euUrl: string;
}

export interface GamesDbTitleResponse {
  ready: boolean;
  title: GamesDbTitle | null;
  shopPath: string | null;
}

/** The shop's page for a product, by the slug its index row carries (or its id). */
export function shopPathFor(slug: unknown, id: unknown): string | null {
  const key = String(slug ?? "").trim() || String(id ?? "").trim();
  return key ? `/product/${encodeURIComponent(key)}` : null;
}

/** Only an http(s) picture is worth sending to the image proxy. */
export function imageOrEmpty(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^https?:\/\//i.test(text) ? text : "";
}
