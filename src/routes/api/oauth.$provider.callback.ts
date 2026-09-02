import { createFileRoute, redirect } from "@tanstack/react-router";

import { findOrCreateOAuthUser } from "@/lib/db.server";
import {
  clearOauthNonceCookie,
  exchangeCode,
  readOauthNonceCookie,
  readState,
} from "@/lib/oauth.server";
import type { OAuthProvider } from "@/lib/oauth.server";
import { establishSession } from "@/lib/session.server";
import { textBody } from "@/lib/http.server";

type AppleUser = { name?: { firstName?: string; lastName?: string }; email?: string };

interface CallbackInput {
  code: string;
  state: string;
  error?: string;
  appleUser?: AppleUser;
}

/** Apple's `user` field is caller-supplied JSON; a malformed one must not 500. */
function parseAppleUser(raw: string | null): AppleUser | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as AppleUser) : undefined;
  } catch {
    return undefined;
  }
}

async function readCallback(request: Request): Promise<CallbackInput> {
  const url = new URL(request.url);
  if (request.method === "POST") {
    // Apple posts the result as form data (response_mode=form_post).
    const form = new URLSearchParams(await textBody(request, 64 * 1024));
    const appleUser = parseAppleUser(form.get("user"));
    return {
      code: form.get("code") ?? "",
      state: form.get("state") ?? "",
      ...(form.get("error") ? { error: String(form.get("error")) } : {}),
      ...(appleUser ? { appleUser } : {}),
    };
  }
  return {
    code: url.searchParams.get("code") ?? "",
    state: url.searchParams.get("state") ?? "",
    ...(url.searchParams.get("error") ? { error: url.searchParams.get("error")! } : {}),
  };
}

async function handle(request: Request, providerParam: string) {
  const provider = providerParam as OAuthProvider;
  if (provider !== "google" && provider !== "apple") {
    return new Response("unknown provider", { status: 404 });
  }

  const input = await readCallback(request);
  const origin = new URL(request.url).origin;

  if (input.error || !input.code || !input.state) {
    throw redirect({ href: `/auth?error=${encodeURIComponent(input.error ?? "oauth_failed")}` });
  }

  const secure =
    new URL(request.url).protocol === "https:" ||
    (request.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim() === "https";
  const dropNonce = clearOauthNonceCookie(secure);

  // The nonce cookie proves this callback belongs to the browser that started
  // the sign-in. Missing or mismatched means the state was replayed from
  // somewhere else, so no session is issued.
  const state = await readState(input.state, provider, readOauthNonceCookie(request));
  if (!state) {
    return new Response(null, {
      status: 302,
      headers: { Location: "/auth?error=invalid_state", "Set-Cookie": dropNonce },
    });
  }

  try {
    const profile = await exchangeCode(provider, input.code, origin, input.appleUser);
    const user = await findOrCreateOAuthUser(profile);
    const sessionCookie = await establishSession(user.id, request);

    // Safety check: All accounts must have a verified phone number.
    // Redirect to profile setup/phone verification if missing.
    // Use window.location origin for relative paths in redirect.
    let next =
      state.next.startsWith("/") && !state.next.startsWith("//") && !state.next.includes("\\")
        ? state.next
        : "/profile";

    if (!user.phoneVerifiedAt) {
      next = "/auth?view=phone_setup";
    }

    // Explicitly return a redirect with the session cookie in the headers.
    // D1 environment needs standard Response for set-cookie to persist reliably.
    const headers = new Headers({ Location: next, "cache-control": "no-store" });
    headers.append("Set-Cookie", sessionCookie);
    // The nonce is single use.
    headers.append("Set-Cookie", dropNonce);
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error("oauth callback failed", error);
    throw redirect({ href: "/auth?error=oauth_failed" });
  }
}

/** GET|POST /api/oauth/{google|apple}/callback */
export const Route = createFileRoute("/api/oauth/$provider/callback")({
  server: {
    handlers: {
      GET: async ({ request, params }) => handle(request, params.provider),
      POST: async ({ request, params }) => handle(request, params.provider),
    },
  },
});
