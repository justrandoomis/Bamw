import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Building2, Code2, ExternalLink, Sparkles } from "lucide-react";
import { useHub } from "./hubContext";
import { Section } from "@/hub/ui/Section";
import { Panel } from "@/hub/ui/Panel";
import { Chip, Reveal, SmartImage } from "@/hub/ui/Bits";
import { PlatformBadge } from "@/hub/ui/Icons";
import { useI18n } from "@/hub/i18n";
import { useCurrency } from "@/hub/context/CurrencyContext";
import { formatMonthYear } from "@/hub/utils/format";
import { gamePath } from "@/hub/utils/seo";
import { cn } from "@/hub/utils/cn";
import type { SimilarityKind } from "@/hub/types";
import { cdnImage } from "@/lib/img";

const REASON_KEY: Record<SimilarityKind, string> = {
  gameplay: "similar.reasonGameplay",
  story: "similar.reasonStory",
  genre: "similar.reasonGenre",
  nintendo: "similar.reasonNintendo",
  difficulty: "similar.reasonDifficulty",
  audience: "similar.reasonAudience",
};

/**
 * "Games you may like".
 *
 * Filterable by the *kind* of similarity, because "similar" means different
 * things to different people — someone who loved the story wants a different
 * shortlist than someone who loved the traversal. Every card states its reason.
 */
