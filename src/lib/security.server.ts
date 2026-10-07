import { env } from "./env.server";

export function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const size = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < size; i += 1) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

export function bearerToken(request: Request, headerName = "authorization"): string {
  const value = request.headers.get(headerName) ?? "";
  if (headerName.toLowerCase() !== "authorization") return value.trim();
  return /^Bearer\s+/i.test(value) ? value.replace(/^Bearer\s+/i, "").trim() : "";
}

export function assertOperatorSecret(request: Request): Response | undefined {
  const expected = env("DIAGNOSTIC_SECRET") ?? "";
  const provided = bearerToken(request) || bearerToken(request, "x-diagnostic-secret");
  if (expected.length < 24) {
    return Response.json({ error: "DIAGNOSTICS_DISABLED" }, { status: 503 });
  }
  if (!provided || !constantTimeEqual(provided, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return undefined;
}

const CROSS_ORIGIN_POST_PATHS = new Set([
  "/api/oauth/apple/callback",
  "/api/public/telegram/webhook",
  "/api/public/hooks/contests-draw",
]);

/** Browser CSRF defence for cookie-authenticated JSON API mutations. */
export function rejectCrossSiteMutation(request: Request): Response | undefined {
  if (!/^(POST|PUT|PATCH|DELETE)$/i.test(request.method)) return undefined;
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/") || CROSS_ORIGIN_POST_PATHS.has(url.pathname)) {
    return undefined;
  }

  const fetchSite = (request.headers.get("sec-fetch-site") ?? "").toLowerCase();
  if (fetchSite === "cross-site") {
    return Response.json({ error: "cross_site_request_blocked" }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (!origin) return undefined;
  try {
    if (new URL(origin).origin === url.origin) return undefined;
  } catch {
    // Invalid Origin is rejected below.
  }
  return Response.json({ error: "invalid_origin" }, { status: 403 });
}

/**
 * The admin surface: never cached anywhere, never indexed, never framed.
 *
 * Framing is blocked here rather than globally because Telegram embeds the
 * storefront as a Mini App — but no legitimate flow ever puts the dashboard in
 * someone else's frame, so clickjacking protection belongs on these paths.
 */
function applyAdminHeaders(headers: Headers, pathname: string): void {
  if (!/^\/admin(?:\/|$)/.test(pathname) && !/^\/api\/admin(?:\/|$)/.test(pathname)) return;
  headers.set("cache-control", "private, no-store, max-age=0, must-revalidate");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  headers.set("x-frame-options", "DENY");
  const existing = headers.get("content-security-policy");
  if (!existing) headers.set("content-security-policy", "frame-ancestors 'none'");
}

/** True for responses the browser treats as a navigable document. */
function isDocumentResponse(headers: Headers): boolean {
  return (headers.get("content-type") ?? "").toLowerCase().includes("text/html");
}

export function withSecurityHeaders(response: Response, url?: URL): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  /*
    The microphone is the site's own: the chat records voice notes. `()` here
    would switch `getUserMedia` off for every page this header reaches.
  */
  headers.set("permissions-policy", "camera=(), microphone=(self), geolocation=(), payment=()");
  // Do not set X-Frame-Options globally: Telegram Web embeds Mini Apps. Pages
  // that must not be framed should use a route-specific CSP instead.
  headers.set("cross-origin-opener-policy", "same-origin-allow-popups");
  if (!headers.has("cache-control") && response.status >= 400) {
    headers.set("cache-control", "no-store");
  }
  // Documents must never be reused without asking us first. The HTML carries
  // the hashed <script> tags for the current build, so a browser that serves it
  // from its own heuristic cache after a deploy asks for chunks that no longer
  // exist — which is what leaves members on an old version until they reload by
  // hand, and what turns into a blank page when the chunks are actually gone.
  // `no-cache` still allows a 304, so this costs a revalidation, not a download.
  if (!headers.has("cache-control") && isDocumentResponse(headers)) {
    headers.set("cache-control", "private, no-cache, must-revalidate");
  }
  if (env("APP_ENV") === "production") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
  }
  if (url) applyAdminHeaders(headers, url.pathname);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    a! >= 224
  );
}

/** Reject local/private targets and non-public URLs before an edge fetch. */
export function safeRemoteImageUrl(raw: string): URL | undefined {
  if (!raw || raw.length > 4096) return undefined;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443" && url.port !== "80" && url.port !== "8080" && url.port !== "8443")
  ) {
    return undefined;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    host === "169.254.169.254" ||
    isPrivateIpv4(host) ||
    host === "::1" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc00:") ||
    host.startsWith("fd00:")
  ) {
    return undefined;
  }
  return url;
}

export async function fetchRemoteImage(
  raw: string,
  init: RequestInit = {},
): Promise<Response | undefined> {
  let current = safeRemoteImageUrl(raw);
  if (!current) return undefined;

  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) {
    headers.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    );
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
  }
  if (!headers.has("Referer")) {
    headers.set("Referer", current.origin + "/");
  }

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(current, { ...init, headers, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return undefined;
    current = safeRemoteImageUrl(new URL(location, current).toString());
    if (!current) return undefined;
  }
  return undefined;
}

export async function readLimitedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) return undefined;
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function clientAddress(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
