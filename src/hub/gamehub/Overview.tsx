import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Game } from "@/hub/types";
import { useHub } from "./hubContext";
import { Section } from "@/hub/ui/Section";
import { Panel } from "@/hub/ui/Panel";
import { Chip, Reveal, SmartImage } from "@/hub/ui/Bits";
import { useI18n } from "@/hub/i18n";
import { gamePath } from "@/hub/utils/seo";
import { cn } from "@/hub/utils/cn";
import { cdnImage } from "@/lib/img";

/*
  "About the game" + "Is this game for you?".
*/

/**
 * Whether the overview has anything in it — now, whether the game has a
 * description, since the facts live in the hero.
 *
 * Exported because the nav chip has to ask the same question: a chip that
 * scrolls to a section that was dropped is the failure `buildNavItems`
 * promises cannot happen.
 */
export function hasOverviewFacts(game: Game): boolean {
  return Boolean(game.description);
}

export function GlanceSection() {
  const { t } = useI18n();
  const { game } = useHub();
  const [expanded, setExpanded] = useState(false);

  const description = game.description;
  const isLong = (description?.length ?? 0) > 320;

  /*
    The facts moved up: the hero's strip carries the platform, size, players,
    languages and date, and its badges the score and the age rating, so tiles
    here would only say them a second time a screen later. What is left is the
    one thing the hero has no room for — what the game is about. A game with
    no description has no section, and no chip pointing at one.
  */
  if (!hasOverviewFacts(game)) return null;

  return (
    <Section id="overview" title={t("glance.about")} weight="primary">
      <Reveal>
        <Panel className="p-5 sm:p-6">
          <p
            className={cn(
              "max-w-3xl text-[15px] leading-[1.85] text-foreground/85",
              !expanded && isLong && "line-clamp-5",
            )}
          >
            {description}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 text-[13px] font-bold text-nin hover:underline"
            >
              {expanded ? t("common.showLess") : t("common.readMore")}
            </button>
          )}
        </Panel>
      </Reveal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * "Is this game for you?"
 *
 * Recommendation reasons are always shown. A similar game with no stated reason
 * is not a recommendation, it is a guess, so those are filtered out.
 */
export function FitSection() {
  const { t } = useI18n();
  const { game } = useHub();

  const tags = game.audienceTags ?? [];
  const picks = (game.similar ?? []).filter((s) => s.reasons.length > 0).slice(0, 4);

  if (tags.length === 0 && picks.length === 0) return null;

  return (
    <Section id="fit" title={t("fit.title")} subtitle={t("fit.subtitle")} weight="primary">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        {tags.length > 0 && (
          <Reveal>
            <Panel className="h-full p-5 sm:p-6">
              <p className="eyebrow mb-4">{t("fit.tags")}</p>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag, index) => (
                  <Chip
                    key={`${tag.id || tag.label}-${index}`}
                    tone={tag.positive ? "good" : "default"}
                  >
                    {tag.label}
                  </Chip>
                ))}
              </div>
            </Panel>
          </Reveal>
        )}

        {picks.length > 0 && (
          <Reveal delay={80}>
            <Panel className="h-full p-5 sm:p-6">
              <p className="eyebrow mb-4 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-warn" />
                {t("fit.perfectIf")}
              </p>
              <ul className="space-y-2.5">
                {picks.map((pick, index) => (
                  <li key={`${pick.slug || pick.title}-${index}`}>
                    <Link
                      to={gamePath(pick.slug)}
                      className="group flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-muted/60"
                    >
                      <SmartImage
                        src={cdnImage(pick.coverUrl)}
                        alt={pick.title}
                        wrapperClassName="h-14 w-11 shrink-0 rounded-md"
                        className="h-full w-full object-cover"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold transition-colors group-hover:text-nin-soft">
                          {pick.title}
                        </span>
                        <span className="line-clamp-2 block text-[11px] leading-snug muted">
                          {pick.reasons[0]?.text}
                        </span>
                      </span>
                      {pick.matchScore != null && (
                        <span className="shrink-0 text-[11px] font-extrabold text-good">
                          {Math.round(pick.matchScore * 100)}%
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          </Reveal>
        )}
      </div>
    </Section>
  );
}
