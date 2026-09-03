/**
 * @vitest-environment node
 */
/**
 * `/selftest` — the test that does not cost four rows of damage.
 *
 * The honest way to check that a top-up notification reaches the Wallet topic
 * is to make a top-up. That changes a balance to test a routing table, and the
 * same goes for an order and for a customer's conversation. This command sends
 * one labelled message per kind through the same function real notifications
 * use, and touches nothing else.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { isSelfTestCommand } from "./telegram-selftest.server";

const ADMIN = "6404042791";
const STRANGER = "999888777";

beforeEach(() => vi.resetModules());

describe("isSelfTestCommand", () => {
  it("takes the command, with or without the bot suffix", () => {
    expect(isSelfTestCommand("/selftest")).toBe(true);
    expect(isSelfTestCommand("  /selftest  ")).toBe(true);
    expect(isSelfTestCommand("/selftest@Bananto_store_bot")).toBe(true);
  });

  it("refuses anything that merely starts the same way", () => {
    expect(isSelfTestCommand("/selftesting")).toBe(false);
    expect(isSelfTestCommand("/selftest now")).toBe(false);
    expect(isSelfTestCommand("run /selftest")).toBe(false);
    expect(isSelfTestCommand("")).toBe(false);
    expect(isSelfTestCommand(undefined)).toBe(false);
  });
});

async function load(adminIds: string[] = [ADMIN]) {
  const notified: { kind: string; text: string }[] = [];
  const sent: unknown[][] = [];
  vi.doMock("./telegram-admin.server", () => ({
    isTelegramAdmin: (id: unknown) => adminIds.includes(String(id)),
  }));
  vi.doMock("./telegram-notifications.server", () => ({
    sendAdminNotification: async (kind: string, text: string) => {
      notified.push({ kind, text });
      return { ok: true, chatId: "-1001", messageId: notified.length };
    },
  }));
  vi.doMock("./telegram.server", () => ({
    sendTelegramMessage: async (...args: unknown[]) => {
      sent.push(args);
      return { ok: true };
    },
  }));
  const mod = await import("./telegram-selftest.server");
  return { mod, notified, sent };
}

describe("handleSelfTestCommand", () => {
  const group = { id: "-1002233", type: "supergroup" };

  it("sends one notification per kind, through the real routing", async () => {
    /*
      Four kinds, and each one goes through `sendAdminNotification` — the same
      call an order or a top-up makes. A test that sent its own messages by
      another path would prove that path works and nothing about this one.
    */
    const { mod, notified, sent } = await load();
    const out = await mod.handleSelfTestCommand({
      text: "/selftest",
      chat: group,
      from: { id: ADMIN },
      message_thread_id: 7,
    });

    expect(out).toMatchObject({ handled: true, reason: "sent" });
    expect(notified.map((n) => n.kind)).toEqual(["wallet", "general", "support", "order"]);
    /* Plainly labelled, so nobody reads one as a real request. */
    for (const note of notified) expect(note.text).toContain("رسالة اختبار");
    /* And a summary back in the topic the command came from. */
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain("7");
  });

  it("ignores a member entirely, without a word", async () => {
    const { mod, notified, sent } = await load();
    const out = await mod.handleSelfTestCommand({
      text: "/selftest",
      chat: group,
      from: { id: STRANGER },
    });
    expect(out.reason).toBe("not_an_admin");
    expect(notified).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("refuses in a private chat", async () => {
    const { mod, notified } = await load();
    const out = await mod.handleSelfTestCommand({
      text: "/selftest",
      chat: { id: ADMIN, type: "private" },
      from: { id: ADMIN },
    });
    expect(out.reason).toBe("not_a_group");
    expect(notified).toHaveLength(0);
  });

  it("is not this command at all when the text is something else", async () => {
    const { mod } = await load();
    const out = await mod.handleSelfTestCommand({
      text: "morning all",
      chat: group,
      from: { id: ADMIN },
    });
    expect(out).toEqual({ handled: false, reason: "not_a_command" });
  });

  it("reports the kinds that failed rather than claiming success", async () => {
    /* A topic bound to a thread that no longer exists fails at Telegram, and
       the summary has to show it — a silent tick is how a wrong binding
       survives to misroute a real top-up. */
    vi.resetModules();
    vi.doMock("./telegram-admin.server", () => ({ isTelegramAdmin: () => true }));
    vi.doMock("./telegram-notifications.server", () => ({
      sendAdminNotification: async (kind: string) => ({ ok: kind !== "order" }),
    }));
    const sent: unknown[][] = [];
    vi.doMock("./telegram.server", () => ({
      sendTelegramMessage: async (...args: unknown[]) => {
        sent.push(args);
        return { ok: true };
      },
    }));
    const mod = await import("./telegram-selftest.server");

    const out = await mod.handleSelfTestCommand({
      text: "/selftest",
      chat: group,
      from: { id: ADMIN },
    });

    expect(out.delivered).toEqual(["wallet", "general", "support"]);
    expect(String(sent[0]?.[1])).toContain("❌ Order");
    expect(String(sent[0]?.[1])).toContain("✅ Wallet");
  });
});
