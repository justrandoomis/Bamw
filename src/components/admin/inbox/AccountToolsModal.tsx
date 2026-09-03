import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Gamepad2,
  Key,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Ticket,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Order } from "@/lib/types";
import type { DeliveryItemStatus } from "@/lib/digital-delivery-state";

interface DeliveryItemView {
  id: string;
  orderId: string;
  orderItemId: string | null;
  productId: string | null;
  productTitle: string | null;
  slotNumber: number | null;
  kind: string;
  status: DeliveryItemStatus;
  username: string;
  password: string;
  detectedGame: string | null;
  matchConfidence: number | null;
  sentAt: string | null;
  proofReceivedAt: string | null;
  proofUrl: string | null;
  otpSentAt: string | null;
  completedAt: string | null;
  revision: number;
  archivedAt: string | null;
  updatedAt: string;
}

interface DeliveryStateView {
  orderId: string;
  orderCode: string;
  orderStatus: Order["status"];
  lastOtpSentAt: string | null;
  autoCompleteAt: string | null;
  deliveryIssueOpenedAt: string | null;
  orderItems: Array<{
    id: string;
    productId: string;
    productTitle: string;
    kind: string;
    quantity: number;
    selection: {
      optionName: string;
      typeName: string;
      platform: string;
      editionId: string;
      dlcCount: number;
    };
    /** Admin-only. Copied to the clipboard, never rendered. */
    supplierNameZhCn: string;
  }>;
  deliveryItems: DeliveryItemView[];
  progress: {
    total: number;
    prepared: number;
    delivered: number;
    needsMapping: number;
    drafts: number;
  };
}

interface DeliveryActionResponse {
  success?: boolean;
  state?: DeliveryStateView;
  orderFinished?: boolean;
  nextReadyDeliveryItemId?: string;
  nextOrder?: {
    orderId: string;
    threadId?: string;
    code?: string;
    userName?: string;
  };
  extracted?: number;
  mapped?: number;
  needsMapping?: number;
  skipped?: Array<{ line: number; raw: string }>;
  duplicates?: string[];
  error?: string;
  code?: string;
}

export interface AccountToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  order?: Order | null;
  defaultTab?: "credentials" | "card" | "otp" | "instructions";
  onDeliveryFinished?: (payload: { nextOrder?: DeliveryActionResponse["nextOrder"] }) => void;
  onStateChanged?: () => void;
}

interface DraftFields {
  username: string;
  password: string;
  label?: string;
  matchedItemId?: string;
  matchedItemTitle?: string;
  slotNumber?: number;
  isSent?: boolean;
  needsMapping?: boolean;
  dirty: boolean;
}

const STATUS_LABEL: Record<DeliveryItemStatus, string> = {
  draft: "مسودة",
  needs_mapping: "بحاجة إلى ربط",
  ready: "جاهز",
  sent: "أُرسل الحساب",
  proof_received: "وصل الإثبات",
  otp_sent: "أُرسل OTP",
  completed: "مكتمل",
};

const LOCKED_STATUSES = new Set<DeliveryItemStatus>([
  "sent",
  "proof_received",
  "otp_sent",
  "completed",
]);

function isCodeKind(kind: string) {
  return ["digital_code", "code", "gift_card"].includes(kind);
}

async function readJsonResponse(response: Response): Promise<DeliveryActionResponse> {
  const payload = (await response.json().catch(() => ({}))) as DeliveryActionResponse;
  if (!response.ok) {
    throw new Error(payload.error || payload.code || "تعذر حفظ بيانات التسليم في D1");
  }
  return payload;
}

/**
 * Put text on the clipboard without telling anybody.
 *
 * No icon, no tooltip, no toast, no change of colour: an admin clicks the game
 * name and the Chinese supplier name is on the clipboard. The point is speed
 * during fulfilment — a confirmation would be one more thing to dismiss on
 * every line of every order.
 *
 * `navigator.clipboard` needs a secure context and is refused outright by some
 * mobile browsers inside a modal, so the textarea path is kept as the
 * fallback. It is deliberately off-screen rather than hidden: an element with
 * `display:none` cannot be selected, which is why the obvious version of this
 * trick silently does nothing on Safari.
 */
