import { Reveal } from "@/components/motion/reveal";

export function Hero({ problemCount }: { problemCount: number }) {
  return (
    <section className="relative pt-6 pb-8 text-center sm:pt-10 sm:pb-10">
      <Reveal className="mx-auto max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-pill border border-primary/50 bg-primary/20 px-4 py-1.5 text-sm font-bold text-muted-foreground">
          <span aria-hidden>🍌</span>
          مركز الحلول
        </span>

        <h1 className="mt-5 text-4xl leading-[1.15] font-extrabold text-balance text-foreground sm:text-5xl lg:text-6xl">
          حلول المشاكل
          <span aria-hidden className="mr-2 inline-block animate-float-mid">
            🍌
          </span>
        </h1>

        <p className="mt-4 font-display text-xl font-bold text-muted-foreground sm:text-2xl">
          لا تشيل هم، غالبًا حل مشكلتك موجود هنا.
        </p>

        <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          ابحث عن المشكلة التي تواجهك وشوف الحل خطوة بخطوة — مع صور توضيحية لكل حالة.
        </p>

        <p className="mt-5 inline-flex items-center gap-2 rounded-pill bg-card/80 px-4 py-2 text-sm font-semibold text-muted-foreground shadow-soft">
          <span aria-hidden>✨</span>
          {problemCount} مشكلة موثّقة مع حلولها
        </p>
      </Reveal>
    </section>
  );
}
