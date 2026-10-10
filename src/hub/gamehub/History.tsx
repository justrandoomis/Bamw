import { useState } from "react";
import {
  CircleDot,
  Disc3,
  ExternalLink,
  Megaphone,
  Package,
  PlayCircle,
  Rocket,
  Wrench,
} from "lucide-react";
import { useHub } from "./hubContext";
import { Section } from "@/hub/ui/Section";
import { Panel } from "@/hub/ui/Panel";
import { Reveal } from "@/hub/ui/Bits";
import { useI18n } from "@/hub/i18n";
import { formatDate } from "@/hub/utils/format";
import { cn } from "@/hub/utils/cn";
import type { TimelineEvent } from "@/hub/types";

const EVENT_META: Record<string, { icon: typeof Rocket; key: string; accent?: boolean }> = {
  announcement: { icon: Megaphone, key: "timeline.announcement" },
  trailer: { icon: PlayCircle, key: "timeline.trailer" },
  demo: { icon: CircleDot, key: "timeline.demo" },
  release: { icon: Rocket, key: "timeline.release", accent: true },
  update: { icon: Wrench, key: "timeline.update" },
  dlc: { icon: Package, key: "timeline.dlcEvent" },
  expansion: { icon: Package, key: "timeline.expansion" },
};

const DEFAULT_EVENT_META: { icon: typeof Rocket; key: string; accent?: boolean } = {
  icon: Wrench,
  key: "timeline.update",
};

