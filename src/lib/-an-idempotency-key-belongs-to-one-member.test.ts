/**
 * An idempotency key is not a claim on somebody else's order.
 *
 * The key arrives from the browser. The cart sends `crypto.randomUUID()`, but
 * a request can carry any string at all, and it was the whole of the lookup:
 * the in-memory cache was keyed on it alone, and the database read was
 *
 *     SELECT doc FROM orders WHERE idempotency_key = ? LIMIT 1
 *
 * with no owner in it. So sending `1` as the key meant: give me whatever order
 * the first person ever to send `1` created. Their document came back as the
 * answer — their items, their name, their phone, their delivery address — and
 * because a hit returns before any of the payment path runs, **no money moved
 * and nothing was reserved.** A free order and another member's details in one
 * request.
 *
 * Two things close it, and the second exists only because of the first:
 *
 *   1. The lookup and the cache are scoped to the member.
 *   2. `orders_idempotency_idx` is UNIQUE on the key alone across every
 *      member, so once the key stops handing over the other order, a request
 *      carrying a taken one would run the whole checkout — spending the
 *      coupon, debiting the wallet — and only then fail to insert. A taken key
 *      is dropped instead.
 *
 * This reads the source: the fault is in which columns a statement names, and
 * a database exercised through the happy path would let both back in.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const orders = readFileSync(path.resolve(__dirname, "orders.server.ts"), "utf8");
const schema = readFileSync(path.resolve(__dirname, "d1.server.ts"), "utf8");

describe("the lookup asks whose order it is", () => {
  it("no longer reads an order by key alone", () => {
    expect(orders).not.toContain("SELECT doc FROM orders WHERE idempotency_key = ? LIMIT 1");
  });

  it("requires the order to belong to the member asking", () => {
    expect(orders).toContain(
      "SELECT doc FROM orders WHERE idempotency_key = ? AND user_id = ? LIMIT 1",
    );
    const read = orders.slice(
      orders.indexOf("SELECT doc FROM orders WHERE idempotency_key = ? AND user_id = ?"),
    );
    // Both bindings, in the order the statement names them.
    expect(read.slice(0, 200)).toContain("cleanIdempotencyKey,");
    expect(read.slice(0, 200)).toContain("user.id,");
  });
});

describe("the in-memory cache is scoped the same way", () => {
  it("builds its key from the member and the request key together", () => {
    expect(orders).toContain("function scopedIdempotencyKey(userId: string, key?: string)");
    // A backslash-u escape in the SOURCE, matched literally — not the NUL
    // character TypeScript would produce from an unescaped one here.
    expect(orders).toContain("return `${userId}\\u0000${key}`;");
  });

  /*
    A NUL separator, not a colon or a dash: a user id containing the separator
    could otherwise be arranged to collide with a different id and key pair.
  */
  it("separates the two halves with something an id cannot contain", () => {
    const fn = orders.slice(orders.indexOf("function scopedIdempotencyKey"));
    expect(fn.slice(0, 200)).not.toContain("`${userId}:${key}`");
    expect(fn.slice(0, 200)).not.toContain("`${userId}-${key}`");
  });

  it("never caches or reads under the bare key", () => {
    expect(orders).not.toContain("getCachedOrder(cleanIdempotencyKey)");
    expect(orders).not.toContain("setCachedOrder(cleanIdempotencyKey,");
    expect(orders).not.toContain("setCachedOrder(idempotencyKey,");
    expect(orders).toContain("setCachedOrder(cacheKey, order);");
  });
});

describe("a key another member already owns is dropped, not charged for", () => {
  /*
    The index is what makes this necessary. If it were scoped to the member
    this whole branch could go — so the test names the index, and will fail
    loudly if somebody narrows it and leaves the workaround behind.
  */
  it("the unique index really is across every member", () => {
    expect(schema).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_idx ON orders (idempotency_key) WHERE idempotency_key IS NOT NULL",
    );
    expect(schema).not.toContain("orders_idempotency_idx ON orders (user_id, idempotency_key)");
  });

  it("asks who owns the key before using it", () => {
    expect(orders).toContain("SELECT user_id FROM orders WHERE idempotency_key = ? LIMIT 1");
  });

  it("drops it rather than failing the insert after the money has moved", () => {
    const branch = orders.slice(
      orders.indexOf("SELECT user_id FROM orders WHERE idempotency_key = ? LIMIT 1"),
    );
    expect(branch.slice(0, 500)).toContain(
      'if (owner && String(owner.user_id) !== String(user.id)) {',
    );
    expect(branch.slice(0, 500)).toContain("cleanIdempotencyKey = undefined;");
    expect(branch.slice(0, 500)).toContain('console.warn("[order:idempotency_key_taken]"');
  });

  it("logs the fact without logging the key itself", () => {
    const at = orders.indexOf('console.warn("[order:idempotency_key_taken]"');
    const call = orders.slice(at, orders.indexOf("\n", at));
    expect(call).not.toContain("cleanIdempotencyKey");
    expect(call).not.toContain("idempotencyKey)");
  });

  it("checks ownership only after the member's own order was not found", () => {
    expect(orders.indexOf("SELECT doc FROM orders WHERE idempotency_key = ? AND user_id = ?")).
      toBeLessThan(orders.indexOf("SELECT user_id FROM orders WHERE idempotency_key = ? LIMIT 1"));
  });
});
