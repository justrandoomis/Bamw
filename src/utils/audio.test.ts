// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The site is silent for some members until they reload. Both causes live here:
 * a warm-up that declared itself done even when the context stayed suspended,
 * and a buffer started on a suspended context, which is simply never heard.
 */

class FakeAudioContext {
  state: "suspended" | "running" = "suspended";
  currentTime = 0;
  destination = {};
  resumeCalls = 0;
  /** When false, resume() settles without the context ever running. */
  static allowResume = true;

  async resume() {
    this.resumeCalls += 1;
    if (FakeAudioContext.allowResume) this.state = "running";
  }
  createGain() {
    return { gain: { value: 0, setValueAtTime: () => {} }, connect: () => {} };
  }
  createOscillator() {
    return { frequency: { value: 0 }, connect: () => {}, start: () => {} };
  }
  createBufferSource() {
    return {
      buffer: null as unknown,
      connect: () => {},
      start: (...args: unknown[]) => started.push(args),
      stop: () => {},
      onended: null,
    };
  }
  decodeAudioData() {
    return Promise.resolve({} as AudioBuffer);
  }
}

let started: unknown[][] = [];

async function loadAudioModule() {
  started = [];
  vi.resetModules();
  (window as any).AudioContext = FakeAudioContext;
  (globalThis as any).fetch = vi.fn(async () => {
    throw new Error("offline in tests");
  });
  return import("./audio");
}

describe("audio unlocking", () => {
  beforeEach(() => {
    FakeAudioContext.allowResume = true;
  });

  it("reports the context running only after resume actually succeeds", async () => {
    const mod = await loadAudioModule();
    const ctx = mod.getAudioContext() as unknown as FakeAudioContext;
    expect(ctx.state).toBe("suspended");

    await mod.resumeAudioContext();
    expect(ctx.state).toBe("running");
  });

  it("keeps trying when the browser refuses to resume", async () => {
    FakeAudioContext.allowResume = false;
    const mod = await loadAudioModule();
    const ctx = mod.getAudioContext() as unknown as FakeAudioContext;

    await mod.resumeAudioContext();
    await mod.resumeAudioContext();

    // Still suspended, and every attempt reached the browser rather than being
    // skipped because an earlier one was assumed to have worked.
    expect(ctx.state).toBe("suspended");
    expect(ctx.resumeCalls).toBe(2);
  });

  it("resolves without throwing when there is no audio context at all", async () => {
    vi.resetModules();
    delete (window as any).AudioContext;
    delete (window as any).webkitAudioContext;
    const mod = await import("./audio");
    await expect(mod.resumeAudioContext()).resolves.toBeUndefined();
  });
});
