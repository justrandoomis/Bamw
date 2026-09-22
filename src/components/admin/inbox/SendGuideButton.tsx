import { useQuery } from "@tanstack/react-query";
import { BookOpen, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { loadSiteContent } from "@/lib/content.functions";
import { applyGuideOverrides, shippedGuides } from "@/lib/siteGuides";

/**
 * Send a member the steps of one login method, with a button back to it.
 *
 * The admin used to retype the same fifteen steps into every order, and they
 * got shorter as the evening got longer. Now they pick the method and the
 * SERVER renders it from the guide the shop publishes — see the `guideId`
 * branch of `send_instructions`. This screen only names which one.
 *
 * Which is also why the browser sends an id and not the text: a client that
 * could post arbitrary words into the shop's voice, or link a member to a
 * guide that is not published, is a different feature from this one.
 */
export interface SendGuideButtonProps {
  orderId: string;
  threadId?: string;
  onSent?: () => void;
}

export function SendGuideButton({ orderId, threadId, onSent }: SendGuideButtonProps) {
  const [sendingId, setSendingId] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  /*
    The published guides, as the member would see them. `applyGuideOverrides`
    drops anything the admin unpublished, so a method that is not on
    /account_guides cannot be sent from here either — the button and the page
    cannot disagree about what exists.
  */
  const { data: guides = [], isLoading } = useQuery({
    queryKey: ["admin-guides"],
    queryFn: async () =>
      applyGuideOverrides(shippedGuides(), (await loadSiteContent()).guides ?? []),
    staleTime: 5 * 60_000,
  });

  const send = async (guideId: string) => {
    setSendingId(guideId);
    try {
      await api.adminOrderAction({
        orderId,
        action: "send_instructions",
        guideId,
        ...(threadId ? { threadId } : {}),
      });
      toast.success("تم إرسال الشرح للعميل");
      setIsOpen(false);
      onSent?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر إرسال الشرح");
    } finally {
      setSendingId("");
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1 px-2.5 py-1.5 bg-muted/50 hover:bg-muted text-foreground border border-border rounded-xl text-xs font-bold transition-colors cursor-pointer"
      >
        <BookOpen className="w-3.5 h-3.5 text-primary" />
        <span>أرسل شرح طريقة</span>
      </button>

      {isOpen && (
        <>
          {/*
            A click anywhere else closes it. A menu that can only be dismissed
            by the button that opened it is a menu an admin taps twice.
          */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
            role="presentation"
          />
          <div className="absolute bottom-full z-50 mb-2 max-h-72 w-64 overflow-y-auto rounded-2xl border border-border bg-card p-1.5 shadow-2xl">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 p-4 text-[11px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>جاري تحميل الشروحات...</span>
              </div>
            ) : guides.length === 0 ? (
              <p className="p-4 text-center text-[11px] text-muted-foreground">
                لا توجد شروحات منشورة.
              </p>
            ) : (
              guides.map((guide) => (
                <button
                  key={guide.id}
                  type="button"
                  disabled={Boolean(sendingId)}
                  onClick={() => void send(guide.id)}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-right text-[11.5px] font-bold text-foreground transition-colors hover:bg-muted/60 disabled:opacity-50 cursor-pointer"
                >
                  {sendingId === guide.id ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                  ) : (
                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{guide.title_ar || guide.id}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default SendGuideButton;
