"use client";

import { useQuery } from "@tanstack/react-query";

import { Reveal } from "@/components/motion/reveal";
import { api } from "@/lib/api";

/**
 * Closing call to action for anyone whose problem was not covered.
 *
 * ## Where it used to send them
 *
 * `mailto:support@banana.example` — a placeholder domain that does not exist.
 * A customer who read the whole page, found nothing, and pressed the one
 * button offered to them reached a mail client addressed to nowhere.
 *
 * ## Where it sends them now
 *
 * Into the conversation that already knows who they are. A member with an
 * order in progress has a thread where the shop can see what they bought,
 * which account was sent and when — so opening a fresh, unattached ticket
 * throws all of that away and asks them to repeat it. When there is no order,
 * or nobody is signed in, human support is the right destination and the page
 * says so plainly.
 *
 * The lookup is best-effort: this page is public and must render for a signed
 * out visitor, so a failed or unauthorised request simply leaves the general
 * link in place.
 */
export function HelpCta() {
  const { data } = useQuery({
    queryKey: ["help-cta-open-order"],
    queryFn: () => api.orders(),
    retry: false,
    staleTime: 60_000,
  });

  /* The newest order that is still going somewhere. */
  const openOrder = (data?.orders ?? [])
    .filter((order) => !["completed", "cancelled"].includes(String(order?.status ?? "")))
    .sort((a, b) => String(b?.createdAt ?? "").localeCompare(String(a?.createdAt ?? "")))[0];

  const href = openOrder?.id ? `/orders/${openOrder.id}` : "/support";
  const label = openOrder?.id ? "افتح محادثة طلبك" : "تواصل مع الدعم";

  return (
    <Reveal className="py-10">
      <div className="relative overflow-hidden rounded-card border border-primary/50 bg-[linear-gradient(135deg,var(--color-primary-foreground),var(--color-card)_55%,var(--color-primary-foreground))] px-6 py-10 text-center shadow-card sm:px-10 sm:py-14">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-45">
          <span className="absolute top-6 right-8 animate-float-slow text-3xl">🍌</span>
          <span className="absolute bottom-8 left-10 animate-float-mid text-2xl">🍌</span>
          <span className="absolute top-1/2 left-[22%] animate-twinkle text-xl">✨</span>
        </div>

        <div className="relative">
          <h2 className="text-2xl font-extrabold text-balance text-foreground sm:text-3xl">
            ما لگيت حل مشكلتك؟
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
            {openOrder?.id
              ? "اكتب لنا داخل محادثة طلبك مع صورة كاملة للشاشة، وفريق الدعم راح يرجع لك بأسرع وقت."
              : "اكتب لنا وصف المشكلة ورقم الطلب إن وُجد، وفريق الدعم راح يرجع لك بأسرع وقت."}
          </p>

          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <a href={href} className="bn-btn bn-btn-primary">
              <span aria-hidden>💬</span>
              {label}
            </a>
            <a href="#featured-title" className="bn-btn bn-btn-ghost">
              <span aria-hidden>🔝</span>
              ارجع للمشاكل الشائعة
            </a>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
