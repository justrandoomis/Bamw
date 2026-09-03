/**
 * @vitest-environment node
 */
/**
 * The four `/bind_*` commands, and the reply that reaches a customer.
 *
 * Setup is four messages sent from inside the four topics, because the update
 * already carries `chat.id` and `message_thread_id` — the two numbers Telegram
 * never shows anyone, from the one place they cannot be wrong.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { bindingCommand, bindingsComplete } from "./telegram-bindings.server";
import { bindingsAcceptCommands } from "./telegram-binding-commands.server";
import { replyText } from "./telegram-support-reply.server";

vi.mock("./env.server", () => ({
  env: () => "",
  getEnv: () => ({}),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

import type { BindingKind, TopicBinding } from "./telegram-bindings.server";

const binding = (kind: BindingKind, chatId: string): TopicBinding => ({
  kind,
  chatId,
  messageThreadId: 1,
  boundBy: "1",
  boundAt: "2026-09-03T00:00:00.000Z",
});

beforeEach(() => vi.resetModules());

describe("bindingCommand", () => {
  it("recognises the four, and maps /bind_chat to support", () => {
    expect(bindingCommand("/bind_wallet")).toBe("wallet");
    expect(bindingCommand("/bind_general")).toBe("general");
    expect(bindingCommand("/bind_order")).toBe("order");
    /* The tab is called Chat; the traffic is support. */
    expect(bindingCommand("/bind_chat")).toBe("support");
  });

  it("allows the @BotName suffix Telegram appends in groups", () => {
    expect(bindingCommand("/bind_wallet@BanantoBot")).toBe("wallet");
  });

  it("refuses anything that merely starts the same way", () => {
    /* `/bind_walletx` is not `/bind_wallet`, and a sentence about it is not a
       command either. */
    expect(bindingCommand("/bind_walletx")).toBeNull();
    expect(bindingCommand("/bind_wallet please")).toBeNull();
    expect(bindingCommand("use /bind_wallet here")).toBeNull();
    expect(bindingCommand("")).toBeNull();
    expect(bindingCommand(undefined)).toBeNull();
  });
});

describe("when setup counts as finished", () => {
  const all = (chat: string) =>
    new Map<BindingKind, TopicBinding>([
      ["wallet", binding("wallet", chat)],
      ["general", binding("general", chat)],
      ["support", binding("support", chat)],
      ["order", binding("order", chat)],
    ]);

  it("needs all four", () => {
    const three = all("-1001");
    three.delete("order");
    expect(bindingsComplete(three)).toBe(false);
    expect(bindingsComplete(all("-1001"))).toBe(true);
  });

  it("needs all four in the same chat", () => {
    /*
      Four topics across two chats is a half-finished setup that would otherwise
      look complete and send half the notifications somewhere nobody reads.
    */
    const split = all("-1001");
    split.set("order", binding("order", "-1002"));
    expect(bindingsComplete(split)).toBe(false);
  });

  it("closes the commands once it is finished, and not before", () => {
    const three = all("-1001");
    three.delete("order");
    expect(bindingsAcceptCommands(three)).toBe(true);
    expect(bindingsAcceptCommands(all("-1001"))).toBe(false);
  });
});

describe("handleBindingCommand", () => {
  const ADMIN = "6404042791";
  const STRANGER = "999888777";

  async function load() {
    const bound: unknown[] = [];
    const sent: unknown[] = [];
    vi.doMock("./d1.server", () => ({
      d1All: async () => [],
      d1First: async () => undefined,
      d1Run: async (...args: unknown[]) => {
        bound.push(args);
      },
    }));
    vi.doMock("./telegram.server", () => ({
      sendTelegramMessage: async (...args: unknown[]) => {
        sent.push(args);
        return { ok: true };
      },
    }));
    const mod = await import("./telegram-binding-commands.server");
    return { mod, bound, sent };
  }

  it("records the chat and the topic the command was sent in", async () => {
    const { mod, bound, sent } = await load();
    const out = await mod.handleBindingCommand({
      text: "/bind_wallet",
      chat: { id: "-1002233", type: "supergroup" },
      from: { id: ADMIN },
      message_thread_id: 42,
    });

    expect(out).toEqual({ handled: true, reason: "bound" });
    /* The chat id and the thread id, taken from the update rather than typed. */
    expect(JSON.stringify(bound)).toContain("-1002233");
    expect(JSON.stringify(bound)).toContain("42");
    expect(sent).toHaveLength(1);
  });

  it("ignores a member entirely, without a word", async () => {
    /*
      Not an error and not a refusal: the commands leave no trace for anyone
      they do not belong to, so a member cannot discover that they exist.
    */
    const { mod, bound, sent } = await load();
    const out = await mod.handleBindingCommand({
      text: "/bind_wallet",
      chat: { id: "-1002233", type: "supergroup" },
      from: { id: STRANGER },
      message_thread_id: 42,
    });

    expect(out.reason).toBe("not_an_admin");
    expect(bound).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("refuses in a private chat, where there is no topic to bind", async () => {
    const { mod, bound } = await load();
    const out = await mod.handleBindingCommand({
      text: "/bind_order",
      chat: { id: ADMIN, type: "private" },
      from: { id: ADMIN },
    });
    expect(out.reason).toBe("not_a_group");
    expect(bound).toHaveLength(0);
  });

  it("is not a binding command at all when the text is something else", async () => {
    const { mod } = await load();
    const out = await mod.handleBindingCommand({
      text: "morning all",
      chat: { id: "-1002233", type: "supergroup" },
      from: { id: ADMIN },
    });
    expect(out).toEqual({ handled: false, reason: "not_a_command" });
  });
});

describe("replyText", () => {
  it("takes the text, or the caption of an attachment", () => {
    expect(replyText({ text: " done " })).toBe("done");
    expect(replyText({ caption: "here you go" })).toBe("here you go");
    expect(replyText({ text: "", caption: "fallback" })).toBe("fallback");
    expect(replyText({})).toBe("");
  });
});
