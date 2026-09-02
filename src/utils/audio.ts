import { useSettingsStore } from "../store/useSettingsStore";
import { UI_SOUND_MAP } from "../config/publicAssets";

/* ---------------------------------------------------------------------------
 * High-Performance Zero-Latency UI Web Audio Engine
 *
 * Designed for immediate (<5ms) UI sound response:
 * 1. Singleton AudioContext created once and kept active.
 * 2. Two-tier asynchronous preloading (Critical Batch -> Secondary Batch).
 * 3. In-memory AudioBuffer caching (`audioBufferCache = Map<string, AudioBuffer>`).
 * 4. Inactive hardware wake-up (inaudible 0-gain keeper) to eliminate DAC spin-up lag.
 * 5. Instant synchronous playback from RAM via `AudioBufferSourceNode`.
 * 6. Non-blocking fallback: Missing buffers never stall or freeze UI interactions.
 * 7. Hover and pointer deduplication to prevent audio stacking.
 * ------------------------------------------------------------------------- */

export type SoundName =
  | "bumper_end"
  | "confirm"
  | "action"
  | "home"
  | "hover"
  | "hover_s"
  | "klick"
  | "click"
  | "select"
  | "button"
  | "switch_click"
  | "loading"
  | "load"
  | "nock"
  | "back"
  | "close"
  | "hide_modal"
  | "turn_off"
  | "toggle_off"
  | "turn_on"
  | "toggle_on"
  | "complete_task"
  | "user"
  | "profile"
  | "settings"
  | "Settings"
  | "news"
  | "News"
  | "album"
  | "Album"
  | "message_toast"
  | "08. Message Toast"
  | "toast"
  | "message"
  | "receive_message"
  | "typing"
  | "21. Typing"
  | "type"
  | "error"
  | "Error"
  | "fail"
  | "alert"
  | "send_message"
  | (string & {});

const soundMap: Record<string, string> = UI_SOUND_MAP;

// Priority classification
export const CRITICAL_SOUNDS = [
  "hover",
  "hover_s",
  "klick",
  "click",
  "turn_on",
  "turn_off",
  "nock",
  "home",
  "user",
  "settings",
  "news",
  "album",
  "message_toast",
  "typing",
  "error",
  "bumper_end",
  "loading",
] as const;

export const SECONDARY_SOUNDS = [
  "hide_modal",
  "switch_click",
  "complete_task",
  "receive_message",
  "send_message",
] as const;

// Singletons & Memory Caches
let audioContext: AudioContext | null = null;
const audioBufferCache = new Map<string, AudioBuffer>();
const rawArrayBufferCache = new Map<string, ArrayBuffer>();
const fetchPromises = new Map<string, Promise<ArrayBuffer | null>>();
const decodePromises = new Map<string, Promise<AudioBuffer | null>>();

const activeSources = new Map<string, AudioBufferSourceNode>();
const lastPlayed = new Map<string, number>();
const lastStarted = new Map<string, number>();
let globalLastPlayTime = 0;

const HOVER_COOLDOWN_MS = 35;
const GENERAL_DEDUPE_MS = 35;

/**
 * Singleton AudioContext getter with interactive latency hint.
 */
export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioContext) return audioContext;

  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor({ latencyHint: "interactive" });
    return audioContext;
  } catch {
    return null;
  }
}

// Backward compatibility export
export const getCtx = getAudioContext;

/**
 * Resume AudioContext if suspended (Safari/iOS policy).
 */
export function resumeAudioContext(): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "suspended") return Promise.resolve();
  return ctx.resume().catch(() => {});
}

/**
 * Inaudible zero-gain keeper node.
 * Prevents OS audio DSP / DAC hardware from entering power-save idle sleep,
 * eliminating the 100-300ms hardware wake-up spike on subsequent clicks.
 */
let isHardwareWarmed = false;
export function warmAudioHardware(): void {
  const ctx = getAudioContext();
  if (!ctx || isHardwareWarmed) return;
  if (ctx.state === "suspended") return;

  isHardwareWarmed = true;
  try {
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    silentGain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.frequency.value = 20; // 20Hz sub-audible
    osc.connect(silentGain);
    osc.start(0);
  } catch {
    // Non-critical optimization
  }
}

