import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishEnv } from "./env.server";
import {
  WaSenderProvider,
  maskPhoneForLog,
  WASENDER_SEND_ENDPOINT,
} from "@/services/whatsapp/wasender";

describe("WaSenderProvider Service", () => {
  beforeEach(() => {
    vi.resetModules();
    publishEnv({
      WASENDER_API_KEY: "test_session_api_key_12345678",
    });
  });

  afterEach(() => {
    publishEnv({});
    vi.restoreAllMocks();
  });

  describe("Phone masking for logs", () => {
    it("masks Iraqi and international numbers safely", () => {
      expect(maskPhoneForLog("+9647701234567")).toBe("+9647******567");
      expect(maskPhoneForLog("+9647809988776")).toBe("+9647******776");
      expect(maskPhoneForLog("123")).toBe("***");
    });
  });

  describe("Config Status", () => {
    it("reports configured when API key is provided without leaking it", () => {
      const provider = new WaSenderProvider();
      const status = provider.getConfigStatus();
      expect(status.configured).toBe(true);
      expect(status.sessionApiKeyPresent).toBe(true);
      expect(status.provider).toBe("wasender");
      // Must not expose the actual key in returned object
      expect((status as any).apiKey).toBeUndefined();
    });

    it("reports not configured when API key is missing", () => {
      publishEnv({ WASENDER_API_KEY: "" });
      const provider = new WaSenderProvider();
      const status = provider.getConfigStatus();
      expect(status.configured).toBe(false);
      expect(status.sessionApiKeyPresent).toBe(false);
    });
  });

  describe("Message Dispatching", () => {
    it("successfully sends message via WaSenderAPI with correct headers and payload", async () => {
      const provider = new WaSenderProvider();
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ success: true, messageId: "msg_abc123" }),
        json: async () => ({ success: true, messageId: "msg_abc123" }),
      });
      globalThis.fetch = fetchMock;

      const result = await provider.sendMessage("07701234567", "رمز التحقق هو 123456");

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.messageId).toBe("msg_abc123");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, req] = fetchMock.mock.calls[0]!;
      expect(url).toBe(WASENDER_SEND_ENDPOINT);
      expect(req.method).toBe("POST");
      expect(req.headers["Authorization"]).toBe("Bearer test_session_api_key_12345678");
      expect(req.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(req.body);
      expect(body.to).toBe("+9647701234567");
      expect(body.text).toBe("رمز التحقق هو 123456");
    });

    it("handles 401 / 403 auth errors gracefully", async () => {
      const provider = new WaSenderProvider();
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 401,
        text: async () => JSON.stringify({ success: false, message: "Unauthorized" }),
        json: async () => ({ success: false, message: "Unauthorized" }),
      });

      const result = await provider.sendMessage("+9647701234567", "Hello");
      expect(result.success).toBe(false);
      expect(result.status).toBe(401);
      expect(result.errorCode).toBe("WASENDER_AUTH_FAILED");
      expect(result.error).toContain("تعذر إرسال رمز التحقق عبر واتساب حالياً");
    });

    it("handles 429 rate limit error gracefully", async () => {
      const provider = new WaSenderProvider();
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 429,
        text: async () => JSON.stringify({ success: false, message: "Too many requests" }),
        json: async () => ({ success: false, message: "Too many requests" }),
      });

      const result = await provider.sendMessage("+9647701234567", "Hello");
      expect(result.success).toBe(false);
      expect(result.status).toBe(429);
      expect(result.errorCode).toBe("WASENDER_RATE_LIMITED");
      expect(result.error).toContain("تم تجاوز حد الإرسال");
    });

    it("handles 500 server errors gracefully", async () => {
      const provider = new WaSenderProvider();
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 500,
        text: async () => "Internal Server Error",
      });

      const result = await provider.sendMessage("+9647701234567", "Hello");
      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
      expect(result.errorCode).toBe("WASENDER_UNAVAILABLE");
    });

    it("handles invalid phone numbers before calling upstream", async () => {
      const provider = new WaSenderProvider();
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;

      const result = await provider.sendMessage("invalid_123", "Hello");
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_PHONE");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("handles missing API key gracefully without network call", async () => {
      publishEnv({ WASENDER_API_KEY: "" });
      const provider = new WaSenderProvider();
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;

      const result = await provider.sendMessage("+9647701234567", "Hello");
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("WASENDER_NOT_CONFIGURED");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
