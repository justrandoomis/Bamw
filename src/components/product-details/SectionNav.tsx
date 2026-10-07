import { useMemo } from "react";

import { useTranslation } from "@/i18n";
import { useActiveSection } from "@/hub/hooks/useActiveSection";
import type { SectionDef } from "@/lib/productImport/sectionRegistry";

/**
 * Jump links for the sections this product actually has.
 *
 * Built from the same `resolveSections` result the page body renders, so a link
 * can never point at a section that was dropped for being empty — which is what
 * produced tabs that scrolled to nothing. It is also not rendered at all until
 * there is more than one destination: a single chip is a label, not navigation.
 *
 * On phones it is a horizontally scrollable strip of chips inside its own
 * `overflow-x-auto` container, so a long list scrolls itself instead of
 * widening the page.
 */
export function SectionNav({ sections }: { sections: SectionDef[] }) {
  const { t } = useTranslation();
  // A fresh array each render would restart the observer on every paint.
  const ids = useMemo(() => sections.map((section) => section.id), [sections]);
  const active = useActiveSection(ids);

  if (sections.length < 2) return null;

  return (
    <nav
      aria-label={t("product.sections.overview")}
      className="sticky top-[var(--header-h)] z-20 -mx-4 mb-2 border-b border-border/60 bg-[var(--page,var(--background))]/95 px-4 py-2 backdrop-blur"
    >
      <div className="w-full min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ul className="flex w-max gap-1.5">
          {sections.map((section) => {
            const isActive = active === section.id;
            return (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className={`inline-block whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-bold transition ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                  aria-current={isActive ? "true" : undefined}
                >
                  {t(section.titleKey as never)}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
