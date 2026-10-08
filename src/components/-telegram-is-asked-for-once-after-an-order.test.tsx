/**
 * @vitest-environment jsdom
 *
 * «اجعل عندما يطلب المستخدم طلباً والتلي غير مفعّل، يكون هنالك تنبيه بأن
 *  التليجرام غير مفعّل يجب تفعيل التليجرام للتنبيه — يعني ليس إجباراً، يمكن
 *  الضغط على كلمة لاحقاً أو كلمة الإعداد لضبط الإعداد للتليجرام حتى يصل له
 *  الإشعارات»
 *
 * What is held here:
 *
 *   - the alert appears after an order, and only for a member Telegram cannot
 *     reach — not for one it already reaches, and not when the shop could not
 *     tell (a failed read is no reason to say Telegram is off);
 *   - «لاحقاً» closes it and does nothing else: it is not a gate;
 *   - «الإعداد» opens the bot in that same tap, with the link fetched while
 *     the member was reading — a window opened after a network wait is a
 *     popup Safari drops — and inside Telegram's Mini App it goes through
 *     Telegram's own `openTelegramLink`;
 *   - the dialog notices on its own when the link has taken.
 */
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Status = {
  linked: boolean;
  reachable?: boolean;
  telegram_username: null;
  linked_at: null;
  bot_username: string;
};
const status = (reachable: boolean): Status => ({
  linked: reachable,
  reachable,
  telegram_username: null,
  linked_at: null,
  bot_username: "Bananto_store_bot",
});

const telegramStatus = vi.fn(async (): Promise<Status> => status(false));
const telegramLink = vi.fn(async () => ({
  ok: true,
  bot_username: "Bananto_store_bot",
  deep_link: "https://t.me/Bananto_store_bot?start=tok_abc123",
  expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
}));

vi.mock("@/lib/api", () => ({
  api: { telegramStatus: () => telegramStatus(), telegramLink: () => telegramLink() },
}));

const { default: TelegramOrderNudge } = await import("./TelegramOrderNudge");
const { askAboutTelegramAfterOrder, useTelegramNudge } = await import("@/lib/telegramNudge");
const { useI18n } = await import("@/i18n");

/* The dialog waits a moment before asking, and a loaded CI runner is slower still. */
const SLOW = { timeout: 8000 };

/**
 * Until the bot's link is in hand: fetched, resolved, and in state. Waiting
 * only for the call would press «الإعداد» a tick before the link landed.
 */
async function linkReady() {
  await waitFor(() => expect(telegramLink).toHaveBeenCalledTimes(1), SLOW);
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TelegramOrderNudge />
    </QueryClientProvider>,
  );
}

const opened = vi.fn();

beforeEach(() => {
  useI18n.setState({ lang: "ar" });
  useTelegramNudge.setState({ pendingFor: null });
  telegramStatus.mockReset();
  telegramStatus.mockImplementation(async () => status(false));
  telegramLink.mockClear();
  opened.mockReset();
  vi.stubGlobal("open", opened);
  delete (window as { Telegram?: unknown }).Telegram;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  focusManager.setFocused(undefined);
});

describe("after an order", () => {
  it("asks nothing when no order asked", async () => {
    mount();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(telegramStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tells a member Telegram cannot reach that it is off, with «لاحقاً» and «الإعداد»", async () => {
    mount();
    act(() => askAboutTelegramAfterOrder("ord_1"));

    expect(await screen.findByRole("dialog", {}, SLOW)).toBeTruthy();
    expect(screen.getByText("تلغرام غير مفعّل")).toBeTruthy();
    expect(screen.getByRole("button", { name: "الإعداد" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "لاحقاً" })).toBeTruthy();
  });

  it("says nothing to a member Telegram already reaches", async () => {
    telegramStatus.mockImplementation(async () => status(true));
    mount();
    act(() => askAboutTelegramAfterOrder("ord_2"));

    await waitFor(() => expect(useTelegramNudge.getState().pendingFor).toBeNull(), SLOW);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says nothing when it could not tell", async () => {
    telegramStatus.mockImplementation(async () => {
      throw new Error("Unauthorized");
    });
    mount();
    act(() => askAboutTelegramAfterOrder("ord_3"));

    await waitFor(() => expect(useTelegramNudge.getState().pendingFor).toBeNull(), SLOW);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("«لاحقاً» closes it and opens nothing", async () => {
    mount();
    act(() => askAboutTelegramAfterOrder("ord_4"));
    fireEvent.click(await screen.findByRole("button", { name: "لاحقاً" }, SLOW));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opened).not.toHaveBeenCalled();
    expect(useTelegramNudge.getState().pendingFor).toBeNull();
  });

  it("«الإعداد» opens the bot in the same tap, then notices when the link took", async () => {
    mount();
    act(() => askAboutTelegramAfterOrder("ord_5"));
    const setUp = await screen.findByRole("button", { name: "الإعداد" }, SLOW);
    // The link is fetched while the member reads, not after they press.
    await linkReady();

    fireEvent.click(setUp);
    expect(opened).toHaveBeenCalledWith(
      "https://t.me/Bananto_store_bot?start=tok_abc123",
      "_blank",
      "noopener",
    );
    expect(await screen.findByText("بانتظار التفعيل…")).toBeTruthy();
    expect(screen.getByText("اضغط «ابدأ» (Start) في محادثة بوت بنانتو.")).toBeTruthy();

    // The member presses Start in the bot and comes back to the shop.
    telegramStatus.mockImplementation(async () => status(true));
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    expect(await screen.findByText("تم تفعيل تلغرام", {}, SLOW)).toBeTruthy();
    expect(telegramLink).toHaveBeenCalledTimes(1);
  });

  it("goes through Telegram's own opener inside the Mini App", async () => {
    const openTelegramLink = vi.fn();
    (window as { Telegram?: unknown }).Telegram = {
      WebApp: { initData: "query_id=1", openTelegramLink },
    };
    mount();
    act(() => askAboutTelegramAfterOrder("ord_6"));
    const setUp = await screen.findByRole("button", { name: "الإعداد" }, SLOW);
    await linkReady();

    fireEvent.click(setUp);
    expect(openTelegramLink).toHaveBeenCalledWith(
      "https://t.me/Bananto_store_bot?start=tok_abc123",
    );
    expect(opened).not.toHaveBeenCalled();
  });
});

describe("reading the status", () => {
  it("takes `linked` from a server that does not send `reachable` yet", async () => {
    const { telegramNudgeDue } = await import("@/lib/telegramNudge");
    expect(telegramNudgeDue({ linked: false })).toBe(true);
    expect(telegramNudgeDue({ linked: true })).toBe(false);
    expect(telegramNudgeDue({ linked: false, reachable: true })).toBe(false);
    expect(telegramNudgeDue(undefined)).toBe(false);
  });

  it("fetches the bot's link again when it is about to lapse", async () => {
    const { telegramLinkUsable } = await import("@/lib/telegramNudge");
    const now = Date.parse("2026-10-08T12:00:00.000Z");
    const url = "https://t.me/Bananto_store_bot?start=tok";
    expect(telegramLinkUsable({ url, expiresAt: "2026-10-08T12:10:00.000Z" }, now)).toBe(true);
    expect(telegramLinkUsable({ url, expiresAt: "2026-10-08T12:00:10.000Z" }, now)).toBe(false);
    expect(telegramLinkUsable({ url }, now)).toBe(true);
    expect(telegramLinkUsable(null, now)).toBe(false);
  });
});
