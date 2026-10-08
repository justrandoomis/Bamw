import { create } from "zustand";

/*
  «عندما يطلب المستخدم طلباً والتلي غير مفعّل، يكون هنالك تنبيه بأن التليجرام
  غير مفعّل ... ليس إجباراً، يمكن الضغط على لاحقاً أو الإعداد»

  Every update on an order — it being prepared, the account handed over, a
  reply from support — goes out on Telegram, and a member whose account is not
  linked never hears any of it. So right after an order, and only then, a
  member who cannot be reached is asked once whether to set Telegram up.

  The ask is placed where the order is placed, and shown by `AppShell` on the
  page the member lands on: the cart unmounts as the order chat opens, so the
  request has to outlive the page that made it.
*/

export type TelegramReach = { linked: boolean; reachable?: boolean };

/** Whether Telegram messages reach the member: `reachable`, or `linked` from a server without it. */
export function telegramReachesMember(status: TelegramReach): boolean {
  return status.reachable ?? status.linked;
}

/**
 * Whether to ask: only when the shop knows for certain that nothing reaches
 * the member. A status it could not read is no reason to tell anyone that
 * Telegram is off.
 */
export function telegramNudgeDue(status: TelegramReach | undefined | null): boolean {
  return Boolean(status) && !telegramReachesMember(status as TelegramReach);
}

/** A link from the bot is good for 15 minutes; one about to lapse is fetched again. */
export function telegramLinkUsable(
  link: { url: string; expiresAt?: string | undefined } | null | undefined,
  now = Date.now(),
): boolean {
  if (!link?.url) return false;
  if (!link.expiresAt) return true;
  const expires = Date.parse(link.expiresAt);
  return Number.isNaN(expires) || expires - now > 30_000;
}

type NudgeState = {
  /** the order (or game request) that asked, until the member answers */
  pendingFor: string | null;
  ask: (orderId: string) => void;
  done: () => void;
};

export const useTelegramNudge = create<NudgeState>()((set) => ({
  pendingFor: null,
  ask: (orderId) => set({ pendingFor: orderId }),
  done: () => set({ pendingFor: null }),
}));

/** Called where an order is placed: ask about Telegram on the page that opens next. */
export function askAboutTelegramAfterOrder(orderId: string): void {
  useTelegramNudge.getState().ask(orderId);
}
