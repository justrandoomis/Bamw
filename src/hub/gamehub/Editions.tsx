import { Check, Crown, Minus, Sparkles } from "lucide-react";
import { useHub } from "./hubContext";
import { Section } from "@/hub/ui/Section";
import { Panel } from "@/hub/ui/Panel";
import { Reveal } from "@/hub/ui/Bits";
import { useI18n } from "@/hub/i18n";
import { useCurrency } from "@/hub/context/CurrencyContext";
import { cn } from "@/hub/utils/cn";
import type { GameEdition } from "@/hub/types";

/**
 * Editions comparison.
 *
 * Presented as one matrix rather than three price cards: the question is "what
 * do I get for the extra money", and that is a comparison, not a set of
 * independent offers. Every content line appears in every column, so an
 * omission is visible instead of merely absent.
 */
export function EditionsSection() {
  const { t } = useI18n();
  const { game, openBuy } = useHub();
  const editions = game.editions ?? [];

  if (editions.length === 0) return null;

  // Union of every entitlement, keyed by id and in first-seen order. The label
  // shown is the one from the edition that lists it most plainly — the first.
  const rows: Array<{ id: string; label: string }> = [];
  for (const edition of editions) {
    for (const item of edition.contents) {
      if (!rows.some((row) => row.id === item.id)) rows.push({ id: item.id, label: item.label });
    }
  }

  return (
    <Section
      id="editions"
      eyebrow={t("editions.buyingGuide")}
      title={t("editions.title")}
      subtitle={t("editions.subtitle")}
      weight="primary"
    >
      {/* Desktop: matrix */}
      <Reveal className="hidden lg:block">
        <Panel className="overflow-hidden">
          <div
            className="grid"
            style={{ gridTemplateColumns: `minmax(180px, 1.4fr) repeat(${editions.length}, 1fr)` }}
          >
            <div className="border-b border-border/70 p-4" />
            {editions.map((edition, index) => (
              <EditionHeader
                key={`${edition.id || edition.name}-${index}`}
                edition={edition}
                onBuy={() => openBuy(edition.id)}
              />
            ))}

            {rows.map((row, rowIndex) => (
              <FragmentRow
                key={`${row.id || row.label}-${rowIndex}`}
                id={row.id}
                label={row.label}
                editions={editions}
                zebra={rowIndex % 2 === 1}
              />
            ))}
          </div>
        </Panel>
      </Reveal>

      {/* Mobile: stacked */}
      <div className="space-y-3 lg:hidden">
        {editions.map((edition, index) => (
          <Reveal key={`${edition.id || edition.name}-${index}`} delay={index * 60}>
            <Panel
              tone={edition.recommendation ? "accent" : "default"}
              className="overflow-hidden p-5"
            >
              <EditionTitle edition={edition} />
              <ul className="mt-4 space-y-1.5 text-xs">
                {edition.contents.map((item, itemIdx) => (
                  <li
                    key={`${item.id || item.label}-${itemIdx}`}
                    className={cn("flex items-start gap-2", !item.included && "muted")}
                  >
                    {item.included ? (
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
                    ) : (
                      <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-40" />
                    )}
                    <span className={cn(!item.included && "line-through decoration-white/20")}>
                      {item.label}
                      {item.note && (
                        <span className="block text-[11px] opacity-70">{item.note}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => openBuy(edition.id)}
                className={cn(
                  "btn mt-4 h-11 w-full text-xs",
                  edition.recommendation ? "btn-primary" : "btn-quiet",
                )}
              >
                {t("editions.choose")}
              </button>
            </Panel>
          </Reveal>
        ))}
      </div>

      {/* Recommendations — the "which should I buy" answer */}
      {editions.some((e) => e.recommendation) && (
        <Reveal delay={120}>
          <Panel className="mt-4 p-5 sm:p-6">
            <h3 className="mb-4 flex items-center gap-2 text-base font-extrabold">
              <Crown className="h-4 w-4 text-warn" />
              {t("editions.whichToBuy")}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {editions
                .filter((e) => e.recommendation)
                .map((edition, idx) => (
                  <div key={`${edition.id || edition.name}-${idx}`} className="inset p-4">
                    <p className="text-[11px] font-extrabold uppercase tracking-wider text-warn">
                      {recommendationLabel(edition.recommendation!.kind, t)}
                    </p>
                    <p className="mt-1 text-sm font-bold">{edition.name}</p>
                    <p className="mt-1.5 text-xs leading-relaxed muted">
                      {edition.recommendation!.reason}
                    </p>
                  </div>
                ))}
            </div>
          </Panel>
        </Reveal>
      )}
    </Section>
  );
}

function EditionHeader({ edition, onBuy }: { edition: GameEdition; onBuy: () => void }) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "border-b border-s border-border/70 p-4",
        edition.recommendation && "bg-nin/[0.07]",
      )}
    >
      <EditionTitle edition={edition} />
      <button
        onClick={onBuy}
        className={cn(
          "btn mt-3 h-9 w-full text-[11px]",
          edition.recommendation ? "btn-primary" : "btn-quiet",
        )}
      >
        {t("editions.choose")}
      </button>
    </div>
  );
}

function EditionTitle({ edition }: { edition: GameEdition }) {
  const { t } = useI18n();
  const { formatConverted } = useCurrency();
  return (
    <>
      {edition.recommendation && (
        <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-nin px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white">
          <Sparkles className="h-2.5 w-2.5" />
          {recommendationLabel(edition.recommendation.kind, t)}
        </span>
      )}
      <p className="text-sm font-extrabold leading-snug">{edition.name}</p>
      {edition.msrp && (
        <p className="num mt-1 text-lg font-extrabold text-good">{formatConverted(edition.msrp)}</p>
      )}
      {edition.description && <p className="mt-1 text-[11px] muted">{edition.description}</p>}
    </>
  );
}

function FragmentRow({
  id,
  label,
  editions,
  zebra,
}: {
  id: string;
  label: string;
  editions: GameEdition[];
  zebra: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          "flex items-center border-b border-border/70 px-4 py-2.5 text-xs font-semibold",
          zebra && "bg-muted/50",
        )}
      >
        {label}
      </div>
      {editions.map((edition, idx) => {
        const item = edition.contents.find((c) => c.id === id);
        return (
          <div
            key={`${edition.id || edition.name}-${idx}`}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 border-b border-s border-border/70 px-3 py-2.5",
              zebra && "bg-muted/50",
              edition.recommendation && "bg-nin/[0.04]",
            )}
            title={item?.note}
          >
            {item?.included ? (
              <Check className="h-4 w-4 text-good" />
            ) : (
              <Minus className="h-4 w-4 text-foreground/15" />
            )}
            {/* A qualifier only matters where the entitlement differs. */}
            {item?.included && item.note && (
              <span className="text-center text-[9px] leading-tight muted">{item.note}</span>
            )}
          </div>
        );
      })}
    </>
  );
}

function recommendationLabel(
  kind: NonNullable<GameEdition["recommendation"]>["kind"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (kind) {
    case "best-value":
      return t("editions.bestValue");
    case "best-for-collectors":
      return t("editions.bestForCollectors");
    case "best-for-digital":
      return t("editions.bestForDigital");
    case "best-for-switch2":
      return t("editions.bestForSwitch2");
  }
}
