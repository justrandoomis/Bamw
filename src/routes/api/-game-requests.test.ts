/**
 * @vitest-environment node
 */
/**
 * A game request, end to end: the real POST handler writes it, the real GET
 * handler reads it back, the real PATCH handler moves it — all against a real
 * SQLite database created by the application's own schema.
 *
 * The admin screen showed no game name, "Invalid Date" and "-" for the contact
 * method. Nothing was wrong with the screen: the handler ran `SELECT *` over
 * snake_case columns and returned the rows cast as the camelCase object every
 * reader expects, so `productName`, `createdAt` and `contactMethod` were all
 * `undefined` while `platform`, `notes` and `status` came through — those
 * column names happen to be one word.
 *
 * The schema here is built by `ensureSchema()` rather than by hand, so if a
 * column is ever renamed this fails instead of quietly returning blanks again.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

/*
  One database for the file. `ensureSchema()` memoises its work per module, so
  a fresh database per test would only ever get the schema once and every later
  test would ask an empty SQLite for a table that was never created.
*/
const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__TEST_D1__"] = db;
let viewer: { id: string; isAdmin: boolean; phone?: string; email?: string };

vi.mock("@/lib/env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__TEST_D1__"] }),
  getBinding: () => undefined,
}));

vi.mock("@/lib/session.server", () => ({
  getSessionUser: vi.fn(async () => viewer),
  requireUser: vi.fn(async () => viewer),
  requireAdmin: vi.fn(async () => viewer),
}));

vi.mock("@/lib/rate-limit.server", () => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(),
}));

vi.mock("@/lib/telegram-notifications.server", () => ({
  notifyAdminGameRequest: vi.fn(async () => undefined),
  getUserTelegramChatId: vi.fn(async () => undefined),
}));

const { Route } = await import("./game-requests");

const handlers = Route.options.server!.handlers as unknown as {
  GET: (ctx: { request: Request }) => Promise<Response>;
  POST: (ctx: { request: Request }) => Promise<Response>;
  PATCH: (ctx: { request: Request }) => Promise<Response>;
};

const url = "https://banan.to/api/game-requests";

const post = (payload: Record<string, unknown>) =>
  handlers.POST({
    request: new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  });

