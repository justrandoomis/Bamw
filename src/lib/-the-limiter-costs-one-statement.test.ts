import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

/**
 * The rate limiter, against real SQL.
 *
 * It guards sign-in, OTP, orders, chat, uploads and every image the proxy has
 * to fetch, and it did two D1 round trips per request — an INSERT that counted
 * and a SELECT that read the count back. `RETURNING` gets both numbers from the
 * write that produced them.
 *
 * That is a change to a security control, so it is checked against a real
 * SQLite rather than by reading the source: the counting, the window rollover
 * and the refusal all have to behave identically, and «الدقه اهم شي».
 */

const SCHEMA = `CREATE TABLE security_rate_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL,
  window_started INTEGER NOT NULL, expires_at INTEGER NOT NULL)`;

/** The statement `consumeRateLimit` now runs, verbatim. */
const CONSUME = `INSERT INTO security_rate_limits (key, count, window_started, expires_at)
   VALUES (?, 1, ?, ?)
   ON CONFLICT(key) DO UPDATE SET
     count = CASE WHEN security_rate_limits.expires_at <= ? THEN 1 ELSE security_rate_limits.count + 1 END,
     window_started = CASE WHEN security_rate_limits.expires_at <= ? THEN ? ELSE security_rate_limits.window_started END,
     expires_at = CASE WHEN security_rate_limits.expires_at <= ? THEN ? ELSE security_rate_limits.expires_at END
   RETURNING count, expires_at`;

function open() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_security_rate_limits_expires
       ON security_rate_limits (expires_at)`,
  );
  return db;
}

/** One call, returning what the limiter would compute from the row. */
function consume(db: DatabaseSync, key: string, now: number, windowSeconds: number, limit: number) {
  const expiresAt = now + windowSeconds;
  const row = db
    .prepare(CONSUME)
    .get(key, now, expiresAt, now, now, now, now, expiresAt) as
    | { count: number; expires_at: number }
    | undefined;
  const count = Number(row?.count ?? limit + 1);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.max(1, Number(row?.expires_at ?? expiresAt) - now),
    count,
  };
}

describe("the counting still counts", () => {
  it("returns the count from the write that produced it", () => {
    const db = open();
    expect(consume(db, "auth:x", 1000, 60, 3).count).toBe(1);
    expect(consume(db, "auth:x", 1001, 60, 3).count).toBe(2);
    expect(consume(db, "auth:x", 1002, 60, 3).count).toBe(3);
    db.close();
  });

  it("allows up to the limit and refuses past it", () => {
    const db = open();
    for (let i = 0; i < 3; i++) {
      expect(consume(db, "otp:x", 1000 + i, 60, 3).allowed, `call ${i + 1}`).toBe(true);
    }
    const over = consume(db, "otp:x", 1004, 60, 3);
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
    db.close();
  });

  it("keeps each key on its own count", () => {
    const db = open();
    consume(db, "order:a", 1000, 60, 2);
    consume(db, "order:a", 1001, 60, 2);
    // A different client must not inherit the first one's exhaustion.
    expect(consume(db, "order:b", 1002, 60, 2).allowed).toBe(true);
    expect(consume(db, "order:a", 1003, 60, 2).allowed).toBe(false);
    db.close();
  });
});

describe("the window still rolls over", () => {
  it("starts a new window once the old one has expired", () => {
    const db = open();
    for (let i = 0; i < 3; i++) consume(db, "chat:x", 1000, 60, 3);
    expect(consume(db, "chat:x", 1000, 60, 3).allowed).toBe(false);

    // Past `expires_at`, the CASE arms reset the count rather than incrementing.
    const fresh = consume(db, "chat:x", 1000 + 61, 60, 3);
    expect(fresh.count).toBe(1);
    expect(fresh.allowed).toBe(true);
    db.close();
  });

  it("reports how long is left, not how long a window is", () => {
    const db = open();
    consume(db, "upload:x", 1000, 60, 5);
    // 30 seconds in, half the window remains.
    expect(consume(db, "upload:x", 1030, 60, 5).retryAfter).toBe(30);
    db.close();
  });
});

describe("the sweep can use an index now", () => {
  it("plans the expiry cleanup against the index rather than scanning", () => {
    /*
      The table was created with a primary key on `key` alone, so
      `DELETE ... WHERE expires_at < ?` — which every cold isolate runs — had to
      read every row. A Worker makes isolates constantly.
    */
    const db = open();
    for (let i = 0; i < 200; i++) consume(db, `k${i}`, 1000, 60, 100);
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN DELETE FROM security_rate_limits WHERE expires_at < ?`)
      .all(2000) as { detail: string }[];
    const detail = plan.map((row) => row.detail).join(" ");
    expect(detail).toContain("idx_security_rate_limits_expires");
    expect(detail).not.toContain("SCAN security_rate_limits\n");
    db.close();
  });

  it("still deletes exactly the expired rows", () => {
    const db = open();
    consume(db, "old", 1000, 60, 100); // expires 1060
    consume(db, "new", 1000, 600, 100); // expires 1600
    db.prepare(`DELETE FROM security_rate_limits WHERE expires_at < ?`).run(1100);
    const left = db.prepare(`SELECT key FROM security_rate_limits`).all() as { key: string }[];
    expect(left.map((r) => r.key)).toEqual(["new"]);
    db.close();
  });
});
