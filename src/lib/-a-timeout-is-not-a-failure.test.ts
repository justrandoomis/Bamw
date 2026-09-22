/**
 * A timed-out spin must not cost a second ticket.
 *
 * `request()` retries once when a POST times out, and a timeout means only
 * that the ANSWER did not arrive — the server may have done the work and lost
 * the reply. The exclusion list was written with `/api/otp` alone in it, and
 * two other endpoints have since grown the same problem:
 *
 *   - a wheel spin claims a ticket, with no key the server could recognise a
 *     second time, so a retry spends a ticket the member never watched go;
 *   - creating a banana market listing debits the seller and inserts a row
 *     with no idempotency key anywhere on the path, so a retry makes two
 *     listings and takes the bananas twice.
 *
 * Nothing here is theoretical: both are live paths a slow connection reaches.
 */
import { describe, expect, it } from "vitest";

import { __NEVER_RETRY_POST } from "@/lib/api";

describe("what must never be sent twice", () => {
  it("refuses to retry a wheel spin", () => {
    expect(__NEVER_RETRY_POST).toContain("/api/wheel");
  });

  it("refuses to retry a banana market write", () => {
    expect(__NEVER_RETRY_POST).toContain("/api/banana");
  });

  it("still refuses to retry an OTP send", () => {
    expect(__NEVER_RETRY_POST).toContain("/api/otp");
  });

  it("does not exclude order creation, which carries an idempotency key", () => {
    /*
      The list is for endpoints that cannot recognise a repeat. Checkout can —
      `idempotencyKey` is looked up before anything is written — so excluding
      it would turn a recoverable hiccup into a failed purchase for no gain.
    */
    expect(__NEVER_RETRY_POST).not.toContain("/api/orders");
  });
});

describe("the list is matched the way the code matches it", () => {
  it("catches the real URLs those endpoints are called with", () => {
    // Substring matching, so query strings and origins must still match.
    const hits = (url: string) => __NEVER_RETRY_POST.some((path) => url.includes(path));
    expect(hits("/api/wheel")).toBe(true);
    expect(hits("https://banan.to/api/wheel")).toBe(true);
    expect(hits("/api/banana?range=1D")).toBe(true);
    expect(hits("/api/otp")).toBe(true);
  });

  it("does not catch endpoints that merely look similar", () => {
    const hits = (url: string) => __NEVER_RETRY_POST.some((path) => url.includes(path));
    expect(hits("/api/orders")).toBe(false);
    expect(hits("/api/products")).toBe(false);
    expect(hits("/api/admin/store")).toBe(false);
  });
});
