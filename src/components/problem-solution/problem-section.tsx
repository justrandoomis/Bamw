"use client";

import { useState } from "react";
import { Reveal } from "@/components/motion/reveal";
import { SolutionSteps } from "./solution-steps";
import { ProblemFigure } from "./problem-figure";
import { ContentGallery } from "@/components/content/ContentGallery";
import { CATEGORY_MAP, type Problem, type ProblemImage } from "@/lib/problems/types";
import { highlight } from "@/lib/search/highlight";

/**
 * One problem, told as an editorial section rather than an accordion row.
 *
 * Desktop alternates sides between consecutive problems: the first shows text
 * on the left and image on the right, the second flips. Because the document is
 * RTL, column 1 is the right-hand column — the mapping below is written in
 * visual terms, not DOM order.
 *
 * Below `lg` the grid collapses to a single column and the DOM order takes
 * over: title → image → explanation → steps.
 */
export function ProblemSection({
  problem,
  index,
  onOpenImage,
  matchedTokens = [],
  isTargeted = false,
}: {
  problem: Problem;
  index: number;
  onOpenImage: (image: ProblemImage) => void;
  matchedTokens?: string[];
  isTargeted?: boolean;
}) {
  const category = CATEGORY_MAP[problem.category];
  const imageOnRight = index % 2 === 0;

  const textCol = imageOnRight ? "lg:col-start-2" : "lg:col-start-1";
  const mediaCol = imageOnRight ? "lg:col-start-1" : "lg:col-start-2";

  return (
    <section
      id={problem.id}
      aria-labelledby={`${problem.id}-title`}
      data-targeted={isTargeted || undefined}
      // The global scroll offset only clears the site header. On this page the
      // search bar is also sticky, so a deep link needs to clear both.
      className="relative scroll-mt-36 rounded-card px-1 py-8 transition-shadow duration-500 data-[targeted]:shadow-[0_0_0_4px_var(--color-primary)] sm:scroll-mt-40 sm:px-2 sm:py-12"
    >
      <div className="grid gap-6 lg:grid-cols-2 lg:items-center lg:gap-12">
        {/* ── Header ───────────────────────────────────────────────── */}
        <Reveal className={`${textCol} lg:row-start-1 lg:self-end`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-primary/50 bg-primary/20 px-3 py-1 text-sm font-bold text-muted-foreground">
              <span aria-hidden>{category.emoji}</span>
              {category.label}
            </span>
            <code className="ltr rounded-pill border border-border bg-card px-2.5 py-1 font-mono text-xs text-muted-foreground">
              {problem.id}
            </code>
            <CopyLinkButton problemId={problem.id} />
          </div>

          <h3
            id={`${problem.id}-title`}
            className="text-2xl leading-tight font-extrabold text-balance text-foreground sm:text-3xl"
            suppressHydrationWarning
          >
            <span aria-hidden className="ml-2">
              {problem.emoji}
            </span>
            {highlight(problem.title, matchedTokens)}
          </h3>

          <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">
            {problem.description}
          </p>
        </Reveal>

        {/* ── Media ────────────────────────────────────────────────── */}
        <div className={`${mediaCol} space-y-4 lg:row-span-2 lg:row-start-1 lg:self-center`}>
          {problem.images.map((image, imageIndex) => (
            <Reveal key={image.src} variant="zoom" delay={120 + imageIndex * 90}>
              <ProblemFigure image={image} onOpen={onOpenImage} />
            </Reveal>
          ))}

          {/*
            The screenshots the shop owner uploads, beside the illustrations
            committed to this repository. Renders nothing at all while the
            slots are empty, which is the state every problem starts in.
          */}
          <ContentGallery images={problem.slots} />
        </div>

        {/* ── Explanation + solution ───────────────────────────────── */}
        <div className={`${textCol} lg:row-start-2 lg:self-start`}>
          <Reveal delay={90}>
            <div className="rounded-2xl border border-border bg-card/80 p-4 sm:p-5">
              <h4 className="flex items-center gap-2 text-base font-extrabold text-foreground">
                <span aria-hidden>🤔</span>
                لماذا تحدث؟
              </h4>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-muted-foreground">
                {problem.cause}
              </p>
            </div>
          </Reveal>

          <Reveal delay={140} className="mt-6 mb-3">
            <h4 className="flex items-center gap-2 text-lg font-extrabold text-foreground">
              <span aria-hidden>🛠️</span>
              الحل خطوة بخطوة
            </h4>
          </Reveal>

          <SolutionSteps steps={problem.steps} baseDelay={170} />

          {/*
            What not to do, and when to stop.

            Every one of these entries has an action that makes the situation
            unrecoverable — deleting the user, pressing "Forgot your password",
            retrying a wrong password until the account locks. Listing the fix
            without listing those leaves the customer to find them.
          */}
          {(problem.avoid?.length ?? 0) > 0 && (
            <Reveal delay={200} className="mt-5">
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
                <h4 className="flex items-center gap-2 text-base font-extrabold text-foreground">
                  <span aria-hidden>⛔</span>
                  ما لا يجب فعله
                </h4>
                <ul className="mt-2 list-disc space-y-1 ps-5 text-[0.95rem] leading-relaxed text-muted-foreground">
                  {problem.avoid!.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </Reveal>
          )}

          {problem.contactAdminWhen && (
            <Reveal delay={210} className="mt-4">
              <p className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-[0.95rem] leading-relaxed text-foreground">
                <span className="font-extrabold">متى تتواصل معنا: </span>
                {problem.contactAdminWhen}
              </p>
            </Reveal>
          )}

          {problem.relatedErrors.length > 0 && (
            <Reveal delay={220} className="mt-5">
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="font-semibold text-muted-foreground">أكواد مرتبطة:</span>
                {problem.relatedErrors.map((code) => (
                  <code
                    key={code}
                    className="ltr rounded-pill border border-border bg-card px-2.5 py-1 font-mono text-xs text-muted-foreground"
                  >
                    {code}
                  </code>
                ))}
              </p>
            </Reveal>
          )}
        </div>
      </div>

      <div aria-hidden className="bn-divider mt-10" />
    </section>
  );
}

/** Copies the deep link to this exact problem. */
function CopyLinkButton({ problemId }: { problemId: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${problemId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard can be blocked (insecure context, denied permission).
      // Falling back to the hash still gives the user a shareable URL.
      window.location.hash = problemId;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-pill border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      >
        <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
        <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
      </svg>
      {copied ? "تم النسخ" : "نسخ الرابط"}
      <span className="sr-only"> لهذه المشكلة</span>
    </button>
  );
}
