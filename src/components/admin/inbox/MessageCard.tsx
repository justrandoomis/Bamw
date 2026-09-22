import React, { useState, Component, type ErrorInfo, type ReactNode } from "react";
import CodeValidity from "@/components/CodeValidity";
import { DELIVERY_OTP_TTL_MINUTES } from "@/lib/delivery-otp";
import { isVideoUrl } from "@/lib/uploads";
import {
  Key,
  ShieldCheck,
  FileText,
  Copy,
  Check,
  Bot,
  User,
  Shield,
  Info,
  Maximize2,
  Ticket,
  Sparkles,
  Download,
  Send,
  Loader2,
  AlertTriangle,
  ShoppingBag,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { ChatMessage, MessageKind } from "@/lib/types";
import { toast } from "sonner";
import { accountCardTypeFor } from "@/lib/account-cards";
import AccountCard, { VerificationOtpCard } from "@/components/chat/AccountCard";
import {
  normalizeMessage,
  logMessageDiagnosticError,
  type NormalizedChatMessage,
} from "@/lib/message-normalizer";

export interface MessageCardProps {
  message: (ChatMessage | NormalizedChatMessage) & {
    pending?: boolean;
    isFailed?: boolean;
    errorReason?: string;
    rawPayload?: any;
  };
  onSelectSuggestion?: (text: string) => void;
  order?: {
    id: string;
    items?: Array<{ id: string; title: string; credsSentAt?: string; loggedInAt?: string }>;
  } | null;
  onSendOtp?: (params: {
    itemId?: string;
    deliveryItemId?: string;
    code: string;
    title?: string;
  }) => void | Promise<void>;
  isSendingOtp?: boolean;
  onRetry?: (message: (ChatMessage | NormalizedChatMessage) & { rawPayload?: any }) => void;
}

interface MessageErrorBoundaryProps {
  message: ChatMessage | NormalizedChatMessage;
  children: ReactNode;
}

interface MessageErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Isolated Per-Message Error Boundary:
 * Ensures that a corrupted or unrenderable message NEVER crashes the conversation.
 */
class MessageErrorBoundary extends Component<MessageErrorBoundaryProps, MessageErrorBoundaryState> {
  constructor(props: MessageErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): MessageErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const msg = this.props.message;
    logMessageDiagnosticError(error, {
      conversationId: msg?.threadId,
      messageId: msg?.id,
      messageType: msg?.kind,
      source: "MessageErrorBoundary.componentDidCatch",
    });
  }

  override render() {
    if (this.state.hasError) {
      const msg = this.props.message;
      return (
        <div className="flex justify-center my-2 w-full" dir="rtl">
          <div className="flex items-center gap-2 p-2.5 px-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs shadow-2xs">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex-1 min-w-0">
              <span className="font-bold">تعذر عرض هذه الرسالة</span>
              {msg?.id && (
                <span className="text-[10px] opacity-70 font-mono block">
                  معرف الرسالة: {msg.id}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                const diag = `Message ID: ${msg?.id}\nType: ${msg?.kind}\nError: ${this.state.error?.message}\nStack: ${this.state.error?.stack}`;
                navigator.clipboard.writeText(diag);
                toast.success("تم نسخ تفاصيل الخطأ للفحص");
              }}
              className="p-1 hover:bg-amber-500/20 rounded-md transition-colors text-[10px] font-bold"
              title="نسخ تفاصيل الخطأ"
            >
              نسخ الخطأ
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function InnerMessageCard({
  message: rawMessage,
  onSelectSuggestion,
  order,
  onSendOtp,
  isSendingOtp,
  onRetry,
}: MessageCardProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showImageZoom, setShowImageZoom] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [isSubmittingOtp, setIsSubmittingOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  // Guarantee sanitized message structure
  const message = normalizeMessage(rawMessage);
  const body = message.body || {};
  const isFailed = Boolean(rawMessage.isFailed || body["_failed"]);
  const isPending = Boolean(rawMessage.pending);
  const errorReason =
    typeof rawMessage.errorReason === "string"
      ? rawMessage.errorReason
      : typeof body["_errorReason"] === "string"
        ? (body["_errorReason"] as string)
        : undefined;

  const copyText = (text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    toast.success(`تم نسخ ${label}`);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const downloadOriginalImage = async (url: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `proof-${Date.now()}.${blob.type.includes("png") ? "png" : "jpg"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast.success("تم تحميل الصورة بنجاح");
    } catch {
      window.open(url, "_blank");
    }
  };

  const isUser = message.senderRole === "user";
  const isAdmin = message.senderRole === "admin";
  const isAssistant = message.senderRole === "assistant";
  const isSystem = message.senderRole === "system";

  const kind = message.kind;
  const legacyCardType = accountCardTypeFor(kind);

  // System notification message
  if (isSystem) {
    return (
      <div className="flex justify-center my-2.5 w-full">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/60 border border-border/60 text-[11px] text-muted-foreground font-medium shadow-2xs max-w-[90%] text-center">
          <Info className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="break-words">{body.text || "إشعار نظام"}</span>
        </div>
      </div>
    );
  }

  // Formatting date safely
  let formattedTime = "";
  try {
    const d = new Date(message.createdAt);
    if (!isNaN(d.getTime())) {
      formattedTime = d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  } catch {
    formattedTime = "";
  }

  return (
    <div
      dir="ltr"
      className={`flex flex-col my-1.5 w-full ${isAdmin ? "items-end" : "items-start"}`}
    >
      {/* Sender Header */}
      <div
        className={`flex items-center gap-1.5 mb-1 px-1 text-[11px] text-muted-foreground ${
          isAdmin ? "flex-row-reverse" : ""
        }`}
        dir="auto"
      >
        {isAdmin && (
          <>
            <Shield className="w-3 h-3 text-primary" />
            <span className="font-bold text-foreground">المشرف</span>
          </>
        )}
        {isAssistant && (
          <>
            <Bot className="w-3 h-3 text-amber-500" />
            <span className="font-bold text-foreground">{message.senderName || "الدعم الآلي"}</span>
          </>
        )}
        {isUser && (
          <>
            <span className="font-medium">{message.senderName || "العميل"}</span>
            <User className="w-3 h-3 text-muted-foreground" />
          </>
        )}
        {formattedTime && <span className="text-[10px] opacity-70">{formattedTime}</span>}
      </div>

      {/* Bubble / Card container */}
      {kind === "item_verification_code" ||
      (kind as string) === "otp" ||
      (legacyCardType === "verification" && body.code) ? (
        <div dir="auto" className="relative transition-all">
          <VerificationOtpCard
            code={body.code || body.verificationCode || ""}
            title={body.title || body.gameName || null}
            expiresInMinutes={body.expiresInMinutes || DELIVERY_OTP_TTL_MINUTES}
            locale="ar"
          />
        </div>
      ) : legacyCardType || kind === "item_credentials" || (kind as string) === "credentials" ? (
        <div dir="auto" className="relative transition-all">
          <AccountCard kind={kind} body={body} tone="default" />
        </div>
      ) : kind === "review_request" ? (
        <div
          dir="rtl"
          className="relative max-w-[88%] sm:max-w-[78%] rounded-2xl p-3.5 bg-amber-500/10 border border-amber-500/25 text-foreground shadow-2xs space-y-1.5"
        >
          <div className="flex items-center gap-2 font-bold text-xs text-amber-700 dark:text-amber-300">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span>طلب تقييم الطلب</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {typeof body.text === "string" ? body.text : "تم إرسال بطاقة التقييم إلى العميل ⭐"}
          </p>
          {Boolean(body.orderCode) && (
            <div className="text-[10px] font-mono text-muted-foreground font-semibold">
              #{String(body.orderCode)}
            </div>
          )}
        </div>
      ) : kind === "order_completed" ? (
        <div
          dir="rtl"
          className="relative max-w-[88%] sm:max-w-[78%] rounded-2xl p-3.5 bg-emerald-500/10 border border-emerald-500/25 text-foreground shadow-2xs space-y-1.5"
        >
          <div className="flex items-center gap-2 font-bold text-xs text-emerald-700 dark:text-emerald-300">
            <Check className="w-4 h-4 text-emerald-500" />
            <span>{body.text || "تم تأكيد اكتمال الطلب واستلامه بنجاح ✅"}</span>
          </div>
          {body.code && (
            <div className="text-[10px] font-mono text-muted-foreground font-semibold">
              #{String(body.code)}
            </div>
          )}
        </div>
      ) : (
        <div
          dir="auto"
          className={`relative max-w-[78%] sm:max-w-[80%] rounded-2xl p-2.5 shadow-2xs text-xs leading-relaxed transition-all sm:p-3.5 ${
            isAdmin
              ? "bg-[var(--admin-ink,#1e293b)] text-white rounded-tr-xs border border-black/10"
              : isAssistant
                ? "bg-amber-500/10 text-foreground border border-amber-500/20 rounded-tr-xs"
                : "bg-muted/30 text-foreground border border-border rounded-tl-xs"
          }`}
        >
          {/* Activation Code / Card Code / Discount Code */}
          {kind === "discount_code" ||
          (body.code && !body.email && !body.imageUrl) ||
          body.activationCode ||
          body.cardCode ? (
            <div className="space-y-2.5 min-w-[240px] sm:min-w-[260px]">
              <div className="flex items-center justify-between gap-1.5 font-bold text-xs border-b border-current/20 pb-2">
                <div className="flex items-center gap-1.5">
                  <Ticket className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{kind === "discount_code" ? "كود الخصم" : "كود البطاقة / التفعيل"}</span>
                </div>
                {body.cardType && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/20 font-bold shrink-0">
                    {body.cardType}
                  </span>
                )}
              </div>

              {body.title && <div className="text-[11px] font-bold opacity-90">{body.title}</div>}

              {/* Code Row */}
              {(body.code || body.activationCode || body.cardCode) && (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-black/15 gap-2">
                  <span className="opacity-75 text-[11px] whitespace-nowrap font-medium">
                    الكود:
                  </span>
                  <div
                    className="flex items-center gap-2 font-mono text-sm font-bold tracking-widest overflow-hidden"
                    dir="ltr"
                  >
                    <span className="select-all truncate">
                      {body.code || body.activationCode || body.cardCode}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          String(body.code || body.activationCode || body.cardCode),
                          "كود التفعيل",
                        )
                      }
                      className="p-1 hover:bg-white/20 rounded-md transition-colors shrink-0"
                      title="نسخ الكود"
                    >
                      {copiedKey === "كود التفعيل" ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* PIN or serial if exists */}
              {body.pin && (
                <div className="flex items-center justify-between p-2 rounded-xl bg-black/15 gap-2">
                  <span className="opacity-75 text-[11px] whitespace-nowrap font-medium">
                    الرقم السري (PIN):
                  </span>
                  <div
                    className="flex items-center gap-2 font-mono text-xs font-bold overflow-hidden"
                    dir="ltr"
                  >
                    <span className="select-all">{body.pin}</span>
                    <button
                      type="button"
                      onClick={() => copyText(String(body.pin), "الرقم السري PIN")}
                      className="p-1 hover:bg-white/20 rounded-md transition-colors shrink-0"
                      title="نسخ PIN"
                    >
                      {copiedKey === "الرقم السري PIN" ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {body.expiresAt || body.expiresInMinutes ? (
                <CodeValidity expiresAt={body.expiresAt as string | undefined} />
              ) : null}

              {body.instructions && (
                <div className="text-[11px] opacity-90 p-2 rounded-xl bg-black/10 mt-1 whitespace-pre-wrap">
                  {body.instructions}
                </div>
              )}
            </div>
          ) : null}

          {/* Image Attachment & Login Proof with Direct OTP */}
          {body.imageUrl && !legacyCardType ? (
            <div className="space-y-2.5">
              <div className="relative group overflow-hidden rounded-xl border border-border/40 max-w-sm bg-black/10">
                {isVideoUrl(body.imageUrl) ? (
                  <video
                    src={body.imageUrl}
                    controls
                    preload="metadata"
                    playsInline
                    className="w-full max-h-64 bg-black"
                  />
                ) : (
                  <img
                    src={body.imageUrl}
                    alt="مرفق إثبات تسجيل الدخول"
                    className="w-full max-h-64 object-contain bg-black/5 cursor-pointer hover:opacity-95 transition-opacity"
                    onClick={() => setShowImageZoom(true)}
                  />
                )}
                {/* Image Floating Actions */}
                <div className="absolute top-2 left-2 flex items-center gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => downloadOriginalImage(body.imageUrl!)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-black/70 hover:bg-black/90 text-white rounded-lg text-[10px] font-bold backdrop-blur-xs transition-all shadow-xs cursor-pointer"
                    title="تحميل الصورة بالجودة الأصلية"
                  >
                    <Download className="w-3 h-3" />
                    <span>تحميل</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowImageZoom(true)}
                    className="p-1.5 bg-black/70 hover:bg-black/90 text-white rounded-lg backdrop-blur-xs transition-all shadow-xs cursor-pointer"
                    title="تكبير الصورة"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {body.text && <p className="text-xs whitespace-pre-wrap">{body.text}</p>}

              {/* Direct OTP Input for Admin after customer submits Login Proof */}
              {isUser && onSendOtp && (
                <div className="mt-2 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-foreground space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold text-blue-600 dark:text-blue-400">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>إرسال كود التحقق (OTP) مباشرة:</span>
                    </div>
                    {body.itemId ? (
                      <span className="text-[10px] font-mono opacity-80">
                        عنصر #{String(body.itemId).slice(-4)}
                      </span>
                    ) : null}
                  </div>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!otpInput.trim()) {
                        toast.error("يرجى إدخال كود التحقق أولاً");
                        return;
                      }
                      const targetItemId =
                        typeof body.itemId === "string" ? body.itemId : undefined;
                      const targetDeliveryItemId =
                        typeof body.deliveryItemId === "string" ? body.deliveryItemId : undefined;
                      if (!targetItemId && !targetDeliveryItemId) {
                        toast.error("تعذر تحديد عنصر التسليم من إثبات الدخول");
                        return;
                      }
                      setIsSubmittingOtp(true);
                      try {
                        await onSendOtp({
                          itemId: targetItemId,
                          deliveryItemId: targetDeliveryItemId,
                          code: otpInput.trim(),
                          title: typeof body.title === "string" ? body.title : undefined,
                        });
                        setOtpSent(true);
                        setOtpInput("");
                        toast.success("تم إرسال كود OTP بنجاح إلى المحادثة");
                      } catch (err: any) {
                        toast.error(err?.message || "فشل إرسال كود OTP");
                      } finally {
                        setIsSubmittingOtp(false);
                      }
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <input
                      type="text"
                      value={otpInput}
                      onChange={(e) => setOtpInput(e.target.value)}
                      placeholder="أدخل كود التحقق OTP..."
                      className="flex-1 min-w-0 bg-background/90 border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground font-mono font-bold placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus:border-blue-500"
                      dir="ltr"
                    />
                    <button
                      type="submit"
                      disabled={isSubmittingOtp || isSendingOtp || !otpInput.trim()}
                      className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer"
                    >
                      {isSubmittingOtp || isSendingOtp ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5 rtl:rotate-180" />
                      )}
                      <span>إرسال OTP</span>
                    </button>
                  </form>
                  {otpSent && (
                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      <span>تم إرسال كود التحقق OTP بنجاح للعميل</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {/* Standard Text message */}
          {!legacyCardType &&
            kind !== "discount_code" &&
            !body.imageUrl &&
            !(body.email && body.password) &&
            !(body.code && !body.email) &&
            body.text && (
              <p className="whitespace-pre-wrap text-xs font-sans leading-relaxed">{body.text}</p>
            )}

          {/* AI Assistant Product Cards */}
          {body.cards && Array.isArray(body.cards) && body.cards.length > 0 && (
            <div className="mt-2.5 space-y-2 pt-2 border-t border-current/10">
              {body.cards.map((c, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2.5 p-2 rounded-xl bg-black/5 dark:bg-white/5 border border-current/10"
                >
                  {c.image && (
                    <img
                      src={c.image}
                      alt={c.name || "منتج"}
                      className="w-10 h-10 rounded-lg object-cover bg-muted shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[11px] truncate">{c.name || "منتج"}</div>
                    {c.text && <div className="text-[10px] opacity-75 truncate">{c.text}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Suggestions */}
          {body.suggestions && Array.isArray(body.suggestions) && body.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-current/10">
              {body.suggestions.map((sugg: string, idx: number) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSelectSuggestion && onSelectSuggestion(sugg)}
                  className="px-2 py-1 bg-white/20 hover:bg-white/30 text-current rounded-lg text-[10px] font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <span>{sugg}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending Delivery State */}
      {isPending && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1 mt-0.5">
          <Loader2 className="w-3 h-3 animate-spin text-primary" />
          <span>جاري الإرسال وتأكيد الحفظ...</span>
        </div>
      )}

      {/* Failed Message State with Specific Error & Retry */}
      {isFailed && (
        <div className="flex items-center gap-2 p-2 rounded-xl bg-red-500/10 border border-red-500/25 text-red-700 dark:text-red-300 text-xs shadow-2xs mt-1 w-fit max-w-full">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
          <div className="flex-1 min-w-0">
            <span className="font-bold block">فشل إرسال الرسالة</span>
            {errorReason && (
              <span className="text-[10px] opacity-80 line-clamp-1">{errorReason}</span>
            )}
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(rawMessage)}
              className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-xs shrink-0"
            >
              <RefreshCw className="w-3 h-3" />
              <span>إعادة المحاولة</span>
            </button>
          )}
        </div>
      )}

      {/* Lightbox Image Zoom Modal */}
      {showImageZoom && body.imageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
          onClick={() => setShowImageZoom(false)}
        >
          <div className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl bg-black">
            <img
              src={body.imageUrl}
              alt="مرفق مكبر"
              className="max-w-full max-h-[85vh] object-contain mx-auto"
            />
            <button
              onClick={() => setShowImageZoom(false)}
              className="absolute top-3 right-3 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MessageCard(props: MessageCardProps) {
  return (
    <MessageErrorBoundary message={props.message}>
      <InnerMessageCard {...props} />
    </MessageErrorBoundary>
  );
}

export default MessageCard;
