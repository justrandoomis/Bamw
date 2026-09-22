import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  Send,
  Paperclip,
  Key,
  Clock,
  CheckCircle2,
  AlertCircle,
  User,
  ShoppingBag,
  Info,
  ChevronDown,
  RefreshCw,
  ArrowRight,
  Sparkles,
  Lock,
  FileText,
  ExternalLink,
  Bot,
  Headphones,
  ShieldCheck,
} from "lucide-react";
import { Thread, ChatMessage, ThreadMode, Order } from "@/lib/types";
import { isFullyDigitalOrder } from "@/lib/delivery-kinds";
import { api, type AdminReplySuggestion } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCard } from "./MessageCard";
import { AccountToolsModal } from "./AccountToolsModal";
import { QuickRepliesModal } from "./QuickRepliesModal";
import { CustomerDetailsDrawer } from "./CustomerDetailsDrawer";
import { OrderPreviewDrawer } from "./OrderPreviewDrawer";
import type { ManualCompletionRequest } from "./types";
import { toast } from "sonner";
import {
  normalizeMessage,
  logMessageDiagnosticError,
  type NormalizedChatMessage,
} from "@/lib/message-normalizer";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ConversationErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logMessageDiagnosticError(error, {
      source: "ConversationErrorBoundary.componentDidCatch",
    });
  }

  override render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div
            className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-card"
            dir="rtl"
          >
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center mb-3">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h3 className="text-sm font-bold text-foreground mb-1">
              تعذر عرض هذه المحادثة بالكامل
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mb-4">
              حدث خطأ غير متوقع أثناء معالجة بيانات المحادثة. يمكنك إعادة المحاولة الآن.
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 bg-foreground text-background rounded-xl text-xs font-bold hover:opacity-90 transition-opacity flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>إعادة المحاولة</span>
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

interface ActiveConversationProps {
  thread: Thread | null;
  messages: ChatMessage[];
  orders?: Order[];
  isLoadingMessages?: boolean;
  isCustomerOnline?: boolean;
  isCustomerTyping?: boolean;
  customerLastReadAt?: string | null;
  hasMore?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: (container: HTMLDivElement | null) => void;
  onBackToList?: () => void;
  onNavigateToOrder?: (orderId: string) => void;
  onSendMessage: (payload: { text?: string; kind?: string; body?: any; imageUrl?: string }) => void;
  onSetThreadMode: (mode: ThreadMode) => void;
  onSetThreadStatus: (status: "open" | "closed") => void;
  onToggleAiPause?: (paused: boolean) => void;
  onSkipQueue?: () => void;
  onResumeQueue?: () => void;
  onSendQueueReminder?: (text?: string) => void;
  onRetryMessage?: (message: any) => void;
  onCompleteOrder?: (orderId: string) => Promise<unknown> | void;
  /*
    The manual door, deliberately separate from `onCompleteOrder`. It carries
    the order code because the confirmation asks the admin to type it, and the
    counts when the caller knows them, so the dialog can say what it will do.
  */
  onCompleteOrderManually?: (order: ManualCompletionRequest) => void;
  isCompletingOrder?: boolean;
  onDeliveryFinished?: (payload: {
    nextOrder?: { orderId: string; threadId?: string; code?: string; userName?: string };
  }) => void;
  isSending?: boolean;
}

