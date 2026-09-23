/**
 * Which games the roulette may give away, and which bucket each one is in.
 *
 * Two facts about a game are the roulette's and nobody else's: how famous it
 * is, and whether the owner wants it in the prize pool at all. Both are the
 * admin's to set — «لا تجعل Client يحددها» — and both are kept HERE rather
 * than on the product.
 *
 * ## Why a table of its own, and not a field on the product
 *
 * Three reasons, in the order they matter.
 *
 * 1. The catalogue is the shop's commercial record. The owner's standing rule
 *    is that price, cost, stock, hidden state, options, types, trade-in values,
 *    display order and sales figures do not move for anything I build. A
 *    per-product write to set a popularity tier means a write to that record,
 *    through `updateStore`, over a document whose granular overlay rows shadow
 *    the chunks. The safest way to not disturb a thing is to not write to it.
 *
 * 2. `RUNTIME_SCHEMA_VERSION`. `wheel.server.ts` records why the wheel's own
 *    tables are created lazily instead of in the bootstrap: bumping that
 *    number makes every isolate re-run the whole bootstrap, and doing it once
 *    took the storefront down at version 24. The owner named this trap
 *    directly — «لا تكرر مشكلة RUNTIME_SCHEMA_VERSION القديمة». So this table
 *    is created on first use, like the wheel's, and costs one round trip to an
 *    isolate that touches the roulette and nothing at all to one that does not.
 *
 * 3. Exclusion needs somewhere to live anyway. «استبعاد لعبة من Prize Pool
 *    بدون حذفها من المتجر» is a roulette fact, not a catalogue fact, and it
 *    would be a strange column on a product.
 *
 * ## The safe default
 *
 * A game nobody has classified is `low` — «غير مشهورة». The owner asked for a
 * safe default and this is the one that is safe in the direction that matters:
 * the famous buckets are the expensive ones to be wrong about, and defaulting
 * a thousand unclassified games INTO them would put the shop's best titles on
 * the cheapest odds it has. Defaulting them out costs nothing but a tier the
 * admin can raise.
 *
 * Nothing here ever deletes a game or breaks the pool for want of a tier:
 * «يجب ألا يؤدي عدم وجود popularity إلى حذف اللعبة أو كسر Prize Pool».
 */

import { fameTier } from "./roulette-fame";
import { d1All, d1Run, getD1 } from "./d1.server";
import {
  DEFAULT_PRICE_BOUNDARY,
  PRIZE_BUCKETS,
  bucketOf,
  type BucketPopulation,
  type PopularityTier,
  type PrizeBucketKey,
} from "./roulette-odds";

/** The tier a game carries when nobody has said otherwise. */
export const DEFAULT_POPULARITY: PopularityTier = "low";

const TIERS: readonly PopularityTier[] = ["low", "medium", "high"];

/** Whatever is stored, as a tier the engine can use. */
export function asPopularity(raw: unknown): PopularityTier {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return (TIERS as readonly string[]).includes(value)
    ? (value as PopularityTier)
    : DEFAULT_POPULARITY;
}

let schemaReady: Promise<void> | undefined;

/**
 * The roulette's own two facts per game, created on first use.
 *
 * See the header for why this is not in the bootstrap's `SCHEMA`.
 */
