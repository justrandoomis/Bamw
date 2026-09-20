/**
 * Product kinds that are fulfilled digitally and therefore belong in the
 * account-delivery queue.
 *
 * Keep this list in one place. Checkout and fulfilment used to carry separate
 * copies; imported Nintendo games use `game`, so one copy treated the order as
 * physical/unpaid while the other never created delivery slots for it.
 */
export const DIGITAL_ORDER_KINDS = [
  "account",
  "offline_account",
  "online_account",
  "bundle",
  "preorder",
  "digital_code",
  "code",
  "gift_card",
  "game",
] as const;

const DIGITAL_ORDER_KIND_SET = new Set<string>(DIGITAL_ORDER_KINDS);

export function isDigitalOrderKind(kind: unknown): boolean {
  return DIGITAL_ORDER_KIND_SET.has(
    // Legacy account purchases predate the `kind` field. The delivery
    // subsystem has always interpreted that missing value as an account.
    String(kind ?? "account")
      .trim()
      .toLowerCase(),
  );
}

export function isFullyDigitalOrder(items: ReadonlyArray<{ kind?: unknown }> | null | undefined) {
  return Boolean(items?.length) && items!.every((item) => isDigitalOrderKind(item.kind));
}
