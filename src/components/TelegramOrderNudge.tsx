import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, CheckCircle2, Loader2, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { tr, useI18n } from "@/i18n";
import { api } from "@/lib/api";
import {
  telegramLinkUsable,
  telegramNudgeDue,
  telegramReachesMember,
  useTelegramNudge,
} from "@/lib/telegramNudge";

/*
  «تنبيه بأن التليجرام غير مفعّل ... ليس إجباراً، يمكن الضغط على كلمة لاحقاً
  أو كلمة الإعداد لضبط الإعداد للتليجرام حتى يصل له الإشعارات»

  Asked once, right after an order, of a member Telegram cannot reach:

  - «لاحقاً» — or a tap outside, or Escape — closes it, and nothing else
    happens: the order is placed either way.
  - «الإعداد» opens the shop's bot with a link that ties the chat to this
    account the moment the member presses Start. The dialog then waits, and
    says so when the link has taken — the member never has to come back and
    check.

  Mounted once at the root, so it outlives the cart that asked and shows over
  the order chat that opens after it.
*/

const TELEGRAM_STATUS = ["telegram-link"] as const;

/** How long after «الإعداد» the dialog keeps asking whether the link took: the bot's link lasts 15. */
const WAIT_FOR_LINK_MS = 16 * 60_000;

type Step = "ask" | "waiting" | "linked";
type BotLink = { url: string; expiresAt?: string | undefined };

