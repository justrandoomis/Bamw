import { tr, useI18n } from "@/i18n";
import { threadKind } from "@/lib/thread-lifecycle";
import { toast } from "sonner";
import { prepareImageForUpload } from "@/lib/imageForUpload";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  Camera,
  Check,
  CheckCheck,
  Clock,
  CreditCard,
  FileText,
  Headset,
  Image as ImageIcon,
  MapPin,
  Menu,
  MessageSquarePlus,
  Mic,
  Paperclip,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  ShoppingBag,
  Trash2,
  Wallet,
  X,
  Zap,
  Bot,
  Sparkles,
  User,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  RotateCcw,
  ChevronDown,
  Receipt,
  Printer,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

import Strands from "@/components/ui/Strands";
import { FlipWords } from "@/components/ui/flip-words";
import { SquigglyText } from "@/components/ui/squiggly-text";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";
import { useCurrency } from "@/context/CurrencyContext";
import { useAuth } from "@/hooks/useAuth";
import { useChatRealtime } from "@/hooks/useChatRealtime";
import { api, uploadFileWithProgress, walletApi } from "@/lib/api";
import { isVideoUrl } from "@/lib/uploads";
import { supportAnswer, type SupportContext } from "@/lib/support";
import { getSmartCustomerSuggestions } from "@/lib/support/contextual-suggestions";
import { viewHistoryForSupport } from "@/lib/view-history";
import type {
  Address,
  ChatMessage,
  Order,
  Product,
  ChatType,
  AdminAvailabilityStatus,
} from "@/lib/types";
import { cdnImage } from "@/lib/img";
import { accountCardTypeFor } from "@/lib/account-cards";
import { isEmptyMessage, readMessageRow } from "@/lib/chat-message-row";
import AccountCard from "@/components/chat/AccountCard";
import { DigitalOrderCard } from "@/components/chat/DigitalOrderCard";
import { RatingCard } from "@/components/chat/RatingCard";
import { TopUpModal } from "@/components/wallet/TopUpModal";

export type MessageStatus = "sending" | "sent" | "failed";

export type DisplayMessage = {
  id: string;
  clientMessageId?: string;
  sender: "ai" | "user";
  text: string;
  type?:
    | "text"
    | "product"
    | "location"
    | "wallet"
    | "order"
    | "image"
    | "account_card"
    | "digital_order_card"
    | "review_request"
    | "order_completed";
  payload?: Record<string, unknown>;
  createdAt?: string;
  status?: MessageStatus;
  uploadProgress?: number;
  /**
   * Why a send failed, in the member's language.
   *
   * The server answers with a precise reason — the format cannot be converted,
   * the hourly upload limit is spent, storage did not confirm the write — and
   * the catch used to discard all of it. A dropped packet and an unsupported
   * photo then looked identical, and the only report a member could make was
   * "sending the image fails".
   */
  failureReason?: string;
};

/**
 * Reads the underlying wire fields off a rendered message.
 *
 * A `DisplayMessage` carries `sender`/`text`/`type`/`payload` — the server's
 * `kind`, `body` and `senderRole` live *inside* `payload`. Code that read
 * `message.kind` or `message.body` directly got `undefined` for every message,
 * so the checks built on them ("has the customer sent proof?", "have
 * credentials gone out?") were permanently false and the suggestion chips were
 * always the generic set.
 *
 * Everything is defensive: a malformed or truncated payload yields empty
 * values rather than throwing, because one bad row must never take the
 * conversation down.
 */
function readWireMessage(message: DisplayMessage): {
  kind: string;
  body: Record<string, unknown>;
  senderRole: "user" | "admin" | "assistant" | "system";
  text: string;
} {
  const payload =
    message && typeof message.payload === "object" && message.payload
      ? (message.payload as Record<string, unknown>)
      : {};
  const body =
    typeof payload["body"] === "object" && payload["body"]
      ? (payload["body"] as Record<string, unknown>)
      : {};
  const rawRole = typeof payload["senderRole"] === "string" ? String(payload["senderRole"]) : "";
  const senderRole: "user" | "admin" | "assistant" | "system" =
    rawRole === "user" || rawRole === "admin" || rawRole === "assistant" || rawRole === "system"
      ? rawRole
      : message?.sender === "user"
        ? "user"
        : "assistant";
  const text =
    typeof body["text"] === "string"
      ? body["text"]
      : typeof message?.text === "string"
        ? message.text
        : "";
  return {
    kind:
      typeof payload["kind"] === "string" ? String(payload["kind"]) : String(message?.type ?? ""),
    body,
    senderRole,
    text,
  };
}

const priceOf = (product: Product) => Number(product.price ?? 0);

