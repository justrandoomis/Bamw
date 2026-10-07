import { DELIVERY_OTP_TTL_MINUTES } from "./delivery-otp";
import type { ChatMessage, MessageKind } from "./types";

/**
 * Strips hidden unicode formatting characters like RTL/LTR marks that could corrupt
 * code verification, credentials, or strings.
 */
export function sanitizeUnicodeString(input: unknown): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, "")
    .trim();
}

/**
 * Diagnostic logger for logging message rendering or normalization failures with
 * error.message + stack + conversation_id + message_id + message.type.
 */
export function logMessageDiagnosticError(
  error: unknown,
  context: {
    conversationId?: string | null;
    messageId?: string | null;
    messageType?: string | null;
    source?: string;
  },
) {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(
    `[ADMIN CHAT ERROR TRACE]\n` +
      `  • error.message: ${err.message}\n` +
      `  • stack: ${err.stack || "N/A"}\n` +
      `  • conversation_id: ${context.conversationId || "unknown"}\n` +
      `  • message_id: ${context.messageId || "unknown"}\n` +
      `  • message.type: ${context.messageType || "unknown"}\n` +
      `  • source: ${context.source || "render"}\n`,
  );
}

export interface NormalizedCardItem {
  kind: string;
  id?: string;
  name?: string;
  text?: string;
  image?: string;
  price?: string | number;
}

export interface NormalizedMessageBody extends Record<string, unknown> {
  text?: string;
  imageUrl?: string | null;
  /** A voice note's file, and its length from the recorder. */
  audioUrl?: string | null;
  durationMs?: number;
  images?: string[];
  code?: string | null;
  verificationCode?: string | null;
  activationCode?: string | null;
  cardCode?: string | null;
  cardType?: string | null;
  pin?: string | null;
  email?: string | null;
  accountUser?: string | null;
  password?: string | null;
  title?: string | null;
  gameName?: string | null;
  itemId?: string | null;
  expiresInMinutes?: number;
  instructions?: string | null;
  notes?: string | null;
  cards?: NormalizedCardItem[];
  suggestions?: string[];
  clientMessageId?: string;
  isCorrupted?: boolean;
  rawError?: string;
}

export interface NormalizedChatMessage extends ChatMessage {
  body: NormalizedMessageBody;
}

/**
 * Safely parses any payload or body into an object.
 */
function parseRawBody(body: unknown): Record<string, any> {
  if (!body) return {};
  if (typeof body === "object") {
    try {
      return { ...(body as Record<string, any>) };
    } catch {
      return {};
    }
  }
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return {};
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        return { text: trimmed };
      }
    }
    return { text: trimmed };
  }
  return {};
}

/**
 * Central Message Normalizer: converts any incoming/historical message record into a
 * completely sanitized, safe, and normalized ChatMessage structure.
 */
