import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface CartLine {
  id: string;
  productId: string | number;
  kind?: string;
  title: string;
  price: number;
  quantity: number;
  image?: string;
  optionId?: string;
  typeId?: string;
  source?: Record<string, unknown>;
  meta?: Record<string, any>;
  [key: string]: any;
}

export function cartCount(lines: CartLine[] = []): number {
  return lines.reduce((acc, item) => acc + (Number(item.quantity) || 1), 0);
}

export function cartTotal(lines: CartLine[] = []): number {
  return lines.reduce(
    (acc, item) => acc + (Number(item.price) || 0) * (Number(item.quantity) || 1),
    0
  );
}

export function cartNeedsAddress(lines: CartLine[] = []): boolean {
  return lines.some((l) => {
    const k = String(l.kind || "").toLowerCase();
    if (k === "hardware" || k === "accessory" || k === "used") return true;
    if (l.source && typeof l.source === "object") {
      const src = l.source as Record<string, any>;
      if (src.requiresShipping || src.isPhysical) return true;
    }
    return false;
  });
}

/**
 * Which line a caller means.
 *
 * The same game can sit in the cart more than once — an offline account and an
 * online one, a standard edition and a deluxe. Each is its own line with its
 * own composite id, and the cart page has always passed these alongside the
 * product id to say *which* of them to change. The store ignored them and
 * matched on `productId`, so changing the quantity of one variant changed
 * every variant of that game, and removing one removed all of them.
 */
export interface CartLineSelector {
  offerKind?: string | undefined;
  optionId?: string | undefined;
  typeId?: string | undefined;
  editionId?: string | undefined;
}

/** Does this line match what the caller asked for? */
function matchesLine(
  line: CartLine,
  idOrProductId: string | number,
  selector: CartLineSelector,
): boolean {
  if (line.id === String(idOrProductId)) return true;
  if (line.productId !== idOrProductId) return false;
  // A product id plus variant fields names one line; a product id alone still
  // means "this product", which is what a single-variant cart needs.
  return (
    (selector.offerKind === undefined || line.offerKind === selector.offerKind) &&
    (selector.optionId === undefined || line.optionId === selector.optionId) &&
    (selector.typeId === undefined || line.typeId === selector.typeId) &&
    (selector.editionId === undefined || line.editionId === selector.editionId)
  );
}

interface CartState {
  lines: CartLine[];
  /**
   * Add a line, or increase the one that is already there.
   *
   * `quantity` is a second argument because that is how every caller has
   * always written it — the product page, the hardware page and the game
   * hub's buy sheet all pass the number from their picker there. The store
   * only ever read `item.quantity`, so a customer who chose three copies got
   * one.
   */
  add: (
    item: Partial<CartLine> & { productId: string | number; title?: string; price?: number },
    quantity?: number,
  ) => void;
  remove: (
    idOrProductId: string | number,
    offerKind?: string,
    optionId?: string,
    typeId?: string,
    editionId?: string,
  ) => void;
  setQuantity: (
    idOrProductId: string | number,
    quantity: number,
    offerKind?: string,
    optionId?: string,
    typeId?: string,
    editionId?: string,
  ) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      add: (item, quantity) =>
        set((state) => {
          const wanted = Math.max(1, Math.floor(Number(quantity ?? item.quantity ?? 1)) || 1);
          const id = item.id || `${item.productId}_${item.optionId || item.kind || "default"}`;
          const existingIndex = state.lines.findIndex(
            (line) => line.id === id || (line.productId === item.productId && line.optionId === item.optionId)
          );

          if (existingIndex > -1) {
            const updated = [...state.lines];
            const existing = updated[existingIndex]!;
            updated[existingIndex] = {
              ...existing,
              ...item,
              quantity: (existing.quantity || 1) + wanted,
            };
            return { lines: updated };
          }

          /*
            The spread comes first so the normalisation below wins. It used to
            come last, which meant `title: item.title || "منتج"` and
            `price: Number(item.price) || 0` were immediately overwritten by
            the raw values they exist to correct — a line could carry an
            undefined title or a price that was still a string.
          */
          const newLine: CartLine = {
            ...item,
            id,
            productId: item.productId,
            title: item.title || "منتج",
            price: Number(item.price) || 0,
            quantity: wanted,
            kind: item.kind || "account",
            image: item.image,
            optionId: item.optionId,
            typeId: item.typeId,
            source: item.source,
            meta: item.meta,
          };

          return { lines: [...state.lines, newLine] };
        }),
      remove: (idOrProductId, offerKind, optionId, typeId, editionId) =>
        set((state) => {
          const selector = { offerKind, optionId, typeId, editionId };
          return {
            lines: state.lines.filter((line) => !matchesLine(line, idOrProductId, selector)),
          };
        }),
      setQuantity: (idOrProductId, quantity, offerKind, optionId, typeId, editionId) =>
        set((state) => {
          const selector = { offerKind, optionId, typeId, editionId };
          if (quantity <= 0) {
            return {
              lines: state.lines.filter((line) => !matchesLine(line, idOrProductId, selector)),
            };
          }
          return {
            lines: state.lines.map((line) =>
              matchesLine(line, idOrProductId, selector) ? { ...line, quantity } : line,
            ),
          };
        }),
      clear: () => set({ lines: [] }),
    }),
    {
      name: "cart-storage",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? localStorage : (undefined as any))),
    }
  )
);
