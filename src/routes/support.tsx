import PageHeader from "@/components/PageHeader";
import { createFileRoute } from "@tanstack/react-router";
import {
  MessageCircle,
  LifeBuoy,
  BookOpen,
  ArrowRight,
  Mail,
  Clock,
  ChevronRight,
  ShieldCheck,
  Zap,
  HelpCircle,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { loadSiteContent } from "@/lib/content.functions";

export const Route = createFileRoute("/support")({
  loader: async () => {
    return await loadSiteContent();
  },
  head: () => ({
    meta: [{ title: "الخدمات والدعم — بنانا ستور" }],
  }),
  component: SupportComponent,
});

function SupportComponent() {
  const t = useI18n((state) => state.t);
  const content = Route.useLoaderData();
  const support = content.support;
  const lang = useI18n((s) => s.lang);
  const dir = lang === "ar" ? "rtl" : "ltr";

  const getLocalized = (obj: any, key: string) => {
    if (!obj) return "";
    return obj[`${key}_${lang}`] || obj[`${key}_ar`] || "";
  };

  return (
    <div className="min-h-screen bg-background pb-24" dir={dir}>
      <PageHeader />
      {/* Hero Section */}
      <div className="relative pt-32 pb-20 px-4">
        <div className="absolute top-0 left-0 w-full h-full bg-primary/5 -skew-y-3 origin-top-left -z-10" />
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-bold mb-6">
            <LifeBuoy className="w-4 h-4" />
            {getLocalized(support, "hero_title")}
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-foreground mb-6">
            {getLocalized(support, "hero_subtitle")}
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto leading-relaxed">
            {getLocalized(support, "support_intro")}
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4">
        {/* Quick Contact Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          <a
            href={support.chat_link || "/chat"}
            className="group bg-primary text-primary-foreground rounded-3xl p-8 shadow-xl shadow-primary/20 hover:scale-[1.02] transition-all"
          >
            <MessageCircle className="w-10 h-10 mb-4 opacity-80" />
            <h3 className="text-xl font-bold mb-2">{t("المحادثة المباشرة")}</h3>
            <p className="text-primary-foreground/80 text-sm mb-4">
              {t("تحدث مع أحد وكلائنا الآن للحصول على مساعدة سريعة.")}
            </p>
            <div className="flex items-center gap-2 text-sm font-bold">
              {t("ابدأ الآن")}{" "}
              <ArrowRight className="w-4 h-4 rtl:rotate-180 group-hover:-translate-x-1 transition-transform" />
            </div>
          </a>
          <div className="bg-card border border-border rounded-3xl p-8">
            <Clock className="w-10 h-10 mb-4 text-primary" />
            <h3 className="text-xl font-bold mb-2">{t("ساعات العمل")}</h3>
            <p className="text-muted-foreground text-sm">
              {getLocalized(support, "working_hours")}
            </p>
          </div>
          <div className="bg-card border border-border rounded-3xl p-8">
            <Mail className="w-10 h-10 mb-4 text-primary" />
            <h3 className="text-xl font-bold mb-2">{t("البريد الإلكتروني")}</h3>
            <p className="text-muted-foreground text-sm">{support.email || "support@banan.to"}</p>
          </div>
        </div>

        {/* Support Services Grid */}
        <div className="space-y-8">
          <h2 className="text-2xl font-black text-foreground flex items-center gap-3">
            <Zap className="w-6 h-6 text-primary" />
            {t("خدمات الدعم المتاحة")}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {support.services
              ?.filter((s) => s.active)
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((service, idx) => (
                <a
                  key={service.id || idx}
                  href={service.link || "#"}
                  className="group bg-card border border-border rounded-2xl p-6 flex items-center justify-between hover:border-primary/50 transition-all hover:shadow-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                      {service.icon === "faq" ? (
                        <HelpCircle className="w-6 h-6" />
                      ) : service.icon === "guide" ? (
                        <BookOpen className="w-6 h-6" />
                      ) : (
                        <ShieldCheck className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <h3 className="font-bold text-foreground group-hover:text-primary transition-colors">
                        {getLocalized(service, "title")}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {getLocalized(service, "description")}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground rtl:rotate-180 group-hover:-translate-x-1 transition-transform" />
                </a>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
