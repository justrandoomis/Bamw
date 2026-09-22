/**
 * @vitest-environment jsdom
 *
 * What a member sees when the roulette says «حظ أوفر», and what the odds say.
 *
 * ## What these tests were for, and why they are now rendered rather than grepped
 *
 * The wheel page assumed every spin won. A losing spin returns no prize, and
 * the result block was written as «if there is a prize» — so the member pressed
 * the button, watched their ticket disappear, and was shown an empty screen.
 * That is the worst possible way to introduce a losing outcome: it reads as the
 * shop taking a ticket and giving nothing, which is exactly what it is, only
 * silently.
 *
 * The odds list had the mirror of the same problem. It filtered on `games > 0`,
 * and «حظ أوفر» has no games BY DEFINITION — so the one row a member most needs
 * to see was the one guaranteed to be hidden, and the remaining percentages no
 * longer added to a hundred with nothing on screen to explain the gap. It also
 * appended «دينار» to every label, which would have printed «حظ أوفر دينار».
 *
 * Both faults are still worth a guard, and both guards are still here. What
 * changed is how they are checked. The old file asserted on the page's SOURCE
 * TEXT — `expect(TIGHT).toContain("result?.ok&&!result.prize?(")` — which
 * pinned one particular spelling of the fix rather than the fix. The page has
 * been rewritten as a roulette and every one of those strings is gone, while
 * every behaviour they stood for is not.
 *
 * So these render the real components and read the real screen. A source grep
 * cannot tell a blank result block from a full one; this can.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createFileRoute: () => (config: Record<string, unknown>) => config,
  Link: ({ children, ...rest }: Record<string, unknown>) => <a {...rest}>{children as never}</a>,
  useNavigate: () => () => undefined,
}));
vi.mock("@/utils/audio", () => ({ playSound: () => {} }));
vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

const { ResultDialog } = await import("./wheel");
const { oddsForTickets, oddsRows, resolveOdds, BUCKET_LABELS } = await import(
  "@/lib/roulette-odds"
);

afterEach(cleanup);

describe("a losing spin", () => {
  it("has a block of its own, so the screen is never blank", () => {
    render(
      <ResultDialog
        result={{ ok: true, won: false, spinId: "spin_1", prize: null }}
        onClose={() => {}}
        onImport={async () => ({})}
      />,
    );
    expect(screen.getByText("حظ أوفر")).toBeTruthy();
    expect(screen.getByText(/لم تربح هذه المرة/)).toBeTruthy();
  });

  it("offers a way out, rather than leaving the member stuck on the result", () => {
    render(
      <ResultDialog
        result={{ ok: true, won: false, spinId: "spin_1", prize: null }}
        onClose={() => {}}
        onImport={async () => ({})}
      />,
    );
    expect(screen.getByRole("button", { name: "حسنًا" })).toBeTruthy();
  });

  it("never offers an import button for a spin that won nothing", () => {
    /*
      There is no prize to import, and a button that would create an order for
      nothing is worse than no button: it invites a press that can only fail.
    */
    render(
      <ResultDialog
        result={{ ok: true, won: false, spinId: "spin_1", prize: null }}
        onClose={() => {}}
        onImport={async () => ({})}
      />,
    );
    expect(screen.queryByRole("button", { name: /استيراد/ })).toBeNull();
  });
});

describe("a winning spin", () => {
  const prize = {
    id: "przw_1",
    spinId: "spin_2",
    productId: "prd_1",
    productTitle: "Celeste",
    productImage: null,
    productPrice: 9_000,
    bucket: "low_cheap",
    status: "available" as const,
    wonAt: "2026-09-23T00:00:00.000Z",
    claimedAt: null,
    orderId: null,
    threadId: null,
  };

  it("names the game and says where it has gone", () => {
    render(
      <ResultDialog
        result={{ ok: true, won: true, spinId: "spin_2", prize }}
        onClose={() => {}}
        onImport={async () => ({})}
      />,
    );
    /*
      Twice on purpose, and `getAllByText` says so: with no square picture the
      tile prints the name, and the line under it names the game as well. A
      `getByText` here would fail on the correct behaviour.
    */
    expect(screen.getAllByText("Celeste").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/أُضيفت إلى ألعابك القابلة للاستيراد/)).toBeTruthy();
  });

  it("prints the name when there is no square picture, rather than another game's", () => {
    render(
      <ResultDialog
        result={{ ok: true, won: true, spinId: "spin_2", prize }}
        onClose={() => {}}
        onImport={async () => ({})}
      />,
    );
    expect(document.querySelector("img")).toBeNull();
  });

  it("offers both «استيراد» and «لاحقًا», because a win is not an order yet", () => {
    render(
      <ResultDialog
        result={{ ok: true, won: true, spinId: "spin_2", prize }}
        onClose={() => {}}
        onImport={async () => ({})}
      />,
    );
    expect(screen.getByRole("button", { name: /استيراد اللعبة/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "لاحقًا" })).toBeTruthy();
  });
});

describe("the odds list", () => {
  it("keeps a row that has a chance but no games", () => {
    /*
      «حظ أوفر» has no games by definition, and it is the row a member most
      needs. Every bucket is returned whatever its population, so no filter
      downstream can drop the one that matters.
    */
    const rows = oddsRows(oddsForTickets(1));
    expect(rows).toHaveLength(7);
    const losing = rows.find((row) => row.key === "lose");
    expect(losing?.games).toBe(0);
    expect(losing?.percent).toBeCloseTo(75, 6);
  });

  it("adds to one hundred, so there is no gap to explain", () => {
    const total = oddsRows(oddsForTickets(5)).reduce((sum, row) => sum + row.percent, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it("does not call the losing segment a number of dinars", () => {
    // It is a chance, and its label says so. «حظ أوفر دينار» was the old bug.
    expect(BUCKET_LABELS.lose).toBe("حظ أوفر");
    for (const row of oddsRows(oddsForTickets(1))) {
      expect(row.label).not.toContain("دينار");
    }
  });

  it("is keyed by a stable key, not by a label an admin can rename", () => {
    /*
      The old page keyed rows by `${index}-${label}` because an admin could
      edit a band's name. The buckets are no longer nameable: each row carries
      the engine's own key, and the label is only what is printed.
    */
    const keys = oddsRows(oddsForTickets(1)).map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("lose");
    expect(keys).toContain("high_premium");
  });

  it("puts losing first, so it cannot be buried under six prizes", () => {
    expect(oddsRows(oddsForTickets(1))[0]?.key).toBe("lose");
  });

  it("shows a bucket that has emptied as zero rather than hiding the row", () => {
    const population = {
      low_cheap: 10,
      medium_cheap: 0,
      high_cheap: 0,
      low_premium: 4,
      medium_premium: 0,
      high_premium: 0,
    };
    const rows = oddsRows(resolveOdds(3, population).probabilities, population);
    expect(rows).toHaveLength(7);
    expect(rows.find((row) => row.key === "high_premium")?.percent).toBe(0);
    expect(rows.reduce((sum, row) => sum + row.percent, 0)).toBeCloseTo(100, 6);
  });
});
