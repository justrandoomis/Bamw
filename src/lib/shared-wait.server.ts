/**
 * Waiting on work that another request started — without being able to hang.
 *
 * A Worker ties I/O to the request that issued it. Many modules here keep a
 * module-level promise so the requests on one isolate share a single schema
 * check or catalogue load: the first request starts it, every later request
 * awaits the same promise. When that first visitor leaves, their request is
 * cancelled, its pending D1 reads are dropped with it, and the shared promise
 * can stay pending for the rest of the isolate's life. Every request that
 * awaited it then sat at a couple of milliseconds of CPU until its own visitor
 * gave up.
 *
 * Measured on 2026-11-05 in Workers Logs: `/api/data` with `outcome: canceled`,
 * `wallTimeMs: 45005`, `cpuTimeMs: 2`; 583 cancelled requests in a day, while
 * D1 itself answered in under a millisecond. `/api/health` reported D1 "OK" and
 * the products read "TIMEOUT" at the same moment, because its D1 ping does not
 * go through the shared schema promise and the products read does. That was
 * the storefront with no banner and no games, in Brave, Chrome and everything
 * else.
 *
 * The rule now: a request that JOINS shared work races it against a timer the
 * request creates itself. If the work has not settled by then, it is treated
 * as abandoned: the caller's `restart` drops it (only if it is still the same
 * promise) and starts the work again on this request, whose I/O is its own.
 * A request that STARTS the work awaits it directly — it is waiting on its own
 * reads, which cannot be taken away from it by somebody else leaving.
 */

/** Promises known to have fulfilled; joining one of these costs no timer. */
const fulfilled = new WeakSet<Promise<unknown>>();

/** Remember when a shared promise has fulfilled, so later joins return at once. */
export function trackShared<T>(promise: Promise<T>): Promise<T> {
  promise.then(
    () => {
      fulfilled.add(promise);
    },
    () => undefined,
  );
  return promise;
}

export type SharedWaitOptions<T> = {
  /** Short name for the log line when a wait runs out. */
  label: string;
  /** How long a joiner waits before it treats the work as abandoned. */
  waitMs: number;
  /** Drop the abandoned promise (if still current) and start the work again here. */
  restart: () => Promise<T>;
};

/**
 * Await `shared`, which some other request may have started, for at most
 * `waitMs`; past that, run `restart()` on this request and await that instead.
 */
export function joinShared<T>(shared: Promise<T>, options: SharedWaitOptions<T>): Promise<T> {
  if (fulfilled.has(shared)) return shared;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      console.warn("[shared-wait:abandoned]", { label: options.label, waitedMs: options.waitMs });
      let next: Promise<T>;
      try {
        next = options.restart();
      } catch (error) {
        reject(error);
        return;
      }
      next.then(resolve, reject);
    }, options.waitMs);
    shared.then(
      (value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/*
  The bounds. A schema check is one or two round trips of well under a
  millisecond each, so five seconds without an answer is not a slow check, it
  is nobody coming back. The catalogue load is the heaviest read in the shop
  (fourteen chunks, ~160 ms in D1 plus parsing); eight seconds is several times
  its worst honest cold start, and still inside the storefront's own patience.
*/
export const SCHEMA_WAIT_MS = 5_000;
export const STORE_WAIT_MS = 8_000;
