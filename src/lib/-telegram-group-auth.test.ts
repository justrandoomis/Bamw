/**
 * @vitest-environment node
 */
/**
 * Who may act in the admin group.
 *
 * `isAdminCallback` used to refuse every press outside a private chat. That was
 * right while the notifications went to a private chat, and becomes a silent
 * outage the moment they go to the group: every "approve" on a wallet top-up
 * answers "هذا الزر لم يعد متاحاً" and no top-up is ever credited again. The
 * first test below fails against that version.
 *
 * The widening is one group and no other, and being in it is still not
 * authority — the presser's own Telegram id has to be an operator's, which is
 * what stops anyone the owner adds to the group from approving payments.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const ADMIN = "6404042791";
const STRANGER = "111222333";
const GROUP = "-1002233445566";
const OTHER_GROUP = "-1009988776655";

vi.mock("@/lib/env.server", () => ({ env: () => "" }));

let auth: typeof import("./telegram-admin.server");

beforeEach(async () => {
  vi.resetModules();
  auth = await import("./telegram-admin.server");
});

const press = (from: string, chat: { id: string; type: string }) => ({
  from: { id: from },
  message: { chat },
});

const say = (from: string, chat: { id: string; type: string }) => ({
  from: { id: from },
  chat,
});

describe("an inline button in the admin group", () => {
  it("is accepted from an operator", () => {
    expect(auth.isAdminCallback(press(ADMIN, { id: GROUP, type: "supergroup" }), GROUP)).toBe(true);
  });

  it("is refused from anyone else in that group", () => {
    /* The whole point of a group is that other people are in it. */
    expect(auth.isAdminCallback(press(STRANGER, { id: GROUP, type: "supergroup" }), GROUP)).toBe(
      false,
    );
  });

  it("is refused in any other group, even from an operator", () => {
    expect(
      auth.isAdminCallback(press(ADMIN, { id: OTHER_GROUP, type: "supergroup" }), GROUP),
    ).toBe(false);
  });

  it("is refused in every group when none is bound yet", () => {
    /* Until the owner binds a group there is no group to trust. */
    expect(auth.isAdminCallback(press(ADMIN, { id: GROUP, type: "supergroup" }))).toBe(false);
    expect(auth.isAdminCallback(press(ADMIN, { id: GROUP, type: "supergroup" }), "")).toBe(false);
  });

  it("still works in the operator's own private chat", () => {
    expect(auth.isAdminCallback(press(ADMIN, { id: ADMIN, type: "private" }), GROUP)).toBe(true);
    expect(auth.isAdminCallback(press(ADMIN, { id: ADMIN, type: "private" }))).toBe(true);
  });

  it("is refused from a bot, whatever id it claims", () => {
    expect(
      auth.isAdminCallback(
        { from: { id: ADMIN, is_bot: true }, message: { chat: { id: GROUP, type: "supergroup" } } },
        GROUP,
      ),
    ).toBe(false);
  });
});

describe("a message in the admin group", () => {
  it("is an operator's when the sender is one and the chat is the bound group", () => {
    expect(auth.isAdminGroupMessage(say(ADMIN, { id: GROUP, type: "supergroup" }), GROUP)).toBe(
      true,
    );
  });

  it("is not an operator's from anyone else", () => {
    expect(auth.isAdminGroupMessage(say(STRANGER, { id: GROUP, type: "supergroup" }), GROUP)).toBe(
      false,
    );
  });

  it("is not an operator's in a private chat", () => {
    /*
      The private rule proves a chat belongs to its sender by `chat.id ===
      from.id`, which is never true in a group. The two rules are separate on
      purpose; `isAdminActor` is what accepts either.
    */
    expect(auth.isAdminGroupMessage(say(ADMIN, { id: ADMIN, type: "private" }), GROUP)).toBe(false);
    expect(auth.isAdminActor(say(ADMIN, { id: ADMIN, type: "private" }), GROUP)).toBe(true);
    expect(auth.isAdminActor(say(ADMIN, { id: GROUP, type: "supergroup" }), GROUP)).toBe(true);
    expect(auth.isAdminActor(say(STRANGER, { id: GROUP, type: "supergroup" }), GROUP)).toBe(false);
  });

  it("refuses a channel post, which has no sender to check", () => {
    expect(auth.isAdminGroupMessage({ chat: { id: GROUP, type: "channel" } }, GROUP)).toBe(false);
  });
});

describe("isAdminGroupChat", () => {
  it("accepts a group and a supergroup, and nothing else", () => {
    expect(auth.isAdminGroupChat({ id: GROUP, type: "supergroup" }, GROUP)).toBe(true);
    expect(auth.isAdminGroupChat({ id: GROUP, type: "group" }, GROUP)).toBe(true);
    expect(auth.isAdminGroupChat({ id: GROUP, type: "channel" }, GROUP)).toBe(false);
    expect(auth.isAdminGroupChat({ id: GROUP, type: "private" }, GROUP)).toBe(false);
    expect(auth.isAdminGroupChat(undefined, GROUP)).toBe(false);
  });

  it("compares the id as written, not loosely", () => {
    expect(auth.isAdminGroupChat({ id: ` ${GROUP} `, type: "supergroup" }, GROUP)).toBe(true);
    expect(auth.isAdminGroupChat({ id: `${GROUP}0`, type: "supergroup" }, GROUP)).toBe(false);
  });
});
