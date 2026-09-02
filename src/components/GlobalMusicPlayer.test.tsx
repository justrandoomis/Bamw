/**
 * @vitest-environment jsdom
 */
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GlobalMusicPlayer from "./GlobalMusicPlayer";
import { useSettingsStore } from "../store/useSettingsStore";

/**
 * Autoplay is refused until the member interacts, so the recovery path is the
 * only thing that ever gets the music going on a first visit. It used to hinge
 * on having observed the rejection and then reached for the wrong audio
 * element, which is why music sometimes only started after a reload.
 */

vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

const created: FakeAudio[] = [];

class FakeAudio {
  src = "";
  volume = 0;
  currentTime = 0;
  preload = "";
  paused = true;
  playCalls = 0;
  /** Set false to emulate a browser that blocks autoplay. */
  static allowPlay = false;
  listeners = new Map<string, ((e: unknown) => void)[]>();

  constructor() {
    created.push(this);
  }
  play() {
    this.playCalls += 1;
    if (!FakeAudio.allowPlay) return Promise.reject(new Error("NotAllowedError"));
    this.paused = false;
    (this.listeners.get("playing") ?? []).forEach((fn) => fn({}));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener() {}
}

describe("GlobalMusicPlayer autoplay recovery", () => {
  beforeEach(() => {
    created.length = 0;
    FakeAudio.allowPlay = false;
    (globalThis as any).Audio = FakeAudio;
    useSettingsStore.setState({ musicEnabled: true, musicTrack: undefined } as any);
  });

  afterEach(() => {
    cleanup();
  });

  it("starts the music on a user gesture after the browser refused autoplay", async () => {
    render(<GlobalMusicPlayer />);
    await new Promise((r) => setTimeout(r, 0));

    const attempted = created.filter((audio) => audio.playCalls > 0);
    expect(attempted.length).toBeGreaterThan(0);
    const blocked = attempted[0]!;
    expect(blocked.paused).toBe(true);
    expect(blocked.src).not.toBe("");

    // The member taps: the very element that holds the track must be resumed,
    // not whichever slot happened to be marked active.
    FakeAudio.allowPlay = true;
    const callsBefore = blocked.playCalls;
    window.dispatchEvent(new Event("pointerdown"));
    await new Promise((r) => setTimeout(r, 0));

    expect(blocked.playCalls).toBeGreaterThan(callsBefore);
    expect(blocked.paused).toBe(false);
  });

  it("leaves a deliberate pause alone once music has really played", async () => {
    FakeAudio.allowPlay = true;
    render(<GlobalMusicPlayer />);
    await new Promise((r) => setTimeout(r, 0));

    const playing = created.find((audio) => audio.playCalls > 0)!;
    expect(playing.paused).toBe(false);

    playing.pause();
    const callsBefore = playing.playCalls;
    window.dispatchEvent(new Event("pointerdown"));
    await new Promise((r) => setTimeout(r, 0));

    expect(playing.playCalls).toBe(callsBefore);
    expect(playing.paused).toBe(true);
  });
});
