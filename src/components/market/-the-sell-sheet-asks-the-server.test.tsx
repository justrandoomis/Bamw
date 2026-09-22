/**
 * @vitest-environment jsdom
 *
 * The sell sheet, exercised — because the one thing it must get right cannot be
 * read off the source.
 *
 * «السعر المستخدم في التنفيذ النهائي يجب أن يأتي من السيرفر لحظة تنفيذ البيع.
 *  لا تثق بالسعر أو الناتج أو الرصيد القادم من Client… ويجب أن يعرض الرد السعر
 *  الفعلي الذي تم التنفيذ به.»
 *
 * A sheet that shows a quote and then prints that same quote back as a receipt
 * looks correct on every screenshot and is a lie about money the moment the
 * market moves between opening the sheet and pressing the button. So the
 * central test here hands `onSell` a price that DIFFERS from the prop and
 * insists the screen shows the server's — which no test of the rendered markup
 * alone could catch.
 *
 * The other half is the double tap. `banana_direct_sales` deduplicates on
 * (user_id, request_id), and that protection is worth nothing if the browser
 * mints a fresh id for the second tap of one press: the member is charged
 * twice. One press, one call, one id — asserted by clicking repeatedly.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CurrencyProvider } from "@/context/CurrencyContext";

import { SellBananasSheet, type SellBananasSheetProps } from "./SellBananasSheet";

type SellOutcome = Awaited<ReturnType<SellBananasSheetProps["onSell"]>>;

/** The owner's own figures, from the brief. */
const BALANCE = 75_215;
const PRICE = 0.000377;
const MIN = 100;

const settled: SellOutcome = {
  ok: true,
  quantity: 1_000,
  pricePerBanana: PRICE,
  proceeds: 0,
};

function renderSheet(overrides: Partial<SellBananasSheetProps> = {}) {
  const props: SellBananasSheetProps = {
    open: true,
    onClose: vi.fn(),
    balance: BALANCE,
    pricePerBanana: PRICE,
    enabled: true,
    minQuantity: MIN,
    onSell: vi.fn(async () => settled),
    ...overrides,
  };
  render(
    <CurrencyProvider>
      <SellBananasSheet {...props} />
    </CurrencyProvider>,
  );
  return props;
}

const field = () => screen.getByLabelText("كم موزة تريد بيعها؟") as HTMLInputElement;
const sellButton = () => screen.queryByRole("button", { name: "بيع الآن" }) as HTMLButtonElement;
const type = (value: string) => fireEvent.change(field(), { target: { value } });

beforeEach(() => {
  /*
    `CurrencyProvider` asks the worker for exchange rates on mount. A sell sheet
    that needed that request to finish before it could show a price would be
    broken on a bad connection, so the stub never answers and every figure below
    is the one an offline member sees.
  */
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the calculation the member is invited to check", () => {
  it("multiplies the quantity by the quoted price, in front of them", () => {
    // «ويظهر الحساب مباشرة: 100,000 موزة × 0.000377 د.ع = 37.7 د.ع»
    renderSheet({ balance: 100_000 });
    type("100000");

    const preview = screen.getByTestId("sell-preview").textContent ?? "";
    expect(preview).toContain("100,000");
    expect(preview).toContain("0.000377");
    expect(preview).toContain("37.70");
  });

  it("states what is actually paid, floored to the whole dinar the server pays", () => {
    /*
      `sellBananas` pays `Math.floor(quantity * pricePerBanana)`. A preview that
      promised 37.70 د.ع against a payment of 37 د.ع would be the shop's own
      arithmetic arguing with itself.
    */
    renderSheet({ balance: 100_000 });
    type("100000");

    expect(screen.getByTestId("sell-preview").textContent).toContain("37 د.ع");
  });

  it("shows nothing to check until there is a valid quantity", () => {
    renderSheet();
    expect(screen.queryByTestId("sell-preview")).toBeNull();
  });
});

describe("the quick selections", () => {
  it("are percentages of the balance, floored to whole bananas", () => {
    // 75,215 does not divide evenly by four, which is the point of the test.
    renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "25%" }));
    expect(field().value).toBe("18803");

    fireEvent.click(screen.getByRole("button", { name: "50%" }));
    expect(field().value).toBe("37607");

    fireEvent.click(screen.getByRole("button", { name: "75%" }));
    expect(field().value).toBe("56411");

    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    expect(field().value).toBe("75215");
  });

  it("never offers more than the member holds", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    expect(Number(field().value)).toBeLessThanOrEqual(BALANCE);
    expect(sellButton().disabled).toBe(false);
  });
});

describe("what the button refuses to do", () => {
  it("stays disabled below the minimum, and names the minimum", () => {
    renderSheet();
    type("50");

    expect(sellButton().disabled).toBe(true);
    expect(screen.getByText(/أقل كمية للبيع/).textContent).toContain("100");
  });

  it("stays disabled above the balance, and names the balance", () => {
    renderSheet();
    type(String(BALANCE + 1));

    expect(sellButton().disabled).toBe(true);
    expect(screen.getByText(/لا يمكنك بيع أكثر من رصيدك/).textContent).toContain("75,215");
  });

  it("stays disabled on zero, on a negative and on a fraction", () => {
    renderSheet();

    type("0");
    expect(sellButton().disabled).toBe(true);
    expect(screen.getByText(/أكبر من صفر/)).toBeTruthy();

    type("-100");
    expect(sellButton().disabled).toBe(true);

    type("150.5");
    expect(sellButton().disabled).toBe(true);
    expect(screen.getByText(/لا تتجزأ/)).toBeTruthy();
  });

  it("stays disabled with an empty field", () => {
    renderSheet();
    expect(sellButton().disabled).toBe(true);
  });
});

