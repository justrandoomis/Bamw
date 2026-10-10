import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  Compass,
  Crosshair,
  Eye,
  Flame,
  Gem,
  ListChecks,
  Map as MapIcon,
  Package,
  Swords,
  Target,
  Trophy,
} from "lucide-react";
import { useHub } from "./hubContext";
import { Section, Seam } from "@/hub/ui/Section";
import { Panel } from "@/hub/ui/Panel";
import { Chip, Reveal, SmartImage } from "@/hub/ui/Bits";
import { useI18n } from "@/hub/i18n";
import { useCurrency } from "@/hub/context/CurrencyContext";
import { formatDate, formatRange } from "@/hub/utils/format";
import { gamePath } from "@/hub/utils/seo";
import type { Dlc, Guide } from "@/hub/types";

/* -------------------------------------------------------------------------- */
/* DLC                                                                        */
/* -------------------------------------------------------------------------- */

const NECESSITY_TONE: Record<
  NonNullable<Dlc["necessity"]>["verdict"],
  { tone: "good" | "warn" | "default" | "muted"; key: string }
> = {
  essential: { tone: "good", key: "dlc.essential" },
  recommended: { tone: "good", key: "dlc.recommended" },
  optional: { tone: "default", key: "dlc.optionalDlc" },
  skip: { tone: "muted", key: "dlc.skip" },
};

/**
 * DLC list with a straight answer per pack.
 *
 * "Do I need this?" is the question people actually have, so the verdict and
 * its reason are given the same prominence as the price.
 */
