/**
 * The pacing and the retry that the relocation apply proved were missing.
 *
 * It asked the Cloudflare API about 849 pictures — a read, a write and a
 * read-back each — as fast as six workers could issue them. That is roughly
 * two and a half thousand requests against a limit of about 1,200 per five
 * minutes per account, so partway through the run the answers turned into
 * «قراءة bananto: 429» and it stopped.
 *
 * Nothing was damaged, because the copy is additive and the script deletes
 * nothing. But a job that stops half way and reports it is not a repair, and
 * the instruction is «أصلح أي فشل فعليًا».
 *
 * What is asserted here is the distinction the failure was made of: a 429 is
 * «ask me later», never «no». A caller that reads it as an answer turns a busy
 * minute into a missing picture — which, in the script that reads these
 * results, is one keystroke away from being read as a file that is not there.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_ATTEMPTS,
  MIN_INTERVAL_MS,
  pacedFetch,
  resetPacing,
  retryAfterMs,
  shouldRetry,
} from "./lib/cloudflare-pace.mjs";

/** A clock the test moves by hand, so no real second is ever spent. */
function fakeClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    advance: (ms) => {
      t += ms;
    },
    at: () => t,
  };
}

const answering = (statuses) => {
  let call = 0;
  return vi.fn(async () => {
    const status = statuses[Math.min(call++, statuses.length - 1)];
    return { status, headers: { get: () => null } };
  });
};

beforeEach(() => resetPacing());

describe("which answers mean «ask me later»", () => {
  it("counts the one that actually happened", () => {
    expect(shouldRetry(429)).toBe(true);
  });

  it.each([500, 502, 503, 504])("counts a %i, which is Cloudflare and not us", (status) => {
    expect(shouldRetry(status)).toBe(true);
  });

  /*
    A 404 is the answer. Retrying it would turn «this object is not here» —
    the one verdict the relocation depends on — into four wasted requests and
    the same answer.
  */
  it.each([200, 206, 400, 403, 404, 410])("treats a %i as the answer", (status) => {
    expect(shouldRetry(status)).toBe(false);
  });
});

describe("how long to wait", () => {
  it("does what the API asked, when it asked", () => {
    expect(retryAfterMs("3", 0)).toBe(3000);
    expect(retryAfterMs("10", 4)).toBe(10_000);
  });

  it("backs off further each time when it did not", () => {
    expect(retryAfterMs(null, 0)).toBe(1000);
    expect(retryAfterMs(null, 1)).toBe(2000);
    expect(retryAfterMs(null, 2)).toBe(4000);
  });

  it("refuses to sit out an absurd Retry-After", () => {
    expect(retryAfterMs("86400", 0)).toBe(60_000);
  });

  it("ignores a header that is not a number", () => {
    expect(retryAfterMs("soon", 0)).toBe(1000);
    expect(retryAfterMs("-5", 0)).toBe(1000);
  });
});

describe("the request itself", () => {
  it("asks again after a 429 and returns the answer that came", async () => {
    const clock = fakeClock();
    const fetchImpl = answering([429, 429, 200]);
    const res = await pacedFetch("u", {}, { fetchImpl, ...clock });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not ask again after a 404", async () => {
    const clock = fakeClock();
    const fetchImpl = answering([404]);
    const res = await pacedFetch("u", {}, { fetchImpl, ...clock });
    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  /*
    It gives up eventually and hands back the 429 rather than looping forever.
    The caller then reports a failure — which is correct, and is why the
    relocator's failures are listed by name and nothing is deleted.
  */
  it("gives up after a bounded number of tries", async () => {
    const clock = fakeClock();
    const fetchImpl = answering([429]);
    const res = await pacedFetch("u", {}, { fetchImpl, ...clock });
    expect(res.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("retries a dropped connection instead of calling it a verdict", async () => {
    const clock = fakeClock();
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      if (call++ === 0) throw new Error("ECONNRESET");
      return { status: 200, headers: { get: () => null } };
    });
    const res = await pacedFetch("u", {}, { fetchImpl, ...clock });
    expect(res.status).toBe(200);
  });

  it("throws when the connection never comes back", async () => {
    const clock = fakeClock();
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(pacedFetch("u", {}, { fetchImpl, ...clock })).rejects.toThrow("ECONNRESET");
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });
});

describe("the pacing", () => {
  /*
    THE ONE THAT PREVENTS THE FAILURE, as opposed to surviving it. The limit is
    per ACCOUNT, so the turnstile has to be shared: six workers each pacing
    themselves would issue six times the allowed rate and be right back at 429.
  */
  it("spaces consecutive requests by the interval, however many callers there are", async () => {
    const clock = fakeClock();
    const at = [];
    const fetchImpl = vi.fn(async () => {
      at.push(clock.at());
      return { status: 200, headers: { get: () => null } };
    });
    await Promise.all(
      Array.from({ length: 5 }, () => pacedFetch("u", {}, { fetchImpl, ...clock })),
    );
    expect(at).toHaveLength(5);
    for (let i = 1; i < at.length; i += 1) {
      expect(at[i] - at[i - 1], `request ${i} came too soon after ${i - 1}`).toBeGreaterThanOrEqual(
        MIN_INTERVAL_MS,
      );
    }
  });

  it("does not wait when enough time has already passed", async () => {
    const clock = fakeClock();
    const fetchImpl = answering([200]);
    await pacedFetch("u", {}, { fetchImpl, ...clock });
    const before = clock.at();
    clock.advance(MIN_INTERVAL_MS * 4);
    await pacedFetch("u", {}, { fetchImpl, ...clock });
    expect(clock.at() - before).toBe(MIN_INTERVAL_MS * 4);
  });

  it("holds a rate the account's limit allows", () => {
    /* ~1,200 requests per 5 minutes is 4 per second. */
    expect(1000 / MIN_INTERVAL_MS).toBeLessThanOrEqual(4);
  });
});
