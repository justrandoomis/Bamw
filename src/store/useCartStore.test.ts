/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useCartStore, type CartLine } from "./useCartStore";

/**
 * The same game can sit in the cart twice — an offline account and an online
 * one. Each is its own line, and the cart page has always passed the variant
 * alongside the product id to say which one it meant. The store ignored that
 * and matched on the product id alone, so removing one removed both and
 * changing one quantity changed both.
 */

const addBoth = () => {
  const { add } = useCartStore.getState();
  add({
    productId: "prd_1",
    title: "Super Mario Odyssey",
    price: 25000,
    kind: "offline_account",
    optionId: "opt_offline",
    offerKind: "offline",
  });
  add({
    productId: "prd_1",
    title: "Super Mario Odyssey",
    price: 30000,
    kind: "online_account",
    optionId: "opt_online",
    offerKind: "online",
  });
};

const lines = (): CartLine[] => useCartStore.getState().lines;

beforeEach(() => {
  useCartStore.setState({ lines: [] });
});

describe("two variants of one product are two lines", () => {
  it("keeps them apart when added", () => {
    addBoth();
    expect(lines()).toHaveLength(2);
    expect(new Set(lines().map((l) => l.id)).size).toBe(2);
  });

  it("removes only the variant named", () => {
    addBoth();
    useCartStore.getState().remove("prd_1", "offline", "opt_offline");

    expect(lines()).toHaveLength(1);
    expect(lines()[0]!.optionId).toBe("opt_online");
  });

  it("changes the quantity of only the variant named", () => {
    addBoth();
    useCartStore.getState().setQuantity("prd_1", 5, "online", "opt_online");

    const offline = lines().find((l) => l.optionId === "opt_offline")!;
    const online = lines().find((l) => l.optionId === "opt_online")!;
    expect(online.quantity).toBe(5);
    expect(offline.quantity).toBe(1);
  });

  it("drops only the named variant when its quantity reaches zero", () => {
    addBoth();
    useCartStore.getState().setQuantity("prd_1", 0, "offline", "opt_offline");

    expect(lines()).toHaveLength(1);
    expect(lines()[0]!.optionId).toBe("opt_online");
  });

  it("still treats a bare product id as 'this product', for a single-variant cart", () => {
    useCartStore.getState().add({ productId: "prd_2", title: "Kirby", price: 20000 });
    useCartStore.getState().remove("prd_2");
    expect(lines()).toEqual([]);
  });

  it("removes by line id as well", () => {
    addBoth();
    const target = lines()[0]!;
    useCartStore.getState().remove(target.id);
    expect(lines().map((l) => l.id)).not.toContain(target.id);
  });
});

describe("the quantity the customer picked", () => {
  it("is the quantity that lands in the cart", () => {
    // Every buy surface passes it as the second argument; the store only read
    // `item.quantity`, so choosing three copies added one.
    useCartStore.getState().add({ productId: "prd_5", title: "Metroid", price: 30000 }, 3);
    expect(lines()[0]!.quantity).toBe(3);
  });

  it("adds to what is already there when the same line is added again", () => {
    useCartStore.getState().add({ productId: "prd_5", title: "Metroid", price: 30000 }, 3);
    useCartStore.getState().add({ productId: "prd_5", title: "Metroid", price: 30000 }, 2);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]!.quantity).toBe(5);
  });

  it("falls back to one, and never to zero or a fraction", () => {
    useCartStore.getState().add({ productId: "prd_6", title: "Kirby", price: 20000 });
    expect(lines()[0]!.quantity).toBe(1);

    useCartStore.setState({ lines: [] });
    useCartStore.getState().add({ productId: "prd_6", title: "Kirby", price: 20000 }, 0);
    expect(lines()[0]!.quantity).toBe(1);
  });
});

describe("a line is normalised, not overwritten by what was passed", () => {
  it("fills a missing title and coerces a string price", () => {
    // The spread used to come last and undo both of these.
    useCartStore.getState().add({ productId: "prd_3", price: "45000" as never });
    const line = lines()[0]!;
    expect(line.title).toBe("منتج");
    expect(line.price).toBe(45000);
    expect(typeof line.price).toBe("number");
  });

  it("still carries the extra fields the caller set", () => {
    useCartStore
      .getState()
      .add({ productId: "prd_4", title: "Zelda", price: 30000, offerLabel: "رقمي" });
    expect(lines()[0]!.offerLabel).toBe("رقمي");
  });
});
