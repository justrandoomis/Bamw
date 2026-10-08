import { createFileRoute } from "@tanstack/react-router";

import {
  passwordHashNeedsUpgrade,
  sessionSecretConfigured,
  verifyPassword,
} from "@/lib/crypto.server";
import {
  createUser,
  ensureOwnerAdmin,
  findUserByEmail,
  findUserByIdentifier,
  findUserById,
  setUserPassword,
  toPublicUser,
  verifiedOwnerIdentity,
} from "@/lib/db.server";
import { body, guard, json } from "@/lib/http.server";
import {
  confirmLoginCodeSaved,
  createCodeAccount,
  findUserByLoginCode,
  issueNewLoginCode,
  usernameVerdict,
} from "@/lib/login-code.server";
import { usernameProblemText } from "@/lib/loginCode";
import { isOwnerEmail } from "@/lib/owner-auth.server";
import { isPlaceholderEmail } from "@/lib/phone";
import { clearSessionCookie, getSessionUser, establishSession } from "@/lib/session.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";

interface AuthBody {
  action?:
    | "register"
    | "login"
    | "logout"
    | "code_register"
    | "code_login"
    | "code_saved"
    | "code_rotate"
    | "username_check";
  /** email OR phone number in any local spelling */
  identifier?: string;
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  /** the name a login-code account is known by */
  username?: string;
  /** a login code, in any spacing or case */
  code?: string;
}

/** An address that can receive mail, written the way people write one. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Why a username was refused, in Arabic, for the form to show under the field. */
function usernameError(problem: string): string {
  return problem === "taken"
    ? "هذا الاسم مستخدم، اختر اسماً آخر"
    : usernameProblemText(problem as Parameters<typeof usernameProblemText>[0], "ar");
}

