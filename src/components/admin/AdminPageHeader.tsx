import type { ReactNode } from "react";

/**
 * The top of an admin screen: what it is, one sentence on what it is for, and
 * the screen's own actions — the same three things in the same places on every
 * screen that uses it, so an admin stops having to look for them.
 */
export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-black leading-tight tracking-[-0.02em] text-foreground sm:text-[26px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
