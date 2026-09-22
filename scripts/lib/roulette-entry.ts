/**
 * Entry point bundled for the roulette's read-only probes.
 *
 * Kept apart from `catalogue-entry.ts` for the reason that file records: a
 * change to one report's exports must not be able to break another's build,
 * which is the mistake that took `production-proof` down when exports were
 * added to a shared entry.
 *
 * Exports only what a MEASUREMENT needs. Nothing here can spin, charge or
 * award — the probe reads the catalogue and the flags table and prints
 * numbers, and it should not be able to do anything else even by accident.
 */
export { getStore } from "@/lib/db.server";
export { d1All } from "@/lib/d1.server";
export { buildPool, populationOf, readGameFlags } from "@/lib/roulette-pool.server";
export {
  DEFAULT_PRICE_BOUNDARY,
  MAX_TICKETS_PER_SPIN,
  oddsForTickets,
  oddsRows,
  resolveOdds,
} from "@/lib/roulette-odds";
