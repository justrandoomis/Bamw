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
