import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface SettingsState {
  soundEnabled: boolean;
  musicEnabled: boolean;
  liteMotion: boolean;
  musicTrack: string | null;
  setSoundEnabled: (enabled: boolean) => void;
  setMusicEnabled: (enabled: boolean) => void;
  setLiteMotion: (lite: boolean) => void;
  setMusicTrack: (track: string | null) => void;
}

/**
 * Bumped to turn the background music off for everyone, once.
 *
 * Changing the default alone would not have done it. These settings persist to
 * `localStorage`, so every visitor who has ever opened the shop already has
 * `musicEnabled: true` written in their browser and would go on hearing it
 * however the default reads. «قم بإطفاء الموسيقى وجعل خيار off هو الافتراضي»
 * asks for both halves: the default, and the music actually stopping.
 *
 * The migration runs once per browser. After it, the toggle is the member's
 * again — someone who turns the music back on keeps it, because their choice
 * is then stored under this version and never migrated again.
 */
const SETTINGS_VERSION = 1;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      soundEnabled: true,
      /*
        Off by default. Sound effects are a response to something the member
        did; background music is not, and a shop that starts playing at you is
        a shop you turn off rather than a shop you browse.
      */
      musicEnabled: false,
      liteMotion: false,
      musicTrack: null,
      setSoundEnabled: (enabled: boolean) => set({ soundEnabled: enabled }),
      setMusicEnabled: (enabled: boolean) => set({ musicEnabled: enabled }),
      setLiteMotion: (lite: boolean) => set({ liteMotion: lite }),
      setMusicTrack: (track: string | null) => set({ musicTrack: track }),
    }),
    {
      name: "settings-storage",
      version: SETTINGS_VERSION,
      /*
        Only `musicEnabled` is forced. Everything else the member chose is
        carried through untouched — a migration that reset the sound effects or
        the reduced-motion preference would be taking away a setting nobody
        asked to change.
      */
      migrate: (persisted, version) => {
        const previous = (persisted ?? {}) as Partial<SettingsState>;
        if (version < SETTINGS_VERSION) return { ...previous, musicEnabled: false };
        return previous;
      },
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? localStorage : (undefined as any),
      ),
    },
  ),
);
