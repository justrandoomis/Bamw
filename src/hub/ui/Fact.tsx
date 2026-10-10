import type { ReactNode } from "react";
import { BadgeCheck, CircleHelp, Gauge } from "lucide-react";
import type { Fact } from "@/hub/types";
import { useI18n } from "@/hub/i18n";
import { cn } from "@/hub/utils/cn";

/**
 * Renders a sourced fact with its confidence state.
 *
 * The rule this component exists to enforce: an unconfirmed figure is never
 * printed as though it were official. Callers pass the raw `Fact` and a
 * formatter; if the fact is missing, `FactValue` renders the "not available"
 * treatment instead of a blank or a guess.
 */
interface FactValueProps<T> {
  fact?: Fact<T> | undefined;
  format?: (value: T) => string | null;
  /** Shown when the fact is absent entirely. */
  fallback?: ReactNode;
  className?: string;
  showBadge?: boolean;
}

export function FactValue<T>({
  fact,
  format,
  fallback,
  className,
  showBadge = true,
}: FactValueProps<T>) {
  const { t } = useI18n();

  if (!fact) return <>{fallback ?? <NotAvailable />}</>;

  const formatted = format ? format(fact.value) : String(fact.value);
  if (formatted == null) return <>{fallback ?? <NotAvailable />}</>;

  if (fact.status === "unconfirmed") {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <span className="text-sm font-semibold muted">{formatted}</span>
        <ConfidenceBadge status="unconfirmed" label={t("common.notConfirmed")} />
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="font-bold">{formatted}</span>
      {showBadge && fact.status === "measured" && (
        <ConfidenceBadge status="measured" label={t("common.measured")} />
      )}
      {showBadge && fact.source && fact.status === "confirmed" && (
        <ConfidenceBadge status="confirmed" label={fact.source} />
      )}
    </span>
  );
}

export function ConfidenceBadge({
  status,
  label,
}: {
  status: "confirmed" | "unconfirmed" | "measured";
  label: string;
}) {
  const Icon = status === "confirmed" ? BadgeCheck : status === "measured" ? Gauge : CircleHelp;
  return (
    <span
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
        status === "confirmed" && "bg-good/10 text-good",
        status === "measured" && "bg-sky-400/10 text-sky-300",
        status === "unconfirmed" && "bg-muted/70 muted",
      )}
    >
      <Icon className="h-3 w-3" />
      <span className="max-w-[12rem] truncate">{label}</span>
    </span>
  );
}

/** The single approved treatment for missing data. */
export function NotAvailable({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn("text-sm font-medium muted/80 italic", className)}>
      {t("common.notAvailable")}
    </span>
  );
}

/**
 * Boolean fact shown as Yes/No. Kept separate so a `false` value renders as a
 * definite "No" rather than being mistaken for missing data.
 */
export function BooleanFact({ fact }: { fact?: Fact<boolean> | undefined }) {
  const { t } = useI18n();
  if (!fact) return <NotAvailable />;
  if (fact.status === "unconfirmed") {
    return <ConfidenceBadge status="unconfirmed" label={t("common.notConfirmed")} />;
  }
  return (
    <span className={cn("font-bold", fact.value ? "text-good" : "muted")}>
      {fact.value ? t("common.yes") : t("common.no")}
    </span>
  );
}
