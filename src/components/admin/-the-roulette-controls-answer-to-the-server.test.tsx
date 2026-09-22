/**
 * @vitest-environment jsdom
 *
 * The roulette's admin controls, and the four ways they could have been
 * decorative.
 *
 * Three of the owner's requirements meet on this screen:
 *
 *   «تعطيل/تفعيل البيع المباشر عند الحاجة»
 *   «عرض النسبة الفعلية النهائية بعد normalization وليس weights مبهمة»
 *   «إدارة Popularity tier للألعاب عند الحاجة» و«استبعاد لعبة من Prize Pool
 *    بدون حذفها من المتجر»
 *
 * Every one of them is a control that renders perfectly while doing nothing,
 * or — worse — while doing something nobody asked for. That is what these
 * pin, and each `it` below is a fault that would have shipped silently:
 *
 *  1. **A switch that does not seed.** The panel keeps the market form in
 *     local state and fills it from the GET. If `directSellEnabled` is not
 *     carried through, a shop that has CLOSED direct selling is shown an open
 *     switch, and the next press of «حفظ إعدادات المحرك» — saving anything
 *     else at all, a bot count, a commission — reopens a window the owner
 *     closed. A commercial decision undone by a form that never mentioned it.
 *
 *  2. **A switch that does not send.** The mirror of the same fault on the way
 *     out: the button moves, the payload does not carry it.
 *
 *  3. **A table that does its own arithmetic.** The whole point of
 *     `roulette_odds` is that the server has already normalised and already
 *     redistributed, so the curve fed in here deliberately does NOT add to
 *     100. A screen that recomputed, rescaled or "fixed" it would print
 *     different numbers than the ones the engine will actually run the spin on.
 *
 *  4 and 5. **A write that carries a field nobody touched.** `set_game_flags`
 *     treats an omitted field as «leave it alone» — that is what lets a tier
 *     and an exclusion be two separate decisions. Send the whole row and
 *     pressing «مشهورة» quietly returns a game the owner had taken OUT of the
 *     roulette, and pressing «استبعاد» resets its tier to «غير مشهورة». Both
 *     directions are asserted on the payload, not on the screen, because the
 *     screen looks right either way.
 *
 *  6. **An audit that answers with nothing.** Four tables from one box, and an
 *     empty search must say so rather than leaving a blank panel that reads as
 *     a broken page.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getBananaData = vi.fn();
const saveBananaMarketConfig = vi.fn();
const rouletteOdds = vi.fn();
const setRouletteGameFlags = vi.fn();
const rouletteAudit = vi.fn();
const catalogue = vi.fn();

vi.mock("@/lib/api", () => ({
  adminApi: {
    getBananaData: () => getBananaData(),
    saveBananaMarketConfig: (config: Record<string, unknown>) => saveBananaMarketConfig(config),
    rouletteOdds: (boundary?: number) => rouletteOdds(boundary),
    setRouletteGameFlags: (payload: Record<string, unknown>) => setRouletteGameFlags(payload),
    rouletteAudit: (query: string) => rouletteAudit(query),
    catalogue: () => catalogue(),
  },
}));

const { BananaManagementView } = await import("./BananaManagementView");

/** The shape `/api/admin/banana` answers with, trimmed to what this screen reads. */
const bananaData = (marketConfig: Record<string, unknown> = {}) => ({
  stats: {
    circulatingBananas: 0,
    userWalletsCount: 0,
    activeListingsCount: 0,
    activeListingsVolume: 0,
    totalRedemptionsCount: 0,
    totalBananasRedeemed: 0,
  },
  settings: {
    rewardRatePerIqd: 6.8,
    dinarPerBanana: 1000,
    openingPrice: 0.24,
    promoRatePerMinute: 2,
    signupGrant: 500,
  },
  marketConfig: {
    basePrice: 0.24,
    minPrice: 0.1,
    maxPrice: 1,
    commissionPercent: 5,
    volatilityPercent: 8,
    botsEnabled: true,
    botCount: 4,
    botMinQuantity: 500,
    botMaxQuantity: 25000,
    minListingQuantity: 100,
    maxListingQuantity: 1000000,
    promoRatePerMinute: 2,
    directSellEnabled: true,
    ...marketConfig,
  },
  livePrice: 0.24,
  bots: [],
  rewards: [],
  redemptions: [],
  listings: [],
  topUsers: [],
});