export function SimilarGamesSection() {
  const { t, intlLocale } = useI18n();
  const { game } = useHub();
  const { formatConverted } = useCurrency();
  const similar = game.similar ?? [];
  const [kind, setKind] = useState<SimilarityKind | "all">("all");

  const kinds = [...new Set(similar.flatMap((s) => s.reasons.map((r) => r.kind)))];
  // Nothing to suggest, nothing drawn — not a panel saying so.
  if (similar.length === 0) return null;
  const visible =
    kind === "all" ? similar : similar.filter((s) => s.reasons.some((r) => r.kind === kind));

  return (
    <Section
      id="similar"
      title={t("similar.title")}
      subtitle={t("similar.subtitle")}
      weight="primary"
      action={
        kinds.length > 1 ? (
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            <FilterPill active={kind === "all"} onClick={() => setKind("all")}>
              {t("common.all")}
            </FilterPill>
            {kinds.map((k) => (
              <FilterPill key={k} active={kind === k} onClick={() => setKind(k)}>
                {REASON_KEY[k] ? t(REASON_KEY[k] as never) : k}
              </FilterPill>
            ))}
          </div>
        ) : undefined
      }
    >
      <Reveal>
        {similar.length === 0 ? (
          <Panel className="flex flex-col items-center justify-center p-8 text-center">
            <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 text-muted">
              <Sparkles className="h-5 w-5 opacity-40" />
            </span>
            <p className="text-sm font-bold text-muted">
              {intlLocale === "ar"
                ? "لا توجد ألعاب مشابهة مسجلة لهذه اللعبة حالياً"
                : "No similar games available for this title right now"}
            </p>
          </Panel>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {visible.map((pick, pickIdx) => {
              const reason =
                pick.reasons.find((r) => kind === "all" || r.kind === kind) ?? pick.reasons[0];
              return (
                <Link
                  key={`${pick.slug}-${pickIdx}`}
                  to={gamePath(pick.slug)}
                  className="group flex flex-col overflow-hidden rounded-panel border border-border/70 bg-muted/50 transition-all duration-200 hover:border-foreground/20 hover:bg-muted/60"
                >
                  <span className="relative aspect-[3/4] overflow-hidden bg-black/40">
                    <SmartImage
                      src={cdnImage(pick.coverUrl)}
                      alt={pick.title}
                      wrapperClassName="absolute inset-0"
                      className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    />
                    {pick.matchScore != null && (
                      <span className="absolute end-2 top-2 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-extrabold text-good backdrop-blur">
                        {Math.round(pick.matchScore * 100)}% {t("similar.match")}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-1 flex-col p-3">
                    <span className="line-clamp-2 text-xs font-extrabold leading-snug transition-colors group-hover:text-nin-soft">
                      {pick.title}
                    </span>
                    {reason && (
                      <span className="mt-1.5 line-clamp-2 flex-1 text-[10px] leading-relaxed muted">
                        {reason.text}
                      </span>
                    )}
                    <span className="mt-2 flex items-center justify-between gap-2">
                      {pick.price && (
                        <span className="num text-xs font-extrabold text-good">
                          {formatConverted(pick.price)}
                        </span>
                      )}
                      {pick.platforms?.[0] && (
                        <PlatformBadge platform={pick.platforms[0]} size="sm" />
                      )}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </Reveal>
    </Section>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors",
        active ? "bg-card text-foreground shadow-sm" : "bg-muted/50 muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Series                                                                     */
/* -------------------------------------------------------------------------- */

export function SeriesSection() {
  const { t, intlLocale } = useI18n();
  const { game } = useHub();
  const series = game.series;
  const [order, setOrder] = useState<"release" | "chronological">("release");

  if (!series || series.entries.length < 2) return null;

  const hasChronology = series.entries.every((entry) => entry.chronologicalOrder != null);

  const sorted = [...series.entries].sort((a, b) =>
    order === "chronological" && hasChronology
      ? (a.chronologicalOrder ?? 0) - (b.chronologicalOrder ?? 0)
      : (a.releaseOrder ?? 0) - (b.releaseOrder ?? 0),
  );

  return (
    <Section
      id="series"
      title={`${t("series.title")} — ${series.name}`}
      weight="support"
      action={
        hasChronology ? (
          <div className="flex gap-1.5">
            <FilterPill active={order === "release"} onClick={() => setOrder("release")}>
              {t("series.releaseOrder")}
            </FilterPill>
            <FilterPill
              active={order === "chronological"}
              onClick={() => setOrder("chronological")}
            >
              {t("series.chronologicalOrder")}
            </FilterPill>
          </div>
        ) : undefined
      }
    >
      <Reveal>
        <ol className="relative grid gap-3 sm:grid-cols-3">
          {sorted.map((entry, entryIdx) => {
            const current = entry.status === "current";
            const inner = (
              <>
                <SmartImage
                  src={cdnImage(entry.coverUrl)}
                  alt={entry.title}
                  wrapperClassName="h-20 w-16 shrink-0 rounded-lg"
                  className="h-full w-full object-cover"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-extrabold leading-snug">{entry.title}</span>
                  <span className="mt-1 block text-[10px] muted">
                    {formatMonthYear(entry.releaseDate, intlLocale)}
                  </span>
                  {current && (
                    <span className="mt-1.5 inline-block rounded-full bg-nin px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white">
                      {t("series.current")}
                    </span>
                  )}
                  {entry.status === "upcoming" && (
                    <span className="mt-1.5 inline-block rounded-full bg-warn/15 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-warn">
                      {t("series.upcoming")}
                    </span>
                  )}
                </span>
              </>
            );

            return (
              <li key={`${entry.slug}-${entryIdx}`}>
                {current ? (
                  <div className="flex gap-3 rounded-panel border border-nin/30 bg-nin/[0.08] p-3">
                    {inner}
                  </div>
                ) : (
                  <Link
                    to={gamePath(entry.slug)}
                    className="flex gap-3 rounded-panel border border-border/70 bg-muted/50 p-3 transition-colors hover:border-foreground/20 hover:bg-muted/60"
                  >
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </Reveal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Developer / publisher                                                      */
/* -------------------------------------------------------------------------- */

export function StudioSection() {
  const { t } = useI18n();
  const { game } = useHub();

  if (!game.developer && !game.publisher) return null;

  const samePublisher = game.developer?.id === game.publisher?.id;

  return (
    <Section id="studio" title={t("hero.developer")} weight="support">
      <Reveal>
        <div className="grid gap-3 sm:grid-cols-2">
          {game.developer && (
            <StudioCard
              icon={Code2}
              role={t("hero.developer")}
              name={game.developer.name}
              slug={game.developer.slug}
              linkLabel={t("studio.moreFromDeveloper", { name: game.developer.name })}
              kind="developer"
            />
          )}
          {game.publisher && !samePublisher && (
            <StudioCard
              icon={Building2}
              role={t("hero.publisher")}
              name={game.publisher.name}
              slug={game.publisher.slug}
              linkLabel={t("studio.moreFromPublisher", { name: game.publisher.name })}
              kind="publisher"
            />
          )}
        </div>
      </Reveal>
    </Section>
  );
}

function StudioCard({
  icon: Icon,
  role,
  name,
  slug,
  linkLabel,
  kind,
}: {
  icon: typeof Code2;
  role: string;
  name: string;
  slug?: string | undefined;
  linkLabel: string;
  kind: "developer" | "publisher";
}) {
  const body = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/70">
        <Icon className="h-4 w-4 text-nin-soft" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-wider muted">{role}</span>
        <span className="block truncate text-sm font-extrabold">{name}</span>
        <span className="mt-0.5 block truncate text-[11px] muted">{linkLabel}</span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 muted" />
    </>
  );

  // There is no studio page in this storefront, so the card stays a card —
  // better than a link that scrolls nowhere.
  void slug;
  return <Panel className="flex items-center gap-3 p-4">{body}</Panel>;
}

/* -------------------------------------------------------------------------- */
/* Complete your setup                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Accessories, framed by *why this game needs them* rather than as a generic
 * cross-sell — the storage entry exists because the download is 18.7 GB, and it
 * says so.
 */
export function SetupSection() {
  const { t } = useI18n();
  const { game } = useHub();
  const { formatConverted } = useCurrency();
  const accessories = game.accessories ?? [];

  if (accessories.length === 0) return null;

  return (
    <Section id="setup" title={t("setup.title")} subtitle={t("setup.subtitle")} weight="support">
      <Reveal>
        <div className="grid gap-3 sm:grid-cols-3">
          {accessories.map((item, accIdx) => (
            <Panel
              key={`${item.id || item.name}-${accIdx}`}
              interactive
              className="flex flex-col overflow-hidden"
            >
              <SmartImage
                src={cdnImage(item.imageUrl)}
                alt={item.name}
                wrapperClassName="aspect-[16/9] w-full"
                className="h-full w-full object-cover"
              />
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-extrabold leading-snug">{item.name}</h4>
                  {item.required && <Chip tone="warn">{t("common.required")}</Chip>}
                </div>
                {item.reason && (
                  <p className="mt-1.5 flex-1 text-[11px] leading-relaxed muted">
                    <span className="font-bold">{t("setup.whyNeeded")} </span>
                    {item.reason}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between gap-2">
                  {item.price && (
                    <span className="num text-sm font-extrabold text-good">
                      {formatConverted(item.price)}
                    </span>
                  )}
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-quiet h-8 px-3 text-[11px]"
                    >
                      {t("prices.goToStore")}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Personalised strip (used on the discover page and under the hub)           */
/* -------------------------------------------------------------------------- */

export function RecommendationStrip({
  items,
  title,
}: {
  items: Array<{ slug: string; title: string; coverUrl?: string; reason: string }>;
  title: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="py-8">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-extrabold">
        <Sparkles className="h-4 w-4 text-warn" />
        {title}
      </h2>
      <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
        {items.map((item, itemIdx) => (
          <Link
            key={`${item.slug}-${itemIdx}`}
            to={gamePath(item.slug)}
            className="group w-40 shrink-0 overflow-hidden rounded-panel border border-border/70 bg-muted/50 transition-colors hover:border-foreground/20"
          >
            <SmartImage
              src={cdnImage(item.coverUrl)}
              alt={item.title}
              wrapperClassName="aspect-[3/4] w-full"
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <span className="block p-3">
              <span className="line-clamp-2 text-xs font-extrabold">{item.title}</span>
              <span className="mt-1 line-clamp-2 block text-[10px] muted">{item.reason}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
