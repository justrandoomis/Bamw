/**
 * AI understanding & generation layer (server only).
 *
 * Powered by Google Gemini (@google/genai). Provides deep store knowledge,
 * professional customer service tone, and strict language matching
 * (Arabic, English, Kurdish, Turkish).
 */

import { GoogleGenAI } from "@google/genai";
import { isUnderMaintenance } from "../maintenance";
import { findProducts } from "./intent";
import { contentTokens, detectLang, skeleton } from "./normalize";
import type { SupportCard, SupportContext, SupportIntent, SupportLang } from "./types";

const INTENTS: SupportIntent[] = [
  "greeting",
  "thanks",
  "human_agent",
  "order_status",
  "order_where",
  "payment_how",
  "payment_receipt",
  "delivery_address",
  "account_credentials",
  "account_login_problem",
  "game_not_opening",
  "primary_device",
  "verification_code",
  "refund_cancel",
  "price_question",
  "product_search",
  "banana_wallet",
  "warranty",
  "tried_already",
  "unknown",
];

export interface SupportHint {
  intent?: SupportIntent;
  productId?: string;
  matchedProductIds?: string[];
  articleId?: string;
  orderCode?: string;
  errorCode?: string;
  needsHuman?: boolean;
  generatedResponse?: string;
  generatedSuggestions?: string[];
}

/** Catalogue slice the model is allowed to choose from (public fields only). */
function candidateProducts(message: string, ctx: SupportContext) {
  const found = findProducts(message, ctx.products, 8);
  const keys = contentTokens(message)
    .map((token) => skeleton(token))
    .filter((key) => key.length > 1);

  const related = keys.length
    ? ctx.products.filter((product) =>
        [product.title, product.titleEn ?? ""].some((title) =>
          contentTokens(title).some((word) => keys.some((key) => skeleton(word) === key)),
        ),
      )
    : [];

  // Also include accessories / hardware if relevant
  const accessories =
    /accessories|accessory|controller|joycon|dock|case|grip|اكسسوار|يد|ملحق/i.test(message)
      ? ctx.products.filter((p) => p.kind === "accessory" || p.kind === "hardware")
      : [];

  const pool = [...found, ...accessories, ...related].slice(0, 30);
  const seen = new Set<string>();
  return pool.filter((product) => !seen.has(product.id) && seen.add(product.id));
}

function parseJson(raw: string): Record<string, unknown> | undefined {
  const text = raw.replace(/```json|```/g, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

let coolDownUntil = 0;
const COOL_DOWN_MS = 30_000;

function trip(reason: string) {
  coolDownUntil = Date.now() + COOL_DOWN_MS;
  console.error(`[support/understand] AI temporary cooldown: ${reason}`);
}

/**
 * Ask Gemini model for intelligent analysis & full multilingual reply generation.
 */
async function callGemini(
  systemInstruction: string,
  userPrompt: string,
): Promise<string | undefined> {
  if (Date.now() < coolDownUntil) return undefined;

  const apiKey = process.env.GEMINI_API_KEY || process.env.LOVABLE_API_KEY;
  if (!apiKey) return undefined;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });

    return response.text || undefined;
  } catch (err) {
    // Fallback: direct REST API if SDK encounters any environment difference
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        return data?.candidates?.[0]?.content?.parts?.[0]?.text;
      }
    } catch {
      // ignore
    }

    trip(`AI error: ${String(err)}`);
    return undefined;
  }
}

/**
 * Perform rich contextual understanding and generation.
 */
