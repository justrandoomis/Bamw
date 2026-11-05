/**
 * @vitest-environment node
 */
/**
 * A request that joins work another request started must never wait forever.
 *
 * In production a cancelled visitor took their pending D1 reads with them, the
 * shared schema/catalogue promise never settled, and every later request on
 * the isolate hung at 2 ms of CPU until its own visitor left (Workers Logs,
 * 2026-11-05: `outcome: canceled`, `wallTimeMs: 45005`). These cases pin the
 * rule that replaced the unbounded `return sharedPromise`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { joinShared, trackShared } from "./shared-wait.server";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("joinShared", () => {
  it("answers with the shared work when it settles in time", async () => {
    let finish!: (value: string) => void;
    const shared = new Promise<string>((resolve) => (finish = resolve));
    const restart = vi.fn(async () => "own");

    const joined = joinShared(shared, { label: "t", waitMs: 5_000, restart });
    finish("shared");
    await expect(joined).resolves.toBe("shared");
    expect(restart).not.toHaveBeenCalled();
  });

  it("starts the work itself when the shared promise is abandoned", async () => {
    // A promise that never settles: the request that owned its I/O is gone.
    const abandoned = new Promise<string>(() => undefined);
    const restart = vi.fn(async () => "own");

    const joined = joinShared(abandoned, { label: "t", waitMs: 5_000, restart });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(joined).resolves.toBe("own");
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("passes on a failure of the shared work rather than restarting", async () => {
    const failed = Promise.reject(new Error("d1 down"));
    failed.catch(() => undefined);
    const restart = vi.fn(async () => "own");

    await expect(joinShared(failed, { label: "t", waitMs: 5_000, restart })).rejects.toThrow(
      "d1 down",
    );
    expect(restart).not.toHaveBeenCalled();
  });

  it("does not restart after the shared work already answered", async () => {
    const shared = trackShared(Promise.resolve("done"));
    await shared;
    await Promise.resolve();
    const restart = vi.fn(async () => "own");

    await expect(joinShared(shared, { label: "t", waitMs: 5_000, restart })).resolves.toBe("done");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(restart).not.toHaveBeenCalled();
  });

  it("reports a restart that throws instead of hanging", async () => {
    const abandoned = new Promise<string>(() => undefined);
    const joined = joinShared(abandoned, {
      label: "t",
      waitMs: 1_000,
      restart: () => {
        throw new Error("no binding");
      },
    });
    const assertion = expect(joined).rejects.toThrow("no binding");
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });
});
