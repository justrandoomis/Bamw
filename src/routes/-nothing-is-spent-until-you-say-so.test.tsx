/**
 * @vitest-environment jsdom
 *
 * Buying tickets shows what it will cost, and spends nothing until asked.
 *
 * ## Why this file moved, rather than being deleted
 *
 * It used to render the wheel page. The «اشترِ تذكرة» button sat one
 * thumb-width under «دوّر العجلة», spent the member's bananas on a single tap,
 * and the balance was nowhere on the screen — so deciding whether you could
 * afford it meant leaving the wheel to go and look, and mis-tapping cost you
 * the bananas. The protection these tests held was a confirmation dialog.
 *
 * The owner has since moved ticket buying off that screen entirely:
 *
 *   «شراء التذاكر يتم من داخل سوق الموز… يمكن اختيار كمية شراء التذاكر»
 *   «شراء تذاكر: Modal/Bottom Sheet أو inline selector»
 *
 * So the dialog is gone and the thing it protected against is gone with it:
 * the purchase is no longer a lone button under the spin button, the balance
 * and the price are both on screen before anything can be pressed, and the
 * member types or steps to a quantity before there is anything to press at
 * all. An inline selector is one of the two shapes the owner named.
 *
 * What has NOT changed is what these tests are actually for, so every one of
 * them is still here, asserted against the component the behaviour moved into:
 * the balance is visible first, a press sends exactly one purchase, a quantity
 * the balance cannot cover sends nothing, and the arithmetic is shown rather
 * than promised. Only the test that pressed «تأكيد الشراء» is gone, because
 * that button is not what the member presses any more.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TicketShop } from "@/components/market/TicketShop";

afterEach(cleanup);

/** Every purchase the component asked for, in order. */
type Purchase = { quantity: number; requestId: string };

function show(
  props: Partial<React.ComponentProps<typeof TicketShop>> = {},
  onBuyImpl?: (quantity: number, requestId: string) => Promise<never> | Promise<unknown>,
) {
  const purchases: Purchase[] = [];
  const onBuy = vi.fn(async (quantity: number, requestId: string) => {
    purchases.push({ quantity, requestId });
    if (onBuyImpl) return (await onBuyImpl(quantity, requestId)) as never;
    return { ok: true as const, tickets: 7 };
  });
  const view = render(
    <TicketShop
      tickets={0}
      bananas={1250}
      ticketPriceBananas={1000}
      onBuy={onBuy}
      {...props}
    />,
  );
  return { view, purchases, onBuy };
}

const buyButton = () => screen.getByRole("button", { name: /اشترِ التذاكر/ }) as HTMLButtonElement;

/**
 * The whole shop, read as text.
 *
 * A bare `getByText("4")` is ambiguous here and deliberately not used: the
 * quantity field, the stepper and the balance chip can all hold the same
 * digits, and a test that matches whichever one comes first is a test that
 * passes for the wrong reason. The section has an accessible name, so it can
 * be addressed as a whole.
 */
const shopText = () => screen.getByRole("region", { name: /تذاكر/ }).textContent ?? "";

describe("the shop says what you have before it asks for it", () => {
  it("shows the ticket balance the server reported", () => {
    show({ tickets: 4 });
    expect(shopText()).toContain("4");
    expect(shopText()).toContain("تذكرة");
  });

  it("shows a zero balance rather than hiding it", () => {
    show({ tickets: 0, ticketPriceBananas: 0 });
    // With no price there is no quantity field to confuse the reading.
    expect(shopText()).toContain("0");
  });

  it("states the price and the banana balance side by side", () => {
    show({ bananas: 1250, ticketPriceBananas: 1000 });
    const text = shopText();
    expect(text).toContain("1,000");
    expect(text).toContain("1,250");
  });
});

describe("nothing is deducted until the member says so", () => {
  it("sends no purchase merely for choosing a quantity", () => {
    const { purchases } = show();
    fireEvent.click(screen.getByRole("button", { name: /زيادة|إضافة|\+/ }));
    expect(purchases).toEqual([]);
  });

  it("buys exactly the chosen quantity, once, when pressed", async () => {
    const { purchases } = show();
    fireEvent.click(buyButton());
    await waitFor(() => expect(purchases.length).toBe(1));
    expect(purchases[0]?.quantity).toBe(1);
    // One id per press, so a network retry of this press cannot charge twice.
    expect(typeof purchases[0]?.requestId).toBe("string");
    expect(purchases[0]?.requestId.length).toBeGreaterThan(0);
  });

  it("sends one purchase however many times the button is hit", async () => {
    /*
      The tap that taught the component to keep its lock in a ref rather than
      in state: three synchronous clicks land before React has re-rendered
      with `pending`, so a state flag would let all three through.
    */
    const { purchases } = show({}, () => new Promise(() => {}));
    const button = buyButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(purchases.length).toBe(1));
  });

  it("refuses a quantity the balance cannot cover, and sends nothing", async () => {
    const { purchases } = show({ bananas: 120, ticketPriceBananas: 1000 });
    expect(buyButton().disabled).toBe(true);
    fireEvent.click(buyButton());
    await waitFor(() => expect(purchases).toEqual([]));
    expect(screen.getByText(/رصيد الموز لا يكفي/)).toBeTruthy();
  });

  it("refuses more tickets than one purchase may hold", async () => {
    const { purchases } = show({ bananas: 10_000_000 });
    fireEvent.change(screen.getByLabelText(/كم تذكرة تريد/), { target: { value: "500" } });
    expect(buyButton().disabled).toBe(true);
    fireEvent.click(buyButton());
    await waitFor(() => expect(purchases).toEqual([]));
  });

  it("offers nothing at all when the shop has set no price", () => {
    show({ ticketPriceBananas: 0 });
    expect(screen.queryByRole("button", { name: /اشترِ التذاكر/ })).toBeNull();
    expect(screen.getByText(/لم يحدّد المتجر سعر التذكرة بعد/)).toBeTruthy();
  });
});

describe("the arithmetic is shown, not promised", () => {
  it("prints what the chosen quantity costs and what it leaves", () => {
    show({ bananas: 1250, ticketPriceBananas: 1000 });
    fireEvent.change(screen.getByLabelText(/كم تذكرة تريد/), { target: { value: "1" } });
    // 1,250 − 1,000 = 250, on the screen rather than in the member's head.
    expect(screen.getByText(/رصيدك بعد الشراء/)).toBeTruthy();
    expect(screen.getByText("250")).toBeTruthy();
  });

  it("reports the server's new ticket count after a purchase, not its own guess", async () => {
    /*
      `tickets + quantity` would be a guess, and it would be wrong the moment a
      grant lands between the read and the purchase. The component prints what
      came back.
    */
    show({ tickets: 2 }, async () => ({ ok: true as const, tickets: 99 }));
    fireEvent.click(buyButton());
    await waitFor(() => expect(screen.getByText("99")).toBeTruthy());
  });
});
