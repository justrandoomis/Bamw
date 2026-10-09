/**
 * @vitest-environment node
 *
 * The two contest routes, through their real handlers and a real database:
 * members see what is published and act only when signed in; only an admin
 * runs a contest; and a contest goes from draft to drawn, with the winner's
 * game in their «ألعابك», entirely through these two doors.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqliteD1, type FakeD1 } from "@/test/sqlite-d1";

const db: FakeD1 = createSqliteD1();
(globalThis as Record<string, unknown>)["__CONTEST_ROUTE_D1__"] = db;

type Viewer = { id: string; name: string; email: string; isAdmin?: boolean; createdAt: string };
let viewer: Viewer | undefined;

vi.mock("@/lib/env.server", () => ({
  env: () => undefined,
  getEnv: () => ({ bananto: (globalThis as Record<string, unknown>)["__CONTEST_ROUTE_D1__"] }),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

vi.mock("@/lib/session.server", () => ({
  getSessionUser: vi.fn(async () => viewer),
  requireUser: vi.fn(async () => {
    if (!viewer) throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    return viewer;
  }),
  requireAdmin: vi.fn(async () => {
    if (!viewer) throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    if (!viewer.isAdmin)
      throw new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    return viewer;
  }),
}));

vi.mock("@/lib/rate-limit.server", () => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0, remaining: 99 })),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

vi.mock("@/lib/telegram-notifications.server", () => ({
  getUserTelegramChatId: async () => undefined,
}));

vi.mock("@/lib/db.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db.server")>();
  return {
    ...actual,
    getStore: async () => ({
      products: [{ id: "mk8", title: "Mario Kart 8 Deluxe", price: 45_000, kind: "game" }],
    }),
  };
});

type Handler = (ctx: { request: Request }) => Promise<Response>;
let member: { GET: Handler; POST: Handler };
let admin: { GET: Handler; POST: Handler };

const call = (handler: Handler, path: string, payload?: Record<string, unknown>) =>
  handler({
    request: new Request(`https://banan.to${path}`, {
      method: payload ? "POST" : "GET",
      ...(payload
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }
        : {}),
    }),
  });

const ADMIN: Viewer = {
  id: "usr_admin",
  name: "Admin",
  email: "a@x.test",
  isAdmin: true,
  createdAt: "2025-01-01T00:00:00.000Z",
};
const ALI: Viewer = {
  id: "usr_ali",
  name: "علي حسن",
  email: "ali@x.test",
  createdAt: "2025-01-01T00:00:00.000Z",
};

beforeAll(async () => {
  const { ensureSchema } = await import("@/lib/d1.server");
  await ensureSchema();
  member = (await import("./contests")).Route.options.server!.handlers as never;
  admin = (await import("./admin/contests")).Route.options.server!.handlers as never;
});

beforeEach(() => {
  viewer = undefined;
  for (const table of [
    "users",
    "contests",
    "contest_entries",
    "contest_winners",
    "roulette_prizes",
  ]) {
    try {
      db.raw.exec(`DELETE FROM ${table}`);
    } catch {
      /* made on first use */
    }
  }
  for (const user of [ADMIN, ALI]) {
    db.raw
      .prepare(`INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)`)
      .run(user.id, user.name, user.email, user.createdAt);
  }
});

describe("who may do what", () => {
  it("lets a visitor look, and asks them to sign in before anything else", async () => {
    const list = await call(member.GET, "/api/contests");
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ contests: [], prizes: [] });
    const refused = await call(member.POST, "/api/contests", {
      action: "enter",
      contestId: "x",
      method: "free",
    });
    expect(refused.status).toBe(401);
  });

  it("keeps every admin action to admins", async () => {
    viewer = ALI;
    expect((await call(admin.GET, "/api/admin/contests")).status).toBe(403);
    expect(
      (await call(admin.POST, "/api/admin/contests", { action: "save", settings: {} })).status,
    ).toBe(403);
  });

  it("refuses an action it does not know", async () => {
    viewer = ADMIN;
    const answer = await call(admin.POST, "/api/admin/contests", { action: "delete_everything" });
    expect(answer.status).toBe(400);
  });
});

describe("a contest through the two routes", () => {
  it("goes from draft to drawn, and the winner finds the game in their games", async () => {
    viewer = ADMIN;
    const saved = await (
      await call(admin.POST, "/api/admin/contests", {
        action: "save",
        settings: {
          title: "مسابقة ماريو",
          productId: "mk8",
          entryMethods: ["free"],
          endsAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      })
    ).json();
    expect(saved.ok).toBe(true);

    // A draft is invisible to members.
    viewer = ALI;
    expect((await (await call(member.GET, "/api/contests")).json()).contests).toHaveLength(0);

    viewer = ADMIN;
    expect(
      (await call(admin.POST, "/api/admin/contests", { action: "publish", contestId: saved.id }))
        .status,
    ).toBe(200);

    viewer = ALI;
    const entered = await call(member.POST, "/api/contests", {
      action: "enter",
      contestId: saved.id,
      method: "free",
    });
    expect(entered.status).toBe(200);
    expect((await entered.json()).contest.mine.tickets).toBe(1);
    // A way in the contest does not offer is refused.
    const wrong = await call(member.POST, "/api/contests", {
      action: "enter",
      contestId: saved.id,
      method: "bananas",
      count: 1,
      requestId: "press-123456",
    });
    expect(wrong.status).toBe(400);

    viewer = ADMIN;
    const detail = await (await call(admin.GET, `/api/admin/contests?id=${saved.id}`)).json();
    expect(detail.stats).toMatchObject({ participants: 1, tickets: 1 });
    const drawn = await call(admin.POST, "/api/admin/contests", {
      action: "draw",
      contestId: saved.id,
    });
    expect(drawn.status).toBe(200);

    viewer = ALI;
    const after = await (await call(member.GET, "/api/contests")).json();
    expect(after.contests[0]).toMatchObject({ phase: "drawn", mine: { won: true } });
    expect(after.contests[0].proof.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(after.prizes[0]).toMatchObject({
      productId: "mk8",
      source: "contest",
      status: "available",
    });
  });
});
