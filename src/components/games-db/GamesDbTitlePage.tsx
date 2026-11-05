/**
 * One title of the games database: everything Nintendo's index says about it,
 * and the one thing a visitor can do next — open the shop's page when the shop
 * sells it, or ask for it when it does not.
 *
 * Laid out like the shop's own game page (DESIGN.md): the wide key art only as
 * a blurred wash fading into the lit canvas, the box in a frame of clay, the
 * name, then the facts as pressed tiles. A fact Nintendo did not give is not
 * drawn — no «غير متوفر», no empty heading.
 *
 * No price anywhere. The shop's prices belong to its products, and a title it
 * does not sell has no price to show.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Building2,
  CalendarDays,
  Code,
  Gamepad2,
  HardDrive,
  Hash,
  Languages,
  Library,
  RotateCcw,
  ShieldCheck,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";

import AppShell from "@/components/AppShell";
import { useI18n } from "@/i18n";
import {
  PLATFORM_LABELS,
  genreId,
  genreLabel,
  languageLabel,
  seriesLabel,
  type GamesDbTitleResponse,
} from "@/lib/games-db";
import { cdnImage } from "@/lib/img";
import GamesDbRequestButton from "./GamesDbRequestButton";
import {
  ageRatingLabel,
  formatReleaseDate,
  isUpcoming,
  playersLabel,
  productIdFromPath,
} from "./gamesDbFormat";

/** The same fade the game page's hero uses: the art itself masked, never a band of page colour over it. */
const WASH_MASK = {
  maskImage: "linear-gradient(to bottom, #000 0%, rgb(0 0 0 / 0.55) 45%, transparent 92%)",
  WebkitMaskImage: "linear-gradient(to bottom, #000 0%, rgb(0 0 0 / 0.55) 45%, transparent 92%)",
} as const;

async function fetchTitle(slug: string, signal: AbortSignal): Promise<GamesDbTitleResponse> {
  const response = await fetch(`/api/games-db/${encodeURIComponent(slug)}`, { signal });
  // A 404 still carries the answer: whether the database is ready, and that the title is not in it.
  if (!response.ok && response.status !== 404) throw new Error(`games-db ${response.status}`);
  return (await response.json()) as GamesDbTitleResponse;
}

interface Fact {
  label: string;
  value: string;
  icon: LucideIcon;
}

