import type { PublicUser } from "@/lib/types";

/**
 * Pure decision helpers shared by /auth and /profile.
 *
 * Both pages must only ever act on a *stable* session snapshot: while the
 * "me" query is loading or refetching the answer is always "wait", so a
 * flapping session can never bounce the user back and forth.
 */

export type SessionState = {
  user: PublicUser | null | undefined;
  isLoading: boolean;
  isFetching: boolean;
  /** false during SSR / before hydration */
  isClient?: boolean;
};

export function isSessionStable(s: SessionState): boolean {
  if (s.isClient === false) return false;
  if (s.isLoading || s.isFetching) return false;
  return s.user !== undefined;
}

/** /profile: redirect to /auth exactly once, and only for a confirmed signed-out visitor. */
export function profileRedirectTarget(s: SessionState): "/auth" | null {
  if (!isSessionStable(s)) return null;
  return s.user === null ? "/auth" : null;
}

export type AuthPageView =
  | "signin"
  | "signup"
  | "forgot"
  | "otp"
  | "reset_password"
  | "phone_setup"
  | "profile_setup"
  | "genres_setup";

export type AuthPageAction =
  | { type: "wait" }
  | { type: "stay" }
  | { type: "view"; view: AuthPageView }
  | { type: "redirect"; to: "/profile" };

/**
 * /auth: decide what a signed-in visitor should see.
 *
 * Straight on to where they were going. Every account used to be held here
 * until it verified a phone by code, and a new one was walked through two
 * profile screens after that — «تسهيل عملية تسجيل الدخول وشراء اللعبة ...
 * بدون رمز تحقق أو شيء». A phone and a profile are things a member may add
 * later; neither stands between them and the game they came to buy.
 *
 * Two exceptions. A member already inside the phone, code or profile steps —
 * because they opened them — may finish. And while a new login code is on
 * screen (`holdRedirect`), the page waits for the member to say they kept it:
 * leaving would take the code with it.
 */
export function authPageAction(
  s: SessionState,
  opts: { view: AuthPageView; isNewRegistration: boolean; holdRedirect?: boolean },
): AuthPageAction {
  if (!isSessionStable(s)) return { type: "wait" };
  if (s.user === null) return { type: "stay" };
  if (opts.holdRedirect) return { type: "stay" };
  if (
    opts.view === "otp" ||
    opts.view === "phone_setup" ||
    opts.view === "profile_setup" ||
    opts.view === "genres_setup"
  ) {
    return { type: "stay" };
  }
  return { type: "redirect", to: "/profile" };
}
