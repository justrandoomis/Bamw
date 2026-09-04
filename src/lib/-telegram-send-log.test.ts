/**
 * A refusal has to survive the request that caused it.
 *
 * The shop owner reported that notifications were not arriving. Everything
 * needed to explain it had been logged and was gone: a Worker's console output
 * lives in a stream nobody was tailing, so the only way to learn why one
 * notification failed was to be watching when the next one did. It took a
 * query against retained observability data to find `BUTTON_TYPE_INVALID`.
 *
 * A failure now leaves a row — and the row says what went wrong without
 * saying who it was about.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const statements: { sql: string; args: unknown[] }[] = [];

vi.mock("./d1.server", () => ({
  d1Run: async (sql: string, ...args: unknown[]) => {
    statements.push({ sql, args });
    return {};
  },
}));

beforeEach(() => {
  statements.length = 0;
  vi.resetModules();
});

describe("a Telegram refusal", () => {
  it("is written down, with what Telegram actually said", async () => {
    const { recordSendFailure } = await import("./telegram-send-log.server");
    await recordSendFailure({
      kind: "wallet",
      route: "group-topic",
      status: 400,
      errorCode: 400,
      description: "Bad Request: BUTTON_TYPE_INVALID",
      now: "2026-09-04T07:16:26.000Z",
    });

    const insert = statements.find((s) => s.sql.includes("INSERT INTO telegram_send_failures"));
    expect(insert).toBeDefined();
    expect(insert?.args).toContain("Bad Request: BUTTON_TYPE_INVALID");
    expect(insert?.args).toContain("wallet");
    expect(insert?.args).toContain(400);
  });

  it("records which destination was chosen, and never its id", async () => {
    const { recordSendFailure } = await import("./telegram-send-log.server");
    await recordSendFailure({ kind: "order", route: "group-topic", description: "x" });

    const insert = statements.find((s) => s.sql.includes("INSERT INTO telegram_send_failures"));
    /*
      "group-topic" answers the only question the table is asked — group, or
      the private chat it falls back to — and it is not derived from a chat id,
      so there is nothing here to turn back into one.
    */
    expect(insert?.args).toContain("group-topic");
    for (const arg of insert?.args ?? []) {
      expect(String(arg ?? "")).not.toMatch(/^-?\d{6,}$/);
    }
  });

  it("keeps the newest hundred rather than growing forever", async () => {
    const { recordSendFailure } = await import("./telegram-send-log.server");
    await recordSendFailure({ kind: "support", description: "x" });

    expect(
      statements.some((s) => s.sql.includes("DELETE FROM telegram_send_failures")),
    ).toBe(true);
  });

  it("never becomes a second failure", async () => {
    vi.doMock("./d1.server", () => ({
      d1Run: async () => {
        throw new Error("D1 is down");
      },
    }));
    const { recordSendFailure } = await import("./telegram-send-log.server");

    await expect(recordSendFailure({ kind: "order", description: "x" })).resolves.toBeUndefined();
  });
});
