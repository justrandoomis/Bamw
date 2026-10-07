/**
 * Voice notes in the browser: which format to record, what to call the file,
 * how to show its length. Shared by the member's chat and the admin inbox so
 * both record, upload and label a voice note the same way.
 */

/*
  In order of preference. Chrome, Edge and Android record WebM/Opus; Safari
  (iOS 14.3 and later) records MP4/AAC and nothing else; Firefox records
  Ogg/Opus. The first one the browser says it supports wins, and if it says
  none, the recorder is left to choose — whatever it hands back still names its
  own type.
*/
const CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/aac",
];

export function canRecordVoice(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export function pickVoiceMime(): string | undefined {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined")
    return undefined;
  const isSupported = window.MediaRecorder.isTypeSupported?.bind(window.MediaRecorder);
  if (!isSupported) return undefined;
  return CANDIDATES.find((mime) => isSupported(mime));
}

/** The extension `/api/upload` files a recording of this type under. */
export function voiceExtension(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (base === "audio/mp4" || base === "audio/x-m4a") return "m4a";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/aac") return "aac";
  if (base === "audio/mpeg") return "mp3";
  return "weba";
}

/** A recording as a file the upload route accepts: a bare audio type, a matching name. */
export function voiceFile(blob: Blob, mime: string): File {
  const base = (mime || blob.type || "audio/webm").split(";")[0]!.trim().toLowerCase();
  const type = base.startsWith("audio/") ? base : "audio/webm";
  return new File([blob], `voice-${Date.now()}.${voiceExtension(type)}`, { type });
}

/** 0:07, 1:42, 12:05 — always Western digits, always m:ss. */
export function formatVoiceDuration(ms: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Why the microphone could not be opened, in words a member can act on. */
export function microphoneErrorText(error: unknown): string {
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "اسمح للموقع باستخدام الميكروفون من إعدادات المتصفح، ثم حاول مرة أخرى.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "لم نجد ميكروفونًا في هذا الجهاز.";
  }
  if (name === "NotReadableError") {
    return "الميكروفون مستخدم في تطبيق آخر. أغلقه ثم حاول مرة أخرى.";
  }
  if (name === "unsupported") {
    return "هذا المتصفح لا يدعم تسجيل الرسائل الصوتية. حدّثه أو جرّب متصفحًا آخر.";
  }
  return "تعذّر بدء التسجيل. حاول مرة أخرى.";
}
