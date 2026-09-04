import { tr, useI18n } from "@/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Minus,
  Plus,
  Trash2,
  Truck,
  Zap,
  ChevronDown,
  Wallet,
  MapPin,
  Ticket,
  CheckCircle2,
  Sparkles,
  AlertCircle,
  Gamepad2,
  Copy,
  MessageCircle,
  Check,
  ExternalLink,
  ShieldCheck,
  CheckSquare,
  Square,
  Package,
  Layers,
  ArrowUpRight,
  RefreshCw,
  X,
} from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { validateCoupon } from "@/lib/reviews-coupons.functions";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type { Address, Product, ProductKind, Order } from "@/lib/types";
import { cartNeedsAddress, cartTotal, useCartStore } from "@/store/useCartStore";
import type { CartLine } from "@/store/useCartStore";
import { cdnImage } from "@/lib/img";
import NintendoCover from "@/components/NintendoCover";
import { resolvePurchaseImage } from "@/lib/nintendoImages";
import { playSound } from "@/utils/audio";
import { useCurrency } from "@/context/CurrencyContext";
import { getCart, updateCartItem, removeCartItem } from "@/lib/cart.functions";
import { cartLinePrice } from "@/lib/productPricing";
import ReferralCartField, {
  type ReferralCartState,
} from "@/components/referral/ReferralCartField";

/**
 * A cart line as the coupon rules need to see it.
 *
 * The selection travels: a coupon restricted to offline accounts is decided
 * from `optionId`/`typeId`, and sending the line without them is why such a
 * coupon could never match anything. The cart's answer is a preview only —
 * checkout re-derives all of this from the catalogue.
 */
function couponItemFromLine(line: CartLine) {
  return {
    productId: String(line.productId),
    categoryId: String(
      (line.source as Record<string, unknown> | undefined)?.["categoryId"] ??
        (line.source as Record<string, unknown> | undefined)?.["category"] ??
        "",
    ),
    kind: String(line.kind),
    unitPrice: Number(line.price),
    quantity: Number(line.quantity),
    title: String(line.title),
    optionId: String(line.optionId ?? line.meta?.optionId ?? ""),
    optionName: String(line.optionName ?? line.meta?.optionName ?? ""),
    typeId: String(line.typeId ?? line.meta?.typeId ?? ""),
    typeName: String(line.typeName ?? line.meta?.typeName ?? ""),
    offerKind: String(line.offerKind ?? ""),
  };
}
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/cart")({
  head: () => ({
    meta: [
      { title: "سلة المشتريات — بنانا ستور" },
      {
        name: "description",
        content: "أكمل شراء الحسابات الرقمية والأجهزة بأمان وسرعة فائقة من محفظتك.",
      },
      { property: "og:title", content: "سلة المشتريات — بنانا ستور" },
      { property: "og:description", content: "دفع سهل وتسليم الحسابات فورياً عبر محادثة الطلب." },
    ],
  }),
  component: CartPage,
});

const emptyAddress: Omit<Address, "id"> = {
  label: "المنزل",
  fullName: "",
  phone: "",
  city: "",
  area: "",
  street: "",
  notes: "",
};

