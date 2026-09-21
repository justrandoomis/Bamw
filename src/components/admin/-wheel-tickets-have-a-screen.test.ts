/**
 * The wheel's two admin controls, and the reason they were missing.
 *
 * `set_ticket_offer` and `grant_wheel_tickets` were built on the server and
 * reachable by nothing. The owner asked for tickets bought with bananas «أو
 * تعطى عن طريق الأدمن للمستخدمين», and both halves of that answered only to a
 * hand-written POST — so the feature shipped complete and unusable, and the
 * one remaining step was a SQL statement the shop's owner was expected to run.
 *
 * What is pinned here is the wiring, because it is the kind that rots quietly:
 * a screen that stops sending one of two writes still renders perfectly.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
/*
  Comments are stripped before every assertion. Twice now a test in this
  repository has passed or failed on prose in a comment that happened to
  contain the string it was looking for.
*/
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

const VIEW = "src/components/admin/BananaManagementView.tsx";
const SERVER = "src/lib/banana.server.ts";
const API = "src/lib/api.ts";
const ROUTE = "src/routes/api/admin/banana.ts";

describe("the banana screen can reach both ticket actions", () => {
  it("sends the ticket count when a reward is saved", () => {
    expect(code(VIEW)).toContain("setBananaRewardTickets");
  });

  it("can hand a member tickets directly", () => {
    expect(code(VIEW)).toContain("grantWheelTickets");
  });

  it("both helpers post the actions the route actually branches on", () => {
    const api = code(API);
    const route = code(ROUTE);
    for (const action of ["set_ticket_offer", "grant_wheel_tickets"]) {
      expect(api).toContain(action);
      expect(route).toContain(action);
    }
  });
});

describe("saving a reward cannot silently un-make a ticket offer", () => {
  it("writes the ticket count only when it changed", () => {
    /*
      0 removes the offer from the wheel. A screen that sent the form's value
      unconditionally would send 0 for any reward whose card was rendered
      before the server learned to return `ticketQuantity` — which is exactly
      what happens for the minutes between a deploy and a reload.
    */
    const view = code(VIEW);
    expect(view).toMatch(/after\s*!==\s*before/);
    expect(view).toMatch(/if\s*\(offerId\s*&&\s*after\s*!==\s*before\)/);
  });

  it("reads the number it is comparing against from the server", () => {
    expect(code(SERVER)).toContain("ticketQuantity");
    expect(code(SERVER)).toContain("ticketOfferIds");
  });
});

describe("a hand-out that is pressed twice", () => {
  it("carries a reference, so the ledger can refuse the second one", () => {
    /*
      `wheel_ticket_ledger` has a unique index on `reference_id`. Without a
      reference every press is a fresh grant, and a double-click is two
      tickets given away.
    */
    expect(code(VIEW)).toContain("referenceId");
  });
});
