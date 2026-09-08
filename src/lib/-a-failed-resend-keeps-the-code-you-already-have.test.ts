/**
 * A failed resend used to take a working code with it.
 *
 * `sendVerificationCode` invalidated every previous code for the number
 * *before* attempting delivery. So during the WhatsApp outage on banan.to, a
 * customer who already had a valid code on their phone and pressed "resend"
 * got nothing new — and lost the one they had. Two codes gone, one request.
 *
 * The purge now runs only after the provider has actually accepted the
 * message, so a delivery that fails leaves the customer exactly where they
 * were.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishEnv } from "./env.server";
import { assertOtp, sendVerificationCode, OtpError } from "./otp.server";

/** A different number per test: OTP state is keyed by phone. */
const aPhone = () => `+964770${Math.floor(1000000 + Math.random() * 9000000)}`;

/** Answers as WaSender does when it accepts the message, capturing the code. */
function providerAccepts(): { code: () => string } {
  let captured = "";
  globalThis.fetch = vi.fn().mockImplementation(async (_url, opts: any) => {
    const match = JSON.parse(opts.body).text.match(/\d{6}/);
    if (match) captured = match[0];
    return {
      status: 200,
      text: async () => JSON.stringify({ success: true, messageId: "msg" }),
      json: async () => ({ success: true, messageId: "msg" }),
    };
  });
  return { code: () => captured };
}

/** Answers as WaSender did during the outage: the credential is refused. */
function providerRejectsTheKey() {
  globalThis.fetch = vi.fn().mockImplementation(async () => ({
    status: 401,
    text: async () => "Unauthorized",
    json: async () => ({}),
  }));
}

describe("a resend that never arrives", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    publishEnv({
      SESSION_SECRET: "test_session_secret_12345678901234567890",
      OTP_HASH_SECRET: "test_otp_hash_secret_12345678901234567890",
      WASENDER_API_KEY: "test_session_api_key_12345678",
    });
  });

  afterEach(() => {
    publishEnv({});
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("leaves the code the customer already received still usable", async () => {
    const phone = aPhone();

    const first = providerAccepts();
    const sent = await sendVerificationCode(phone, "signup", "whatsapp");
    expect(sent.success).toBe(true);
    const delivered = first.code();
    expect(delivered).toMatch(/^\d{6}$/);

    /*
      Ninety seconds later: past the one-minute resend cooldown, and well
      inside the five-minute life of the code. Without this the resend is
      refused by the cooldown before it ever reaches the delivery, and the test
      passes whether or not the bug is present — which is exactly what the
      first draft of it did.
    */
    vi.setSystemTime(new Date(Date.now() + 90 * 1000));

    // The provider starts refusing the key, and the customer presses resend.
    providerRejectsTheKey();
    const resend = await sendVerificationCode(phone, "signup", "whatsapp");
    expect(resend.success).toBe(false);
    expect(resend.errorCode).toBe("WHATSAPP_SEND_FAILED");

    // The code on their phone still works. Before the fix, this threw.
    await expect(assertOtp(phone, "signup", delivered)).resolves.not.toThrow();
  });

  it("does not leave a code the customer never received", async () => {
    const phone = aPhone();
    providerRejectsTheKey();

    const result = await sendVerificationCode(phone, "signup", "whatsapp");
    expect(result.success).toBe(false);

    // Nothing was delivered, so nothing is outstanding to verify against.
    await expect(assertOtp(phone, "signup", "123456")).rejects.toThrow(OtpError);
  });

  it("still replaces the old code once a new one is actually delivered", async () => {
    const phone = aPhone();

    const first = providerAccepts();
    await sendVerificationCode(phone, "signup", "whatsapp");
    const old = first.code();

    /*
      Ninety seconds, not ten minutes: past the cooldown while the first code
      is still alive. Advancing beyond the five-minute expiry would make this
      pass on expiry alone and say nothing about the purge.
    */
    vi.setSystemTime(new Date(Date.now() + 90 * 1000));
    const second = providerAccepts();
    const again = await sendVerificationCode(phone, "signup", "whatsapp");
    expect(again.success).toBe(true);
    expect(second.code()).toMatch(/^\d{6}$/);
    expect(second.code()).not.toBe(old);

    // The superseded code is gone even though it had not expired.
    await expect(assertOtp(phone, "signup", old)).rejects.toThrow(OtpError);
  });
});