const patch = (payload: Record<string, unknown>) =>
  handlers.PATCH({
    request: new Request(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  });

const list = async () => {
  const res = await handlers.GET({ request: new Request(url) });
  expect(res.status).toBe(200);
  return (await res.json()).requests as Record<string, any>[];
};

const submission = {
  productName: "Final Fantasy VII Rebirth",
  requestType: "game",
  platform: "switch2",
  preferredVersion: "standard",
  preferredRegion: "US",
  contactMethod: "+9647700000000",
  notes: "بشرفكم ضيفوها",
};

beforeAll(async () => {
  // The schema the Worker installs, not a hand-written copy: a renamed column
  // has to break this test rather than quietly return blanks again.
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
});

beforeEach(() => {
  db.raw.exec("DELETE FROM product_requests");
  viewer = { id: "usr_9", isAdmin: false, phone: "+9647700000000" };
  vi.clearAllMocks();
});

describe("what the admin's requests screen receives", () => {
  it("carries the game name, the date and the contact method", async () => {
    expect((await post(submission)).status).toBe(200);
    viewer = { id: "usr_admin", isAdmin: true };

    const [request] = await list();

    // The three the screen rendered as blank, "Invalid Date" and "-".
    expect(request!.productName).toBe("Final Fantasy VII Rebirth");
    expect(Number.isNaN(new Date(request!.createdAt).getTime())).toBe(false);
    expect(request!.contactMethod).toBe("+9647700000000");

    // And the rest of what the card draws.
    expect(request!.requestType).toBe("game");
    expect(request!.preferredVersion).toBe("standard");
    expect(request!.preferredRegion).toBe("US");
    expect(request!.userId).toBe("usr_9");
    expect(request!.platform).toBe("switch2");
    expect(request!.notes).toBe("بشرفكم ضيفوها");
    expect(request!.status).toBe("submitted");
  });

  it("sends nothing under a database column name", async () => {
    await post(submission);
    viewer = { id: "usr_admin", isAdmin: true };

    const [request] = await list();
    for (const column of ["product_name", "created_at", "contact_method", "user_id"]) {
      expect(Object.keys(request!)).not.toContain(column);
    }
  });

  it("gives the customer their own request back, with the same fields", async () => {
    await post(submission);

    const [mine] = await list();
    expect(mine!.productName).toBe("Final Fantasy VII Rebirth");
    expect(mine!.statusHistory).toEqual([
      expect.objectContaining({ status: "submitted" }),
    ]);
  });

  it("does not show one customer another customer's request", async () => {
    await post(submission);
    viewer = { id: "usr_other", isAdmin: false };
    expect(await list()).toEqual([]);
  });
});

describe("what the customer is allowed to see", () => {
  it("never receives the staff-only note about their own request", async () => {
    await post(submission);
    viewer = { id: "usr_admin", isAdmin: true };
    const [{ id }] = await list();
    await patch({ id, adminNote: "المورد يطلب 40 ألف — لا تقبل بأقل", userVisibleNote: "قيد المراجعة" });

    viewer = { id: "usr_9", isAdmin: false };
    const [mine] = await list();

    // "ملاحظات إدارية (داخلية فقط)" — supplier pricing and whether the request
    // is worth taking. Mapping the row correctly made this field real, so it
    // has to be dropped on the way out.
    expect(mine!.adminNote).toBeUndefined();
    expect(JSON.stringify(mine)).not.toContain("40 ألف");
    // The reply written for the customer is theirs to read.
    expect(mine!.userVisibleNote).toBe("قيد المراجعة");
    expect(mine!.productName).toBe("Final Fantasy VII Rebirth");
  });

  it("still gives the admin the internal note", async () => {
    await post(submission);
    viewer = { id: "usr_admin", isAdmin: true };
    const [{ id }] = await list();
    await patch({ id, adminNote: "المورد يطلب 40 ألف" });

    const [asAdmin] = await list();
    expect(asAdmin!.adminNote).toBe("المورد يطلب 40 ألف");
  });
});

describe("what an admin action does to the stored request", () => {
  const accept = async (id: string) =>
    patch({
      id,
      status: "accepted",
      userVisibleNote: "تم قبول طلب اللعبة وجارٍ تجهيزها.",
    });

  it("keeps the notes and the linked product an earlier edit set", async () => {
    await post(submission);
    viewer = { id: "usr_admin", isAdmin: true };
    const [{ id }] = await list();

    await patch({ id, adminNote: "المورد يطلب 40 ألف", linkedProductId: "prd_77" });
    // The "قبول الطلب" button sends status + a customer note and nothing else.
    expect((await accept(id)).status).toBe(200);

    const [after] = await list();
    // Both used to be overwritten with NULL, because `existing.adminNote` was
    // read off a raw row and fell through to `|| null`.
    expect(after!.adminNote).toBe("المورد يطلب 40 ألف");
    expect(after!.linkedProductId).toBe("prd_77");
    expect(after!.status).toBe("accepted");
    expect(after!.userVisibleNote).toBe("تم قبول طلب اللعبة وجارٍ تجهيزها.");
  });

  it("appends to the status trail instead of replacing it", async () => {
    await post(submission);
    viewer = { id: "usr_admin", isAdmin: true };
    const [{ id }] = await list();

    await accept(id);
    await patch({ id, status: "added" });

    const [after] = await list();
    // The trail was re-read as "[]" every time and written back over the real
    // one, so the customer's timeline never had more than the newest step.
    expect(after!.statusHistory.map((e: any) => e.status)).toEqual([
      "submitted",
      "accepted",
      "added",
    ]);
    expect(after!.statusHistory[1].note).toBe("تم قبول طلب اللعبة وجارٍ تجهيزها.");
  });

  it("knows which customer to notify", async () => {
    await post(submission);
    viewer = { id: "usr_admin", isAdmin: true };
    const [{ id }] = await list();
    await accept(id);

    const { getUserTelegramChatId } = await import("@/lib/telegram-notifications.server");
    // `existing.userId` was undefined, so the notification block never ran and
    // the customer was never told their request had moved.
    expect(getUserTelegramChatId).toHaveBeenCalledWith("usr_9");
  });

  it("lets an admin clear a note they got wrong", async () => {
    await post(submission);
    viewer = { id: "usr_admin", isAdmin: true };
    const [{ id }] = await list();

    await patch({ id, userVisibleNote: "رسالة خاطئة", adminNote: "ملاحظة" });
    // Present-and-empty means clear. `clean("") || existing.x` could only ever
    // rewrite the old value, so a wrong customer-facing message was permanent.
    await patch({ id, userVisibleNote: "" });

    const [after] = await list();
    expect(after!.userVisibleNote).toBeUndefined();
    // Absent still means "no opinion" — the note the request did not mention.
    expect(after!.adminNote).toBe("ملاحظة");
  });

  it("does not move the trail when the status did not change", async () => {
    await post(submission);
    viewer = { id: "usr_admin", isAdmin: true };
    const [{ id }] = await list();

    await patch({ id, adminNote: "just a note" });

    const [after] = await list();
    expect(after!.statusHistory).toHaveLength(1);
  });
});