/**
 * A curve that no client-side arithmetic could have produced.
 *
 * It does not add to 100 (it adds to 99.992), the two cheap buckets carry
 * everything, and the four empty ones are at three decimals. If any of these
 * numbers is re-derived, rescaled or rounded into a "nicer" set on the way to
 * the screen, the assertions below stop matching.
 */
const PERCENTS: Record<string, number> = {
  lose: 61.3,
  low_cheap: 33.7,
  low_premium: 4.87,
  medium_cheap: 0.093,
  high_cheap: 0.017,
  medium_premium: 0.012,
  high_premium: 0.001,
};

const POPULATION = {
  low_cheap: 983,
  medium_cheap: 0,
  high_cheap: 0,
  low_premium: 724,
  medium_premium: 0,
  high_premium: 0,
};

const LABELS: Record<string, string> = {
  lose: "حظ أوفر",
  low_cheap: "لعبة غير مشهورة — سعر منخفض",
  medium_cheap: "لعبة شبه مشهورة — سعر منخفض",
  high_cheap: "لعبة مشهورة — سعر منخفض",
  low_premium: "لعبة غير مشهورة — سعر أعلى",
  medium_premium: "لعبة شبه مشهورة — سعر أعلى",
  high_premium: "لعبة مشهورة — سعر أعلى",
};

/*
  The real response shape: ten entries, `rows` sorted biggest first the way
  `oddsRows` sorts them — which is exactly why the screen must look a cell up
  by its key rather than by its position.
*/
const ODDS = {
  success: true,
  priceBoundary: 5000,
  poolSize: 1707,
  skipped: { hidden: 3, not_a_game: 4 },
  population: POPULATION,
  curve: Array.from({ length: 10 }, (_unused, index) => ({
    tickets: index + 1,
    rows: Object.entries(PERCENTS)
      .map(([key, percent]) => ({
        key,
        label: LABELS[key],
        percent,
        games: (POPULATION as Record<string, number>)[key] ?? 0,
      }))
      .sort((a, b) => b.percent - a.percent),
    emptied: ["medium_cheap", "high_cheap", "medium_premium", "high_premium"],
  })),
};

const GAMES = [
  {
    id: "p_mario",
    title: "Mario Kart 8 Deluxe",
    titleEn: "Mario Kart 8 Deluxe",
    titleAr: "ماريو كارت ٨ ديلوكس",
    price: 5000,
    kind: "account",
  },
  {
    id: "p_zelda",
    title: "The Legend of Zelda: Tears of the Kingdom",
    titleEn: "The Legend of Zelda: Tears of the Kingdom",
    titleAr: "أسطورة زيلدا: دموع المملكة",
    price: 9000,
    kind: "account",
  },
];

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <BananaManagementView />
    </QueryClientProvider>,
  );
}

const openTab = (label: RegExp) => fireEvent.click(screen.getByText(label));

/** The engine tab, once the form has been seeded from the server's answer. */
async function openMarketTab() {
  renderPanel();
  await waitFor(() => expect(getBananaData).toHaveBeenCalled());
  openTab(/محرك السوق والبوتات/);
  await screen.findByText("محرك تسعير سوق الموز");
}

/** The roulette tab, once both of its reads have landed. */
async function openRouletteTab() {
  renderPanel();
  await waitFor(() => expect(getBananaData).toHaveBeenCalled());
  openTab(/الروليت — النسب والألعاب والتدقيق/);
  await screen.findByText(/النسب الفعلية للروليت/);
}

const gameRow = (id: string) =>
  screen.getAllByTestId("roulette-game-row").find((row) => row.getAttribute("data-id") === id)!;

beforeEach(() => {
  for (const spy of [
    getBananaData,
    saveBananaMarketConfig,
    rouletteOdds,
    setRouletteGameFlags,
    rouletteAudit,
    catalogue,
  ]) {
    spy.mockReset();
  }
  getBananaData.mockResolvedValue(bananaData());
  saveBananaMarketConfig.mockResolvedValue({ success: true, marketConfig: {} });
  rouletteOdds.mockResolvedValue(ODDS);
  catalogue.mockResolvedValue({ products: GAMES });
  setRouletteGameFlags.mockImplementation(async (payload: Record<string, unknown>) => ({
    success: true,
    ...payload,
  }));
  rouletteAudit.mockResolvedValue({
    success: true,
    query: "u_1",
    spins: [],
    prizes: [],
    sales: [],
    tickets: [],
  });
});
afterEach(cleanup);

