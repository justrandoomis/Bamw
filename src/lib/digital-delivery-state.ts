export type DeliveryItemStatus =
  "draft" | "needs_mapping" | "ready" | "sent" | "proof_received" | "otp_sent" | "completed";

export interface DeliveryProgressItem {
  id: string;
  status: DeliveryItemStatus;
  orderItemId?: string | null;
  archivedAt?: string | null;
}

export interface DeliveryProgress {
  total: number;
  prepared: number;
  delivered: number;
  needsMapping: number;
  drafts: number;
}

const PREPARED = new Set<DeliveryItemStatus>([
  "ready",
  "sent",
  "proof_received",
  "otp_sent",
  "completed",
]);

// The admin-facing "delivered" counter advances as soon as credentials have
// actually been sent. Completion is deliberately stricter and still requires
// the final OTP/code for every expected slot.
const DELIVERED = new Set<DeliveryItemStatus>(["sent", "proof_received", "otp_sent", "completed"]);

const TERMINAL = new Set<DeliveryItemStatus>(["otp_sent", "completed"]);

export function deliveryDraftStatus(
  username: string | null | undefined,
  password: string | null | undefined,
): "draft" | "ready" {
  return username?.trim() && password?.trim() ? "ready" : "draft";
}

export function isDeliveryTerminal(status: DeliveryItemStatus): boolean {
  return TERMINAL.has(status);
}

export function calculateDeliveryProgress(items: DeliveryProgressItem[]): DeliveryProgress {
  const active = items.filter((item) => !item.archivedAt);
  const expected = active.filter((item) => Boolean(item.orderItemId));
  return {
    total: expected.length,
    prepared: expected.filter((item) => PREPARED.has(item.status)).length,
    delivered: expected.filter((item) => DELIVERED.has(item.status)).length,
    needsMapping: active.filter((item) => item.status === "needs_mapping").length,
    drafts: expected.filter((item) => item.status === "draft").length,
  };
}

export function allExpectedDeliveryItemsDelivered(items: DeliveryProgressItem[]): boolean {
  const progress = calculateDeliveryProgress(items);
  const expected = items.filter((item) => !item.archivedAt && Boolean(item.orderItemId));
  return (
    progress.total > 0 &&
    progress.needsMapping === 0 &&
    expected.every((item) => TERMINAL.has(item.status))
  );
}

/** Pick the first prepared item after the current one, wrapping once. */
export function nextReadyDeliveryItemId(
  items: DeliveryProgressItem[],
  currentId: string,
): string | undefined {
  const expected = items.filter(
    (item) => !item.archivedAt && Boolean(item.orderItemId) && item.status === "ready",
  );
  if (!expected.length) return undefined;
  const currentIndex = items.findIndex((item) => item.id === currentId);
  return (
    expected.find(
      (item) => items.findIndex((candidate) => candidate.id === item.id) > currentIndex,
    ) ?? expected[0]
  )?.id;
}

export function autoCompleteAtFromLastOtp(lastOtpSentAt: string): string {
  const timestamp = new Date(lastOtpSentAt).getTime();
  if (!Number.isFinite(timestamp)) throw new Error("invalid_last_otp_sent_at");
  return new Date(timestamp + 60 * 60 * 1_000).toISOString();
}

/** Thirty minutes, the wait before the shop asks for a review on its own. */
export const REVIEW_PROMPT_DELAY_MINUTES = 30;

/**
 * When to ask for the review if the customer has not confirmed by then.
 *
 * Deliberately not {@link autoCompleteAtFromLastOtp}. That is the sixty-minute
 * deadline after which an unconfirmed order completes itself, and the owner's
 * rule for the review is half that — the customer has the code, they can say
 * what they think of the delivery without waiting for a timer they never see.
 * Two timers, two functions: changing one must not move the other.
 */
export function reviewPromptAtFromLastOtp(lastOtpSentAt: string): string {
  const timestamp = new Date(lastOtpSentAt).getTime();
  if (!Number.isFinite(timestamp)) throw new Error("invalid_last_otp_sent_at");
  return new Date(timestamp + REVIEW_PROMPT_DELAY_MINUTES * 60 * 1_000).toISOString();
}
