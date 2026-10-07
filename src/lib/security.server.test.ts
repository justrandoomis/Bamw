import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  rejectCrossSiteMutation,
  safeRemoteImageUrl,
  withSecurityHeaders,
} from "./security.server";

describe("request security boundaries", () => {
  it("blocks cross-site cookie API mutations", async () => {
    const response = rejectCrossSiteMutation(
      new Request("https://banan.to/api/profile", {
        method: "POST",
        headers: { origin: "https://attacker.invalid", "sec-fetch-site": "cross-site" },
      }),
    );
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "cross_site_request_blocked" });
  });

  it("allows same-origin mutations and signed webhook endpoints", () => {
    expect(
      rejectCrossSiteMutation(
        new Request("https://banan.to/api/profile", {
          method: "POST",
          headers: { origin: "https://banan.to", "sec-fetch-site": "same-origin" },
        }),
      ),
    ).toBeUndefined();
    expect(
      rejectCrossSiteMutation(
        new Request("https://banan.to/api/public/telegram/webhook", {
          method: "POST",
          headers: { origin: "https://api.telegram.org", "sec-fetch-site": "cross-site" },
        }),
      ),
    ).toBeUndefined();
  });

  it("stops documents being reused after a deploy without revalidating", () => {
    const html = withSecurityHeaders(
      new Response("<!doctype html><p>hi</p>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      new URL("https://banan.to/"),
    );
    expect(html.headers.get("cache-control")).toBe("private, no-cache, must-revalidate");
  });

  it("leaves an explicit cache-control alone, and does not touch non-documents", () => {
    const asset = withSecurityHeaders(
      new Response("body{}", {
        headers: {
          "content-type": "text/css",
          "cache-control": "public, max-age=31536000, immutable",
        },
      }),
    );
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    const json = withSecurityHeaders(
      new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    expect(json.headers.get("cache-control")).toBeNull();
  });

  it("sends the browser's own referrer policy, which YouTube embeds need", () => {
    // `no-referrer` makes every embedded trailer fail with YouTube's error 153.
    const html = withSecurityHeaders(
      new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
      new URL("https://banan.to/product/x"),
    );
    expect(html.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    expect(html.headers.get("cross-origin-opener-policy")).toBe("same-origin-allow-popups");
  });

  it("keeps the microphone for voice notes and switches off what the site never uses", () => {
    const policy = withSecurityHeaders(new Response("{}")).headers.get("permissions-policy");
    expect(policy).toContain("microphone=(self)");
    expect(policy).toContain("camera=()");
    expect(policy).toContain("geolocation=()");
  });

  it("pins HTTPS and bans framing the dashboard on the shop's own addresses only", () => {
    const live = withSecurityHeaders(
      new Response("<p/>"),
      new URL("https://banan.to/admin/orders"),
    );
    expect(live.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(live.headers.get("x-frame-options")).toBe("DENY");

    // Not every subdomain: a browser cannot be told to forget for a year.
    expect(live.headers.get("strict-transport-security")).not.toContain("includeSubDomains");

    // A preview frames the app on its own address, the dashboard included.
    const preview = withSecurityHeaders(
      new Response("<p/>"),
      new URL("https://preview.example.dev/admin/orders"),
    );
    expect(preview.headers.get("x-frame-options")).toBeNull();
    expect(preview.headers.get("strict-transport-security")).toBeNull();

    // The storefront is framed by Telegram as a Mini App, so never there.
    const shop = withSecurityHeaders(new Response("<p/>"), new URL("https://banan.to/telegram"));
    expect(shop.headers.get("x-frame-options")).toBeNull();
  });

  it("leaves every cookie a route set exactly as it was", () => {
    const headers = new Headers();
    headers.append("set-cookie", "session=abc; Path=/; HttpOnly; Secure");
    headers.append("set-cookie", "bananto_lang=ar; Path=/");
    const response = withSecurityHeaders(
      new Response("{}", { headers }),
      new URL("https://banan.to/api/auth"),
    );
    expect(response.headers.getSetCookie()).toEqual([
      "session=abc; Path=/; HttpOnly; Secure",
      "bananto_lang=ar; Path=/",
    ]);
  });

  it("copies a response whose headers are locked instead of failing it", () => {
    const redirect = withSecurityHeaders(
      Response.redirect("https://banan.to/wallet", 302),
      new URL("https://banan.to/old"),
    );
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://banan.to/wallet");
    expect(redirect.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("hands a WebSocket handshake back untouched", () => {
    const handshake = { status: 101, headers: new Headers() } as unknown as Response;
    expect(withSecurityHeaders(handshake)).toBe(handshake);
  });

  it("is applied to every answer the worker gives", () => {
    const server = readFileSync(resolve(process.cwd(), "src/server.ts"), "utf8");
    expect(server).toContain("return withSecurityHeaders(response, new URL(request.url));");
  });

  it("rejects private, local, and credentialed image targets", () => {
    expect(safeRemoteImageUrl("ftp://example.com/image.png")).toBeUndefined();
    expect(safeRemoteImageUrl("https://127.0.0.1/image.png")).toBeUndefined();
    expect(safeRemoteImageUrl("https://192.168.1.10/image.png")).toBeUndefined();
    expect(safeRemoteImageUrl("https://user:pass@example.com/image.png")).toBeUndefined();
    expect(safeRemoteImageUrl("https://images.example.com/image.png")?.hostname).toBe(
      "images.example.com",
    );
  });
});
