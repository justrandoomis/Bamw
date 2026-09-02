import { createFileRoute } from "@tanstack/react-router";

import {
  passwordHashNeedsUpgrade,
  sessionSecretConfigured,
  verifyPassword,
} from "@/lib/crypto.server";
import {
  ensureOwnerAdmin,
  findUserByIdentifier,
  setUserPassword,
  toPublicUser,
  verifiedOwnerIdentity,
} from "@/lib/db.server";
import { body, guard, json } from "@/lib/http.server";
import { clearSessionCookie, getSessionUser, establishSession } from "@/lib/session.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";

interface AuthBody {
  action?: "register" | "login" | "logout";
  /** email OR phone number in any local spelling */
  identifier?: string;
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
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

          if (data.action === "register") {
            return json({ error: "استخدم مسار التحقق برمز الهاتف لإنشاء الحساب" }, { status: 400 });
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
