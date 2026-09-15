import { useEffect, useMemo } from "react";
import type { Game } from "@/hub/types";
import { HubShell } from "./HubShell";
import { Hero } from "./Hero";
import { HubNav, StickyBuyBar, type NavItem } from "./Chrome";
import { hasOverviewFacts, GlanceSection, FitSection } from "./Overview";
import { PricesSection } from "./Prices";
import {
  LanguagesSection,
  MultiplayerSection,
  NintendoSection,
  PerformanceSection,
  StorageSection,
  Switch2Section,
  SourcesSection,
} from "./Nintendo";
import { EditionsSection } from "./Editions";
import { FeaturesSection, GameplaySection, StorySection } from "./Narrative";
import { GallerySection, VideosSection } from "./Media";
import { CompletionSection, DlcSection, GuidesSection } from "./Extras";
import { CommunitySection, ReviewsSection, VerdictSection } from "./Social";
import { SeriesSection, SetupSection, SimilarGamesSection, StudioSection } from "./Discovery";
import { PatchNotesSection, SoundtrackSection, TimelineSection } from "./History";
import { DataSourcesNote, FaqSection, FinalCta, PurchaseSection } from "./Closing";
import { useI18n } from "@/hub/i18n";
import {
  applySeo,
  buildBreadcrumbJsonLd,
  buildFaqJsonLd,
  buildProductJsonLd,
  buildVideoJsonLd,
  gamePath,
} from "@/hub/utils/seo";

/**
 * The game hub.
 *
 * Section order encodes the stated priority — price and purchase first, then
 * Nintendo, then the essentials, gameplay, reference detail, guides, community,
 * reviews and finally discovery. Every section returns `null` when its data is
 * absent, so a sparse record shortens the page instead of filling it with empty
 * panels.
 */
export function GameHub({
  game,
  onNavigateGuide,
}: {
  game: Game;
  onNavigateGuide?: ((slug: string) => void) | undefined;
}) {
  const { t, ogLocale } = useI18n();

  const navItems = useMemo(() => buildNavItems(game, t), [game, t]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [game.slug]);

  useEffect(() => {
    const title = [game.title, game.subtitle].filter(Boolean).join(": ");
    applySeo({
      title: `${title} — ${t("common.brand")}`,
      description:
        game.tagline ??
        game.description?.slice(0, 155) ??
        `${title}: prices, editions, guides and reviews.`,
      canonicalPath: gamePath(game.slug),
      ...((game.keyArtUrl ?? game.coverUrl)
        ? { imageUrl: (game.keyArtUrl ?? game.coverUrl) as string }
        : {}),
      type: "product",
      locale: ogLocale,
      jsonLd: [
        buildProductJsonLd(game),
        buildFaqJsonLd(game),
        buildBreadcrumbJsonLd([
          { name: t("nav.home"), path: "/" },
          { name: t("nav.games"), path: "/games" },
          { name: game.title, path: gamePath(game.slug) },
        ]),
        ...buildVideoJsonLd(game),
      ].filter(Boolean) as object[],
    });
  }, [game, t, ogLocale]);

  return (
    <HubShell game={game} onNavigateGuide={onNavigateGuide}>
      <article>
        <Hero />
        <HubNav items={navItems} />

        <div className="mx-auto max-w-6xl px-4 lg:px-6">
          {/* 1 — Nintendo: the platform this storefront exists for. */}
          <NintendoSection />
          <Switch2Section />
          <PerformanceSection />

          {/* 2 — Essentials: everything you need to know, before the money talk. */}
          <GlanceSection />
          <FitSection />

          {/* 3 — Where to buy it: reads better once the game itself is known. */}
          <PricesSection />

          <EditionsSection />

          {/* 4 — Gameplay & content. */}
          <GameplaySection />
          <StorySection />
          <VideosSection />
          <GallerySection />
          <FeaturesSection />

          {/* 5 — Reference detail. */}
          <StorageSection />
          <LanguagesSection />
          <MultiplayerSection />

          {/* 6 — Extras & help. */}
          <DlcSection />
          <GuidesSection />
          <CompletionSection />
          <FaqSection />
          <PurchaseSection />

          {/* 7 — Verdict, community, reviews. */}
          <VerdictSection />
          <CommunitySection />
          <ReviewsSection />

          {/* 8 — Post-launch history. */}
          <TimelineSection />
          <PatchNotesSection />
          <SoundtrackSection />

          {/* 9 — Discovery. */}
          <SimilarGamesSection />
          <SeriesSection />
          <StudioSection />
          <SetupSection />

          <FinalCta />
          <SourcesSection />
        </div>

        <StickyBuyBar />
      </article>
    </HubShell>
  );
}

/**
 * Nav entries for sections that will actually render.
 *
 * Each entry names its own condition, so a section hidden for lack of data
 * never leaves behind a link that scrolls nowhere.
 */
function buildNavItems(game: Game, t: ReturnType<typeof useI18n>["t"]): NavItem[] {
  const candidates: Array<[boolean, NavItem]> = [
    [
      (game.offers?.length ?? 0) > 0 || Boolean(game.priceHistory?.length),
      { id: "prices", label: t("nav.prices") },
    ],
    [Boolean(game.nintendo), { id: "nintendo", label: t("nav.nintendo") }],
    [Boolean(game.nintendo?.switch2Enhanced?.available), { id: "switch2", label: "2 Switch" }],
    [
      (game.performance?.length ?? 0) > 0 || Boolean(game.nintendo?.runsOn.includes("switch2")),
      { id: "performance", label: t("performance.title") },
    ],
    /*
      Was `true`. The section drops itself when the game has no facts to show —
      which is now most of the catalogue — and a chip that scrolls to a section
      that is not there is the exact failure the comment above this list
      promises cannot happen.
    */
    [hasOverviewFacts(game), { id: "overview", label: t("nav.overview") }],
    [(game.editions?.length ?? 0) > 0, { id: "editions", label: t("nav.editions") }],
    [(game.gameplayPillars?.length ?? 0) > 0, { id: "gameplay", label: t("nav.gameplay") }],
    [(game.story?.length ?? 0) > 0, { id: "story", label: t("nav.story") }],
    [(game.videos?.length ?? 0) > 0, { id: "videos", label: t("media.title") }],
    [(game.dlc?.length ?? 0) > 0, { id: "dlc", label: t("nav.dlc") }],
    [(game.guides?.length ?? 0) > 0, { id: "guides", label: t("nav.guides") }],
    [(game.faq?.length ?? 0) > 0, { id: "faq", label: t("faq.title") }],
    [Boolean(game.verdict), { id: "verdict", label: t("verdict.title") }],
    [(game.community?.length ?? 0) > 0, { id: "community", label: t("nav.community") }],
    [
      Boolean(game.reviewSummary) || (game.reviews?.length ?? 0) > 0,
      { id: "reviews", label: t("nav.reviews") },
    ],
    [(game.timeline?.length ?? 0) > 0, { id: "timeline", label: t("timeline.title") }],
    [(game.similar?.length ?? 0) > 0, { id: "similar", label: t("similar.title") }],
    [Boolean(game.series), { id: "series", label: t("series.title") }],
    [(game.dataSources?.length ?? 0) > 0, { id: "sources", label: t("sources.title") }],
  ];

  return candidates.filter(([include]) => include).map(([, item]) => item);
}