/** The bot, from the shop in a browser or from inside Telegram's own Mini App. */
function openTelegram(url: string): void {
  const webApp = window.Telegram?.WebApp;
  if (webApp?.initData && webApp.openTelegramLink) webApp.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

export default function TelegramOrderNudge() {
  const pendingFor = useTelegramNudge((state) => state.pendingFor);
  if (!pendingFor) return null;
  return <Nudge key={pendingFor} />;
}

function Nudge() {
  const done = useTelegramNudge((state) => state.done);
  const queryClient = useQueryClient();
  const lang = useI18n((state) => state.lang);
  const [step, setStep] = useState<Step | null>(null);
  const [link, setLink] = useState<BotLink | null>(null);
  const [linkState, setLinkState] = useState<"idle" | "loading" | "failed">("idle");
  const waitingSince = useRef(0);

  /*
    Decided once, from a fresh answer: a status read before the order — the
    profile's, say — can be minutes old. A moment's pause lets the order chat
    open first, so the member sees their order before they see this.
  */
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      queryClient
        .fetchQuery({
          queryKey: TELEGRAM_STATUS,
          queryFn: () => api.telegramStatus(),
          staleTime: 0,
          retry: false,
        })
        .then((status) => {
          if (!alive) return;
          if (telegramNudgeDue(status)) setStep("ask");
          else done();
        })
        .catch(() => {
          if (alive) done();
        });
    }, 900);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [queryClient, done]);

  const fetchLink = useCallback(async () => {
    setLinkState("loading");
    try {
      const res = await api.telegramLink();
      setLink({ url: res.deep_link, expiresAt: res.expires_at });
      setLinkState("idle");
    } catch {
      setLinkState("failed");
    }
  }, []);

  /*
    The bot's link is fetched while the member reads, so «الإعداد» can open
    Telegram in the same tap. Opened after a network round trip instead, the
    window counts as a popup nobody asked for, and Safari drops it.
  */
  useEffect(() => {
    if (step === "ask" && !link && linkState === "idle") void fetchLink();
  }, [step, link, linkState, fetchLink]);

  const status = useQuery({
    queryKey: TELEGRAM_STATUS,
    queryFn: () => api.telegramStatus(),
    enabled: step === "waiting",
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: () =>
      step === "waiting" && Date.now() - waitingSince.current < WAIT_FOR_LINK_MS ? 3000 : false,
  });

  useEffect(() => {
    if (step === "waiting" && status.data && telegramReachesMember(status.data)) {
      setStep("linked");
    }
  }, [step, status.data]);

  useEffect(() => {
    if (step !== "linked") return;
    const timer = setTimeout(done, 4000);
    return () => clearTimeout(timer);
  }, [step, done]);

  const openBot = () => {
    if (telegramLinkUsable(link)) {
      waitingSince.current = Date.now();
      openTelegram(link!.url);
    } else if (linkState !== "loading") void fetchLink();
  };

  const setUp = () => {
    waitingSince.current = Date.now();
    setStep("waiting");
    openBot();
  };

  if (!step) return null;

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) done();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/55" />
        <DialogPrimitive.Content
          aria-describedby="telegram-nudge-body"
          data-telegram-nudge={step}
          dir={lang === "en" ? "ltr" : "rtl"}
          className="fixed left-1/2 top-1/2 z-[90] max-h-[calc(100dvh-1.5rem)] w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-[var(--page-3)] p-5 text-center text-[var(--ink-soft)] shadow-2xl outline-none"
          style={{ borderRadius: "26px 14px 26px 14px/14px 26px 14px 26px" }}
        >
          {step === "linked" ? (
            <>
              <span className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" aria-hidden="true" />
              </span>
              <DialogPrimitive.Title className="mb-2 text-[19px] font-[900]">
                {tr("تم تفعيل تلغرام")}
              </DialogPrimitive.Title>
              <p id="telegram-nudge-body" className="mb-4 text-[14px] font-[700] leading-relaxed">
                {tr("ستصلك إشعارات طلباتك وردود الدعم على تلغرام.")}
              </p>
              <button
                type="button"
                onClick={done}
                className="flex h-12 w-full items-center justify-center rounded-full bg-[#d5a840] text-[16px] font-[900] text-[#3b2a24] shadow-md transition-all hover:bg-[#c69a35] active:scale-[0.98]"
              >
                {tr("تم")}
              </button>
            </>
          ) : (
            <>
              <span className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-[#2AABEE]/15">
                {step === "ask" ? (
                  <BellOff className="h-6 w-6 text-[#229ED9]" aria-hidden="true" />
                ) : (
                  <Send className="h-6 w-6 text-[#229ED9]" aria-hidden="true" />
                )}
              </span>
              <DialogPrimitive.Title className="mb-2 text-[19px] font-[900]">
                {step === "ask" ? tr("تلغرام غير مفعّل") : tr("أكمل الإعداد في تلغرام")}
              </DialogPrimitive.Title>

              {step === "ask" ? (
                <div id="telegram-nudge-body" className="mb-4 space-y-1.5">
                  <p className="text-[14px] font-[700] leading-relaxed">
                    {tr(
                      "فعّل تلغرام لتصلك إشعارات طلبك وردود الدعم أولاً بأول — بدونه لن يصلك شيء منها.",
                    )}
                  </p>
                  <p className="text-[12.5px] font-[700] text-[var(--ink-mute)]">
                    {tr("اختياري، ويأخذ أقل من دقيقة.")}
                  </p>
                </div>
              ) : (
                <div id="telegram-nudge-body" className="mb-4">
                  <ol className="space-y-2 text-start text-[13.5px] font-[700] leading-relaxed">
                    {[
                      tr("اضغط «ابدأ» (Start) في محادثة بوت بنانتو."),
                      tr("إن طلب منك الاشتراك في القناة، اشترك ثم اضغط «تحققت من اشتراكي»."),
                      tr("ارجع إلى هنا — يتفعّل تلقائياً."),
                    ].map((line, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2AABEE]/15 text-[11px] font-[900] text-[#229ED9]">
                          {index + 1}
                        </span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ol>
                  <p
                    role="status"
                    className="mt-3 flex items-center justify-center gap-2 text-[12.5px] font-[800] text-[var(--ink-mute)]"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {tr("بانتظار التفعيل…")}
                  </p>
                  {linkState === "failed" && (
                    <p className="mt-2 text-[12px] font-[700] text-[var(--danger)]">
                      {tr("تعذر إنشاء رابط الربط، حاول مجدداً.")}
                    </p>
                  )}
                </div>
              )}

              <div className="grid gap-2">
                <button
                  type="button"
                  disabled={step === "waiting" && linkState === "loading"}
                  onClick={step === "ask" ? setUp : openBot}
                  className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#2AABEE] text-[16px] font-[900] text-white shadow-md transition-all hover:bg-[#229ED9] active:scale-[0.98] disabled:opacity-70"
                >
                  {step === "waiting" && linkState === "loading" ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                  {step === "ask" ? tr("الإعداد") : tr("فتح تلغرام")}
                </button>
                <button
                  type="button"
                  onClick={done}
                  className="flex h-12 items-center justify-center rounded-full border-[2px] border-[var(--ink-soft)] bg-[var(--surface-2)] text-[15px] font-[900] transition-transform active:scale-[0.98]"
                >
                  {tr("لاحقاً")}
                </button>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