export async function understand(
  message: string,
  ctx: SupportContext,
  history: { role: "user" | "assistant"; text: string }[],
): Promise<SupportHint | undefined> {
  const targetLang = detectLang(message, ctx.lang);
  const products = candidateProducts(message, ctx);

  /*
    What the shop can do TODAY. A feature under maintenance is described as
    paused, so the model never invites a member through a door the server
    will refuse — the same rule the scripted answers in `engine.ts` follow.
  */
  const discTradeLine = isUnderMaintenance("discTrade")
    ? "Disc Trade / Exchange: UNDER MAINTENANCE — new trade-in requests are paused for now. Trades a member already submitted carry on and can be followed on the trade page."
    : "Disc Trade / Exchange: Users can exchange physical discs for new games or store credits.";
  const bananaLine =
    isUnderMaintenance("bananas") || isUnderMaintenance("bananaMarket")
      ? "Banana Wallet (محفظة الموز) & Banana Market: UNDER MAINTENANCE — earning, redeeming and trading bananas are paused for now; every balance is kept in full."
      : "Banana Wallet (محفظة الموز) & Banana Market: Reward points earned from orders; can be redeemed or traded in the live peer-to-peer Banana market.";

  const system = `You are the master customer support AI concierge for "Bananto Store" (بنانا ستور), the premier Nintendo Switch & gaming store in Iraq.

CRITICAL RULES:
1. RESPONSE LANGUAGE: You MUST respond in the EXACT SAME LANGUAGE as the user's message.
   - If the user wrote in English (or sent English chips like "Latest Accessories"), answer completely and professionally in English.
   - If the user wrote in Arabic, answer in polite, clear Arabic (Modern Standard / polite Iraqi context).
   - If the user wrote in Kurdish, answer in Kurdish (Kurmancî / Soranî).
   - If the user wrote in Turkish, answer in Turkish.
   Target language detected: "${targetLang}".

2. TONE & EXPERTISE:
   - Be extremely polite, professional, knowledgeable, welcoming, and concise.
   - Format answers cleanly with markdown bullet points where appropriate.
   - Never output broken or mixed language text.

3. BANANTO STORE KNOWLEDGE:
   - Specialization: Nintendo Switch consoles, games, digital accounts, physical discs, accessories, and subscriptions.
   - Digital Accounts: Primary accounts (play on your personal user, online/offline) and Secondary accounts (cost-effective, play on provided profile).
   - Delivery: Instant digital delivery in chat upon payment confirmation. Fast physical shipping to all Iraq governorates (Baghdad, Erbil, Basra, Sulaymaniyah, etc.) within 24-48h.
   - Payment Methods: ZainCash (زين كاش), FIB (First Iraqi Bank), AsiaPay (آسيا باي), Visa/Mastercard, Binance Pay (USDT Crypto), and Banana Wallet.
   - ${discTradeLine}
   - ${bananaLine}
   - Warranty: 100% full lifetime guarantee on digital accounts. Free replacement if any technical problem occurs.
   - Technical support: Provide step-by-step help for Nintendo Switch error codes, 2-step verification codes, account setup, offline mode, and DNS fixes (8.8.8.8 / 1.1.1.1).

4. ESCALATION:
   - If the user explicitly asks to speak with an admin / human / manager, or expresses strong frustration, set "needsHuman": true.

5. OUTPUT FORMAT (JSON ONLY):
Return a single JSON object with this schema:
{
  "intent": "greeting" | "product_search" | "order_status" | "payment_how" | "account_credentials" | "game_not_opening" | "banana_wallet" | "warranty" | "human_agent" | "unknown",
  "response": "Detailed, friendly, highly professional markdown response in the user's language.",
  "matchedProductIds": ["id1", "id2"],
  "articleId": "kb_xxx" or null,
  "orderCode": "BN-xxx" or null,
  "errorCode": "xxxx-xxxx" or null,
  "suggestions": ["Suggestion 1 in user language", "Suggestion 2", "Suggestion 3"],
  "needsHuman": false
}`;

  const payload = {
    userMessage: message,
    detectedLang: targetLang,
    clientSelectedLang: ctx.lang,
    userName: ctx.userName ?? null,
    orders: ctx.orders.slice(0, 5).map((o) => ({
      code: o.code,
      status: o.status,
      payment: o.paymentStatus,
      total: o.total,
      currency: o.currency,
      items: o.items.map((i) => ({ title: i.title, kind: i.kind })),
    })),
    activeOrder: ctx.activeOrder?.code ?? null,
    matchedProductsInCatalogue: products.map((p) => ({
      id: p.id,
      title: p.title,
      titleEn: p.titleEn ?? "",
      price: p.price,
      kind: p.kind,
      genre: p.genre,
    })),
    articles: ctx.articles.slice(0, 15).map((a) => ({
      id: a.id,
      title: a.title,
      steps: a.steps,
      errorCodes: a.errorCodes,
    })),
    conversationHistory: history.slice(-6),
  };

  const rawJson = await callGemini(system, JSON.stringify(payload));
  if (!rawJson) return undefined;

  const parsed = parseJson(rawJson);
  if (!parsed) return undefined;

  const intent = INTENTS.includes(parsed["intent"] as SupportIntent)
    ? (parsed["intent"] as SupportIntent)
    : undefined;

  const matchedProductIds = Array.isArray(parsed["matchedProductIds"])
    ? (parsed["matchedProductIds"] as string[]).filter((id) =>
        ctx.products.some((p) => p.id === id),
      )
    : [];

  const singleProductId =
    typeof parsed["productId"] === "string" &&
    ctx.products.some((p) => p.id === parsed["productId"])
      ? (parsed["productId"] as string)
      : matchedProductIds[0];

  const articleId =
    typeof parsed["articleId"] === "string" &&
    ctx.articles.some((a) => a.id === parsed["articleId"])
      ? (parsed["articleId"] as string)
      : undefined;

  const orderCode =
    typeof parsed["orderCode"] === "string" &&
    ctx.orders.some((o) => o.code === parsed["orderCode"])
      ? (parsed["orderCode"] as string)
      : undefined;

  const errorCode =
    typeof parsed["errorCode"] === "string" ? (parsed["errorCode"] as string) : undefined;

  const generatedResponse =
    typeof parsed["response"] === "string" && parsed["response"].trim().length > 0
      ? parsed["response"].trim()
      : undefined;

  const generatedSuggestions = Array.isArray(parsed["suggestions"])
    ? (parsed["suggestions"] as string[]).filter((s) => typeof s === "string" && s.trim())
    : undefined;

  return {
    ...(intent ? { intent } : {}),
    ...(singleProductId ? { productId: singleProductId } : {}),
    ...(matchedProductIds.length ? { matchedProductIds } : {}),
    ...(articleId ? { articleId } : {}),
    ...(orderCode ? { orderCode } : {}),
    ...(errorCode ? { errorCode } : {}),
    needsHuman: parsed["needsHuman"] === true,
    generatedResponse,
    generatedSuggestions,
  };
}
