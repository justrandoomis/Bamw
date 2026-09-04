/**
 * Three money events the member was never told about.
 *
 * Each one moves someone's money, and each one told them through no channel at
 * all — not Telegram, in two cases not even an in-app row. The only way to
 * find out was to keep opening the app and looking.
 *
 *  - **A top-up approved or refused.** `approveRechargeRequest` and
 *    `rejectRechargeRequest` contained no notification of any kind. The shop
 *    is told the moment a request arrives; the member who sent the receipt was
 *    never told the verdict.
 *  - **An order cancelled and refunded.** That case returns hundreds of lines
 *    before the handler's notification block, and its own thread message is
 *    `senderRole: "system"`, which the chat's Telegram push ignores — it fires
 *    only for an admin message. So the money simply reappeared in the wallet.
 *  - **A payment receipt rejected.** `set_payment` changes the *payment*
 *    status and leaves the order's own status alone, but the message reported
 *    `statusMap[next.status]` — so a refused receipt was answered with "قيد
 *    التجهيز ⏳", which affirmatively contradicts what just happened. And the
 *    map was missing three real `OrderStatus` values, so the `||` fallback
 *    printed the raw English identifier into an Arabic message.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const db = source("src/lib/db.server.ts");
const adminOrders = source("src/routes/api/admin.orders.ts");

describe("a wallet top-up verdict", () => {
  it("tells the member on approval and on rejection", () => {
    expect(db).toContain('notifyRechargeVerdict(existing.userId, "approved"');
    expect(db).toContain('notifyRechargeVerdict(existing.userId, "rejected"');
  });

  it("states the amount, which can differ from the one requested", () => {
    /*
      A bonus, or a correction the reviewer made. A member seeing a different
      number in their wallet with no explanation is a support ticket.
    */
    const fn = db.slice(db.indexOf("async function notifyRechargeVerdict"), db.indexOf("export async function consumeBananCode"));
    expect(fn).toContain("figure");
    expect(fn).toContain("د.ع");
  });

  it("cannot undo the credit it is announcing", () => {
    /*
      Not awaited by the settling function, and it swallows its own failure:
      the wallet is already credited by the time this runs.
    */
    expect(db).toContain("void notifyRechargeVerdict(");
    const fn = db.slice(db.indexOf("async function notifyRechargeVerdict"), db.indexOf("export async function consumeBananCode"));
    expect(fn).toContain("catch");
    expect(fn).toContain("recharge_verdict_notify_failed");
  });
});

describe("a cancelled and refunded order", () => {
  it("tells the customer, from the case that returns early", () => {
    const block = adminOrders.slice(
      adminOrders.indexOf('case "cancel_order"'),
      adminOrders.indexOf('case "direct_send_credentials"'),
    );
    expect(block).toContain("notifyUserOrderStatus(");
  });

  it("names the refunded amount when the wallet paid for it", () => {
    const block = adminOrders.slice(
      adminOrders.indexOf('case "cancel_order"'),
      adminOrders.indexOf('case "direct_send_credentials"'),
    );
    expect(block).toContain("تمت إعادة");
    expect(block).toContain("wasPaidByWallet");
  });
});

describe("a payment status change", () => {
  it("reports the payment status, not the order's", () => {
    expect(adminOrders).toContain("const paymentMap");
    expect(adminOrders).toContain('data.action === "set_payment"');
    expect(adminOrders).toContain("paymentMap[String(next.paymentStatus)]");
  });

  it("says a receipt was refused, rather than that the order is progressing", () => {
    expect(adminOrders).toContain("لم يتم قبول إثبات الدفع");
  });

  it("covers every order status, so no raw enum can reach a customer", () => {
    const map = adminOrders.slice(
      adminOrders.indexOf("const statusMap: Record<string, string> = {"),
      adminOrders.indexOf("const paymentMap"),
    );
    for (const status of [
      "pending",
      "processing",
      "delivering",
      "awaiting_customer_confirmation",
      "delivery_issue",
      "completed",
      "cancelled",
    ]) {
      expect(map, status).toContain(`${status}:`);
    }
    // And the fallback is a sentence, never the identifier.
    expect(adminOrders).not.toContain("statusMap[next.status] || next.status");
  });

  it("no longer carries a payment status inside the order-status map", () => {
    const map = adminOrders.slice(
      adminOrders.indexOf("const statusMap: Record<string, string> = {"),
      adminOrders.indexOf("const paymentMap"),
    );
    // `paid` is a PaymentStatus; that entry could never have matched.
    expect(map).not.toContain("paid:");
  });
});