describe("one press is one sale", () => {
  it("calls the server once however many times it is clicked, and disables itself meanwhile", async () => {
    const deferred: { resolve?: (outcome: SellOutcome) => void } = {};
    const onSell = vi.fn(
      () =>
        new Promise<SellOutcome>((resolve) => {
          deferred.resolve = resolve;
        }),
    );
    renderSheet({ onSell });

    type("1000");
    const button = sellButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onSell).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);

    deferred.resolve?.({ ok: true, quantity: 1_000, pricePerBanana: PRICE, proceeds: 0 });
    await waitFor(() => expect(screen.getByTestId("sell-receipt")).toBeTruthy());
  });

  it("sends the quantity and a non-empty request id", async () => {
    const onSell = vi.fn<SellBananasSheetProps["onSell"]>(async () => settled);
    renderSheet({ onSell });

    type("1000");
    fireEvent.click(sellButton());

    await waitFor(() => expect(onSell).toHaveBeenCalledTimes(1));
    /*
      `vi.fn<T>` types its calls from T, and TypeScript reads the tuple as
      possibly empty — the `waitFor` above guarantees it is not, but the
      compiler cannot see that. Named rather than destructured so the
      assertion says what it is reading.
    */
    const call = onSell.mock.calls[0] as unknown as [number, string];
    const quantity = call[0];
    const requestId = call[1];
    expect(quantity).toBe(1_000);
    expect(typeof requestId).toBe("string");
    expect(String(requestId).length).toBeGreaterThan(8);
  });

  it("retries the same press under the same id, so the server can recognise it", async () => {
    /*
      The retry must be the SAME sale. If it arrived under a fresh id the
      server would have no way to tell a retry from a second sale, and a
      request that timed out after it succeeded would sell twice.
    */
    const onSell = vi
      .fn<SellBananasSheetProps["onSell"]>()
      .mockResolvedValueOnce({ ok: false, error: "تعذّر الاتصال" })
      .mockResolvedValueOnce(settled);
    renderSheet({ onSell });

    type("1000");
    fireEvent.click(sellButton());
    await waitFor(() => expect(screen.getByText("تعذّر الاتصال")).toBeTruthy());
    fireEvent.click(sellButton());

    await waitFor(() => expect(onSell).toHaveBeenCalledTimes(2));
    expect(onSell.mock.calls[1][1]).toBe(onSell.mock.calls[0][1]);
  });

  it("treats a changed quantity as a different sale, under a different id", async () => {
    const onSell = vi
      .fn<SellBananasSheetProps["onSell"]>()
      .mockResolvedValueOnce({ ok: false, error: "تعذّر الاتصال" })
      .mockResolvedValueOnce(settled);
    renderSheet({ onSell });

    type("1000");
    fireEvent.click(sellButton());
    await waitFor(() => expect(onSell).toHaveBeenCalledTimes(1));

    type("2000");
    fireEvent.click(sellButton());
    await waitFor(() => expect(onSell).toHaveBeenCalledTimes(2));

    expect(onSell.mock.calls[1][1]).not.toBe(onSell.mock.calls[0][1]);
  });
});

describe("the receipt is the server's, not the screen's", () => {
  it("prints the executed price and proceeds that came back", async () => {
    const onSell = vi.fn(async () => ({
      ok: true as const,
      quantity: 100_000,
      pricePerBanana: 0.0002,
      proceeds: 20,
    }));
    renderSheet({ balance: 100_000, pricePerBanana: PRICE, onSell });

    type("100000");
    fireEvent.click(sellButton());

    const receipt = await waitFor(() => screen.getByTestId("sell-receipt"));
    expect(receipt.textContent).toContain("0.0002");
    expect(receipt.textContent).toContain("20 د.ع");
    // The quoted price was 0.000377. It has no business in a receipt.
    expect(receipt.textContent).not.toContain("0.000377");
  });

  it("says plainly that the price moved, naming both prices", async () => {
    const onSell = vi.fn(async () => ({
      ok: true as const,
      quantity: 100_000,
      pricePerBanana: 0.0002,
      proceeds: 20,
    }));
    renderSheet({ balance: 100_000, pricePerBanana: PRICE, onSell });

    type("100000");
    fireEvent.click(sellButton());

    const moved = await waitFor(() => screen.getByTestId("sell-price-moved"));
    expect(moved.textContent).toContain("0.000377");
    expect(moved.textContent).toContain("0.0002");
  });

  it("says nothing about a price that did not move", async () => {
    const onSell = vi.fn(async () => ({
      ok: true as const,
      quantity: 1_000,
      pricePerBanana: PRICE,
      proceeds: 0,
    }));
    renderSheet({ onSell });

    type("1000");
    fireEvent.click(sellButton());

    await waitFor(() => expect(screen.getByTestId("sell-receipt")).toBeTruthy());
    expect(screen.queryByTestId("sell-price-moved")).toBeNull();
  });
});

describe("a market the admin closed", () => {
  it("offers no sell button at all", () => {
    renderSheet({ enabled: false });

    expect(screen.queryByRole("button", { name: "بيع الآن" })).toBeNull();
    expect(screen.queryByLabelText("كم موزة تريد بيعها؟")).toBeNull();
    expect(screen.getByText(/البيع المباشر متوقف/)).toBeTruthy();
  });
});

describe("the sheet as a dialog", () => {
  it("renders nothing while closed", () => {
    renderSheet({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape and on a click outside it", () => {
    const props = renderSheet();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("presentation"));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("does not close from a click inside it", () => {
    const props = renderSheet();

    fireEvent.click(screen.getByRole("dialog"));
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