export function ensureRoulettePoolSchema(): Promise<void> {
  if (!getD1()) return Promise.resolve();
  if (!schemaReady) {
    schemaReady = (async () => {
      /*
        `pool_excluded`, not `excluded`.

        `EXCLUDED` is SQLite's own pseudo-table inside an upsert — the one that
        holds the row that could not be inserted. A column of that name turns
        every `ON CONFLICT DO UPDATE` here into a sentence with two meanings,
        and the reading that compiles is not necessarily the one intended. The
        name is free; the ambiguity is not.
      */
      await d1Run(`
        CREATE TABLE IF NOT EXISTS roulette_game_flags (
          product_id    TEXT PRIMARY KEY,
          popularity    TEXT NOT NULL DEFAULT 'low',
          pool_excluded INTEGER NOT NULL DEFAULT 0,
          updated_at    TEXT NOT NULL,
          updated_by    TEXT
        )
      `);
      /*
        The admin's screen lists by tier and the pool builder reads every row,
        so the only index worth its write cost is the one that answers "which
        games did somebody deliberately take out".
      */
      await d1Run(
        `CREATE INDEX IF NOT EXISTS roulette_game_flags_excluded_idx
           ON roulette_game_flags (pool_excluded) WHERE pool_excluded = 1`,
      );
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

export interface GameFlags {
  popularity: PopularityTier;
  excluded: boolean;
}

/**
 * Every flag the admin has set, by product id.
 *
 * One read for the whole table rather than one per game: the pool is rebuilt
 * from the catalogue on each spin and a per-product lookup would be a thousand
 * round trips inside a request that has to answer in milliseconds.
 */
export async function readGameFlags(): Promise<Map<string, GameFlags>> {
  const out = new Map<string, GameFlags>();
  if (!getD1()) return out;
  await ensureRoulettePoolSchema();
  const rows = await d1All<{ product_id: string; popularity: string; pool_excluded: number }>(
    `SELECT product_id, popularity, pool_excluded FROM roulette_game_flags`,
  ).catch(() => []);
  for (const row of rows ?? []) {
    const id = String(row?.product_id ?? "");
    if (!id) continue;
    out.set(id, {
      popularity: asPopularity(row?.popularity),
      excluded: Number(row?.pool_excluded) === 1,
    });
  }
  return out;
}

/**
 * Set one game's tier and pool membership.
 *
 * `updated_by` is the admin who did it. A tier is a commercial decision — it
 * moves which prizes a member can win — so it leaves a name behind.
 */
export async function setGameFlags(input: {
  productId: string;
  popularity?: PopularityTier;
  excluded?: boolean;
  updatedBy?: string;
  now?: string;
}): Promise<void> {
  const productId = String(input.productId ?? "").trim();
  if (!productId || !getD1()) return;
  await ensureRoulettePoolSchema();
  const now = input.now ?? new Date().toISOString();
  const by = String(input.updatedBy ?? "") || null;

  /*
    One statement per field the caller actually named, over a row that is made
    to exist first.

    A single upsert cannot express "leave the other field alone": the VALUES
    clause has to supply something for every column, and whatever it supplies
    is what `EXCLUDED` then offers the update. So a screen editing only the
    tier would quietly un-exclude the game, and one editing only the exclusion
    would reset the tier to `low` — each of them a commercial decision undone
    by a form that never mentioned it.
  */
  await d1Run(
    `INSERT OR IGNORE INTO roulette_game_flags
       (product_id, popularity, pool_excluded, updated_at, updated_by)
     VALUES (?, 'low', 0, ?, ?)`,
    productId,
    now,
    by,
  );
  if (input.popularity !== undefined) {
    await d1Run(
      `UPDATE roulette_game_flags SET popularity = ?, updated_at = ?, updated_by = ?
        WHERE product_id = ?`,
      asPopularity(input.popularity),
      now,
      by,
      productId,
    );
  }
  if (input.excluded !== undefined) {
    await d1Run(
      `UPDATE roulette_game_flags SET pool_excluded = ?, updated_at = ?, updated_by = ?
        WHERE product_id = ?`,
      input.excluded ? 1 : 0,
      now,
      by,
      productId,
    );
  }
}

/** A game the roulette can actually hand over. */
export interface PoolGame {
  id: string;
  title: string;
  price: number;
  popularity: PopularityTier;
  bucket: PrizeBucketKey;
  /** The square card, or null — never another game's picture. */
  squareImage: string | null;
}

/**
 * What a product has to be before it can be a prize.
 *
 * Deliberately strict, and every clause is a way the shop could otherwise give
 * away something it did not mean to:
 *
 *  - hidden products are hidden for a reason, and a hidden game appearing as a
 *    prize is the shop publishing it by accident;
 *  - a bare listing is a name and a price with no account behind it yet, so it
 *    cannot be delivered;
 *  - hardware, accessories and gift cards are not games, and the owner's
 *    roulette gives away games;
 *  - a product with no price cannot be bucketed, and a prize with no value is
 *    a prize the shop cannot account for;
 *  - anything the admin took out stays out.
 */
export function isPrizeEligible(
  product: Record<string, unknown>,
  flags?: GameFlags,
): { ok: true } | { ok: false; reason: string } {
  if (flags?.excluded) return { ok: false, reason: "excluded" };

  const hidden =
    product["hidden"] === true ||
    product["isHidden"] === true ||
    String(product["status"] ?? "").toLowerCase() === "hidden";
  if (hidden) return { ok: false, reason: "hidden" };

  const kind = String(product["kind"] ?? "").toLowerCase();
  const schema = String(product["schemaId"] ?? product["schema_id"] ?? "").toLowerCase();
  if (
    ["hardware", "device", "accessory", "amiibo", "collectible", "gift_card", "used"].includes(kind)
  ) {
    return { ok: false, reason: "not_a_game" };
  }
  if (["hardware", "gift_card"].includes(schema)) return { ok: false, reason: "not_a_game" };

  if (product["isBareListing"] === true || product["bareListing"] === true) {
    return { ok: false, reason: "bare_listing" };
  }

  return { ok: true };
}

/**
 * The square card for a prize, or null.
 *
 * «إذا لم توجد صورة مربعة للعبة: لا تستخدم صورة خاطئة، لا تستبدلها بصورة لعبة
 * أخرى، اعرض fallback نظيف يحتوي اسم اللعبة فقط.»
 *
 * So this reads the square role and NOTHING else. No hero, no box art, no
 * "closest available" — a wrong picture on a prize is the shop telling a member
 * they won a different game, and the roulette is exactly where that lie is most
 * expensive. A null here is the card's instruction to print the name.
 */
export function squareImageOf(product: Record<string, unknown>): string | null {
  for (const key of ["nintendoCardImage", "squareImage", "cardImage"]) {
    const value = product[key];
    const url = typeof value === "string" ? value.trim() : "";
    if (url) return url;
  }
  const media = product["nintendoMedia"];
  if (media && typeof media === "object") {
    const value = (media as Record<string, unknown>)["nintendoCardImage"];
    const url = typeof value === "string" ? value.trim() : "";
    if (url) return url;
  }
  return null;
}

/** The price a prize is worth, read from the shop's own record. */
export function prizePriceOf(product: Record<string, unknown>): number {
  for (const key of ["accountPrice", "price"]) {
    const raw = product[key];
    const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

/**
 * The prize pool, bucketed, from the catalogue and the admin's flags.
 *
 * Pure over its inputs so a test can hand it a catalogue rather than needing a
 * database — the reason every claim about bucketing in the tests is a claim
 * about this function and not about a copy of it.
 */
export function buildPool(
  products: readonly Record<string, unknown>[],
  flags: Map<string, GameFlags>,
  priceBoundary: number = DEFAULT_PRICE_BOUNDARY,
): { games: PoolGame[]; skipped: Record<string, number> } {
  const games: PoolGame[] = [];
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  for (const product of products ?? []) {
    const id = String(product?.["id"] ?? "");
    if (!id) {
      skip("no_id");
      continue;
    }
    const flag = flags.get(id);
    const eligible = isPrizeEligible(product, flag);
    if (!eligible.ok) {
      skip(eligible.reason);
      continue;
    }
    const price = prizePriceOf(product);
    if (!(price > 0)) {
      skip("no_price");
      continue;
    }
    /*
      The admin's own tier wins when there is one. Otherwise the game's fame is
      DERIVED rather than assumed: the fallback used to be a flat `low`, so all
      1,707 eligible games landed in «غير مشهورة» and four of the six buckets
      showed 0.000% — not a classification, but the absence of one shown as
      though it were a finding.
    */
    const popularity =
      flag?.popularity ?? fameTier(product["titleEn"] ?? product["title"], product["slug"]);
    games.push({
      id,
      title: String(product["titleEn"] ?? product["title"] ?? id),
      price,
      popularity,
      bucket: bucketOf(popularity, price, priceBoundary),
      squareImage: squareImageOf(product),
    });
  }

  return { games, skipped };
}

/** How many eligible games each bucket holds. */
export function populationOf(games: readonly PoolGame[]): BucketPopulation {
  const counts = Object.fromEntries(PRIZE_BUCKETS.map((key) => [key, 0])) as Record<
    PrizeBucketKey,
    number
  >;
  for (const game of games) counts[game.bucket] += 1;
  return counts;
}

/**
 * One game out of a bucket, chosen uniformly.
 *
 * «داخل Bucket يمكن الاختيار Uniform افتراضياً» — and uniform is what it is,
 * deliberately: any other rule inside the bucket would be a second, hidden
 * weighting, and the whole point of choosing the bucket first was to have
 * exactly one place where a probability is decided.
 */
export function pickFromBucket(
  games: readonly PoolGame[],
  bucket: PrizeBucketKey,
  draw: () => number,
): PoolGame | null {
  const inBucket = games.filter((game) => game.bucket === bucket);
  if (!inBucket.length) return null;
  const unit = Number(draw());
  const safe = Number.isFinite(unit) ? Math.min(Math.max(unit, 0), 0.999999999) : 0;
  return inBucket[Math.floor(safe * inBucket.length)] ?? inBucket[0];
}
