/**
 * One fetch for the Cloudflare API, paced and retried.
 *
 * ## THE RUN THAT PRODUCED THIS
 *
 * The relocation apply asked the API about 849 pictures — a read, a write and a
 * read-back each, some two and a half thousand requests — as fast as six
 * workers could issue them. Cloudflare allows about 1,200 requests per five
 * minutes per account, so partway through it began answering 429 and the run
 * ended with «قراءة bananto: 429» against file after file.
 *
 * Nothing was damaged: the copy is additive, the files that made it are there,
 * and the script deletes nothing. But «أصلح أي فشل فعليًا» — a job that stops
 * half way and reports it is not a repair.
 *
 * ## WHAT THIS DOES
 *
 * Two things, and they are different:
 *
 *   - PACING. Every request in the process waits its turn at a shared minimum
 *     interval. This is what stops the 429 happening, and it has to be global
 *     rather than per-worker, because the limit is per ACCOUNT and six workers
 *     each pacing themselves is six times the allowed rate.
 *   - RETRY. When one arrives anyway — another job on the same account, a
 *     burst that slipped through — the request is tried again after a wait,
 *     honouring `Retry-After` when the API sends it. A 429 is «ask me later»,
 *     never «no», and a caller that reads it as a failure turns a busy minute
 *     into a missing picture.
 *
 * A 5xx is retried for the same reason. A 4xx that is not 429 is the answer.
 */

/** Cloudflare allows ~1,200 requests per 5 minutes per account: 4 per second. */
export const MIN_INTERVAL_MS = 260;

/** How many times a 429 or a 5xx is re-asked before it is called a failure. */
export const MAX_ATTEMPTS = 5;

/*
  The shared turnstile. A promise chain rather than a timer, so the order
  requests were issued in is the order they go out, and nothing has to poll.
*/
let nextSlot = Promise.resolve();
let lastAt = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Forget when the last request went out.
 *
 * Only for tests: the turnstile is process-wide by design, and a test that
 * moved a fake clock backwards would otherwise make the next one wait for
 * real.
 */
export function resetPacing() {
  nextSlot = Promise.resolve();
  lastAt = 0;
}

/**
 * Wait until this process is allowed to make another request.
 *
 * `sleep` is injectable so the pacing can be tested without spending the real
 * seconds it exists to spend.
 */
function takeSlot(now, sleep) {
  const mine = nextSlot.then(async () => {
    const since = now() - lastAt;
    if (since < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - since);
    lastAt = now();
  });
  /* The chain must not break on a rejection, or every later call inherits it. */
  nextSlot = mine.catch(() => {});
  return mine;
}

/** Seconds the API asked us to wait, or null when it did not say. */
export function retryAfterMs(header, attempt) {
  const seconds = Number(String(header ?? "").trim());
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 60_000);
  /* No header: back off 1s, 2s, 4s, 8s. */
  return Math.min(1000 * 2 ** attempt, 16_000);
}

/** True when the answer means «ask me again», rather than «here is the answer». */
export function shouldRetry(status) {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Fetch, paced against the account limit and retried on 429 and 5xx.
 *
 * `fetchImpl` and `now` are injectable so the pacing and the backoff can be
 * tested without waiting real seconds or touching a network.
 */
export async function pacedFetch(url, init = {}, options = {}) {
  const { fetchImpl = fetch, now = Date.now, attempts = MAX_ATTEMPTS, sleep = wait } = options;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await takeSlot(now, sleep);
    let res;
    try {
      res = await fetchImpl(url, init);
    } catch (error) {
      lastError = error;
      /* A transport failure is retried too: a reset connection is not a verdict. */
      if (attempt + 1 >= attempts) throw error;
      await sleep(retryAfterMs(null, attempt));
      continue;
    }
    if (!shouldRetry(res.status) || attempt + 1 >= attempts) return res;
    await sleep(retryAfterMs(res.headers?.get?.("retry-after"), attempt));
  }
  throw lastError ?? new Error("unreachable");
}