export default function GamesDbTitlePage({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["games-db", "title", slug],
    queryFn: ({ signal }) => fetchTitle(slug, signal),
    staleTime: 10 * 60_000,
  });
  const title = data?.title ?? null;

  /* An old address (Nintendo renamed the game) is answered by its id; the URL is then put right. */
  useEffect(() => {
    if (title?.slug && title.slug !== slug) {
      void navigate({ to: "/games-db/$slug", params: { slug: title.slug }, replace: true });
    }
  }, [title?.slug, slug, navigate]);

  useEffect(() => {
    if (title) document.title = `${title.title} — ${t("قاعدة بيانات ألعاب نينتندو")} | بنانا ستور`;
  }, [title, t]);

  const back = () => void navigate({ to: "/games-db" });

  if (isPending) {
    return (
      <AppShell currentView="details" hideNav onBack={back}>
        <div className="mx-auto max-w-5xl space-y-4 p-4" aria-hidden="true">
          <div className="mx-auto aspect-square w-[min(60vw,250px)] animate-pulse rounded-[30px] bg-muted" />
          <div className="mx-auto h-6 w-2/3 animate-pulse rounded-full bg-muted" />
          <div className="mx-auto h-4 w-1/3 animate-pulse rounded-full bg-muted" />
          <div className="h-36 w-full animate-pulse rounded-[28px] bg-muted" />
        </div>
      </AppShell>
    );
  }

  if (isError || !data || !data.ready || !title) {
    const state = isError || !data ? "error" : !data.ready ? "preparing" : "missing";
    const copy = {
      error: [t("تعذّر تحميل اللعبة"), t("حدث خطأ أثناء الاتصال. حاول مرة أخرى.")],
      preparing: [t("نجهّز قاعدة البيانات"), t("نضيف كل ألعاب نينتندو الآن. عد بعد قليل.")],
      missing: [t("لم نجد هذه اللعبة"), t("ربما تغيّر رابطها. ابحث عنها في قاعدة البيانات.")],
    }[state];
    return (
      <AppShell currentView="details" hideNav onBack={back}>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
          <h1 className="text-lg font-black text-foreground">{copy[0]}</h1>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{copy[1]}</p>
          <button
            type="button"
            onClick={() => (state === "error" ? void refetch() : back())}
            className="mt-2 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--brand-red)] px-5 text-[13px] font-bold text-white shadow-md"
          >
            {state === "error" ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : null}
            {state === "error" ? t("أعد المحاولة") : t("ابحث في قاعدة البيانات")}
          </button>
        </div>
      </AppShell>
    );
  }

  const productId = productIdFromPath(data.shopPath);
  const upcoming = isUpcoming(title.releaseDate);
  const ageRating = ageRatingLabel(title.ageRating);
  const people = [title.publisher, title.developer !== title.publisher ? title.developer : ""]
    .filter(Boolean)
    .join(" · ");
  const art = title.images.box
    ? { src: cdnImage(title.images.box, { width: 600, trim: true }), square: false }
    : title.images.square
      ? { src: cdnImage(title.images.square, { width: 600 }), square: true }
      : null;

  const facts: Fact[] = [
    { label: t("الجهاز"), value: PLATFORM_LABELS[title.platform], icon: Gamepad2 },
    {
      label: upcoming ? t("موعد الإصدار") : t("تاريخ الإصدار"),
      value: formatReleaseDate(title.releaseDate),
      icon: CalendarDays,
    },
    { label: t("الناشر"), value: title.publisher, icon: Building2 },
    { label: t("المطوّر"), value: title.developer, icon: Code },
    { label: t("التصنيف العمري"), value: ageRating, icon: ShieldCheck },
    { label: t("عدد اللاعبين"), value: playersLabel(title.players), icon: Users },
    { label: t("الحجم"), value: title.size, icon: HardDrive },
    /*
      No «disc or digital» fact. Nintendo's flags for it are not dependable:
      on 2026-11-05 they called Tears of the Kingdom disc-only and Mario Kart
      World neither, and 917 titles carried no flag at all. A fact that is
      wrong for the biggest games is worse than none.
    */
    { label: t("رمز المنتج"), value: title.productCode, icon: Hash },
    { label: t("السلسلة"), value: title.series.map(seriesLabel).join("، "), icon: Library },
  ].filter((fact) => fact.value);

  return (
    <AppShell currentView="details" hideNav onBack={back}>
      <div className="clay-canvas relative min-h-screen pb-24">
        <header className="relative isolate overflow-hidden">
          {title.images.wide ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem] overflow-hidden sm:h-[30rem]"
            >
              <img
                src={cdnImage(title.images.wide, { width: 800 })}
                alt=""
                style={WASH_MASK}
                className="h-full w-full scale-125 object-cover opacity-50 blur-3xl saturate-150 dark:opacity-35"
              />
            </div>
          ) : null}

          <div className="mx-auto grid max-w-5xl gap-6 px-4 pb-2 pt-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-10 lg:pt-10">
            {art ? (
              <div className="mx-auto w-[min(60vw,250px)] lg:mx-0 lg:w-[300px]">
                {/* The art in a frame of clay; a hairline inside keeps bright art's edge. */}
                <div className="rounded-[30px] border border-[var(--clay-rim)] bg-card p-1.5 shadow-xl">
                  <div className="relative overflow-hidden rounded-[24px] bg-muted/40">
                    <img
                      src={art.src}
                      alt={title.title}
                      fetchPriority="high"
                      className={art.square ? "block aspect-square w-full object-cover" : "block h-auto w-full"}
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]"
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <div className="min-w-0 text-center lg:text-start">
              <div className="flex flex-wrap items-center justify-center gap-1.5 lg:justify-start">
                <span className="inline-flex h-7 items-center rounded-full bg-[var(--brand-red)] px-2.5 text-[11.5px] font-bold text-white">
                  {PLATFORM_LABELS[title.platform]}
                </span>
                {ageRating ? (
                  <span
                    dir="ltr"
                    className="inline-flex h-7 max-w-full items-center truncate rounded-full border border-border px-2.5 text-[11px] font-extrabold text-foreground"
                  >
                    {ageRating}
                  </span>
                ) : null}
                {upcoming ? (
                  <span className="inline-flex h-7 items-center rounded-full bg-muted/70 px-2.5 text-[11.5px] font-bold text-foreground">
                    {t("قريباً")}
                  </span>
                ) : null}
                {title.delisted ? (
                  <span className="inline-flex h-7 items-center rounded-full bg-muted/70 px-2.5 text-[11.5px] font-bold text-muted-foreground">
                    {t("أُزيلت من متجر نينتندو الرقمي")}
                  </span>
                ) : null}
              </div>

              <h1
                dir="auto"
                className="mt-3 text-[24px] font-black leading-[1.1] tracking-[-0.02em] text-balance text-foreground [overflow-wrap:anywhere] sm:text-[32px]"
              >
                {title.title}
              </h1>
              {people ? (
                <p dir="auto" className="mt-2 text-[13px] text-muted-foreground">
                  {people}
                </p>
              ) : null}
              {title.description ? (
                <p
                  dir="ltr"
                  lang="en"
                  className="mx-auto mt-3 max-w-xl text-[14px] leading-relaxed text-foreground/80 lg:mx-0"
                >
                  {title.description}
                </p>
              ) : null}

              {title.genres.length > 0 ? (
                <div className="mt-3.5 flex flex-wrap justify-center gap-1.5 lg:justify-start">
                  {title.genres.map((name) => (
                    <span
                      key={name}
                      className="inline-flex h-7 items-center rounded-full bg-muted/70 px-2.5 text-[11.5px] font-bold text-foreground"
                    >
                      {genreLabel(genreId(name), name)}
                    </span>
                  ))}
                </div>
              ) : null}

              {/* What a visitor can do next, in one piece of clay. */}
              <div className="mt-5 rounded-[28px] border border-[var(--clay-rim)] bg-card p-5 text-start shadow-lg">
                {productId ? (
                  <>
                    <p className="flex items-center gap-2 text-[15px] font-black text-foreground">
                      <Store className="h-5 w-5 shrink-0 text-[var(--brand-red)]" aria-hidden="true" />
                      {t("هذه اللعبة متوفرة في متجرنا")}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                      {t("الأسعار وطرق الشراء في صفحتها في المتجر.")}
                    </p>
                    <Link
                      to="/product/$productId"
                      params={{ productId }}
                      className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-[var(--brand-red)] text-[15px] font-black text-white shadow-md"
                    >
                      {t("اذهب إلى صفحة اللعبة")}
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="text-[15px] font-black text-foreground">{t("ليست في متجرنا بعد")}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                      {t("اطلبها، ويتابع فريقنا طلبك ويعلمك عند توفرها.")}
                    </p>
                    <div className="mt-4">
                      <GamesDbRequestButton
                        title={title.title}
                        euId={title.euId}
                        platform={title.platform}
                        euUrl={title.euUrl}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl space-y-4 px-4 pt-4">
          {facts.length > 0 ? (
            <Section title={t("معلومات اللعبة")}>
              {/* Facts as pressed tiles, two to a row even on a phone. */}
              <dl className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
                {facts.map((fact) => {
                  const Icon = fact.icon;
                  return (
                    <div key={fact.label} className="min-w-0 rounded-[18px] bg-muted/50 px-3.5 py-3 sm:px-4 sm:py-3.5">
                      <dt className="flex items-start gap-1.5 text-[12px] font-bold leading-snug text-muted-foreground">
                        <Icon className="mt-px h-4 w-4 shrink-0 text-[var(--brand-red)]" aria-hidden="true" />
                        {fact.label}
                      </dt>
                      <dd className="mt-1.5 text-[14px] font-bold leading-relaxed text-foreground [overflow-wrap:anywhere]">
                        <span dir="auto">{fact.value}</span>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </Section>
          ) : null}

          {title.languages.length > 0 ? (
            <Section title={t("اللغات")} icon={Languages}>
              <div className="flex flex-wrap gap-1.5">
                {title.languages.map((language) => (
                  <span
                    key={language}
                    className="rounded-full bg-muted/60 px-3 py-1 text-[12px] font-bold text-foreground"
                  >
                    {languageLabel(language)}
                  </span>
                ))}
              </div>
            </Section>
          ) : null}

          <p className="pt-2 text-center text-[11.5px] text-muted-foreground">
            {t("المعلومات والصور من فهرس Nintendo Europe الرسمي.")}
          </p>
        </main>
      </div>
    </AppShell>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <section className="rounded-[26px] border border-border bg-card p-4 shadow-md sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-black text-foreground">
        {Icon ? <Icon className="h-4 w-4 text-[var(--brand-red)]" aria-hidden="true" /> : null}
        {title}
      </h2>
      {children}
    </section>
  );
}