export const Route = createFileRoute("/api/auth")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          const current = await getSessionUser(request);
          const user = current
            ? await ensureOwnerAdmin(current, verifiedOwnerIdentity(current))
            : undefined;
          return json({ user: user ? toPublicUser(user) : null });
        }, "auth"),
      POST: async ({ request }) =>
        guard(async () => {
          const data = await body<AuthBody>(request);

          if (data.action === "logout") {
            return json({ user: null }, { headers: { "set-cookie": clearSessionCookie(request) } });
          }

          if (!sessionSecretConfigured()) {
            return json(
              { error: "إعداد جلسات الحساب غير مكتمل على الخادم حالياً" },
              { status: 503 },
            );
          }

          /*
            The login code. «تسجيل الدخول بدون إدخال أي بيانات»: a username
            in, a code out, and the code alone signs in from then on.

            The limits are per network address and generous: an Iraqi mobile
            carrier puts thousands of members behind one, and the code has 80
            random bits, so no rate a person could reach finds one by guessing.
          */
          if (data.action === "username_check") {
            const throttle = await consumeRateLimit(request, "auth-username-check", 120, 5 * 60);
            if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
            const verdict = await usernameVerdict(String(data.username ?? ""));
            return json(
              verdict.available
                ? { available: true, username: verdict.username }
                : {
                    available: false,
                    username: verdict.username,
                    problem: verdict.problem,
                    error: usernameError(verdict.problem),
                  },
            );
          }

          if (data.action === "code_register") {
            const throttle = await consumeRateLimit(request, "auth-code-register", 10, 10 * 60);
            if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
            const result = await createCodeAccount(String(data.username ?? ""));
            if (!result.ok) {
              return json(
                { error: usernameError(result.problem), problem: result.problem },
                { status: result.problem === "taken" ? 409 : 400 },
              );
            }
            return json(
              // Said once, here, and never again: the server keeps only a hash.
              { user: toPublicUser(result.user), code: result.code },
              { headers: { "set-cookie": await establishSession(result.user.id, request) } },
            );
          }

          if (data.action === "code_login") {
            const throttle = await consumeRateLimit(request, "auth-code-login", 30, 15 * 60);
            if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
            const found = await findUserByLoginCode(String(data.code ?? ""));
            if (!found) {
              console.warn("[auth] rejected login code");
              return json({ error: "الكود غير صحيح. تأكد منه وحاول مرة أخرى." }, { status: 401 });
            }
            const user = await ensureOwnerAdmin(found, verifiedOwnerIdentity(found));
            return json(
              { user: toPublicUser(user) },
              { headers: { "set-cookie": await establishSession(user.id, request) } },
            );
          }

          if (data.action === "code_saved" || data.action === "code_rotate") {
            const current = await getSessionUser(request);
            if (!current) return json({ error: "سجّل الدخول أولاً" }, { status: 401 });
            if (data.action === "code_saved") {
              await confirmLoginCodeSaved(current.id);
              return json({ ok: true });
            }
            const throttle = await consumeRateLimit(
              request,
              "auth-code-rotate",
              10,
              60 * 60,
              current.id,
            );
            if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);
            const code = await issueNewLoginCode(current.id);
            /*
              The session is tied to the code, so the old cookie stops
              matching the moment the code changes — on purpose, for every
              other device. This one gets a fresh session with the new code.
            */
            const refreshed = await findUserById(current.id);
            return json(
              { code, user: refreshed ? toPublicUser(refreshed) : null },
              { headers: { "set-cookie": await establishSession(current.id, request) } },
            );
          }

          const password = data.password ?? "";
          const identifier = String(data.identifier ?? data.email ?? data.phone ?? "").trim();

          const throttle = await consumeRateLimit(
            request,
            data.action === "register" ? "auth-register" : "auth-login",
            data.action === "register" ? 5 : 10,
            15 * 60,
            identifier.slice(0, 160),
          );
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);

          /*
            An account from an email and a password, with no code to wait for:
            «إنشاء الحساب أسهل بدون رمز تحقق». The address is not proven, so
            it never makes anyone the owner (`verifiedOwnerIdentity` trusts a
            verified phone or a Google/Apple email only), and a later Google
            sign-in with the same address takes the account over from whoever
            typed it — see `findOrCreateOAuthUser`.
          */
          if (data.action === "register") {
            /*
              Per address as well as per email: the limit above is keyed on
              the email typed, so a new email each time would never meet it.
            */
            const perAddress = await consumeRateLimit(request, "auth-register-ip", 10, 10 * 60);
            if (!perAddress.allowed) return rateLimitResponse(perAddress.retryAfter);
            const email = String(data.email ?? data.identifier ?? "")
              .trim()
              .toLowerCase();
            if (!EMAIL_PATTERN.test(email) || isPlaceholderEmail(email) || email.length > 160) {
              return json({ error: "اكتب بريداً إلكترونياً صحيحاً" }, { status: 400 });
            }
            if (password.length < 8 || password.length > 128) {
              return json({ error: "كلمة المرور يجب أن تكون من ٨ إلى ١٢٨ حرفاً" }, { status: 400 });
            }
            if (isOwnerEmail(email) || (await findUserByEmail(email))) {
              return json(
                { error: "هذا البريد مسجّل مسبقاً — سجّل الدخول به", exists: true },
                { status: 409 },
              );
            }
            const created = await createUser({
              name:
                String(data.name ?? "")
                  .trim()
                  .slice(0, 60) || email.split("@")[0]!.slice(0, 30),
              email,
              password,
              provider: "password",
            });
            return json(
              { user: toPublicUser(created) },
              { headers: { "set-cookie": await establishSession(created.id, request) } },
            );
          }

          if (!identifier || !password) {
            return json({ error: "أدخل معرّف الحساب وكلمة المرور" }, { status: 400 });
          }

          const found = await findUserByIdentifier(identifier);
          if (
            !found ||
            !found.passwordHash ||
            !(await verifyPassword(password, found.passwordHash))
          ) {
            console.warn("[auth] rejected login attempt");
            return json({ error: "بيانات الدخول غير صحيحة" }, { status: 401 });
          }
          if (passwordHashNeedsUpgrade(found.passwordHash)) {
            await setUserPassword(found.id, password);
          }
          const user = await ensureOwnerAdmin(found, verifiedOwnerIdentity(found));
          return json(
            { user: toPublicUser(user) },
            { headers: { "set-cookie": await establishSession(user.id, request) } },
          );
        }, "auth"),
    },
  },
});
