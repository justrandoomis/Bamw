import { useMemo, useState } from "react";
import { Maximize2, Play } from "lucide-react";
import { useHub } from "./hubContext";
import { Section } from "@/hub/ui/Section";
import { Reveal, Segmented, SmartImage } from "@/hub/ui/Bits";
import { useI18n } from "@/hub/i18n";
import { formatDuration, formatDate } from "@/hub/utils/format";
import { cn } from "@/hub/utils/cn";
import type { ImageCategory, VideoKind } from "@/hub/types";
import { cdnImage } from "@/lib/img";

const VIDEO_LABEL_KEY: Record<VideoKind, string> = {
  trailer: "media.trailer",
  "launch-trailer": "media.launchTrailer",
  announcement: "media.announcement",
  gameplay: "media.gameplayVideo",
  direct: "media.direct",
  review: "media.review",
  tips: "media.tips",
  walkthrough: "media.walkthrough",
};

const CATEGORY_LABEL_KEY: Record<ImageCategory, string> = {
  gameplay: "media.categoryGameplay",
  characters: "media.categoryCharacters",
  world: "media.categoryWorld",
  combat: "media.categoryCombat",
  ui: "media.categoryUi",
  art: "media.categoryArt",
};

/** "Watch the game" — videos grouped by kind, played inline in a modal. */
export function VideosSection() {
  const { t, intlLocale } = useI18n();
  const { game, openVideo } = useHub();
  const videos = game.videos ?? [];
  const [kind, setKind] = useState<VideoKind | "all">("all");

  const kinds = useMemo(() => [...new Set(videos.map((v) => v.kind))], [videos]);
  if (videos.length === 0) return null;

  const visible = kind === "all" ? videos : videos.filter((v) => v.kind === kind);
  const [lead, ...rest] = visible;

  return (
    <Section
      id="videos"
      title={t("media.title")}
      subtitle={t("media.subtitle")}
      weight="primary"
      action={
        kinds.length > 1 ? (
          <Segmented<VideoKind | "all">
            size="sm"
            value={kind}
            onChange={setKind}
            ariaLabel={t("media.title")}
            options={[
              { id: "all" as const, label: t("common.all"), count: videos.length },
              ...kinds.map((k) => ({ id: k, label: t(VIDEO_LABEL_KEY[k] as never) })),
            ]}
          />
        ) : undefined
      }
    >
      <Reveal>
        <div
          className={cn(
            "grid gap-3",
            rest.length > 0 ? "lg:grid-cols-[1.6fr_1fr]" : "grid-cols-1 max-w-3xl mx-auto",
          )}
        >
          {lead && (
            <button
              onClick={() => openVideo(lead)}
              className="group relative aspect-video overflow-hidden rounded-panel border border-white/[0.08] text-start"
            >
              <SmartImage
                src={cdnImage(lead.thumbnailUrl)}
                alt={lead.title}
                wrapperClassName="absolute inset-0"
                className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
              />
              <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-nin/90 text-white transition-transform duration-300 group-hover:scale-110">
                  <Play className="ms-0.5 h-6 w-6 fill-current" />
                </span>
              </span>
              <span className="absolute inset-x-0 bottom-0 p-4">
                <span className="chip mb-2 bg-black/60 backdrop-blur">
                  {t(VIDEO_LABEL_KEY[lead.kind] as never)}
                </span>
                <span className="block text-base font-extrabold leading-snug">{lead.title}</span>
                <span className="mt-0.5 block text-[11px] muted">
                  {[
                    lead.channel,
                    formatDate(lead.publishedAt, intlLocale),
                    formatDuration(lead.duration),
                  ]
                    .filter(Boolean)
                    .join(" · ") || ""}
                </span>
              </span>
            </button>
          )}

          {rest.length > 0 && (
            <div className="no-scrollbar flex gap-3 overflow-x-auto lg:max-h-[420px] lg:flex-col lg:overflow-y-auto lg:pe-1">
              {rest.map((video, vIdx) => (
                <button
                  key={`${video.id || video.title}-${vIdx}`}
                  onClick={() => openVideo(video)}
                  className="group flex w-64 shrink-0 items-start gap-3 rounded-xl p-2 text-start transition-colors hover:bg-white/[0.05] lg:w-full"
                >
                  <span className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg">
                    <SmartImage
                      src={cdnImage(video.thumbnailUrl)}
                      alt={video.title}
                      wrapperClassName="absolute inset-0"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
                      <Play className="h-4 w-4 fill-white text-white" />
                    </span>
                    {video.duration != null && (
                      <span className="absolute bottom-1 end-1 rounded bg-black/80 px-1 text-[9px] font-bold tabular-nums">
                        {formatDuration(video.duration)}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-xs font-bold leading-snug transition-colors group-hover:text-nin-soft">
                      {video.title}
                    </span>
                    <span className="mt-1 block text-[10px] muted">
                      {t(VIDEO_LABEL_KEY[video.kind] as never)}
                      {video.channel ? ` · ${video.channel}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Reveal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

/** Screenshot gallery with category filtering; clicking opens the lightbox. */
export function GallerySection() {
  const { t } = useI18n();
  const { game, openLightbox } = useHub();
  const images = game.images ?? [];
  const [category, setCategory] = useState<ImageCategory | "all">("all");

  const categories = useMemo(
    () => [...new Set(images.map((i) => i.category).filter(Boolean))] as ImageCategory[],
    [images],
  );

  if (images.length === 0) return null;

  const visible = category === "all" ? images : images.filter((i) => i.category === category);

  return (
    <Section
      id="gallery"
      title={t("media.gallery")}
      weight="support"
      action={
        categories.length > 1 ? (
          <Segmented<ImageCategory | "all">
            size="sm"
            value={category}
            onChange={setCategory}
            ariaLabel={t("media.gallery")}
            options={[
              { id: "all" as const, label: t("media.categoryAll"), count: images.length },
              ...categories.map((c) => ({ id: c, label: t(CATEGORY_LABEL_KEY[c] as never) })),
            ]}
          />
        ) : undefined
      }
    >
      <Reveal>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((image, index) => (
            <button
              key={`${image.id || image.url}-${index}`}
              onClick={() => openLightbox(image.id)}
              className={cn(
                "group relative aspect-[16/10] overflow-hidden rounded-xl border border-white/[0.06]",
                // First tile spans two columns so the grid has a focal point.
                index === 0 && "col-span-2 row-span-2 aspect-[16/12] sm:aspect-[16/10]",
              )}
            >
              <SmartImage
                src={cdnImage(image.url)}
                alt={image.alt}
                wrapperClassName="absolute inset-0"
                className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
              />
              <span className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <span className="line-clamp-2 text-[11px] font-semibold leading-snug">
                  {image.alt}
                </span>
                <Maximize2 className="h-3.5 w-3.5 shrink-0" />
              </span>
            </button>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
