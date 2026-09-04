"use client";

import { ShieldAlert } from "lucide-react";
import { localized, type PolicyData, type PolicySection } from "@/lib/content";
import { currentLang, useI18n } from "@/i18n";
import { policyAnchor } from "@/lib/sitePolicy";
import { ContentGallery } from "@/components/content/ContentGallery";

/**
 * The store policy: a summary anybody will read, then the clauses in full.
 *
 * ## Why the summary is not decoration
 *
 * The clauses that decide whether somebody keeps their game — do not delete
 * the game account user, no refund once the account has been sent, what the
 * ban warranty does and does not cover — were nine screens down a wall of
 * justified Arabic prose under a hero that took the whole first screen. A
 * policy nobody reaches protects nobody, and "it was in the terms" is not a
 * defence when the terms were unreadable.
 *
 * So each clause carries one sentence, the summary lists them, and every entry
 * links to its own anchor. The full text is one tap away and unchanged.
 */
export function PolicyView({ policy }: { policy: PolicyData }) {
  const t = useI18n((state) => state.t);
  const lang = currentLang();
  const sections = policy.sections ?? [];
  const summarised = sections.filter((section) => localized(section, "summary", lang).trim());

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-black leading-tight text-foreground sm:text-3xl">
          {localized(policy, "title", lang) || t("سياسة المتجر")}
        </h1>
        {localized(policy, "subtitle", lang) && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {localized(policy, "subtitle", lang)}
          </p>
        )}
        {(policy.version || policy.last_updated) && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {policy.version ? `${t("الإصدار")} ${policy.version}` : ""}
            {policy.version && policy.last_updated ? " · " : ""}
            {policy.last_updated ? `${t("آخر تحديث")} ${policy.last_updated}` : ""}
          </p>
        )}
      </header>

      {policy.important_notices?.trim() && (
        <p className="mb-6 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs leading-relaxed text-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <span>{policy.important_notices}</span>
        </p>
      )}

      {summarised.length > 0 && (
        <nav aria-label={t("ملخص السياسة")} className="mb-8 rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-black text-foreground">{t("الملخص")}</h2>
          <ul className="space-y-2.5">
            {summarised.map((section) => (
              <li key={section.id} className="text-xs leading-relaxed">
                <a
                  href={`#${policyAnchor(section)}`}
                  className="font-bold text-foreground underline decoration-primary/40 underline-offset-4 hover:text-primary"
                >
                  {localized(section, "title", lang)}
                </a>
                <span className="text-muted-foreground">
                  {" — "}
                  {localized(section, "summary", lang)}
                </span>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="space-y-8">
        {sections.map((section) => (
          <PolicyClause key={section.id} section={section} lang={lang} />
        ))}
      </div>

      {policy.contact_note?.trim() && (
        <p className="mt-10 border-t border-border pt-6 text-center text-xs text-muted-foreground">
          {policy.contact_note}
        </p>
      )}

      {sections.length === 0 && (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {t("لا توجد بنود منشورة حالياً.")}
        </p>
      )}
    </div>
  );
}

function PolicyClause({ section, lang }: { section: PolicySection; lang: string }) {
  return (
    <section
      id={policyAnchor(section)}
      className={`scroll-mt-24 rounded-2xl border p-4 sm:p-5 ${
        section.highlight ? "border-primary/30 bg-primary/5" : "border-border bg-card"
      }`}
    >
      <h2 className="text-base font-black leading-snug text-foreground sm:text-lg">
        {localized(section, "title", lang)}
      </h2>

      {/*
        `whitespace-pre-line`, not `pre-wrap`: these clauses are written as
        lines and bullets, and `pre-wrap` also preserves the indentation of the
        source, which on a 360px screen pushes the text off its own column.
      */}
      <div className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-muted-foreground">
        {localized(section, "body", lang)}
      </div>

      <ContentGallery images={section.images} />
    </section>
  );
}