export function DlcSection() {
  const { t, intlLocale } = useI18n();
  const { game } = useHub();
  const { formatConverted } = useCurrency();
  const dlc = game.dlc ?? [];
  const editionNames = new Map((game.editions ?? []).map((e) => [e.id, e.name]));

  if (dlc.length === 0) return null;

  return (
    <Section id="dlc" title={t("dlc.title")} subtitle={t("dlc.subtitle")} weight="primary">
      <div className="space-y-3">
        {dlc.map((pack, index) => {
          const verdict = pack.necessity ? NECESSITY_TONE[pack.necessity.verdict] : null;
          return (
            <Reveal key={`${pack.id || pack.name}-${index}`} delay={index * 60}>
              <Panel className="overflow-hidden">
                <div className="flex flex-col gap-5 p-5 sm:flex-row sm:p-6">
                  <SmartImage
                    src={pack.coverUrl}
                    alt={pack.name}
                    wrapperClassName="h-40 w-full shrink-0 rounded-xl sm:h-auto sm:w-32"
                    className="h-full w-full object-cover"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-base font-extrabold">{pack.name}</h3>
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] muted">
                          {pack.releaseDate && (
                            <span>{formatDate(pack.releaseDate, intlLocale)}</span>
                          )}
                          {pack.playTimeHours && (
                            <span>
                              {t("dlc.playTime")}:{" "}
                              {formatRange(pack.playTimeHours, t("common.hours"))}
                            </span>
                          )}
                        </p>
                      </div>
                      {pack.price && (
                        <span className="num text-lg font-extrabold text-good">
                          {formatConverted(pack.price)}
                        </span>
                      )}
                    </div>

                    {pack.contents && pack.contents.length > 0 && (
                      <ul className="mt-3 grid gap-1 text-xs muted sm:grid-cols-2">
                        {pack.contents.map((line, lineIdx) => (
                          <li key={`${line}-${lineIdx}`} className="flex items-start gap-1.5">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-nin-soft" />
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}

                    {pack.includedInEditionIds && pack.includedInEditionIds.length > 0 && (
                      <p className="mt-3 text-[11px] muted">
                        {t("dlc.includedIn")}:{" "}
                        <span className="font-semibold">
                          {pack.includedInEditionIds
                            .map((id) => editionNames.get(id) ?? id)
                            .join(" · ") || ""}
                        </span>
                      </p>
                    )}

                    {pack.necessity && verdict && (
                      <>
                        <Seam className="my-4" />
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                          <span className="shrink-0">
                            <span className="eyebrow">{t("dlc.doINeedIt")}</span>
                            <span className="mt-1 block">
                              <Chip tone={verdict.tone}>{t(verdict.key as never)}</Chip>
                            </span>
                          </span>
                          <p className="text-xs leading-relaxed muted sm:ps-4">
                            {pack.necessity.reason}
                          </p>
                        </div>
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
/* Guides                                                                     */
/* -------------------------------------------------------------------------- */

const GUIDE_META: Record<Guide["category"], { icon: typeof Compass; key: string }> = {
  beginner: { icon: Compass, key: "guides.beginner" },
  tips: { icon: Flame, key: "guides.tips" },
  builds: { icon: Target, key: "guides.builds" },
  weapons: { icon: Swords, key: "guides.weapons" },
  bosses: { icon: Crosshair, key: "guides.bosses" },
  secrets: { icon: Eye, key: "guides.secrets" },
  collectibles: { icon: Gem, key: "guides.collectibles" },
  walkthrough: { icon: MapIcon, key: "guides.walkthrough" },
  completion: { icon: ListChecks, key: "guides.completion" },
};

/**
 * Guides hub: one featured guide, then a rail for the rest.
 *
 * A wall of equal cards makes nine guides look like nine chores, so the one a
 * new player needs leads at full width and the others scroll beside it.
 *
 * Guides open in the in-page reader (`openGuide`) so nobody loses their place
 * on the hub; each also has a real route at `/games/:slug/guides/:guideSlug`
 * for linking and indexing, reachable from the reader's footer.
 */
export function GuidesSection() {
  const { t, intlLocale } = useI18n();
  const { game, openGuide } = useHub();
  const guides = game.guides ?? [];

  if (guides.length === 0) return null;

  // The beginner guide leads when there is one — it is what a visitor who has
  // just decided to buy actually needs next.
  const featured = guides.find((guide) => guide.category === "beginner") ?? guides[0];
  if (!featured) return null;
  const rest = guides.filter((guide) => guide.slug !== featured.slug);
  const featuredImage = featured.heroImageId
    ? game.images?.find((image) => image.id === featured.heroImageId)
    : undefined;
  const FeaturedIcon = GUIDE_META[featured.category].icon;

  return (
    <Section
      id="guides"
      title={t("guides.title")}
      subtitle={t("guides.subtitle")}
      weight="primary"
      action={
        <Link to={gamePath(game.slug, "guides")} className="btn btn-quiet h-9 px-3.5 text-xs">
          <BookOpen className="h-3.5 w-3.5" />
          {t("common.viewAll")} ({guides.length})
        </Link>
      }
    >
      {/* Featured guide — image-led, full width */}
      <Reveal>
        <button
          onClick={() => openGuide(featured.slug)}
          className="group relative block w-full overflow-hidden rounded-panel border border-border/70 text-start"
        >
          <div className="grid sm:grid-cols-[1.15fr_1fr]">
            <div className="relative aspect-[16/9] overflow-hidden sm:aspect-auto sm:min-h-[220px]">
              <SmartImage
                src={featuredImage?.url}
                alt={featuredImage?.alt ?? featured.title}
                wrapperClassName="absolute inset-0"
                className="h-full w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.04]"
              />
              <span className="absolute inset-0 bg-gradient-to-t from-ink-850 to-transparent sm:bg-gradient-to-r sm:from-transparent sm:to-ink-850" />
            </div>
            <div className="flex flex-col justify-center bg-ink-850 p-6">
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider muted">
                <FeaturedIcon className="h-3.5 w-3.5 text-nin-soft" />
                {t(GUIDE_META[featured.category].key as never)}
              </span>
              <span className="mt-2 text-lg font-extrabold leading-snug transition-colors group-hover:text-nin-soft">
                {featured.title}
              </span>
              <span className="mt-2 text-xs leading-relaxed muted">{featured.summary}</span>
              <span className="mt-3 flex items-center gap-2 text-[10px] muted">
                {featured.readingTime != null && (
                  <span>{t("guides.readingTime", { minutes: featured.readingTime })}</span>
                )}
                {featured.updatedAt && <span>· {formatDate(featured.updatedAt, intlLocale)}</span>}
              </span>
            </div>
          </div>
        </button>
      </Reveal>

      {/* The rest — horizontal rail, not a wall of cards */}
      {rest.length > 0 && (
        <Reveal delay={80}>
          <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
            {rest.map((guide, guideIdx) => {
              const Icon = GUIDE_META[guide.category].icon;
              return (
                <button
                  key={`${guide.slug}-${guideIdx}`}
                  onClick={() => openGuide(guide.slug)}
                  className="group flex w-56 shrink-0 flex-col rounded-2xl border border-border/70 bg-muted/50 p-4 text-start transition-all duration-200 hover:border-foreground/20 hover:bg-muted/60"
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-nin-soft" />
                    <span className="text-[10px] font-bold uppercase tracking-wider muted">
                      {t(GUIDE_META[guide.category].key as never)}
                    </span>
                  </span>
                  <span className="mt-2 text-xs font-extrabold leading-snug transition-colors group-hover:text-nin-soft">
                    {guide.title}
                  </span>
                  <span className="mt-1.5 line-clamp-2 flex-1 text-[11px] leading-relaxed muted">
                    {guide.summary}
                  </span>
                  <span className="mt-3 flex items-center gap-2 text-[10px] muted">
                    {guide.readingTime != null && (
                      <span>{t("guides.readingTime", { minutes: guide.readingTime })}</span>
                    )}
                    {guide.spoilerLevel && guide.spoilerLevel !== "none" && (
                      <span className="rounded bg-warn/10 px-1.5 py-0.5 font-bold text-warn">
                        {t(
                          guide.spoilerLevel === "heavy"
                            ? "guides.spoilerHeavy"
                            : "guides.spoilerLight",
                        )}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </Reveal>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Completion                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Completion, not trophies.
 *
 * Nintendo systems have no platform achievement layer, so inventing a trophy
 * list would be fiction. This shows what the game itself tracks.
 */
export function CompletionSection() {
  const { t } = useI18n();
  const { game } = useHub();
  const completion = game.completion;

  if (!completion) return null;

  const durations = [
    { label: t("completion.mainStory"), range: completion.mainStoryHours },
    { label: t("completion.mainPlusExtras"), range: completion.mainPlusExtrasHours },
    { label: t("completion.hundredPercent"), range: completion.hundredPercentHours },
  ].filter((d) => d.range);

  const hasTrackables =
    (completion.collectibles?.length ?? 0) > 0 ||
    (completion.challenges?.length ?? 0) > 0 ||
    completion.inGameAchievements?.supported;

  if (durations.length === 0 && !hasTrackables) return null;

  return (
    <Section
      id="completion"
      title={t("completion.title")}
      subtitle={t("completion.subtitle")}
      weight="support"
    >
      <Reveal>
        <div className="grid gap-3 lg:grid-cols-2">
          {durations.length > 0 && (
            <Panel className="p-5 sm:p-6">
              <div className="space-y-3">
                {durations.map((duration, durIdx) => (
                  <div
                    key={`${duration.label}-${durIdx}`}
                    className="flex items-baseline justify-between gap-3 border-b border-border/70 pb-2.5 last:border-b-0 last:pb-0"
                  >
                    <span className="text-xs muted">{duration.label}</span>
                    <span dir="auto" className="text-sm font-extrabold tabular-nums">
                      {formatRange(duration.range, t("common.hours"))}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {hasTrackables && (
            <Panel className="p-5 sm:p-6">
              <div className="flex flex-wrap gap-2">
                {completion.collectibles?.map((item, itemIdx) => (
                  <Chip key={`${item.label}-${itemIdx}`} icon={Gem}>
                    {item.label} · <b>{item.total}</b>
                  </Chip>
                ))}
                {completion.challenges?.map((item, itemIdx) => (
                  <Chip key={`${item.label}-${itemIdx}`} icon={Target}>
                    {item.label}
                    {item.total != null && (
                      <>
                        {" · "}
                        <b>{item.total}</b>
                      </>
                    )}
                  </Chip>
                ))}
                {completion.inGameAchievements?.supported && (
                  <Chip icon={Trophy} tone="warn">
                    {t("completion.inGameAchievements")}
                    {completion.inGameAchievements.total != null && (
                      <>
                        {" · "}
                        <b>{completion.inGameAchievements.total}</b>
                      </>
                    )}
                  </Chip>
                )}
              </div>
              <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed muted">
                <Package className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {completion.inGameAchievements?.note ?? t("completion.noAchievementSystem")}
              </p>
            </Panel>
          )}
        </div>
      </Reveal>
    </Section>
  );
}

/** Small helper reused by the guides route. */
export function guideCategoryLabel(
  category: Guide["category"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  return t(GUIDE_META[category].key as never);
}

export function guideCategoryIcon(category: Guide["category"]) {
  return GUIDE_META[category].icon;
}

export { GUIDE_META };
