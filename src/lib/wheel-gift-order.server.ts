import { findUserById, getStore, randomId, saveOrder, saveThread } from "./db.server";
import type { Order, OrderItem, ProductKind, Thread } from "./types";

/**
 * A wheel prize becomes a real order, at nothing, marked as a gift.
 *
 * The owner's instruction: «عند فوز المستخدم بلعبة معينة يتم عمل طلب لا
 * مباشرة، وتكون على الإدمن ربح صفر دينار وبالسالب، ويكون على المستخدم سعرها
 * صفر دينار ويعلم عليها انها الهديه».
 *
 * Three things follow from that, and they are the whole design.
 *
 * THE MEMBER PAYS NOTHING. `unitPrice` and `total` are zero, and the payment
 * is already settled — there is nothing to pay, so an order sitting in
 * «بانتظار الدفع» would be asking for money the shop is not owed.
 *
 * THE SHOP'S PROFIT IS NEGATIVE, AND SAYS SO. `unitCost` carries the real
 * supplier cost, resolved exactly as checkout resolves it. A gift is not free
 * to the shop — it costs whatever the account costs — and an order recording
 * zero cost against zero revenue would show a profit of zero, which is a
 * prettier number than the truth. The wheel's real cost is what the owner
 * needs in order to decide what the wheel's odds should be.
 *
 * IT IS MARKED. `isGift`, and the source, so every screen that shows an order
 * can say «هدية» rather than leaving a member and an admin to wonder why a
 * game was sold for nothing.
 *
 * It is otherwise an ordinary order: it enters the prep queue, gets its
 * delivery slots, and is handed over like any other. A prize that arrives as
 * a coupon the member has to go and spend is a prize with a step in it.
 */

/** The marker every surface reads to know a gift from a sale. */
export const WHEEL_GIFT_SOURCE = "wheel_prize";

export interface WheelGiftOrderInput {
  userId: string;
  productId: string;
  /** The title the wheel showed, as a fallback if the catalogue read fails. */
  title: string;
  /** What the wheel said it was worth, for the record. */
  price: number;
  spinId: string;
  now?: string;
}

export interface WheelGiftOrder {
  orderId: string;
  code: string;
  threadId: string;
}

/**
 * The supplier cost of the product this prize is for.
 *
 * Read from the store on the SERVER, the same way `validateLine` reads it at
 * checkout, and never from anything a browser sent. A gift whose cost came
 * from the client would be a gift whose reported loss could be typed.
 */
function costOf(product: Record<string, unknown> | undefined): number {
  if (!product) return 0;
  const raw = product["cost"];
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : 0;
  const parsed = Number.parseFloat(String(raw ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function createWheelGiftOrder(
  input: WheelGiftOrderInput,
): Promise<WheelGiftOrder | null> {
  const userId = String(input.userId ?? "");
  const productId = String(input.productId ?? "");
  if (!userId || !productId) return null;

  const now = input.now ?? new Date().toISOString();

  const store = await getStore();
  const product = (store.products ?? []).find(
    (candidate: Record<string, unknown>) => String(candidate["id"]) === productId,
  ) as Record<string, unknown> | undefined;

  const user = await findUserById(userId).catch(() => undefined);

  const orderId = randomId("ord");
  const threadId = randomId("thr");
  /*
    `BN-G-` rather than `BN-`. An admin scanning the queue can see what this
    is before they open it, and a gift and a sale of the same game on the same
    evening are no longer two identical-looking rows.
  */
  const code = `BN-G-${orderId.slice(-6).toUpperCase()}`;

  const title = String(product?.["title"] ?? input.title ?? "").trim() || input.title;
  const kind = (String(product?.["kind"] ?? "game") || "game") as ProductKind;

  const item: OrderItem = {
    id: randomId("itm"),
    productId,
    title,
    ...(product?.["image"] ? { image: String(product["image"]) } : {}),
    kind,
    quantity: 1,
    // Zero to the member. This is the number they see, and it is the truth.
    unitPrice: 0,
    /*
      And the real cost to the shop. See the note at the top: a gift recording
      no cost would report a profit of zero on a game that cost money.
    */
    unitCost: costOf(product),
    meta: {
      editionId: null,
      dlcIds: null,
      optionId: null,
      optionName: null,
      typeId: null,
      typeName: null,
      /** What the wheel said this was worth, kept for the record. */
      giftValue: Math.max(0, Number(input.price) || 0),
      wheelSpinId: input.spinId,
    },
  } as OrderItem;

  const thread: Thread = {
    id: threadId,
    userId,
    userName: String(user?.name ?? "") || "عميل",
    orderId,
    chatType: "ORDER_SUPPORT",
    subject: `هدية عجلة الحظ — ${title}`,
    status: "open",
    mode: "ORDER_PREPARATION",
    needsAdmin: true,
    queueStatus: "queued",
    lastMessageAt: now,
    createdAt: now,
  };

  const order: Order = {
    id: orderId,
    code,
    userId,
    userName: String(user?.name ?? "") || "عميل",
    items: [item],
    total: 0,
    currency: "IQD",
    status: "processing",
    /*
      Settled, because there is nothing to settle. An order at zero left
      «بانتظار الدفع» would ask a member for money the shop is not owed, and
      would sit outside every queue that only moves paid orders.
    */
    paymentStatus: "paid",
    needsAddress: false,
    threadId,
    isGift: true,
    source: WHEEL_GIFT_SOURCE,
    createdAt: now,
    updatedAt: now,
    events: [
      {
        type: "wheel_prize_awarded",
        at: now,
        payload: { spinId: input.spinId, productId, giftValue: Number(input.price) || 0 },
      },
    ],
  };

  await saveThread(thread);
  await saveOrder(order);

  /*
    The delivery slots, so the prep tool has something to work with. Best
    effort and logged: the order exists either way, and the admin API
    re-creates these idempotently — an order the member can see with no slots
    yet is recoverable, an exception thrown here would lose the prize.
  */
  try {
    const { ensureOrderDeliveryRecords } = await import("./order-delivery-items.server");
    await ensureOrderDeliveryRecords(order);
  } catch (error) {
    console.error("[wheel:gift_delivery_records_failed]", {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { orderId, code, threadId };
}
