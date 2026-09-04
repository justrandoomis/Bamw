/**
 * What to tell a member, in Telegram, about a message the shop just sent them.
 *
 * ## The line it replaces
 *
 * `"${full.body["text"] || "أرسل صورة"}"`.
 *
 * That fallback is correct for exactly one kind of message: an attachment with
 * no caption. Every other admin-authored kind carries its content in named
 * fields and no `text` at all — the delivered account is
 * `{email, password, title, slot}`, the verification code is `{code, expiresAt}`
 * — so the buyer who had just been sent their game account received, on
 * Telegram, the words "أرسل صورة".
 *
 * They were told the shop had sent a picture, at the moment the thing they
 * paid for arrived. Which is worse than silence: silence sends them to look,
 * and this sends them away.
 *
 * ## What it will not do
 *
 * Carry the value. The password, the account e-mail and the one-time code stay
 * out of Telegram entirely — the shop's rule, and the right one: a Telegram
 * message is forwardable, searchable, and sits in a chat history on a phone
 * that may be handed to someone else. The member is told their account is
 * ready and sent to the app to read it, which is where it is already displayed.
 */

/** A message as `appendMessage` stores it. */
export interface StoredMessageShape {
  kind?: string | undefined;
  body?: Record<string, unknown> | undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * One line describing the message, safe to send to Telegram.
 *
 * Never empty: a message the shop sent is worth telling the member about even
 * when this does not recognise its kind, and "something arrived, go and look"
 * is a better outcome than silence or than a wrong description.
 */
export function memberMessagePreview(message: StoredMessageShape): string {
  const body = message.body ?? {};
  const kind = text(message.kind);
  const caption = text(body["text"]);
  const title = text(body["title"]);

  switch (kind) {
    case "item_credentials":
      /*
        Deliberately without the account. `body` holds `email` and `password`
        and neither goes any further than the app.
      */
      return title
        ? `🎮 بيانات حساب «${title}» جاهزة — افتح التطبيق لعرضها.`
        : "🎮 بيانات حسابك الرقمي جاهزة — افتح التطبيق لعرضها.";

    case "item_verification_code":
      /* And without the code, for the same reason and more so. */
      return title
        ? `🔐 وصل رمز التحقق الخاص بـ «${title}» — افتحه من التطبيق.`
        : "🔐 وصل رمز التحقق الخاص بطلبك — افتحه من التطبيق.";

    case "discount_code":
      return "🎁 وصلك كود خصم من فريق بنانتو — افتح التطبيق لعرضه.";

    case "shipping_update":
      return caption || "🚚 تحديث على شحن طلبك.";

    case "instructions":
      return caption || "📋 وصلتك خطوات جديدة من فريق الدعم.";

    case "image":
      /*
        The one case the old fallback described correctly — and a caption, when
        there is one, says more than the word "image" does.
      */
      return caption ? `📸 ${caption}` : "📸 أرسل لك فريق الدعم صورة.";

    default:
      return caption || "💬 وصلتك رسالة جديدة من فريق الدعم.";
  }
}
