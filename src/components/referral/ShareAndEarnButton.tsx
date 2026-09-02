import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, Gift, Loader2, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/useAuth";
import { playSound } from "@/utils/audio";

/**
 * "شارك اللعبة واربح 10%" — the share button on a product page.
 *
 * The link is minted by the server, never assembled here: the browser does not
 * know the member's referral code and must not guess it from a username, which
 * can change. What comes back already points at this game and at a code that
 * never moves.
 *
 * Sharing uses the Web Share API where the device has one — on a phone that is
 * the native sheet with WhatsApp and Telegram in it — and falls back to the
 * clipboard everywhere else. Both paths end with the link on the clipboard, so
 * the button is never a dead end if the sheet is dismissed.
 */

interface ShareResponse {
  terms?: { enabled?: boolean; buyerPercent?: number; referrerPercent?: number };
  share?: { code: string; alias: string | null; link: string; productLink?: string } | null;
}

export function ShareAndEarnButton({
  product,
  className,
}: {
  product: Record<string, unknown>;
  className?: string;
}) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const productKey = String(product?.["slug"] ?? product?.["id"] ?? "");

  const { data } = useQuery<ShareResponse>({
    queryKey: ["referral-share", productKey],
    queryFn: async () => {
      const res = await fetch(`/api/referral?product=${encodeURIComponent(productKey)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("referral_share_unavailable");
      return (await res.json()) as ShareResponse;
    },
    enabled: Boolean(user) && Boolean(productKey),
    staleTime: 10 * 60_000,
  });

  const percent = data?.terms?.referrerPercent ?? 10;
  const enabled = data?.terms?.enabled !== false;
  const link = data?.share?.productLink || data?.share?.link || "";
  const title = String(product?.["title"] ?? product?.["titleEn"] ?? "لعبة");

  const share = useMutation({
    mutationFn: async () => {
      if (!link) throw new Error("no_link");
      const text = `${title} — احصل على خصم ${data?.terms?.buyerPercent ?? 10}% عبر رابط دعوتي في بنانتو`;

      /*
        The clipboard write comes first on the fallback path *and* after a
        dismissed sheet, because a share sheet the member closes is not a
        failure — they still asked for the link.
      */
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        try {
          await navigator.share({ title, text, url: link });
          return "shared" as const;
        } catch (error) {
          // `AbortError` is the member closing the sheet: fall through quietly.
          if ((error as { name?: string })?.name !== "AbortError") {
            console.warn("[referral:share_failed]", error);
          }
        }
      }

      await navigator.clipboard.writeText(link);
      return "copied" as const;
    },
    onSuccess: (result) => {
      // The store's existing sound library — no generated substitutes.
      playSound("confirm", 0.5);
      if (result === "copied") {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
        toast.success("تم نسخ رابط الدعوة");
      }
    },
    onError: () => {
      playSound("Error", 0.5);
      toast.error("تعذر مشاركة الرابط، حاول مرة أخرى");
    },
  });

  if (!enabled) return null;

  if (!user) {
    return (
      <a
        href="/auth"
        className={
          className ??
          "flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-700 transition hover:bg-emerald-500/15 dark:text-emerald-300"
        }
      >
        <Gift className="h-4 w-4 shrink-0" />
        <span className="truncate">{`شارك اللعبة واربح ${percent}%`}</span>
      </a>
    );
  }

  return (
    <button
      type="button"
      id="referral-share-btn"
      onClick={() => share.mutate()}
      disabled={share.isPending || !link}
      className={
        className ??
        "flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-700 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-300"
      }
    >
      {share.isPending ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : copied ? (
        <Check className="h-4 w-4 shrink-0" />
      ) : typeof navigator !== "undefined" && typeof navigator.share === "function" ? (
        <Share2 className="h-4 w-4 shrink-0" />
      ) : (
        <Copy className="h-4 w-4 shrink-0" />
      )}
      <span className="truncate">
        {copied ? "تم نسخ الرابط" : `شارك اللعبة واربح ${percent}%`}
      </span>
    </button>
  );
}

/** The short terms shown beside the button. */
export function ShareTermsNote({ percent = 10 }: { percent?: number }) {
  return (
    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
      يحصل صديقك على خصم {percent}% عند شرائه هذه اللعبة بحساب أوفلاين لأول مرة، وتحصل أنت على{" "}
      {percent}% رصيداً في محفظتك بعد إكمال طلبه. لا تُحتسب الإحالة إذا كان الحسابان لنفس الشخص أو
      نفس الجهاز.
    </p>
  );
}

export default ShareAndEarnButton;
