import { useState } from "react";
import { Eye, EyeOff, Play } from "lucide-react";
import { useHub } from "./hubContext";
import { Section } from "@/hub/ui/Section";
import { Panel } from "@/hub/ui/Panel";
import { Chip, Reveal, SmartImage } from "@/hub/ui/Bits";
import { useI18n } from "@/hub/i18n";
import { cn } from "@/hub/utils/cn";
import { cdnImage } from "@/lib/img";

/**
 * "The World" — the story, told in chapters against full-bleed art.
 *
 * Spoiler sections are gated by default and stay gated per visit: the copy is
 * not merely blurred (which screen readers and "select all" defeat) but not
 * rendered at all until revealed.
 */
export function StorySection() {
  const { t } = useI18n();
  const { game, imagesById } = useHub();
  const sections = game.story ?? [];
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  if (sections.length === 0) return null;

  const toggle = (id: string) =>
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Section id="story" title={t("story.title")} subtitle={t("story.subtitle")} weight="primary">
      <div className="space-y-4">
        {sections.map((section, index) => {
          const image = section.imageId ? imagesById.get(section.imageId) : undefined;
          const hidden = section.spoiler && !revealed.has(section.id);
          const flip = index % 2 === 1;

          return (
            <Reveal key={`${section.id}-${index}`} delay={index * 60}>
              <Panel className="overflow-hidden">
                <div className={cn("grid lg:grid-cols-2", flip && "lg:[&>*:first-child]:order-2")}>
                  {image && (
                    <div className="relative aspect-[16/10] lg:aspect-auto lg:min-h-[280px]">
                      <SmartImage
                        src={cdnImage(image.url)}
                        alt={image.alt}
                        wrapperClassName="absolute inset-0"
                        className="h-full w-full object-cover"
                      />
                      <div
                        className={cn(
                          "absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/20 to-transparent",
                          "lg:bg-gradient-to-r lg:from-transparent lg:to-ink-900/90",
                          flip && "lg:bg-gradient-to-l",
                        )}
                      />
                    </div>
                  )}

                  <div className="flex flex-col justify-center p-6 sm:p-8">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-extrabold tracking-tight sm:text-2xl">
                        {section.title}
                      </h3>
                      {section.spoiler && (
                        <Chip tone="warn" icon={EyeOff}>
                          {t("story.spoiler")}
                        </Chip>
                      )}
                    </div>

                    {hidden ? (
                      <div className="rounded-2xl bg-muted/50 p-6 text-center">
                        <p className="text-xs muted">{t("story.spoiler")}</p>
                        <button
                          onClick={() => toggle(section.id)}
                          className="btn btn-quiet mt-3 h-9 px-4 text-xs"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          {t("story.reveal")}
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="max-w-prose text-sm leading-[1.8] muted">{section.body}</p>
                        {section.spoiler && (
                          <button
                            onClick={() => toggle(section.id)}
                            className="mt-3 self-start text-xs font-bold text-nin-soft hover:underline"
                          >
                            {t("story.hide")}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Panel>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * "Experience the game" — gameplay pillars.
 *
 * Editorial layout rather than a card grid: one wide image per pillar with the
 * copy set against it, alternating sides, so the section reads like a feature
 * spread instead of a specification list.
 */
export function GameplaySection() {
  const { t } = useI18n();
  const { game, imagesById, videosById, openVideo } = useHub();
  const pillars = game.gameplayPillars ?? [];

  if (pillars.length === 0) return null;

  return (
    <Section
      id="gameplay"
      title={t("gameplay.title")}
      subtitle={t("gameplay.subtitle")}
      weight="primary"
    >
      <div className="space-y-3">
        {pillars.map((pillar, index) => {
          const image = pillar.imageId ? imagesById.get(pillar.imageId) : undefined;
          const video = pillar.videoId ? videosById.get(pillar.videoId) : undefined;
          const flip = index % 2 === 1;

          return (
            <Reveal key={`${pillar.id}-${index}`} delay={index * 50}>
              <div
                className={cn(
                  "group relative grid overflow-hidden rounded-panel border border-border/70 sm:grid-cols-[1.15fr_1fr]",
                  flip && "sm:[&>*:first-child]:order-2",
                )}
              >
                <div className="relative aspect-[16/9] overflow-hidden sm:aspect-auto sm:min-h-[240px]">
                  <SmartImage
                    src={cdnImage(image?.url)}
                    alt={image?.alt ?? pillar.title}
                    wrapperClassName="absolute inset-0"
                    className="h-full w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.04]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink-850 to-transparent sm:bg-gradient-to-r sm:from-transparent sm:to-ink-850" />
                  {video && (
                    <button
                      onClick={() => openVideo(video)}
                      aria-label={video.title}
                      className="absolute bottom-4 start-4 flex h-11 w-11 items-center justify-center rounded-full bg-nin text-white transition-transform hover:scale-110"
                    >
                      <Play className="ms-0.5 h-4 w-4 fill-current" />
                    </button>
                  )}
                </div>

                <div className="flex flex-col justify-center bg-ink-850 p-6 sm:p-8">
                  <h3 className="text-lg font-extrabold tracking-tight sm:text-xl">
                    {pillar.title}
                  </h3>
                  <p className="mt-2 max-w-prose text-sm leading-[1.75] muted">
                    {pillar.description}
                  </p>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

export function FeaturesSection() {
  const { t } = useI18n();
  const { game } = useHub();
  const features = game.features ?? [];

  if (features.length === 0) return null;

  return (
    <Section id="features" title={t("gameplay.features")} weight="support">
      <Reveal>
        <Panel className="p-5 sm:p-6">
          <div className="flex flex-wrap gap-2">
            {features.map((feature, index) => (
              <span
                key={`${feature.id || feature.label}-${index}`}
                className="rounded-xl bg-muted/50 px-3.5 py-2 text-xs font-bold transition-colors hover:bg-muted/60"
              >
                {feature.label}
              </span>
            ))}
          </div>
        </Panel>
      </Reveal>
    </Section>
  );
}
