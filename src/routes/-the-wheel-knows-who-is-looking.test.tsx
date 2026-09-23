/**
 * @vitest-environment jsdom
 *
 * The roulette told signed-out visitors the shop was empty.
 *
 * `/api/roulette` answers 401 without a session — `requireUser` throws before
 * the pool is ever read — so a visitor with no account gets `state === null`.
 * The screen had no way to tell that apart from a pool that really had nothing
 * in it, and it guessed wrong: it fell through to
 *
 *     «لا توجد ألعاب متاحة في الروليت الآن.»
 *
 * a sentence about the shop's stock, shown to someone whose only problem was
 * that they had not logged in. Under it, the button read «لا تملك هذا العدد من
 * التذاكر» and a link offered to sell them tickets they could not buy either.
 * Three statements, none of them true of that visitor, on a page whose whole
 * job is to make them want an account.
 *
 * The production checker had been reading this as a broken strip for as long as
 * it had existed, which is its own lesson: a check that cannot name WHY a
 * screen is empty will eventually make somebody revert the wrong thing.
 *
 * So the page reads the session, and each of the three states says its own true
 * thing. That is what these tests hold:
 *
 *   - no session          → sign in, and nothing about stock or tickets;
 *   - session, empty pool → the pool really is empty, and it is allowed to say so;
 *   - session, full pool  → the strip, and no sign-in prompt anywhere.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useRouletteMock = vi.fn();
const useAuthMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
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

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/utils/audio", () => ({
  playSound: vi.fn(),
  stopSound: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/*
  The strip draws itself with rAF and real measurements; none of that is what
  this file is about. A stand-in keeps the accessible name the page relies on,
  so «did the strip render» is still a real question here.
*/
vi.mock("@/components/roulette/RouletteStrip", () => ({
  ROULETTE_SOUND_CHANNEL: "roulette-run",
  RouletteStrip: ({ cards }: { cards: { id: string }[] }) => (
    <div aria-label="شريط الجوائز" role="img">
      {cards.length} بطاقة
    </div>
  ),
}));

const { RoulettePage } = await import("./wheel");

/** A roulette answer with the fields the screen actually reads. */
const stateWith = (cards: number) => ({
  bananas: 12_000,
  tickets: 3,
  strip: Array.from({ length: cards }, (_, i) => ({
    id: `g${i}`,
    title: `Game ${i}`,
    image: null,
  })),
  poolSize: cards,
  population: cards,
  odds: [],
  emptied: [],
  ticketPriceBananas: 2_000,
  maxTicketsPerSpin: 10,
  priceBoundary: 0,
  marketPrice: 0.000377,
  prizes: [],
});

const idle = {
  spin: { isPending: false, mutateAsync: vi.fn() },
  importPrize: { isPending: false, mutateAsync: vi.fn() },
  refresh: vi.fn(),
};

beforeEach(() => {
  useRouletteMock.mockReset();
  useAuthMock.mockReset();
});

afterEach(cleanup);

describe("a visitor with no session", () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: null });
    /* Exactly what the hook reports after a 401: pending over, nothing to show. */
    useRouletteMock.mockReturnValue({ state: null, isPending: false, ...idle });
  });

  /*
    Asserted as a LINK, not as the words. The spin button says the same
    sentence, so matching on text alone passed even with the prize section
    reverted to its old behaviour — the check would have been satisfied by the
    half of the screen that was never broken. The way out of the dead end is a
    door, and that only exists in the section.
  */
  it("is offered a way in, where the prizes would have been", () => {
    render(<RoulettePage />);
    const door = screen.getByRole("link", { name: "تسجيل الدخول" });
    expect(door.getAttribute("href")).toBe("/auth");
  });

  it("is told, in the prize section, what is actually wrong", () => {
    render(<RoulettePage />);
    expect(screen.getAllByText(/سجّل الدخول لتشغيل الروليت/).length).toBeGreaterThan(0);
  });

  /* THE FAULT ITSELF. This is the sentence that was shown, and it was false. */
  it("is never told the roulette has no games", () => {
    render(<RoulettePage />);
    expect(screen.queryByText(/لا توجد ألعاب متاحة في الروليت/)).toBeNull();
  });

  it("is never told they are short of tickets they never had", () => {
    render(<RoulettePage />);
    expect(screen.queryByText(/لا تملك هذا العدد من التذاكر/)).toBeNull();
  });

  /*
    And is not sent to buy tickets. The market will refuse them for the same
    reason the roulette did, so the link was a second closed door.
  */
  it("is not sent to the market to buy tickets first", () => {
    render(<RoulettePage />);
    expect(screen.queryByText(/اشترِ تذاكر من سوق الموز/)).toBeNull();
  });

  it("sees no strip, because there is genuinely nothing to draw", () => {
    render(<RoulettePage />);
    expect(screen.queryByLabelText("شريط الجوائز")).toBeNull();
  });
});

describe("a member whose pool really is empty", () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: { id: "u1", name: "عضو" } });
    useRouletteMock.mockReturnValue({ state: stateWith(0), isPending: false, ...idle });
  });

  /*
    The sentence is not deleted — it is reserved. There is a real state it
    describes correctly, and taking it away would have replaced one wrong
    answer with no answer.
  */
  it("is still told the pool is empty, because now it is true", () => {
    render(<RoulettePage />);
    expect(screen.getByText(/لا توجد ألعاب متاحة في الروليت/)).toBeTruthy();
  });

  it("is not asked to sign in again", () => {
    render(<RoulettePage />);
    expect(screen.queryByText(/سجّل الدخول لتشغيل الروليت/)).toBeNull();
  });
});

describe("a member with a pool", () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: { id: "u1", name: "عضو" } });
    useRouletteMock.mockReturnValue({ state: stateWith(12), isPending: false, ...idle });
  });

  it("sees the strip", () => {
    render(<RoulettePage />);
    expect(screen.getByLabelText("شريط الجوائز")).toBeTruthy();
  });

  it("sees no sign-in prompt and no empty-pool sentence", () => {
    render(<RoulettePage />);
    expect(screen.queryByText(/سجّل الدخول لتشغيل الروليت/)).toBeNull();
    expect(screen.queryByText(/لا توجد ألعاب متاحة في الروليت/)).toBeNull();
  });
});

describe("a member whose answer has not arrived yet", () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: { id: "u1", name: "عضو" } });
    useRouletteMock.mockReturnValue({ state: null, isPending: true, ...idle });
  });

  /*
    The spinner still belongs to a member who is genuinely waiting. What it must
    never do again is stand in for an answer that was never coming.
  */
  it("waits, rather than claiming anything about the pool", () => {
    render(<RoulettePage />);
    expect(screen.queryByText(/لا توجد ألعاب متاحة في الروليت/)).toBeNull();
    expect(screen.queryByText(/سجّل الدخول لتشغيل الروليت/)).toBeNull();
  });
});
