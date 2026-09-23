/**
 * Which games the world actually bought, as a shelf order.
 *
 * The owner: «اجعل الالعاب الاكثر مبيعا عالميا تظهر افتراضيا وليس ترتيب
 * عشوائي».
 *
 * THE PROBLEM THIS SOLVES, AND THE ONE IT DOES NOT. This shop records no
 * per-product sales of its own, and a Metacritic score exists for 173 of 1,712
 * games — so there is no signal inside the catalogue that ranks a shelf by
 * popularity. The default order was therefore "newest", which for 1,530 games
 * imported in one batch is an order nobody can perceive as anything but random.
 *
 * So the ranking comes from outside: published worldwide lifetime sales.
 *
 * WHAT IS CERTAIN AND WHAT IS NOT, kept apart on purpose.
 *
 * `FIRST_PARTY` is ordered by the figures Nintendo publishes itself, in its
 * quarterly "Top Selling Title Sales Units" table. Those are real numbers and
 * the order is theirs, not mine; each line carries the figure it was ordered by
 * so a wrong one can be spotted and corrected.
 *
 * `THIRD_PARTY` is different, and saying so is the point. Nintendo does not
 * publish per-title sales for other publishers' games, and most publishers
 * report a franchise total across every platform. So these are NOT ordered by a
 * Switch sales figure — there is no such public figure to order them by. They
 * are the titles that are consistently reported as the platform's biggest
 * non-Nintendo sellers, in a hand-set order, and every one of them ranks below
 * every first-party title. That is a deliberate, stated bias rather than a
 * fabricated number: «الدقه اهم شي» — a made-up sales figure dressed as data
 * would be worse than an honest opinion labelled as one.
 *
 * NOTHING HERE IS EVER SHOWN TO A CUSTOMER. No figure is rendered, no "N
 * million sold" badge exists. The list decides one thing only: which card comes
 * before which on a shelf.
 */
import { normalize } from "@/lib/search/normalize";

/**
 * Nintendo's own, ordered by its published lifetime figure (millions of units,
 * worldwide, all-time on Switch). The number is provenance for the ORDER; it is
 * never read by the code and never displayed.
 */
const FIRST_PARTY: readonly string[] = [
  "mario kart 8 deluxe", //            ~67.3M
  "animal crossing new horizons", //   ~47.4M
  "super smash bros ultimate", //      ~35.9M
  "zelda breath of the wild", //       ~32.6M
  "super mario odyssey", //            ~29.1M
  "pokemon sword", //                  ~26.6M (Sword/Shield combined)
  "pokemon shield",
  "pokemon scarlet", //                ~26.4M (Scarlet/Violet combined)
  "pokemon violet",
  "zelda tears of the kingdom", //     ~21.8M
  "super mario party", //              ~21.0M
  "new super mario bros u deluxe", //  ~18.0M
  "pokemon lets go pikachu", //        ~16.0M (Pikachu/Eevee combined)
  "pokemon lets go eevee",
  "ring fit adventure", //             ~15.9M
  "pokemon brilliant diamond", //      ~15.8M (Diamond/Pearl combined)
  "pokemon shining pearl",
  "super mario bros wonder", //        ~15.4M
  "pokemon legends arceus", //         ~15.1M
  "luigis mansion 3", //               ~14.7M
  "mario party superstars", //         ~14.5M
  "super mario 3d world bowsers fury", // ~14.0M
  "splatoon 2", //                     ~13.6M
  "nintendo switch sports", //         ~13.4M
  "splatoon 3", //                     ~13.0M
  "super mario maker 2", //            ~11.5M
  "super mario 3d all stars", //        ~9.1M
  "kirby and the forgotten land", //    ~8.0M
  "zelda links awakening", //           ~6.3M
  "donkey kong country tropical freeze", // ~6.0M
  "clubhouse games 51 worldwide", //    ~5.5M
  "hyrule warriors age of calamity", // ~4.2M
  "zelda skyward sword hd", //          ~4.2M
  "fire emblem three houses", //        ~4.1M
  "kirby star allies", //               ~4.0M
  "pikmin 4", //                        ~3.5M
  "paper mario the origami king", //    ~3.4M
  "metroid dread", //                   ~3.3M
  "super mario rpg", //                 ~3.1M
  "yoshis crafted world", //            ~3.0M
  "mario golf super rush", //           ~2.8M
  "captain toad treasure tracker", //   ~2.4M
  "mario strikers battle league", //    ~2.2M
  "xenoblade chronicles 3", //          ~2.0M
  "fire emblem engage", //              ~1.6M
  "astral chain", //                    ~1.5M
  "mario kart world", //                Switch 2 launch title
  "donkey kong bananza", //             Switch 2
  "princess peach showtime",
  "xenoblade chronicles definitive edition",
  "xenoblade chronicles 2",
  "bayonetta 3",
  "advance wars 1 2 re boot camp",
  "detective pikachu returns",
  "warioware get it together",
  "big brain academy brain vs brain",
  "another code recollection",
];

/**
 * Not Nintendo's, and not ordered by a sales figure — see the module comment.
 * These are the non-Nintendo titles consistently reported as the platform's
 * biggest sellers, in a hand-set order, all ranking below every title above.
 */
