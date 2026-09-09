/**
 * Entry point bundled for the Banana Market check.
 *
 * Separate from `import-entry.ts` on purpose. `getMarketConfig` reaches
 * `db.server`, which pulls in TanStack Start's server core and its three
 * virtual modules (`#tanstack-router-entry` and friends) — specifiers only the
 * app's own build can resolve. Adding these exports to the shared entry made
 * every script that bundles it fail to build, `production-proof` included, so
 * the cost is kept here where one script pays it.
 *
 * The checker stubs those three specifiers. That is safe precisely because
 * nothing on this path runs a request handler: the price is computed from the
 * store document and the config, and the server core is only ever reached by
 * the import graph, never by a call.
 *
 * Everything here is the application's own code. The price a customer sees is
 * not a stored number — `spotPriceAt` walks drift and volatility from a base,
 * and the zero that was reported came from a fallback inside `getMarketConfig`
 * rather than from any row. A check that read `basePrice` out of D1 would have
 * measured the wrong thing.
 */
export { d1All } from "@/lib/d1.server";
export { getMarketConfig, spotPriceAt, changePercent24h } from "@/lib/banana-market-config.server";
