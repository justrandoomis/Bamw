/**
 * @vitest-environment node
 *
 * «عندما يطلب المستخدم طلباً والتلي غير مفعّل، يكون هنالك تنبيه بأن التليجرام
 * غير مفعّل»
 *
 * The alert after an order asks `/api/telegram` whether the shop's Telegram
 * messages reach the member. `linked` could not answer that: it is only the
 * row this account's own unlink removes, and a member whose link is filed
 * under their phone is reached all the same — order updates and support
 * replies are sent through `getUserTelegramChatId`, which finds them. Told
 * "Telegram is off" on every order while their notifications arrive, they
 * would rightly stop believing the shop. So `reachable` is that same lookup.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizePhone } from "@/lib/phone";
import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__TEST_D1__"] = db;

let viewer: { id: string } | undefined = { id: "usr_member" };

vi.mock("@/lib/env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__TEST_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

vi.mock("@/lib/session.server", () => ({
  getSessionUser: vi.fn(async () => viewer),
}));

vi.mock("@/lib/rate-limit.server", () => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const route = await import("./telegram");

type Handler = (ctx: { request: Request }) => Promise<Response>;
const get = () =>
  (route.Route.options.server!.handlers as unknown as { GET: Handler }).GET({
    request: new Request("https://banan.to/api/telegram"),
  });

const PHONE = normalizePhone("07701234567")!;
const stamp = "2026-10-01T12:00:00.000Z";

function link(ownerKey: string, chatId: number, phone: string | null) {
  db.raw
    .prepare(
      `INSERT INTO telegram_links (user_id, telegram_chat_id, telegram_phone, verified, linked_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .run(ownerKey, chatId, phone, stamp, stamp);
}

beforeEach(async () => {
  viewer = { id: "usr_member" };
  db.raw.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, phone TEXT)`);
  db.raw.exec(`DELETE FROM users`);
  db.raw.prepare(`INSERT INTO users (id, phone) VALUES (?, ?)`).run("usr_member", PHONE);
  // The Telegram tables, created the way the route creates them.
  await get();
  db.raw.exec(`DELETE FROM telegram_links`);
});

describe("whether Telegram reaches the member", () => {
  it("says no for a member with no link anywhere — the one the alert is for", async () => {
    const status = await (await get()).json();
    expect(status).toMatchObject({ linked: false, reachable: false });
  });

  it("says yes for a member linked under their account", async () => {
    link("usr_member", 5550001, null);
    const status = await (await get()).json();
    expect(status).toMatchObject({ linked: true, reachable: true });
  });

  it("says yes for a member whose link is filed under their phone, though not `linked`", async () => {
    link(`guest:${PHONE}`, 5550002, PHONE);
    const status = await (await get()).json();
    expect(status).toMatchObject({ linked: false, reachable: true });
  });

  it("does not count someone else's link", async () => {
    link("usr_someone_else", 5550003, normalizePhone("07809876543")!);
    const status = await (await get()).json();
    expect(status).toMatchObject({ linked: false, reachable: false });
  });

  it("answers nothing to a visitor who is not signed in", async () => {
    viewer = undefined;
    expect((await get()).status).toBe(401);
  });
});
