import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CodeValidity from "@/components/CodeValidity";
import { isVideoUrl } from "@/lib/uploads";
import {
  Check,
  CheckCircle2,
  Copy,
  Gamepad2,
  Gift,
  ImagePlus,
  BookOpen,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { api, fileToDataUrl } from "@/lib/api";
import { bubbleSide } from "@/lib/chatSides";
import { readGuideMessage } from "@/lib/guideMessage";
import { isAccountKind, type ChatMessage, type Order, type OrderItem } from "@/lib/types";
import OrderReviewModal from "@/components/OrderReviewModal";
import { AccountBatchPanel } from "@/components/admin/AccountBatchPanel";

function Bubble({ message, children }: { message: ChatMessage; children: React.ReactNode }) {
  const mine = message.senderRole === "user";
  const system = message.senderRole === "system";
  return (
    /*
      Physical sides — see src/lib/chatSides.ts. `justify-end` follows the
      reading direction, so on this Arabic screen the member's own messages
      sat on the LEFT and the shop's on the right, the wrong way round from
      what the owner asked for and from what the same member sees in every
      other messaging app.
    */
    <div className="flex">
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs ${bubbleSide(
          mine,
        )} ${
          system
            ? "border border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900/50"
            : mine
              ? "bg-[var(--brand-red)] text-white"
              : "border border-border bg-card text-foreground"
        }`}
      >
        {!system && !mine && message.senderName && (
          <p className="mb-1 text-[11px] font-bold text-muted-foreground">{message.senderName}</p>
        )}
        {children}
        <p className={`mt-1 text-[10px] ${mine ? "text-white/70" : "text-muted-foreground"}`}>
          {new Date(message.createdAt).toLocaleString("ar", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

function cleanCredentialValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val).trim();
  if (s === "null" || s === "undefined" || s === "excluded_from_export" || s === "[excluded]") {
    return "";
  }
  return s;
}

function DigitalOrderCard({ body }: { body: Record<string, any> }) {
  const items = Array.isArray(body?.items) ? body.items : [];
  const total = Number(body?.total || 0);
  const currency = body?.currency || "IQD";

  return (
    <div className="space-y-3 min-w-[240px] max-w-sm rounded-2xl border border-amber-300 dark:border-amber-700/50 bg-linear-to-b from-amber-500/10 to-amber-500/5 p-3.5 text-right">
      <div className="flex items-center justify-between border-b border-amber-300/40 dark:border-amber-700/40 pb-2">
        <div className="flex items-center gap-1.5 font-black text-xs text-amber-700 dark:text-amber-400">
          <Gamepad2 className="h-4 w-4" />
          <span>طلب ألعاب رقمية</span>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-600 dark:text-emerald-400">
          مدفوع من المحفظة ✅
        </span>
      </div>

      <div className="space-y-2">
        {items.map((item: any, idx: number) => (
          <div
            key={idx}
            className="flex items-center gap-2.5 rounded-xl bg-card/60 p-2 border border-border/40"
          >
            {item.image ? (
              <img
                src={item.image}
                alt=""
                className="h-10 w-10 shrink-0 rounded-lg object-cover border border-border/50"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Gamepad2 className="h-5 w-5" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-foreground truncate">{item.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {Number(item.unitPrice || 0).toLocaleString()} {currency} × {item.quantity || 1}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-amber-300/40 dark:border-amber-700/40 pt-2 space-y-1">
        <div className="flex justify-between items-center text-xs font-bold">
          <span className="text-muted-foreground">إجمالي المبلغ:</span>
          <span className="text-foreground font-black">
            {total.toLocaleString()} {currency}
          </span>
        </div>
        <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed font-medium">
          ⏳ سيتم إرسال بيانات الدخول والتعليمات في هذه المحادثة مباشرة من قبل فريق الدعم.
        </p>
      </div>
    </div>
  );
}

function CredentialsCard({ message, order }: { message: ChatMessage; order: Order }) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const email = cleanCredentialValue(message.body["email"]);
  const password = cleanCredentialValue(message.body["password"]);
  const code = cleanCredentialValue(message.body["code"] ?? message.body["deliveryCode"]);
  const pin = cleanCredentialValue(message.body["pin"]);
  const title = cleanCredentialValue(message.body["title"]);
  const notes = cleanCredentialValue(message.body["notes"]);

  const copyText = (text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="space-y-2.5 min-w-[220px]">
      <p className="flex items-center gap-2 font-bold text-xs sm:text-sm">
        <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
        <span>بيانات الحساب {title ? `— ${title}` : ""}</span>
      </p>

      <div className="space-y-2 rounded-xl bg-black/10 p-2.5 font-mono text-xs">
        {email ? (
          <div className="flex items-center justify-between gap-2" dir="ltr">
            <span className="truncate select-all font-sans font-medium">{email}</span>
            <button
              type="button"
              onClick={() => copyText(email, "email")}
              className="p-1 hover:bg-black/10 rounded transition-colors shrink-0"
              title="نسخ البريد"
            >
              {copiedKey === "email" ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ) : null}

        {password ? (
          <div className="flex items-center justify-between gap-2" dir="ltr">
            <span className="truncate select-all font-semibold">{password}</span>
            <button
              type="button"
              onClick={() => copyText(password, "password")}
              className="p-1 hover:bg-black/10 rounded transition-colors shrink-0"
              title="نسخ كلمة المرور"
            >
              {copiedKey === "password" ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ) : null}

        {code ? (
          <div className="flex items-center justify-between gap-2" dir="ltr">
            <span className="truncate select-all font-bold tracking-wider">{code}</span>
            <button
              type="button"
              onClick={() => copyText(code, "code")}
              className="p-1 hover:bg-black/10 rounded transition-colors shrink-0"
              title="نسخ الكود"
            >
              {copiedKey === "code" ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ) : null}

        {pin ? (
          <div className="flex items-center justify-between gap-2" dir="ltr">
            <span className="truncate select-all">{pin}</span>
            <button
              type="button"
              onClick={() => copyText(pin, "pin")}
              className="p-1 hover:bg-black/10 rounded transition-colors shrink-0"
              title="نسخ PIN"
            >
              {copiedKey === "pin" ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ) : null}

        {notes ? (
          <p className="text-[11px] font-sans text-muted-foreground whitespace-pre-wrap mt-1">
            {notes}
          </p>
        ) : null}
      </div>

      <div className="pt-1">
        <label className="flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground py-2.5 px-3 text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-98">
          <ImagePlus className="h-4 w-4" />
          <span>📷 إرفاق إثبات تسجيل الدخول</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const toastId = toast.loading("جارٍ رفع صورة الإثبات...");
                const { uploadFileWithProgress } = await import("@/lib/api");
                const { url } = await uploadFileWithProgress(file, "orders");
                const itemId = String(message.body["itemId"] || order.items[0]?.id || "");
                const deliveryItemId = message.body["deliveryItemId"]
                  ? String(message.body["deliveryItemId"])
                  : undefined;
                await api.orderAction({
                  orderId: order.id,
                  action: "submit_login_proof",
                  itemId: itemId || undefined,
                  deliveryItemId,
                  imageUrl: url,
                });
                toast.dismiss(toastId);
                toast.success("تم إرسال صورة إثبات تسجيل الدخول بنجاح! المشرف سيرسل لك كود OTP.");
              } catch (err: any) {
                toast.error(err?.message || "تعذر إرسال صورة الإثبات");
              }
            }}
          />
        </label>
      </div>
    </div>
  );
}

function MessageBody({ message, order }: { message: ChatMessage; order: Order }) {
  const [copiedCode, setCopiedCode] = useState(false);

  const copyCodeText = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  if (message.body?.type === "digital_order_card") {
    return <DigitalOrderCard body={message.body} />;
  }

  switch (message.kind) {
    case "login_proof": {
      const mediaUrl = String(message.body["imageUrl"] ?? "");
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            <span>إثبات تسجيل الدخول</span>
          </div>
          {mediaUrl && (
            <img
              src={mediaUrl}
              alt="إثبات تسجيل الدخول"
              className="max-h-64 rounded-xl object-contain border border-border/50 bg-black/5"
            />
          )}
          {message.body["text"] ? <p className="text-xs">{String(message.body["text"])}</p> : null}
        </div>
      );
    }
    case "video":
    case "image":
    case "payment_receipt": {
      const mediaUrl = String(message.body["imageUrl"] ?? "");
      return (
        <div className="space-y-2">
          {isVideoUrl(mediaUrl) ? (
            <video
              src={mediaUrl}
              controls
              preload="metadata"
              playsInline
              className="max-h-64 rounded-xl bg-black"
            />
          ) : (
            <img src={mediaUrl} alt="مرفق" className="max-h-64 rounded-xl object-cover" />
          )}
          {message.body["text"] ? <p>{String(message.body["text"])}</p> : null}
        </div>
      );
    }
    case "payment_methods_card": {
      const methods =
        (message.body["methods"] as { id: string; name: string; details?: string }[]) ?? [];
      return (
        <div className="space-y-2">
          <p className="font-bold">
            المبلغ المطلوب: {Number(message.body["total"] ?? 0).toLocaleString()}{" "}
            {String(message.body["currency"] ?? "")}
          </p>
          <ul className="space-y-1 text-xs">
            {methods.map((method) => (
              <li key={method.id} className="rounded-lg bg-black/5 px-2 py-1">
                <b>{method.name}</b>
                {method.details ? ` — ${method.details}` : ""}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "item_credentials":
      return <CredentialsCard message={message} order={order} />;
    case "item_verification_code": {
      const code = String(message.body["code"] ?? "");
      return (
        <div className="space-y-1.5 text-center">
          <p className="text-[11px] font-bold opacity-80">كود التحقق الخاص بك</p>
          <div className="flex items-center justify-center gap-2 rounded-xl bg-black/10 py-1.5 px-3">
            <span className="font-mono text-lg font-bold tracking-widest" dir="ltr">
              {code}
            </span>
            <button
              type="button"
              onClick={() => copyCodeText(code)}
              className="p-1 hover:bg-black/10 rounded transition-colors"
              title="نسخ كود التحقق"
            >
              {copiedCode ? (
                <Check className="h-4 w-4 text-emerald-400" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          {/* Real remaining time from the server-stamped expiry, not a local timer. */}
          <CodeValidity expiresAt={message.body["expiresAt"] as string | undefined} />
        </div>
      );
    }
    case "discount_code": {
      const code = String(message.body["code"] ?? "");
      return (
        <div className="space-y-1">
          {message.body["text"] ? <p>{String(message.body["text"])}</p> : null}
          <div
            className="flex items-center justify-between gap-2 rounded-lg bg-black/10 p-2 font-mono"
            dir="ltr"
          >
            <span className="text-sm font-bold tracking-wider">{code}</span>
            <button
              type="button"
              onClick={() => copyCodeText(code)}
              className="p-1 hover:bg-black/10 rounded transition-colors"
              title="نسخ كود الخصم"
            >
              {copiedCode ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      );
    }
    case "order_completed":
      return (
        <div className="space-y-1 text-center font-bold">
          <p>✅ تم إكمال الطلب {String(message.body["code"] ?? "")} بنجاح!</p>
        </div>
      );
    case "instructions": {
      /*
        The steps, and a way back to the method they came from.

        The text is what the member reads without leaving the conversation;
        the button is for the step that needs the pictures, and it deep-links
        to THAT method rather than the top of a page with six on it. An older
        instructions message, or one the admin typed themselves, carries no
        anchor and gets no button — never a button to nowhere.
      */
      const guide = readGuideMessage(message.body);
      if (!guide)
        return <p className="whitespace-pre-wrap">{String(message.body["text"] ?? "")}</p>;
      return (
        <div className="space-y-2.5">
          <p className="whitespace-pre-wrap">{guide.text}</p>
          {guide.href ? (
            <a
              href={guide.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-[11px] font-bold text-foreground transition-colors hover:border-[var(--brand-red)]/40 hover:text-[var(--brand-red)]"
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{guide.guideTitle}</span>
            </a>
          ) : null}
        </div>
      );
    }
    default:
      return <p className="whitespace-pre-wrap">{String(message.body["text"] ?? "")}</p>;
  }
}

function AdminPanel({ order, onDone }: { order: Order; onDone: () => void }) {
  const [itemId, setItemId] = useState(order.items[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const item: OrderItem | undefined = order.items.find((i) => i.id === itemId);

  const action = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.adminOrderAction({ orderId: order.id, ...payload }),
    onSuccess: onDone,
  });

  return (
    <div className="space-y-3 border-t border-border bg-card p-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => action.mutate({ action: "set_payment", paymentStatus: "paid" })}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"
        >
          تأكيد الدفع
        </button>
        <button
          onClick={() => action.mutate({ action: "set_payment", paymentStatus: "rejected" })}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white"
        >
          رفض الدفع
        </button>
        <button
          onClick={() => action.mutate({ action: "complete_order" })}
          className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-bold text-white"
        >
          إكمال الطلب
        </button>
      </div>

      <select
        value={itemId}
        onChange={(event) => setItemId(event.target.value)}
        className="w-full rounded-lg border border-border px-2 py-2 text-xs"
      >
        {order.items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.title} — {isAccountKind(i.kind) ? "حساب" : "جهاز"}
          </option>
        ))}
      </select>

      {isAccountKind(item?.kind) ? (
        <div className="space-y-2">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="بريد الحساب"
            className="w-full rounded-lg border border-border px-2 py-2 text-xs"
            dir="ltr"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="كلمة المرور (تُشفَّر)"
            className="w-full rounded-lg border border-border px-2 py-2 text-xs"
            dir="ltr"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                action.mutate({ action: "stage_credentials", itemId, email, password })
              }
              className="rounded-lg bg-muted px-3 py-1.5 text-xs font-bold"
            >
              تجهيز البيانات
            </button>
            <button
              disabled={Boolean(item?.credsSentAt)}
              onClick={() => action.mutate({ action: "send_credentials", itemId })}
              className="rounded-lg bg-[var(--brand-red)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
            >
              {item?.credsSentAt ? "تم الإرسال" : "إرسال للعميل"}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="رمز التحقق"
              className="flex-1 rounded-lg border border-border px-2 py-2 text-xs"
              dir="ltr"
            />
            <button
              onClick={() => action.mutate({ action: "send_verification_code", itemId, code })}
              className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-bold text-white"
            >
              إرسال الرمز
            </button>
          </div>

          <AccountBatchPanel orderId={order.id} itemId={itemId} onOrderChanged={onDone} />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => action.mutate({ action: "mark_shipped", itemId })}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white"
          >
            تم الشحن
          </button>
          <button
            onClick={() => action.mutate({ action: "mark_delivered", itemId })}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"
          >
            تم التسليم
          </button>
        </div>
      )}
    </div>
  );
}

export default function OrderChat({
  orderId,
  isAdmin = false,
}: {
  orderId: string;
  isAdmin?: boolean;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [showReviewModal, setShowReviewModal] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => api.order(orderId),
    refetchInterval: 4000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["order", orderId] });

  const send = useMutation({
    mutationFn: (payload: { text?: string; imageUrl?: string }) =>
      api.sendMessage({ threadId: data!.thread.id, ...payload }),
    onSuccess: () => {
      setText("");
      refresh();
    },
  });

  const confirmReceived = useMutation({
    mutationFn: () =>
      api.fetch("/api/orders", {
        method: "PATCH",
        body: JSON.stringify({ orderId, action: "confirm_received" }),
      }),
    onSuccess: () => {
      toast.success("تم تأكيد استلام الطلب والحساب بنجاح! 🎉");
      refresh();
      setShowReviewModal(true);
    },
    onError: () => {
      toast.error("فشل تأكيد الاستلام");
    },
  });

  const messages: ChatMessage[] = data?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const uploadReceipt = async (file: File) => {
    const dataUrl = await fileToDataUrl(file);
    const { url } = await api.upload(dataUrl, "receipts");
    send.mutate({ imageUrl: url, text: "إيصال الدفع" });
  };

  if (isLoading || !data) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">جاري تحميل المحادثة...</div>
    );
  }

  const { order } = data;
  const isCompleted = (order as any)?.status === "completed";

  return (
    <div className="flex min-h-[70vh] flex-col overflow-hidden rounded-3xl border border-border bg-[#faf8f2] dark:bg-card/40">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div>
          <p className="text-sm font-bold text-foreground">طلب {order.code}</p>
          <p className="text-xs text-muted-foreground">
            {(order as any)?.status === "completed"
              ? "مكتمل ✅"
              : (order as any)?.status === "delivering"
                ? "قيد التسليم 📦"
                : "قيد المعالجة ⏳"}{" "}
            · {order.paymentStatus === "paid" ? "مدفوع من المحفظة" : "بانتظار الدفع"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/*
            A gift says so. Without it a member — and an admin — sees a game
            sold for nothing with no explanation, and the most likely reading
            of that is a mistake rather than a prize.
          */}
          {(order as any)?.isGift ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-black text-amber-700 dark:text-amber-300">
              <Gift className="h-3 w-3" aria-hidden="true" />
              هدية
            </span>
          ) : null}
          {/*
            The guides, one tap away from the conversation that needs them.

            A member being walked through signing in to a Nintendo account is
            exactly the member who wants «شرح طرق تسجيل الدخول», and the only
            way to reach it was to leave the order, find the menu and come
            back. Small and quiet on purpose — it sits beside the total, not
            in front of it.
          */}
          {!isAdmin && (
            <a
              href="/account_guides"
              target="_blank"
              rel="noopener noreferrer"
              title="شرح الحسابات وطرق تسجيل الدخول"
              aria-label="شرح الحسابات وطرق تسجيل الدخول"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/40 text-muted-foreground transition-colors hover:border-[var(--brand-red)]/40 hover:bg-[var(--brand-red)]/10 hover:text-[var(--brand-red)]"
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
          <div className="text-left">
            <p className="text-sm font-bold text-[var(--brand-red)]">
              {order.total.toLocaleString()} {order.currency}
            </p>
            {isCompleted && (
              <button
                onClick={() => setShowReviewModal(true)}
                className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:underline"
              >
                <Star className="h-3 w-3 fill-current" />
                <span>تقييم الطلب</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((message) => (
          <Bubble key={message.id} message={message}>
            <MessageBody message={message} order={order} />
          </Bubble>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Customer Action Bar: Confirm Received */}
      {!isAdmin && (
        <div className="border-t border-border/80 bg-muted/40 px-4 py-2.5 flex items-center justify-between gap-3">
          {!isCompleted ? (
            <div className="flex items-center justify-between w-full gap-2">
              <span className="text-xs text-muted-foreground font-medium">
                هل استلمت الحساب وبيانات اللعبة؟
              </span>
              <button
                onClick={() => confirmReceived.mutate()}
                disabled={confirmReceived.isPending}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs active:scale-95 transition-all disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{confirmReceived.isPending ? "جاري التأكيد..." : "تم استلام الطلب"}</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between w-full">
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                تم استلام الطلب وتأكيده بنجاح
              </span>
              <button
                onClick={() => setShowReviewModal(true)}
                className="inline-flex items-center gap-1 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 px-3 py-1 text-xs font-bold transition-colors"
              >
                <Sparkles className="h-3 w-3" />
                <span>تقييم وكود الخصم</span>
              </button>
            </div>
          )}
        </div>
      )}

      {isAdmin && <AdminPanel order={order} onDone={refresh} />}

      {/* Input bar */}
      <div className="flex items-center gap-2 border-t border-border bg-card p-3">
        <label className="cursor-pointer rounded-xl bg-muted p-2.5 text-muted-foreground hover:bg-muted/80 transition-colors">
          <ImagePlus className="h-5 w-5" />
          <input
            type="file"
            accept="image/*,video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadReceipt(file);
            }}
          />
        </label>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && text.trim()) send.mutate({ text: text.trim() });
          }}
          placeholder="اكتب رسالتك للدعم..."
          className="flex-1 rounded-xl border border-border bg-muted px-4 py-2.5 text-sm outline-hidden focus:border-[var(--brand-red)]"
        />
        <button
          disabled={!text.trim() || send.isPending}
          onClick={() => send.mutate({ text: text.trim() })}
          className="rounded-xl bg-[var(--brand-red)] p-2.5 text-white disabled:opacity-40 hover:opacity-90 active:scale-95 transition-all"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>

      {/* Review Modal */}
      {showReviewModal && (
        <OrderReviewModal
          order={order}
          isOpen={showReviewModal}
          onClose={() => setShowReviewModal(false)}
          onSubmitted={() => {
            refresh();
          }}
        />
      )}
    </div>
  );
}
