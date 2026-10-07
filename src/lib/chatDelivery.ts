/**
 * The four steps of handing over a game account, as the member's chat shows
 * them: the shop prepares it, the member signs in and sends proof, the shop
 * sends a code, the member enters it and plays.
 */

/** Which step a delivery stage stands on, counting from 0, and whether it is finished. */
export function deliveryStep(stage: string | undefined): { index: number; done: boolean } {
  switch (stage) {
    case "awaiting_login_proof":
      return { index: 1, done: false };
    case "proof_received":
    case "awaiting_otp":
      return { index: 2, done: false };
    case "otp_sent":
      return { index: 3, done: false };
    case "completed":
      return { index: 3, done: true };
    default:
      return { index: 0, done: false };
  }
}
