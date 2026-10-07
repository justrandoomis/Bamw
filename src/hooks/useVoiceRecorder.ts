import { useCallback, useEffect, useRef, useState } from "react";

import { canRecordVoice, pickVoiceMime } from "@/lib/voiceNotes";

export type VoiceRecorderState = "idle" | "requesting" | "recording" | "paused";

export interface VoiceNote {
  blob: Blob;
  /** The type the recorder actually produced, e.g. `audio/webm;codecs=opus`. */
  mime: string;
  durationMs: number;
}

/**
 * A real voice recorder.
 *
 * The chat's microphone used to run a timer and send the words «🎤 رسالة
 * صوتية (0:07)» as a text message — nothing was ever recorded, which is why a
 * voice note «did not work» from either side. This asks for the microphone,
 * records with MediaRecorder, and hands back the audio and how long it runs.
 *
 * `start` rejects with the browser's error when the microphone cannot be
 * opened (`NotAllowedError`, `NotFoundError`, …) or `{ name: "unsupported" }`
 * when the browser cannot record; `stop` resolves with the note, `cancel`
 * throws it away. The microphone is released whenever recording ends, and on
 * unmount.
 */
export function useVoiceRecorder({ maxMs = 5 * 60 * 1000 }: { maxMs?: number } = {}) {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const accumulatedRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const resolveRef = useRef<((note: VoiceNote | null) => void) | null>(null);

  const elapsedNow = () =>
    accumulatedRef.current +
    (recorderRef.current?.state === "recording" ? performance.now() - startedAtRef.current : 0);

  const release = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = undefined;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    accumulatedRef.current = elapsedNow();
    recorder.pause();
    setElapsedMs(accumulatedRef.current);
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    startedAtRef.current = performance.now();
    recorder.resume();
    setState("recording");
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    if (!canRecordVoice()) throw Object.assign(new Error("unsupported"), { name: "unsupported" });
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mime = pickVoiceMime();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mime || "audio/webm";
        const note: VoiceNote = {
          blob: new Blob(chunksRef.current, { type }),
          mime: type,
          durationMs: Math.round(accumulatedRef.current),
        };
        chunksRef.current = [];
        resolveRef.current?.(note);
        resolveRef.current = null;
      };
      recorderRef.current = recorder;
      accumulatedRef.current = 0;
      startedAtRef.current = performance.now();
      setElapsedMs(0);
      /* Small slices, so a stop never waits on one long buffer. */
      recorder.start(250);
      setState("recording");
      tickRef.current = setInterval(() => {
        const now = elapsedNow();
        setElapsedMs(now);
        /* At the limit it pauses rather than sends: what to do with it stays the member's call. */
        if (now >= maxMs) pause();
      }, 200);
    } catch (error) {
      release();
      setState("idle");
      throw error;
    }
  }, [maxMs, pause, release]);

  const stop = useCallback((): Promise<VoiceNote | null> => {
    const recorder = recorderRef.current;
    if (!recorder) return Promise.resolve(null);
    accumulatedRef.current = elapsedNow();
    return new Promise<VoiceNote | null>((resolve) => {
      resolveRef.current = (note) => {
        release();
        resolve(note);
      };
      if (recorder.state !== "inactive") recorder.stop();
      else resolveRef.current(null);
      setState("idle");
      setElapsedMs(0);
    });
  }, [release]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    resolveRef.current = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    chunksRef.current = [];
    release();
    setState("idle");
    setElapsedMs(0);
  }, [release]);

  /* Leaving the page never leaves the microphone on. */
  useEffect(() => cancel, [cancel]);

  return { state, elapsedMs, start, pause, resume, stop, cancel, supported: canRecordVoice() };
}
