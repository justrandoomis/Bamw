/**
 * Completion has one owner, and two doors had been left open beside it.
 *
 * Neither produced an error, a log line, or a failing test. Both were edits
 * that changed which code runs without changing what the file looks like it
 * says, which is the hardest kind of defect to see by reading.
 *
 * ## The unconditional completion
 *
 * `src/routes/api/orders.ts` ran `completeOrder` with no `if` around it and
 * returned. It belonged to no action: `confirm_received` above returns on both
 * of its branches, so the block could only ever be reached by something else —
 * and then it completed *that* order and returned, making every handler below
 * it unreachable.
 *
 * So a customer pressing "the code does not work" — `report_delivery_issue`,
 * which `ChatView` really does send — closed their own order as completed
 * instead of opening an issue. `claim` and `complete` did nothing for staff.
 * An admin changing a status completed the order instead, skipping
 * `canTransition` and the digital-order guard. The address write never ran.
 *
 * ## The comment that never closed
 *
 * In `admin.orders.ts`, a `/*` opened to delete an old inline completion
 * swallowed the guard that refuses to finish a digital order by hand, and did
 * not close for fifty lines. `completeOrder` does not check delivery state, so
 * nothing replaced it: an admin could close an order whose OTPs had not all
 * gone out, and the customer lost both the items still owed and the window to
 * report a bad one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const orders = readFileSync(resolve(process.cwd(), "src/routes/api/orders.ts"), "utf8");
const adminOrders = readFileSync(resolve(process.cwd(), "src/routes/api/admin.orders.ts"), "utf8");

/** Source with block comments removed — prose about the bug is not the bug. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("the member order route", () => {
  it("never calls completeOrder — completion is not its door", () => {
    /*
      The member's confirmation goes through `confirmDeliveredOrder`, which
      owns the claim and calls completion itself. A second call here is what
      made every handler below unreachable.
    */
    expect(code(orders)).not.toMatch(/\bawait completeOrder\(/);
  });

  it("still reaches the handler a customer uses to report a bad code", () => {
    const body = code(orders);
    const issue = body.indexOf('data.action === "report_delivery_issue"');
    expect(issue).toBeGreaterThan(-1);
    /*
      No statement at the handler level — ten spaces of indent, the depth the
      `if (data.action === ...)` chain sits at — returns before reaching it.
      Returns *inside* an earlier handler are indented further and are exactly
      how that chain is supposed to work.
    */
    const confirmStart = body.indexOf('data.action === "confirm_received"');
    const between = body.slice(confirmStart, issue);
    expect(between).not.toMatch(/^ {10}return json\(/m);
    expect(between).not.toMatch(/^ {10}const \w+ = await /m);
  });

  it("still reaches the staff actions and the admin status change", () => {
    const body = code(orders);
    for (const marker of [
      'data.action === "claim"',
      'data.action === "complete"',
      "canTransition(",
      "digital_orders_complete_only_after_customer_confirmation_or_server_timeout",
    ]) {
      expect(body, marker).toContain(marker);
    }
  });
});

describe("the admin complete_order action", () => {
  it("refuses a digital order that still owes the customer items", () => {
    const body = code(adminOrders);
    const guard = body.indexOf("لا يمكن إكمال طلب رقمي يدويًا");
    expect(guard).toBeGreaterThan(-1);
    /*
      Live code, not text inside a comment. `code()` has stripped every block
      comment, so finding it at all is the assertion.
    */
    expect(body).toContain("delivery.progress.total > 0");
  });

  it("runs that guard before completing, not after", () => {
    const body = code(adminOrders);
    const caseStart = body.indexOf('case "complete_order"');
    const section = body.slice(caseStart, caseStart + 2000);
    expect(section.indexOf("delivery.progress.total > 0")).toBeLessThan(
      section.indexOf("await completeOrder("),
    );
  });
});

describe("the delivery issue the customer can now open", () => {
  const delivery = readFileSync(
    resolve(process.cwd(), "src/lib/order-delivery-items.server.ts"),
    "utf8",
  );

  it("reaches an admin", () => {
    /*
      `openDeliveryIssue` stops the auto-complete clock, escalates the thread
      and sets `needsAdmin` — and told nobody. That was academic while the
      route reaching it was unreachable. Now that it is reachable, an order
      sitting in `delivery_issue` with the timer stopped is exactly the state
      that waits for a person and would otherwise wait forever.
    */
    const fn = delivery.slice(
      delivery.indexOf("export async function openDeliveryIssue"),
      delivery.indexOf("export async function maybeAutoCompleteDeliveredOrder"),
    );
    expect(fn).toContain('sendAdminNotification(\n      "order"');
  });

  it("scrubs the reason the customer typed", () => {
    const fn = delivery.slice(
      delivery.indexOf("export async function openDeliveryIssue"),
      delivery.indexOf("export async function maybeAutoCompleteDeliveredOrder"),
    );
    expect(fn).toContain("redactSecrets(reason)");
  });

  it("cannot undo the report by failing", () => {
    const fn = delivery.slice(
      delivery.indexOf("export async function openDeliveryIssue"),
      delivery.indexOf("export async function maybeAutoCompleteDeliveredOrder"),
    );
    // After the record is written, and swallowing its own failure.
    expect(fn.indexOf("INSERT INTO order_delivery_issues")).toBeLessThan(
      fn.indexOf("sendAdminNotification"),
    );
    expect(fn).toContain("issue_notify_failed");
  });
});

describe("every block comment in both routes closes", () => {
  /*
    The generalisation of the second bug. An unterminated `/*` does not fail to
    compile — it silently eats whatever follows until the next `*␘/`, and both
    files are large enough that nobody notices which fifty lines went quiet.
  */
  it.each([
    ["orders.ts", orders],
    ["admin.orders.ts", adminOrders],
  ])("%s has balanced comment delimiters", (_name, text) => {
    const opens = (text.match(/\/\*/g) ?? []).length;
    const closes = (text.match(/\*\//g) ?? []).length;
    expect(opens).toBe(closes);
  });
});
