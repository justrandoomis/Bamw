/**
 * What a customer can ask for on a listing that is only a name and a price.
 *
 * Fifteen hundred games were published carrying nothing but a title and an
 * offline price. That is honest — it is what the shop knows — but it leaves
 * the customer with nowhere to go for the two things they most often want: the
 * details of the game itself, and an account type other than the standard
 * offline one.
 *
 * So the page offers to ask. This is deliberately a *request*, not a
 * configurator: the shop does not yet know what an online account for this
 * title costs, and inventing a price to put on a button is the one thing worse
 * than not offering it. The admin answers, sets the price, and the listing
 * stops being bare.
 *
 * The requests themselves ride on `product_requests`, which already carries a
 * type, a product id, a status trail, an admin screen and a Telegram notice.
 * A second table would have needed all four again.
 */

export const GAME_REQUEST_KINDS = ["game_details", "online_account", "offline_extras"] as const;

export type GameRequestKind = (typeof GAME_REQUEST_KINDS)[number];

export interface GameRequestOption {
  kind: GameRequestKind;
  label: string;
  /** What the shop will actually do, in the customer's words. */
  detail: string;
}

export const GAME_REQUEST_OPTIONS: readonly GameRequestOption[] = [
  {
    kind: "game_details",
    label: "أضف تفاصيل اللعبة",
    detail: "الصور، الوصف، اللغات، الحجم وبقية معلومات اللعبة.",
  },
  {
    kind: "online_account",
    label: "أضف خيار حساب أونلاين",
    detail: "حساب يدعم اللعب مع الاتصال والميزات المتاحة أونلاين.",
  },
  {
    kind: "offline_extras",
    label: "أضف حساب أوفلاين مع الإضافات",
    detail: "النسخة التي تشمل المحتوى الإضافي المثبت، وليس اللعبة الأساسية فقط.",
  },
];

const LABEL_BY_KIND: Record<GameRequestKind, string> = {
  game_details: "طلب تفاصيل لعبة",
  online_account: "طلب حساب أونلاين",
  offline_extras: "طلب حساب أوفلاين مع الإضافات",
};

export function gameRequestLabel(kind: unknown): string {
  const key = String(kind ?? "");
  return (LABEL_BY_KIND as Record<string, string>)[key] ?? "";
}

export function isGameRequestKind(value: unknown): value is GameRequestKind {
  return (GAME_REQUEST_KINDS as readonly string[]).includes(String(value ?? ""));
}