/** Single Cart Item Card */
function CartItemCard({
  line,
  onUpdateQuantity,
  onRequestDelete,
}: {
  line: CartLine;
  onUpdateQuantity: (id: string | number, delta: number) => void;
  onRequestDelete: (line: CartLine) => void;
}) {
  const { formatIQDPrice } = useCurrency();
  const itemTotal = line.price * line.quantity;

  const getKindBadge = () => {
    if (line.requiresAddress || line.kind === "hardware") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
          <Truck className="h-3 w-3" /> {tr("شحن وتوصيل")}
        </span>
      );
    }
    if (line.kind === "bundle") {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20">
          <Layers className="h-3 w-3" /> {tr("باقة ألعاب")}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
        <Zap className="h-3 w-3" /> {tr("تسليم فوري")}
      </span>
    );
  };

  const getOptionLabel = () => {
    const parts: string[] = [];
    if (line.offerLabel) parts.push(line.offerLabel);
    if (line.optionName) parts.push(line.optionName);
    if (line.typeName) parts.push(line.typeName);
    if (line.meta?.editionId) parts.push(`إصدار خاص`);
    return parts.join(" • ");
  };

  const optionLabel = getOptionLabel();

  return (
    <motion.div
      id={`cart-item-${line.productId}`}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, height: 0, transition: { duration: 0.25 } }}
      className="p-4 bg-[var(--card)] hover:bg-muted/20 transition-colors border-b border-border/60 last:border-0"
    >
      <div className="flex items-start gap-3.5">
        {/* Product Image */}
        <div className="relative shrink-0">
          {line.image || line.source ? (
            /* Square tile, cover fitted whole inside it — the same picture the
               product page and the add-to-cart toast just showed. */
            <NintendoCover
              product={(line.source as Record<string, unknown>) ?? { image: line.image }}
              usage="cart"
              ratio={1}
              alt={line.title}
              className="w-20 h-20 sm:w-22 sm:h-22 rounded-2xl border border-border/70 bg-muted shadow-sm"
            />
          ) : (
            <div className="w-20 h-20 sm:w-22 sm:h-22 rounded-2xl bg-muted/80 border border-border flex items-center justify-center text-muted-foreground shadow-sm">
              <Gamepad2 className="w-8 h-8 opacity-60" />
            </div>
          )}
        </div>

        {/* Product Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3
              className="text-sm sm:text-base font-black text-foreground leading-snug line-clamp-2"
              dir="ltr"
            >
              {line.title}
            </h3>

            {/* Delete button (desktop / direct) */}
            <button
              id={`delete-btn-${line.productId}`}
              onClick={() => onRequestDelete(line)}
              className="p-1.5 -m-1 text-muted-foreground hover:text-destructive active:scale-90 transition-all rounded-lg hover:bg-destructive/10 shrink-0"
              title={tr("حذف المنتج من السلة")}
              aria-label={tr("حذف المنتج")}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Option / Variant Label */}
          {optionLabel && (
            <p className="text-[11px] text-muted-foreground font-medium mt-1 truncate">
              {optionLabel}
            </p>
          )}

          {/* Badges & Price per unit */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {getKindBadge()}
            <div className="text-xs text-muted-foreground">
              <span>{tr("سعر الوحدة")}: </span>
              <span className="font-bold text-foreground">{formatIQDPrice(line.price)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Item Controls & Total */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/40">
        {/* Quantity Controls */}
        <div className="flex items-center gap-2">
          <button
            id={`qty-minus-${line.productId}`}
            onClick={() => {
              if (line.quantity <= 1) {
                onRequestDelete(line);
              } else {
                playSound("hover", 0.4);
                onUpdateQuantity(line.productId, line.quantity - 1);
              }
            }}
            className="w-8 h-8 rounded-xl border border-border bg-background hover:bg-muted active:scale-90 text-foreground flex items-center justify-center transition-all shadow-xs"
            aria-label="إنقاص الكمية"
          >
            {line.quantity <= 1 ? (
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            ) : (
              <Minus className="w-3.5 h-3.5" />
            )}
          </button>

          <span
            className="font-black text-foreground text-sm min-w-[28px] text-center select-none"
            dir="ltr"
          >
            {line.quantity}
          </span>

          <button
            id={`qty-plus-${line.productId}`}
            onClick={() => {
              playSound("hover", 0.4);
              onUpdateQuantity(line.productId, line.quantity + 1);
            }}
            className="w-8 h-8 rounded-xl border border-border bg-background hover:bg-muted active:scale-90 text-foreground flex items-center justify-center transition-all shadow-xs"
            aria-label="زيادة الكمية"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Item Total */}
        <div className="text-right">
          <span className="text-[11px] text-muted-foreground ml-1">{tr("الإجمالي")}:</span>
          <span className="text-sm sm:text-base font-black text-foreground">
            {formatIQDPrice(itemTotal)}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function CartPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { formatIQDPrice } = useCurrency();
  const {
    lines: localLines,
    setQuantity: setLocalQuantity,
    remove: removeLocal,
    clear,
  } = useCartStore();

  // State: Deletion Confirmation Modal
  const [itemToDelete, setItemToDelete] = useState<CartLine | null>(null);

  // State: Terms & Policy Checkbox
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [highlightTerms, setHighlightTerms] = useState(false);

  // State: Modals & Flow
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showInsufficientModal, setShowInsufficientModal] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isPolicySheetOpen, setIsPolicySheetOpen] = useState(false);

  // Idempotency Key for single safe checkout transaction
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  const fetchCartFn = useServerFn(getCart);
  const updateItemFn = useServerFn(updateCartItem);
  const removeItemFn = useServerFn(removeCartItem);

  const { data: dbItems = [] } = useQuery({
    queryKey: ["cart"],
    queryFn: () => fetchCartFn(),
    enabled: !!user,
  });

  const { data: storeData } = useQuery({
    queryKey: ["store", "full"],
    queryFn: async () => {
      return await api.store();
    },
  });

  const products = (storeData?.products ?? []) as Product[];
  const bundles = (storeData?.bundles ?? []) as any[];

  /*
    The price a cart line is worth *now*.

    A line lives in localStorage, so its price is whatever the catalogue said
    on the day it was added — and it survives restarts, so "that day" can be
    weeks ago. The old rule here was `l.price || product?.price`, which made
    the stored figure win outright: the admin raised a price, the cart went on
    showing the old one, the wallet check used the old one, and the server
    then charged the new one. Three numbers for one purchase.

    The catalogue wins now, resolved through the same function checkout prices
    with, so the number on this screen is the number that will be taken. The
    stored price is kept only as a last resort for a line whose product has
    left the catalogue entirely — checkout refuses that line anyway, and
    showing a blank 0 would say less than showing what it used to cost.
  */
  // Combine both local Zustand lines and DB lines
  const lines: CartLine[] = useMemo(() => {
    if (localLines && localLines.length > 0) {
      return localLines.map((l) => {
        const product = products.find((p) => String(p.id) === String(l.productId)) as any;
        return {
          ...l,
          title: l.title || product?.titleEn || product?.english_name || product?.title || "منتج",
          // The catalogue wins over the persisted line. A cart line is stored
          // in localStorage, so a picture chosen by an older build (or from a
          // field that has since been corrected) would otherwise be pinned
          // there forever — which is exactly how the cart ended up disagreeing
          // with the product page about the same purchase.
          image: product ? resolvePurchaseImage(product).url : l.image || "",
          source: product,
          price: cartLinePrice(product, l),
          /** What it cost when it was added, so a change can be pointed out. */
          addedAtPrice: Number(l.price) || 0,
        };
      });
    }

    return dbItems.map((item: any) => {
      const product = products.find((p) => String(p.id) === String(item.product_id)) as any;
      const bundle = bundles.find((b) => String(b.id) === String(item.product_id)) as any;
      const entity = product || bundle;

      const isBundle = !product && !!bundle;
      const kind: ProductKind = isBundle ? "bundle" : ((product?.kind || "account") as ProductKind);
      /*
        Read once, before the line is built: the price below is resolved from
        the selection this row carries, and the same object is handed back on
        the line.
      */
      const meta: Record<string, unknown> | undefined = item.meta
        ? typeof item.meta === "string"
          ? JSON.parse(item.meta)
          : item.meta
        : undefined;

      return {
        /*
          The db-backed lines had no `id`. Every line needs one — it is what
          `remove` and `setQuantity` target — and without it these were not
          `CartLine`s at all. The cart row's own id is stable and unique.
        */
        id: String(item.id ?? `${item.product_id}_${kind}`),
        productId: item.product_id,
        title:
          entity?.titleEn || (entity as any)?.english_name || entity?.title || "منتج غير معروف",
        image: resolvePurchaseImage(entity).url,
        source: entity,
        // Same rule as above: the catalogue, priced through the selection.
        price: cartLinePrice(entity, { meta }),
        kind,
        quantity: item.quantity,
        requiresAddress: isBundle
          ? false
          : ["hardware", "physical", "accessory", "device", "collectible"].includes(
              product?.kind || "",
            ),
        meta,
      };
    });
  }, [localLines, dbItems, products, bundles]);

  const [address, setAddress] = useState<Omit<Address, "id">>(
    () => user?.addresses.find((a) => a.isDefault) ?? emptyAddress,
  );
  const [error, setError] = useState<string>();

  /*
    Prices that moved while the cart sat open.

    Re-pricing silently would swap the number under the customer between one
    glance and the next, which is only a little better than charging them the
    old one. Naming the change is the honest half of the fix: they see what it
    was, what it is, and can decide before paying.
  */
  const changedPrices = useMemo(
    () =>
      lines.flatMap((line) => {
        const was = Number(line.addedAtPrice) || 0;
        const now = Number(line.price) || 0;
        if (!was || !now || was === now) return [];
        return [{ id: String(line.id), title: String(line.title), was, now }];
      }),
    [lines],
  );

  const needsAddress = cartNeedsAddress(lines);
  const subtotal = cartTotal(lines);
  const totalItemsCount = lines.reduce((sum, l) => sum + (l.quantity || 1), 0);

  // Delivery calculation if physical hardware exists
  const deliveryBase = Number(storeData?.settings?.["deliveryBase"] || 5000);
  const deliveryPrice = needsAddress ? deliveryBase : 0;

  // Coupon state
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [selectedTargetProductId, setSelectedTargetProductId] = useState<string | undefined>(
    undefined,
  );
  const [couponError, setCouponError] = useState("");
  const validateCouponFn = useServerFn(validateCoupon);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);

  const handleApplyCoupon = async (targetId?: string) => {
    const code = couponCode.trim();
    if (!code) return;
    setIsApplyingCoupon(true);
    setCouponError("");
    const target = targetId !== undefined ? targetId : selectedTargetProductId;
    try {
      const res = await validateCouponFn({
        data: {
          code,
          orderAmount: subtotal,
          targetProductId: target,
          items: lines.map(couponItemFromLine),
        },
      });
      if (res.valid && res.coupon) {
        setAppliedCoupon({ ...res.coupon, code });
        if (res.coupon.targetProductId) {
          setSelectedTargetProductId(String(res.coupon.targetProductId));
        }
        playSound("turn_on", 0.5);
        toast.success("تم تطبيق كود الخصم بنجاح!");
      } else {
        setAppliedCoupon(null);
        setCouponError(res.message || "كود الخصم غير صالح أو منتهي الصلاحية");
        playSound("Error", 0.5);
      }
    } catch (e) {
      setCouponError("حدث خطأ أثناء التحقق من كود الخصم");
      playSound("Error", 0.5);
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponCode("");
    setSelectedTargetProductId(undefined);
    setCouponError("");
    toast.info("تم إلغاء كود الخصم");
  };

  // Revalidate coupon when cart contents change
  useEffect(() => {
    if (appliedCoupon && appliedCoupon.code) {
      void (async () => {
        try {
          const res = await validateCouponFn({
            data: {
              code: appliedCoupon.code,
              orderAmount: subtotal,
              targetProductId: selectedTargetProductId,
              items: lines.map(couponItemFromLine),
            },
          });
          if (res.valid && res.coupon) {
            setAppliedCoupon({ ...res.coupon, code: appliedCoupon.code });
            if (res.coupon.targetProductId) {
              setSelectedTargetProductId(String(res.coupon.targetProductId));
            }
          } else {
            setAppliedCoupon(null);
            setCouponError(res.message || "لم يعد الكوبون صالحاً لمحتويات السلة الحالية");
          }
        } catch {
          // ignore background reval failure
        }
      })();
    }
  }, [subtotal, lines.length]);

  /*
    The referral, as the server prices it.

    Held here only so the summary can show the same number the server will
    charge — every figure in it came back from `/api/referral`, and checkout
    recomputes all of it from the catalogue. Nothing the cart holds is sent as
    money.
  */
  const [referral, setReferral] = useState<ReferralCartState | null>(null);
  const couponDiscount = Number(appliedCoupon?.discountAmount ?? 0);
  const referralDiscount = referral?.applicable ? Number(referral.buyerDiscountIqd) : 0;
  /*
    A coupon and a referral do not stack: the buyer gets whichever is worth
    more. The same rule is applied again at checkout, from the same inputs, so
    this preview cannot disagree with the charge.
  */
  const finalDiscount = Math.min(subtotal, Math.max(couponDiscount, referralDiscount));
  const referralWins = referralDiscount > 0 && referralDiscount > couponDiscount;
  const totalPayable = Math.max(0, subtotal - finalDiscount + deliveryPrice);

  const walletBalance = user?.walletBalance || 0;
  const isBalanceSufficient = walletBalance >= totalPayable;
  const missingAmount = Math.max(0, totalPayable - walletBalance);

  // Quantity updates
  const setQuantity = async (
    productId: string | number,
    quantity: number,
    offerKind?: string,
    optionId?: string,
    typeId?: string,
    editionId?: string,
  ) => {
    setLocalQuantity(productId, quantity, offerKind, optionId, typeId, editionId);
    const item = dbItems.find((i: any) => String(i.product_id) === String(productId)) as any;
    if (item && user) {
      try {
        await updateItemFn({ data: { id: item.id, quantity } });
        queryClient.invalidateQueries({ queryKey: ["cart"] });
      } catch (err) {
        console.error("Failed to update cart item:", err);
      }
    }
  };

  // Remove item
  const executeRemove = async (line: CartLine) => {
    removeLocal(line.productId, line.offerKind, line.optionId, line.typeId, line.editionId);
    playSound("turn_off", 0.6);
    toast.success("تم حذف المنتج من السلة");

    const item = dbItems.find((i: any) => String(i.product_id) === String(line.productId)) as any;
    if (item && user) {
      try {
        await removeItemFn({ data: { id: item.id } });
        queryClient.invalidateQueries({ queryKey: ["cart"] });
      } catch (err) {
        console.error("Failed to remove cart item from backend:", err);
      }
    }
    setItemToDelete(null);
  };

  // Checkout Mutation
  const checkout = useMutation({
    mutationFn: async () => {
      return await api.checkout(
        lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          editionId: l.meta?.editionId,
          dlcIds: l.meta?.dlcIds,
          // Without these the server cannot tell an offline account from an
          // online one, and an offline-only coupon has nothing to match on.
          optionId: l.optionId ?? l.meta?.optionId ?? undefined,
          typeId: l.typeId ?? l.meta?.typeId ?? undefined,
        })),
        needsAddress ? { id: "cart", ...address } : undefined,
        appliedCoupon?.code,
        true, // acceptedTerms: explicitly confirmed
        idempotencyKeyRef.current,
        selectedTargetProductId,
        /*
          Sent only as a fallback: the attribution normally travels in a signed
          cookie set when the code was applied. The server re-validates it
          either way and never takes the discount from this request.
        */
        referral?.referralCode ?? undefined,
      );
    },
    onSuccess: ({ order }) => {
      setShowConfirmModal(false);
      clear();
      // Generate new key for subsequent sessions
      idempotencyKeyRef.current = crypto.randomUUID();
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      queryClient.invalidateQueries({ queryKey: ["auth"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      playSound("bumper_end", 0.7);
      toast.success("تم تأكيد الطلب والدفع بنجاح!");
      void navigate({ to: "/chat", search: { initialOrderId: order.id } });
    },
    onError: (err: Error) => {
      setShowConfirmModal(false);
      setError(err.message);
      playSound("Error", 0.6);
      if (err.message === "terms_required") {
        toast.error("يرجى الموافقة على سياسة الشراء قبل إتمام الطلب.");
        setHighlightTerms(true);
      } else if (err.message === "insufficient_balance") {
        toast.error("رصيد المحفظة غير كافٍ لإتمام الدفع.");
        setShowInsufficientModal(true);
      } else if (err.message === "product_not_released") {
        /*
          A game in this cart has not come out yet. It can only have got here
          before the release gate existed, or in a tab left open since then, so
          the message names it and offers to take it out — the customer can
          then register for the launch alert on its page.
        */
        const details = err as Error & { productTitle?: string; releaseDate?: string | null; productId?: string };
        const name = details.productTitle || "إحدى الألعاب";
        const when = details.releaseDate ? ` (تصدر في ${details.releaseDate})` : "";
        toast.error(`${name} لم تصدر بعد${when} — أزلها من السلة وفعّل التنبيه من صفحتها.`, {
          duration: 10000,
          ...(details.productId
            ? {
                action: {
                  label: "إزالة من السلة",
                  onClick: () => removeLocal(String(details.productId)),
                },
              }
            : {}),
        });
      } else {
        toast.error(err.message || "فشلت عملية الدفع، يرجى المحاولة مرة أخرى.");
      }
    },
  });

  const handleInitiatePayment = () => {
    setError(undefined);

    if (!user) {
      toast.info("يرجى تسجيل الدخول أولاً لإتمام الشراء");
      return void navigate({ to: "/auth" });
    }

    // Step 2 Validation: Checkbox approval required
    if (!acceptedTerms) {
      setHighlightTerms(true);
      playSound("Error", 0.6);
      toast.error("يرجى الموافقة على سياسة الشراء قبل إتمام الطلب.");
      setTimeout(() => setHighlightTerms(false), 2000);
      return;
    }

    if (needsAddress && (!address.fullName || !address.phone || !address.city)) {
      setError("الأجهزة تحتاج عنوان توصيل: الاسم، الهاتف، والمدينة مطلوبة.");
      toast.error("يرجى إكمال بيانات عنوان التوصيل للأجهزة");
      playSound("Error", 0.5);
      return;
    }

    if (!isBalanceSufficient) {
      playSound("Error", 0.5);
      setShowInsufficientModal(true);
      return;
    }

    setShowConfirmModal(true);
  };

  const confirmAndPay = () => {
    if (checkout.isPending) return;
    playSound("loading", 0.6);
    checkout.mutate();
  };

  // Render: Empty Cart State
  if (lines.length === 0 && !confirmedOrder) {
    return (
      <AppShell currentView="cart">
        <header className="shrink-0 bg-background px-4 py-4 flex items-center justify-between z-20 border-b border-border/40">
          <button
            id="cart-back-empty-btn"
            onClick={() => void navigate({ to: "/" })}
            className="w-10 h-10 bg-muted flex items-center justify-center rounded-2xl hover:bg-muted/80 text-foreground transition-colors"
            aria-label="العودة"
          >
            <ChevronDown className="w-5 h-5 stroke-[2.5]" />
          </button>
          <h1 className="text-base font-black text-foreground">{tr("سلة المشتريات")}</h1>
          <div className="w-10 h-10"></div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24 text-center">
          <div className="w-24 h-24 rounded-3xl bg-muted/60 border border-border/70 flex items-center justify-center text-muted-foreground mb-6 shadow-sm">
            <Package className="w-12 h-12 stroke-[1.5] text-primary/70" />
          </div>
          <h2 className="text-2xl font-black mb-2 text-foreground">{tr("السلة فارغة")}</h2>
          <p className="text-muted-foreground text-xs sm:text-sm max-w-xs mb-8 leading-relaxed">
            {tr("عندما تضيف منتجات إلى سلتك، ستظهر هنا لتتمكن من مراجعتها وإتمام شرائها فوراً.")}
          </p>
          <button
            id="start-shopping-btn"
            onClick={() => void navigate({ to: "/" })}
            className="bg-primary hover:opacity-90 text-primary-foreground font-black px-8 py-3.5 rounded-2xl shadow-lg active:scale-95 transition-all text-sm flex items-center gap-2"
          >
            <Gamepad2 className="w-4 h-4" />
            <span>{tr("ابدأ التسوق وتصفح الألعاب")}</span>
          </button>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell currentView="cart">
      {/* Top Header */}
      <header className="shrink-0 bg-[var(--card)]/90 backdrop-blur-md sticky top-0 px-4 py-3.5 flex items-center justify-between z-20 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            id="cart-header-back-btn"
            onClick={() => void navigate({ to: "/" })}
            className="w-9 h-9 bg-muted flex items-center justify-center rounded-xl hover:bg-muted/80 text-foreground transition-colors active:scale-95"
            aria-label="العودة"
          >
            <ChevronDown className="w-5 h-5 stroke-[2.5]" />
          </button>
          <h1 className="text-base font-black text-foreground tracking-tight">
            {tr("سلة المشتريات")}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <span
            id="cart-items-count-badge"
            className="text-xs font-bold text-primary bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full"
          >
            {totalItemsCount} {totalItemsCount === 1 ? tr("عنصر") : tr("عناصر")}
          </span>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 pb-48 max-w-2xl mx-auto w-full space-y-4" dir="rtl">
        {/* Products List Section */}
        <section className="bg-[var(--card)] border border-border rounded-3xl overflow-hidden shadow-xs">
          <div className="px-4 py-3 border-b border-border/60 bg-muted/20 flex items-center justify-between">
            <span className="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Gamepad2 className="w-4 h-4 text-primary" />
              <span>{tr("المنتجات في السلة")}</span>
            </span>
            <span className="text-xs text-muted-foreground font-medium">
              {lines.length} {lines.length === 1 ? tr("منتج مختلف") : tr("منتجات")}
            </span>
          </div>

          <div className="divide-y divide-border/40">
            <AnimatePresence mode="popLayout">
              {lines.map((line) => (
                <CartItemCard
                  key={`${line.productId}-${line.offerKind || ""}-${line.optionId || ""}-${line.typeId || ""}`}
                  line={line}
                  onUpdateQuantity={(id, q) =>
                    setQuantity(id, q, line.offerKind, line.optionId, line.typeId, line.editionId)
                  }
                  onRequestDelete={(l) => {
                    playSound("nock", 0.4);
                    setItemToDelete(l);
                  }}
                />
              ))}
            </AnimatePresence>
          </div>
        </section>

        {/* Continue Shopping Link */}
        <div className="flex items-center justify-between px-2">
          <span className="text-xs font-medium text-muted-foreground">
            {tr("هل تبحث عن ألعاب أو بطاقات أخرى؟")}
          </span>
          <button
            id="browse-more-games-btn"
            onClick={() => void navigate({ to: "/" })}
            className="text-xs font-bold text-primary hover:underline flex items-center gap-1 active:scale-95 transition-transform"
          >
            <span>{tr("تصفح المزيد")}</span>
            <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" />
          </button>
        </div>

        {/* Address Form (If physical hardware is in cart) */}
        {needsAddress ? (
          <section className="p-4 bg-[var(--card)] rounded-3xl border border-border space-y-3 shadow-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-amber-500/10 text-amber-600 rounded-xl flex items-center justify-center">
                <MapPin className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-black text-foreground text-xs sm:text-sm">
                  {tr("عنوان التوصيل (للأجهزة والملحقات)")}
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  {tr("مطلوب لتوصيل الطلبات الملموسة إلى باب منزلك")}
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 pt-1">
              {(
                [
                  ["fullName", "الاسم الكامل"],
                  ["phone", "رقم الهاتف للتواصل"],
                  ["city", "المدينة / المحافظة"],
                  ["area", "المنطقة / الحي"],
                  ["street", "الشارع وأقرب نقطة دالة"],
                  ["notes", "ملاحظات إضافية للتوصيل (اختياري)"],
                ] as const
              ).map(([field, label]) => (
                <input
                  key={field}
                  id={`address-input-${field}`}
                  value={String(address[field] ?? "")}
                  onChange={(event) =>
                    setAddress((prev) => ({ ...prev, [field]: event.target.value }))
                  }
                  placeholder={label}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-xs sm:text-sm outline-none focus:ring-2 focus:ring-primary/40 transition-all placeholder:text-muted-foreground"
                />
              ))}
            </div>
          </section>
        ) : (
          <div className="p-3.5 bg-emerald-500/5 rounded-2xl border border-emerald-500/20 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <p className="text-xs font-medium text-foreground/90 leading-relaxed">
              {tr("تسليم فوري لجميع الحسابات الرقمية والأكواد مباشرة في محادثة الطلب بعد الدفع.")}
            </p>
          </div>
        )}

        {/* A price moved while this cart was open — say so before they pay. */}
        {changedPrices.length > 0 && (
          <section className="rounded-3xl border border-amber-400/40 bg-amber-50/70 p-4 dark:border-amber-500/25 dark:bg-amber-500/5">
            <div className="mb-2 flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="text-xs font-black">
                {tr("تغيّر السعر منذ أن أضفت المنتج للسلة")}
              </span>
            </div>
            <ul className="space-y-1.5">
              {changedPrices.map((change) => (
                <li
                  key={change.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-[12px]"
                >
                  <span className="min-w-0 flex-1 truncate font-bold text-foreground">
                    {change.title}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    <span className="line-through">{formatIQDPrice(change.was)}</span>
                    {" → "}
                    <span
                      className={
                        change.now > change.was
                          ? "font-black text-amber-700 dark:text-amber-300"
                          : "font-black text-emerald-700 dark:text-emerald-300"
                      }
                    >
                      {formatIQDPrice(change.now)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {tr("المبلغ أدناه هو السعر الحالي، وهو ما سيُخصم من محفظتك.")}
            </p>
          </section>
        )}

        {/* Coupon Code Section */}
        <section className="bg-[var(--card)] p-4 rounded-3xl border border-border space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Ticket className="w-4 h-4 text-primary" />
              <span>{tr("كوبون الخصم")}</span>
            </span>
            {appliedCoupon && (
              <button
                onClick={handleRemoveCoupon}
                className="text-[11px] font-bold text-destructive hover:underline flex items-center gap-1 active:scale-95 transition-transform"
              >
                <X className="w-3 h-3" />
                <span>{tr("إلغاء الكوبون")}</span>
              </button>
            )}
          </div>

          {!appliedCoupon ? (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Ticket className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  id="coupon-code-input"
                  type="text"
                  value={couponCode}
                  onChange={(e) => {
                    setCouponCode(e.target.value.toUpperCase());
                    setCouponError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleApplyCoupon();
                    }
                  }}
                  placeholder={tr("أدخل كود الخصم (مثال: GAME50)")}
                  className="w-full pr-10 pl-3.5 py-2.5 rounded-xl border border-border bg-background text-xs sm:text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 uppercase font-mono tracking-wider transition-all placeholder:text-muted-foreground placeholder:normal-case placeholder:font-sans"
                />
              </div>
              <button
                id="apply-coupon-btn"
                onClick={() => handleApplyCoupon()}
                disabled={isApplyingCoupon || !couponCode.trim()}
                className="px-4 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl text-xs active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1.5 shrink-0 shadow-xs"
              >
                {isApplyingCoupon && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{tr("تطبيق")}</span>
              </button>
            </div>
          ) : (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="bg-emerald-500 text-white text-[10px] font-black px-2 py-0.5 rounded-md uppercase font-mono">
                    {appliedCoupon.code}
                  </span>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {appliedCoupon.discountType === "single_item_percent"
                      ? `خصم ${appliedCoupon.discountValue}% على لعبة واحدة (1x)`
                      : appliedCoupon.discountType === "percentage"
                        ? `خصم ${appliedCoupon.discountValue}% على الطلب`
                        : `خصم ${formatIQDPrice(appliedCoupon.discountValue)}`}
                  </span>
                </div>
                <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 font-mono">
                  - {formatIQDPrice(finalDiscount)}
                </span>
              </div>

              {/* Single item discount game selector if multiple eligible products exist */}
              {appliedCoupon.discountType === "single_item_percent" && (
                <div className="pt-2 border-t border-emerald-500/20 space-y-1.5">
                  <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                    <span>{tr("اللعبة المستفيدة من الخصم (نسخة 1 فقط):")}</span>
                    {appliedCoupon.singleUnitPrice && (
                      <span className="font-mono text-foreground font-bold">
                        {formatIQDPrice(appliedCoupon.singleUnitPrice)} ÷ 2 = -
                        {formatIQDPrice(finalDiscount)}
                      </span>
                    )}
                  </div>

                  {lines.length > 1 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {lines.map((item) => {
                        const isSelected =
                          String(item.productId) ===
                          String(selectedTargetProductId || appliedCoupon.targetProductId);
                        return (
                          <button
                            key={item.productId}
                            type="button"
                            onClick={() => {
                              setSelectedTargetProductId(String(item.productId));
                              handleApplyCoupon(String(item.productId));
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 border ${
                              isSelected
                                ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                                : "bg-background/80 hover:bg-background border-border text-foreground"
                            }`}
                          >
                            <Gamepad2 className="w-3 h-3" />
                            <span className="truncate max-w-[140px]">{item.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {couponError && (
            <p className="text-xs text-destructive font-medium px-1 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{couponError}</span>
            </p>
          )}
        </section>

        {/*
          Referral — دعوة صديق.

          Directly under the coupon box and outside it, with no card of its
          own: it is a text button, or one small line saying who the member is
          with, and it must read as the quieter of the two. It renders nothing
          at all once the discount has been spent and there is nobody to name.
        */}
        <ReferralCartField lines={lines} onChange={setReferral} />

        {/* Requirement 3: Detailed Order Breakdown / Summary */}
        <section className="bg-[var(--card)] p-4 rounded-3xl border border-border shadow-xs space-y-3">
          <h4 className="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-border/60">
            <Package className="w-4 h-4 text-primary" />
            <span>{tr("تفاصيل وملخص السلة")}</span>
          </h4>

          <div className="space-y-2 text-xs sm:text-sm">
            {/* Total items count */}
            <div className="flex justify-between items-center text-muted-foreground">
              <span>{tr("عدد العناصر الإجمالي")}:</span>
              <span className="font-bold text-foreground">
                {totalItemsCount} {totalItemsCount === 1 ? tr("عنصر") : tr("عناصر")}
              </span>
            </div>

            {/* Subtotal */}
            <div className="flex justify-between items-center text-muted-foreground">
              <span>{tr("المجموع الفرعي")}:</span>
              <span className="font-bold text-foreground">{formatIQDPrice(subtotal)}</span>
            </div>

            {/* Discount if present — named, so the member can see which one won */}
            {finalDiscount > 0 && (
              <div className="flex justify-between items-center text-emerald-600 dark:text-emerald-400 font-bold">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{referralWins ? tr("خصم الإحالة") : tr("الخصم المطبق")}:</span>
                </span>
                <span>- {formatIQDPrice(finalDiscount)}</span>
              </div>
            )}
            {referralWins && couponDiscount > 0 && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {tr("تم اختيار خصم الإحالة لأنه أفضل لك — لا يُجمع مع الكوبون.")}
              </p>
            )}

            {/* Delivery Fee if present */}
            {needsAddress && (
              <div className="flex justify-between items-center text-muted-foreground">
                <span>{tr("رسوم التوصيل")}:</span>
                <span className="font-bold text-foreground">{formatIQDPrice(deliveryPrice)}</span>
              </div>
            )}

            <div className="pt-2 border-t border-border/60 flex justify-between items-center">
              <span className="font-bold text-foreground">{tr("رصيد محفظتك الحالي")}:</span>
              <span
                className={`font-black ${
                  isBalanceSufficient
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400"
                }`}
              >
                {formatIQDPrice(walletBalance)}
              </span>
            </div>

            {/* Amount to be deducted */}
            <div className="pt-1 flex justify-between items-center">
              <span className="font-black text-foreground text-sm">
                {tr("المبلغ المطلوب دفعه من المحفظة")}:
              </span>
              <span className="font-black text-primary text-base">
                {formatIQDPrice(totalPayable)}
              </span>
            </div>
          </div>

          {/* Insufficient Balance Notice */}
          {!isBalanceSufficient && (
            <div className="mt-3 p-3.5 bg-rose-500/10 border border-rose-500/25 rounded-2xl text-right space-y-2">
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 text-xs font-black">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{tr("الرصيد غير كافٍ لإتمام الدفع")}</span>
              </div>
              <div className="text-xs text-muted-foreground flex justify-between items-center">
                <span>{tr("المبلغ الناقص")}:</span>
                <span className="font-black text-rose-600 dark:text-rose-400">
                  {formatIQDPrice(missingAmount)}
                </span>
              </div>
              <button
                id="cart-insufficient-recharge-btn"
                onClick={() => void navigate({ to: "/wallet" })}
                className="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors shadow-xs"
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>{tr("شحن المحفظة الآن")}</span>
              </button>
            </div>
          )}
        </section>

        {/* Requirement 2: Purchase Policy Checkbox Agreement */}
        <section
          id="terms-agreement-section"
          className={`p-4 rounded-3xl border transition-all duration-300 ${
            highlightTerms
              ? "bg-destructive/10 border-destructive shadow-md ring-2 ring-destructive/40 animate-pulse"
              : acceptedTerms
                ? "bg-primary/5 border-primary/30 shadow-xs"
                : "bg-[var(--card)] border-border shadow-xs"
          }`}
        >
          <div className="flex items-start gap-3 select-none">
            <button
              id="policy-checkbox"
              type="button"
              onClick={() => {
                const next = !acceptedTerms;
                setAcceptedTerms(next);
                playSound(next ? "turn_on" : "turn_off", 0.5);
                if (highlightTerms) setHighlightTerms(false);
              }}
              className="mt-0.5 shrink-0 text-primary focus:outline-none"
              aria-label="الموافقة على سياسة الشراء"
            >
              {acceptedTerms ? (
                <CheckSquare className="w-5 h-5 text-primary" />
              ) : (
                <Square
                  className={`w-5 h-5 ${highlightTerms ? "text-destructive" : "text-muted-foreground"}`}
                />
              )}
            </button>

            <div className="text-xs leading-relaxed text-foreground">
              <span>{tr("أوافق على ")}</span>
              <a
                id="view-policy-link"
                href="/policy"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  // If on mobile or preview, let user open in new tab or sheet to preserve cart
                  playSound("hover", 0.4);
                }}
                className="font-bold text-primary underline underline-offset-4 hover:opacity-80 inline-flex items-center gap-0.5"
              >
                <span>{tr("سياسة الشراء والشروط والأحكام")}</span>
                <ExternalLink className="w-3 h-3 inline" />
              </a>
              <span className="text-muted-foreground text-[11px] block mt-1">
                {tr(
                  "بالنقر على إتمام الدفع، يتم خصم قيمة الطلب فوراً من محفظتك وبدء تجهيز الحسابات عبر الدعم.",
                )}
              </span>
              {/*
                The two clauses that decide whether somebody keeps their game,
                named here rather than left nine screens inside the policy.

                A tick box next to a link to a long document is consent in
                form only. These are the rules a customer breaks by accident —
                deleting the account user, expecting a refund after the
                credentials are sent — and the moment to read them is before
                paying, not after.
              */}
              <span className="text-muted-foreground text-[11px] block mt-1">
                {tr("أهم بندين: ")}
                <a
                  href="/policy#no-delete"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-foreground underline underline-offset-4"
                >
                  {tr("لا تحذف مستخدم حساب اللعبة")}
                </a>
                <span>{tr(" · ")}</span>
                <a
                  href="/policy#no-refund"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-foreground underline underline-offset-4"
                >
                  {tr("لا استرجاع بعد تسليم الحساب")}
                </a>
              </span>
            </div>
          </div>
        </section>

        {/* Global Error Banner if any */}
        {error && (
          <div className="p-3.5 bg-destructive/10 rounded-2xl border border-destructive/20 text-destructive text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </main>

      {/* Fixed Checkout Bar */}
      <footer
        className="fixed bottom-[58px] sm:bottom-[60px] left-0 right-0 bg-[var(--card)]/95 backdrop-blur-md border-t border-border px-4 py-3 sm:py-3.5 space-y-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-40"
        dir="rtl"
      >
        <div className="flex items-center justify-between max-w-2xl mx-auto w-full">
          <div className="flex flex-col text-right">
            <div className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider mb-0.5">
              {tr("إجمالي الطلب المطلوب")}
            </div>
            <div className="text-foreground font-black text-lg sm:text-xl tracking-tight">
              {formatIQDPrice(totalPayable)}
            </div>
          </div>

          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
                {tr("رصيد المحفظة")}
              </span>
            </div>
            <div
              className={`font-black text-sm sm:text-base tracking-tight ${
                isBalanceSufficient
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {formatIQDPrice(walletBalance)}
            </div>
          </div>
        </div>

        {/* Payment Action Button */}
        <div className="max-w-2xl mx-auto w-full">
          {isBalanceSufficient ? (
            <button
              id="checkout-pay-btn"
              onClick={handleInitiatePayment}
              disabled={checkout.isPending}
              className={`w-full bg-primary hover:opacity-95 text-primary-foreground font-black py-3.5 px-5 rounded-2xl flex items-center justify-center gap-2 shadow-md active:scale-[0.99] transition-all disabled:opacity-60 ${
                !acceptedTerms ? "opacity-90" : ""
              }`}
            >
              {checkout.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="text-sm sm:text-base">{tr("جاري الدفع وتجهيز الطلب...")}</span>
                </>
              ) : (
                <>
                  <Wallet className="w-4 h-4" />
                  <span className="text-sm sm:text-base">{tr("إتمام الدفع عبر المحفظة")}</span>
                </>
              )}
            </button>
          ) : (
            <button
              id="checkout-recharge-insufficient-btn"
              onClick={() => void navigate({ to: "/wallet" })}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white font-black py-3 px-3 sm:py-3.5 sm:px-5 rounded-2xl flex items-center justify-center gap-1.5 sm:gap-2 shadow-md active:scale-[0.99] transition-all text-xs sm:text-sm"
            >
              <Wallet className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {tr("الرصيد غير كافٍ — شحن المحفظة (ناقص ")}
                {formatIQDPrice(missingAmount)})
              </span>
            </button>
          )}
        </div>
      </footer>

      {/* Requirement 1: Confirmation Modal when quantity is 1 and user clicks - or delete */}
      <AnimatePresence>
        {itemToDelete && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                playSound("nock", 0.4);
                setItemToDelete(null);
              }}
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-sm bg-[var(--card)] rounded-3xl p-5 sm:p-6 shadow-2xl z-10 text-center border border-border"
              dir="rtl"
            >
              <div className="w-12 h-12 bg-destructive/10 rounded-2xl flex items-center justify-center text-destructive mx-auto mb-3.5 border border-destructive/20 shadow-xs">
                <Trash2 className="w-6 h-6 stroke-[2]" />
              </div>

              <h3 className="text-lg font-black text-foreground mb-1">
                {tr("حذف المنتج من السلة؟")}
              </h3>
              <p className="text-muted-foreground text-xs sm:text-sm mb-4 leading-relaxed">
                {tr("هل تريد إزالة هذا المنتج من سلة المشتريات؟")}
              </p>

              {/* Item Preview Card */}
              <div className="bg-muted/40 rounded-2xl p-3 mb-5 flex items-center gap-3 text-right border border-border/60">
                {itemToDelete.image || itemToDelete.source ? (
                  <NintendoCover
                    product={
                      (itemToDelete.source as Record<string, unknown>) ?? {
                        image: itemToDelete.image,
                      }
                    }
                    usage="cart"
                    ratio={1}
                    className="w-12 h-12 rounded-xl border border-border shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
                    <Gamepad2 className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-foreground truncate" dir="ltr">
                    {itemToDelete.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-semibold">
                    {formatIQDPrice(itemToDelete.price)}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  id="confirm-delete-item-btn"
                  onClick={() => executeRemove(itemToDelete)}
                  className="w-full py-3 bg-destructive hover:bg-destructive/90 text-destructive-foreground font-black rounded-2xl shadow-xs active:scale-[0.98] transition-all text-xs sm:text-sm flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{tr("حذف المنتج")}</span>
                </button>
                <button
                  id="cancel-delete-item-btn"
                  onClick={() => {
                    playSound("nock", 0.4);
                    setItemToDelete(null);
                  }}
                  className="w-full py-2.5 bg-muted hover:bg-muted/80 text-foreground font-bold rounded-2xl transition-colors text-xs sm:text-sm"
                >
                  {tr("إلغاء")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Confirm Payment & Deduct Balance */}
      <AnimatePresence>
        {showConfirmModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !checkout.isPending && setShowConfirmModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[var(--card)] rounded-3xl p-6 shadow-2xl z-10 text-center border border-border"
              dir="rtl"
            >
              <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 mx-auto mb-3.5 border border-emerald-500/20 shadow-xs">
                <ShieldCheck className="w-6 h-6 stroke-[2.5]" />
              </div>

              <h3 className="text-lg font-black text-foreground mb-1">
                {tr("تأكيد الدفع عبر المحفظة")}
              </h3>
              <p className="text-muted-foreground text-xs sm:text-sm mb-5">
                {tr("هل ترغب بتأكيد الطلب واستقطاع المبلغ فوراً من محفظتك؟")}
              </p>

              <div className="bg-muted/50 rounded-2xl p-3.5 mb-5 text-xs sm:text-sm space-y-2 border border-border/60 text-right">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">{tr("عدد العناصر")}:</span>
                  <span className="text-foreground font-bold">
                    {totalItemsCount} {tr("عنصر")}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">{tr("إجمالي المبلغ")}:</span>
                  <span className="text-foreground font-black">{formatIQDPrice(totalPayable)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">{tr("رصيدك الحالي")}:</span>
                  <span className="text-muted-foreground font-bold">
                    {formatIQDPrice(walletBalance)}
                  </span>
                </div>
                <div className="pt-2 border-t border-border flex justify-between items-center">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                    {tr("الرصيد المتبقي بعد الدفع")}:
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-black">
                    {formatIQDPrice(Math.max(0, walletBalance - totalPayable))}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  id="modal-confirm-pay-btn"
                  onClick={confirmAndPay}
                  disabled={checkout.isPending}
                  className="w-full py-3 bg-primary hover:opacity-90 text-primary-foreground font-black rounded-2xl shadow-xs active:scale-[0.98] transition-all text-xs sm:text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {checkout.isPending ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>{tr("جاري تأكيد واستقطاع المبلغ...")}</span>
                    </>
                  ) : (
                    <span>{tr("تأكيد واستقطاع المبلغ")}</span>
                  )}
                </button>
                <button
                  id="modal-cancel-pay-btn"
                  onClick={() => {
                    playSound("nock", 0.4);
                    setShowConfirmModal(false);
                  }}
                  disabled={checkout.isPending}
                  className="w-full py-2.5 bg-muted hover:bg-muted/80 text-foreground font-bold rounded-2xl transition-colors text-xs sm:text-sm disabled:opacity-50"
                >
                  {tr("تراجع")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Insufficient Balance Alert */}
      <AnimatePresence>
        {showInsufficientModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowInsufficientModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[var(--card)] rounded-3xl p-6 shadow-2xl z-10 text-center border border-border"
              dir="rtl"
            >
              <div className="w-12 h-12 bg-rose-500/10 rounded-2xl flex items-center justify-center text-rose-600 dark:text-rose-400 mx-auto mb-3.5 border border-rose-500/20 shadow-xs">
                <AlertCircle className="w-6 h-6 stroke-[2.5]" />
              </div>

              <h3 className="text-lg font-black text-foreground mb-1.5">
                {tr("رصيد المحفظة غير كافٍ")}
              </h3>
              <p className="text-muted-foreground text-xs sm:text-sm mb-5 leading-relaxed">
                {tr("رصيدك الحالي لا يغطي قيمة هذا الطلب. يمكنك شحن محفظتك لإتمام الشراء فوراً.")}
              </p>

              <div className="bg-muted/50 rounded-2xl p-3.5 mb-5 text-xs sm:text-sm space-y-2 border border-border/60 text-right">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">{tr("إجمالي الطلب")}:</span>
                  <span className="text-foreground font-black">{formatIQDPrice(totalPayable)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground font-medium">{tr("رصيدك الحالي")}:</span>
                  <span className="text-rose-600 dark:text-rose-400 font-bold">
                    {formatIQDPrice(walletBalance)}
                  </span>
                </div>
                <div className="pt-2 border-t border-border flex justify-between items-center">
                  <span className="text-foreground font-bold">{tr("المبلغ المطلوب شحنه")}:</span>
                  <span className="text-primary font-black">{formatIQDPrice(missingAmount)}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  id="modal-goto-wallet-btn"
                  onClick={() => {
                    setShowInsufficientModal(false);
                    void navigate({ to: "/wallet" });
                  }}
                  className="w-full py-3 bg-primary hover:opacity-90 text-primary-foreground font-black rounded-2xl shadow-xs active:scale-[0.98] transition-all text-xs sm:text-sm flex items-center justify-center gap-2"
                >
                  <Wallet className="w-4 h-4" />
                  <span>{tr("شحن المحفظة الآن")}</span>
                </button>
                <button
                  id="modal-cancel-insufficient-btn"
                  onClick={() => setShowInsufficientModal(false)}
                  className="w-full py-2.5 bg-muted hover:bg-muted/80 text-foreground font-bold rounded-2xl transition-colors text-xs sm:text-sm"
                >
                  {tr("إلغاء والعودة للسلة")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
