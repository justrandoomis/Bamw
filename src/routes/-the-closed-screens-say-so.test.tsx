/**
 * @vitest-environment jsdom
 *
 * The roulette, the banana market and disc trade-in, under maintenance, on screen.
 *
 *   «حاليا الروليت والموز وسوق الموز … ( اجعلها تحت الصيانه )»
 *   «وقف ميزه استبدال الاقراص وجعلها تحت الصيانه»
 *
 * The server already refuses every spin, sale and redemption — see
 * `-the-closed-features-stay-closed.test.ts`. These tests are the other half:
 * that a member reads a sentence instead of pressing buttons the server will
 * refuse, and that maintenance does not hide what the shop still owes them —
 * the games already won, waiting to be imported.
 *
 * The roulette and the market have since reopened — «ارجاع الروليت / ارجاع
 * قسم الموز كاملا» — so the switch is held here per test: closed, to prove
 * each screen still says so the next time it is; and as it ships, to prove
 * the roulette is back.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useRouletteMock = vi.fn();
const useAuthMock = vi.fn();
const useBananaMarketMock = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/useRoulette", () => ({
  useRoulette: (...args: unknown[]) => useRouletteMock(...args),
  pressId: () => "press-1",
}));

vi.mock("@/hooks/useBananaMarket", () => ({
  useBananaMarket: (...args: unknown[]) => useBananaMarketMock(...args),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/utils/audio", () => ({
  playSound: vi.fn(),
  stopSound: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

/* `null` reads the switch as it ships; a set closes exactly those features. */
let closed: Set<string> | null = null;
vi.mock("@/lib/maintenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/maintenance")>();
  return {
    ...actual,
    isUnderMaintenance: (feature: Parameters<typeof actual.isUnderMaintenance>[0]) =>
      closed ? closed.has(feature) : actual.isUnderMaintenance(feature),
  };
});

vi.mock("@/components/roulette/RouletteStrip", () => ({
  ROULETTE_SOUND_CHANNEL: "roulette-run",
  RouletteStrip: () => <div aria-label="شريط الجوائز" role="img" />,
}));

const { RoulettePage } = await import("./wheel");
const { MarketMaintenance } = await import("@/components/market/MarketMaintenance");
const { StoreServices } = await import("@/components/StoreServices");
const { MaintenanceNotice } = await import("@/components/MaintenanceNotice");

const wonPrize = {
  id: "prz_1",
  spinId: "spn_1",
  productId: "prd_mk8",
  productTitle: "Mario Kart 8 Deluxe",
  productImage: null,
  productPrice: 7000,
  bucket: "major",
  status: "available" as const,
  wonAt: "2026-10-01T10:00:00.000Z",
  claimedAt: null,
  orderId: null,
  threadId: null,
};

beforeEach(() => {
  closed = null;
  useRouletteMock.mockReset();
  useAuthMock.mockReset();
  useBananaMarketMock.mockReset();
  useAuthMock.mockReturnValue({ user: { id: "usr_1" } });
  useRouletteMock.mockReturnValue({
    state: {
      bananas: 12_000,
      tickets: 3,
      strip: [{ id: "g1", title: "Game 1", image: null }],
      poolSize: 1,
      population: 1,
      odds: [],
      emptied: [],
      ticketPriceBananas: 2_000,
      maxTicketsPerSpin: 10,
      priceBoundary: 0,
      marketPrice: 0,
      prizes: [wonPrize],
    },
    isPending: false,
    spin: { isPending: false, mutateAsync: vi.fn() },
    importPrize: { isPending: false, mutateAsync: vi.fn() },
    refresh: vi.fn(),
  });
});

afterEach(cleanup);

describe("the roulette under maintenance", () => {
  beforeEach(() => {
    closed = new Set(["roulette"]);
  });

  it("says so, and offers no spin", () => {
    render(<RoulettePage />);
    expect(screen.getByRole("status").textContent).toContain("الروليت تحت الصيانة");
    expect(screen.queryByRole("img", { name: "شريط الجوائز" })).toBeNull();
    expect(screen.queryByText(/ابدأ/)).toBeNull();
  });

  it("still shows the game already won, with its import button", () => {
    render(<RoulettePage />);
    expect(screen.getAllByText("Mario Kart 8 Deluxe").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /استيراد/ })).toBeTruthy();
  });
});

