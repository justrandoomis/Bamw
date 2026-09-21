/**
 * Shared types for the order-centric support engine.
 *
 * The engine is pure: it receives an already-sanitised context (built on the
 * server by `support-context.server.ts`) and returns a reply. It never reads
 * the database, never calls an external API and never sees admin-only data.
 */

import type { ProductKind } from "../types";

export type SupportLang = "ar" | "en" | "ku" | "tr";

export type Confidence = "high" | "medium" | "low";

export type SupportIntent =
  | "greeting"
  | "order_status"
  | "order_where"
  | "payment_how"
  | "payment_receipt"
  | "delivery_address"
  | "account_credentials"
  | "account_login_problem"
  | "game_not_opening"
  | "primary_device"
  | "verification_code"
  | "refund_cancel"
  | "price_question"
  | "product_search"
  | "banana_wallet"
  | "warranty"
  | "tried_already"
  | "human_agent"
  | "thanks"
  | "unknown";

/** A single game/product the user actually owns through an order. */
export interface SafeOrderItem {
  id: string;
  productId: string;
  title: string;
  /*
    The same union as the catalogue's, by reference rather than by hand. This
    was a copy of `ProductKind` and the copy went stale the moment a new kind
    was named — a type error in a file that only passes the value through.
  */
  kind: ProductKind;
  quantity: number;
  /** delivered account email — only present once it was sent to this user */
  deliveryEmail?: string;
  credsSentAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
  completedAt?: string;
}

/** Order data allowed inside a support answer (no cost, no supplier, no profit). */
export interface SafeOrder {
  id: string;
  code: string;
  status: string;
  paymentStatus: string;
  total: number;
  currency: string;
  needsAddress: boolean;
  hasAddress: boolean;
  addressSummary?: string;
  items: SafeOrderItem[];
  threadId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Catalogue data allowed inside a support answer (public fields only). */
export interface SafeProduct {
  id: string;
  title: string;
  titleEn?: string;
  price: number;
  kind: ProductKind;
  genre?: string;
  publisher?: string;
  size?: string;
  players?: string;
  image?: string;
  tags?: string[];
}

/** Knowledge-base article (built-in list + admin managed guides). */
export interface KbArticle {
  id: string;
  title: string;
  /** words/phrases that point at this article (any language/dialect) */
  match: string[];
  /** clarifying question asked when the article is a weak match */
  ask?: string;
  steps: string[];
  /** device/error codes that map to this article */
  errorCodes?: string[];
  imageUrl?: string;
  /** escalate straight away instead of answering */
  escalate?: boolean;
}

/** What the engine remembers from the current conversation. */
export interface SupportMemory {
  /** kb article ids already offered in this thread */
  offeredArticles: string[];
  /** questions already asked, to avoid repeating them */
  askedQuestions: string[];
  /** last product/game the conversation focused on */
  focusProductId?: string;
  /** last order the conversation focused on */
  focusOrderCode?: string;
  /** the user said the previous solution did not work */
  failedAttempts: number;
  /** last device error code seen in this thread (typed or from a screenshot) */
  lastErrorCode?: string;
}

/**
 * The member's own wallet, as far as support is allowed to discuss it.
 *
 * Balances and their own pending top-ups only — never another member's data,
 * never an admin adjustment note, never a payment proof URL.
 */
export interface SafeWallet {
  balance: number;
  currency: string;
  bananaBalance: number;
  /** Top-up requests this member filed that staff have not settled yet. */
  pendingTopUps: { amount: number; method: string; createdAt: string }[];
  recentTransactions: { kind: string; amount: number; createdAt: string }[];
}

/** A trade-in this member submitted, with the staff notes stripped. */
export interface SafeTrade {
  id: string;
  gameName: string;
  status: string;
  offerIqd?: number;
  createdAt: string;
}

export interface SupportContext {
  lang: SupportLang;
  userName?: string;
  currencySymbol?: string;
  /** the order this thread belongs to (order chat) */
  activeOrder?: SafeOrder;
  orders: SafeOrder[];
  products: SafeProduct[];
  /** built-in + admin managed troubleshooting articles */
  articles: KbArticle[];
  policies?: { title: string; body: string }[];
  /** the member's own wallet — absent when it could not be read */
  wallet?: SafeWallet;
  /** the member's own trade-ins */
  trades?: SafeTrade[];
  memory: SupportMemory;
  /** page the user is on right now, sent by the client */
  pageContext?: { path?: string; productId?: string; productTitle?: string };
  /** recently viewed products (localStorage, client supplied — helper only) */
  viewHistory?: { productId: string; title: string }[];
}

export type SupportCard =
  | { kind: "product"; id: string; name: string; text: string; image?: string }
  | { kind: "order"; code: string; text: string }
  | { kind: "image"; url: string; text: string };

/** Admin-only decision trace. Never rendered to the user. */
export interface SupportTrace {
  intent: SupportIntent;
  candidates: SupportIntent[];
  confidence: Confidence;
  articleId?: string;
  orderCode?: string;
  productId?: string;
  errorCode?: string;
  reason: string;
}

export interface SupportReply {
  text: string;
  cards: SupportCard[];
  suggestions: string[];
  /** hand over to a human */
  escalate: boolean;
  /** memory to persist on the thread for the next turn */
  memory: SupportMemory;
  trace: SupportTrace;
}

export const emptyMemory = (): SupportMemory => ({
  offeredArticles: [],
  askedQuestions: [],
  failedAttempts: 0,
});
