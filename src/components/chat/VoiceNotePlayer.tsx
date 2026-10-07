import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Pause, Play } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatVoiceDuration } from "@/lib/voiceNotes";

/* One voice note plays at a time, as in every messenger. */
let playingNow: HTMLAudioElement | null = null;

/**
 * A voice note in a chat bubble: play/pause, a bar you can tap to seek, and
 * the time. Used by the member's chat and the admin inbox alike.
 *
 * `durationMs` comes from the recorder. A WebM recording from Chrome carries
 * no duration of its own — the element reports Infinity until it has played
 * to the end — so the recorder's figure is what the bar and the clock use
 * until the file says otherwise.
 *
 * `tone="inverse"` is for a bubble drawn in the primary colour, where the
 * player takes the bubble's own text colour.
 */
export function VoiceNotePlayer({
  src,
  durationMs,
  tone = "default",
  className,
}: {
  src: string;
  durationMs?: number;
  tone?: "default" | "inverse";
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(durationMs && durationMs > 0 ? durationMs / 1000 : 0);

  useEffect(
    () => () => {
      if (playingNow === audioRef.current) playingNow = null;
    },
    [],
  );

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (playingNow && playingNow !== audio) playingNow.pause();
    playingNow = audio;
    setLoading(true);
    try {
      await audio.play();
      setFailed(false);
    } catch (error) {
      /* An autoplay refusal is not a broken file; anything else is. */
      if ((error as { name?: string })?.name !== "NotAllowedError") setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !total) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    try {
      audio.currentTime = ratio * total;
      setCurrent(audio.currentTime);
    } catch {
      /* A file the browser cannot seek in still plays from the start. */
    }
  };

  const progress = total > 0 ? Math.min(1, current / total) : 0;
  const inverse = tone === "inverse";

  return (
    <div className={cn("flex w-56 max-w-full items-center gap-2.5", className)} dir="ltr">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={playing ? "إيقاف الرسالة الصوتية" : "تشغيل الرسالة الصوتية"}
        className={cn(
          "grid size-9 shrink-0 cursor-pointer place-items-center rounded-full transition-transform active:scale-95",
          inverse ? "bg-current/20" : "bg-primary text-primary-foreground",
        )}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : playing ? (
          <Pause className="size-4" fill="currentColor" />
        ) : (
          <Play className="ms-0.5 size-4" fill="currentColor" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          role="slider"
          aria-label="موضع التشغيل"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(current)}
          tabIndex={-1}
          onClick={seek}
          className="relative h-6 cursor-pointer"
        >
          <span
            className={cn(
              "absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full",
              inverse ? "bg-current/30" : "bg-muted-foreground/25",
            )}
          />
          <span
            className={cn(
              "absolute start-0 top-1/2 h-1 -translate-y-1/2 rounded-full",
              inverse ? "bg-current" : "bg-primary",
            )}
            style={{ width: `${progress * 100}%` }}
          />
          <span
            className={cn(
              "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm",
              inverse ? "bg-current" : "bg-primary",
            )}
            style={{ left: `${progress * 100}%` }}
          />
        </div>
        {failed && (
          <a
            href={src}
            download
            className="flex items-center gap-1 text-[10px] font-bold underline opacity-80"
          >
            <Download className="size-3" />
            تعذّر التشغيل هنا — تنزيل الملف
          </a>
        )}
      </div>

      <span className="shrink-0 text-[11px] font-semibold tabular-nums opacity-75">
        {formatVoiceDuration((playing || current > 0 ? current : total) * 1000)}
      </span>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => {
          const d = event.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setTotal(d);
        }}
        onDurationChange={(event) => {
          const d = event.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setTotal(d);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(event) => {
          setPlaying(false);
          setCurrent(0);
          event.currentTarget.currentTime = 0;
        }}
        onError={() => {
          setFailed(true);
          setPlaying(false);
          setLoading(false);
        }}
      />
    </div>
  );
}
