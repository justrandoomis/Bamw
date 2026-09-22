/**
 * «واجعل التحكم بالنسب والتقسيمات تكون من الإدارة بحيث يستطيع تحديد النسب
 * يدويا ... أجعل سعر التذكرة تحدد أيضا يدويا من الإدارة».
 *
 * The bands, the losing chance and the ticket price were all editable through
 * the API before this, and that is not what was asked for. A control the owner
 * cannot reach is not a control — the same gap that left `set_ticket_offer`
 * and `grant_wheel_tickets` callable with no button anywhere in the panel.
 *
 * Source assertions, read with the whitespace collapsed, because a formatter
 * rewrapping a line is not a regression.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

const PANEL = readFileSync("src/components/admin/BananaManagementView.tsx", "utf8");
const TIGHT = PANEL.replace(/\s+/g, "");
const API = readFileSync("src/lib/api.ts", "utf8").replace(/\s+/g, "");

describe("the owner can reach the wheel", () => {
  it("has a tab of its own", () => {
    expect(TIGHT).toContain('setActiveTab("wheel")');
    expect(PANEL).toContain("عجلة الحظ — النسب وسعر التذكرة");
  });

  it("offers a field for every number the owner asked to set", () => {
    expect(PANEL).toContain("سعر التذكرة الواحدة");
    expect(PANEL).toContain("نسبة «حظ أوفر»");
    expect(PANEL).toContain("فئات الأسعار وأوزانها");
  });

  it("shows the percentage each weight actually produces", () => {
    /*
      «يستطيع تحديد النسب يدويا» — and a weight is not a percentage. The screen
      offered three weight boxes and no percentage anywhere, so the owner could
      type a number and had no way to learn what it meant short of saving it
      and opening the member's page.

      Computed with the wheel's own two functions rather than a formula written
      here, so the owner reads the percentages `/api/wheel` will serve.
    */
    expect(TIGHT).toContain("oddsBreakdown(odds,tierCounts(wheelForm.tiers,prices))");
    expect(TIGHT).toContain('["wheelPoolPrices"]');
    expect(PANEL).toContain("من الدورات");
    expect(PANEL).toContain("النتيجة على");
  });

  it("says outright whether «حظ أوفر» beats the cheapest band", () => {
    /*
      The one comparison the owner asked for by name — «تكون النسبة أعلى من
      اللعبه ذات الخمسة آلاف» — stated on the screen rather than left to be
      worked out from two numbers in different places.
    */
    expect(TIGHT).toContain("wheelPreview.losing.chance>wheelPreview.byTier[0].chance");
    expect(PANEL).toContain("أعلى من");
    expect(PANEL).toContain("ما زالت أقل من");
  });
});

describe("the percentages the owner will read", () => {
  it("are the ones a member reads, trap and all", async () => {
    /*
      The trap, as arithmetic rather than as a warning. A weight is PER GAME,
      so the cheapest band's 100 across 984 games is 98,400 of the pool while
      «حظ أوفر» typed as a weight of 120 would be 120 — about a thousandth.
      This is why the losing chance is a percentage and the bands are shown
      with theirs.
    */
    const { oddsBreakdown, tierCounts, LOSING_LABEL } = await import("@/lib/wheel-odds");
    const tiers = [
      { upTo: 5_000, weight: 100, label: "≤ 5,000" },
      { upTo: 10_000, weight: 30, label: "5,001 – 10,000" },
      { upTo: null, weight: 8, label: "> 10,000" },
    ];
    const prices = [
      ...Array.from({ length: 984 }, () => 5_000),
      ...Array.from({ length: 538 }, () => 9_000),
      ...Array.from({ length: 178 }, () => 15_000),
    ];
    const counts = tierCounts(tiers, prices);
    expect(counts).toEqual([984, 538, 178]);

    const rows = oddsBreakdown({ tiers, losingPercent: 50, ticketPriceBananas: 0 }, counts);
    const losing = rows.find((row) => row.label === LOSING_LABEL);
    if (!losing) throw new Error("«حظ أوفر» is missing from the breakdown");
    // Half the wheel, exactly as typed — not a weight competing with 98,400.
    expect(losing.chance).toBeCloseTo(0.5, 6);
    // And the cheapest band keeps its share of the other half.
    expect(rows[0].chance).toBeGreaterThan(0.4);
    expect(losing.chance).toBeGreaterThan(rows[0].chance);
    // Nothing is unaccounted for.
    expect(rows.reduce((sum, row) => sum + row.chance, 0)).toBeCloseTo(1, 6);
  });

  it("saves through the validated action, not a bespoke one", () => {
    expect(API).toContain('action:"save_wheel_odds"');
    expect(TIGHT).toContain("saveWheelOddsMutation.mutate(wheelForm)");
  });
});

describe("what the screen will not do", () => {
  it("does not seed the form from a local default", () => {
    /*
      The market form's own defaults taught this: pressing save before the GET
      resolves writes the component's guesses over the shop's real numbers. The
      wheel form starts null and renders nothing until the server answers.
    */
    expect(TIGHT).toContain("useState<{");
    expect(TIGHT).toContain("|null>(null);");
    expect(TIGHT).toContain("{!wheelForm?(");
  });

  it("does not overwrite an admin mid-edit on a refetch", () => {
    expect(TIGHT).toContain("if(odds&&!wheelForm)");
  });

  it("shows the server's own refusal rather than a generic failure", () => {
    /*
      Every refusal names which number is wrong — «حدود الفئات يجب أن تكون
      تصاعدية» — and replacing that with "failed" throws away the only thing
      that tells the owner what to change.
    */
    expect(TIGHT).toContain("setWheelError(");
    expect(TIGHT).toContain("{wheelError&&(");
  });

  it("says plainly that a ticket price of zero is not for sale", () => {
    expect(PANEL).toContain("صفر يعني أن التذاكر غير معروضة للبيع");
  });

  it("explains that a weight is per game, not per band", () => {
    /*
      The trap the whole design exists around: the chance of a band is its
      weight times the number of games in it, so a weight that looks like a
      percentage is nothing of the kind.
    */
    expect(PANEL).toContain("فرصة الفئة = وزنها ×");
  });
});
