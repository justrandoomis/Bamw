/**
 * @vitest-environment jsdom
 */
/**
 * «قم بإطفاء الموسيقى وجعل خيار off هو الافتراضي.»
 *
 * Two halves, and only one of them is the default. These settings persist to
 * `localStorage`, so every visitor who had ever opened the shop already had
 * `musicEnabled: true` written in their browser — changing the default alone
 * would have left the music playing for exactly the people who already had it
 * playing, which is everyone who would notice.
 *
 * The version bump is what actually stops it. These tests hold both halves.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "settings-storage";

async function freshStore() {
  /*
    A new module instance per test. `persist` reads storage when the store is
    created, at import time — so a shared instance would carry the first test's
    localStorage into every test after it and the migration would appear to
    work when it had simply already run.
  */
  vi.resetModules();
  const mod = await import("@/store/useSettingsStore");
  return mod.useSettingsStore;
}

beforeEach(() => {
  localStorage.clear();
});

describe("a shop that does not start playing at you", () => {
  it("is silent for a visitor who has never been here", async () => {
    const store = await freshStore();
    expect(store.getState().musicEnabled).toBe(false);
  });

  it("keeps sound effects on — they answer something the member did", async () => {
    const store = await freshStore();
    expect(store.getState().soundEnabled).toBe(true);
  });
});

describe("the visitors who already had it playing", () => {
  it("turns the music off for a browser that stored it on", async () => {
    /*
      The whole point. A returning visitor carries `musicEnabled: true` in
      localStorage from before, and without the version bump the new default
      never reaches them.
    */
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { musicEnabled: true, soundEnabled: true }, version: 0 }),
    );
    const store = await freshStore();
    expect(store.getState().musicEnabled).toBe(false);
  });

  it("does not take away any other setting while doing it", async () => {
    /*
      A migration that reset the sound effects or the reduced-motion preference
      would be changing settings nobody asked about. Only the music is forced.
    */
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          musicEnabled: true,
          soundEnabled: false,
          liteMotion: true,
          musicTrack: "calm",
        },
        version: 0,
      }),
    );
    const store = await freshStore();
    const state = store.getState();
    expect(state.musicEnabled).toBe(false);
    expect(state.soundEnabled).toBe(false);
    expect(state.liteMotion).toBe(true);
    expect(state.musicTrack).toBe("calm");
  });

  it("leaves the choice with the member once it has run", async () => {
    /*
      Someone who turns the music back on must keep it. Their choice is stored
      under the current version, so the migration never touches it again — an
      off switch that reasserts itself every visit is a broken switch.
    */
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { musicEnabled: true, soundEnabled: true }, version: 1 }),
    );
    const store = await freshStore();
    expect(store.getState().musicEnabled).toBe(true);
  });
});