const THIRD_PARTY: readonly string[] = [
  "minecraft",
  "monster hunter rise",
  "mario rabbids kingdom battle",
  "just dance",
  "stardew valley",
  "hollow knight",
  "terraria",
  "sonic mania",
  "sonic frontiers",
  "among us",
  "fall guys",
  "overcooked 2",
  "the witcher 3 wild hunt",
  "hogwarts legacy",
  "persona 5 royal",
  "dragon ball fighterz",
  "naruto shippuden ultimate ninja storm",
  "one piece odyssey",
  "street fighter 6",
  "mortal kombat 1",
  "tekken",
  "ea sports fc",
  "fifa",
  "nba 2k",
  "balatro",
  "doom eternal",
  "crash bandicoot n sane trilogy",
  "spyro reignited trilogy",
  "resident evil",
  "final fantasy",
  "dragon quest",
  "octopath traveler",
  "bravely default ii",
  "triangle strategy",
  "little nightmares",
  "cuphead",
  "celeste",
  "dead cells",
  "hades",
  "ori and the blind forest",
  "rocket league",
  "rayman legends",
  "unravel two",
  "lego",
  "spongebob squarepants",
];

/**
 * The comparable form of a title, with the shop's own platform suffixes gone.
 *
 * Titles in this catalogue carry them in several shapes at once — "SpongeBob
 * SquarePants: Titans of the Tide switch 1", "EA SPORTS FC 27 switch 2",
 * "Xenoblade Chronicles 3 – Nintendo Switch 2 Edition". None of them is part of
 * the game's name, and leaving them in would stop every one of those matching.
 *
 * `normalize` is the search engine's own function, so a title folds here
 * exactly as it folds when a customer types it.
 *
 * ## THE APOSTROPHE IS REMOVED FIRST, AND SIX OF THE BIGGEST GAMES DEPENDED ON IT
 *
 * `normalize` turns everything that is not a letter or a digit into a SPACE.
 * That is right for a search box — «Mario+Rabbids» and «Mario Rabbids» are the
 * same query — and it is wrong inside a word: «Luigi's Mansion 3» folded to
 * «luigi s mansion 3», which does not contain the list's «luigis mansion 3».
 *
 * So the key never matched, and the fourth best-selling exclusive in this shop
 * was ranked UNRANKED. Six keys were dead this way, every one of them in the
 * head of the list: Let's Go Pikachu (~16.0M), Let's Go Eevee, Luigi's Mansion
 * 3 (~14.7M), Bowser's Fury (~14.0M), Link's Awakening (~6.3M) and Yoshi's
 * Crafted World (~3.0M).
 *
 * That is not a cosmetic miss. This function decides the home shelf's order,
 * the roulette's odds and — since the fame ladder — the PRICE. The owner
 * reported the symptom before anyone found the cause: «هنالك ألعاب قوية وسعرها
 * غالي وفي نفس الوقت مشهورة جدا لكن سعرها خمسة آلاف». Luigi's Mansion 3 at
 * 5,000 is exactly that sentence.
 *
 * Removed rather than replaced with a space, because an apostrophe inside an
 * English word is not a word boundary. `normalize` itself is left alone: it
 * backs the persisted search index, and changing it would need a reindex.
 */
/** Every apostrophe a title is typed with — straight, curly, modifier, accent. */
const APOSTROPHES = /['\u2018\u2019\u02BC\u00B4`\uFF07]/g;

export function comparableTitle(title: unknown): string {
  return normalize(String(title ?? "").replace(APOSTROPHES, ""))
    .replace(/\bnintendo switch 2 edition\b/g, " ")
    .replace(/\bnintendo switch edition\b/g, " ")
    .replace(/\bswitch 2 edition\b/g, " ")
    .replace(/\bswitch edition\b/g, " ")
    .replace(/\bnintendo switch 2\b/g, " ")
    .replace(/\bnintendo switch\b/g, " ")
    .replace(/\bswitch 2\b/g, " ")
    .replace(/\bswitch 1\b/g, " ")
    .replace(/\bswitch\b/g, " ")
    .replace(/\bthe legend of zelda\b/g, "zelda")
    .replace(/\s+/g, " ")
    .trim();
}

/*
  Longest key first, so "mario kart 8 deluxe" is tested before "mario kart
  world" can match on a shared prefix and before any shorter franchise key.
  Built once at module load: a shelf of 1,714 games asks this question 1,714
  times per render and a sort must not rebuild its table inside the comparator.
*/
const RANKED: readonly { key: string; rank: number }[] = [...FIRST_PARTY, ...THIRD_PARTY]
  .map((key, index) => ({ key, rank: index + 1 }))
  .sort((a, b) => b.key.length - a.key.length);

/** Below every ranked title, so an unranked game sorts after all of them. */
export const UNRANKED = Number.MAX_SAFE_INTEGER;

/**
 * Where this title sits among the world's best sellers — 1 is the biggest.
 *
 * `UNRANKED` when the title is not on either list, which is most of the
 * catalogue and is not a defect: the list is a head, not a census, and
 * everything it does not name falls through to the shelf's own tiebreak.
 */
export function bestSellerRank(title: unknown): number {
  const text = comparableTitle(title);
  if (!text) return UNRANKED;
  for (const entry of RANKED) {
    if (text === entry.key || text.includes(entry.key)) return entry.rank;
  }
  return UNRANKED;
}

/** True when the title is one the list names at all. */
export function isBestSeller(title: unknown): boolean {
  return bestSellerRank(title) !== UNRANKED;
}

/** How many titles the list names — for a report that must state its own size. */
export const BEST_SELLER_COUNT = FIRST_PARTY.length + THIRD_PARTY.length;