describe("the switch on direct selling", () => {
  it("shows a closed window as closed, instead of drawing its own default", async () => {
    getBananaData.mockResolvedValue(bananaData({ directSellEnabled: false }));
    await openMarketTab();
    await screen.findByText("مُعطَّل — اضغط للتفعيل");
    expect(screen.queryByText("مُفعَّل — اضغط للتعطيل")).toBeNull();
  });

  it("shows an open one as open", async () => {
    await openMarketTab();
    await screen.findByText("مُفعَّل — اضغط للتعطيل");
  });

  it("saves the value it is showing, so an unrelated save cannot reopen the shop", async () => {
    getBananaData.mockResolvedValue(bananaData({ directSellEnabled: false }));
    await openMarketTab();
    await screen.findByText("مُعطَّل — اضغط للتفعيل");

    fireEvent.click(screen.getByText("حفظ إعدادات المحرك"));
    await waitFor(() => expect(saveBananaMarketConfig).toHaveBeenCalled());
    expect(saveBananaMarketConfig.mock.calls[0][0].directSellEnabled).toBe(false);
  });

  it("sends the new position after it is pressed", async () => {
    getBananaData.mockResolvedValue(bananaData({ directSellEnabled: false }));
    await openMarketTab();

    fireEvent.click(await screen.findByText("مُعطَّل — اضغط للتفعيل"));
    await screen.findByText("مُفعَّل — اضغط للتعطيل");
    fireEvent.click(screen.getByText("حفظ إعدادات المحرك"));

    await waitFor(() => expect(saveBananaMarketConfig).toHaveBeenCalled());
    expect(saveBananaMarketConfig.mock.calls[0][0].directSellEnabled).toBe(true);
  });
});

describe("the odds table", () => {
  it("prints the server's percentages and not a set of its own", async () => {
    await openRouletteTab();
    /*
      Ten rows share one set of percentages in this fixture, so each string is
      expected ten times — and every one of them is the number the server sent,
      to the precision the member's own wheel screen uses.
    */
    expect((await screen.findAllByText("61.3%")).length).toBe(10);
    expect(screen.getAllByText("33.7%").length).toBe(10);
    expect(screen.getAllByText("4.9%").length).toBe(10);
    expect(screen.getAllByText("0.093%").length).toBe(10);
    expect(screen.getAllByText("0.017%").length).toBe(10);
    expect(screen.getAllByText("0.001%").length).toBe(10);
  });

  it("offers no weight anywhere — «وليس weights مبهمة»", async () => {
    await openRouletteTab();
    expect(screen.queryByText(/الوزن/)).toBeNull();
    expect(screen.queryByText(/وزن/)).toBeNull();
  });

  it("says how big the pool is and how many games each bucket holds", async () => {
    await openRouletteTab();
    await screen.findByText("1,707");
    expect(screen.getAllByText("983").length).toBeGreaterThan(0);
    expect(screen.getAllByText("724").length).toBeGreaterThan(0);
  });

  it("names the empty buckets and says where their share went", async () => {
    await openRouletteTab();
    /* The notice in the odds card — the classification card below also says «فئات فارغة». */
    const notice = await screen.findByText(/فئات فارغة لا توجد فيها لعبة واحدة مؤهلة/);
    const said = String(notice.textContent);
    for (const bucket of [
      "«شبه مشهورة — سعر منخفض»",
      "«مشهورة — سعر منخفض»",
      "«شبه مشهورة — سعر أعلى»",
      "«مشهورة — سعر أعلى»",
    ]) {
      expect(said).toContain(bucket);
    }
    expect(said).toContain("يُعاد توزيعه");
  });

  it("says why games were dropped, in words rather than in keys", async () => {
    await openRouletteTab();
    await screen.findByText("مخفية في المتجر");
    await screen.findByText("ليست لعبة (أجهزة، اكسسوارات، بطاقات، مستعمل)");
  });
});