function OrderSelectionView({
  orders,
  onSend,
}: {
  orders: Order[];
  onSend: (order: Order) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto pb-4 text-right" dir="rtl">
      <h2 className="mb-4 text-xl font-bold text-[var(--ink)]">{tr("اختيار الطلب")}</h2>
      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {orders.map((order) => (
          <div
            key={order.id}
            className="flex flex-col gap-2 rounded-xl border border-[var(--line)] bg-card p-4 shadow-xs transition-colors hover:border-[var(--ink)]"
          >
            <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-[var(--ink)]">{order.code}</span>
              <span
                className={`rounded-md px-2 py-1 text-xs font-bold ${
                  order.status === "completed"
                    ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                    : "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400"
                }`}
              >
                {order.status === "completed" ? "تم التسليم" : "قيد التجهيز"}
              </span>
            </div>
            <p className="text-sm text-[var(--ink)]/70">
              {order.items.map((item) => item.title).join("، ")}
            </p>
            <div className="mt-2 flex items-center justify-between border-t border-[var(--line)]/50 pt-2">
              <span className="font-bold text-[var(--ink)]">
                {order.total.toLocaleString()} {order.currency}
              </span>
              <button
                onClick={() => onSend(order)}
                className="rounded-xl bg-[var(--surface-3)] px-4 py-2 text-sm font-bold text-[var(--ink)] transition-colors hover:bg-[var(--ink)] hover:text-white cursor-pointer"
              >
                {tr("اختيار")}
              </button>
            </div>
          </div>
        ))}
        {orders.length === 0 && (
          <div className="py-10 text-center">
            <FileText className="mx-auto mb-3 h-12 w-12 text-[var(--line)] opacity-50" />
            <p className="font-medium text-[var(--muted-ink)]">{tr("لا توجد طلبات بعد")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ProductSelectionView({
  products,
  favorites,
  purchased,
  onSend,
}: {
  products: Product[];
  favorites: (string | number)[];
  purchased: Product[];
  onSend: (product: Product) => void;
}) {
  const [tab, setTab] = useState("search");
  const [searchQuery, setSearchQuery] = useState("");

  const tabs = [
    { id: "search", label: tr("البحث بالموقع") },
    { id: "fav", label: tr("المفضلة") },
    { id: "purchases", label: tr("المشتريات") },
    { id: "history", label: tr("سجل المشاهدة") },
  ];

  const history = useMemo(() => {
    if (typeof window === "undefined") return [] as Product[];
    try {
      const ids = JSON.parse(localStorage.getItem("recentlyViewed") ?? "[]") as (string | number)[];
      return ids
        .map((id) => products.find((product) => String(product.id) === String(id)))
        .filter((product): product is Product => Boolean(product));
    } catch {
      return [];
    }
  }, [products]);

  const getProducts = () => {
    if (tab === "search")
      return products
        .filter((product) =>
          String((product.titleEn || product.english_name || product.title) ?? "").includes(
            searchQuery,
          ),
        )
        .slice(0, 30);
    if (tab === "fav")
      return products.filter((product) =>
        favorites.some((id) => String(id) === String(product.id)),
      );
    if (tab === "purchases") return purchased;
    return history;
  };

  const list = getProducts();

  return (
    <div className="flex h-full flex-col overflow-y-auto pb-4 text-right" dir="rtl">
      <h2 className="mb-4 text-xl font-bold text-[var(--ink)]">{tr("إرسال منتج")}</h2>
      <div
        className="scrollbar-hide mb-4 flex shrink-0 gap-2 overflow-x-auto pb-2"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition-all cursor-pointer ${
              tab === t.id
                ? "bg-[var(--ink)] text-white shadow-xs"
                : "bg-[var(--surface-3)] text-[var(--ink)] hover:bg-[var(--line)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "search" && (
        <div className="relative mb-4 shrink-0">
          <input
            type="text"
            placeholder={tr("ابحث عن منتج...")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="h-[48px] w-full rounded-xl border border-[var(--line)] bg-card pl-4 pr-10 text-right focus:border-[var(--ink)] focus:outline-none"
          />
          <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--muted-ink)]" />
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto pb-4">
        {list.map((product) => (
          <div
            key={String(product.id)}
            className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-card p-3 shadow-xs transition-colors hover:border-[var(--ink)]/30"
          >
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg bg-[var(--surface)] text-2xl font-bold text-[var(--ink)]/30">
              {product.image ? (
                <img
                  src={cdnImage(String(product.image))}
                  alt={String((product.titleEn || product.english_name || product.title) ?? "")}
                  className="h-full w-full object-cover"
                />
              ) : (
                String((product.titleEn || product.english_name || product.title) ?? "?").slice(
                  0,
                  1,
                )
              )}
            </div>
            <div className="flex-1 text-right">
              <h3 className="line-clamp-1 text-[14px] font-semibold text-[var(--ink)]" dir="ltr">
                {String((product.titleEn || product.english_name || product.title) ?? "")}
              </h3>
              <p className="mb-1 text-[11px] text-[var(--muted-ink)]">
                {String(product.genre ?? product.publisher ?? "")}
              </p>
              <p className="text-[13px] font-bold text-[var(--ink)]">
                {priceOf(product).toLocaleString()}
              </p>
            </div>
            <button
              onClick={() => onSend(product)}
              className="shrink-0 rounded-xl bg-[var(--surface-3)] p-3 text-[var(--ink)] transition-colors hover:bg-[var(--ink)] hover:text-white cursor-pointer"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        ))}
        {list.length === 0 && (
          <div className="py-10 text-center">
            <ShoppingBag className="mx-auto mb-3 h-12 w-12 text-[var(--line)] opacity-50" />
            <p className="font-medium text-[var(--muted-ink)]">{tr("لا توجد منتجات مطابقة")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function LocationSelectionView({
  addresses,
  onSend,
}: {
  addresses: Address[];
  onSend: (label: string) => void;
}) {
  const [mode, setMode] = useState("list");
  const [newLocation, setNewLocation] = useState("");

  if (mode === "new") {
    return (
      <div
        className="flex h-full flex-col overflow-y-auto overflow-x-hidden pb-4 text-right"
        dir="rtl"
      >
        <div className="mb-4 flex items-center">
          <button
            onClick={() => setMode("list")}
            className="ml-auto rounded-full bg-[var(--surface-3)] p-2 text-[var(--ink)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="text-xl font-bold text-[var(--ink)]">{tr("موقع جديد")}</h2>
        </div>
        <div className="relative mb-4 flex h-48 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-3)]">
          <div className="relative z-10 flex flex-col items-center">
            <div className="absolute h-4 w-4 animate-ping rounded-full bg-red-500" />
            <MapPin className="relative z-10 -mt-5 h-10 w-10 text-red-600 drop-shadow-md" />
          </div>
        </div>
        <input
          type="text"
          value={newLocation}
          onChange={(event) => setNewLocation(event.target.value)}
          placeholder={tr("اكتب عنوان التوصيل بالتفصيل...")}
          className="mb-4 h-[48px] w-full shrink-0 rounded-xl border border-[var(--line)] bg-card px-4 text-right focus:border-[var(--ink)] focus:outline-none"
        />
        <button
          onClick={() => newLocation.trim() && onSend(newLocation.trim())}
          className={`w-full rounded-xl py-3 font-bold transition-colors cursor-pointer ${
            newLocation.trim()
              ? "bg-[var(--ink)] text-white hover:bg-[var(--ink-strong)]"
              : "cursor-not-allowed bg-[var(--line)] text-white"
          }`}
        >
          {tr("تأكيد وإرسال")}
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col overflow-y-auto overflow-x-hidden pb-4 text-right"
      dir="rtl"
    >
      <h2 className="mb-4 text-xl font-bold text-[var(--ink)]">{tr("إرسال موقع")}</h2>
      <div className="relative mb-4 flex h-32 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-3)] shadow-inner">
        <div className="relative z-10 flex items-center gap-2 rounded-full border border-white/60 bg-card/80 px-4 py-2 shadow-xs backdrop-blur-sm">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-sm font-bold text-[var(--ink)]">
            {tr("عناوين التوصيل الخاصة بك")}
          </span>
        </div>
      </div>
      <div className="space-y-3 overflow-y-auto pb-4">
        <h3 className="text-sm font-bold text-[var(--ink)]/70">{tr("عناويني المحفوظة")}</h3>
        {addresses.map((address) => (
          <button
            key={address.id}
            onClick={() =>
              onSend(
                `${address.label} (${address.city}${address.street ? `، ${address.street}` : ""})`,
              )
            }
            className="group flex w-full items-center justify-between rounded-xl border border-[var(--line)] bg-card p-4 shadow-xs transition-colors hover:border-[var(--ink)] cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-[var(--surface)] p-2 text-[var(--ink)]">
                <MapPin className="h-5 w-5" />
              </div>
              <span className="text-[14px] font-bold text-[var(--ink)]">{address.label}</span>
            </div>
            <Send className="h-4 w-4 text-[var(--muted-ink)] transition-colors group-hover:text-[var(--ink)]" />
          </button>
        ))}

        <button
          onClick={() => setMode("new")}
          className="mt-4 flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--ink)] p-4 text-white shadow-xs transition-colors hover:bg-[var(--ink-strong)] cursor-pointer"
        >
          <MapPin className="h-5 w-5" />
          <span className="text-[14px] font-bold">{tr("موقع جديد...")}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * The wallet inside the conversation is the same wallet as everywhere else.
 *
 * It used to show the sum of the member's orders under a "balance" heading and
 * offer three payment buttons that only posted a chat message — nothing it
 * displayed or did touched the real wallet. It now reads the real balance and
 * the real ledger, and tops up through the very same modal and endpoints as
 * /wallet, so a top-up started here is a top-up.
 *
 * Sending money to another person is not a feature this site has, so the
 * amount box is what it always really was: a message to support asking about a
 * transfer. It now says so, and refuses an amount the member does not have.
 */
function WalletView({
  onSend,
  settings,
}: {
  onSend: (value: string) => void;
  settings: Record<string, any>;
}) {
  const { currency, formatIQDPrice, getCurrencyInfo } = useCurrency();
  const activeCurrencyInfo = getCurrencyInfo(currency);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);

  const balance = Number(user?.walletBalance ?? 0);

  const transactions = useQuery({
    queryKey: ["wallet-transactions"],
    queryFn: () => walletApi.getTransactions(),
    enabled: Boolean(user),
  });

  const afterWalletChange = () => {
    void queryClient.invalidateQueries({ queryKey: ["me"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet-transactions"] });
    setIsTopUpOpen(false);
  };

  const recharge = useMutation({
    mutationFn: (payload: any) => walletApi.recharge({ ...payload, action: "recharge" }),
    onSuccess: () => {
      toast.success(tr("تم إرسال طلب الشحن للمراجعة"));
      afterWalletChange();
    },
    onError: (error: Error) => toast.error(error.message || tr("تعذر إرسال طلب الشحن")),
  });

  const consumeBanan = useMutation({
    mutationFn: (code: string) => walletApi.consumeBanan(code),
    onSuccess: (res: any) => {
      if (res?.success) {
        toast.success(
          `${tr("تم تفعيل الكود وإضافة")} ${Number(res.amount).toLocaleString()} ${tr("د.ع لرصيدك")}`,
        );
        afterWalletChange();
      } else {
        toast.error(res?.error || tr("كود غير صالح"));
      }
    },
    onError: (error: Error) => toast.error(error.message || tr("كود غير صالح")),
  });

  const numericAmount = Number(amount);
  const amountIsValid = Boolean(amount) && Number.isFinite(numericAmount) && numericAmount > 0;
  const overBalance = amountIsValid && numericAmount > balance;
  const recent = (transactions.data?.transactions ?? []).slice(0, 4);

  return (
    <div
      className="flex h-full flex-col overflow-y-auto overflow-x-hidden pb-4 text-right"
      dir="rtl"
    >
      <h2 className="mb-4 text-xl font-bold text-[var(--ink)]">{tr("المحفظة")}</h2>

      <div className="relative mb-6 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-[var(--ink)] to-[var(--ink-strong)] p-6 text-[var(--surface)] shadow-lg">
        <div className="absolute right-0 top-0 -mr-10 -mt-10 h-32 w-32 rounded-full bg-card/5 blur-xl" />
        <div className="absolute bottom-0 left-0 -mb-8 -ml-8 h-24 w-24 rounded-full bg-[#B497CF]/20 blur-lg" />

        <div className="relative z-10 flex items-start justify-between">
          <div>
            <p className="mb-1 text-sm font-medium opacity-80">{tr("رصيد المحفظة")}</p>
            <h3 className="mb-4 text-3xl font-black">{formatIQDPrice(balance)}</h3>
          </div>
          <Wallet className="h-8 w-8 opacity-50" />
        </div>
        <button
          onClick={() => setIsTopUpOpen(true)}
          className="relative z-10 flex w-fit items-center gap-1 rounded-xl bg-card px-4 py-2 text-sm font-bold text-[var(--ink)] transition-colors hover:bg-[var(--surface)] cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          {tr("تعبئة الرصيد")}
        </button>
      </div>

      {recent.length > 0 && (
        <div className="mb-6 space-y-2">
          <h3 className="text-sm font-bold text-[var(--ink)]/70">{tr("آخر الحركات")}</h3>
          <div className="space-y-1.5">
            {recent.map((entry: any) => {
              const value = Number(entry?.amount ?? 0);
              return (
                <div
                  key={String(entry?.id ?? `${entry?.createdAt}-${value}`)}
                  className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-card px-3 py-2 text-xs"
                >
                  <span className="truncate font-medium text-[var(--ink)]/80">
                    {String(entry?.description || entry?.type || tr("حركة على المحفظة"))}
                  </span>
                  <span
                    className={`shrink-0 font-bold ${
                      value < 0 ? "text-rose-600" : "text-emerald-600"
                    }`}
                  >
                    {value < 0 ? "−" : "+"}
                    {formatIQDPrice(Math.abs(value))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!confirmStep ? (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-[var(--ink)]/70">
            {tr("اطلب تحويل مبلغ عبر الدعم")}
          </h3>
          <p className="-mt-2 text-[11px] leading-relaxed text-[var(--muted-ink)]">
            {tr("يصل الطلب للدعم في هذه المحادثة، ولا يُخصم أي مبلغ إلا بعد موافقتك مع الفريق.")}
          </p>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              className="h-[56px] w-full rounded-xl border border-[var(--line)] bg-card px-4 text-right text-lg font-bold focus:border-[var(--ink)] focus:outline-none"
            />
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-[var(--muted-ink)]">
              {activeCurrencyInfo?.symbol || "د.ع"}
            </span>
          </div>
          {overBalance && (
            <p className="text-xs font-bold text-rose-600">
              {tr("المبلغ أكبر من رصيدك الحالي")} — {formatIQDPrice(balance)}
            </p>
          )}
          <button
            onClick={() => {
              if (amountIsValid && !overBalance) setConfirmStep(true);
            }}
            disabled={!amountIsValid || overBalance}
            className={`h-[56px] w-full rounded-xl text-lg font-bold text-white transition-colors cursor-pointer ${
              amountIsValid && !overBalance
                ? "bg-[var(--ink)] hover:bg-[var(--ink-strong)]"
                : "cursor-not-allowed bg-[var(--line)]"
            }`}
          >
            {tr("تأكيد")}
          </button>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="space-y-5 rounded-2xl border border-[var(--line)] bg-card p-6 shadow-xs"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--ink)]">
            <Send className="ml-1 h-6 w-6" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-bold text-[var(--ink)]">{tr("تأكيد الطلب")}</h3>
            <p className="mt-2 text-[var(--ink)]/70">
              {tr("سنرسل للدعم طلب تحويل بقيمة")}{" "}
              <span className="text-lg font-bold text-[var(--ink)]">
                {amount} {activeCurrencyInfo?.symbol || "د.ع"}
              </span>
            </p>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setConfirmStep(false)}
              className="h-[50px] flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] font-bold text-[var(--ink)] transition-colors hover:bg-[var(--surface-3)] cursor-pointer"
            >
              {tr("إلغاء")}
            </button>
            <button
              onClick={() => onSend(amount)}
              className="h-[50px] flex-[2] rounded-xl bg-[var(--ink)] font-bold text-white transition-colors hover:bg-[var(--ink-strong)] cursor-pointer"
            >
              {tr("إرسال الطلب")}
            </button>
          </div>
        </motion.div>
      )}

      <TopUpModal
        open={isTopUpOpen}
        onOpenChange={setIsTopUpOpen}
        onSuccess={afterWalletChange}
        settings={settings}
        onRecharge={(payload: any) => recharge.mutateAsync(payload)}
        onConsumeBanan={(code: string) => consumeBanan.mutateAsync(code)}
        isPending={recharge.isPending || consumeBanan.isPending}
      />
    </div>
  );
}

export default function ChatView({
  onBack,
  initialThreadId,
  initialOrderId,
}: {
  onBack?: () => void;
  initialThreadId?: string;
  initialOrderId?: string;
}) {
  const { currency, getCurrencyInfo } = useCurrency();
  const activeCurrencyInfo = getCurrencyInfo(currency);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = Boolean(user?.isAdmin);

  const [inputText, setInputText] = useState("");
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [localMessages, setLocalMessages] = useState<DisplayMessage[]>([]);
  const [serverMessages, setServerMessages] = useState<DisplayMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const [isSelfTyping, setIsSelfTyping] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [unreadCountBelow, setUnreadCountBelow] = useState(0);
  const [showScrollBottomPill, setShowScrollBottomPill] = useState(false);

  // Search state
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<string[]>([
    "تصفح الألعاب",
    "أحدث الإكسسوارات",
    "تحدث مع الدعم",
  ]);
  const [selectedNav, setSelectedNav] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | undefined>(initialThreadId);
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  /**
   * Set when the conversation could not be loaded, so the screen can say so
   * instead of looking like an empty chat. Bumping `threadReloadKey` re-runs
   * the fetch effect, which is what makes "إعادة المحاولة" a real round trip
   * to the backend rather than a re-render of stale state.
   */
  const [threadLoadError, setThreadLoadError] = useState<string | null>(null);
  const [threadReloadKey, setThreadReloadKey] = useState(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "paused">("idle");
  const [recordingTime, setRecordingTime] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- live data from the store / account -------------------------------
  const storeQuery = useQuery({ queryKey: ["store"], queryFn: () => api.store() });
  const ordersQuery = useQuery({
    queryKey: ["orders"],
    queryFn: () => api.orders(),
    enabled: Boolean(user),
  });
  const threadsQuery = useQuery({
    queryKey: ["threads"],
    queryFn: () => api.threads(),
    enabled: Boolean(user),
    refetchInterval: 12_000,
  });

  const products = storeQuery.data?.products ?? [];
  const settings = (storeQuery.data?.settings ?? {}) as Record<string, unknown>;
  const orders = ordersQuery.data?.orders ?? [];
  const threads = threadsQuery.data?.threads ?? [];

  /**
   * Open the conversation that belongs to an order arriving in the URL.
   *
   * The URL *seeds* the conversation; it does not own it. Both effects below
   * used to re-apply their parameter on every run, which meant that from
   * `/chat?orderId=…` the customer could not leave: picking another
   * conversation in the history drawer, or pressing "بدء محادثة جديدة", was
   * undone on the next render and snapped them straight back into the order
   * thread. Each parameter is therefore consumed exactly once, and after that
   * the customer's own navigation decides which conversation is open.
   */
  const resolvedOrderThreadRef = useRef<string | null>(null);
  const consumedThreadParamRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialThreadId) return;
    if (consumedThreadParamRef.current === initialThreadId) return;
    consumedThreadParamRef.current = initialThreadId;
    if (threadId !== initialThreadId) {
      setThreadId(initialThreadId);
    }
  }, [initialThreadId, threadId]);

  useEffect(() => {
    if (!initialOrderId) return;
    if (resolvedOrderThreadRef.current === initialOrderId) return;

    const fromOrder = orders.find((order) => order.id === initialOrderId || order.code === initialOrderId)?.threadId;
    const fromThreads = threads.find((thread) => thread.orderId === initialOrderId || thread.subject?.includes(initialOrderId))?.id;
    const target = fromOrder || fromThreads;
    if (target) {
      resolvedOrderThreadRef.current = initialOrderId;
      setThreadId(target);
      return;
    }

    // Direct lookup fallback if query hasn't synced yet
    let active = true;
    api
      .threadMessages(undefined, { orderId: initialOrderId })
      .then((res) => {
        if (active && res?.thread?.id) {
          resolvedOrderThreadRef.current = initialOrderId;
          setThreadId(res.thread.id);
        }
      })
      .catch(() => {
        api
          .order(initialOrderId)
          .then((res) => {
            if (active && res?.order?.threadId) {
              resolvedOrderThreadRef.current = initialOrderId;
              setThreadId(res.order.threadId);
            }
          })
          .catch(() => {});
      });

    return () => {
      active = false;
    };
  }, [initialOrderId, orders, threads, threadId]);

  /**
   * A signed-in member always talks in a real conversation.
   *
   * Only while nothing else has claimed the slot: a URL seed that has not been
   * applied yet owns the first conversation, and "بدء محادثة جديدة" means the
   * customer wants a blank one — re-opening their existing automated thread
   * would silently undo the button they just pressed.
   */
  const startedBlankChatRef = useRef(false);

  useEffect(() => {
    if (!user || threadId) return;
    /*
      A URL that names a conversation owns the slot — including the render or
      two before its `setThreadId` lands. Gating on "has the seed resolved yet"
      instead looked equivalent but raced: with a warm query cache both effects
      run in the same commit, the seed sets its ref synchronously, and this
      fallback's `setThreadId` was simply the last write — so `/chat?
      initialOrderId=…` opened the automated conversation instead of the order.
    */
    if (initialOrderId || initialThreadId) return;
    if (startedBlankChatRef.current) return;
    const existing = threads.find(
      (thread) =>
        thread.chatType === "AUTOMATED_SUPPORT" && thread.status === "open" && !thread.orderId,
    );
    if (existing) setThreadId(existing.id);
  }, [user, threadId, initialOrderId, initialThreadId, threads]);

  const purchased = useMemo(() => {
    const ids = new Set(
      orders.flatMap((order) => order.items.map((item) => String(item.productId))),
    );
    return products.filter((product) => ids.has(String(product.id)));
  }, [orders, products]);
  const isHumanChat = Boolean(threadId);

  const currentThread = useMemo(
    () => (threadId ? threads.find((t) => t.id === threadId) : null),
    [threads, threadId],
  );

  // STRICT ORDER ISOLATION: Never let initialOrderId bleed into unrelated conversations
  const activeOrderId = useMemo(() => {
    if (currentThread) {
      return currentThread.orderId;
    }
    if (!threadId && initialOrderId) {
      return initialOrderId;
    }
    if (threadId && threadId === initialThreadId && initialOrderId) {
      return initialOrderId;
    }
    return undefined;
  }, [currentThread, threadId, initialOrderId, initialThreadId]);

  const currentOrder = useMemo(
    () => (activeOrderId ? orders.find((o) => o.id === activeOrderId || o.code === activeOrderId) : null),
    [activeOrderId, orders],
  );

  const isOrderMode = Boolean(
    activeOrderId ||
    currentThread?.chatType === "ORDER_SUPPORT" ||
    currentThread?.chatType === "DELIVERY" ||
    currentThread?.mode === "ORDER_PREPARATION",
  );

  const orderThreads = useMemo(() => {
    return threads
      .filter(
        (t) =>
          t.status === "open" &&
          (Boolean(t.orderId) || t.chatType === "ORDER_SUPPORT" || t.mode === "ORDER_PREPARATION"),
      )
      .sort(
        (a, b) =>
          new Date(a.queueEnteredAt || a.createdAt).getTime() -
          new Date(b.queueEnteredAt || b.createdAt).getTime(),
      );
  }, [threads]);

  const currentQueueIndex = useMemo(() => {
    if (!threadId && !activeOrderId) return 1;
    const idx = orderThreads.findIndex(
      (t) => t.id === threadId || (activeOrderId && t.orderId === activeOrderId),
    );
    return idx >= 0 ? idx + 1 : 1;
  }, [orderThreads, threadId, activeOrderId]);

  const adminAvailability = (threadsQuery.data as any)?.adminAvailability;
  const adminPresenceOnline = (storeQuery.data as any)?.adminPresence?.online ?? true;
  const adminStatus: "available" | "busy" | "offline" = useMemo(() => {
    if (adminAvailability && !adminAvailability.isAvailable) return "offline";
    if (!adminPresenceOnline) return "offline";
    if (orderThreads.length > 3) return "busy";
    return "available";
  }, [adminAvailability, adminPresenceOnline, orderThreads.length]);

  const [selectedInvoiceOrder, setSelectedInvoiceOrder] = useState<Order | null>(null);

  /* ------------------------- live queue metrics ------------------------- */
  const [liveQueueMetrics, setLiveQueueMetrics] = useState<{
    position?: number;
    aheadCount?: number;
    estimatedWaitTime?: string;
    estimatedMinutesText?: string;
    totalWaiting?: number;
    adminStatus?: "available" | "busy" | "offline";
    deliveryStage?: "awaiting_login_proof" | "proof_received" | "otp_sent" | string;
    activeOrderItemId?: string;
    activeDeliveryItemId?: string;
  } | null>(null);

  /* ------------------------- human support countdown ------------------------- */
  const [supportCountdown, setSupportCountdown] = useState<{
    active: boolean;
    secondsRemaining: number;
  } | null>(null);
  const supportCountdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  /* ------------------------- order delivery steps ------------------------- */
  const proofInputRef = useRef<HTMLInputElement | null>(null);
  const proofItemRef = useRef<{ itemId: string; deliveryItemId?: string } | null>(null);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [proofSentItems, setProofSentItems] = useState<Record<string, boolean>>({});

  /**
   * Maps one wire row to the shape the bubbles render from.
   *
   * Returns `null` for a row that is not an object at all; everything else is
   * repaired by {@link normalizeWireMessage} first, so no branch below can
   * throw on a missing `body` or a string where an object was expected.
   */
  const mapServerMessage = useCallback((raw: ChatMessage): DisplayMessage | null => {
    if (!raw || typeof raw !== "object") return null;
    // Repair the shape first. Live rows arrive straight off the SSE stream and
    // never passed through the store's reader, so this is not redundant.
    const message = readMessageRow({ doc: raw, rowId: raw.id, threadId: raw.threadId });
    /*
      A row that could not be read at all comes back repaired but empty — no
      text, no attachment, no card — and rendering it would put a blank bubble
      in the conversation.
    */
    if (isEmptyMessage(message)) return null;
    const mine = message.senderRole === "user";
    const imageUrl =
      typeof message.body["imageUrl"] === "string" ? message.body["imageUrl"] : undefined;

    if (message.body?.["type"] === "digital_order_card" || message.kind === "digital_order_card") {
      return {
        id: message.id,
        sender: "ai",
        text: String(message.body?.["text"] ?? ""),
        type: "digital_order_card" as const,
        payload: message.body,
        createdAt: message.createdAt,
        status: "sent",
      };
    }

    if (message.kind === "review_request" || message.body?.["type"] === "review_request") {
      return {
        id: message.id,
        sender: "ai",
        text: String(message.body?.["text"] ?? "تقييم الطلب"),
        type: "review_request" as const,
        payload: message.body,
        createdAt: message.createdAt,
        status: "sent",
      };
    }

    if (message.kind === "order_completed" || message.body?.["type"] === "order_completed") {
      return {
        id: message.id,
        sender: mine ? "user" : "ai",
        text: String(message.body?.["text"] ?? "تم اكتمال الطلب بنجاح ✅"),
        type: "order_completed" as const,
        payload: message.body,
        createdAt: message.createdAt,
        status: "sent",
      };
    }

    const cardType = accountCardTypeFor(message.kind);
    if (cardType) {
      return {
        id: message.id,
        sender: mine ? "user" : "ai",
        text: String(message.body?.["text"] ?? ""),
        type: "account_card" as const,
        payload: { kind: message.kind, body: message.body },
        createdAt: message.createdAt,
        status: "sent",
      };
    }
    return {
      id: message.id,
      sender: mine ? "user" : "ai",
      text: String(message.body?.["text"] ?? (imageUrl ? "مرفق" : "")),
      payload: message.body,
      createdAt: message.createdAt,
      status: "sent",
      ...(imageUrl ? { type: "image" as const, payload: { ...message.body, imageUrl } } : {}),
    };
  }, []);

  /**
   * Maps a whole page of rows.
   *
   * One unrenderable row must not cost the customer the conversation, so each
   * is mapped inside its own guard: a failure drops that single bubble and logs
   * its id, and the rest of the thread still paints. Nothing about the row's
   * contents is logged — a message body can hold credentials.
   */
  const mapServerMessages = useCallback(
    (rows: readonly ChatMessage[] | null | undefined): DisplayMessage[] => {
      if (!Array.isArray(rows)) return [];
      const mapped: DisplayMessage[] = [];
      rows.forEach((row, index) => {
        try {
          const display = mapServerMessage(row);
          if (!display) {
            // Log the id only — a message body can carry account credentials.
            console.warn("[chat:message_unreadable]", { id: row?.id ?? null, index });
            return;
          }
          mapped.push(display);
        } catch (err) {
          console.warn(
            "[chat:message_skipped]",
            { id: (row as { id?: unknown } | null)?.id ?? null, index },
            err,
          );
        }
      });
      return mapped;
    },
    [mapServerMessage],
  );

  const reloadThread = useCallback(async () => {
    if (!threadId) return;
    const res = await api.threadMessages(threadId, { limit: 30 });
    setServerMessages(mapServerMessages(res.messages));
    setHasMore(res.hasMore ?? false);
    setNextCursor(res.nextCursor ?? null);
    if ((res as any).queueMetrics) {
      setLiveQueueMetrics((res as any).queueMetrics);
    }
  }, [threadId, mapServerMessages]);

  /** Upload the member's sign-in screenshot and attach it to the order line. */
  const submitLoginProof = async (file: File) => {
    const target = proofItemRef.current;
    const itemId =
      target?.itemId || liveQueueMetrics?.activeOrderItemId || currentOrder?.items?.[0]?.id;
    const deliveryItemId = target?.deliveryItemId || liveQueueMetrics?.activeDeliveryItemId;
    const orderId = currentOrder?.id || currentThread?.orderId;
    if (!orderId) {
      toast.error(tr("تعذر تحديد الطلب لإرسال الإثبات"));
      return;
    }
    setDeliveryBusy(true);
    try {
      const { url } = await uploadFileWithProgress(file, "orders");
      await api.orderAction({
        orderId,
        action: "submit_login_proof",
        itemId: itemId || undefined,
        deliveryItemId: deliveryItemId || undefined,
        imageUrl: url,
      });
      const resolvedKey = deliveryItemId || itemId || "default";
      setProofSentItems((prev) => ({
        ...prev,
        [resolvedKey]: true,
      }));
      toast.success(tr("تم إرسال صورة إثبات تسجيل الدخول بنجاح! المشرف سيرسل لك كود OTP."));
      await reloadThread();
    } catch (err: any) {
      console.error("Failed to submit the sign-in proof", err);
      toast.error(err?.message || tr("تعذر إرسال صورة الإثبات، حاول مرة أخرى"));
    } finally {
      setDeliveryBusy(false);
    }
  };

  /** Ask for the next prepared account, or finish when the line is done. */
  const requestNextAccount = async (itemId: string) => {
    const orderId = currentOrder?.id;
    if (!orderId) return;
    setDeliveryBusy(true);
    try {
      const res = await api.orderAction({ orderId, action: "account_next", itemId });
      await reloadThread();
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      if (res?.released) {
        toast.success(tr("تم إرسال الحساب التالي"));
      } else {
        toast.message(tr("لا يوجد حساب جاهز بعد — سيصلك فور تجهيزه"));
      }
    } catch (err) {
      console.error("Failed to request the next account", err);
      toast.error(tr("تعذر طلب الحساب التالي"));
    } finally {
      setDeliveryBusy(false);
    }
  };

  const [isConfirmingReceipt, setIsConfirmingReceipt] = useState(false);
  const [isReportingDeliveryIssue, setIsReportingDeliveryIssue] = useState(false);

  const canConfirmOrderReceipt = useMemo(() => {
    return currentOrder?.status === "awaiting_customer_confirmation";
  }, [currentOrder]);

  const handleConfirmOrderReceipt = async () => {
    if (!currentOrder || isConfirmingReceipt) return;
    setIsConfirmingReceipt(true);
    try {
      const res = await api.orderAction({
        orderId: currentOrder.id,
        action: "confirm_received",
      });
      toast.success(tr("✅ تم استلام الطلب وتأكيده بنجاح!"));
      await reloadThread();
      /*
        `currentOrder` is derived from the orders query, not local state, so
        there is nothing to set — invalidating is what refreshes it. The old
        `setCurrentOrder(res.order)` call referenced a setter that does not
        exist and threw the moment a customer pressed "تم استلام الطلب".
      */
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["order", currentOrder.id] });
    } catch (err: any) {
      console.error("Failed to confirm order receipt", err);
      toast.error(err?.message || tr("فشل تأكيد استلام الطلب"));
    } finally {
      setIsConfirmingReceipt(false);
    }
  };

  const handleReportDeliveryIssue = async () => {
    if (!currentOrder || isReportingDeliveryIssue) return;
    const reason = window.prompt(tr("صف مشكلة التسليم باختصار ليتم تحويلها للإدارة:"));
    if (reason === null) return;
    setIsReportingDeliveryIssue(true);
    try {
      const res = await api.orderAction({
        orderId: currentOrder.id,
        action: "report_delivery_issue",
        reason: reason.trim() || undefined,
      });
      toast.success(tr("تم إيقاف الإكمال التلقائي وتحويل الطلب للمراجعة"));
      await reloadThread();
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["order", currentOrder.id] });
    } catch (err: any) {
      console.error("Failed to report delivery issue", err);
      toast.error(err?.message || tr("تعذر فتح بلاغ التسليم"));
    } finally {
      setIsReportingDeliveryIssue(false);
    }
  };

  const createThread = useMutation({
    mutationFn: (args?: string | { subject?: string; chatType?: ChatType; orderId?: string }) => {
      if (typeof args === "string") {
        return api.createThread(args);
      }
      return api.createThread(args?.subject, args?.chatType, args?.orderId);
    },
    onSuccess: (data) => {
      setThreadId(data.thread.id);
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  // Fetch initial paginated messages when threadId or activeOrderId changes with strict AbortController and state isolation
  useEffect(() => {
    // 1. Cancel previous pending fetch if any
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }

    // 2. Immediately purge state to ensure no cross-conversation contamination
    setServerMessages([]);
    setLocalMessages([]);
    setHasMore(false);
    setNextCursor(null);
    setIsLoadingOlder(false);
    setLiveQueueMetrics(null);
    setIsPeerTyping(false);
    setIsSelfTyping(false);
    setIsSearching(false);
    setSearchQuery("");
    setSearchResults([]);
    setHighlightedMessageId(null);
    setUnreadCountBelow(0);
    setShowScrollBottomPill(false);
    setThreadLoadError(null);

    if (supportCountdownTimerRef.current) {
      clearInterval(supportCountdownTimerRef.current);
      supportCountdownTimerRef.current = null;
    }
    setSupportCountdown(null);

    const targetOrderId = activeOrderId || initialOrderId;
    if (!threadId && !targetOrderId) {
      setIsThreadLoading(false);
      return;
    }

    setIsThreadLoading(true);
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;

    void (async () => {
      try {
        const res = await api.threadMessages(threadId, {
          orderId: targetOrderId,
          limit: 20,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        if (res.thread?.id && !threadId) {
          setThreadId(res.thread.id);
        }

        setServerMessages(mapServerMessages(res.messages));
        setHasMore(res.hasMore ?? false);
        setNextCursor(res.nextCursor ?? null);
        if ((res as any).queueMetrics) {
          setLiveQueueMetrics((res as any).queueMetrics);
        }
        if (typeof res.isOnline === "boolean") {
          setIsOnline(res.isOnline);
        }
        // Mark read
        if (res.thread?.id || threadId) {
          void api.markThreadRead((res.thread?.id || threadId)!);
        }
      } catch (err: any) {
        if (err?.name === "AbortError" || controller.signal.aborted) {
          return; // Aborted request, ignore safely
        }
        console.error(
          `[chat:thread_load_failed] conversation_id=${threadId || "none"} order_id=${targetOrderId || "none"} user_id=${user?.id || "guest"} HTTP_status=${err?.status || 500} D1_error=${err?.message || String(err)} endpoint=/api/chat`,
          err,
        );
        setThreadLoadError(String(err?.message || err) || "unknown_error");
      } finally {
        if (!controller.signal.aborted) {
          setIsThreadLoading(false);
        }
      }
    })();

    // Heartbeat presence interval
    const activeTargetId = threadId || targetOrderId;
    const presenceInterval = setInterval(() => {
      if (!controller.signal.aborted && activeTargetId) {
        void api.sendPresence(activeTargetId);
      }
    }, 45_000);
    if (activeTargetId) {
      void api.sendPresence(activeTargetId);
    }

    return () => {
      controller.abort();
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null;
      }
      clearInterval(presenceInterval);
    };
  }, [threadId, activeOrderId, initialOrderId, threadReloadKey, mapServerMessages, user?.id]);

  useChatRealtime({
    threadId: threadId || null,
    surface: "user",
    onMessageCreated: (rawMsg, clientMsgId) => {
      setServerMessages((prev) => {
        const existsById = prev.some((m) => m.id === rawMsg.id);
        if (existsById) return prev;

        const existingTempIndex = clientMsgId
          ? prev.findIndex((m) => m.clientMessageId === clientMsgId || m.id === clientMsgId)
          : -1;

        const mapped = mapServerMessage(rawMsg);
        // An unreadable live row is dropped, not rendered as a broken bubble.
        if (!mapped) return prev;
        if (existingTempIndex !== -1) {
          const copy = [...prev];
          copy[existingTempIndex] = { ...mapped, status: "sent" };
          return copy;
        }
        return [...prev, mapped];
      });

      const container = messagesContainerRef.current;
      if (container) {
        const distanceFromBottom =
          container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceFromBottom > 150) {
          setUnreadCountBelow((c) => c + 1);
          setShowScrollBottomPill(true);
        } else {
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
          }, 50);
        }
      }
    },
    onTypingUpdate: (typers) => {
      const isAnyAdminTyping = typers.some((t) => t.senderRole !== "user");
      setIsPeerTyping(isAnyAdminTyping);
    },
    onPresenceUpdate: () => {
      // In customer chat, if we get an update, we assume admin is online
      setIsOnline(true);
    },
    onQueueUpdated: (metrics) => {
      if (metrics) {
        setLiveQueueMetrics(metrics);
      }
    },
  });

  // Load older messages (Cursor Pagination with scroll preservation)
  const handleLoadOlder = async () => {
    if (!threadId || !nextCursor || isLoadingOlder) return;
    const targetThreadId = threadId;
    setIsLoadingOlder(true);

    const container = messagesContainerRef.current;
    const prevScrollHeight = container ? container.scrollHeight : 0;
    const prevScrollTop = container ? container.scrollTop : 0;

    try {
      const res = await api.threadMessages(threadId, { before: nextCursor, limit: 15 });
      // Drop results if user switched threads while loading older messages
      if (threadId !== targetThreadId) return;

      const olderMapped = mapServerMessages(res.messages);

      setServerMessages((prev) => [...olderMapped, ...prev]);
      setHasMore(res.hasMore ?? false);
      setNextCursor(res.nextCursor ?? null);

      // Restore scroll offset so view doesn't jump
      requestAnimationFrame(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
      });
    } catch (err) {
      console.error("Failed to load older messages", err);
    } finally {
      setIsLoadingOlder(false);
    }
  };

  // Debounced in-thread search
  useEffect(() => {
    if (!threadId || !isSearching || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearchLoading(true);
      try {
        const res = await api.searchThreadMessages(threadId, searchQuery.trim());
        setSearchResults(res.results || []);
      } catch (err) {
        console.error("In-thread search failed", err);
      } finally {
        setIsSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [threadId, isSearching, searchQuery]);

  // Jump to searched message
  const jumpToMessage = (msgId: string) => {
    setHighlightedMessageId(msgId);
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setTimeout(() => {
      setHighlightedMessageId(null);
    }, 2500);
  };

  // Scroll listener for "Scroll to bottom" button
  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 100) {
      setShowScrollBottomPill(false);
      setUnreadCountBelow(0);
    }
  };

  // Emit typing indicator with debounce
  const handleInputChange = (val: string) => {
    setInputText(val);
    if (!threadId) return;

    if (!isSelfTyping) {
      setIsSelfTyping(true);
      void api.sendTyping(threadId, true);
    }

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      setIsSelfTyping(false);
      void api.sendTyping(threadId, false);
    }, 2500);
  };

  // Auto-scroll on initial load or new messages if near bottom
  useEffect(() => {
    if (!showScrollBottomPill) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [serverMessages.length, localMessages.length, isPeerTyping]);

  // Deduplicate and sanitize messages to prevent duplicate cards and double rendering
  const messages = useMemo(() => {
    const rawList: DisplayMessage[] = isHumanChat ? serverMessages : localMessages;
    const seenIds = new Set<string>();
    const seenOtpKeys = new Set<string>();
    const filtered: DisplayMessage[] = [];

    for (const msg of rawList) {
      if (!msg || !msg.id) continue;

      // Deduplicate by message ID or clientMessageId
      if (seenIds.has(msg.id)) continue;
      if (msg.clientMessageId && seenIds.has(msg.clientMessageId)) continue;

      // Deduplicate OTP verification code messages
      if (msg.type === "account_card" && msg.payload) {
        const payload = msg.payload as Record<string, unknown>;
        const kind = String(payload["kind"] ?? "");
        const body = (payload["body"] as Record<string, unknown> | undefined) ?? {};

        if (kind === "item_verification_code" || kind === "otp" || kind === "verification") {
          const itemId = String(body["itemId"] ?? "");
          const code = String(body["code"] ?? body["verificationCode"] ?? "");
          const otpKey = `${itemId}:${code}`;

          if (code && seenOtpKeys.has(otpKey)) {
            // Already rendered this exact OTP for this item
            continue;
          }
          if (code) {
            seenOtpKeys.add(otpKey);
          }
        }
      }

      seenIds.add(msg.id);
      if (msg.clientMessageId) seenIds.add(msg.clientMessageId);
      filtered.push(msg);
    }

    return filtered;
  }, [isHumanChat, serverMessages, localMessages]);

  const pushLocal = (message: DisplayMessage) => setLocalMessages((prev) => [...prev, message]);

  const hasAccountCards = useMemo(
    () => messages.some((m) => m.type === "account_card"),
    [messages],
  );

  useEffect(() => {
    if (isOrderMode) {
      if (currentOrder?.status === "completed") {
        setSuggestions([
          "شكراً لكم، تم الاستلام بنجاح ✨",
          "تقييم الخدمة",
          "تفاصيل الفاتورة",
          "طلب لعبة جديدة",
        ]);
      } else if (hasAccountCards) {
        setSuggestions([
          "تم تسجيل الدخول بنجاح 👍",
          "واجهت مشكلة في كلمة المرور",
          "كيف أفعل الحساب كجهاز رئيسي؟",
          "طلب رمز التحقق 2FA",
          "تفاصيل الفاتورة",
        ]);
      } else {
        setSuggestions([
          "كم الوقت المتبقي للتسليم؟",
          "أنا جاهز لاستلام الحساب",
          "تفاصيل الفاتورة",
          "هل يمكن تعديل بيانات الطلب؟",
        ]);
      }
    } else {
      setSuggestions(["تصفح الألعاب", "أحدث الإكسسوارات", "تحدث مع الدعم"]);
    }
  }, [isOrderMode, currentOrder?.status, hasAccountCards]);

  // Send message handler with optimistic UI
  const handleSend = async (customText?: string) => {
    const value = (customText !== undefined ? customText : inputText).trim();
    if (!value) return;

    if (
      value === "تفاصيل الفاتورة" ||
      value.toLowerCase() === "invoice details" ||
      value === "الفاتورة"
    ) {
      if (currentOrder) {
        setSelectedInvoiceOrder(currentOrder);
      }
    }

    setInputText("");
    if (threadId && isSelfTyping) {
      setIsSelfTyping(false);
      void api.sendTyping(threadId, false);
    }

    const lowerVal = value.toLowerCase().trim();
    if (
      value === "تحدث مع الدعم" ||
      value === "تحدث مع الإدارة" ||
      value === "الدعم البشري" ||
      lowerVal === "talk to support" ||
      lowerVal === "live support" ||
      lowerVal === "human support" ||
      lowerVal === "talk to admin" ||
      lowerVal === "destekle görüş" ||
      lowerVal === "bi piştgiriyê re biaxive"
    ) {
      void handleRequestHumanSupport();
      return;
    }

    if (isHumanChat && threadId) {
      const clientMessageId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const optimisticMsg: DisplayMessage = {
        id: clientMessageId,
        clientMessageId,
        sender: "user",
        text: value,
        createdAt: new Date().toISOString(),
        status: "sending",
      };

      setServerMessages((prev) => [...prev, optimisticMsg]);
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

      try {
        const res = await api.sendMessage({
          threadId,
          text: value,
          clientMessageId,
          pageContext: {
            path: typeof window !== "undefined" ? window.location.pathname : "/chat",
          },
          viewHistory: viewHistoryForSupport(),
        });

        // Update optimistic item with confirmed message
        setServerMessages((prev) =>
          prev.map((m) =>
            m.clientMessageId === clientMessageId ? ({ ...res.message, status: "sent" } as any) : m,
          ),
        );

        const chips = (res.assistant?.body?.["suggestions"] as string[] | undefined) ?? [];
        if (chips.length) setSuggestions(chips);
      } catch (err) {
        setServerMessages((prev) =>
          prev.map((m) => (m.clientMessageId === clientMessageId ? { ...m, status: "failed" } : m)),
        );
      }
      return;
    }

    // A signed-in member with no conversation yet gets one created now, so the
    // message is stored and answered in a thread rather than in page state.
    if (user) {
      try {
        const created = await createThread.mutateAsync({
          subject: "محادثة المساعد الآلي",
          chatType: "AUTOMATED_SUPPORT",
        });
        const newThreadId = created?.thread?.id;
        if (newThreadId) {
          setThreadId(newThreadId);
          const clientMessageId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          setServerMessages([
            {
              id: clientMessageId,
              clientMessageId,
              sender: "user",
              text: value,
              createdAt: new Date().toISOString(),
              status: "sending",
            },
          ]);
          const res = await api.sendMessage({
            threadId: newThreadId,
            text: value,
            clientMessageId,
            pageContext: {
              path: typeof window !== "undefined" ? window.location.pathname : "/chat",
            },
            viewHistory: viewHistoryForSupport(),
          });
          const echoed = mapServerMessage(res.message);
          setServerMessages((prev) =>
            prev.map((m) =>
              m.clientMessageId === clientMessageId && echoed ? { ...echoed, status: "sent" } : m,
            ),
          );
          const assistantReply = res.assistant ? mapServerMessage(res.assistant) : null;
          if (assistantReply) {
            setServerMessages((prev) => [...prev, assistantReply]);
          }
          void queryClient.invalidateQueries({ queryKey: ["threads"] });
          return;
        }
      } catch (err) {
        console.error("Failed to open a support conversation", err);
      }
    }

    // Local / Guest AI chat
    pushLocal({
      id: Date.now().toString(),
      sender: "user",
      text: value,
      createdAt: new Date().toISOString(),
      status: "sent",
    });
    setIsPeerTyping(true);

    const reply = supportAnswer(value, {
      products,
      orders,
      guides: (settings["guides"] as SupportContext["guides"]) ?? [],
      policies: (settings["policies"] as SupportContext["policies"]) ?? [],
      currencySymbol: activeCurrencyInfo?.symbol,
      ...(user?.name ? { userName: user.name } : {}),
    });

    setTimeout(() => {
      const stamp = Date.now();
      pushLocal({
        id: `${stamp}-ai`,
        sender: "ai",
        text: reply.text,
        createdAt: new Date().toISOString(),
        status: "sent",
      });
      reply.cards.forEach((card, index) => {
        if (card.kind === "product") {
          pushLocal({
            id: `${stamp}-card-${index}`,
            sender: "ai",
            text: card.text,
            type: "product",
            payload: { id: card.id, name: card.name, image: card.image ?? "" },
            createdAt: new Date().toISOString(),
            status: "sent",
          });
        } else if (card.kind === "image") {
          pushLocal({
            id: `${stamp}-card-${index}`,
            sender: "ai",
            text: card.text,
            type: "image",
            payload: { imageUrl: card.url },
            createdAt: new Date().toISOString(),
            status: "sent",
          });
        }
      });
      setIsPeerTyping(false);
      setSuggestions(
        reply.suggestions.length ? reply.suggestions : ["تصفح الألعاب", "تحدث مع الدعم"],
      );
    }, 350);
  };

  // Retry sending a failed message
  const handleRetry = async (msg: DisplayMessage) => {
    if (!threadId) return;
    /*
      A retry that carries a `blob:` URL is a retry that cannot work: it is a
      handle to a file in this tab's memory, and `isOwnUploadUrl` refuses it.
      The bubble adopts the stored URL as soon as the upload returns, so this
      only trips when the upload itself never finished — in which case the
      member needs to attach the file again, not press retry forever.
    */
    const pendingImage = msg.payload?.["imageUrl"];
    if (typeof pendingImage === "string" && pendingImage.startsWith("blob:")) {
      toast.error("لم يكتمل رفع الصورة. أعد إرفاقها من جديد.");
      return;
    }
    setServerMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, status: "sending" } : m)),
    );
    try {
      const res = await api.sendMessage({
        threadId,
        text: msg.text,
        imageUrl: msg.payload?.imageUrl as string | undefined,
        clientMessageId: msg.clientMessageId || msg.id,
      });
      setServerMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? ({ ...res.message, status: "sent" } as any) : m)),
      );
    } catch (err) {
      const reason =
        err instanceof Error && err.message ? err.message : "تعذر الإرسال. حاول مرة أخرى.";
      toast.error(reason);
      setServerMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, status: "failed", failureReason: reason } : m)),
      );
    }
  };

  // Handle direct file attachment with real progress percentage
  const attachWithProgress = async (rawFile: File) => {
    if (!rawFile) return;
    setShowAttachments(false);

    /*
      Scaled down before anything else, for the same reason the wallet receipt
      is: a current phone hands the page an 8–15 MB, 48-megapixel photo, and
      none of that size survives being looked at in a chat bubble. Re-encoding
      is also what makes an iPhone HEIC work — Safari decodes it, the Worker
      cannot. Returns the original untouched if any of that is unavailable.
    */
    const file = await prepareImageForUpload(rawFile);

    const tempId = `upload-${Date.now()}`;
    const objectUrl = URL.createObjectURL(file);

    if (isHumanChat && threadId) {
      const optimisticMsg: DisplayMessage = {
        id: tempId,
        clientMessageId: tempId,
        sender: "user",
        text: "مرفق",
        type: "image",
        payload: { imageUrl: objectUrl },
        status: "sending",
        uploadProgress: 0,
        createdAt: new Date().toISOString(),
      };
      setServerMessages((prev) => [...prev, optimisticMsg]);
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

      try {
        const { url } = await uploadFileWithProgress(file, "chat", (pct) => {
          setServerMessages((prev) =>
            prev.map((m) => (m.id === tempId ? { ...m, uploadProgress: pct } : m)),
          );
        });

        /*
          The stored URL replaces the local `blob:` one as soon as it exists.

          Retry sends `msg.payload.imageUrl`, and this bubble carried the
          object URL created for the preview. If the send then failed, every
          retry posted `blob:https://banan.to/...` — which `isOwnUploadUrl`
          refuses — so the button could never do anything but fail again. The
          preview keeps working: the stored file is the same picture.
        */
        setServerMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, payload: { imageUrl: url } } : m)),
        );

        const res = await api.sendMessage({
          threadId,
          imageUrl: url,
          text: "مرفق",
          clientMessageId: tempId,
        });

        setServerMessages((prev) =>
          prev.map((m) =>
            m.id === tempId ? ({ ...res.message, status: "sent", uploadProgress: 100 } as any) : m,
          ),
        );
      } catch (err) {
        /*
          Say why. The server sends a precise reason — the format cannot be
          converted, the hourly upload limit is spent, storage did not confirm
          the write — and all of it was being discarded, so a dropped packet
          and an unsupported photo looked identical to the member and produced
          the same unactionable report.
        */
        const reason =
          err instanceof Error && err.message ? err.message : "تعذر إرسال الصورة. حاول مرة أخرى.";
        toast.error(reason);
        setServerMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: "failed", failureReason: reason } : m)),
        );
      }
    } else {
      /*
        No conversation open yet.

        This used to render the picture from the local blob URL, mark it
        "sent", and make no request at all — nothing in storage, nothing in the
        messages table, no notification. The member watched their own file
        appear and be lost on reload. Typing text in the very same state
        creates a thread and sends, so the two halves of one composer
        disagreed.
      */
      if (!user) {
        toast.error("سجّل الدخول أولاً لإرسال صورة.");
        return;
      }
      try {
        const created = await createThread.mutateAsync({
          subject: "محادثة المساعد الآلي",
          chatType: "AUTOMATED_SUPPORT",
        });
        const newThreadId = created?.thread?.id;
        if (!newThreadId) throw new Error("تعذر بدء المحادثة.");
        setThreadId(newThreadId);
        const { url } = await uploadFileWithProgress(file, "chat");
        await api.sendMessage({ threadId: newThreadId, imageUrl: url, text: "مرفق" });
      } catch (err) {
        const reason =
          err instanceof Error && err.message ? err.message : "تعذر إرسال الصورة. حاول مرة أخرى.";
        toast.error(reason);
      }
    }
  };

  const handleSwitchToAutomatedSupport = async () => {
    startedBlankChatRef.current = false;
    if (!user) {
      setThreadId(undefined);
      return;
    }
    const existingAiThread = threads.find(
      (t) => t.chatType === "AUTOMATED_SUPPORT" && t.status === "open" && !t.orderId,
    );
    if (existingAiThread) {
      setThreadId(existingAiThread.id);
    } else {
      const res = await createThread.mutateAsync({
        subject: "محادثة المساعد الآلي",
        chatType: "AUTOMATED_SUPPORT",
      });
      if (res?.thread) {
        setThreadId(res.thread.id);
      }
    }
  };

  const executeActualHumanSupport = async () => {
    setIsPeerTyping(true);
    try {
      const res = await api.requestHumanSupport(threadId);
      if (res.isAvailable) {
        if (res.thread) {
          setThreadId(res.thread.id);
          void queryClient.invalidateQueries({ queryKey: ["threads"] });
          toast.success("تم إرسال طلبك للإدارة بنجاح — بانتظار المشرف");
        }
      } else {
        const stamp = Date.now();
        const offlineMsg =
          res.offlineMessage ||
          `فريق الدعم غير متاح حاليًا. ساعات العمل: ${res.workingHoursText || "09:00 ص - 11:00 م"} بتوقيت بغداد. يمكنك استخدام المساعد الآلي الآن، أو العودة خلال ساعات العمل.`;

        if (!isHumanChat) {
          pushLocal({
            id: `${stamp}-offline`,
            sender: "ai",
            text: offlineMsg,
            payload: { isOfflineNotice: true, action: "switch_to_automated_support" },
          });
        }
      }
    } catch {
      toast.error("تعذر إرسال طلب الدعم");
    } finally {
      setIsPeerTyping(false);
    }
  };

  const handleCancelHumanSupportRequest = () => {
    if (supportCountdownTimerRef.current) {
      clearInterval(supportCountdownTimerRef.current);
      supportCountdownTimerRef.current = null;
    }
    setSupportCountdown(null);
    toast.info("تم إلغاء طلب التحدث مع المشرف");
    if (!isHumanChat) {
      pushLocal({
        id: `${Date.now()}-cancelled`,
        sender: "ai",
        text: "تم إلغاء طلب التحدث مع المشرف. يمكنك الاستمرار في المحادثة معي هنا.",
        createdAt: new Date().toISOString(),
        status: "sent",
      });
    }
  };

  const handleRequestHumanSupport = async () => {
    if (!user) {
      pushLocal({
        id: Date.now().toString(),
        sender: "ai",
        text: "يرجى تسجيل الدخول أولاً للتحدث مع فريق الدعم والإدارة.",
      });
      return;
    }

    if (supportCountdown?.active) {
      return;
    }

    // Start 30-second countdown with cancellation
    if (supportCountdownTimerRef.current) {
      clearInterval(supportCountdownTimerRef.current);
    }

    setSupportCountdown({ active: true, secondsRemaining: 30 });

    let remaining = 30;
    supportCountdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (supportCountdownTimerRef.current) {
          clearInterval(supportCountdownTimerRef.current);
          supportCountdownTimerRef.current = null;
        }
        setSupportCountdown(null);
        void executeActualHumanSupport();
      } else {
        setSupportCountdown({ active: true, secondsRemaining: remaining });
      }
    }, 1000);
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (recordingState === "recording") {
      interval = setInterval(() => setRecordingTime((prev) => prev + 1), 1000);
    } else if (recordingState === "idle") {
      setRecordingTime(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [recordingState]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const lang = useI18n((s) => s.lang);
  const isAr = lang === "ar";
  const isRtl = lang === "ar" || lang === "ku";

  /*
    The session is fetched, not server-rendered, so the greeting differs
    between the SSR pass (no user yet) and the first client render (user in
    cache) — React reported "Hydration failed because the server rendered text
    didn't match the client" and threw the whole chat tree away to re-render
    it. Holding the personalised name back until after mount makes the first
    client render identical to the server's, and the name appears a tick later
    without a mismatch.
  */
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => setIsHydrated(true), []);

  const displayName = isHydrated ? user?.name?.trim() || "" : "";
  const firstName = displayName ? displayName.split(" ")[0] : isAr ? "بك" : "there";

  const isAutomatedThread = !threadId || currentThread?.chatType === "AUTOMATED_SUPPORT";

  const activeSuggestions = useMemo(() => {
    const lastMsg = messages[messages.length - 1];
    const last = lastMsg ? readWireMessage(lastMsg) : null;
    const lastText = last?.text ?? "";
    const lastRole = last?.senderRole;

    const hasSentProof = messages.some((message) => {
      const m = readWireMessage(message);
      return (
        m.kind === "proof" ||
        m.kind === "login_proof" ||
        (Boolean(m.body["imageUrl"]) && m.senderRole === "user") ||
        (m.senderRole === "user" && m.text.includes("إثبات"))
      );
    });

    const hasCredsSent = messages.some((message) => {
      const m = readWireMessage(message);
      return (
        m.kind === "item_credentials" ||
        m.kind === "credentials" ||
        (m.senderRole === "admin" && m.text.includes("بيانات الحساب"))
      );
    });

    const dynamicChips = getSmartCustomerSuggestions({
      chatType:
        currentThread?.chatType ||
        (isOrderMode
          ? "ORDER_SUPPORT"
          : isAutomatedThread
            ? "AUTOMATED_SUPPORT"
            : "GENERAL_SUPPORT"),
      // `activeOrderId` is the strictly-isolated id resolved above. A rename
      // left a `threadOrderId` here that was never declared, and because this
      // memo runs on every render the ReferenceError took the whole page down
      // before it could paint — "Error: threadOrderId is not defined".
      orderId: activeOrderId || currentThread?.orderId,
      orderStatus: currentOrder?.status,
      paymentStatus: currentOrder?.paymentStatus,
      lastMessageText: lastText,
      lastSenderRole: lastRole,
      hasSentProof,
      hasCredsSent,
      isCompleted: currentOrder?.status === "completed",
    });

    return dynamicChips.length > 0 ? dynamicChips : suggestions;
  }, [
    isOrderMode,
    isAutomatedThread,
    currentThread?.chatType,
    currentThread?.orderId,
    activeOrderId,
    currentOrder?.status,
    currentOrder?.paymentStatus,
    messages,
    suggestions,
  ]);

  const handleSuggestionClick = (text: string) => {
    if (text.includes("إثبات تسجيل الدخول")) {
      if (proofInputRef.current) {
        proofInputRef.current.click();
      } else if (fileRef.current) {
        fileRef.current.click();
      }
      return;
    }
    if (text.includes("التحدث مع الإدارة") || text.includes("التحدث مع المشرف")) {
      void handleRequestHumanSupport();
      return;
    }
    void handleSend(tr(text));
  };

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-gradient-to-b from-[#FCF9F5] via-[#F8EAE0] to-[var(--peach)] text-[var(--ink)]"
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* 1. Modern Compact Sticky Header */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-white/40 bg-[var(--surface-5)]/85 px-3.5 py-2.5 shadow-xs backdrop-blur-md transition-all">
        {/* Back Button */}
        <button
          onClick={onBack}
          aria-label={tr("رجوع")}
          className="flex h-9 items-center gap-1.5 rounded-full border border-white/40 bg-card/90 px-3 text-[13px] font-bold text-[var(--ink)] shadow-xs transition-all hover:bg-[var(--surface-3)] active:scale-95 cursor-pointer"
        >
          <ArrowRight
            className="h-4 w-4 rtl:rotate-0 ltr:rotate-180 text-[var(--ink)]"
            strokeWidth={2.2}
          />
          <span className="text-[12px] font-bold">{tr("رجوع")}</span>
        </button>

        {/* Thread Info & Live Status Badge */}
        <div className="flex flex-col items-center justify-center text-center">
          <div className="flex items-center gap-1.5" dir={isRtl ? "rtl" : "ltr"}>
            <span className="text-[13.5px] font-bold text-[var(--ink)]">
              {isOrderMode
                ? `${tr("محادثة تجهيز الطلب")} ${currentOrder?.code ? `(${currentOrder.code})` : ""}`
                : isAutomatedThread
                  ? tr("الدعم الآلي")
                  : currentThread?.subject || tr("محادثة الإدارة")}
            </span>
            {isOrderMode ? (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                {currentOrder?.status === "completed"
                  ? tr("مكتمل")
                  : (liveQueueMetrics?.position || currentQueueIndex) <= 1
                    ? tr("دورك الآن ⚡")
                    : `${tr("طابور")} #${liveQueueMetrics?.position || currentQueueIndex}`}
              </span>
            ) : isAutomatedThread ? (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                <Sparkles className="h-3 w-3" />
                {tr("رد فوري")}
              </span>
            ) : isOnline ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                {tr("متصل الآن")}
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-stone-500/15 px-2 py-0.5 text-[10px] font-bold text-stone-600 dark:text-stone-400">
                <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
                {tr("غير متصل")}
              </span>
            )}
          </div>
          {isPeerTyping && (
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
            >
              {tr("يكتب الآن...")}
            </motion.span>
          )}
        </div>

        {/* Actions (Search + History) */}
        <div className="flex items-center gap-1.5">
          {isHumanChat && (
            <button
              onClick={() => setIsSearching(!isSearching)}
              className={`flex h-9 w-9 items-center justify-center rounded-full border border-white/30 text-[var(--ink)] shadow-xs transition-colors cursor-pointer ${
                isSearching
                  ? "bg-[var(--ink)] text-white"
                  : "bg-card/80 hover:bg-[var(--surface-3)]"
              }`}
              title={tr("بحث في المحادثة...")}
            >
              <Search className="h-4 w-4" strokeWidth={1.75} />
            </button>
          )}
          <button
            onClick={() => setShowHistory(true)}
            // The label is icon-only below `sm`, so it needs an accessible name.
            aria-label={tr("المحادثات السابقة")}
            className="flex h-9 items-center gap-1.5 rounded-full border border-white/30 bg-card/80 px-3 text-[12px] font-bold text-[var(--ink)] shadow-xs transition-colors hover:bg-[var(--surface-3)] cursor-pointer"
            dir={isRtl ? "rtl" : "ltr"}
          >
            <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span className="hidden sm:inline">{tr("المحادثات السابقة")}</span>
            {threads.length > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--ink)] px-1 text-[9px] font-extrabold text-white">
                {threads.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Live Realtime Status / Notice Banner for Orders */}
      {isOrderMode && currentOrder?.status !== "completed" && (
        <div
          className={`relative z-20 border-b px-4 py-2 text-xs backdrop-blur-sm shadow-xs transition-all ${
            liveQueueMetrics?.deliveryStage === "awaiting_login_proof"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-200"
              : liveQueueMetrics?.deliveryStage === "proof_received"
                ? "border-blue-500/30 bg-blue-500/10 text-blue-950 dark:text-blue-200"
                : liveQueueMetrics?.deliveryStage === "otp_sent"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-200"
                  : "border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent text-[var(--ink)]"
          }`}
          dir={isRtl ? "rtl" : "ltr"}
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-2.5 w-2.5 relative shrink-0">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    liveQueueMetrics?.deliveryStage === "proof_received"
                      ? "bg-blue-400"
                      : liveQueueMetrics?.deliveryStage === "otp_sent"
                        ? "bg-emerald-400"
                        : "bg-amber-400"
                  }`}
                />
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    liveQueueMetrics?.deliveryStage === "proof_received"
                      ? "bg-blue-500"
                      : liveQueueMetrics?.deliveryStage === "otp_sent"
                        ? "bg-emerald-500"
                        : "bg-amber-500"
                  }`}
                />
              </span>

              <div className="min-w-0 font-bold">
                {liveQueueMetrics?.deliveryStage === "awaiting_login_proof" ? (
                  <span>📷 تم إرسال بيانات الحساب — يرجى تسجيل الدخول وإرفاق صورة الإثبات</span>
                ) : liveQueueMetrics?.deliveryStage === "proof_received" ? (
                  <span>
                    ✅ تم استلام صورة إثبات تسجيل الدخول — بانتظار إرسال كود التحقق (OTP) من المشرف
                  </span>
                ) : liveQueueMetrics?.deliveryStage === "otp_sent" ? (
                  <span>🔑 تم إرسال كود التحقق OTP — يرجى إدخال الكود لتأكيد تشغيل اللعبة</span>
                ) : (
                  <>
                    {(liveQueueMetrics?.position || currentQueueIndex) <= 1
                      ? tr("⚡ دورك الآن — قيد التجهيز المباشر من المشرف")
                      : `${tr("طابور التجهيز المباشر: الدور")} #${liveQueueMetrics?.position || currentQueueIndex}`}
                    {(liveQueueMetrics?.aheadCount ?? currentQueueIndex - 1) > 0 && (
                      <span className="mr-2 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                        {isAr
                          ? `(أمامك ${liveQueueMetrics?.aheadCount ?? currentQueueIndex - 1} طلبات)`
                          : `(${liveQueueMetrics?.aheadCount ?? currentQueueIndex - 1} orders ahead)`}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Banner Actions & Dynamic Timers */}
            <div className="flex items-center gap-2 shrink-0">
              {liveQueueMetrics?.deliveryStage === "awaiting_login_proof" ? (
                <button
                  type="button"
                  onClick={() => {
                    proofInputRef.current?.click();
                  }}
                  disabled={deliveryBusy}
                  className="flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 text-xs font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50 active:scale-95"
                >
                  <Camera className="h-3.5 w-3.5" />
                  <span>📷 إرفاق إثبات تسجيل الدخول</span>
                </button>
              ) : liveQueueMetrics?.deliveryStage === "proof_received" ? (
                <button
                  type="button"
                  onClick={() => {
                    proofInputRef.current?.click();
                  }}
                  disabled={deliveryBusy}
                  className="flex items-center gap-1 rounded-lg border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 px-2.5 py-1 text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50"
                >
                  <Camera className="h-3 w-3" />
                  <span>تعديل الصورة</span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted-ink)] font-medium">
                  <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  <span>
                    {liveQueueMetrics?.estimatedWaitTime ||
                      liveQueueMetrics?.estimatedMinutesText ||
                      ((liveQueueMetrics?.position || currentQueueIndex) <= 1
                        ? tr("خلال دقائق معدودة")
                        : `${Math.max(5, ((liveQueueMetrics?.position || currentQueueIndex) - 1) * 5)} - ${Math.max(10, (liveQueueMetrics?.position || currentQueueIndex) * 7)} ${tr("دقيقة")}`)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* In-thread Search Bar */}
      <AnimatePresence>
        {isSearching && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative z-20 border-b border-[var(--line)] bg-[var(--surface-2)]/95 px-4 py-2.5 shadow-sm backdrop-blur-md"
            dir={isRtl ? "rtl" : "ltr"}
          >
            <div className="relative flex items-center">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={tr("بحث في المحادثة...")}
                autoFocus
                className={`h-10 w-full rounded-xl border border-[var(--line)] bg-card px-9 text-xs font-medium text-[var(--ink)] focus:border-[var(--ink)] focus:outline-none ${
                  isRtl ? "text-right" : "text-left"
                }`}
              />
              <Search
                className={`absolute ${isRtl ? "right-3" : "left-3"} h-4 w-4 text-[var(--muted-ink)]`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className={`absolute ${isRtl ? "left-3" : "right-3"} text-[var(--muted-ink)] hover:text-[var(--ink)] cursor-pointer`}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Results snippet list */}
            {searchResults.length > 0 && (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-[var(--line)] bg-card p-1.5 shadow-sm">
                {searchResults.map((res) => (
                  <button
                    key={res.id}
                    onClick={() => jumpToMessage(res.id)}
                    className={`flex w-full flex-col rounded-lg p-2 transition-colors hover:bg-[var(--surface-3)] cursor-pointer ${
                      isRtl ? "text-right" : "text-left"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-[var(--muted-ink)]">
                      <span>{res.senderRole === "user" ? tr("أنت") : tr("الدعم")}</span>
                      <span>
                        {new Date(res.createdAt).toLocaleTimeString(isAr ? "ar" : "en", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs font-medium text-[var(--ink)]">
                      {res.snippet}
                    </p>
                  </button>
                ))}
              </div>
            )}
            {isSearching &&
              searchQuery.trim() &&
              !isSearchLoading &&
              searchResults.length === 0 && (
                <p className="mt-2 text-center text-xs text-[var(--muted-ink)]">
                  {tr("لا توجد نتائج مطابقة")}
                </p>
              )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Scrollable Messages Area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-3 sm:px-6"
      >
        {/* Load older messages button / trigger */}
        {hasMore && (
          <div className="flex justify-center py-2">
            <button
              onClick={handleLoadOlder}
              disabled={isLoadingOlder}
              className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-card/90 px-4 py-1.5 text-xs font-bold text-[var(--ink)] shadow-xs transition-all hover:bg-[var(--surface-3)] disabled:opacity-50 cursor-pointer"
            >
              {isLoadingOlder ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--ink)] border-t-transparent" />
                  <span>{tr("جاري التحميل...")}</span>
                </>
              ) : (
                <>
                  <Clock className="h-3.5 w-3.5 text-[var(--muted-ink)]" />
                  <span>{tr("تحميل الرسائل السابقة")}</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* 3. Hero Welcome Greeting (Visible in empty chat when there are no messages, never in order threads) */}
        <AnimatePresence>
          {!isThreadLoading && !isOrderMode && !currentThread?.orderId && messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col gap-4 pt-2"
            >
              {isAr ? (
                <>
                  <h1
                    className="text-[32px] font-black leading-[1.2] tracking-[-0.03em] text-[var(--ink)] sm:text-[38px] text-right"
                    dir="rtl"
                  >
                    {displayName ? (
                      <>
                        أهلاً{" "}
                        <SquigglyText
                          stepDuration={70}
                          scale={[2, 4]}
                          className="text-[var(--ink)]"
                        >
                          {displayName}
                        </SquigglyText>{" "}
                        👋
                      </>
                    ) : (
                      "أهلاً بك 👋"
                    )}
                    <br />
                    كيف أساعدك اليوم؟
                  </h1>

                  <div
                    className="space-y-3 text-[15px] font-medium leading-[1.35] text-[var(--ink)] text-right"
                    dir="rtl"
                  >
                    <p>مرحباً بك في عالم بنانا</p>
                    <div className="flex flex-wrap items-center">
                      هل تبحث عن{" "}
                      <FlipWords
                        words={["لعبة", "مجسم", "جهاز", "حل لمشكلة", "إكسسوار"]}
                        className="font-bold text-amber-600 px-1"
                      />
                      ؟
                    </div>
                  </div>
                </>
              ) : lang === "ku" ? (
                <>
                  <h1
                    className="text-[30px] font-black leading-[1.2] tracking-[-0.03em] text-[var(--ink)] sm:text-[36px] text-right"
                    dir="rtl"
                  >
                    {user?.name ? (
                      <>
                        Silav{" "}
                        <SquigglyText
                          stepDuration={70}
                          scale={[2, 4]}
                          className="text-[var(--ink)]"
                        >
                          {firstName}
                        </SquigglyText>
                      </>
                    ) : (
                      "Bi xêr hatî"
                    )}
                    <br />
                    Îro çawa dikarim alîkariya we bikim?
                  </h1>

                  <div
                    className="space-y-3 text-[15px] font-medium leading-[1.35] text-[var(--ink)] text-right"
                    dir="rtl"
                  >
                    <p>Bi xêr hatî cîhana Bananto</p>
                    <div className="flex flex-wrap items-center">
                      Li çi digerî{" "}
                      <FlipWords
                        words={["lîstikek", "fîgûrek", "konsol", "piştgirî", "aksesorek"]}
                        className="font-bold text-amber-600 px-1"
                      />
                      ؟
                    </div>
                  </div>
                </>
              ) : lang === "tr" ? (
                <>
                  <h1
                    className="text-[28px] font-black leading-[1.2] tracking-[-0.02em] text-[var(--ink)] sm:text-[34px] text-left"
                    dir="ltr"
                  >
                    {user?.name ? (
                      <>
                        Merhaba{" "}
                        <SquigglyText
                          stepDuration={70}
                          scale={[2, 4]}
                          className="text-[var(--ink)]"
                        >
                          {firstName}
                        </SquigglyText>
                      </>
                    ) : (
                      "Hoş Geldiniz"
                    )}
                    <br />
                    Bugün size nasıl yardımcı olabiliriz?
                  </h1>

                  <div
                    className="space-y-3 text-[15px] font-medium leading-[1.35] text-[var(--ink)] text-left"
                    dir="ltr"
                  >
                    <p>Bananto dünyasına hoş geldiniz</p>
                    <div className="flex flex-wrap items-center">
                      Aradığınız:{" "}
                      <FlipWords
                        words={["bir oyun", "bir figür", "bir konsol", "bir çözüm", "bir aksesuar"]}
                        className="font-bold text-amber-600 px-1"
                      />
                      ?
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <h1
                    className="text-[28px] font-black leading-[1.2] tracking-[-0.02em] text-[var(--ink)] sm:text-[34px] text-left"
                    dir="ltr"
                  >
                    {user?.name ? (
                      <>
                        Hello{" "}
                        <SquigglyText
                          stepDuration={70}
                          scale={[2, 4]}
                          className="text-[var(--ink)]"
                        >
                          {firstName}
                        </SquigglyText>
                      </>
                    ) : (
                      "Welcome"
                    )}
                    <br />
                    How can we help you today?
                  </h1>

                  <div
                    className="space-y-3 text-[15px] font-medium leading-[1.35] text-[var(--ink)] text-left"
                    dir="ltr"
                  >
                    <p>Welcome to the Banana world</p>
                    <div className="flex flex-wrap items-center">
                      Looking for{" "}
                      <FlipWords
                        words={["a game", "a collectible", "a console", "support", "an accessory"]}
                        className="font-bold text-amber-600 px-1"
                      />
                      ?
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dynamic Chat Messages */}
        <div className="flex flex-col gap-3">
          {threadLoadError && !isThreadLoading ? (
            <div className="mx-auto my-8 flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-[var(--line)] bg-card p-5 text-center">
              <span className="text-2xl">⚠️</span>
              <p className="text-sm font-bold text-[var(--ink)]">{tr("تعذر تحميل المحادثة")}</p>
              <p className="text-xs font-medium text-[var(--muted-ink)]">
                {tr("لم نتمكن من جلب الرسائل من الخادم. تحقق من الاتصال ثم أعد المحاولة.")}
              </p>
              <button
                onClick={() => {
                  // Force a fresh request; never re-show whatever was cached.
                  setThreadLoadError(null);
                  setThreadReloadKey((k) => k + 1);
                }}
                className="rounded-xl bg-[var(--ink)] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[var(--ink-strong)] cursor-pointer"
              >
                {tr("إعادة المحاولة")}
              </button>
            </div>
          ) : isThreadLoading ? (
            <div className="flex flex-col gap-4 py-8">
              <div className="flex items-center justify-center gap-2 text-xs font-bold text-[var(--muted-ink)]">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--ink)] border-t-transparent" />
                <span>{tr("جاري تحميل المحادثة...")}</span>
              </div>
              <div className="flex w-3/4 mr-auto animate-pulse flex-col gap-2 rounded-2xl bg-black/5 p-4 dark:bg-white/5" />
              <div className="flex w-2/3 ml-auto animate-pulse flex-col gap-2 rounded-2xl bg-amber-500/10 p-4" />
              <div className="flex w-1/2 mr-auto animate-pulse flex-col gap-2 rounded-2xl bg-black/5 p-4 dark:bg-white/5" />
            </div>
          ) : (
            messages.map((msg) => {
              const isMine = msg.sender === "user";
              const isHighlighted = highlightedMessageId === msg.id;

              return (
                <motion.div
                  id={`msg-${msg.id}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={msg.id}
                  className={`flex w-fit max-w-full ${
                    isMine ? "ml-auto mr-0" : "mr-auto ml-0"
                  } ${isHighlighted ? "animate-pulse rounded-2xl ring-2 ring-amber-500 p-0.5" : ""}`}
                >
                  {msg.type === "digital_order_card" && msg.payload ? (
                    <DigitalOrderCard
                      orderId={String(msg.payload["orderId"] ?? currentOrder?.id ?? "")}
                      code={String(msg.payload["code"] ?? currentOrder?.code ?? "BN-ORDER")}
                      items={
                        (msg.payload["items"] as any) ??
                        currentOrder?.items?.map((it) => ({
                          id: it.id,
                          productId: it.productId,
                          title: it.title,
                          unitPrice: it.unitPrice,
                          quantity: it.quantity,
                          image: it.image || "",
                          kind: it.kind,
                        })) ??
                        []
                      }
                      total={
                        typeof msg.payload["total"] === "number"
                          ? msg.payload["total"]
                          : currentOrder?.total
                      }
                      currency={String(
                        msg.payload["currency"] ??
                          currentOrder?.currency ??
                          activeCurrencyInfo?.symbol ??
                          "د.ع",
                      )}
                      paymentStatus={String(
                        msg.payload["paymentStatus"] ?? currentOrder?.paymentStatus ?? "paid",
                      )}
                      paymentMethod="محفظة بنانا"
                      status={currentOrder?.status ?? "processing"}
                      createdAt={currentOrder?.createdAt ?? msg.createdAt}
                      text={
                        typeof msg.payload["text"] === "string" ? msg.payload["text"] : undefined
                      }
                      locale={lang === "en" ? "en" : "ar"}
                      queuePosition={
                        liveQueueMetrics?.position ||
                        (currentQueueIndex > 0 ? currentQueueIndex : 1)
                      }
                      aheadCount={liveQueueMetrics?.aheadCount}
                      adminStatus={liveQueueMetrics?.adminStatus || adminStatus}
                      workingHoursText={adminAvailability?.workingHoursText}
                      canConfirmReceived={canConfirmOrderReceipt}
                      onConfirmReceived={handleConfirmOrderReceipt}
                      isConfirmingReceived={isConfirmingReceipt}
                      onReportIssue={handleReportDeliveryIssue}
                      isReportingIssue={isReportingDeliveryIssue}
                      onOpenInvoice={() => {
                        if (currentOrder) setSelectedInvoiceOrder(currentOrder);
                      }}
                    />
                  ) : msg.type === "review_request" && msg.payload ? (
                    <RatingCard
                      orderId={String(msg.payload["orderId"] ?? currentOrder?.id ?? "")}
                      orderCode={String(msg.payload["orderCode"] ?? currentOrder?.code ?? "")}
                      items={
                        (msg.payload["items"] as any) ??
                        currentOrder?.items?.map((it) => ({
                          id: it.id,
                          productId: it.productId,
                          title: it.title,
                          image: it.image || "",
                        })) ??
                        []
                      }
                      text={
                        typeof msg.payload["text"] === "string" ? msg.payload["text"] : undefined
                      }
                      locale={lang === "en" ? "en" : "ar"}
                    />
                  ) : msg.type === "order_completed" ? (
                    <div
                      dir="auto"
                      className="max-w-[85%] rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-foreground shadow-xs space-y-1.5"
                    >
                      <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-xs">
                        <Check className="w-4 h-4 text-emerald-500" />
                        <span>
                          {msg.text ||
                            (lang === "en"
                              ? "Order has been completed successfully ✅"
                              : "تم اكتمال الطلب بنجاح ✅")}
                        </span>
                      </div>
                      {typeof msg.payload?.["code"] === "string" && (
                        <div className="text-[11px] font-mono text-muted-foreground">
                          #{String(msg.payload["code"])}
                        </div>
                      )}
                    </div>
                  ) : msg.type === "account_card" && msg.payload ? (
                    <AccountCard
                      kind={String(msg.payload["kind"] ?? "")}
                      body={msg.payload["body"] as Record<string, unknown>}
                      locale={lang === "en" ? "en" : "ar"}
                      {...(currentOrder && String(msg.payload["kind"] ?? "") === "item_credentials"
                        ? {
                            delivery: {
                              onAttachProof: (itemId: string, deliveryItemId?: string) => {
                                proofItemRef.current = { itemId, deliveryItemId };
                                proofInputRef.current?.click();
                              },
                              onNext: requestNextAccount,
                              proofSent: Boolean(
                                proofSentItems[
                                  String(
                                    (msg.payload["body"] as Record<string, unknown>)?.[
                                      "deliveryItemId"
                                    ] ??
                                      (msg.payload["body"] as Record<string, unknown>)?.[
                                        "itemId"
                                      ] ??
                                      "",
                                  )
                                ],
                              ),
                              busy: deliveryBusy,
                            },
                          }
                        : {})}
                    />
                  ) : msg.type === "image" && msg.payload ? (
                    <div className="relative w-64 max-w-[85%] overflow-hidden rounded-2xl border border-[var(--surface-4)] bg-card p-1.5 shadow-xs">
                      {isVideoUrl(String(msg.payload["imageUrl"] ?? "")) ? (
                        <video
                          src={String(msg.payload["imageUrl"] ?? "")}
                          controls
                          preload="metadata"
                          playsInline
                          className={`max-h-64 w-full rounded-[12px] bg-black ${
                            msg.status === "sending" ? "blur-[2px]" : ""
                          }`}
                        />
                      ) : (
                        <img
                          src={String(msg.payload["imageUrl"] ?? "")}
                          alt="مرفق"
                          className={`max-h-64 w-full rounded-[12px] object-cover ${
                            msg.status === "sending" ? "blur-[2px]" : ""
                          }`}
                        />
                      )}
                      {msg.status === "sending" && typeof msg.uploadProgress === "number" && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 text-white backdrop-blur-xs">
                          <div className="relative h-12 w-12 flex items-center justify-center">
                            <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 36 36">
                              <circle
                                cx="18"
                                cy="18"
                                r="15"
                                fill="none"
                                stroke="rgba(255,255,255,0.3)"
                                strokeWidth="3"
                              />
                              <circle
                                cx="18"
                                cy="18"
                                r="15"
                                fill="none"
                                stroke="white"
                                strokeWidth="3"
                                strokeDasharray="94.2"
                                strokeDashoffset={94.2 - (94.2 * (msg.uploadProgress || 0)) / 100}
                                strokeLinecap="round"
                                className="transition-all duration-200"
                              />
                            </svg>
                            <span className="absolute text-[11px] font-black">
                              {msg.uploadProgress}%
                            </span>
                          </div>
                          <span className="mt-1 text-[10px] font-bold">جاري الرفع...</span>
                        </div>
                      )}
                      {msg.status === "failed" && (
                        <button
                          onClick={() => handleRetry(msg)}
                          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-950/70 px-3 text-center text-white cursor-pointer"
                        >
                          <RotateCcw className="h-6 w-6" />
                          <span className="text-xs font-bold">{tr("إعادة المحاولة")}</span>
                          {/*
                            The reason, where the failure is. A retry that
                            cannot succeed — an unsupported format, a spent
                            upload limit — should say so rather than invite an
                            eleventh identical attempt.
                          */}
                          {msg.failureReason && (
                            <span className="line-clamp-3 text-[10px] font-medium leading-tight opacity-90">
                              {msg.failureReason}
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  ) : msg.type === "product" && msg.payload ? (
                    <div className="group flex w-72 max-w-[85%] flex-col gap-3 rounded-2xl border border-[var(--surface-4)] bg-card p-4 shadow-xs transition-shadow hover:shadow-md">
                      <div className="flex items-center gap-3" dir="rtl">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--surface-4)] bg-[var(--surface)]">
                          {msg.payload["image"] ? (
                            <img
                              src={String(msg.payload["image"])}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <ShoppingBag className="h-7 w-7 text-[var(--ink)]" />
                          )}
                        </div>
                        <div className="flex flex-1 flex-col justify-center text-right">
                          <span className="mb-0.5 line-clamp-1 text-[15px] font-bold leading-tight text-[var(--ink)]">
                            {String(msg.payload["name"] ?? "")}
                          </span>
                          <span className="inline-block w-max rounded-md bg-[var(--surface)] px-2 py-0.5 text-[12px] text-[var(--muted-ink)]">
                            {tr("منتج مقترح")}
                          </span>
                        </div>
                      </div>
                      <div className="border-t border-[var(--surface-4)]/50 pt-2 text-right text-[13px] leading-relaxed text-[var(--ink)]/80">
                        {msg.text}
                      </div>
                      <a
                        href={`/product/${String(msg.payload["id"] ?? "")}`}
                        className="mt-1 w-full rounded-xl bg-[var(--ink)] py-2 text-center text-[13px] font-bold text-white transition-colors hover:bg-[var(--ink-strong)]"
                      >
                        {tr("عرض التفاصيل")}
                      </a>
                    </div>
                  ) : msg.type === "location" && msg.payload ? (
                    <div className="group w-72 max-w-[85%] rounded-2xl border border-[var(--surface-4)] bg-card p-1.5 shadow-xs transition-shadow hover:shadow-md">
                      <div className="relative mb-2 flex h-32 w-full items-center justify-center overflow-hidden rounded-[12px] bg-[var(--surface)] transition-colors group-hover:bg-[#F0EBE1]">
                        <motion.div
                          animate={{ y: [0, -5, 0] }}
                          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                        >
                          <MapPin className="relative z-10 h-10 w-10 text-blue-500 drop-shadow-md" />
                        </motion.div>
                      </div>
                      <div className="px-3 pb-3">
                        <div className="mb-0.5 text-right text-[15px] font-bold text-[var(--ink)]">
                          {String(msg.payload["name"] ?? "")}
                        </div>
                        <div className="mb-2 text-right text-[12px] leading-relaxed text-[var(--muted-ink)]">
                          {msg.text}
                        </div>
                      </div>
                    </div>
                  ) : msg.type === "wallet" && msg.payload ? (
                    <div
                      className="relative w-64 max-w-[85%] overflow-hidden rounded-3xl p-5 shadow-lg"
                      style={{
                        background: "linear-gradient(135deg, #4A2B25 0%, var(--ink-strong) 100%)",
                      }}
                    >
                      <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 -translate-y-1/2 translate-x-1/4 rounded-full bg-card/5 blur-xl" />
                      <div className="relative z-10 mb-5 flex items-center justify-between">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-card/10 shadow-inner backdrop-blur-md">
                          <Wallet className="h-5 w-5 text-[var(--peach)]" />
                        </div>
                        <span className="rounded-lg border border-white/5 bg-card/10 px-2.5 py-1 text-[11px] font-bold tracking-wide text-[var(--peach)] shadow-xs backdrop-blur-xs">
                          {tr("تحويل رصيد")}
                        </span>
                      </div>
                      <div className="relative z-10 flex flex-col items-end gap-1">
                        <span className="text-[12px] font-medium tracking-wide text-white/70">
                          {tr("المبلغ المحول")}
                        </span>
                        <div className="flex flex-row-reverse items-baseline gap-1.5" dir="ltr">
                          <span className="text-3xl font-bold tracking-tight text-white drop-shadow-md">
                            {String(msg.payload["amount"] ?? "")}
                          </span>
                          <span className="text-sm font-bold tracking-wide text-[var(--peach)]">
                            {activeCurrencyInfo?.symbol || "د.ع"}
                          </span>
                        </div>
                      </div>
                      <div className="relative z-10 mt-4 flex items-center justify-between border-t border-white/10 pt-3">
                        <span className="font-mono text-[10px] tracking-wider text-white/50">
                          REF: #{msg.id.slice(-5)}
                        </span>
                        <Check className="h-4 w-4 text-green-400 drop-shadow-xs" />
                      </div>
                    </div>
                  ) : msg.payload?.isOfflineNotice ||
                    msg.payload?.action === "switch_to_automated_support" ? (
                    <div
                      dir="auto"
                      className="max-w-[85%] rounded-2xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/30 p-4 text-[14px] text-[var(--ink)] shadow-xs space-y-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div className="leading-relaxed whitespace-pre-wrap font-medium">
                          {msg.text}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleSwitchToAutomatedSupport}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[var(--ink)] text-white font-bold text-xs hover:bg-[var(--ink-strong)] transition-all shadow-xs cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        <span>الانتقال إلى الرد الآلي</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end gap-1 max-w-[85%]">
                      <div
                        dir="auto"
                        className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[14.5px] font-medium leading-[1.4] shadow-xs ${
                          isMine
                            ? "rounded-tr-[4px] bg-[var(--ink)] text-[var(--surface-2)]"
                            : "rounded-tl-[4px] border border-white/50 bg-card/85 text-[var(--ink)] backdrop-blur-xs"
                        }`}
                      >
                        {msg.sender === "ai" ? (
                          <TextGenerateEffect
                            words={msg.text}
                            className="text-[var(--ink)]"
                            duration={0.3}
                          />
                        ) : (
                          msg.text
                        )}
                      </div>

                      {/* Timestamp & Status Checkmark */}
                      {isMine && (
                        <div className="flex items-center gap-1 text-[10px] text-[var(--muted-ink)] px-1">
                          {msg.createdAt && (
                            <span>
                              {new Date(msg.createdAt).toLocaleTimeString("ar", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                          {msg.status === "sending" && (
                            <Clock className="h-3 w-3 animate-spin text-[var(--muted-ink)]" />
                          )}
                          {msg.status === "sent" && (
                            <CheckCheck className="h-3.5 w-3.5 text-emerald-600" />
                          )}
                          {msg.status === "failed" && (
                            <button
                              onClick={() => handleRetry(msg)}
                              className="flex items-center gap-0.5 text-red-500 font-bold hover:underline cursor-pointer"
                            >
                              <AlertCircle className="h-3 w-3" />
                              <span>{tr("إعادة المحاولة")}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })
          )}

          {/* Animated Typing Indicator */}
          {isPeerTyping && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex justify-start"
            >
              <div className="flex max-w-[85%] items-center gap-1.5 rounded-2xl rounded-tl-[4px] border border-white/50 bg-card/80 px-4 py-3 text-[var(--ink)] shadow-xs backdrop-blur-xs">
                <span className="text-[12px] font-medium text-[var(--muted-ink)] ml-1">
                  {isAutomatedThread ? "المساعد الآلي يفكر" : "الدعم يكتب"}
                </span>
                {[0, 0.2, 0.4].map((delay) => (
                  <motion.div
                    key={delay}
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay }}
                    className="h-1.5 w-1.5 rounded-full bg-[var(--ink)]/60"
                  />
                ))}
              </div>
            </motion.div>
          )}

          <div ref={messagesEndRef} className="h-2" />
        </div>
      </div>

      {/* Floating "Scroll to bottom / New messages" pill */}
      <AnimatePresence>
        {showScrollBottomPill && (
          <motion.button
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.9 }}
            onClick={() => {
              messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
              setShowScrollBottomPill(false);
              setUnreadCountBelow(0);
            }}
            className="absolute bottom-24 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/40 bg-[var(--ink)] px-4 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-md transition-transform hover:scale-105 cursor-pointer"
          >
            <ChevronDown className="h-4 w-4" />
            <span>{tr("رسائل جديدة بالأسفل")}</span>
            {unreadCountBelow > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-black text-black">
                {unreadCountBelow}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Hidden picker for the sign-in proof, driven by the account card. */}
      <input
        type="file"
        ref={proofInputRef}
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void submitLoginProof(file);
        }}
      />

      {/* 4. Bottom Sheet Composer & Navigation Area */}
      <div className="relative z-10 mx-auto flex w-full shrink-0 flex-col gap-2.5 rounded-t-[28px] border-t border-white/80 bg-[var(--surface)] px-4 pb-4 pt-2 shadow-[0_-10px_40px_rgba(150,130,120,0.15)] sm:px-6">
        <div className="mx-auto text-[var(--line-2)]">
          <svg width="24" height="6" viewBox="0 0 24 12" fill="none">
            <path
              d="M4 3L12 7L20 3"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* 30-second Human Support Request Countdown Banner */}
        <AnimatePresence>
          {supportCountdown?.active && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="relative z-20 flex items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 shadow-sm backdrop-blur-md"
              dir="rtl"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white font-mono font-black text-xs shadow-xs">
                  {supportCountdown.secondsRemaining}s
                </div>
                <div>
                  <p className="text-xs font-black text-amber-950 dark:text-amber-200">
                    طلب التحدث مع المشرف قيد التجهيز...
                  </p>
                  <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                    سيتم فتح تذكرة مع الإدارة خلال {supportCountdown.secondsRemaining} ثانية، يمكنك
                    الإلغاء إذا كنت تريد المتابعة هنا.
                  </p>
                </div>
              </div>
              <button
                onClick={handleCancelHumanSupportRequest}
                className="shrink-0 rounded-xl bg-card border border-amber-500/30 px-3 py-1.5 text-xs font-black text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors shadow-xs cursor-pointer"
              >
                إلغاء الطلب
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dynamic Suggestions or Voice recording */}
        <AnimatePresence mode="wait">
          {recordingState !== "idle" ? (
            <motion.div
              key="recording-controls"
              initial={{ opacity: 0, y: 10, height: 0, overflow: "hidden" }}
              animate={{ opacity: 1, y: 0, height: "auto", overflow: "visible" }}
              exit={{
                opacity: 0,
                y: 10,
                height: 0,
                overflow: "hidden",
                transition: { duration: 0.2 },
              }}
              className="relative z-10 flex justify-end gap-2"
            >
              <button
                onClick={() => setRecordingState("idle")}
                className="flex items-center justify-center rounded-[14px] bg-red-50 px-3.5 py-1.5 text-red-500 shadow-xs transition-colors hover:bg-red-100 cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                onClick={() =>
                  setRecordingState((prev) => (prev === "paused" ? "recording" : "paused"))
                }
                className="flex items-center justify-center rounded-[14px] border border-[var(--surface-4)] bg-[var(--surface-2)] px-3.5 py-1.5 text-[var(--ink)] shadow-xs transition-colors hover:bg-card cursor-pointer"
              >
                {recordingState === "paused" ? (
                  <Play className="ml-1 h-4 w-4" fill="currentColor" />
                ) : (
                  <Pause className="h-4 w-4" fill="currentColor" />
                )}
              </button>
              <button
                onClick={() => {
                  const label = `🎤 رسالة صوتية (${formatTime(recordingTime)})`;
                  setRecordingState("idle");
                  void handleSend(label);
                }}
                className="flex items-center justify-center gap-1.5 rounded-[14px] bg-[var(--ink)] px-4 py-1.5 text-[12px] font-medium text-white shadow-xs transition-colors hover:bg-[var(--ink-strong)] cursor-pointer"
              >
                <span>{tr("إرسال")}</span>
                <Send className="ml-0.5 h-3.5 w-3.5" />
              </button>
            </motion.div>
          ) : inputText.length === 0 && !isInputFocused ? (
            <motion.div
              key="suggestions"
              initial={{ opacity: 0, y: 10, height: 0, overflow: "hidden" }}
              animate={{ opacity: 1, y: 0, height: "auto", overflow: "visible" }}
              exit={{
                opacity: 0,
                y: 10,
                height: 0,
                overflow: "hidden",
                transition: { duration: 0.2 },
              }}
              className={`relative z-10 flex flex-wrap gap-1.5 ${isRtl ? "justify-end" : "justify-start"}`}
            >
              {activeSuggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="rounded-[14px] border border-[var(--surface-4)] bg-[var(--surface-2)] px-3 py-1 text-[12px] font-medium text-[var(--ink)] shadow-xs transition-colors hover:bg-card active:scale-95 cursor-pointer"
                  dir={isRtl ? "rtl" : "ltr"}
                >
                  {tr(suggestion)}
                </button>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Input Bar */}
        <div className="relative z-10 flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              /*
                Cleared so picking the same photo again fires `change`. A
                browser does not fire it when the selection is identical, so
                after a failure the obvious retry — tap the paperclip, choose
                that photo — did nothing at all. The sign-in-proof input in
                this same file already resets itself.
              */
              event.target.value = "";
              if (file) void attachWithProgress(file);
            }}
          />
          <div className="relative ml-1 flex items-center justify-center">
            <AnimatePresence>
              {showAttachments && (
                <motion.div
                  initial={{ opacity: 0, y: 30, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 30, scale: 0.8, transition: { duration: 0.2 } }}
                  className="absolute bottom-[calc(100%+12px)] left-1/2 z-30 flex -translate-x-1/2 flex-col-reverse gap-3"
                >
                  {[
                    { icon: ImageIcon, color: "text-blue-500" },
                    { icon: Camera, color: "text-green-500" },
                    { icon: Paperclip, color: "text-purple-500" },
                  ].map(({ icon: Icon, color }, i) => (
                    <motion.button
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.05 * (i + 1) }}
                      onClick={() => fileRef.current?.click()}
                      className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[var(--surface-4)] bg-card shadow-lg transition-colors hover:bg-[var(--surface)] cursor-pointer"
                    >
                      <Icon className={`h-4 w-4 ${color}`} />
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={() => setShowAttachments(!showAttachments)}
              className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink)] transition-colors hover:bg-[var(--surface-3)] cursor-pointer"
            >
              {showAttachments ? (
                <X className="h-4 w-4" strokeWidth={1.5} />
              ) : (
                <Zap className="h-4 w-4 fill-transparent" strokeWidth={1.5} />
              )}
            </button>
          </div>

          <div className="relative flex h-[42px] flex-1 items-center overflow-hidden rounded-full border border-[var(--surface-4)] bg-[var(--surface-2)] shadow-xs transition-all focus-within:border-[#D4C3B3]">
            {recordingState !== "idle" ? (
              <div
                className="absolute inset-0 flex items-center justify-between px-4"
                dir={isRtl ? "rtl" : "ltr"}
              >
                <div className="z-10 flex items-center gap-2 font-medium text-red-500">
                  <motion.div
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                    className="h-2 w-2 rounded-full bg-red-500"
                  />
                  <span dir="ltr" className="text-[13px] font-semibold text-[var(--ink)]">
                    {formatTime(recordingTime)}
                  </span>
                </div>
                <span className="z-10 text-[12px] font-medium text-[var(--ink)] opacity-70">
                  {recordingState === "paused" ? tr("تم الإيقاف المؤقت") : tr("جاري التسجيل...")}
                </span>
              </div>
            ) : (
              <input
                type="text"
                value={inputText}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                onChange={(event) => handleInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={
                  isOrderMode
                    ? tr("اكتب رسالتك للمشرف بخصوص الطلب...")
                    : isHumanChat
                      ? tr("اكتب رسالتك للدعم...")
                      : tr("اسألني أي شيء")
                }
                className={`h-full w-full bg-transparent ${
                  isRtl ? "pl-4 pr-[44px]" : "pr-4 pl-[44px]"
                } text-[13px] font-medium text-[var(--ink)] placeholder-[var(--muted-ink)] focus:outline-none`}
              />
            )}
            <button
              onClick={() => {
                if (recordingState !== "idle") setRecordingState("idle");
                else if (inputText.length > 0) void handleSend();
                else setRecordingState("recording");
              }}
              className={`absolute ${
                isRtl ? "right-1" : "left-1"
              } z-20 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[var(--ink)] transition-colors hover:bg-[var(--ink-strong)] cursor-pointer`}
            >
              {recordingState !== "idle" ? (
                <X className="h-4 w-4 text-white" strokeWidth={1.5} />
              ) : inputText.length > 0 ? (
                <Send className="h-3.5 w-3.5 text-white" strokeWidth={2} />
              ) : (
                <Mic className="h-4 w-4 text-white" strokeWidth={1.5} />
              )}
            </button>
          </div>
        </div>

        {/* Bottom Fast Action Buttons - only show in general support mode, HIDE in Order Mode or when Input is Focused! */}
        {!isOrderMode && !isInputFocused && (
          <div
            // Short phones cannot afford the full-height bar: it is what pushes the
            // composer or the icons themselves off the screen.
            className="relative z-10 mx-auto flex h-[82px] w-full max-w-md items-end px-1 pb-1 [@media(max-height:700px)]:h-[68px]"
            dir={isRtl ? "rtl" : "ltr"}
          >
            <AnimatePresence mode="wait">
              {recordingState !== "idle" ? (
                <motion.div
                  key="recording-strands"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 30, transition: { duration: 0.2 } }}
                  className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-80"
                >
                  <Strands
                    colors={["var(--ink)", "var(--peach)", "var(--line)"]}
                    count={3}
                    speed={recordingState === "recording" ? 1.5 : 0}
                    amplitude={recordingState === "recording" ? 1.5 : 0.2}
                    waviness={1}
                    thickness={1.5}
                    opacity={1}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="nav-icons"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 30, transition: { duration: 0.2 } }}
                  className="relative z-10 grid w-full grid-cols-5 items-end justify-items-center gap-1"
                >
                  {/* 1. Products */}
                  <button
                    onClick={() => setSelectedNav("المنتجات")}
                    className="group flex w-full max-w-[68px] min-w-0 flex-col items-center justify-end gap-1 text-[var(--ink)] cursor-pointer"
                  >
                    <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[var(--ink)] transition-colors group-hover:bg-[var(--surface-3)]/50">
                      <ShoppingBag className="h-[17px] w-[17px]" strokeWidth={1.75} />
                    </div>
                    <span className="w-full text-center text-[10px] sm:text-[11px] font-bold tracking-tight opacity-90 truncate leading-tight">
                      {tr("المنتجات")}
                    </span>
                  </button>

                  {/* 2. Orders */}
                  <button
                    onClick={() => setSelectedNav("الطلب")}
                    className="group flex w-full max-w-[68px] min-w-0 flex-col items-center justify-end gap-1 text-[var(--ink)] cursor-pointer"
                  >
                    <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[var(--ink)] transition-colors group-hover:bg-[var(--surface-3)]/50">
                      <FileText className="h-[17px] w-[17px]" strokeWidth={1.75} />
                    </div>
                    <span className="w-full text-center text-[10px] sm:text-[11px] font-bold tracking-tight opacity-90 truncate leading-tight">
                      {tr("الطلب")}
                    </span>
                  </button>

                  {/* 3. Human Support (Center Elevated Button) */}
                  <button
                    onClick={() => {
                      void handleRequestHumanSupport();
                    }}
                    className="group relative flex w-full max-w-[76px] min-w-0 flex-col items-center justify-end gap-1 text-[var(--ink)] cursor-pointer"
                  >
                    <div className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-[var(--ink)] text-white shadow-md transition-colors group-hover:bg-[var(--ink-strong)]">
                      <Headset className="h-5 w-5" />
                    </div>
                    <span className="w-full text-center text-[10px] sm:text-[11px] font-bold tracking-tight truncate leading-tight">
                      {tr("خدمة الدعم البشري")}
                    </span>
                  </button>

                  {/* 4. Wallet / Location depending on mode */}
                  {isAutomatedThread ? (
                    <button
                      onClick={() => setSelectedNav("الموقع")}
                      className="group flex w-full max-w-[68px] min-w-0 flex-col items-center justify-end gap-1 text-[var(--ink)] cursor-pointer"
                    >
                      <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[var(--ink)] transition-colors group-hover:bg-[var(--surface-3)]/50">
                        <MapPin className="h-[17px] w-[17px]" strokeWidth={1.75} />
                      </div>
                      <span className="w-full text-center text-[10px] sm:text-[11px] font-bold tracking-tight opacity-90 truncate leading-tight">
                        {tr("الموقع")}
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setSelectedNav("المحفظة")}
                      className="group flex w-full max-w-[68px] min-w-0 flex-col items-center justify-end gap-1 text-[var(--ink)] cursor-pointer"
                    >
                      <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[var(--ink)] transition-colors group-hover:bg-[var(--surface-3)]/50">
                        <Wallet className="h-[17px] w-[17px]" strokeWidth={1.75} />
                      </div>
                      <span className="w-full text-center text-[10px] sm:text-[11px] font-bold tracking-tight opacity-90 truncate leading-tight">
                        {tr("المحفظة")}
                      </span>
                    </button>
                  )}

                  {/* 5. New Chat */}
                  <button
                    onClick={() => {
                      startedBlankChatRef.current = true;
                      setThreadId(undefined);
                      setLocalMessages([]);
                      setLiveQueueMetrics(null);
                      toast.info(tr("بدء محادثة جديدة"));
                    }}
                    className="group flex w-full max-w-[68px] min-w-0 flex-col items-center justify-end gap-1 text-[var(--ink)] cursor-pointer"
                  >
                    <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[var(--ink)] transition-colors group-hover:bg-[var(--surface-3)]/50">
                      <MessageSquarePlus className="h-[17px] w-[17px]" strokeWidth={1.75} />
                    </div>
                    <span className="w-full text-center text-[10px] sm:text-[11px] font-bold tracking-tight opacity-90 truncate leading-tight">
                      {tr("جديد")}
                    </span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* 5. Drawers / Modals */}
      <AnimatePresence>
        {selectedNav && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedNav(null)}
              className="absolute inset-0 z-40 bg-black/40"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="absolute bottom-0 left-0 right-0 z-50 flex h-[75vh] max-h-[600px] flex-col overflow-hidden rounded-t-[28px] bg-card shadow-2xl"
            >
              <div className="flex h-full flex-col overflow-hidden rounded-t-[28px] border-t border-white/80 bg-[var(--surface)] p-6 pb-8">
                <div className="mx-auto mb-6 h-1.5 w-12 shrink-0 rounded-full bg-[var(--line-2)]" />

                <div className="flex-1 overflow-hidden">
                  {selectedNav === "المنتجات" && (
                    <ProductSelectionView
                      products={products}
                      favorites={user?.favorites ?? []}
                      purchased={purchased}
                      onSend={(product) => {
                        setSelectedNav(null);
                        const text = `أرغب بالاستفسار عن: ${String((product.titleEn || product.english_name || product.title) ?? "")}`;
                        if (isHumanChat) void handleSend(text);
                        else
                          pushLocal({
                            id: Date.now().toString(),
                            sender: "user",
                            text,
                            type: "product",
                            payload: {
                              name: String(
                                (product.titleEn || product.english_name || product.title) ?? "",
                              ),
                              id: product.id,
                              image: product.image,
                            },
                          });
                      }}
                    />
                  )}

                  {selectedNav === "الموقع" && (
                    <LocationSelectionView
                      addresses={user?.addresses ?? []}
                      onSend={(location) => {
                        setSelectedNav(null);
                        const text = `عنوان التوصيل: ${location}`;
                        if (isHumanChat) void handleSend(text);
                        else
                          pushLocal({
                            id: Date.now().toString(),
                            sender: "user",
                            text,
                            type: "location",
                            payload: { name: location },
                          });
                      }}
                    />
                  )}

                  {selectedNav === "المحفظة" && (
                    <WalletView
                      settings={storeQuery.data?.settings ?? {}}
                      onSend={(amount) => {
                        setSelectedNav(null);
                        if (isAutomatedThread) {
                          toast.error(
                            tr("تحويل الرصيد متاح فقط في محادثة الدعم البشري مع الإدارة"),
                          );
                          return;
                        }
                        const text = `طلب تحويل رصيد بقيمة ${amount}`;
                        if (isHumanChat) void handleSend(text);
                        else
                          pushLocal({
                            id: Date.now().toString(),
                            sender: "user",
                            text: "طلب تحويل رصيد",
                            type: "wallet",
                            payload: { amount },
                          });
                      }}
                    />
                  )}

                  {selectedNav === "الطلب" && (
                    <OrderSelectionView
                      orders={orders}
                      onSend={(order) => {
                        setSelectedNav(null);
                        startedBlankChatRef.current = false;
                        setThreadId(order.threadId);
                      }}
                    />
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* History Drawer */}
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { delay: 0.3 } }}
              onClick={() => setShowHistory(false)}
              className="absolute inset-0 z-40 bg-black/40"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{
                x: "100%",
                transition: { delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
              }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="absolute bottom-0 right-0 top-0 z-[45] w-[85%] bg-[var(--peach)] sm:w-[320px]"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{
                x: "100%",
                transition: { delay: 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
              }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              className="absolute bottom-0 right-0 top-0 z-[46] w-[85%] bg-[var(--line)] sm:w-[320px]"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{
                x: "100%",
                transition: { delay: 0, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
              }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
              className="absolute bottom-0 right-0 top-0 z-[50] flex w-[85%] flex-col bg-[var(--surface)] text-[var(--ink)] shadow-2xl sm:w-[320px]"
            >
              <div
                className="flex h-full flex-col space-y-4 overflow-y-auto border-l border-white/50 p-6"
                dir="rtl"
              >
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10, transition: { duration: 0.2 } }}
                  transition={{ delay: 0.4 }}
                  className="mb-6 flex items-center justify-between"
                >
                  <h2 className="text-xl font-bold text-[var(--ink)]">
                    {isAdmin ? "كل المحادثات" : "المحادثات السابقة"}
                  </h2>
                  <button
                    onClick={() => setShowHistory(false)}
                    className="rounded-full bg-[var(--surface-3)] p-2 text-[var(--ink)] transition-colors hover:bg-[var(--line)] cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </motion.div>

                <div className="space-y-3">
                  {threads.map((thread, idx) => {
                    /*
                      One classifier, shared with the server.

                      These four booleans were derived here independently and
                      the badge tested `isAi` first — so a thread that was the
                      bot's *and* attached to an order showed "🤖 مساعد آلي"
                      while `threadKind` called it an order. The kind now comes
                      from the same function the expiry uses, which is the only
                      way the label and the deletion rule cannot disagree.
                    */
                    const kind = threadKind(thread);
                    const isOrder = kind === "order";
                    const isDelivery = thread.chatType === "DELIVERY";
                    const isAi = kind === "bot";
                    const isHuman = kind === "human_support";

                    return (
                      <motion.button
                        key={thread.id}
                        initial={{ opacity: 0, x: 50 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20, transition: { duration: 0.2 } }}
                        transition={{
                          delay: 0.4 + idx * 0.06,
                          duration: 0.4,
                          ease: [0.22, 1, 0.36, 1],
                        }}
                        onClick={() => {
                          setShowHistory(false);
                          startedBlankChatRef.current = false;
                          setThreadId(thread.id);
                        }}
                        className={`group flex w-full items-center justify-between rounded-xl border p-4 text-right shadow-xs transition-colors cursor-pointer ${
                          threadId === thread.id
                            ? "border-[var(--ink)] bg-[var(--surface-3)]/60"
                            : "border-[var(--surface-4)] bg-card hover:border-[var(--line)]"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <h3 className="truncate text-[15px] font-semibold text-[var(--ink)] transition-colors group-hover:text-[var(--ink-strong)]">
                              {thread.subject || (isAi ? "المساعد الآلي" : "محادثة الدعم")}
                            </h3>
                          </div>
                          <p className="truncate text-[12px] text-[var(--muted-ink)]">
                            {isAdmin ? `${thread.userName} · ` : ""}
                            {thread.lastMessagePreview ??
                              new Date(thread.lastMessageAt).toLocaleString("ar")}
                          </p>
                        </div>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {isAdmin && thread.needsAdmin ? (
                            <span className="rounded-md bg-[var(--danger,#dc2626)] px-2 py-1 text-[10px] font-bold text-white">
                              يحتاج ردك
                            </span>
                          ) : null}
                          <span
                            className={`rounded-md px-2.5 py-1 text-[10px] font-bold ${
                              isAi
                                ? "bg-sky-500/15 text-sky-700 dark:text-sky-400"
                                : isHuman
                                  ? "bg-violet-500/15 text-violet-700 dark:text-violet-400"
                                  : isDelivery
                                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                    : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            }`}
                          >
                            {isOrder
                              ? isDelivery
                                ? "⚡ تسليم"
                                : "📦 طلب"
                              : isAi
                                ? "🤖 مساعد آلي"
                                : "👤 دعم الإدارة"}
                          </span>
                        </span>
                      </motion.button>
                    );
                  })}
                  {threads.length === 0 && (
                    <p className="text-sm text-[var(--muted-ink)]">
                      {tr("لا توجد محادثات سابقة.")}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Invoice Modal for selected order */}
      <AnimatePresence>
        {selectedInvoiceOrder && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
            dir={isRtl ? "rtl" : "ltr"}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md rounded-2xl bg-card border border-[var(--line)] p-5 shadow-2xl text-[var(--ink)] max-h-[90vh] flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[var(--line)] shrink-0">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-xl bg-amber-500/15 text-amber-600 flex items-center justify-center">
                    <Receipt className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[var(--ink)]">
                      {isAr ? "فاتورة الطلب الرقمي" : "Digital Order Invoice"}
                    </h3>
                    <p className="text-[11px] font-mono text-[var(--muted-ink)]">
                      {selectedInvoiceOrder.code}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedInvoiceOrder(null)}
                  className="h-8 w-8 rounded-full bg-[var(--surface-3)] hover:bg-[var(--line)] flex items-center justify-center text-[var(--ink)] transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto py-4 space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]">
                  <div>
                    <span className="text-[10px] text-[var(--muted-ink)] block">
                      {isAr ? "تاريخ الطلب" : "Order Date"}
                    </span>
                    <span className="font-bold text-[var(--ink)] text-[11px]">
                      {new Date(selectedInvoiceOrder.createdAt).toLocaleDateString(
                        isAr ? "ar-IQ" : "en-US",
                        {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        },
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--muted-ink)] block">
                      {isAr ? "حالة الدفع" : "Payment Status"}
                    </span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 text-[11px] flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      {isAr ? "مدفوع من المحفظة" : "Paid via Wallet"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--muted-ink)] block">
                      {isAr ? "طريقة التسليم" : "Delivery Method"}
                    </span>
                    <span className="font-bold text-[var(--ink)] text-[11px]">
                      {isAr ? "تسليم رقمي في المحادثة" : "Digital Chat Delivery"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[var(--muted-ink)] block">
                      {isAr ? "حالة الطلب" : "Order Status"}
                    </span>
                    <span className="font-bold text-amber-600 dark:text-amber-400 text-[11px]">
                      {selectedInvoiceOrder.status === "completed"
                        ? isAr
                          ? "مكتمل"
                          : "Completed"
                        : isAr
                          ? "قيد التجهيز"
                          : "Processing"}
                    </span>
                  </div>
                </div>

                {/* Items */}
                <div>
                  <div className="text-[11px] font-bold text-[var(--muted-ink)] mb-2 uppercase tracking-wider">
                    {isAr ? "تفاصيل المنتجات" : "Items Summary"}
                  </div>
                  <div className="border border-[var(--line)] rounded-xl overflow-hidden divide-y divide-[var(--line)]">
                    {selectedInvoiceOrder.items.map((item, i) => (
                      <div
                        key={i}
                        className="p-2.5 flex items-center justify-between gap-2 bg-card"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-[var(--ink)] truncate text-xs">
                            {item.title}
                          </div>
                          <div className="text-[10px] text-[var(--muted-ink)]">
                            {item.quantity || 1} × {(item.unitPrice || 0).toLocaleString()}{" "}
                            {selectedInvoiceOrder.currency || "IQD"}
                          </div>
                        </div>
                        <div className="font-bold text-[var(--ink)] font-mono text-xs">
                          {((item.unitPrice || 0) * (item.quantity || 1)).toLocaleString()}{" "}
                          {selectedInvoiceOrder.currency || "IQD"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals */}
                <div className="p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] space-y-1.5">
                  <div className="flex justify-between text-[var(--muted-ink)] text-[11px]">
                    <span>{isAr ? "المجموع الفرعي:" : "Subtotal:"}</span>
                    <span className="font-mono font-medium">
                      {selectedInvoiceOrder.total.toLocaleString()}{" "}
                      {selectedInvoiceOrder.currency || "IQD"}
                    </span>
                  </div>
                  <div className="flex justify-between text-[var(--muted-ink)] text-[11px]">
                    <span>{isAr ? "رسوم التجهيز والتسليم:" : "Fulfillment Fee:"}</span>
                    <span className="font-mono text-emerald-600 font-bold">
                      {isAr ? "مجاناً" : "Free"}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-[var(--line)] flex justify-between items-baseline font-bold text-[var(--ink)] text-sm">
                    <span>{isAr ? "المجموع النهائي المدفوع:" : "Total Paid:"}</span>
                    <span className="text-base font-black font-mono text-amber-600 dark:text-amber-400">
                      {selectedInvoiceOrder.total.toLocaleString()}{" "}
                      {selectedInvoiceOrder.currency || "IQD"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-[var(--line)] flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    window.print();
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[var(--surface-3)] hover:bg-[var(--line)] text-xs font-bold text-[var(--ink)] transition-colors cursor-pointer"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>{isAr ? "طباعة الفاتورة" : "Print Invoice"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedInvoiceOrder(null)}
                  className="flex-1 py-2.5 rounded-xl bg-[var(--ink)] text-white text-xs font-bold hover:bg-[var(--ink-strong)] transition-colors cursor-pointer"
                >
                  {isAr ? "إغلاق" : "Close"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