/**
 * Start offsets to skip leading silence in audio files.
 */
export const startOffsets: Record<string, number> = {
  bumper_end: 0.055,
  home: 0.05,
  hover: 0,
  hover_s: 0,
  klick: 0,
  loading: 0.18,
  nock: 0,
  hide_modal: 0,
  turn_on: 0,
  turn_off: 0,
  user: 0.015,
  settings: 0,
  Settings: 0,
  news: 0,
  News: 0,
  album: 0,
  Album: 0,
  message_toast: 0,
  "08. Message Toast": 0,
  typing: 0,
  "21. Typing": 0,
  error: 0,
  Error: 0,
};

/**
 * Computes first sample time with audible amplitude.
 */
export function findFirstAudibleTime(buf: AudioBuffer): number {
  const THRESHOLD = 0.005; // ≈ -46 dBFS
  const data = buf.getChannelData(0);
  const limit = Math.min(data.length, Math.floor(buf.sampleRate * 0.5));
  for (let i = 0; i < limit; i += 1) {
    if (Math.abs(data[i]!) > THRESHOLD) {
      return Math.max(0, (i - 2) / buf.sampleRate);
    }
  }
  return 0;
}

/**
 * Fetch raw ArrayBuffer with deduplicating Promise cache.
 */
async function fetchRawAudio(soundName: string): Promise<ArrayBuffer | null> {
  if (rawArrayBufferCache.has(soundName)) {
    return rawArrayBufferCache.get(soundName)!;
  }

  if (fetchPromises.has(soundName)) {
    return fetchPromises.get(soundName)!;
  }

  const url = soundMap[soundName];
  if (!url) return null;

  const promise = (async () => {
    try {
      const response = await fetch(url, {
        cache: "force-cache",
        mode: "cors",
      });
      if (!response.ok) return null;
      const arrayBuf = await response.arrayBuffer();
      rawArrayBufferCache.set(soundName, arrayBuf);
      return arrayBuf;
    } catch {
      return null;
    } finally {
      fetchPromises.delete(soundName);
    }
  })();

  fetchPromises.set(soundName, promise);
  return promise;
}

/**
 * Decode ArrayBuffer into AudioBuffer and store in RAM memory cache.
 */
async function decodeAudioBuffer(soundName: string): Promise<AudioBuffer | null> {
  if (audioBufferCache.has(soundName)) {
    return audioBufferCache.get(soundName)!;
  }

  if (decodePromises.has(soundName)) {
    return decodePromises.get(soundName)!;
  }

  const ctx = getAudioContext();
  if (!ctx) return null;

  const promise = (async () => {
    try {
      let arrayBuf = rawArrayBufferCache.get(soundName);
      if (!arrayBuf) {
        arrayBuf = (await fetchRawAudio(soundName)) || undefined;
      }
      if (!arrayBuf) return null;

      // Duplicate buffer for decoding as decodeAudioData can detach the underlying ArrayBuffer
      const bufToDecode = arrayBuf.slice(0);

      const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
        try {
          const res = ctx.decodeAudioData(bufToDecode, resolve, reject);
          if (res && typeof res.catch === "function") {
            res.catch(reject);
          }
        } catch (err) {
          reject(err);
        }
      });

      audioBufferCache.set(soundName, decoded);

      if (startOffsets[soundName] === undefined) {
        startOffsets[soundName] = findFirstAudibleTime(decoded);
      }

      return decoded;
    } catch {
      return null;
    } finally {
      decodePromises.delete(soundName);
    }
  })();

  decodePromises.set(soundName, promise);
  return promise;
}

/**
 * Preload a single sound (fetch + decode).
 */
export async function preloadSound(soundName: string): Promise<AudioBuffer | null> {
  if (typeof window === "undefined") return null;
  if (audioBufferCache.has(soundName)) return audioBufferCache.get(soundName)!;

  // 1. Fetch raw bytes
  await fetchRawAudio(soundName);

  // 2. Decode if AudioContext is ready or can be instantiated
  const ctx = getAudioContext();
  if (ctx && ctx.state !== "closed") {
    return decodeAudioBuffer(soundName);
  }
  return null;
}

