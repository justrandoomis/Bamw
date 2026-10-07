import { Wrench } from "lucide-react";

import { MAINTENANCE_COPY, type MaintenanceFeature } from "@/lib/maintenance";
import { cn } from "@/lib/utils";

/**
 * The sentence a feature under maintenance shows in place of its controls.
 *
 * `role="status"` so a screen reader announces it the way it would a toast:
 * the member came here to do something, and this is why they cannot.
 */
export function MaintenanceNotice({
  feature,
  className,
}: {
  feature: MaintenanceFeature;
  className?: string;
}) {
  const copy = MAINTENANCE_COPY[feature];
  return (
    <div
      role="status"
      dir="rtl"
      data-maintenance={feature}
      className={cn(
        "flex flex-col items-center gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-5 py-8 text-center",
        className,
      )}
    >
      <span className="rounded-2xl bg-amber-500/15 p-2.5 text-amber-700 dark:text-amber-300">
        <Wrench className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="text-[15px] font-black text-foreground">{copy.title}</p>
      <p className="max-w-[26rem] text-[12.5px] leading-relaxed text-muted-foreground">
        {copy.body}
      </p>
    </div>
  );
}

export default MaintenanceNotice;
