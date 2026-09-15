import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, MessageSquarePlus } from "lucide-react";

import {
  GAME_REQUEST_OPTIONS,
  type GameRequestKind,
  gameRequestLabel,
} from "@/lib/gameDetailRequest";

/**
 * The panel on a listing that is still only a name and a price.
 *
 * It appears *because* the page is short, so it has to say why the page is
 * short — a customer who reaches a game with no cover and no description and
 * is offered a button with no explanation concludes the shop is broken, not
 * that the shop is being honest about what it has written up so far.
 *
 * The three things it can ask for are the three things the listing is missing:
 * the game's own details, an online account, and the offline account with the
 * extras. None of them quote a price, because the shop does not know one yet —
 * that is what the request is for.
 */

interface Props {
  productId: string;
  productTitle: string;
  platform?: string;
  /*
    Signed out, the request cannot be attributed, so the panel says so.

    `undefined` means the session is still loading — distinct from `false`,
    because bouncing a signed-in customer to /auth for pressing a button
    fractionally too early is worse than a moment's wait.
  */
  isSignedIn: boolean | undefined;
  onSignIn: () => void;
}

export default function GameDetailsRequest({
  productId,
  productTitle,
  platform,
  isSignedIn,
  onSignIn,
}: Props) {
  const [open, setOpen] = useState<GameRequestKind | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<GameRequestKind[]>([]);

  const send = async (kind: GameRequestKind) => {
    setSending(true);
    try {
      const response = await fetch("/api/game-requests", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestType: kind,
          /*
            The game's own name, not a description of the request.

            `product_requests.product_name` is what the admin screen and the
            Telegram notice both print, and its duplicate check keys on it —
            so putting «طلب تفاصيل» in here would make every request for every
            game look like the same request.
          */
          productName: productTitle,
          gameId: productId,
          platform: platform ?? "",
          productCategory: "game",
          notes: note.trim(),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        toast.error(payload?.error || "تعذّر إرسال الطلب");
        return;
      }
      setSent((prev) => [...prev, kind]);
      setOpen(null);
      setNote("");
      toast.success("وصل طلبك للفريق — سنحدّث صفحة اللعبة ونعلمك");
    } catch {
      toast.error("تعذّر إرسال الطلب");
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      dir="rtl"
      className="mx-auto max-w-5xl rounded-3xl border border-[rgb(var(--line))] bg-[rgb(var(--surface))] p-6"
    >
      <h2 className="flex items-center gap-2 text-base font-black">
        <MessageSquarePlus className="h-5 w-5 text-[rgb(var(--accent))]" />
        هذه اللعبة معروضة باسمها وسعرها فقط
      </h2>
      <p className="mt-2 text-sm leading-relaxed opacity-80">
        يمكنك طلبها الآن بسعر حساب الأوفلاين المعروض. الصور والوصف وبقية التفاصيل تُضاف تباعاً —
        واطلب ما تحتاجه وسنبدأ بهذه اللعبة.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {GAME_REQUEST_OPTIONS.map((option) => {
          const done = sent.includes(option.kind);
          return (
            <button
              key={option.kind}
              type="button"
              disabled={done}
              onClick={() => {
                if (isSignedIn === undefined) {
                  toast.message("لحظة — نتحقق من حسابك");
                  return;
                }
                if (!isSignedIn) {
                  toast.error("سجّل الدخول لإرسال الطلب");
                  onSignIn();
                  return;
                }
                setOpen(option.kind);
              }}
              className={`rounded-2xl border p-4 text-right transition-colors ${
                done
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : "border-[rgb(var(--line))] hover:bg-[rgb(var(--surface-2))]"
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-bold">
                {done && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                {done ? "أُرسل طلبك" : option.label}
              </span>
              <span className="mt-1 block text-xs leading-relaxed opacity-70">{option.detail}</span>
            </button>
          );
        })}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !sending && setOpen(null)}
        >
          <div
            dir="rtl"
            className="w-full max-w-md space-y-3 rounded-2xl border border-[rgb(var(--line))] bg-[rgb(var(--surface))] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-sm font-bold">{gameRequestLabel(open)}</h3>
            <p className="text-xs opacity-70">{productTitle}</p>
            <textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="أضف ملاحظة إن أردت (اختياري)"
              className="w-full rounded-lg border border-[rgb(var(--line))] bg-transparent px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={sending}
                onClick={() => setOpen(null)}
                className="rounded-lg border border-[rgb(var(--line))] px-4 py-2 text-xs font-bold disabled:opacity-40"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={sending}
                onClick={() => void send(open)}
                className="rounded-lg bg-[rgb(var(--accent))] px-5 py-2 text-xs font-bold text-white disabled:opacity-40"
              >
                {sending ? (
                  <>
                    <Loader2 className="ms-1 inline h-3.5 w-3.5 animate-spin" />
                    جارٍ الإرسال…
                  </>
                ) : (
                  "إرسال الطلب"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
