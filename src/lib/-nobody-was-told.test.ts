/**
 * Two moments where the shop was waiting and nothing told it.
 *
 * ## The sign-in proof
 *
 * A member attaching the screenshot that proves they signed in is the step
 * that unblocks the verification code — the shop cannot send the code until it
 * arrives, and the customer is looking at a screen saying it is coming. The
 * proof was posted to the order thread as a message from the *member*, and
 * `appendMessage` pushes to Telegram only for admin-authored messages. So the
 * one action that unblocks the order notified nobody at all.
 *
 * ## The trade button
 *
 * The disc-trade alert carries one button, and it opened `/trade` — a page
 * that has never existed. Pricing a disc meant finding the admin screen by
 * hand and matching the id out of the message.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const delivery = source("src/lib/order-delivery-items.server.ts");
const notifications = source("src/lib/telegram-notifications.server.ts");

describe("a member's sign-in proof", () => {
  const fn = delivery.slice(
    delivery.indexOf("export async function recordDeliveryProof"),
    delivery.indexOf("export async function markDeliveryOtpSent"),
  );

  it("reaches an admin", () => {
    expect(fn).toContain('sendAdminNotification(\n      "order"');
    expect(fn).toContain("وصلت صورة إثبات تسجيل الدخول");
  });

  it("says what the shop owes next", () => {
    expect(fn).toContain("العميل بانتظار رمز التحقق");
  });

  it("names the order without printing the member's account", () => {
    expect(fn).toContain("order.code ?? order.id");
    // Not the proof image, and not any credential from the row.
    expect(fn.slice(fn.indexOf("sendAdminNotification"))).not.toContain("proof_url");
    expect(fn.slice(fn.indexOf("sendAdminNotification"))).not.toContain("input.imageUrl");
  });

  it("cannot undo the proof by failing", () => {
    /*
      The record is written first, and the notification swallows its own
      failure: a Telegram outage must not lose a proof the member has sent.
    */
    expect(fn.indexOf("UPDATE order_delivery_items")).toBeLessThan(
      fn.indexOf("sendAdminNotification"),
    );
    expect(fn).toContain("[delivery:proof_notify_failed]");
  });
});

describe("the disc-trade alert's button", () => {
  it("opens a page that exists", () => {
    const fn = notifications.slice(notifications.indexOf("export async function notifyAdminDiscTrade"));
    expect(fn).toContain("`/disc_trade`");
  });

  it("no longer opens /trade", () => {
    const code = notifications.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain("`/trade`");
  });

  it("points at a route the router really registers", () => {
    const tree = source("src/routeTree.gen.ts");
    expect(tree).toContain("'/disc_trade'");
  });
});
