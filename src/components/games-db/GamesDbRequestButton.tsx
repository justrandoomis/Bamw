/**
 * «اطلب هذه اللعبة» on a games-database title the shop does not sell.
 *
 * It is the shop's existing game request, not a new one: the same
 * `/api/game-requests` POST that /add_game sends, so the request lands in the
 * same `product_requests` table, the same admin screen and the same Telegram
 * notice, and the member follows it on /add_game like any other. The title is
 * Nintendo's own name, and Nintendo's page is attached as the reference, so the
 * admin knows exactly which edition was asked for.
 *
 * No price anywhere: the shop does not know one for a game it does not sell,
 * and that is what the request is for.
 */
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, MessageSquarePlus, X } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n";
import type { GamesDbPlatform } from "@/lib/games-db";
import { rememberAfterSignIn } from "@/lib/signInReturn";

interface Props {
  title: string;
  euId: string;
  platform: GamesDbPlatform;
  euUrl: string;
}

export default function GamesDbRequestButton({ title, euId, platform, euUrl }: Props) {
  const navigate = useNavigate();
  const { t } = useI18n();
  /*
    `isLoading` matters: the session resolves after first paint, and bouncing
    a signed-in member to /auth for pressing a fraction of a second early is
    worse than asking them to wait a moment.
  */
  const { user, isLoading } = useAuth();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  const press = () => {
    if (isLoading) {
      toast.message(t("لحظة — نتحقق من حسابك"));
      return;
    }
    if (!user) {
      toast.error(t("سجّل الدخول لإرسال الطلب"));
      rememberAfterSignIn(window.location.pathname);
      void navigate({ to: "/auth" });
      return;
    }
    setOpen(true);
  };

  const send = async () => {
    setState("sending");
    try {
      const response = await fetch("/api/game-requests", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestType: "game",
          productName: title,
          gameId: `nintendo:${euId}`,
          platform,
          productCategory: "game",
          referenceUrl: euUrl,
          notes: note.trim(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        // «لديك طلب مسبق» — the member already asked; that is a sent request, not a failure.
        if (response.status === 400 && /مسبق/.test(payload.error ?? "")) {
          setState("sent");
          setOpen(false);
          toast.message(payload.error ?? "");
          return;
        }
        setState("idle");
        toast.error(payload.error || t("تعذّر إرسال الطلب"));
        return;
      }
      setState("sent");
      setOpen(false);
      setNote("");
      toast.success(t("وصل طلبك — سيتابعه فريقنا ويعلمك بالجديد"));
    } catch {
      setState("idle");
      toast.error(t("تعذّر إرسال الطلب"));
    }
  };

  if (state === "sent") {
    return (
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
        <p className="flex items-center gap-1.5 text-[14px] font-extrabold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          {t("أُرسل طلبك")}
        </p>
        <button
          type="button"
          onClick={() => void navigate({ to: "/add_game" })}
          className="h-10 rounded-full border border-[var(--clay-rim)] bg-card px-4 text-[13px] font-bold text-foreground shadow-sm"
        >
          {t("تابع طلباتك")}
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={press}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-red)] px-5 text-[15px] font-black text-white shadow-md"
      >
        <MessageSquarePlus className="h-5 w-5" aria-hidden="true" />
        {t("اطلب هذه اللعبة")}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("اطلب هذه اللعبة")}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          onClick={() => state !== "sending" && setOpen(false)}
        >
          <div
            dir="rtl"
            className="w-full max-w-md rounded-t-[28px] border border-[var(--clay-rim)] bg-card p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] shadow-2xl sm:rounded-[28px] sm:pb-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[16px] font-black text-foreground">{t("اطلب هذه اللعبة")}</h2>
                <p dir="auto" className="mt-1 truncate text-[13px] font-bold text-muted-foreground">
                  {title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={state === "sending"}
                aria-label={t("إغلاق")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/70 text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              {t("يصل طلبك لفريقنا مع رابط اللعبة في متجر نينتندو، ونعلمك بكل تحديث عليه.")}
            </p>
            <textarea
              rows={3}
              value={note}
              maxLength={1000}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("أضف ملاحظة إن أردت (اختياري)")}
              className="mt-3 w-full rounded-2xl border border-border bg-transparent px-3.5 py-3 text-[14px] text-foreground outline-none"
            />
            <button
              type="button"
              disabled={state === "sending"}
              onClick={() => void send()}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-red)] text-[15px] font-black text-white shadow-md disabled:opacity-60"
            >
              {state === "sending" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t("جارٍ الإرسال…")}
                </>
              ) : (
                t("إرسال الطلب")
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
