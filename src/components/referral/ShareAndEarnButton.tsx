import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, Gift, Loader2, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/useAuth";
import { playSound } from "@/utils/audio";

/**
 * "شارك اللعبة واربح 10%" — the share button on a product page.
 *
 * ## Its weight on the page
 *
 * It is a `chip`: the page's own thin primitive — a pill, a hairline border,
 * 11px, the panel tint that every other quiet control uses. Not a second
 * call to action. "Buy now" is the solid red block above it and nothing here
 * should compete with that; the bell and the heart beside it are the company
 * this belongs in.
 *
 * It used to be a full-width emerald-tinted block with its own colour, which
 * read as a second primary button and did not belong to the same set as
 * anything around it. Sharing is an offer, not the purchase.
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

/**
 * The page's thin quiet control, as one string.
 *
 * `chip` carries the pill, the hairline and the 11px from `styles.css`, so
 * this stays in step with every other small control if that primitive is ever
 * retuned. Only the interaction states are added here.
 */
const CHIP =
  "chip focusable max-w-full text-muted-foreground transition-colors " +
  "hover:bg-[var(--hub-panel-2)] hover:text-foreground " +
  "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

/** Does this device have a native share sheet? */
function canUseShareSheet(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

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
      if (canUseShareSheet()) {
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
        className={className ?? CHIP}
        aria-label={`شارك اللعبة واربح ${percent}%`}
      >
        <Gift className="h-3.5 w-3.5 shrink-0 opacity-80" />
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
      className={className ?? CHIP}
    >
      {share.isPending ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      ) : canUseShareSheet() ? (
        <Share2 className="h-3.5 w-3.5 shrink-0 opacity-80" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 opacity-80" />
      )}
      <span className="truncate">
        {copied ? "تم نسخ الرابط" : `شارك اللعبة واربح ${percent}%`}
      </span>
    </button>
  );
}

/**
 * One quiet line under the button.
 *
 * The full terms live on the `/refer` page. Three sentences of small print
 * under a chip would outweigh the chip.
 */
export function ShareTermsNote({ percent = 10 }: { percent?: number }) {
  return (
    <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground/80">
      صديقك يوفّر {percent}% على أول شراء، وأنت تربح {percent}% رصيداً بعد إكمال طلبه.{" "}
      <a href="/refer" className="underline underline-offset-2 hover:text-foreground">
        الشروط
      </a>
    </p>
  );
}

export default ShareAndEarnButton;
