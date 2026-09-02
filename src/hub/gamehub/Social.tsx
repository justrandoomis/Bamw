import { useMemo, useState } from "react";
import {
  Award,
  BadgeCheck,
  CheckCircle2,
  MessageSquare,
  PenLine,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { useHub } from "./hubContext";
import { Section, Seam } from "@/hub/ui/Section";
import { Panel } from "@/hub/ui/Panel";
import { Chip, CountUp, RatingStars, Reveal, ScoreBar, Segmented } from "@/hub/ui/Bits";
import { useI18n } from "@/hub/i18n";
import { useNotifications } from "@/hub/context/NotificationContext";
import { formatCount, formatDate, formatPercent, formatRelativeTime } from "@/hub/utils/format";
import { cn } from "@/hub/utils/cn";
import type { CommunityKind, CommunityPost, ReviewAspect, UserReview } from "@/hub/types";
import { ReviewComposer } from "./ReviewComposer";

/* -------------------------------------------------------------------------- */
/* Editorial verdict                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The platform's own assessment.
 *
 * Placed immediately before user reviews so the two read as a pair, and built
 * around "who should buy / who should skip" rather than a number — a score
 * alone tells nobody whether the game is for them.
 */
export function VerdictSection() {
  const { t, intlLocale } = useI18n();
  const { game } = useHub();
  const verdict = game.verdict;

  if (!verdict) return null;

  const scoreRows: Array<{ key: keyof typeof verdict.scores; label: string }> = [
    { key: "gameplay", label: t("verdict.gameplay") },
    { key: "story", label: t("verdict.story") },
    { key: "graphics", label: t("verdict.graphics") },
    { key: "performance", label: t("verdict.performance") },
    { key: "value", label: t("verdict.value") },
    { key: "nintendo", label: t("verdict.nintendo") },
  ];

  return (
    <Section
      id="verdict"
      eyebrow={t("verdict.subtitle")}
      title={t("verdict.title")}
      weight="primary"
    >
      <Reveal>
        <Panel className="overflow-hidden">
          <div className="grid lg:grid-cols-[auto_1fr]">
            {/* Score block */}
            <div className="flex flex-col items-center justify-center gap-2 bg-[linear-gradient(150deg,rgba(230,0,18,0.14),transparent)] p-6 lg:w-64 lg:p-8">
              <span className="eyebrow">{t("verdict.overall")}</span>
              <span className="text-6xl font-extrabold leading-none tracking-tight">
                <CountUp value={verdict.overall} decimals={1} />
              </span>
              {verdict.headline && (
                <p className="mt-1 text-center text-xs font-bold text-balance">
                  {verdict.headline}
                </p>
              )}
              {verdict.author && (
                <p className="mt-2 flex items-center gap-1.5 text-[10px] muted">
                  <Award className="h-3 w-3" />
                  {verdict.author.name}
                </p>
              )}
            </div>

            <div className="p-6 sm:p-8">
              {verdict.summary && (
                <p className="max-w-prose text-sm leading-[1.8] muted">{verdict.summary}</p>
              )}

              {Object.keys(verdict.scores).length > 0 && (
                <>
                  <Seam className="my-5" />
                  <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                    {scoreRows
                      .filter((row) => verdict.scores[row.key] != null)
                      .map((row, index) => (
                        <ScoreBar
                          key={row.key}
                          label={row.label}
                          value={verdict.scores[row.key]!}
                          delay={index * 70}
                        />
                      ))}
                  </div>
                </>
              )}

              <Seam className="my-5" />

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-good">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t("verdict.buyIf")}
                  </p>
                  <ul className="space-y-1.5 text-xs leading-relaxed muted">
                    {verdict.buyIf.map((line, lineIdx) => (
                      <li key={`${line}-${lineIdx}`} className="flex gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-good" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-warn">
                    <XCircle className="h-3.5 w-3.5" />
                    {t("verdict.skipIf")}
                  </p>
                  <ul className="space-y-1.5 text-xs leading-relaxed muted">
                    {verdict.skipIf.map((line, lineIdx) => (
                      <li key={`${line}-${lineIdx}`} className="flex gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warn" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {verdict.updatedAt && (
                <p className="mt-5 text-[10px] muted">
                  {t("common.updated")} {formatDate(verdict.updatedAt, intlLocale)}
                </p>
              )}
            </div>
          </div>
        </Panel>
      </Reveal>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Player reviews                                                             */
/* -------------------------------------------------------------------------- */

type ReviewSort = "helpful" | "newest" | "highest" | "lowest";

export function ReviewsSection() {
  const { t, intlLocale } = useI18n();
  const { game } = useHub();
  const [sort, setSort] = useState<ReviewSort>("helpful");
  const [composerOpen, setComposerOpen] = useState(false);
  // Reviews written in-session sit alongside the loaded set until a backend
  // accepts them.
  const [drafts, setDrafts] = useState<UserReview[]>([]);

  const summary = game.reviewSummary;
  const reviews = useMemo(() => [...drafts, ...(game.reviews ?? [])], [drafts, game.reviews]);

  const sorted = useMemo(() => {
    const list = [...reviews];
    switch (sort) {
      case "newest":
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case "highest":
        list.sort((a, b) => b.rating - a.rating);
        break;
      case "lowest":
        list.sort((a, b) => a.rating - b.rating);
        break;
      default:
        list.sort((a, b) => (b.helpfulCount ?? 0) - (a.helpfulCount ?? 0));
    }
    return list;
  }, [reviews, sort]);

  if (!summary && reviews.length === 0 && drafts.length === 0) return null;

  const aspectRows: Array<{ key: ReviewAspect; label: string }> = [
    { key: "story", label: t("verdict.story") },
    { key: "gameplay", label: t("verdict.gameplay") },
    { key: "graphics", label: t("verdict.graphics") },
    { key: "performance", label: t("verdict.performance") },
    { key: "value", label: t("verdict.value") },
    { key: "replayability", label: t("similar.match") },
  ];

  return (
    <Section
      id="reviews"
      title={t("reviews.title")}
      subtitle={t("reviews.subtitle")}
      weight="primary"
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {reviews.length > 1 && (
            <Segmented<ReviewSort>
              size="sm"
              value={sort}
              onChange={setSort}
              ariaLabel={t("common.filter")}
              options={[
                { id: "helpful", label: t("reviews.filterHelpful") },
                { id: "newest", label: t("reviews.filterNewest") },
                { id: "highest", label: t("reviews.filterHighest") },
                { id: "lowest", label: t("reviews.filterLowest") },
              ]}
            />
          )}
          <button
            onClick={() => setComposerOpen(true)}
            className="btn btn-quiet h-9 shrink-0 px-3.5 text-xs"
          >
            <PenLine className="h-3.5 w-3.5" />
            {t("reviews.writeReview")}
          </button>
        </div>
      }
    >
      {summary && (
        <Reveal>
          <Panel className="mb-3 p-5 sm:p-6">
            <div className="grid gap-6 lg:grid-cols-[auto_1fr_1.2fr] lg:items-center">
              <div className="text-center lg:text-start">
                <div className="flex items-baseline justify-center gap-1 lg:justify-start">
                  <span className="text-5xl font-extrabold leading-none">
                    <CountUp value={summary.average} decimals={1} />
                  </span>
                  <span className="text-lg muted">/ 5</span>
                </div>
                <div className="mt-2 flex justify-center lg:justify-start">
                  <RatingStars value={summary.average} />
                </div>
                <p className="mt-1.5 text-[11px] muted">
                  {formatCount(summary.total, intlLocale)} {t("reviews.total").toLowerCase()}
                </p>
              </div>

              {summary.distribution && (
                <div className="space-y-1">
                  {(["5", "4", "3", "2", "1"] as const).map((bucket) => {
                    const count = summary.distribution?.[bucket] ?? 0;
                    const pct = summary.total > 0 ? count / summary.total : 0;
                    return (
                      <div key={bucket} className="flex items-center gap-2 text-[11px]">
                        <span className="w-3 tabular-nums muted">{bucket}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                          <span
                            className="block h-full rounded-full bg-warn/70"
                            style={{ width: `${pct * 100}%` }}
                          />
                        </span>
                        <span className="w-10 text-end tabular-nums muted">
                          {formatPercent(pct, intlLocale)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="space-y-2.5">
                {summary.recommendedPercent != null && (
                  <p className="text-sm">
                    <b className="text-good">{summary.recommendedPercent}%</b>{" "}
                    <span className="muted">{t("reviews.recommended")}</span>
                  </p>
                )}
                {summary.aspectAverages && (
                  <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    {aspectRows
                      .filter((row) => summary.aspectAverages?.[row.key] != null)
                      .map((row, index) => (
                        <ScoreBar
                          key={row.key}
                          label={row.label}
                          value={summary.aspectAverages![row.key]!}
                          max={5}
                          delay={index * 60}
                        />
                      ))}
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </Reveal>
      )}

      {sorted.length === 0 ? (
        <p className="rounded-2xl bg-white/[0.03] p-6 text-center text-sm muted">
          {t("reviews.noReviews")}
        </p>
      ) : (
        <div className="space-y-2">
          {sorted.map((review, index) => (
            <Reveal key={review.id} delay={Math.min(index, 4) * 50}>
              <ReviewCard review={review} />
            </Reveal>
          ))}
        </div>
      )}

      <ReviewComposer
        open={composerOpen}
        gameTitle={game.title}
        gameSlug={game.slug}
        onClose={() => setComposerOpen(false)}
        onSubmit={(review) => setDrafts((current) => [review, ...current])}
      />
    </Section>
  );
}

function ReviewCard({ review }: { review: UserReview }) {
  const { t, intlLocale } = useI18n();
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-xs font-extrabold">
            {review.author.name.charAt(0)}
          </span>
          <span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold">{review.author.name}</span>
              {review.verifiedPurchase && (
                <span className="inline-flex items-center gap-1 rounded-full bg-good/12 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-good">
                  <BadgeCheck className="h-2.5 w-2.5" />
                  {t("reviews.verifiedPurchase")}
                </span>
              )}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] muted">
              <RatingStars value={review.rating} />
              <span>{formatRelativeTime(review.createdAt, intlLocale)}</span>
              {review.playTimeHours != null && (
                <span>
                  · {review.playTimeHours} {t("common.hours")}
                </span>
              )}
            </span>
          </span>
        </div>
        {review.recommended != null && (
          <Chip tone={review.recommended ? "good" : "muted"}>
            {review.recommended ? (
              <ThumbsUp className="h-3 w-3" />
            ) : (
              <ThumbsDown className="h-3 w-3" />
            )}
            {review.recommended ? t("common.yes") : t("common.no")}
          </Chip>
        )}
      </div>

      {review.title && <h4 className="mt-3 text-sm font-extrabold">{review.title}</h4>}
      <p className="mt-1.5 text-sm leading-[1.75] muted">{review.body}</p>

      {review.helpfulCount != null && (
        <p className="mt-3 text-[11px] muted">
          {review.helpfulCount} · {t("reviews.helpful")}
        </p>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Community                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Community threads.
 *
 * Votes and new posts are held in component state here; every mutation is
 * funnelled through one handler so wiring it to an API is a single change.
 */
export function CommunitySection() {
  const { t, intlLocale } = useI18n();
  const { game } = useHub();
  const { addNotification } = useNotifications();

  const [posts, setPosts] = useState<CommunityPost[]>(game.community ?? []);
  const [votes, setVotes] = useState<Record<string, 1 | -1>>({});
  const [tab, setTab] = useState<CommunityKind | "all">("all");
  const [draft, setDraft] = useState("");

  const counts = useMemo(
    () => ({
      question: posts.filter((p) => p.kind === "question").length,
      tip: posts.filter((p) => p.kind === "tip").length,
      discussion: posts.filter((p) => p.kind === "discussion").length,
    }),
    [posts],
  );

  if ((game.community ?? []).length === 0 && posts.length === 0) return null;

  const visible = tab === "all" ? posts : posts.filter((p) => p.kind === tab);

  const vote = (id: string, direction: 1 | -1) => {
    setVotes((current) => {
      const existing = current[id];
      const next = { ...current };
      if (existing === direction) delete next[id];
      else next[id] = direction;
      return next;
    });
  };

  const submit = () => {
    const body = draft.trim();
    if (body.length < 4) return;
    const post: CommunityPost = {
      id: `local_${Date.now()}`,
      kind: "question",
      title: body.length > 80 ? `${body.slice(0, 77)}…` : body,
      body,
      author: { id: "me", name: t("common.yes") === "نعم" ? "أنت" : "You" },
      createdAt: new Date().toISOString(),
      upvotes: 0,
      downvotes: 0,
      answerCount: 0,
    };
    setPosts((current) => [post, ...current]);
    setDraft("");
    addNotification({ title: t("community.post"), message: post.title, type: "success" });
  };

  return (
    <Section
      id="community"
      title={t("community.title")}
      subtitle={t("community.subtitle")}
      weight="primary"
      action={
        <Segmented<CommunityKind | "all">
          size="sm"
          value={tab}
          onChange={setTab}
          ariaLabel={t("community.title")}
          options={[
            { id: "all" as const, label: t("common.all"), count: posts.length },
            { id: "question" as const, label: t("community.questions"), count: counts.question },
            { id: "tip" as const, label: t("community.tips"), count: counts.tip },
            {
              id: "discussion" as const,
              label: t("community.discussions"),
              count: counts.discussion,
            },
          ]}
        />
      }
    >
      <Reveal>
        <Panel className="mb-3 flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submit()}
            placeholder={t("community.placeholder")}
            className="h-11 flex-1 rounded-xl border border-white/[0.08] bg-black/25 px-4 text-sm outline-none transition-colors placeholder:text-white/30 focus:border-nin/50"
          />
          <button onClick={submit} className="btn btn-primary h-11 px-5 text-xs">
            <MessageSquare className="h-4 w-4" />
            {t("community.ask")}
          </button>
        </Panel>
      </Reveal>

      {visible.length === 0 ? (
        <p className="rounded-2xl bg-white/[0.03] p-6 text-center text-sm muted">
          {t("community.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((post, index) => {
            const myVote = votes[post.id];
            const score = post.upvotes - post.downvotes + (myVote ?? 0);
            return (
              <Reveal key={post.id} delay={Math.min(index, 4) * 50}>
                <Panel interactive className="flex gap-4 p-5">
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <button
                      onClick={() => vote(post.id, 1)}
                      aria-label={t("community.upvote")}
                      aria-pressed={myVote === 1}
                      className={cn(
                        "rounded-lg p-1.5 transition-colors",
                        myVote === 1 ? "bg-good/15 text-good" : "muted hover:bg-white/[0.06]",
                      )}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-xs font-extrabold tabular-nums">{score}</span>
                    <button
                      onClick={() => vote(post.id, -1)}
                      aria-label={t("community.downvote")}
                      aria-pressed={myVote === -1}
                      className={cn(
                        "rounded-lg p-1.5 transition-colors",
                        myVote === -1 ? "bg-warn/15 text-warn" : "muted hover:bg-white/[0.06]",
                      )}
                    >
                      <ThumbsDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={post.kind === "tip" ? "good" : "default"}>
                        {t(
                          post.kind === "question"
                            ? "community.questions"
                            : post.kind === "tip"
                              ? "community.tips"
                              : post.kind === "guide"
                                ? "community.guidesTab"
                                : "community.discussions",
                        )}
                      </Chip>
                      {post.resolved && (
                        <Chip tone="good" icon={CheckCircle2}>
                          {t("community.resolved")}
                        </Chip>
                      )}
                    </div>
                    <h4 className="mt-2 text-sm font-extrabold leading-snug">{post.title}</h4>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed muted">{post.body}</p>
                    <p className="mt-2.5 flex flex-wrap items-center gap-x-3 text-[10px] muted">
                      <span className="font-semibold">{post.author.name}</span>
                      <span>{formatRelativeTime(post.createdAt, intlLocale)}</span>
                      <span className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        {t("community.answers", { count: post.answerCount })}
                      </span>
                    </p>
                  </div>
                </Panel>
              </Reveal>
            );
          })}
        </div>
      )}
    </Section>
  );
}