/**
 * Two-stage asynchronous preloading engine.
 * Stage 1: Critical UI sounds (hover, klick, turn_on, etc.)
 * Stage 2: Secondary UI sounds (home, user, bumper_end, loading)
 */
let isCriticalPreloadTriggered = false;
let isPreloadAllTriggered = false;
/**
 * @param onlyCritical when true, only stage 1 (critical UI sounds) is fetched.
 */
export async function preloadAllSounds(onlyCritical = false): Promise<void> {
  if (typeof window === "undefined") return;
  if (onlyCritical ? isCriticalPreloadTriggered : isPreloadAllTriggered) return;
  isCriticalPreloadTriggered = true;
  if (!onlyCritical) isPreloadAllTriggered = true;

  try {
    // Stage 1: Critical UI sounds in parallel
    await Promise.all(
      CRITICAL_SOUNDS.map((name) => (soundMap[name] ? fetchRawAudio(name) : Promise.resolve(null))),
    );

    // If context is already unblocked, decode Stage 1 immediately
    const ctx = getAudioContext();
    if (ctx && ctx.state === "running") {
      void Promise.all(CRITICAL_SOUNDS.map((name) => decodeAudioBuffer(name)));
    }

    if (onlyCritical) return;

    // Stage 2: Secondary UI sounds immediately after
    await Promise.all(
      SECONDARY_SOUNDS.map((name) =>
        soundMap[name] ? fetchRawAudio(name) : Promise.resolve(null),
      ),
    );

    if (ctx && ctx.state === "running") {
      void Promise.all(SECONDARY_SOUNDS.map((name) => decodeAudioBuffer(name)));
    }
  } catch {
    // Background preload failure is non-fatal
  }
}

/**
 * Perform first user gesture warm-up:
 * 1. Resumes AudioContext
 * 2. Decodes all pending UI sounds into RAM
 * 3. Keeps hardware active with sub-audible keeper
 */
let isWarmupComplete = false;
function performUserGestureWarmup(): void {
  if (isWarmupComplete || typeof window === "undefined") return;

  // Decoding is idempotent and worth doing on the first gesture either way.
  const allSoundNames = Object.keys(soundMap);
  for (const name of allSoundNames) {
    if (!audioBufferCache.has(name)) {
      void decodeAudioBuffer(name);
    }
  }

  // `resume()` is asynchronous and can be refused — a tab restored from
  // bfcache or opened in the background comes back suspended. Only treat the
  // warm-up as done once the context is genuinely running, so the gesture
  // listeners stay armed for another try instead of leaving the site silent
  // until the member reloads.
  void resumeAudioContext().then(() => {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== "running") return;
    isWarmupComplete = true;
    warmAudioHardware();
    detachFirstGestureListeners();
  });
}

let detachFirstGestureListeners: () => void = () => {};

// Bootstrap lifecycle: Kick off background fetch immediately upon script evaluation
if (typeof window !== "undefined") {
  // Start preloading immediately (never blocking page render)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void preloadAllSounds(), { once: true });
  } else {
    void preloadAllSounds();
  }

  // Warm up on first user gesture across all modern input types
  const gestureEvents = ["pointerdown", "touchstart", "keydown", "click", "mousedown"];
  const handleFirstGesture = () => {
    performUserGestureWarmup();
  };

  detachFirstGestureListeners = () => {
    for (const evt of gestureEvents) {
      window.removeEventListener(evt, handleFirstGesture, { capture: true });
    }
  };

  for (const evt of gestureEvents) {
    window.addEventListener(evt, handleFirstGesture, { passive: true, capture: true });
  }

  // Global delegation for data-ui-sound elements
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target as Element | null;
      const el = target?.closest?.("[data-ui-sound]") as HTMLElement | null;
      if (!el) return;
      const name = el.dataset["uiSound"];
      if (!name) return;

      const volume = Number(el.dataset["uiVolume"] ?? "0.8");
      const channel = el.dataset["uiChannel"];
      playSound(name as SoundName, Number.isFinite(volume) ? volume : 0.8, false, channel);
    },
    { capture: true, passive: true },
  );

  // Global delegation for data-ui-sound-hover elements
  document.addEventListener(
    "pointerenter",
    (event) => {
      const target = event.target as Element | null;
      const el = target?.closest?.("[data-ui-sound-hover]") as HTMLElement | null;
      if (!el) return;
      const name = el.dataset["uiSoundHover"] || "hover_s";
      const volume = Number(el.dataset["uiVolume"] ?? "0.5");
      playSound(name, Number.isFinite(volume) ? volume : 0.5, false);
    },
    { capture: true, passive: true },
  );

  // Global delegation for typing in inputs and textareas
  document.addEventListener(
    "keydown",
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const isTextInput =
        target.tagName === "TEXTAREA" ||
        (target.tagName === "INPUT" &&
          ["text", "search", "password", "email", "tel", "url", "number"].includes(
            (target as HTMLInputElement).type || "text",
          ));
      if (
        isTextInput &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key &&
        event.key.length === 1
      ) {
        playSound("typing", 0.35);
      }
    },
    { capture: true, passive: true },
  );
}

