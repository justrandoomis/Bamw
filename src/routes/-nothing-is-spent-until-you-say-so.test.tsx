/**
 * @vitest-environment jsdom
 *
 * Buying a wheel ticket asks first, and shows what it will cost.
 *
 * The «اشترِ تذكرة» button sat one thumb-width under «دوّر العجلة» and spent
 * the member's bananas on a single tap, with the balance nowhere on the
 * screen — so deciding whether you could afford it meant leaving the wheel to
 * go and look, and mis-tapping cost you the bananas. The owner asked for the
 * balance at the top right and a confirmation before anything is deducted.
 *
 * These tests hold the part that actually protects the member: NO REQUEST is
 * sent until the confirmation is answered.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  A PARTIAL mock. The route file is compiled by TanStack's own plugin, which
  injects `lazyRouteComponent` into it — so replacing the whole module leaves
  the route unable to load at all. Only the two pieces this page uses at
  render time are stood in for.
*/
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createFileRoute: () => (config: Record<string, unknown>) => config,
  Link: ({ children, ...rest }: any) => <a {...rest}>{children}</a>,
}));

vi.mock("@/utils/audio", () => ({ playSound: () => {} }));
vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

/** Every request the page makes, in order. */
let sent: { url: string; init?: RequestInit }[] = [];
let summary: Record<string, unknown> = {};

vi.mock("@/lib/api", () => ({
  api: {
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, init });
      if (init?.method === "POST") return { ok: true, tickets: 1, bananas: 250 };
      return summary;
    }),
  },
}));

/*
  The component itself, not `Route.component`.

  TanStack Start's plugin rewrites a route file's `component` into a
  `lazyRouteComponent`, so rendering through the route SUSPENDS on first use:
  the container paints empty, whichever test ran first failed on a timeout and
  every test after it passed. A false red that said nothing about the page.
  `WheelPage` is exported for this, and it is the same function the route
  points at.
*/
const { WheelPage } = await import("./wheel");

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WheelPage />
    </QueryClientProvider>,
  );
}

const purchases = () => sent.filter((r) => r.init?.method === "POST");

beforeEach(() => {
  sent = [];
  summary = {
    tickets: 0,
    bananas: 1250,
    ticketPriceBananas: 1000,
    poolSize: 40,
    candidates: [],
    spins: [],
    prizeValidDays: 7,
    odds: [],
  };
});

afterEach(cleanup);

/** The chip, found by what it announces rather than by a bare number. */
const chip = () => screen.getByLabelText(/رصيدك/);

describe("the wheel says what you have before it asks for it", () => {
  it("shows the balance the server reported", async () => {
    show();
    await screen.findByText("اشترِ تذكرة");
    expect(chip().textContent).toContain("1,250");
  });

  it("shows a zero balance rather than hiding the chip", async () => {
    summary = { ...summary, bananas: 0 };
    show();
    await screen.findByText("اشترِ تذكرة");
    expect(chip().textContent).toContain("0");
  });
});

describe("nothing is deducted until the member says so", () => {
  it("sends no purchase when the buy button is pressed", async () => {
    show();
    fireEvent.click(await screen.findByText("اشترِ تذكرة"));

    await screen.findByText("تأكيد شراء التذكرة");
    expect(purchases()).toEqual([]);
  });

  it("states the price, the balance and what is left", async () => {
    show();
    fireEvent.click(await screen.findByText("اشترِ تذكرة"));
    await screen.findByText("تأكيد شراء التذكرة");

    /** The figure beside a row's label, read off the definition list. */
    const row = (label: string) =>
      (screen.getByText(label).nextElementSibling?.textContent || "").trim();

    expect(row("سعر التذكرة")).toContain("1,000");
    expect(row("رصيدك الآن")).toContain("1,250");
    // 1,250 - 1,000 = 250. The figure, not a promise about it.
    expect(row("الرصيد بعد الشراء")).toContain("250");
  });

  it("buys exactly one ticket, once, when confirmed", async () => {
    show();
    fireEvent.click(await screen.findByText("اشترِ تذكرة"));
    fireEvent.click(await screen.findByText("تأكيد الشراء"));

    await waitFor(() => expect(purchases().length).toBe(1));
    const payload = JSON.parse(String(purchases()[0]?.init?.body ?? "{}"));
    expect(payload.action).toBe("buy_ticket");
    expect(payload.quantity).toBe(1);
    // One id per press, so a network retry of this press cannot charge twice.
    expect(typeof payload.requestId).toBe("string");
  });

  it("buys nothing when the member cancels", async () => {
    show();
    fireEvent.click(await screen.findByText("اشترِ تذكرة"));
    fireEvent.click(await screen.findByText("إلغاء"));

    await waitFor(() => expect(screen.queryByText("تأكيد شراء التذكرة")).toBeNull());
    expect(purchases()).toEqual([]);
  });

  it("buys nothing when the member presses Escape", async () => {
    show();
    fireEvent.click(await screen.findByText("اشترِ تذكرة"));
    await screen.findByText("تأكيد شراء التذكرة");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("تأكيد شراء التذكرة")).toBeNull());
    expect(purchases()).toEqual([]);
  });

  it("refuses to confirm a purchase the balance cannot cover", async () => {
    summary = { ...summary, bananas: 120, ticketPriceBananas: 1000 };
    show();
    fireEvent.click(await screen.findByText("اشترِ تذكرة"));

    const confirm = (await screen.findByText("تأكيد الشراء")) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText("رصيد الموز لا يكفي.")).toBeTruthy();

    fireEvent.click(confirm);
    expect(purchases()).toEqual([]);
  });
});
