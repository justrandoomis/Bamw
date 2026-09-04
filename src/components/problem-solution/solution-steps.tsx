"use client";

import { Reveal } from "@/components/motion/reveal";
import type { SolutionStep } from "@/lib/problems/types";
import { ContentGallery } from "@/components/content/ContentGallery";

/**
 * The numbered solution. Each step reveals as it enters the viewport, with a
 * small stagger so the list reads as a sequence rather than appearing at once.
 */
export function SolutionSteps({
  steps,
  baseDelay = 0,
}: {
  steps: SolutionStep[];
  baseDelay?: number;
}) {
  return (
    <ol className="relative m-0 list-none space-y-3 p-0">
      {steps.map((step, index) => (
        <Reveal
          as="li"
          key={step.title}
          delay={baseDelay + index * 70}
          className="relative flex gap-4 rounded-2xl border border-transparent bg-card/70 p-3 transition-colors duration-300 hover:border-border hover:bg-card sm:p-4"
        >
          {/* Number tile + connector to the next step */}
          <div className="relative flex flex-col items-center">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-primary/80 bg-primary font-display text-base font-extrabold text-foreground shadow-soft">
              {String(index + 1).padStart(2, "0")}
            </span>
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className="mt-1 w-0.5 flex-1 rounded-full bg-[repeating-linear-gradient(to_bottom,var(--color-primary)_0_6px,transparent_6px_12px)]"
              />
            )}
          </div>

          <div className="min-w-0 flex-1 pt-1 pb-1">
            <h4 className="text-base leading-snug font-bold text-foreground sm:text-lg">
              {step.title}
            </h4>
            {step.detail && (
              <p className="mt-1.5 text-[0.95rem] leading-relaxed text-muted-foreground">
                {step.detail}
              </p>
            )}
            {/* Empty until the shop owner uploads the screenshot; then a figure. */}
            <ContentGallery images={step.slots} />

            {step.hint && (
              <p className="mt-2.5 flex gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                <span aria-hidden className="shrink-0">
                  🍌
                </span>
                <span>
                  <span className="font-bold">ملاحظة: </span>
                  {step.hint}
                </span>
              </p>
            )}
          </div>
        </Reveal>
      ))}
    </ol>
  );
}