export function normalizeMessage(raw: unknown, threadIdFallback?: string): NormalizedChatMessage {
  try {
    const rawObj = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;

    const messageId =
      sanitizeUnicodeString(rawObj.id || rawObj.message_id || rawObj.messageId) ||
      `msg_gen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const threadId =
      sanitizeUnicodeString(rawObj.threadId || rawObj.thread_id || rawObj.conversation_id) ||
      threadIdFallback ||
      "";

    const senderRole = ["user", "admin", "assistant", "system"].includes(
      rawObj.senderRole || rawObj.sender_role,
    )
      ? rawObj.senderRole || rawObj.sender_role
      : rawObj.senderRole === "bot"
        ? "assistant"
        : "user";

    const senderName =
      sanitizeUnicodeString(rawObj.senderName || rawObj.sender_name || rawObj.authorName) ||
      (senderRole === "admin"
        ? "المشرف"
        : senderRole === "assistant"
          ? "الدعم الآلي"
          : senderRole === "system"
            ? "النظام"
            : "العميل");

    // Standardize ISO createdAt
    let createdAt = new Date().toISOString();
    const rawDate = rawObj.createdAt || rawObj.created_at || rawObj.timestamp;
    if (rawDate) {
      try {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          createdAt = d.toISOString();
        }
      } catch {
        // Keep default
      }
    }

    // Determine normalized kind
    const rawKind = sanitizeUnicodeString(
      rawObj.kind || rawObj.type || rawObj.message_type || "text",
    ).toLowerCase();
    let kind: MessageKind = "text";

    if (rawKind === "system" || senderRole === "system") {
      kind = "system";
    } else if (
      rawKind === "item_credentials" ||
      rawKind === "credentials" ||
      rawKind === "account_delivery"
    ) {
      kind = "item_credentials";
    } else if (
      rawKind === "item_verification_code" ||
      rawKind === "otp" ||
      rawKind === "verification"
    ) {
      kind = "item_verification_code";
    } else if (rawKind === "login_proof") {
      kind = "login_proof";
    } else if (rawKind === "image" || rawKind === "image/file" || rawKind === "file") {
      kind = "image";
    } else if (rawKind === "video") {
      kind = "video";
    } else if (rawKind === "audio" || rawKind === "voice") {
      kind = "audio";
    } else if (rawKind === "discount_code" || rawKind === "card" || rawKind === "activation_code") {
      kind = "discount_code";
    } else if (rawKind === "instructions") {
      kind = "instructions";
    } else {
      kind = "text";
    }

    // Parse and sanitize body fields
    const parsedBody = parseRawBody(rawObj.body ?? rawObj.payload);

    const text =
      typeof parsedBody.text === "string"
        ? parsedBody.text
        : typeof rawObj.text === "string"
          ? rawObj.text
          : undefined;

    const rawCode =
      parsedBody.code ??
      parsedBody.verificationCode ??
      parsedBody.verification_code ??
      parsedBody.activationCode ??
      parsedBody.cardCode;
    const sanitizedCode = rawCode ? sanitizeUnicodeString(rawCode) : null;

    const email =
      parsedBody.email ?? parsedBody.accountUser ?? parsedBody.account_user ?? parsedBody.username;
    const sanitizedEmail = email ? sanitizeUnicodeString(email) : null;

    const password = parsedBody.password ? sanitizeUnicodeString(parsedBody.password) : null;
    const pin = parsedBody.pin ? sanitizeUnicodeString(parsedBody.pin) : null;

    const title =
      parsedBody.title ??
      parsedBody.gameName ??
      parsedBody.game_name ??
      parsedBody.productTitle ??
      parsedBody.product_title;
    const sanitizedTitle = title ? sanitizeUnicodeString(title) : null;

    const itemId =
      parsedBody.itemId ??
      parsedBody.item_id ??
      parsedBody.delivery_item_id ??
      parsedBody.deliveryItemId;
    const sanitizedItemId = itemId ? sanitizeUnicodeString(itemId) : null;

    let imageUrl: string | null = null;
    if (parsedBody.imageUrl && typeof parsedBody.imageUrl === "string") {
      imageUrl = parsedBody.imageUrl.trim();
    } else if (parsedBody.mediaId) {
      imageUrl = `/api/files/legacy/${parsedBody.mediaId}`;
    } else if (rawObj.imageUrl && typeof rawObj.imageUrl === "string") {
      imageUrl = rawObj.imageUrl.trim();
    }

    let images: string[] = [];
    if (Array.isArray(parsedBody.images)) {
      images = parsedBody.images
        .map((img: unknown) => (typeof img === "string" ? img.trim() : ""))
        .filter(Boolean);
    }
    if (imageUrl && !images.includes(imageUrl)) {
      images.unshift(imageUrl);
    }

    // Normalize AI Assistant product/action cards
    let cards: NormalizedCardItem[] = [];
    if (Array.isArray(parsedBody.cards)) {
      cards = parsedBody.cards
        .filter((c) => c && typeof c === "object")
        .map((c) => ({
          kind: sanitizeUnicodeString(c.kind || "product"),
          id: c.id ? sanitizeUnicodeString(c.id) : undefined,
          name: c.name ? sanitizeUnicodeString(c.name) : undefined,
          text: c.text ? sanitizeUnicodeString(c.text) : undefined,
          image: typeof c.image === "string" ? c.image.trim() : undefined,
          price: c.price,
        }));
    }

    // Normalize suggestions
    let suggestions: string[] = [];
    if (Array.isArray(parsedBody.suggestions)) {
      suggestions = parsedBody.suggestions
        .map((s) => (typeof s === "string" ? sanitizeUnicodeString(s) : ""))
        .filter(Boolean);
    }

    /*
      A verification code is good for an hour. The fallback here was 10, so any
      card sent before the server started stamping the lifetime told the
      customer their code died fifty minutes early — the "why does it say 10
      minutes" complaint. The default is now the one TTL the whole delivery
      flow uses; `body.expiresAt` remains the authority when it is present.
    */
    const expiresInMinutes =
      typeof parsedBody.expiresInMinutes === "number" &&
      !isNaN(parsedBody.expiresInMinutes) &&
      parsedBody.expiresInMinutes > 0
        ? parsedBody.expiresInMinutes
        : typeof parsedBody.expires_in_minutes === "number" && parsedBody.expires_in_minutes > 0
          ? parsedBody.expires_in_minutes
          : DELIVERY_OTP_TTL_MINUTES;

    const normalizedBody: NormalizedMessageBody = {
      ...parsedBody,
      text,
      imageUrl,
      images,
      code: sanitizedCode,
      verificationCode: sanitizedCode,
      activationCode: parsedBody.activationCode
        ? sanitizeUnicodeString(parsedBody.activationCode)
        : null,
      cardCode: parsedBody.cardCode ? sanitizeUnicodeString(parsedBody.cardCode) : null,
      cardType: parsedBody.cardType ? sanitizeUnicodeString(parsedBody.cardType) : null,
      pin,
      email: sanitizedEmail,
      accountUser: sanitizedEmail,
      password,
      title: sanitizedTitle,
      gameName: sanitizedTitle,
      itemId: sanitizedItemId,
      expiresInMinutes,
      instructions: parsedBody.instructions ? String(parsedBody.instructions) : null,
      notes: parsedBody.notes ? String(parsedBody.notes) : null,
      cards,
      suggestions,
      clientMessageId: parsedBody.clientMessageId
        ? sanitizeUnicodeString(parsedBody.clientMessageId)
        : undefined,
    };

    return {
      id: messageId,
      threadId,
      senderRole,
      senderName,
      kind,
      body: normalizedBody,
      createdAt,
    };
  } catch (err) {
    logMessageDiagnosticError(err, {
      conversationId: threadIdFallback,
      messageId: (raw as any)?.id,
      messageType: (raw as any)?.kind,
      source: "normalizeMessage",
    });

    // Construct ultra-safe fallback message so that the thread never crashes
    return {
      id: (raw as any)?.id || `msg_fallback_${Date.now()}`,
      threadId: threadIdFallback || "",
      senderRole: "system",
      senderName: "النظام",
      kind: "system",
      body: {
        text: "تعذر معالجة هذه الرسالة",
        isCorrupted: true,
        rawError: err instanceof Error ? err.message : String(err),
      },
      createdAt: new Date().toISOString(),
    };
  }
}
