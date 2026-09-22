import { d1First, d1Run, getD1 } from "./d1.server";
import { env } from "./env.server";
import { clientAddress } from "./security.server";

type Bucket = { count: number; expiresAt: number };
const localBuckets = new Map<string, Bucket>();
let tablePromise: Promise<void> | undefined;

async function opaque(value: string): Promise<string> {
  const configuredSalt = env("RATE_LIMIT_SALT");
  const sessionSecret = env("SESSION_SECRET");
  const salt =
    configuredSalt && configuredSalt.length >= 24
      ? configuredSalt
      : sessionSecret && sessionSecret.length >= 16 // Recovery: Allow slightly shorter session secret in preview
        ? sessionSecret
        : undefined;

  // In production, we strictly require a secure salt.
  const isProduction = env("APP_ENV") === "production";
  if (!salt && isProduction) {
    console.warn("RATE_LIMIT_SECRET_MISSING");
  }

  const effectiveSalt = salt || "local-preview-only-salt-fallback-1234567890";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${effectiveSalt}:${value}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureTable() {
  if (!getD1()) return false;
  if (!tablePromise) {
    tablePromise = d1Run(
      `CREATE TABLE IF NOT EXISTS security_rate_limits (
        key TEXT PRIMARY KEY, count INTEGER NOT NULL,
        window_started INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
    )
      /*
        The sweep below filters on `expires_at`, and the table had an index on
        nothing but `key` — so every cold isolate opened by scanning the whole
        table to find the expired rows. A Worker makes isolates constantly, and
        this table has a row per (scope, client, identity) across every limited
        path in the shop, so that scan is paid far more often than the once-per
        -isolate it looks like.
      */
      .then(() =>
        d1Run(
          `CREATE INDEX IF NOT EXISTS idx_security_rate_limits_expires
             ON security_rate_limits (expires_at)`,
        ),
      )
      .then(() =>
        d1Run(
          `DELETE FROM security_rate_limits WHERE expires_at < ?`,
          Math.floor(Date.now() / 1000),
        ),
      )
      .catch((error) => {
        tablePromise = undefined;
        throw error;
      });
  }
  await tablePromise;
  return true;
}

export async function consumeRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
  identity = "",
): Promise<{ allowed: boolean; retryAfter: number; remaining: number }> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + windowSeconds;
  const fingerprint = await opaque(`${scope}:${clientAddress(request)}:${identity.toLowerCase()}`);
  const key = `${scope}:${fingerprint}`;

  if (await ensureTable()) {
    /*
      One statement, not two.

      This counted with an INSERT and then read the result back with a separate
      SELECT — two D1 round trips on every limited request, and the limited
      paths include sign-in, OTP, orders, chat, uploads and every image the
      proxy has to fetch. `RETURNING` gives the same two numbers from the write
      that produced them, which is also the only version that cannot read a
      count some other isolate changed in between.
    */
    const row = await d1First<{ count: number; expires_at: number }>(
      `INSERT INTO security_rate_limits (key, count, window_started, expires_at)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN security_rate_limits.expires_at <= ? THEN 1 ELSE security_rate_limits.count + 1 END,
         window_started = CASE WHEN security_rate_limits.expires_at <= ? THEN ? ELSE security_rate_limits.window_started END,
         expires_at = CASE WHEN security_rate_limits.expires_at <= ? THEN ? ELSE security_rate_limits.expires_at END
       RETURNING count, expires_at`,
      key,
      now,
      expiresAt,
      now,
      now,
      now,
      now,
      expiresAt,
    );
    /*
      A row that does not come back is treated as over the limit, exactly as
      before: a limiter that cannot read its own count must refuse, not allow.
    */
    const count = Number(row?.count ?? limit + 1);
    const retryAfter = Math.max(1, Number(row?.expires_at ?? expiresAt) - now);
    return { allowed: count <= limit, retryAfter, remaining: Math.max(0, limit - count) };
  }

  const existing = localBuckets.get(key);
  if (localBuckets.size > 10_000) {
    for (const [bucketKey, value] of localBuckets) {
      if (value.expiresAt <= now) localBuckets.delete(bucketKey);
    }
  }
  const bucket =
    !existing || existing.expiresAt <= now
      ? { count: 1, expiresAt }
      : { ...existing, count: existing.count + 1 };
  localBuckets.set(key, bucket);
  return {
    allowed: bucket.count <= limit,
    retryAfter: Math.max(1, bucket.expiresAt - now),
    remaining: Math.max(0, limit - bucket.count),
  };
}

export function rateLimitResponse(retryAfter: number): Response {
  return Response.json(
    { error: "طلبات كثيرة، حاول لاحقاً", retryAfter },
    { status: 429, headers: { "retry-after": String(retryAfter), "cache-control": "no-store" } },
  );
}