export function ActiveConversation({
  thread,
  messages = [],
  orders = [],
  isLoadingMessages = false,
  isCustomerOnline = false,
  isCustomerTyping = false,
  customerLastReadAt = null,
  hasMore = false,
  isLoadingOlder = false,
  onLoadOlder,
  onBackToList,
  onNavigateToOrder,
  onSendMessage,
  onSetThreadMode,
  onSetThreadStatus,
  onToggleAiPause,
  onSkipQueue,
  onResumeQueue,
  onSendQueueReminder,
  onRetryMessage,
  onCompleteOrder,
  onCompleteOrderManually,
  isCompletingOrder = false,
  onDeliveryFinished,
  isSending = false,
}: ActiveConversationProps) {
  const [inputText, setInputText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Modals & Drawers state
  const [isAccountToolsOpen, setIsAccountToolsOpen] = useState(false);
  const [accountToolsDefaultTab, setAccountToolsDefaultTab] = useState<
    "credentials" | "otp" | "instructions"
  >("credentials");
  const [isQuickRepliesOpen, setIsQuickRepliesOpen] = useState(false);
  const [isCustomerDrawerOpen, setIsCustomerDrawerOpen] = useState(false);
  const [isOrderDrawerOpen, setIsOrderDrawerOpen] = useState(false);
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const queryClient = useQueryClient();

  const [smartSuggestions, setSmartSuggestions] = useState<AdminReplySuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Strict Separation: classify conversation type
  const isOrderConversation = Boolean(thread?.orderId || thread?.chatType === "ORDER_SUPPORT");
  const isAiSupport = Boolean(
    thread?.chatType === "AUTOMATED_SUPPORT" || thread?.mode === "AI_ACTIVE",
  );
  const isHumanSupport = !isOrderConversation && !isAiSupport;

  // Only link orders when conversation is specifically an order conversation
  const linkedOrder = useMemo(() => {
    if (!isOrderConversation || !thread?.orderId) return null;
    return orders.find((o) => o && (o.id === thread.orderId || o.code === thread.orderId)) || null;
  }, [isOrderConversation, thread?.orderId, orders]);
  const isDigitalLinkedOrder = Boolean(linkedOrder && isFullyDigitalOrder(linkedOrder.items));

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (container && container.scrollTop === 0 && hasMore && !isLoadingOlder && onLoadOlder) {
      onLoadOlder(container);
    }
  };

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Clean, normalize and deduplicate messages
  const displayedMessages = useMemo(() => {
    const seenIds = new Set<string>();
    const seenOtpKeys = new Set<string>();
    const filtered: NormalizedChatMessage[] = [];

    for (const rawMsg of messages) {
      if (!rawMsg) continue;
      const msg = normalizeMessage(rawMsg, thread?.id);
      if (!msg || !msg.id) continue;
      if (seenIds.has(msg.id)) continue;

      const clientMsgId = msg.body?.clientMessageId;
      if (clientMsgId && seenIds.has(clientMsgId)) continue;

      const kind = msg.kind;
      const body = msg.body || {};

      if ((kind as string) === "item_verification_code" || (kind as string) === "otp") {
        const itemId = String(body.itemId ?? "");
        const code = String(body.code ?? body.verificationCode ?? "");
        const otpKey = `${itemId}:${code}`;
        if (code && seenOtpKeys.has(otpKey)) {
          continue;
        }
        if (code) {
          seenOtpKeys.add(otpKey);
        }
      }

      seenIds.add(msg.id);
      if (clientMsgId) seenIds.add(clientMsgId);
      filtered.push(msg);
    }
    return filtered;
  }, [messages, thread?.id]);

  // Suggestions fetching
  const threadId = thread?.id ?? null;
  let lastCustomerMessageId = "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.senderRole === "user") {
      lastCustomerMessageId = messages[i]?.id ?? "";
      break;
    }
  }

  useEffect(() => {
    if (!threadId) {
      setSmartSuggestions([]);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setIsLoadingSuggestions(true);
    api
      .replySuggestions(threadId, controller.signal)
      .then((result) => {
        if (!active) return;
        setSmartSuggestions(Array.isArray(result?.suggestions) ? result.suggestions : []);
      })
      .catch(() => {
        if (active) setSmartSuggestions([]);
      })
      .finally(() => {
        if (active) setIsLoadingSuggestions(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [threadId, lastCustomerMessageId]);

  if (!thread) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center p-8 bg-muted/10 text-center text-muted-foreground"
        dir="rtl"
      >
        <div className="w-16 h-16 rounded-2xl bg-card border border-border flex items-center justify-center text-primary shadow-xs mb-3">
          <ShoppingBag className="w-8 h-8 opacity-60" />
        </div>
        <h3 className="text-sm font-bold text-foreground mb-1">اختر محادثة من القائمة</h3>
        <p className="text-xs max-w-sm text-muted-foreground leading-relaxed">
          انقر على أي محادثة في القائمة لعرض الرسائل وتجهيز الطلب والرد على العميل مباشرة.
        </p>
      </div>
    );
  }

  // Calculate elapsed waiting time
  const getElapsedWait = () => {
    const lastMsg = messages[messages.length - 1];
    const timestamp = lastMsg?.createdAt || thread.lastMessageAt || thread.createdAt;
    if (!timestamp) return { text: "الآن", level: "green" };
    try {
      const diffMs = Date.now() - new Date(timestamp).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return { text: "الآن", level: "green" };
      if (diffMins < 5) return { text: `${diffMins} د`, level: "green" };
      if (diffMins < 10) return { text: `${diffMins} د`, level: "amber" };
      return { text: `${diffMins} د`, level: "red" };
    } catch {
      return { text: "الآن", level: "green" };
    }
  };

  const waitInfo = getElapsedWait();

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (!threadId) return;
    if (!typingTimeoutRef.current) {
      void api.sendTyping(threadId, true, "admin");
    } else {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      if (threadId) {
        void api.sendTyping(threadId, false, "admin");
      }
      typingTimeoutRef.current = null;
    }, 2500);
  };

  const handleSend = () => {
    if (!inputText.trim()) return;
    onSendMessage({ text: inputText.trim() });
    setInputText("");
    if (typingTimeoutRef.current && threadId) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
      void api.sendTyping(threadId, false, "admin");
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        throw new Error("فشل رفع الملف");
      }
      const data = await res.json();
      if (data.url) {
        onSendMessage({
          imageUrl: data.url,
          kind: "image",
          body: { imageUrl: data.url, text: file.name },
        });
        toast.success("تم إرسال الصورة بنجاح");
      }
    } catch (err: any) {
      toast.error(err?.message || "فشل رفع الصورة");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const THREAD_MODES: { mode: ThreadMode; label: string; desc: string; color: string }[] = [
    {
      mode: "ADMIN_ACTIVE",
      label: "تحكم بشري مباشر",
      desc: "أنت تتولى المحادثة بالكامل حالياً",
      color: "text-blue-700 bg-blue-500/10",
    },
    {
      mode: "AI_ACTIVE",
      label: "مساعد الذكاء الاصطناعي",
      desc: "الرد الآلي على استفسارات العميل",
      color: "text-amber-700 bg-amber-500/10",
    },
    {
      mode: "WAITING_FOR_ADMIN",
      label: "في طابور الانتظار",
      desc: "بانتظار استلام أحد المشرفين",
      color: "text-amber-700 bg-amber-500/10",
    },
    {
      mode: "RESOLVED",
      label: "تم الحل والإنهاء",
      desc: "تم إكمال الطلب وحل الاستفسار",
      color: "text-emerald-700 bg-emerald-500/10",
    },
  ];
  const visibleThreadModes = isDigitalLinkedOrder
    ? THREAD_MODES.filter((entry) => entry.mode !== "RESOLVED")
    : THREAD_MODES;

  return (
    <ConversationErrorBoundary>
      <div
        className="w-full h-full flex flex-col bg-card overflow-hidden relative"
        dir="rtl"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag & Drop Overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-40 bg-primary/20 backdrop-blur-xs border-2 border-dashed border-primary flex items-center justify-center pointer-events-none">
            <div className="p-4 bg-card rounded-2xl shadow-xl flex items-center gap-2 font-bold text-xs text-primary">
              <Paperclip className="w-5 h-5" />
              <span>أفلت الصورة هنا لرفعها وإرسالها للعميل</span>
            </div>
          </div>
        )}

        {/* 1. Header Toolbar */}
        <div className="p-3 border-b border-border bg-card flex items-center justify-between gap-3 shrink-0 shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            {onBackToList && (
              <button
                onClick={onBackToList}
                className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                title="رجوع للقائمة"
              >
                <ArrowRight className="w-5 h-5" />
              </button>
            )}

            <div
              onClick={() => setIsCustomerDrawerOpen(true)}
              className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity min-w-0"
              title="عرض ملف العميل"
            >
              <div className="w-9 h-9 relative rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-xs shrink-0 border border-primary/20">
                {thread.userName ? thread.userName.charAt(0).toUpperCase() : "U"}
                {isCustomerOnline && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-card ring-2 ring-emerald-500/20" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs text-foreground truncate">
                    {thread.userName || "عميل"}
                  </span>
                  {/* Mode Badge */}
                  {isOrderConversation ? (
                    <span className="text-[10px] bg-blue-500/10 text-blue-600 font-bold px-1.5 py-0.2 rounded">
                      محادثة طلب
                    </span>
                  ) : isAiSupport ? (
                    <span className="text-[10px] bg-amber-500/10 text-amber-600 font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5">
                      <Bot className="w-2.5 h-2.5" />
                      <span>دعم آلي</span>
                    </span>
                  ) : (
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-600 font-bold px-1.5 py-0.2 rounded flex items-center gap-0.5">
                      <Headphones className="w-2.5 h-2.5" />
                      <span>دعم عام</span>
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {thread.subject || "محادثة الدعم"}
                </div>
              </div>
            </div>
          </div>

          {/* Header Right Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Waiting Timer Badge */}
            <div
              className={`hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                waitInfo.level === "red"
                  ? "bg-red-500/15 text-red-700 dark:text-red-400 animate-pulse"
                  : waitInfo.level === "amber"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    : "bg-muted text-muted-foreground"
              }`}
              title="وقت الانتظار منذ آخر رسالة"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>انتظار: {waitInfo.text}</span>
            </div>

            {/* Mode Switcher Dropdown */}
            <div className="relative">
              <button
                onClick={() => setIsModeDropdownOpen(!isModeDropdownOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/40 hover:bg-muted border border-border rounded-xl text-xs font-bold text-foreground transition-all cursor-pointer"
              >
                <span>
                  {THREAD_MODES.find((m) => m.mode === thread.mode)?.label ||
                    thread.mode ||
                    "الوضع"}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              </button>

              {isModeDropdownOpen && (
                <div className="absolute left-0 mt-1.5 w-56 bg-card border border-border rounded-2xl shadow-xl p-1.5 z-50 animate-in fade-in space-y-1">
                  <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    تغيير حالة المحادثة
                  </div>
                  {visibleThreadModes.map((m) => (
                    <button
                      key={m.mode}
                      onClick={() => {
                        onSetThreadMode(m.mode);
                        setIsModeDropdownOpen(false);
                        toast.success(`تم تغيير الوضع إلى: ${m.label}`);
                      }}
                      className={`w-full text-right p-2 rounded-xl text-xs flex flex-col transition-colors cursor-pointer ${
                        thread.mode === m.mode
                          ? "bg-primary text-primary-foreground font-bold"
                          : "hover:bg-muted text-foreground"
                      }`}
                    >
                      <span className="font-semibold">{m.label}</span>
                      <span className="text-[10px] opacity-75">{m.desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Customer info button */}
            <button
              onClick={() => setIsCustomerDrawerOpen(true)}
              className="p-2 bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground rounded-xl border border-border transition-colors cursor-pointer"
              title="معلومات العميل والطلبات"
            >
              <User className="w-4 h-4" />
            </button>

            {/* Closing an order conversation is a real order transition, not a ticket flag. */}
            {!isDigitalLinkedOrder && (
              <button
                onClick={() => {
                  const newStatus = thread.status === "open" ? "closed" : "open";
                  onSetThreadStatus(newStatus);
                  toast.success(
                    newStatus === "closed" ? "تم إغلاق التذكرة" : "تمت إعادة فتح التذكرة",
                  );
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  thread.status === "open"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                    : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{thread.status === "open" ? "إغلاق التذكرة" : "إعادة الفتح"}</span>
              </button>
            )}
          </div>
        </div>

        {/* 2. Order Context Strip (Strict: Only for Order Conversations) */}
        {isOrderConversation && (
          /*
            One row that SCROLLS, not six rows that wrap.

            `flex-wrap` on a strip with seven buttons in it turns a narrow
            admin screen into a stack four rows deep, pushing the conversation
            itself off the bottom — and the buttons that land on the last row
            are the ones used least often, so the arrangement changes every
            time the order does. The owner asked for it to scroll. `flex-nowrap`
            with `overflow-x-auto` gives the strip its own axis: the order
            context stays where it is, the actions stay in a fixed order, and
            reaching the last one is a swipe rather than a taller header.
          */
          <div className="p-2.5 px-4 bg-muted/25 border-b border-border flex flex-nowrap items-center justify-between gap-3 shrink-0 text-xs overflow-x-auto no-scrollbar">
            <div className="flex shrink-0 items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-blue-500 shrink-0" />
              <span className="font-mono font-bold text-foreground">
                #{linkedOrder?.code || (thread.orderId ? thread.orderId.slice(-6) : "")}
              </span>
              {linkedOrder?.items && linkedOrder.items.length > 0 && (
                <span className="truncate max-w-[10rem] text-muted-foreground sm:max-w-xs">
                  {linkedOrder.items.map((i) => i.title).join(", ")}
                </span>
              )}
              {linkedOrder?.total !== undefined && (
                <span className="font-bold text-foreground">
                  {Number(linkedOrder.total).toLocaleString()} {linkedOrder.currency || "IQD"}
                </span>
              )}
              {linkedOrder?.status && (
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${
                    linkedOrder.status === "completed"
                      ? "bg-emerald-500/10 text-emerald-600"
                      : linkedOrder.status === "processing"
                        ? "bg-amber-500/10 text-amber-600"
                        : "bg-blue-500/10 text-blue-600"
                  }`}
                >
                  {linkedOrder.status === "completed"
                    ? "تم التسليم"
                    : linkedOrder.status === "processing"
                      ? "قيد التجهيز"
                      : linkedOrder.status}
                </span>
              )}
            </div>

            <div className="flex flex-nowrap items-center gap-2 shrink-0">
              {onCompleteOrder &&
                linkedOrder &&
                isDigitalLinkedOrder &&
                linkedOrder.status !== "completed" &&
                linkedOrder.status !== "cancelled" && (
                  <button
                    type="button"
                    onClick={() => void onCompleteOrder(linkedOrder.id)}
                    disabled={isCompletingOrder}
                    className="shrink-0 whitespace-nowrap text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-3 py-1.5 rounded-lg border border-emerald-700/20 transition-all flex items-center gap-1 cursor-pointer"
                    title="متاح فقط بعد إرسال OTP أو الكود لجميع عناصر الطلب"
                  >
                    {isCompletingOrder ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3" />
                    )}
                    <span>إكمال الطلب والانتقال للتالي</span>
                  </button>
                )}

              {/*
                A second, separate button. The strict one above refuses an
                order whose delivery slots never went terminal — which is the
                whole point of it — so an order handed over by phone or
                WhatsApp needs its own way out, clearly labelled as manual.
              */}
              {onCompleteOrderManually &&
                linkedOrder &&
                isDigitalLinkedOrder &&
                linkedOrder.status !== "completed" &&
                linkedOrder.status !== "cancelled" && (
                  <button
                    type="button"
                    onClick={() =>
                      onCompleteOrderManually({
                        orderId: linkedOrder.id,
                        code: linkedOrder.code || linkedOrder.id,
                      })
                    }
                    disabled={isCompletingOrder}
                    className="shrink-0 whitespace-nowrap text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-50 px-3 py-1.5 rounded-lg border border-amber-500/30 transition-all flex items-center gap-1 cursor-pointer"
                    title="للطلبات التي سلّمتها بنفسك خارج الأداة — يطلب رقم الطلب وسبباً مكتوباً"
                  >
                    <ShieldCheck className="w-3 h-3" />
                    <span>إكمال يدوي</span>
                  </button>
                )}

              {onSendQueueReminder && (
                <button
                  type="button"
                  onClick={() => onSendQueueReminder()}
                  className="shrink-0 whitespace-nowrap text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 px-2.5 py-1 rounded-lg border border-amber-500/30 transition-all flex items-center gap-1 cursor-pointer"
                  title="إرسال تنبيه للعميل لسرعة الرد وإكمال الطلب"
                >
                  <Clock className="w-3 h-3" />
                  <span>تنبيه العميل</span>
                </button>
              )}

              {onSkipQueue && (
                <button
                  type="button"
                  onClick={onSkipQueue}
                  className="shrink-0 whitespace-nowrap text-[11px] font-bold text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 px-2.5 py-1 rounded-lg border border-border transition-all flex items-center gap-1 cursor-pointer"
                  title="نقل العميل لآخر الطابور لعدم الرد والانتقال للتالي"
                >
                  <span>تخطي الدور ⏭️</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsOrderDrawerOpen(true)}
                className="shrink-0 whitespace-nowrap text-[11px] font-bold text-primary hover:underline px-2 py-1 rounded hover:bg-primary/5 cursor-pointer"
              >
                معاينة الطلب
              </button>
              {onNavigateToOrder && (linkedOrder?.id || thread.orderId) && (
                <button
                  type="button"
                  onClick={() => onNavigateToOrder(linkedOrder?.id || thread.orderId!)}
                  className="shrink-0 whitespace-nowrap text-[11px] font-bold text-foreground bg-muted hover:bg-muted/80 px-2.5 py-1 rounded-lg flex items-center gap-1 border border-border cursor-pointer"
                  title="فتح صفحة إدارة الطلبات"
                >
                  <span>إدارة الطلب</span>
                  <ExternalLink className="w-3 h-3 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* 2.1 Snooze Banner */}
        {thread.queueStatus === "snoozed" && (
          <div className="p-3 px-4 bg-amber-500/15 border-b border-amber-500/30 flex items-center justify-between gap-3 shrink-0 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <span className="text-base">⏸️</span>
              <span className="font-bold">
                تم تأجيل هذا العميل في نهاية الطابور نظراً لعدم الرد لأكثر من 10 دقائق.
              </span>
            </div>
            {onResumeQueue && (
              <button
                type="button"
                onClick={onResumeQueue}
                className="px-3 py-1 bg-amber-600 text-white hover:bg-amber-700 rounded-lg text-xs font-bold shadow-xs transition-all shrink-0 cursor-pointer"
              >
                استئناف ومتابعة الآن
              </button>
            )}
          </div>
        )}

        {/* 3. Messages Stream */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8FAFC] dark:bg-card/40"
        >
          {isLoadingMessages ? (
            <div className="p-12 text-center text-muted-foreground text-xs space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-primary" />
              <div>جاري تحميل الرسائل...</div>
            </div>
          ) : displayedMessages.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-xs space-y-2">
              <Sparkles className="w-8 h-8 mx-auto text-muted-foreground/30" />
              <div className="font-semibold">لا توجد رسائل سابقة في هذه المحادثة</div>
              <p className="text-[11px] text-muted-foreground/70">
                يمكنك كتابة رسالة أو استخدام الردود السريعة أدناه.
              </p>
            </div>
          ) : (
            <>
              {isLoadingOlder && (
                <div className="py-2 flex justify-center">
                  <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {displayedMessages.map((msg) => (
                <MessageCard
                  key={msg.id}
                  message={msg}
                  order={linkedOrder}
                  onRetry={onRetryMessage}
                  onSendOtp={async (payload) => {
                    const targetOrderId = linkedOrder?.id || thread?.orderId;
                    if (targetOrderId) {
                      const res = await fetch("/api/admin/orders", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          orderId: targetOrderId,
                          threadId: thread?.id,
                          action: "send_verification_code",
                          itemId: payload.itemId,
                          deliveryItemId: payload.deliveryItemId,
                          code: payload.code,
                          title: payload.title,
                        }),
                      });
                      const result = (await res.json().catch(() => ({}))) as {
                        error?: string;
                        message?: string;
                        orderFinished?: boolean;
                        nextOrder?: {
                          orderId: string;
                          threadId?: string;
                          code?: string;
                          userName?: string;
                        };
                      };
                      if (!res.ok) {
                        throw new Error(result.error || result.message || "فشل إرسال كود OTP");
                      }
                      void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
                      void queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
                      void queryClient.invalidateQueries({
                        queryKey: ["thread-messages", thread?.id],
                      });
                      if (result.orderFinished) {
                        onDeliveryFinished?.({ nextOrder: result.nextOrder });
                      }
                      return;
                    }
                    onSendMessage({ kind: "otp", body: payload });
                  }}
                  onSelectSuggestion={(text) => setInputText(text)}
                />
              ))}
            </>
          )}

          {/* Animated Typing Indicator */}
          {isCustomerTyping && (
            <div className="flex justify-start mb-2 px-1">
              <div className="flex w-fit items-center gap-1.5 rounded-2xl rounded-tr-sm bg-card border border-border px-4 py-3 shadow-sm">
                <span className="flex gap-1">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-500/60 animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-500/60 animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-500/60 animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </span>
                <span className="text-xs text-muted-foreground">العميل يكتب الآن...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 4. Suggestions Strip */}
        {smartSuggestions.length > 0 && (
          <div className="px-3 py-2 bg-card border-t border-border flex items-center gap-1.5 overflow-x-auto shrink-0 scrollbar-none">
            <span className="text-[11px] font-bold text-muted-foreground shrink-0 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-500" />
              <span>اقتراحات:</span>
            </span>
            {smartSuggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                title={suggestion.reason}
                onClick={() => {
                  setInputText(suggestion.text);
                  textareaRef.current?.focus();
                }}
                className="whitespace-nowrap px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-foreground text-[11px] rounded-lg transition-colors border border-amber-500/25 shrink-0 cursor-pointer"
              >
                {suggestion.text}
              </button>
            ))}
          </div>
        )}

        {/* 5. Composer Toolbar & Input */}
        <div className="p-3 border-t border-border bg-card space-y-2 shrink-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Delivery Tools (Only for Order Conversations) */}
              {isOrderConversation && (
                <button
                  type="button"
                  onClick={() => {
                    setAccountToolsDefaultTab("credentials");
                    setIsAccountToolsOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/25 rounded-xl text-xs font-bold transition-all shadow-2xs cursor-pointer"
                >
                  <Key className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>أداة تسليم الطلب (حسابات / أكواد)</span>
                </button>
              )}

              {/* Quick Replies */}
              <button
                type="button"
                onClick={() => setIsQuickRepliesOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-muted/50 hover:bg-muted text-foreground border border-border rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span>ردود جاهزة</span>
              </button>
            </div>
          </div>

          {/* Text Area & Send Controls */}
          <div className="flex items-end gap-2">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  void handleFileUpload(e.target.files[0]);
                }
              }}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="p-2.5 text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted border border-border rounded-xl transition-colors shrink-0 cursor-pointer"
              title="إرفاق صورة"
            >
              {isUploading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>

            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="اكتب ردك هنا..."
                rows={1}
                /*
                  16px on a phone. Below that iOS Safari zooms the whole page
                  on focus and never zooms back — the admin's half of the same
                  «المحادثة تبدو كبيرة جدا» complaint.
                */
                className="w-full resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-[16px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary max-h-32 min-h-[38px] sm:text-xs"
              />
            </div>

            <button
              type="button"
              onClick={handleSend}
              disabled={!inputText.trim() || isSending}
              className="p-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-xl transition-all shadow-xs shrink-0 cursor-pointer"
              title="إرسال"
            >
              {isSending ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4 rtl:rotate-180" />
              )}
            </button>
          </div>
        </div>

        {/* Modals & Drawers */}
        {isOrderConversation && (
          <AccountToolsModal
            isOpen={isAccountToolsOpen}
            onClose={() => setIsAccountToolsOpen(false)}
            order={linkedOrder}
            defaultTab={accountToolsDefaultTab}
            onCompleteOrder={onCompleteOrder}
            onCompleteOrderManually={onCompleteOrderManually}
            isCompletingOrder={isCompletingOrder}
            onDeliveryFinished={onDeliveryFinished}
            onStateChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
              void queryClient.invalidateQueries({ queryKey: ["orders"] });
              void queryClient.invalidateQueries({ queryKey: ["admin-threads"] });
              if (thread?.id) {
                void queryClient.invalidateQueries({ queryKey: ["thread-messages", thread.id] });
              }
            }}
          />
        )}

        <QuickRepliesModal
          isOpen={isQuickRepliesOpen}
          onClose={() => setIsQuickRepliesOpen(false)}
          onSelectReply={(replyText) => {
            setInputText(replyText);
            setIsQuickRepliesOpen(false);
            textareaRef.current?.focus();
          }}
        />

        <CustomerDetailsDrawer
          isOpen={isCustomerDrawerOpen}
          onClose={() => setIsCustomerDrawerOpen(false)}
          thread={thread}
          orders={isOrderConversation ? orders : []}
          onOpenOrder={onNavigateToOrder}
        />

        {isOrderConversation && (
          <OrderPreviewDrawer
            isOpen={isOrderDrawerOpen}
            onClose={() => setIsOrderDrawerOpen(false)}
            order={linkedOrder}
            onComplete={isDigitalLinkedOrder ? onCompleteOrder : undefined}
            onCompleteManually={isDigitalLinkedOrder ? onCompleteOrderManually : undefined}
            isCompleting={isCompletingOrder}
            onOpenFullOrder={() => {
              if (linkedOrder && onNavigateToOrder) {
                onNavigateToOrder(linkedOrder.id);
                setIsOrderDrawerOpen(false);
              }
            }}
          />
        )}
      </div>
    </ConversationErrorBoundary>
  );
}

export default ActiveConversation;
