import { createFileRoute } from "@tanstack/react-router";

import {
  createUser,
  ensureOwnerAdmin,
  findUserByEmail,
  findUserByMemberNo,
  findUserByPhone,
  isOwnerAccount,
  PhoneAlreadyVerifiedError,
  setPhoneVerified,
  setUserPassword,
  updateUser,
} from "@/lib/db.server";
import {
  d1All,
  d1First,
  d1Run,
  ensureOtpSchema,
  ensureSchema,
  ensureTelegramSchema,
  ensureUsersSchema,
} from "@/lib/d1.server";
import {
  adoptGuestTelegramLink,
  createLinkToken,
  linkTokenStatus,
  verifiedChatId,
} from "@/lib/telegram-link.server";

import { body, errorRef, guard, json, logServerError } from "@/lib/http.server";
import { sessionSecretConfigured } from "@/lib/crypto.server";
import {
  assertOtp,
  getOtpStatus,
  OtpError,
  resolveTelegramChatId,
  sendTelegramOtp,
  sendVerificationCode,
  type OtpPurpose,
  type OtpChannel,
} from "@/lib/otp.server";
import { isPlaceholderEmail, normalizePhone, phonePlaceholderEmail } from "@/lib/phone";
import { getSessionUser, establishSession, toPublicUser } from "@/lib/session.server";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit.server";

interface OtpBody {
  action?: "send" | "verify" | "telegram_init";
  purpose?: OtpPurpose;
  phone?: string;
  /** membership number — account recovery without exposing the phone/chat id */
  memberId?: string;
  code?: string;
  channel?: OtpChannel;
  name?: string;
  email?: string;
  password?: string;
  /** Telegram Mini App data */
  sessionId?: string;
  initData?: string;
}

/** Neutral answer: never tells the caller whether an account exists. */
const RECOVERY_NOTICE =
  "إذا كانت بيانات الحساب صحيحة، سيتم إرسال رمز التحقق إلى وسيلة الاسترداد المرتبطة بالحساب.";

/** Generic next steps — safe to show whether or not the account exists. */
const RECOVERY_HINT =
  "إن لم يصلك الرمز خلال دقيقة، فغالباً لا يوجد حساب تلغرام مثبت الملكية لهذا الحساب. أثبت الملكية من صفحة الحساب أو راسل الدعم الفني.";

