/**
 * The pricing rules ALONE, for the live verification.
 *
 * Deliberately separate from `catalogue-entry.ts`: that one reaches
 * `db.server`, which needs Cloudflare credentials and TanStack Start's virtual
 * modules. The live check must not need either — it reads what banan.to is
 * actually serving over HTTPS and asks the rules whether they are satisfied by
 * it. A verification that needs the database is not checking the site.
 */
export { repriceTiers, tierProblem } from "@/lib/tierRepricing";
export { classifyTier, classifyTiers, tierOf } from "@/lib/tierPricing";
