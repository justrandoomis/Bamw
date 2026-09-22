/**
 * What a member sees when the wheel says «حظ أوفر».
 *
 * The page assumed every spin won. A losing spin returns `prize: null`, and
 * the result block was written as `result?.ok && result.prize` — so the member
 * pressed the button, watched their ticket disappear, and was shown an empty
 * screen with no explanation. That is the worst possible way to introduce a
 * losing outcome: it reads as the shop taking a ticket and giving nothing,
 * which is exactly what it is, only silently.
 *
 * The odds list had the mirror of the same problem. It filtered on
 * `games > 0`, and «حظ أوفر» has no games BY DEFINITION — so the one row a
 * member most needs to see was the one row guaranteed to be hidden, and the
 * remaining percentages no longer added to a hundred with nothing on screen to
 * explain the gap. It also appended «دينار» to every label, which would have
 * printed «حظ أوفر دينار».
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

const PAGE = readFileSync("src/routes/wheel.tsx", "utf8");
const TIGHT = PAGE.replace(/\s+/g, "");

describe("a losing spin", () => {
  it("has a block of its own, so the screen is never blank", () => {
    expect(TIGHT).toContain("result?.ok&&!result.prize?(");
    expect(PAGE).toContain("حظ أوفر في المرة القادمة");
  });

  it("tells the member the ticket was spent", () => {
    expect(PAGE).toContain("التذكرة استُخدمت");
  });
});

describe("the odds list", () => {
  it("keeps a row that has a chance but no games", () => {
    expect(TIGHT).toContain("tier.games>0||tier.chance>0");
  });

  it("does not call the losing segment a number of dinars", () => {
    expect(TIGHT).toContain('isPrice?`${tr("دينار")}`');
  });

  it("is keyed by position, not by a label an admin can rename", () => {
    expect(TIGHT).toContain("key={`${index}-${tier.label}`}");
  });
});

describe("buying a ticket", () => {
  it("asks for a quantity and never sends a price", () => {
    /*
      The price is the server's. A body carrying one would be a body deciding
      what a ticket costs.
    */
    expect(TIGHT).toContain('action:"buy_ticket"');
    expect(TIGHT).not.toContain("ticketPriceBananas:ticketPrice");
  });

  it("offers the button only when the owner has set a price", () => {
    /*
      Zero is not a free ticket — it means tickets are not on sale — so the
      button is withheld rather than offered and refused.
    */
    expect(TIGHT).toContain("ticketPrice>0?(");
  });

  it("shows the server's refusal rather than swallowing it", () => {
    expect(TIGHT).toContain("buy.isError?(");
  });
});