describe("classifying a game", () => {
  it("sends the tier and nothing else, so an exclusion cannot be undone by it", async () => {
    await openRouletteTab();
    await screen.findByText("ماريو كارت ٨ ديلوكس");

    fireEvent.click(within(gameRow("p_mario")).getByText("مشهورة"));

    await waitFor(() => expect(setRouletteGameFlags).toHaveBeenCalled());
    const payload = setRouletteGameFlags.mock.calls[0][0];
    expect(payload).toEqual({ productId: "p_mario", popularity: "high" });
    expect("excluded" in payload).toBe(false);
  });

  it("sends the exclusion and nothing else, so a tier cannot be reset by it", async () => {
    await openRouletteTab();
    await screen.findByText("أسطورة زيلدا: دموع المملكة");

    fireEvent.click(within(gameRow("p_zelda")).getByText("استبعاد من الروليت"));

    await waitFor(() => expect(setRouletteGameFlags).toHaveBeenCalled());
    const payload = setRouletteGameFlags.mock.calls[0][0];
    expect(payload).toEqual({ productId: "p_zelda", excluded: true });
    expect("popularity" in payload).toBe(false);
  });

  it("draws the tier the server confirmed, not the one that was pressed", async () => {
    /*
      The reply is what the row renders. A screen that marked the button on
      click would show a classification that never reached the database.
    */
    setRouletteGameFlags.mockResolvedValue({ success: true, productId: "p_mario" });
    await openRouletteTab();
    await screen.findByText("ماريو كارت ٨ ديلوكس");

    fireEvent.click(within(gameRow("p_mario")).getByText("شبه مشهورة"));
    await waitFor(() => expect(setRouletteGameFlags).toHaveBeenCalled());

    await waitFor(() =>
      expect(within(gameRow("p_mario")).getByText(/لم تُصنَّف بعد/)).toBeTruthy(),
    );
  });

  it("finds a game by its Arabic name, which is how the owner searches", async () => {
    await openRouletteTab();
    await screen.findByText("أسطورة زيلدا: دموع المملكة");

    fireEvent.change(screen.getByPlaceholderText(/ابحث باسم اللعبة/), {
      target: { value: "زيلدا" },
    });

    await waitFor(() => expect(screen.queryByText("ماريو كارت ٨ ديلوكس")).toBeNull());
    expect(screen.getByText("أسطورة زيلدا: دموع المملكة")).toBeTruthy();
  });
});

describe("the audit search", () => {
  it("does not search until it is asked to", async () => {
    await openRouletteTab();
    fireEvent.change(screen.getByPlaceholderText(/ابحث بمعرّف مستخدم/), {
      target: { value: "u_1" },
    });
    expect(rouletteAudit).not.toHaveBeenCalled();
  });

  it("shows a row from each of the four sources", async () => {
    rouletteAudit.mockResolvedValue({
      success: true,
      query: "u_1",
      spins: [{ id: "spin_7", user_id: "u_1", tickets: 3, bucket: "low_cheap" }],
      prizes: [{ id: "prize_9", user_id: "u_1", order_id: "ord_2" }],
      sales: [{ id: "sale_4", user_id: "u_1", quantity: 1000 }],
      tickets: [{ id: "led_5", user_id: "u_1", delta: -3, reason: "spin" }],
    });
    await openRouletteTab();

    fireEvent.change(screen.getByPlaceholderText(/ابحث بمعرّف مستخدم/), {
      target: { value: "u_1" },
    });
    fireEvent.click(screen.getByText("ابحث"));

    await waitFor(() => expect(rouletteAudit).toHaveBeenCalledWith("u_1"));
    await screen.findByText("spin_7");
    await screen.findByText("prize_9");
    await screen.findByText("sale_4");
    await screen.findByText("led_5");
  });

  it("says there is nothing rather than leaving four blank panels", async () => {
    await openRouletteTab();
    fireEvent.change(screen.getByPlaceholderText(/ابحث بمعرّف مستخدم/), {
      target: { value: "u_missing" },
    });
    fireEvent.click(screen.getByText("ابحث"));

    await waitFor(() => expect(rouletteAudit).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("لا توجد نتائج هنا.").length).toBe(4));
  });
});