describe("the roulette as it ships", () => {
  it("is back: the strip and the spin, and no maintenance sentence", () => {
    render(<RoulettePage />);
    expect(screen.queryByText("الروليت تحت الصيانة")).toBeNull();
    expect(screen.getByRole("img", { name: "شريط الجوائز" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /ابدأ/ })).toBeTruthy();
  });
});

describe("the banana market under maintenance", () => {
  it("says so, with a way home", () => {
    render(<MarketMaintenance />);
    expect(screen.getByRole("status").textContent).toContain("سوق الموز تحت الصيانة");
    expect(screen.getByRole("link", { name: "العودة إلى الرئيسية" }).getAttribute("href")).toBe(
      "/",
    );
  });

  /*
    Asserted on the route's source, not by rendering it: the route plugin
    code-splits a route file's component into a lazy chunk the test runner
    never loads. What matters is the ORDER — the switch is asked before
    `BananaMarketPage`, which is where every market hook lives, can run.
  */
  it("is what the route renders, before any of the market's hooks can run", () => {
    const source = readFileSync(path.resolve(__dirname, "banana.tsx"), "utf8");
    /*
      The route renders a tab bar above two halves — «الفعاليات والمسابقات»,
      where `/banana` opens, and «سوق الموز» — and hands the market half to
      the same gate.
    */
    expect(source).toContain("component: BananaScreen,");
    expect(source).toMatch(/\) : \(\s*<BananaMarketRoute \/>\s*\)\}/);
    const gate = source.slice(source.indexOf("function BananaMarketRoute()"));
    const body = gate.slice(0, gate.indexOf("\n}\n"));
    expect(body).toMatch(
      /if \(isUnderMaintenance\("bananaMarket"\) \|\| isUnderMaintenance\("bananas"\)\) \{\s*return <MarketMaintenance \/>;\s*\}\s*return <BananaMarketPage \/>;/,
    );
    expect(useBananaMarketMock).not.toHaveBeenCalled();
  });
});

describe("disc trade-in under maintenance", () => {
  it("says so in the trade page's own words", () => {
    render(<MaintenanceNotice feature="discTrade" />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("استبدال الأقراص تحت الصيانة");
    expect(notice.textContent).toContain("طلباتك السابقة محفوظة");
  });

  /*
    Asserted on the page's source, as the market is: the route's component is
    code-split into a chunk the test runner never loads. What matters is that
    the switch is asked BEFORE the sign-in gate and the new-trade wizard — and
    that the member's own trades are still listed below it, because the server
    keeps cancelling and accepting them open.
  */
  it("replaces the new-trade wizard, and keeps the member's trades below it", () => {
    const source = readFileSync(path.resolve(__dirname, "disc_trade.tsx"), "utf8");
    expect(source).toMatch(
      /\{tradePaused \? \(\s*<MaintenanceNotice feature="discTrade" \/>\s*\) : !user \? \(\s*<LoginGate/,
    );
    const gate = source.indexOf('<MaintenanceNotice feature="discTrade" />');
    const history = source.indexOf('{user && visible("history") && (');
    expect(gate).toBeGreaterThan(-1);
    expect(history).toBeGreaterThan(gate);
  });

  it("labels the home page's trade card, and still links it to the page that explains", () => {
    render(<StoreServices />);
    const label = document.querySelector('[data-maintenance="discTrade"]');
    expect(label?.textContent).toBe("تحت الصيانة");
    const card = label?.closest("div");
    expect(card?.querySelector('a[href="/disc_trade"]')).toBeTruthy();
    /* Only that card: the other services are not under maintenance. */
    expect(document.querySelectorAll("[data-maintenance]")).toHaveLength(1);
  });
});
