"use client";

import { AlertTriangle, ChevronLeft, Info } from "lucide-react";
import type { GuideItem } from "@/lib/content";
import { guideAnchor, guideSteps } from "@/lib/siteGuides";
import { ContentGallery } from "@/components/content/ContentGallery";

/**
 * The account manual: one page, one section per guide, one anchor per section.
 *
 * ## Why anchors rather than a picker
 *
 * The old page was a grid of cards that opened a guide one step at a time in
 * local state. Nothing outside the page could point at a step, and a delivery
 * card that says "follow the sign-in steps" had nowhere to send anybody — so
 * it sent them to the top of a list and left them to find it.
 *
 * Every guide is now a section with a stable fragment taken from its `slug`,
 * so `/account_guides#login-method-2` is a link an order, a Telegram reply or
 * the FAQ can hold. Everything is rendered on the server, which is also what
 * lets a customer use the browser's own find-in-page — the thing people
 * actually reach for on a long instruction page.
 */
export function GuidesView({ guides }: { guides: GuideItem[] }) {
  const byId = (id: string) => guides.find((guide) => guide.id === id);

  /* The jumps a customer actually asks for, in the order they need them. */
  const nav = [
    { id: "login_method_1", label: "طرق تسجيل الدخول" },
    { id: "resend_verification", label: "رمز التحقق" },
    { id: "online_license", label: "Online License" },
    { id: "download_game", label: "تحميل اللعبة" },
    { id: "offline_play", label: "تشغيل حساب Offline" },
    { id: "online_play", label: "تشغيل حساب Online" },
    { id: "option_vs_edition", label: "الخيار والإصدار" },
  ]
    .map((entry) => ({ ...entry, guide: byId(entry.id) }))
    .filter((entry) => entry.guide);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-black leading-tight text-foreground sm:text-3xl">
          دليل الحساب والتشغيل
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          اتبع الخطوات حسب الخيار الموجود في طلبك. لا تحذف مستخدم حساب اللعبة، ولا تغيّر بيانات
          الحساب، ولا تضغط <span dir="ltr">Forgot your password</span>. عند طلب رمز تحقق، أرسل صورة
          كاملة للشاشة داخل محادثة الطلب وانتظر تعليمات الأدمن.
        </p>
      </header>

      {/*
        Said once, at the top, because it is the single thing customers get
        wrong: the sign-in is identical for both options and only the playing
        differs. Repeating it inside each guide would be the duplication this
        page is meant to remove.
      */}
      <p className="mb-6 flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span>
          تسجيل الدخول مشترك بين <span dir="ltr">Offline</span> و<span dir="ltr">Online</span>؛
          الاختلاف يظهر عند تشغيل اللعبة فقط.
        </span>
      </p>

      {nav.length > 0 && (
        <nav aria-label="أقسام الدليل" className="mb-8">
          <ul className="flex flex-wrap gap-2">
            {nav.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`#${guideAnchor(entry.guide!)}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {entry.label}
                  <ChevronLeft className="h-3 w-3" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="space-y-10">
        {guides.map((guide) => (
          <GuideSection key={guide.id} guide={guide} />
        ))}
      </div>

      {guides.length === 0 && (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          لا توجد أدلة منشورة حالياً.
        </p>
      )}
    </div>
  );
}

function GuideSection({ guide }: { guide: GuideItem }) {
  const steps = guideSteps(guide);

  return (
    <section
      id={guideAnchor(guide)}
      /* `scroll-mt` keeps the heading clear of the sticky header on arrival. */
      className="scroll-mt-24 rounded-2xl border border-border bg-card p-4 sm:p-6"
    >
      <h2 className="text-lg font-black leading-snug text-foreground sm:text-xl">
        {guide.title_ar}
        {guide.title_en && (
          <span dir="ltr" className="ms-2 text-xs font-bold text-muted-foreground">
            {guide.title_en}
          </span>
        )}
      </h2>

      {guide.description_ar && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{guide.description_ar}</p>
      )}

      {guide.note_ar && <Callout kind="note">{guide.note_ar}</Callout>}
      {guide.warning_ar && <Callout kind="warning">{guide.warning_ar}</Callout>}

      <ol className="mt-4 space-y-5">
        {steps.map((step, index) => (
          <li key={step.id} className="flex gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-black text-primary"
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold leading-relaxed text-foreground">
                {step.title_ar}
              </h3>
              {step.description_ar && (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {step.description_ar}
                </p>
              )}

              {/* Absent entirely until the shop owner uploads something. */}
              <ContentGallery
                images={step.images}
                legacy={step.image}
                legacyAlt={step.title_ar}
                priority={index === 0}
              />

              {step.note_ar && <Callout kind="note">{step.note_ar}</Callout>}
              {step.warning_ar && <Callout kind="warning">{step.warning_ar}</Callout>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Callout({ kind, children }: { kind: "note" | "warning"; children: React.ReactNode }) {
  const warning = kind === "warning";
  return (
    <p
      className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-xs leading-relaxed ${
        warning
          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-border bg-muted/50 text-foreground"
      }`}
    >
      {warning ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      )}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