/**
 * Synchronous playback of cached AudioBuffer directly from RAM.
 * Absolute zero network or decode delay.
 */
function playCachedBuffer(
  soundName: string,
  buffer: AudioBuffer,
  volume: number,
  channel?: string,
): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  // A node started on a suspended context is simply lost — which is why the
  // first click after arriving on the page used to make no sound. Resume
  // first, then play, and drop the sound only if the context never comes back.
  if (ctx.state === "suspended") {
    void resumeAudioContext().then(() => {
      if (ctx.state === "running") playCachedBuffer(soundName, buffer, volume, channel);
    });
    return;
  }
  warmAudioHardware();

  // Channel management for mutually exclusive UI sounds
  if (channel && activeSources.has(channel)) {
    try {
      activeSources.get(channel)?.stop();
    } catch {
      // Ignore if already stopped
    }
    activeSources.delete(channel);
  }

  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    const clampedVolume = Math.max(0, Math.min(1, volume));
    gainNode.gain.setValueAtTime(clampedVolume, ctx.currentTime);

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    const offset = startOffsets[soundName] ?? 0;
    source.start(0, offset);

    if (channel) {
      activeSources.set(channel, source);
      source.onended = () => {
        if (activeSources.get(channel) === source) {
          activeSources.delete(channel);
        }
      };
    }
  } catch {
    // Decorative UI sound — never throw
  }
}

/**
 * Main UI sound trigger function.
 *
 * Guarantees:
 * - Immediate RAM playback when cached.
 * - Non-blocking: if not ready, queues background load and exits immediately (never awaits network).
 * - Rate limiting / deduplication on rapid hover & clicks.
 */
export function playSound(
  soundName: SoundName,
  volume: number = 0.8,
  forcePlay: boolean = false,
  channel?: string,
): void {
  if (typeof window === "undefined") return;

  // Check user settings
  const { soundEnabled } = useSettingsStore.getState();
  if (!soundEnabled && !forcePlay) return;

  const now = performance.now();

  // Deduplication / Cooldown
  // Global cooldown: prevent any two sounds from playing within 40ms of each other
  // to avoid double-playing on identical events
  if (now - globalLastPlayTime < 40) {
    return;
  }

  const isHover = soundName === "hover" || soundName === "hover_s";
  const cooldown = isHover ? HOVER_COOLDOWN_MS : GENERAL_DEDUPE_MS;
  const lastSoundTime = lastPlayed.get(soundName);

  if (lastSoundTime !== undefined && now - lastSoundTime < cooldown) {
    return;
  }
  lastPlayed.set(soundName, now);
  globalLastPlayTime = now;

  // Check if buffer is ready in RAM
  const cachedBuffer = audioBufferCache.get(soundName);
  if (cachedBuffer) {
    lastStarted.set(soundName, now);
    playCachedBuffer(soundName, cachedBuffer, volume, channel);
    return;
  }

  // Not yet in RAM -> trigger background load without blocking
  void preloadSound(soundName).then((buf) => {
    // If the sound was requested but wasn't ready, it will now be in RAM for the very next time.
    if (buf && !isHover && performance.now() - now < 30) {
      // If loaded extremely fast (e.g. was already in decode queue <30ms), play it once
      playCachedBuffer(soundName, buf, volume, channel);
    }
  });
}

// Named alias
export const playUiSound = playSound;
