import type { ReactNode } from "react";

/**
 * A details section that refuses to render when it has nothing to show.
 *
 * Emptiness is decided here rather than at every call site, so "don't show
 * empty sections" holds by construction: pass `when` (usually an array's
 * length) and a section with no data disappears entirely — heading included.
 */
export function Section({
  id,
  title,
  when = true,
  children,
}: {
  id: string;
  title: string;
  when?: boolean | number | undefined | null;
  children: ReactNode;
}) {
  const hasContent = typeof when === "number" ? when > 0 : Boolean(when);
  if (!hasContent) return null;

  /*
    Each section is a piece of clay of its own rather than a band between two
    hairlines: the page reads as a stack of cards, the same as everywhere else
    in the shop.
  */
  return (
    <section id={id} className="scroll-mt-24 pt-4">
      <div className="rounded-[24px] border border-[var(--clay-rim)] bg-card p-5 shadow-md sm:p-6">
        <h2 className="mb-4 text-[18px] font-black tracking-[-0.02em] text-foreground sm:text-[20px]">
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

/** Two-column key/value rows that collapse to stacked pairs on narrow screens. */
export function SpecTable({
  rows,
}: {
  rows: { label: string; value: string; unit?: string; note?: string }[];
}) {
  if (rows.length === 0) return null;

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-[18px] bg-muted/40">
      <dl className="divide-y divide-border/60">
        {rows.map((row, index) => (
          <div
            key={`${row.label}-${index}`}
            className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <dt className="text-[13px] font-medium text-muted-foreground break-words sm:w-2/5 sm:shrink-0">
              {row.label}
            </dt>
            <dd className="min-w-0 text-[14px] font-semibold text-foreground break-words [overflow-wrap:anywhere] sm:w-3/5">
              <span>{row.value}</span>
              {row.unit ? (
                // Unit symbols are international notation — never translated.
                <span className="ms-1 text-[12px] font-normal text-muted-foreground" dir="ltr">
                  {row.unit}
                </span>
              ) : null}
              {row.note ? (
                <span className="mt-0.5 block text-[12px] font-normal text-muted-foreground break-words">
                  {row.note}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function BulletList({
  items,
  tone = "neutral",
}: {
  items: string[];
  tone?: "neutral" | "good" | "bad";
}) {
  if (items.length === 0) return null;
  const marker =
    tone === "good"
      ? "bg-green-500"
      : tone === "bad"
        ? "bg-red-500"
        : "bg-[var(--brand-red,theme(colors.primary.DEFAULT))]";

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex items-start gap-2 text-[14px] leading-relaxed">
          <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${marker}`} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
