import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishEnv } from "./env.server";
import {
  generateSecureOtpCode,
  computeOtpHash,
  verifyOtpCode,
  sendVerificationCode,
  assertOtp,
  OtpError,
} from "./otp.server";

describe("Secure OTP Service & WaSender Integration", () => {
  beforeEach(() => {
    vi.resetModules();
    publishEnv({
      SESSION_SECRET: "test_session_secret_12345678901234567890",
      OTP_HASH_SECRET: "test_otp_hash_secret_12345678901234567890",
      WASENDER_API_KEY: "test_session_api_key_12345678",
    });
  });

  afterEach(() => {
    publishEnv({});
    vi.restoreAllMocks();
  });

  describe("Cryptographically Secure OTP Generation", () => {
    it("generates 6-digit numeric strings in range 100000-999999", () => {
      for (let i = 0; i < 50; i++) {
        const code = generateSecureOtpCode();
        expect(code).toMatch(/^\d{6}$/);
        const num = parseInt(code, 10);
        expect(num).toBeGreaterThanOrEqual(100000);
        expect(num).toBeLessThanOrEqual(999999);
      }
    });
  });

  describe("HMAC-SHA-256 Hashing & Verification", () => {
    it("computes consistent HMAC hash for same phone, purpose, code", async () => {
      const phone = "+9647701234567";
      const purpose = "signup";
      const code = "123456";

      const hash1 = await computeOtpHash(code, phone, purpose);
      const hash2 = await computeOtpHash(code, phone, purpose);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);

      const isValid = await verifyOtpCode(code, phone, purpose, hash1);
      expect(isValid).toBe(true);

      const isInvalid = await verifyOtpCode("999999", phone, purpose, hash1);
      expect(isInvalid).toBe(false);
    });

    it("produces different hashes for different purposes or phones", async () => {
      const code = "123456";
      const hashSignup = await computeOtpHash(code, "+9647701234567", "signup");
      const hashReset = await computeOtpHash(code, "+9647701234567", "reset");
      const hashOtherPhone = await computeOtpHash(code, "+9647801234567", "signup");

      expect(hashSignup).not.toBe(hashReset);
      expect(hashSignup).not.toBe(hashOtherPhone);
    });
  });

  describe("End-to-End OTP Flow with Mocked WaSender", () => {
    it("sends OTP via WhatsApp and verifies successfully", async () => {
      let capturedCode = "";
      globalThis.fetch = vi.fn().mockImplementation(async (url, opts) => {
        const body = JSON.parse(opts.body);
        const match = body.text.match(/\d{6}/);
        if (match) capturedCode = match[0];
        return {
          status: 200,
          text: async () => JSON.stringify({ success: true, messageId: "msg_123" }),
          json: async () => ({ success: true, messageId: "msg_123" }),
        };
      });

      const phone = `+964770${Math.floor(1000000 + Math.random() * 9000000)}`;
      const sendRes = await sendVerificationCode(phone, "signup", "whatsapp");
      expect(sendRes.success).toBe(true);
      expect(capturedCode).toMatch(/^\d{6}$/);

      // Verify OTP correctly
      await expect(assertOtp(phone, "signup", capturedCode)).resolves.not.toThrow();

      // Anti-Replay: Attempting to verify same code again MUST fail
      await expect(assertOtp(phone, "signup", capturedCode)).rejects.toThrow(OtpError);
    });

    it("rejects wrong purpose verification", async () => {
      let capturedCode = "";
      globalThis.fetch = vi.fn().mockImplementation(async (url, opts) => {
        const body = JSON.parse(opts.body);
        const match = body.text.match(/\d{6}/);
        if (match) capturedCode = match[0];
        return {
          status: 200,
          text: async () => JSON.stringify({ success: true, messageId: "msg_123" }),
          json: async () => ({ success: true, messageId: "msg_123" }),
        };
      });

      const phone = `+964770${Math.floor(1000000 + Math.random() * 9000000)}`;
      await sendVerificationCode(phone, "signup", "whatsapp");

      // Verify with wrong purpose "reset"
      await expect(assertOtp(phone, "reset", capturedCode)).rejects.toThrow(OtpError);
    });

    it("enforces cooldown between rapid sends", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ success: true, messageId: "msg_123" }),
        json: async () => ({ success: true, messageId: "msg_123" }),
      });

      const phone = `+964770${Math.floor(1000000 + Math.random() * 9000000)}`;
      const first = await sendVerificationCode(phone, "signup", "whatsapp");
      expect(first.success).toBe(true);

      const second = await sendVerificationCode(phone, "signup", "whatsapp");
      expect(second.success).toBe(false);
      expect(second.retryAfter).toBeGreaterThan(0);
      expect(second.error).toContain("ثانية");
    });
  });
});
