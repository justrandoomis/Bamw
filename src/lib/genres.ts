export const GAME_GENRES: { id: string; label: string }[] = [
  { id: "action", label: "أكشن" },
  { id: "adventure", label: "مغامرات" },
  { id: "rpg", label: "آر بي جي" },
  { id: "platformer", label: "منصات" },
  { id: "puzzle", label: "ألغاز" },
  { id: "racing", label: "سباق" },
  { id: "simulation", label: "محاكاة" },
  { id: "sports", label: "رياضة" },
  { id: "strategy", label: "استراتيجية" },
  { id: "fighting", label: "قتال" },
  { id: "shooter", label: "تصويب" },
  { id: "party", label: "حفلات" },
  { id: "music", label: "موسيقى" },
  { id: "family", label: "عائلي" },
  { id: "horror", label: "رعب" },
  { id: "sandbox", label: "صندوق رمل" },
  { id: "survival", label: "بقاء" },
  { id: "stealth", label: "تسلل" },
  { id: "metroidvania", label: "ميترويدفانيا" },
  { id: "roguelike", label: "روجلايك" },
  { id: "visual_novel", label: "رواية مرئية" },
  { id: "educational", label: "تعليمي" },
  { id: "board_game", label: "لوحية" },
  { id: "arcade", label: "أركيد" },
];

export const genreLabel = (id: string) => GAME_GENRES.find((g) => g.id === id)?.label ?? id;

/*
  Every way a genre is written in this catalogue, folded into the shop's own
  genres.

  Genres arrive from three places in three styles: the curated pages ("Action
  RPG", "turn-based tactics", "soulslike", "أكشن"), the tags, and Nintendo's
  own catalogue ("Adventure", "Board Game", "First-Person Shooter", "Shop
  Shop"). The category page turned every distinct string into its own chip —
  over 200 of them, Arabic beside raw English, "football" beside "football /
  soccer" — and matched a chip by substring in both directions, so a filter
  could also catch games it had nothing to do with.

  Now a raw string maps to zero or more of the ids above. Themes and modes —
  "fantasy", "co-op", "multiplayer", "atmospheric", Nintendo's "Lifestyle",
  "Communication", "Utility", "Other" — map to none: they describe a game, they
  do not shelve it. The raw strings stay on the product page untouched.
*/
const GENRE_RULES: readonly [string, RegExp][] = [
  ["rpg", /\brpg\b|role[\s-]?playing|\bjrpg\b|\bcrpg\b|souls[\s-]?like|monster[\s-]?taming|dungeon[\s-]?crawl|آر بي جي|تقمص/i],
  ["action", /\baction\b|hack[\s-]?(?:and|&|n)[\s-]?slash|beat[\s-]?'?em[\s-]?up|\bmusou\b|brawler|أكشن/i],
  ["adventure", /adventure|exploration|narrative|story[\s-]?rich|^open[\s-]?world$|\bmystery\b|detective|مغامر/i],
  ["platformer", /platform|منصات/i],
  ["puzzle", /puzzle|ألغاز|لغز/i],
  ["racing", /racing|\bdriving\b|\bkart\b|motorsport|\bcars?\b|سباق/i],
  ["simulation", /simulat|\bsim\b|management|farming|tycoon|animal[\s-]?life|محاكاة/i],
  ["sports", /\be?sports?\b|football|soccer|tennis|golf|basketball|baseball|fitness|\bextreme\b|رياض/i],
  ["strategy", /strateg|tactic|real[\s-]?time|tower[\s-]?defen|^turn[\s-]?based$|استراتيج/i],
  ["fighting", /fight|\bversus\b|قتال/i],
  ["shooter", /shoot|\bfps\b|shmup|bullet[\s-]?hell|تصويب/i],
  ["party", /party|mini[\s-]?games?|حفلات/i],
  ["music", /music|rhythm|\bdance\b|موسيق|إيقاع/i],
  ["family", /family|\bkids\b|عائلي/i],
  ["horror", /horror|رعب/i],
  ["sandbox", /sandbox|crafting|صندوق رمل/i],
  ["survival", /survival|بقاء/i],
  ["stealth", /stealth|تسلل/i],
  ["metroidvania", /metroidvania|ميترويد/i],
  ["roguelike", /rogue[\s-]?(?:like|lite)|روجلايك/i],
  ["visual_novel", /visual[\s-]?novel|رواية مرئية|interactive[\s-]?fiction|dating[\s-]?sim/i],
  ["educational", /educat|\bstudy\b|learning|\btraining\b|\bbrain\b|تعليم/i],
  ["board_game", /board[\s-]?game|card[\s-]?game|tabletop|\bchess\b|لوحية/i],
  ["arcade", /arcade|أركيد/i],
];

/** The shop genre ids one raw genre or tag belongs to (possibly none). */
export function canonicalGenreIds(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const text = raw.trim().toLowerCase();
  if (!text || text === "undefined" || text === "null") return [];
  // Already an id ("action", "visual_novel") or an Arabic label ("أكشن").
  const direct = GAME_GENRES.find((g) => g.id === text || g.label === raw.trim());
  if (direct) return [direct.id];
  const ids: string[] = [];
  for (const [id, pattern] of GENRE_RULES) {
    if (!pattern.test(text)) continue;
    // A survival horror is shelved as horror, not as a survival game.
    if (id === "survival" && /horror|رعب/i.test(text)) continue;
    ids.push(id);
  }
  return ids;
}

/** Every shop genre id a product belongs to, from its genres, genre and tags. */
export function productGenreIds(product: unknown): Set<string> {
  const p = (product ?? {}) as Record<string, unknown>;
  const out = new Set<string>();
  const take = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const v of value) take(v);
      return;
    }
    if (typeof value !== "string" || !value.trim()) return;
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        take(JSON.parse(trimmed));
        return;
      } catch {
        /* a plain string that happens to start with a bracket */
      }
    }
    for (const part of trimmed.split(",")) for (const id of canonicalGenreIds(part)) out.add(id);
  };
  take(p["genres"]);
  take(p["genre"]);
  take((p["metadata"] as Record<string, unknown> | undefined)?.["genres"]);
  take(p["tags"]);
  return out;
}
