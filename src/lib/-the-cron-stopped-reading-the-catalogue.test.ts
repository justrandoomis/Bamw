import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The every-minute cron, and the five numbers it was reading 3.8 MB to find.
 *
 * Measured from Cloudflare's own record over six hours of production:
 *
 * | outcome · route | count |
 * | --- | --- |
 * | `exceededCpu · cron * * * * *` | **119** |
 * | `canceled · /api/data` | 13 |
 * | `exceededCpu · /api/data` | 8 |
 * | `exceededCpu · /api/admin/catalogue-import` | 4 |
 *
 * The minute cron finished 15 times and was killed 119 times. An isolate killed
 * for exceeding CPU takes the requests sharing it down with it — which is why
 * `/api/data` and the catalogue import were being answered 503 by a shop whose
 * own code was fine, and why the owner's import kept stopping mid-run.
 *
 * Two causes, one test file each half:
 *
 *  1. `processBotTrading()` calls `getMarketConfig()`, which called
 *     `getStore()` — 3.8 MB of catalogue chunks, parsed, with
 *     `normalizeProductRecord` run over all 876 products — to read five numbers
 *     out of `settings.bananaMarket`.
 *  2. `scheduled()` ignored its event, so both registered crons ran all six
 *     tasks. The half-hourly schedule did nothing.
 *
 * These are source-level assertions on purpose. The fault is not what these
 * functions return — they returned the right answer all along — it is which
 * read path they take to get there, and that is only visible in the source.
 */

const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");

/** Comments describe the fault; only the code can still commit it. */
const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

describe("reading the settings must not read the catalogue", () => {
  it("the banana market config asks for the settings, not the store", () => {
    const source = code(read("src/lib/banana-market-config.server.ts"));
    expect(source).toContain("getStoreSettings");
    // `getStore` is the 3.8 MB read. `updateStore` is a write and stays.
    expect(source).not.toMatch(/\bawait getStore\(\)/);
  });

  it("the exchange rate asks for the settings, not the store", () => {
    const source = code(read("src/lib/exchange-rate.server.ts"));
    expect(source).toContain("getStoreSettings");
    expect(source).not.toMatch(/\bawait getStore\(\)/);
  });

  it("the page copy asks for the metadata, not the store", () => {
    // /policy and /account_guides name no product and were measured at 590 ms
    // and 514 ms of CPU apiece.
    for (const file of ["src/lib/content.functions.ts", "src/routes/api/content.ts"]) {
      const source = code(read(file));
      expect(source, file).toContain("getStoreMeta");
      expect(source, file).not.toMatch(/\bawait getStore\(\)/);
    }
  });

  it("`getStoreSettings` is served by the read that skips the products", () => {
    const db = read("src/lib/db.server.ts");
    const at = db.indexOf("export async function getStoreSettings");
    expect(at).toBeGreaterThan(-1);
    const body = db.slice(at, at + 400);
    expect(body).toContain("getStoreMeta()");
    // And `getStoreMeta` is the one that passes `skipProducts`.
    expect(db).toContain("loadStore({ skipProducts: true })");
  });

  it("a write still invalidates the snapshot the settings are read from", () => {
    // Otherwise an admin changing the banana base price would watch the old one
    // be served for a minute, which is worse than the cost this saved.
    const db = read("src/lib/db.server.ts");
    const at = db.indexOf("export function invalidateStoreCache");
    const body = db.slice(at, at + 400);
    expect(body).toContain("storeMetaCache = undefined");
  });

  it("and `updateStore` does too, which it was not doing", () => {
    /*
      `updateStore` repoints `storeCache` by hand instead of going through
      `invalidateStoreCache()`, so the metadata snapshot kept whatever it last
      read. Harmless while nothing read settings through that path; the moment
      `getMarketConfig()` did, an admin who saved a base price of 0.31 read back
      0.24 for the next minute. `-the-market-panel-reaches-the-market.test.ts`
      caught it.
    */
    const db = code(read("src/lib/db.server.ts"));
    const at = db.indexOf("export async function updateStore");
    expect(at).toBeGreaterThan(-1);
    const body = db.slice(at, db.indexOf("export ", at + 40));
    expect(body).toContain("storeCache = { doc: next");
    expect(body).toContain("invalidateStoreMetaCache()");
  });
});

describe("the two schedules do different work", () => {
  const server = read("src/server.ts");

  it("the handler reads which cron fired", () => {
    // It took `_event` and ignored it, so the half-hourly trigger was decoration.
    expect(code(server)).toMatch(/async scheduled\(\s*event/);
    expect(code(server)).toContain('event?.cron');
  });

  it("the minute firing runs only what a minute means something to", () => {
    const body = code(server).slice(code(server).indexOf("async scheduled("));
    const minuteArm = body.slice(body.indexOf(": ["));
    expect(minuteArm).toContain("processAutoScheduledTasks");
    expect(minuteArm).toContain("processDigitalDeliveryMaintenance");
    // The bots stay on the minute: their cadence is a commercial decision, and
    // now that the config is cheap their own cost is two small queries.
    expect(minuteArm).toContain("processBotTrading");
    // The whole-catalogue one is not here. This is the assertion that matters.
    expect(minuteArm).not.toContain("processReleaseAlerts");
  });

  it("the half-hourly firing carries the work whose deadline is a day", () => {
    const body = code(server).slice(code(server).indexOf("async scheduled("));
    const halfArm = body.slice(body.indexOf("? ["), body.indexOf(": ["));
    expect(halfArm).toContain("processReleaseAlerts");
    expect(halfArm).toContain("processHeldReferralRewards");
    expect(halfArm).toContain("processExpiredBotThreads");
  });

  it("still runs every task on one of the two schedules", () => {
    // A split that silently drops a job is worse than one that runs it too often.
    for (const task of [
      "processAutoScheduledTasks",
      "processDigitalDeliveryMaintenance",
      "processBotTrading",
      "processReleaseAlerts",
      "processHeldReferralRewards",
      "processExpiredBotThreads",
    ]) {
      expect(code(server), task).toContain(`${task}()`);
    }
  });

  it("an unrecognised schedule runs the minute work rather than nothing", () => {
    // A cron added later and forgotten here should be too eager, not silent.
    expect(code(server)).toContain('cron.startsWith("*/30")');
  });
});
