/**
 * How famous is this game, when nobody has classified it by hand?
 *
 * «التقسيم في النسب خاطئ يظهر فقط لا بغير مشهورة سعر منخفض ولا بغير مشهورة سعر
 *  أعلى وهذا خاطئ… وسع الشهره (من حيث المبيعات عالميا في الاسواق والشهره
 *  عالميا لترتيبها).»
 *
 * The roulette's six prize buckets are price × popularity. Popularity came
 * from one admin-set table and nothing else, so every one of 1,707 eligible
 * games read `low` — and four of the six buckets sat at 0.000%, with the whole
 * catalogue crammed into «غير مشهورة». The owner is right that this is wrong:
 * it is not a classification, it is the absence of one.
 *
 * ## The ranking is not invented here
 *
 * `bestSellers.ts` already holds a worldwide-sales order the repository
 * maintains: 57 first-party titles carrying Nintendo's own published unit
 * figures in their comments — Mario Kart 8 Deluxe ~67.3M down to Astral Chain
 * ~1.5M — then 45 third-party titles beneath them. `nintendoDemandTiers.ts`
 * holds a separate per-slug commercial tier for ~151 games.
 *
 * This module only decides where the cuts fall. Both sources are consulted and
 * the more generous answer wins, because the two disagree in a useful
 * direction: the sales list knows global fame, and the demand tier knows what
 * this shop sees asked for.
 *
 * ## The admin still outranks it
 *
 * This is a FALLBACK. A tier set by hand in `roulette_game_flags` is the
 * owner's judgement about his own catalogue and always wins — the derivation
 * fills in the 1,700 games nobody will ever get round to classifying, not the
 * handful he cares enough to set.
 */
import { bestSellerRank, UNRANKED } from "./bestSellers";
import { demandTierFor } from "./nintendoDemandTiers";
import type { PopularityTier } from "./roulette-odds";

/**
 * Where «مشهورة» starts.
 *
 * The top twenty of Nintendo's own sales table is the band an ordinary person
 * can name unprompted — Mario Kart, Animal Crossing, Smash, Breath of the
 * Wild, Odyssey, Pokémon. Drawing the line lower would put household names in
 * the same bucket as a game with two million lifetime sales, which is the
 * flattening this module exists to undo.
 */
export const FAMOUS_RANK = 20;

/**
 * Where «شبه مشهورة» starts: anywhere on the list at all.
 *
 * Making the list means a published worldwide sales figure worth recording.
 * That is a real distinction from the long tail even at rank 100.
 */
export const KNOWN_RANK = 102;

/**
 * The tier a game gets when no admin has set one.
 *
 * @param title the shop's title — platform suffixes and all. `bestSellerRank`
 *   strips «[Switch 2]» and «Nintendo Switch 2 Edition» itself, so a flagship
 *   re-release is not demoted for being a re-release.
 * @param slug the product slug, for the demand tier, which is keyed by slug.
 */
export function fameTier(title: unknown, slug?: unknown): PopularityTier {
  const rank = bestSellerRank(title);
  const bySales: PopularityTier =
    rank <= FAMOUS_RANK ? "high" : rank <= KNOWN_RANK ? "medium" : "low";

  /*
    The demand tier is only consulted when the slug is actually in its table.
    Its default is `standard`, which is a guess rather than a finding, and
    treating a guess as evidence of fame would promote the entire catalogue to
    medium — the mirror image of the bug being fixed.
  */
  const key = String(slug ?? "").trim();
  if (!key) return bySales;
  const decision = demandTierFor(key);
  if (decision.defaulted) return bySales;
  const byDemand: PopularityTier =
    decision.tier === "flagship" ? "high" : decision.tier === "major" ? "medium" : "low";

  return RANK_OF[byDemand] > RANK_OF[bySales] ? byDemand : bySales;
}

const RANK_OF: Record<PopularityTier, number> = { low: 0, medium: 1, high: 2 };

/** True when the game is on the worldwide sales list at all. */
export function isRanked(title: unknown): boolean {
  return bestSellerRank(title) < UNRANKED;
}