async function copySilently(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied or unavailable — fall through rather than give up.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** The parts of a selection worth a line on a card, already joined. */
function selectionLine(selection: {
  optionName: string;
  typeName: string;
  platform: string;
  dlcCount: number;
}): string {
  return [
    selection.optionName,
    selection.typeName,
    selection.platform,
    selection.dlcCount > 0 ? `+${selection.dlcCount} إضافة` : "",
  ]
    .filter(Boolean)
    .join(" • ");
}

export function AccountToolsModal({
  isOpen,
  onClose,
  order,
  defaultTab = "credentials",
  onDeliveryFinished,
  onStateChanged,
}: AccountToolsModalProps) {
  const [deliveryState, setDeliveryState] = useState<DeliveryStateView | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftFields>>({});
  const [otpById, setOtpById] = useState<Record<string, string>>({});
  const [quickPaste, setQuickPaste] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isQuickPasting, setIsQuickPasting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [showPassword, setShowPassword] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastQuickPasteRef = useRef("");
  const deliveryStateRef = useRef<DeliveryStateView | null>(null);
  const draftsRef = useRef<Record<string, DraftFields>>({});
  const saveChainRef = useRef<Promise<DeliveryStateView | null>>(Promise.resolve(null));

  const applyState = useCallback(
    (next: DeliveryStateView, preserveDirty = false) => {
      deliveryStateRef.current = next;
      setDeliveryState(next);
      const result: Record<string, DraftFields> = {};
      for (const item of next.deliveryItems) {
        const pending = draftsRef.current[item.id];
        result[item.id] =
          preserveDirty && pending?.dirty
            ? pending
            : {
                username: item.username,
                password: item.password,
                dirty: false,
              };
      }
      draftsRef.current = result;
      setDrafts(result);
      setSelectedId((current) => {
        if (current && next.deliveryItems.some((item) => item.id === current)) return current;
        const preferred =
          defaultTab === "otp"
            ? next.deliveryItems.find((item) => item.status === "proof_received")
            : next.deliveryItems.find(
                (item) => item.orderItemId && !["otp_sent", "completed"].includes(item.status),
              );
        return preferred?.id || next.deliveryItems[0]?.id || "";
      });
    },
    [defaultTab],
  );

  const loadState = useCallback(async () => {
    if (!order?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/orders?delivery=1&orderId=${encodeURIComponent(order.id)}`,
        { credentials: "include" },
      );
      const payload = await readJsonResponse(response);
      if (!payload.state) throw new Error("لم تُرجع الخدمة حالة تجهيز صالحة");
      applyState(payload.state);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل بيانات التجهيز");
    } finally {
      setIsLoading(false);
    }
  }, [applyState, order?.id]);

  useEffect(() => {
    if (isOpen) void loadState();
  }, [isOpen, loadState]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    },
    [],
  );

  const postAction = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!order?.id) throw new Error("الطلب غير مرتبط بالمحادثة");
      const response = await fetch("/api/admin/orders", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          threadId: order.threadId,
          ...payload,
        }),
      });
      return readJsonResponse(response);
    },
    [order?.id, order?.threadId],
  );

  const saveOneDraft = useCallback(
    (deliveryItemId: string, fields?: DraftFields): Promise<DeliveryStateView | null> => {
      const snapshot = fields || draftsRef.current[deliveryItemId];
      if (!snapshot?.dirty) {
        return saveChainRef.current.then(() => deliveryStateRef.current);
      }

      const task = saveChainRef.current
        .catch(() => null)
        .then(async () => {
          setSavingIds((value) => ({ ...value, [deliveryItemId]: true }));
          try {
            const result = await postAction({
              action: "save_delivery_draft",
              deliveryItemId,
              email: snapshot.username,
              password: snapshot.password,
            });
            if (result.state) applyState(result.state, true);
            setDrafts((value) => {
              const latest = value[deliveryItemId];
              if (
                !latest ||
                latest.username !== snapshot.username ||
                latest.password !== snapshot.password
              ) {
                return value;
              }
              const next = {
                ...value,
                [deliveryItemId]: { ...latest, dirty: false },
              };
              draftsRef.current = next;
              return next;
            });
            onStateChanged?.();
            return result.state || deliveryStateRef.current;
          } finally {
            setSavingIds((value) => ({ ...value, [deliveryItemId]: false }));
          }
        });
      saveChainRef.current = task.catch(() => deliveryStateRef.current);
      return task;
    },
    [applyState, onStateChanged, postAction],
  );

  const scheduleDraftSave = useCallback(
    (deliveryItemId: string, next: Omit<DraftFields, "dirty">) => {
      const fields: DraftFields = { ...next, dirty: true };
      const nextDrafts = { ...draftsRef.current, [deliveryItemId]: fields };
      draftsRef.current = nextDrafts;
      setDrafts(nextDrafts);
      const previousTimer = timersRef.current.get(deliveryItemId);
      if (previousTimer) clearTimeout(previousTimer);
      const timer = setTimeout(() => {
        timersRef.current.delete(deliveryItemId);
        void saveOneDraft(deliveryItemId, fields).catch((saveError) => {
          toast.error(saveError instanceof Error ? saveError.message : "فشل الحفظ التلقائي");
        });
      }, 450);
      timersRef.current.set(deliveryItemId, timer);
    },
    [saveOneDraft],
  );

  const flushDraft = useCallback(
    async (deliveryItemId: string) => {
      const timer = timersRef.current.get(deliveryItemId);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(deliveryItemId);
      }
      return saveOneDraft(deliveryItemId, draftsRef.current[deliveryItemId]);
    },
    [saveOneDraft],
  );

  const handleClose = async () => {
    const dirtyIds = Object.entries(draftsRef.current)
      .filter(([, fields]) => fields.dirty)
      .map(([id]) => id);
    try {
      await Promise.all(dirtyIds.map((id) => flushDraft(id)));
      onClose();
    } catch (closeError) {
      toast.error(closeError instanceof Error ? closeError.message : "لم يكتمل حفظ المسودات");
    }
  };

  const selected = useMemo(
    () => deliveryState?.deliveryItems.find((item) => item.id === selectedId) || null,
    [deliveryState?.deliveryItems, selectedId],
  );
  const selectedDraft = selected ? drafts[selected.id] : undefined;

  /*
    A delivery item names its order item; the order item carries the selection
    and the Chinese name. One index, so the three lookups below are not three
    scans per card.
  */
  const orderItemById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof deliveryState>["orderItems"][number]>();
    for (const item of deliveryState?.orderItems ?? []) map.set(item.id, item);
    return map;
  }, [deliveryState?.orderItems]);

  const selectionFor = useCallback(
    (orderItemId: string | null) => {
      const item = orderItemId ? orderItemById.get(orderItemId) : undefined;
      return item ? selectionLine(item.selection) : "";
    },
    [orderItemById],
  );

  const quantityFor = useCallback(
    (orderItemId: string | null) => {
      const item = orderItemId ? orderItemById.get(orderItemId) : undefined;
      return item?.quantity ?? 1;
    },
    [orderItemById],
  );

  /**
   * Copy the Chinese supplier name, silently.
   *
   * When there is no Chinese name the English title is *not* copied as a
   * fallback: an order placed against an English title is an order placed for
   * the wrong thing. Nothing goes on the clipboard and the gap is logged for
   * an admin to fill in.
   */
  const copySupplierName = useCallback(
    async (orderItemId: string | null) => {
      const item = orderItemId ? orderItemById.get(orderItemId) : undefined;
      const name = item?.supplierNameZhCn ?? "";
      if (!name) {
        console.warn("[delivery:supplier_name_zh_missing]", {
          orderItemId,
          productId: item?.productId ?? "",
          productTitle: item?.productTitle ?? "",
        });
        return;
      }
      await copySilently(name);
    },
    [orderItemById],
  );
  const mappedItems = useMemo(
    () => deliveryState?.deliveryItems.filter((item) => Boolean(item.orderItemId)) || [],
    [deliveryState?.deliveryItems],
  );
  const unmappedItems = useMemo(
    () => deliveryState?.deliveryItems.filter((item) => item.status === "needs_mapping") || [],
    [deliveryState?.deliveryItems],
  );

  const handleQuickPaste = useCallback(async () => {
    const rawText = quickPaste.trim();
    if (!rawText || isQuickPasting || rawText === lastQuickPasteRef.current) return;
    setIsQuickPasting(true);
    try {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
      const dirtyDrafts = Object.entries(draftsRef.current).filter(([, fields]) => fields.dirty);
      await Promise.all(dirtyDrafts.map(([id, fields]) => saveOneDraft(id, fields)));
      const result = await postAction({
        action: "delivery_quick_paste",
        rawText,
      });
      lastQuickPasteRef.current = rawText;
      if (result.state) applyState(result.state);
      setQuickPaste("");
      toast.success(
        `تم حفظ ${result.extracted || 0} حساب في D1: ${result.mapped || 0} مطابق، ${
          result.needsMapping || 0
        } يحتاج ربطًا`,
      );
      if (result.skipped?.length) toast.warning(`تعذر استخراج ${result.skipped.length} سطر`);
      onStateChanged?.();
    } catch (pasteError) {
      toast.error(pasteError instanceof Error ? pasteError.message : "فشل اللصق السريع");
    } finally {
      setIsQuickPasting(false);
    }
  }, [applyState, isQuickPasting, onStateChanged, postAction, quickPaste, saveOneDraft]);

  useEffect(() => {
    if (!isOpen || !quickPaste.trim() || isQuickPasting) return;
    if (!/(?:密码|密碼|password|pass|pwd)/i.test(quickPaste)) return;
    const timer = setTimeout(() => void handleQuickPaste(), 700);
    return () => clearTimeout(timer);
  }, [handleQuickPaste, isOpen, isQuickPasting, quickPaste]);

  const mapItem = async (sourceDeliveryItemId: string, targetDeliveryItemId: string) => {
    setBusyId(sourceDeliveryItemId);
    try {
      const result = await postAction({
        action: "map_delivery_item",
        sourceDeliveryItemId,
        targetDeliveryItemId,
      });
      if (result.state) applyState(result.state);
      setSelectedId(targetDeliveryItemId);
      toast.success("تم ربط الحساب باللعبة المحددة وحفظه");
      onStateChanged?.();
    } catch (mapError) {
      toast.error(mapError instanceof Error ? mapError.message : "تعذر ربط الحساب");
    } finally {
      setBusyId(null);
    }
  };

  const sendCredentials = async () => {
    if (!selected) return;
    setBusyId(selected.id);
    try {
      await flushDraft(selected.id);
      const result = await postAction({
        action: "send_delivery_credentials",
        deliveryItemId: selected.id,
      });
      if (result.state) applyState(result.state);
      if (result.nextReadyDeliveryItemId) {
        setSelectedId(result.nextReadyDeliveryItemId);
        toast.success("تم إرسال هذا الحساب والانتقال إلى الحساب الجاهز التالي");
      } else {
        toast.success("تم إرسال بيانات هذا الحساب. لا يوجد حساب آخر جاهز للإرسال الآن.");
      }
      onStateChanged?.();
    } catch (sendError) {
      toast.error(sendError instanceof Error ? sendError.message : "فشل إرسال الحساب");
    } finally {
      setBusyId(null);
    }
  };

  const sendOtp = async () => {
    if (!selected) return;
    const code = (otpById[selected.id] || "").trim();
    if (!code) {
      toast.error("أدخل كود OTP");
      return;
    }
    setBusyId(selected.id);
    try {
      const result = await postAction({
        action: "send_delivery_otp",
        deliveryItemId: selected.id,
        code,
      });
      if (result.state) applyState(result.state);
      setOtpById((value) => ({ ...value, [selected.id]: "" }));
      onStateChanged?.();
      if (result.orderFinished) {
        toast.success("تم إرسال آخر OTP وإخراج الطلب من طابور التجهيز");
        onDeliveryFinished?.({ nextOrder: result.nextOrder });
        onClose();
      } else if (result.nextReadyDeliveryItemId) {
        setSelectedId(result.nextReadyDeliveryItemId);
        toast.success("تم إرسال OTP والانتقال إلى اللعبة الجاهزة التالية");
      } else {
        toast.success("تم إرسال OTP لهذا الحساب. الطلب ينتظر بقية العناصر.");
      }
    } catch (otpError) {
      toast.error(otpError instanceof Error ? otpError.message : "فشل إرسال OTP");
    } finally {
      setBusyId(null);
    }
  };

  const sendCode = async () => {
    if (!selected || !selectedDraft?.username.trim()) return;
    setBusyId(selected.id);
    try {
      await flushDraft(selected.id);
      const result = await postAction({
        action: "send_delivery_code",
        deliveryItemId: selected.id,
        code: selectedDraft.username,
        pin: selectedDraft.password || undefined,
      });
      if (result.state) applyState(result.state);
      onStateChanged?.();
      if (result.orderFinished) {
        toast.success("تم إرسال آخر كود وإخراج الطلب من طابور التجهيز");
        onDeliveryFinished?.({ nextOrder: result.nextOrder });
        onClose();
      } else {
        toast.success("تم إرسال الكود لهذا العنصر");
      }
    } catch (codeError) {
      toast.error(codeError instanceof Error ? codeError.message : "فشل إرسال الكود");
    } finally {
      setBusyId(null);
    }
  };

  const copyValue = async (value: string, key: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(key);
    toast.success("تم النسخ");
    setTimeout(() => setCopied(null), 1400);
  };

  const generatePassword = () => {
    if (!selected || !selectedDraft) return;
    const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let generated = "";
    for (let index = 0; index < 12; index += 1) {
      generated += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    scheduleDraftSave(selected.id, {
      username: selectedDraft.username,
      password: generated,
    });
    toast.success("تم توليد كلمة مرور جديدة");
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      dir="rtl"
    >
      <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/20 px-4 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="rounded-xl bg-amber-500/10 p-2 text-amber-500">
              <Key className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-foreground">أداة تسليم الطلب</h3>
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                  #{deliveryState?.orderCode || order?.code || "—"}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                المصدر: order → order_items → product_id → product.title
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleClose()}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-xs font-bold text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> تحميل المسودات من D1...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
              <div className="flex items-center gap-2 font-bold">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
              <button
                type="button"
                onClick={() => void loadState()}
                className="mt-3 inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-bold cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" /> إعادة المحاولة
              </button>
            </div>
          ) : deliveryState ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-300">
                  تم تجهيز {deliveryState.progress.prepared} من {deliveryState.progress.total}
                </div>
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                  تم تسليم {deliveryState.progress.delivered} من {deliveryState.progress.total}
                </div>
              </div>

              <div className="space-y-2 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                    <ClipboardPaste className="h-4 w-4" /> اللصق السريع
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleQuickPaste()}
                    disabled={!quickPaste.trim() || isQuickPasting}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 cursor-pointer"
                  >
                    {isQuickPasting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}{" "}
                    استخراج وحفظ
                  </button>
                </div>
                <textarea
                  value={quickPaste}
                  onChange={(event) => {
                    setQuickPaste(event.target.value);
                    if (event.target.value.trim() !== lastQuickPasteRef.current)
                      lastQuickPasteRef.current = "";
                  }}
                  rows={3}
                  dir="ltr"
                  placeholder="ttxx7834 密码 a8dqq9sr 运动switch&#10;rrtt8896 密码 45g54pby 朋友收集 梦想生活"
                  className="w-full resize-y rounded-xl border border-border bg-background p-2.5 font-mono text-xs leading-relaxed text-foreground outline-hidden focus:ring-2 focus:ring-amber-500/30"
                />
                <p className="text-[10px] text-muted-foreground">
                  كل سطر يُحفظ كسجل مستقل. السطر غير الموثوق لا يُوزع على أي لعبة.
                </p>
              </div>

              {unmappedItems.length > 0 && (
                <div className="space-y-2 rounded-2xl border border-red-500/30 bg-red-500/5 p-3.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-300">
                    <AlertCircle className="h-4 w-4" />
                    {unmappedItems.length} حساب يحتاج ربطًا يدويًا
                  </div>
                  {unmappedItems.map((source) => {
                    const availableTargets = mappedItems.filter((target) => {
                      const draft = drafts[target.id];
                      return (
                        ["draft", "ready"].includes(target.status) &&
                        !(draft?.username || target.username)
                      );
                    });
                    return (
                      <div key={source.id} className="rounded-xl border border-border bg-card p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="font-mono font-bold" dir="ltr">
                            {source.username}
                          </span>
                          <span className="text-red-600">
                            الكشف: {source.detectedGame || "لم يُتعرف على لعبة"}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {availableTargets.length ? (
                            availableTargets.map((target) => (
                              <button
                                type="button"
                                key={target.id}
                                disabled={busyId === source.id}
                                onClick={() => void mapItem(source.id, target.id)}
                                className="rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] font-bold text-primary disabled:opacity-50 cursor-pointer"
                              >
                                {target.productTitle}{" "}
                                {target.slotNumber ? `#${target.slotNumber}` : ""}
                                {/*
                                  Two lines of the same game — one offline, one
                                  online — are identical by title, and that is
                                  exactly when a wrong mapping gets confirmed.
                                */}
                                {selectionFor(target.orderItemId) ? (
                                  <span className="mt-0.5 block text-[9px] font-bold">
                                    {selectionFor(target.orderItemId)}
                                  </span>
                                ) : null}
                              </button>
                            ))
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              لا توجد خانة لعبة فارغة؛ راجع عدد عناصر الطلب.
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Gamepad2 className="h-4 w-4 text-primary" /> الألعاب وعناصر التسليم
                  </span>
                  <span>{mappedItems.length} خانة مستقلة</span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {mappedItems.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`min-w-[145px] rounded-xl border px-3 py-2 text-right transition-colors cursor-pointer ${
                        selectedId === item.id
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:bg-muted/50"
                      }`}
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          /*
                            The name copies; it does not select the card.
                            Without stopping the event it would bubble to the
                            chip's own onClick and an admin trying to copy
                            would change what they are looking at.
                          */
                          event.stopPropagation();
                          void copySupplierName(item.orderItemId);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          event.stopPropagation();
                          void copySupplierName(item.orderItemId);
                        }}
                        className="block truncate text-[11px] font-bold text-foreground"
                      >
                        {item.productTitle}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        #{item.slotNumber || 1} • {STATUS_LABEL[item.status]}
                      </span>
                      {/*
                        What was actually sold. The title alone is not enough
                        to prepare an account: an offline account and an online
                        one are different products behind the same name.
                      */}
                      {selectionFor(item.orderItemId) ? (
                        <span className="mt-0.5 block truncate text-[10px] font-bold text-primary">
                          {selectionFor(item.orderItemId)}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>

              {selected && selected.orderItemId && selectedDraft && (
                <div className="space-y-4 rounded-2xl border border-border bg-muted/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold text-muted-foreground">
                        اسم اللعبة من D1
                      </span>
                      <div className="mt-1 flex items-center gap-1.5 text-sm font-black text-foreground">
                        <Gamepad2 className="h-4 w-4 shrink-0 text-primary" />
                        {/*
                          Same silent copy as the chip. Identical styling to
                          before — no icon, no tooltip, no colour change: the
                          only thing that happens is the clipboard.
                        */}
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={() => void copySupplierName(selected.orderItemId)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            void copySupplierName(selected.orderItemId);
                          }}
                          className="min-w-0 truncate"
                        >
                          {selected.productTitle}
                        </span>
                      </div>
                      {/*
                        The selection, from the order's own snapshot — not from
                        the product as it stands today, so editing a product
                        cannot change what an old order says was sold.
                      */}
                      {selectionFor(selected.orderItemId) ? (
                        <div className="mt-1 text-[11px] font-bold text-primary">
                          {selectionFor(selected.orderItemId)}
                        </div>
                      ) : null}
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        الكمية: {quantityFor(selected.orderItemId)} • رقم العنصر:{" "}
                        <span dir="ltr">{selected.orderItemId ?? "—"}</span>
                      </div>
                    </div>
                    <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
                      {STATUS_LABEL[selected.status]}
                    </span>
                  </div>

                  {isCodeKind(selected.kind) ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5 text-xs font-bold">
                        <span>كود التفعيل</span>
                        <input
                          dir="ltr"
                          value={selectedDraft.username}
                          disabled={LOCKED_STATUSES.has(selected.status)}
                          onChange={(event) =>
                            scheduleDraftSave(selected.id, {
                              username: event.target.value,
                              password: selectedDraft.password,
                            })
                          }
                          className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs disabled:opacity-60"
                        />
                      </label>
                      <label className="space-y-1.5 text-xs font-bold">
                        <span>PIN اختياري</span>
                        <input
                          dir="ltr"
                          value={selectedDraft.password}
                          disabled={LOCKED_STATUSES.has(selected.status)}
                          onChange={(event) =>
                            scheduleDraftSave(selected.id, {
                              username: selectedDraft.username,
                              password: event.target.value,
                            })
                          }
                          className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs disabled:opacity-60"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5 text-xs font-bold">
                        <span>البريد الإلكتروني / اسم المستخدم</span>
                        <div className="relative">
                          <input
                            dir="ltr"
                            value={selectedDraft.username}
                            disabled={LOCKED_STATUSES.has(selected.status)}
                            onChange={(event) =>
                              scheduleDraftSave(selected.id, {
                                username: event.target.value,
                                password: selectedDraft.password,
                              })
                            }
                            onBlur={() => void flushDraft(selected.id)}
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 pl-8 font-mono text-xs disabled:opacity-60"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              void copyValue(selectedDraft.username, `user-${selected.id}`)
                            }
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            {copied === `user-${selected.id}` ? (
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </label>
                      <label className="space-y-1.5 text-xs font-bold">
                        <span className="flex items-center justify-between">
                          كلمة المرور
                          {!LOCKED_STATUSES.has(selected.status) && (
                            <button
                              type="button"
                              onClick={generatePassword}
                              className="text-[10px] text-primary cursor-pointer hover:underline font-bold"
                            >
                              توليد
                            </button>
                          )}
                        </span>
                        <div className="relative">
                          <input
                            type={showPassword ? "text" : "password"}
                            dir="ltr"
                            value={selectedDraft.password}
                            disabled={LOCKED_STATUSES.has(selected.status)}
                            onChange={(event) =>
                              scheduleDraftSave(selected.id, {
                                username: selectedDraft.username,
                                password: event.target.value,
                              })
                            }
                            onBlur={() => void flushDraft(selected.id)}
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 pl-9 font-mono text-xs disabled:opacity-60"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((value) => !value)}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            {showPassword ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </label>
                    </div>
                  )}

                  <div className="flex min-h-5 items-center gap-1.5 text-[10px] text-muted-foreground">
                    {savingIds[selected.id] ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" /> جارٍ حفظ مسودة هذه اللعبة في
                        D1...
                      </>
                    ) : selectedDraft.dirty ? (
                      "بانتظار الحفظ التلقائي..."
                    ) : (
                      <>
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" /> المسودة محفوظة على
                        الخادم
                      </>
                    )}
                  </div>

                  {!isCodeKind(selected.kind) && (
                    <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-3">
                      <div className="mb-2 flex items-center justify-between text-xs font-bold text-blue-800 dark:text-blue-300">
                        <span className="flex items-center gap-1.5">
                          <ShieldCheck className="h-4 w-4" /> OTP لهذا الحساب
                        </span>
                        {selected.proofReceivedAt ? "تم استلام الإثبات" : "ينتظر إثبات العميل"}
                      </div>
                      <div className="flex gap-2">
                        <input
                          dir="ltr"
                          value={otpById[selected.id] || ""}
                          onChange={(event) =>
                            setOtpById((value) => ({
                              ...value,
                              [selected.id]: event.target.value,
                            }))
                          }
                          disabled={selected.status !== "proof_received"}
                          placeholder="أدخل OTP"
                          className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs tracking-widest disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={() => void sendOtp()}
                          disabled={
                            selected.status !== "proof_received" ||
                            !(otpById[selected.id] || "").trim() ||
                            busyId === selected.id
                          }
                          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40 cursor-pointer"
                        >
                          {busyId === selected.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}{" "}
                          إرسال OTP
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/20 p-4">
          <button
            type="button"
            onClick={() => void handleClose()}
            className="px-4 py-2 text-xs font-bold text-muted-foreground hover:text-foreground cursor-pointer"
          >
            إغلاق
          </button>
          {selected && selectedDraft && isCodeKind(selected.kind) ? (
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={
                !selectedDraft.username.trim() ||
                LOCKED_STATUSES.has(selected.status) ||
                busyId === selected.id
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-foreground px-5 py-2.5 text-xs font-bold text-background disabled:opacity-40 cursor-pointer"
            >
              {busyId === selected.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Ticket className="h-3.5 w-3.5" />
              )}{" "}
              إرسال كود هذا العنصر
            </button>
          ) : selected ? (
            <button
              type="button"
              onClick={() => void sendCredentials()}
              disabled={
                selected.status !== "ready" ||
                busyId === selected.id ||
                Boolean(savingIds[selected.id])
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-foreground px-5 py-2.5 text-xs font-bold text-background disabled:opacity-40 cursor-pointer"
            >
              {busyId === selected.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}{" "}
              إرسال الحساب المحدد
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default AccountToolsModal;
