import PageHeader from "@/components/PageHeader";
import { createFileRoute } from "@tanstack/react-router";
import { FileText, Calendar, ShieldAlert } from "lucide-react";
import { useI18n } from "@/i18n";
import { loadSiteContent } from "@/lib/content.functions";

export const Route = createFileRoute("/policy")({
  loader: async () => await loadSiteContent(),
  component: PolicyComponent,
});

function PolicyComponent() {
  const t = useI18n((s) => s.t);
  const lang = useI18n((s) => s.lang);
  const dir = lang === "ar" ? "rtl" : "ltr";
  const content = Route.useLoaderData();
  const policy = content.policy;

  const getLocalized = (obj: any, key: string) => {
    if (!obj) return "";
    return obj[`${key}_${lang}`] || obj[`${key}_ar`] || "";
  };

  const sections = (policy.sections || []).sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="min-h-screen bg-background pb-24" dir={dir}>
      <PageHeader />
      <div className="bg-card border-b border-border py-16 px-4 text-center">
        <div className="max-w-3xl mx-auto">
          <FileText className="w-12 h-12 text-primary mx-auto mb-6 opacity-80" />
          <h1 className="text-4xl font-black text-foreground mb-4">
            {getLocalized(policy, "title")}
          </h1>
          <p className="text-muted-foreground text-lg mb-6">{getLocalized(policy, "subtitle")}</p>
          <div className="flex justify-center gap-6 text-sm text-muted-foreground font-medium">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              {t("الإصدار:")} {policy.version}
            </div>
            {policy.effective_date && (
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                {t("سارية منذ:")} {policy.effective_date}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 mt-12 grid grid-cols-1 lg:grid-cols-12 gap-12">
        <div className="lg:col-span-4 hidden lg:block">
          <div className="sticky top-24 space-y-2 border-l-2 border-border pl-6 rtl:pl-0 rtl:border-l-0 rtl:border-r-2 rtl:pr-6">
            <h4 className="font-bold mb-4 uppercase tracking-wider text-xs text-muted-foreground">
              {t("المحتويات")}
            </h4>
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block text-sm text-foreground/80 hover:text-primary transition-colors py-1"
              >
                {getLocalized(s, "title")}
              </a>
            ))}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-16">
          {policy.important_notices && (
            <div className="bg-destructive/10 text-destructive border border-destructive/20 p-6 rounded-2xl">
              <h3 className="font-bold flex items-center gap-2 mb-2">
                <ShieldAlert className="w-5 h-5" /> {t("ملاحظات هامة")}
              </h3>
              <p className="text-sm leading-relaxed">{policy.important_notices}</p>
            </div>
          )}

          {sections.map((s) => (
            <section
              key={s.id}
              id={s.id}
              className={`scroll-mt-24 ${s.highlight ? "bg-primary/5 p-6 rounded-3xl border border-primary/20" : ""}`}
            >
              <h2 className="text-2xl font-bold mb-6 text-foreground flex items-center gap-3">
                {getLocalized(s, "title")}
              </h2>
              <div className="prose prose-sm md:prose-base dark:prose-invert max-w-none text-muted-foreground whitespace-pre-wrap leading-loose">
                {getLocalized(s, "body")}
              </div>
            </section>
          ))}

          {policy.contact_note && (
            <div className="border-t border-border pt-12 mt-12 text-center text-muted-foreground">
              <p>{policy.contact_note}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