export const Route = createFileRoute("/api/otp")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        guard(async () => {
          try {
            const data = await body<OtpBody>(request);

            const throttle = await consumeRateLimit(
              request,
              data.action === "telegram_init" ? "telegram-init" : `otp-${data.action ?? "verify"}`,
              data.action === "send" ? 8 : 15,
              15 * 60,
              String(data.phone ?? data.memberId ?? data.sessionId ?? "").slice(0, 160),
            );
            if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);

            /* ------------------------ Telegram Mini App ------------------------- */
            if (data.action === "telegram_init") {
              if (!data.initData) {
                return json({ error: "بيانات جلسة تلغرام مفقودة" }, { status: 400 });
              }

              const { verifyTelegramInitData } = await import("@/lib/telegram.server");
              const verified = await verifyTelegramInitData(data.initData);
              if (!verified.valid || !verified.user?.id) {
                const reason = verified.reason ?? "malformed";
                console.warn(`[telegram:init] launch data rejected: ${reason}`);
                return json(
                  {
                    error:
                      reason === "stale"
                        ? "انتهت صلاحية بيانات فتح التطبيق. أغلق التطبيق المصغر وافتحه من جديد من رسالة البوت."
                        : reason === "bot_token_missing"
                          ? "إعداد بوت تلغرام غير مكتمل على الخادم."
                          : "تعذر التحقق من جلسة تلغرام",
                    reason,
                  },
                  { status: reason === "bot_token_missing" ? 503 : 401 },
                );
              }

              // start_param is part of the signed initData. Never trust a token
              // supplied only by the browser when binding Telegram identity.
              const signedReference = verified.startParam;
              // Telegram documents tgWebAppStartParam as a mirror of
              // start_param. Some Android clients expose the mirror in the
              // launch URL but omit it from initDataUnsafe, so accept the
              // high-entropy bearer token supplied by the Mini App after
              // initData itself has been authenticated.
              if (signedReference && data.sessionId && data.sessionId !== signedReference) {
                return json({ error: "رمز جلسة التحقق غير صالح" }, { status: 400 });
              }

              const verificationReference = signedReference || data.sessionId;
              if (!verificationReference) {
                return json({ error: "رمز جلسة التحقق غير موجود" }, { status: 400 });
              }

              const { bindMiniAppIdentity } = await import("@/lib/telegram-link.server");
              await ensureTelegramSchema();
              const result = await bindMiniAppIdentity(
                verificationReference,
                String(verified.user.id),
              );
              if (result.status === "unknown") {
                return json({ error: "لم يتم العثور على جلسة التحقق" }, { status: 404 });
              }
              if (result.status === "expired") {
                return json({ error: "انتهت صلاحية جلسة التحقق" }, { status: 410 });
              }
              if (result.status === "failed") {
                return json({ error: "هذه الجلسة مرتبطة بحساب تلغرام آخر" }, { status: 409 });
              }

              return json({
                success: true,
                status: result.status,
                sessionId: result.session?.id,
              });
            }

            const purpose: OtpPurpose = data.purpose ?? "signup";
            const rawMemberId =
              data.memberId ??
              (typeof data.phone === "string" && data.phone.startsWith("member:")
                ? data.phone.slice(7)
                : "");
            const memberId = String(rawMemberId ?? "")
              .trim()
              .replace(/\D/g, "");

            // Check the session runtime before consuming a one-time code or
            // mutating an account. This turns a production configuration error
            // into a recoverable response instead of a half-created account.
            const willCreateSession =
              purpose === "signup" || (purpose === "reset" && Boolean(data.password));
            if (willCreateSession && !sessionSecretConfigured()) {
              return json(
                {
                  error:
                    "إعداد جلسات الحساب غير مكتمل حالياً. لم يُستهلك رمز التحقق؛ حاول مرة أخرى بعد إصلاح الإعداد.",
                },
                { status: 503 },
              );
            }

            /* ------------------ recovery by membership number -------------------- */
            if (memberId) {
              const otpKey = `member:${memberId}`;

              if (data.action === "send") {
                await ensureTelegramSchema();
                const account = await findUserByMemberNo(memberId);
                if (account) {
                  // Only a proven link may receive a recovery code. An unverified
                  // row is by definition an unfinished ownership proof, so
                  // delivering to it would hand account recovery to whoever
                  // started that proof.
                  const links = await d1All<{ telegram_chat_id: number }>(
                    `SELECT telegram_chat_id FROM telegram_links
                    WHERE user_id = ? AND telegram_chat_id IS NOT NULL AND verified = 1
                    ORDER BY linked_at DESC`,
                    account.id,
                  );

                  let delivered = false;

                  for (const link of links) {
                    const res = await sendVerificationCode(
                      account.phone ?? "",
                      "reset",
                      "telegram",
                      account.id,
                      {
                        otpKey,
                        chatId: link.telegram_chat_id,
                      },
                    );
                    if (res.success) {
                      delivered = true;
                      break;
                    }
                  }

                  // Priority 3: WhatsApp fallback
                  if (!delivered && account.phone) {
                    const res = await sendVerificationCode(
                      account.phone,
                      "reset",
                      "whatsapp",
                      account.id,
                      { otpKey },
                    );
                    delivered = res.success;
                  }

                  if (!delivered) {
                    console.error(
                      `[otp:recovery] no usable recovery channel for member ${memberId}`,
                    );
                  }
                } else {
                  return json(
                    {
                      error: "الحساب غير مسجل",
                      hint: "لا يوجد حساب مرتبط برقم العضوية هذا. تأكد من الرقم أو قم بإنشاء حساب جديد.",
                    },
                    { status: 404 },
                  );
                }

                // The above handles the explicitly requested "Account not found" feedback.
                // For valid accounts that reach here, we return the generic recovery notice.
                return json({
                  sent: true,
                  delivered: false,
                  phone: otpKey,
                  notice: RECOVERY_NOTICE,
                  hint: RECOVERY_HINT,
                  retryAfter: 60,
                  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                });
              }

              const memberCode = (data.code ?? "").replace(/\D/g, "");
              if (memberCode.length !== 6) {
                return json({ error: "الرمز يجب أن يكون ٦ أرقام" }, { status: 400 });
              }
              const account = await findUserByMemberNo(memberId);
              if (!account) return json({ error: "تعذر العثور على الحساب" }, { status: 404 });

              await assertOtp(otpKey, "reset", memberCode);

              if (!data.password) return json({ verified: true, memberId });
              if (data.password.length < 8 || data.password.length > 128) {
                return json(
                  { error: "كلمة المرور يجب أن تكون من ٨ إلى ١٢٨ حرفاً" },
                  { status: 400 },
                );
              }
              await setUserPassword(account.id, data.password);
              return json(
                { user: toPublicUser(account) },
                { headers: { "set-cookie": await establishSession(account.id, request) } },
              );
            }

            const phone = normalizePhone(data.phone ?? "");
            if (!phone) return json({ error: "رقم الهاتف غير صحيح" }, { status: 400 });

            /* --------------------------- send a new code -------------------------- */
            if (data.action === "send") {
              const existing = await findUserByPhone(phone);
              if (purpose === "signup" && existing?.phoneVerifiedAt) {
                return json({ error: "هذا الرقم مسجل مسبقاً، سجّل الدخول" }, { status: 409 });
              }
              if ((purpose === "reset" || purpose === "login") && !existing) {
                return json(
                  {
                    error: "الحساب غير مسجل",
                    hint: "هذا الرقم غير مرتبط بأي حساب في الموقع. تأكد من الرقم أو قم بإنشاء حساب جديد.",
                  },
                  { status: 404 },
                );
              }

              const sessionUser = await getSessionUser(request);
              if (purpose === "verify") {
                if (!sessionUser) return json({ error: "Unauthorized" }, { status: 401 });
                if (existing && existing.id !== sessionUser.id && existing.phoneVerifiedAt) {
                  return json({ error: "هذا الرقم مستخدم في حساب آخر" }, { status: 409 });
                }
              }

              const targetChannel: OtpChannel = data.channel || "telegram";
              // Attaching a number to the signed-in account is an act by that
              // account. Preferring `existing` here routed the code to whichever
              // half-finished registration happened to hold the number, so the
              // signed-in user was asked for a code that had been delivered to
              // somebody else's Telegram.
              const accountToUse = purpose === "verify" ? sessionUser : (existing ?? sessionUser);
              const ownerKey = accountToUse?.id || `guest:${phone}`;
              let telegramChatId: number | undefined;

              if (targetChannel === "whatsapp") {
                const { getWhatsappConfigStatus } = await import("@/lib/whatsapp.server");
                const wsStatus = getWhatsappConfigStatus();
                if (!wsStatus.configured) {
                  return json(
                    {
                      error: "إرسال رمز التحقق عبر واتساب غير متاح حالياً.",
                      hint: "يرجى اختيار التحقق عبر تلغرام لتأكيد حسابك عبر البوت الرسمي.",
                    },
                    { status: 400 },
                  );
                }
              }

              if (targetChannel === "telegram") {
                telegramChatId = await resolveTelegramChatId({
                  phone,
                  userId: accountToUse?.id,
                });

                if (!telegramChatId) {
                  // No link found, need to establish one (Signup / Verify / Reset / Login flow)
                  const { createVerificationSession } = await import("@/lib/telegram-link.server");
                  let verifSession: Awaited<ReturnType<typeof createVerificationSession>>;
                  try {
                    verifSession = await createVerificationSession(ownerKey, phone);
                  } catch (error) {
                    console.error("[telegram:verification] session creation failed", error);
                    return json(
                      { error: "تعذر حفظ جلسة تحقق تلغرام حالياً. حاول مرة أخرى بعد قليل." },
                      { status: 503 },
                    );
                  }

                  return json(
                    {
                      error: "يجب إثبات ملكية حساب تلغرام أولاً.",
                      needsLinking: true,
                      sessionId: verifSession.id,
                      botUrl: verifSession.deepLink,
                      expiresAt: verifSession.expires_at,
                    },
                    { status: 400 },
                  );
                }
              }

              const result = await sendVerificationCode(
                phone,
                purpose,
                targetChannel,
                accountToUse?.id,
                telegramChatId ? { chatId: telegramChatId } : undefined,
              );

              if (!result.success)
                return json(
                  { error: result.error, errorCode: result.errorCode, retryAfter: result.retryAfter },
                  { status: result.retryAfter ? 429 : 400 },
                );

              return json({
                sent: true,
                delivered: true,
                phone,
                channel: result.channel,
                expiresAt: result.expiresAt,
                retryAfter: result.retryAfter,
              });
            }

            /* ----------------------------- verify a code -------------------------- */
            const code = String(data.code ?? "").replace(/\D/g, "");
            if (code.length !== 6)
              return json({ error: "الرمز يجب أن يكون ٦ أرقام" }, { status: 400 });

            await Promise.all([ensureOtpSchema(), ensureUsersSchema()]);
            await assertOtp(phone, purpose, code);

            if (!sessionSecretConfigured() && (purpose === "signup" || purpose === "reset" || purpose === "login")) {
              console.error("[otp:auth] SESSION_SECRET is missing or too short");
              return json(
                {
                  error:
                    "إعداد جلسات الحساب (SESSION_SECRET) غير مكتمل على الخادم حالياً. يرجى مراجعة إعدادات Cloudflare.",
                },
                { status: 503 },
              );
            }

            // Password reset only unlocks the next step; the new password is set by
            // the follow-up `reset` action so the code can never be replayed.
            if (purpose === "reset") {
              const account = await findUserByPhone(phone);
              if (!account)
                return json({ error: "لا يوجد حساب مرتبط بهذا الرقم" }, { status: 404 });
              if (!data.password) return json({ verified: true, phone });
              if (data.password.length < 8 || data.password.length > 128) {
                return json(
                  { error: "كلمة المرور يجب أن تكون من ٨ إلى ١٢٨ حرفاً" },
                  { status: 400 },
                );
              }
              await setUserPassword(account.id, data.password);
              const verified = (await setPhoneVerified(account.id, phone)) ?? account;
              return json(
                { user: toPublicUser(verified) },
                { headers: { "set-cookie": await establishSession(verified.id, request) } },
              );
            }

            if (purpose === "login") {
              const account = await findUserByPhone(phone);
              if (!account)
                return json({ error: "لا يوجد حساب مرتبط بهذا الرقم" }, { status: 404 });
              const verified = (await setPhoneVerified(account.id, phone)) ?? account;
              await ensureTelegramSchema();
              await adoptGuestTelegramLink(phone, verified.id);
              return json(
                { user: toPublicUser(verified) },
                { headers: { "set-cookie": await establishSession(verified.id, request) } },
              );
            }

            // Adding / changing the number of a signed-in account (also the Google
            // "complete your profile" step).
            if (purpose === "verify") {
              const me = await getSessionUser(request);
              if (!me) return json({ error: "Unauthorized" }, { status: 401 });
              const updated = (await setPhoneVerified(me.id, phone)) ?? me;
              await ensureTelegramSchema();
              await adoptGuestTelegramLink(phone, updated.id);
              // The account's own link may still be pending from the ownership
              // proof that produced this code; the phone it carries has now been
              // confirmed, so promote exactly that row.
              await d1Run(
                `UPDATE telegram_links SET verified = 1 WHERE user_id = ? AND telegram_phone = ?`,
                updated.id,
                phone,
              );
              return json({ user: toPublicUser(updated) });
            }

            /* ------------------------------ signup ------------------------------- */
            const password = String(data.password ?? "");
            if (password.length < 8 || password.length > 128) {
              return json({ error: "كلمة المرور يجب أن تكون من ٨ إلى ١٢٨ حرفاً" }, { status: 400 });
            }
            const email =
              String(data.email ?? "")
                .trim()
                .toLowerCase() || phonePlaceholderEmail(phone);
            const emailTaken = await findUserByEmail(email);
            if (emailTaken && !isPlaceholderEmail(email)) {
              return json({ error: "هذا البريد مسجل مسبقاً" }, { status: 409 });
            }

            const unverified = await findUserByPhone(phone);
            if (unverified) {
              // A previous signup attempt never completed verification: reuse the row.
              await setUserPassword(unverified.id, password);
              const refreshed =
                (await updateUser(unverified.id, (user) => ({
                  ...user,
                  name: String(data.name ?? "").trim() || user.name,
                  phoneVerifiedAt: new Date().toISOString(),
                }))) ?? unverified;
              const promoted = await ensureOwnerAdmin(refreshed, { phone });
              await adoptGuestTelegramLink(phone, promoted.id);

              let legacyClaimed = false;
              try {
                const { claimLegacyAccount } = await import("@/lib/legacy-claim.server");
                const claimRes = await claimLegacyAccount({
                  userId: promoted.id,
                  phone,
                  claimType: "phone_otp",
                });
                legacyClaimed = Boolean(claimRes.claimed);
              } catch (e) {
                console.error("[OTP] legacy claim error:", e);
              }

              return json(
                { user: toPublicUser(promoted), legacyClaimed },
                { headers: { "set-cookie": await establishSession(promoted.id, request) } },
              );
            }

            const created = await createUser({
              name: String(data.name ?? "").trim() || `عضو ${phone.slice(-4)}`,
              email,
              phone,
              phoneVerifiedAt: new Date().toISOString(),
              password,
              isAdmin: isOwnerAccount({ phone }),
            });
            await adoptGuestTelegramLink(phone, created.id);

            let legacyClaimed = false;
            try {
              const { claimLegacyAccount } = await import("@/lib/legacy-claim.server");
              const claimRes = await claimLegacyAccount({
                userId: created.id,
                phone,
                claimType: "phone_otp",
              });
              legacyClaimed = Boolean(claimRes.claimed);
            } catch (e) {
              console.error("[OTP] legacy claim error:", e);
            }

            return json(
              { user: toPublicUser(created), legacyClaimed },
              { headers: { "set-cookie": await establishSession(created.id, request) } },
            );
          } catch (err) {
            if (err instanceof Response) return err;

            const errMsg = err instanceof Error ? err.message : String(err);
            const errName = err instanceof Error ? err.name : "";

            if (
              err instanceof OtpError ||
              errName === "OtpError" ||
              errMsg.includes("رمز") ||
              errMsg.includes("انتهت صلاحية") ||
              errMsg.includes("عدد المحاولات") ||
              errMsg.includes("لم يتم طلب رمز")
            ) {
              return json(
                { error: errMsg || "رمز التحقق غير صحيح أو منتهي الصلاحية" },
                { status: 400 },
              );
            }

            if (
              err instanceof PhoneAlreadyVerifiedError ||
              errName === "PhoneAlreadyVerifiedError" ||
              errMsg.includes("مستخدم في حساب آخر") ||
              /unique.*phone/i.test(errMsg)
            ) {
              return json({ error: "هذا الرقم مستخدم في حساب آخر" }, { status: 409 });
            }

            if (/unique.*email/i.test(errMsg)) {
              return json({ error: "هذا البريد مسجل مسبقاً" }, { status: 409 });
            }

            if (
              errMsg.includes("Missing or weak secret: SESSION_SECRET") ||
              errMsg.includes("SESSION_SECRET")
            ) {
              return json(
                {
                  error: "إعداد جلسات الحساب (SESSION_SECRET) مفقود في Cloudflare Secrets",
                  hint: "يجب تعيين المتغير SESSION_SECRET في Cloudflare Worker Secrets",
                },
                { status: 503 },
              );
            }

            const ref = errorRef();
            logServerError("api:otp", ref, err);
            return json(
              {
                error: "تعذر إكمال عملية التحقق",
                hint: `حدث خطأ في الخادم (${errMsg.slice(0, 120)}). عند مراسلة الدعم اذكر الرمز: ${ref}`,
                ref,
                actualError: errMsg,
              },
              { status: 500 },
            );
          }
        }, "otp"),

      /** Resend / attempt state, or Telegram verification session status. */
      GET: async ({ request }) =>
        guard(async () => {
          const url = new URL(request.url);
          const statusIdentity = (
            url.searchParams.get("verificationRef") ??
            url.searchParams.get("sessionId") ??
            url.searchParams.get("linkToken") ??
            url.searchParams.get("memberId") ??
            url.searchParams.get("phone") ??
            ""
          ).slice(0, 160);
          const throttle = await consumeRateLimit(
            request,
            "otp-status",
            120,
            15 * 60,
            statusIdentity,
          );
          if (!throttle.allowed) return rateLimitResponse(throttle.retryAfter);

          // Opaque verification reference: accepts either the website session
          // id or the Telegram launch token without relying on token length.
          const verificationRef = (url.searchParams.get("verificationRef") ?? "").trim();
          if (verificationRef) {
            const { verificationSessionStatus } = await import("@/lib/telegram-link.server");
            await ensureTelegramSchema();
            return json(await verificationSessionStatus(verificationRef));
          }

          // Verification session polling (Mini App flow)
          const sessionId = (url.searchParams.get("sessionId") ?? "").trim();
          if (sessionId) {
            const { getVerificationSession } = await import("@/lib/telegram-link.server");
            await ensureTelegramSchema();
            const session = await getVerificationSession(sessionId);
            if (!session) return json({ status: "unknown" });

            // Check expiry
            if (Date.parse(session.expires_at) < Date.now()) {
              return json({ status: "expired" });
            }

            return json({
              status: session.status,
              verifiedAt: session.verified_at,
            });
          }

          // Legacy link-token polling
          const linkToken = (url.searchParams.get("linkToken") ?? "").trim();
          if (linkToken) {
            await ensureTelegramSchema();
            return json(await linkTokenStatus(linkToken));
          }

          const purpose = (url.searchParams.get("purpose") ?? "signup") as OtpPurpose;
          const memberId = (url.searchParams.get("memberId") ?? "").replace(/\D/g, "");
          const key = memberId
            ? `member:${memberId}`
            : normalizePhone(url.searchParams.get("phone") ?? "");
          if (!key) return json({ error: "معرّف غير صحيح" }, { status: 400 });
          return json(await getOtpStatus(key, purpose));
        }, "otp"),
    },
  },
});