/** Visual timeline from announcement through post-launch content. */
export function TimelineSection() {
  const { t, intlLocale } = useI18n();
  const { game, videosById, openVideo } = useHub();
  const events = game.timeline ?? [];

  const sorted = [...events].sort((a, b) => {
    const timeA = a.date ? new Date(a.date).getTime() : 0;
    const timeB = b.date ? new Date(b.date).getTime() : 0;
    const validA = Number.isFinite(timeA) && timeA > 0;
    const validB = Number.isFinite(timeB) && timeB > 0;
    if (validA && validB) return timeB - timeA; // Newest first
    if (validA) return -1;
    if (validB) return 1;
    return 0;
  });

  const now = Date.now();

  return (
    <Section id="timeline" title={t("timeline.title")} weight="support">
      <Reveal>
        <Panel className="p-5 sm:p-6">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 text-muted">
                <Rocket className="h-5 w-5 opacity-40" />
              </span>
              <p className="text-sm font-bold text-muted">
                {intlLocale === "ar"
                  ? "لا توجد أحداث مسجلة لهذه اللعبة بعد"
                  : "No events recorded for this game yet"}
              </p>
            </div>
          ) : (
            <ol className="relative space-y-0">
              {/* The rail sits behind the markers, inset to align with them. */}
              <span
                aria-hidden
                className="absolute bottom-4 top-2 start-[7px] w-px bg-gradient-to-b from-foreground/15 via-foreground/10 to-transparent"
              />
              {sorted.map((event, index) => {
                const meta = EVENT_META[event.kind] || DEFAULT_EVENT_META;
                const Icon = meta.icon;
                const eventTime = event.date ? new Date(event.date).getTime() : 0;
                const future = Number.isFinite(eventTime) && eventTime > now;
                const video = event.videoId ? videosById.get(event.videoId) : undefined;
                const linkUrl = event.sourceUrl || event.url;

                return (
                  <li
                    key={`${event.id || event.title}-${index}`}
                    className="relative flex gap-4 pb-5 last:pb-0"
                  >
                    <span
                      className={cn(
                        "relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-4 ring-ink-900",
                        meta.accent ? "bg-nin" : future ? "bg-foreground/20" : "bg-foreground/35",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider muted">
                          <Icon className="h-3 w-3" />
                          {t(meta.key as never) || event.kind}
                        </span>
                        {event.date && (
                          <span className="text-[11px] tabular-nums muted">
                            {formatDate(event.date, intlLocale)}
                          </span>
                        )}
                        {event.version && (
                          <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[10px] font-mono font-bold text-nin-soft">
                            {event.version}
                          </span>
                        )}
                        {future && (
                          <span className="rounded-full bg-warn/12 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-warn">
                            {t("series.upcoming")}
                          </span>
                        )}
                      </div>
                      <p className={cn("mt-0.5 text-sm font-bold", meta.accent && "text-nin-soft")}>
                        {event.title}
                      </p>
                      {event.detail && (
                        <p className="mt-0.5 text-xs leading-relaxed muted">{event.detail}</p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-3">
                        {video && (
                          <button
                            type="button"
                            onClick={() => openVideo(video)}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-nin-soft hover:underline"
                          >
                            <PlayCircle className="h-3 w-3" />
                            {video.title}
                          </button>
                        )}
                        {linkUrl && (
                          <a
                            href={linkUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-muted hover:text-foreground"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span>{intlLocale === "ar" ? "المصدر" : "Source"}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </Reveal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Patch notes                                                                */
/* -------------------------------------------------------------------------- */

export function PatchNotesSection() {
  const { t, intlLocale } = useI18n();
  const { game } = useHub();
  const notes = game.patchNotes ?? [];
  const [expanded, setExpanded] = useState<string | null>(notes[0]?.version ?? null);

  if (notes.length === 0) return null;

  const groups = [
    { key: "added", label: t("patches.added"), tone: "text-good" },
    { key: "fixed", label: t("patches.fixed"), tone: "text-sky-300" },
    { key: "balance", label: t("patches.balance"), tone: "text-warn" },
    { key: "performance", label: t("patches.performance"), tone: "text-nin-soft" },
  ] as const;

  return (
    <Section id="patches" title={t("patches.title")} weight="support">
      <Reveal>
        <Panel className="divide-y divide-border/70 overflow-hidden">
          {notes.map((note, noteIdx) => {
            const open = expanded === note.version;
            return (
              <div key={`${note.version}-${noteIdx}`}>
                <button
                  onClick={() => setExpanded(open ? null : note.version)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start transition-colors hover:bg-muted/60"
                >
                  <span className="flex items-baseline gap-3">
                    <span className="font-mono text-sm font-extrabold">{note.version}</span>
                    <span className="text-[11px] muted">{formatDate(note.date, intlLocale)}</span>
                  </span>
                  <span className="text-[11px] muted">{open ? "−" : "+"}</span>
                </button>
                {open && (
                  <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
                    {groups.map((group, groupIdx) => {
                      const items = note[group.key];
                      if (!items || items.length === 0) return null;
                      return (
                        <div key={`${group.key}-${groupIdx}`}>
                          <p
                            className={cn(
                              "mb-1.5 text-[10px] font-extrabold uppercase tracking-wider",
                              group.tone,
                            )}
                          >
                            {group.label}
                          </p>
                          <ul className="space-y-1 text-xs leading-relaxed muted">
                            {items.map((item, itemIdx) => (
                              <li key={`${item}-${itemIdx}`} className="flex gap-2">
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-foreground/25" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </Panel>
      </Reveal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Soundtrack                                                                 */
/* -------------------------------------------------------------------------- */

export function SoundtrackSection() {
  const { t } = useI18n();
  const { game } = useHub();
  const ost = game.soundtrack;

  if (!ost || (!ost.composer && !ost.mainTheme && !ost.links?.length)) return null;

  return (
    <Section id="soundtrack" title={t("soundtrack.title")} weight="support">
      <Reveal>
        <Panel className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5 sm:p-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/70">
            <Disc3 className="h-5 w-5 text-nin-soft" />
          </span>
          {ost.composer && (
            <span>
              <span className="block text-[10px] font-bold uppercase tracking-wider muted">
                {t("soundtrack.composer")}
              </span>
              <span className="text-sm font-extrabold">{ost.composer}</span>
            </span>
          )}
          {ost.mainTheme && (
            <span>
              <span className="block text-[10px] font-bold uppercase tracking-wider muted">
                {t("soundtrack.mainTheme")}
              </span>
              <span className="text-sm font-extrabold">{ost.mainTheme.title}</span>
            </span>
          )}
          {ost.trackCount != null && (
            <span className="text-xs muted">
              {t("soundtrack.tracks", { count: ost.trackCount })}
            </span>
          )}
          {ost.links && ost.links.length > 0 && (
            <span className="ms-auto flex flex-wrap gap-2">
              {ost.links.map((link, linkIdx) => (
                <a
                  key={`${link.url || link.label}-${linkIdx}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-quiet h-9 px-3.5 text-xs"
                >
                  {link.label}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </span>
          )}
        </Panel>
      </Reveal>
    </Section>
  );
}
