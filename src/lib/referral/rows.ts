/**
 * D1 rows in, application shapes out.
 *
 * The store's columns are snake_case and its types are camelCase, and casting
 * one to the other has silently emptied three separate features in this
 * codebase already — a cast type-checks against nothing and reads `undefined`
 * at runtime. Every referral reader goes through a mapper here.
 */

import {
  isAttributionStatus,
  isRewardStatus,
  type ReferralAttributionStatus,
  type ReferralRewardStatus,
} from "./status";

export interface ReferralCodeRow {
  id?: unknown;
  user_id?: unknown;
  code?: unknown;
  username_alias?: unknown;
  is_active?: unknown;
  blocked_reason?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface ReferralCode {
  id: string;
  userId: string;
  code: string;
  usernameAlias: string | null;
  isActive: boolean;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReferralAttributionRow {
  id?: unknown;
  referrer_user_id?: unknown;
  referred_user_id?: unknown;
  referral_code_id?: unknown;
  product_id?: unknown;
  guest_session_hash?: unknown;
  device_hash?: unknown;
  ip_hash?: unknown;
  status?: unknown;
  captured_at?: unknown;
  expires_at?: unknown;
  bound_at?: unknown;
  converted_order_id?: unknown;
  converted_at?: unknown;
  risk_score?: unknown;
  blocked_reason?: unknown;
  updated_at?: unknown;
}

export interface ReferralAttribution {
  id: string;
  referrerUserId: string;
  referredUserId: string | null;
  referralCodeId: string;
  productId: string | null;
  guestSessionHash: string;
  deviceHash: string | null;
  ipHash: string | null;
  status: ReferralAttributionStatus;
  capturedAt: string;
  expiresAt: string;
  boundAt: string | null;
  convertedOrderId: string | null;
  convertedAt: string | null;
  riskScore: number;
  blockedReason: string | null;
  updatedAt: string;
}

export interface ReferralRewardRow {
  id?: unknown;
  attribution_id?: unknown;
  order_id?: unknown;
  order_item_id?: unknown;
  product_id?: unknown;
  referrer_user_id?: unknown;
  buyer_user_id?: unknown;
  referral_code_id?: unknown;
  referral_code?: unknown;
  original_price_iqd?: unknown;
  buyer_discount_iqd?: unknown;
  referrer_reward_iqd?: unknown;
  reversed_amount_iqd?: unknown;
  buyer_percent_bps?: unknown;
  referrer_percent_bps?: unknown;
  status?: unknown;
  risk_score?: unknown;
  risk_verdict?: unknown;
  blocked_reason?: unknown;
  wallet_transaction_id?: unknown;
  hold_until?: unknown;
  approved_at?: unknown;
  reversed_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface ReferralReward {
  id: string;
  attributionId: string | null;
  orderId: string;
  orderItemId: string;
  productId: string;
  referrerUserId: string;
  buyerUserId: string;
  referralCodeId: string | null;
  referralCode: string | null;
  originalPriceIqd: number;
  buyerDiscountIqd: number;
  referrerRewardIqd: number;
  reversedAmountIqd: number;
  buyerPercentBps: number;
  referrerPercentBps: number;
  status: ReferralRewardStatus;
  riskScore: number;
  riskVerdict: string | null;
  blockedReason: string | null;
  walletTransactionId: string | null;
  holdUntil: string | null;
  approvedAt: string | null;
  reversedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReferralRiskEventRow {
  id?: unknown;
  attribution_id?: unknown;
  reward_id?: unknown;
  order_id?: unknown;
  referrer_user_id?: unknown;
  buyer_user_id?: unknown;
  event_type?: unknown;
  risk_score?: unknown;
  device_hash?: unknown;
  ip_hash?: unknown;
  metadata?: unknown;
  created_at?: unknown;
}

export interface ReferralRiskEvent {
  id: string;
  attributionId: string | null;
  rewardId: string | null;
  orderId: string | null;
  referrerUserId: string | null;
  buyerUserId: string | null;
  eventType: string;
  riskScore: number;
  deviceHash: string | null;
  ipHash: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function boolish(value: unknown, fallback = true): boolean {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return Number(value) !== 0;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function toReferralCode(row: ReferralCodeRow): ReferralCode {
  return {
    id: text(row.id),
    userId: text(row.user_id),
    code: text(row.code),
    usernameAlias: optionalText(row.username_alias),
    isActive: boolish(row.is_active),
    blockedReason: optionalText(row.blocked_reason),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

export function toReferralAttribution(row: ReferralAttributionRow): ReferralAttribution {
  const status = row.status;
  return {
    id: text(row.id),
    referrerUserId: text(row.referrer_user_id),
    referredUserId: optionalText(row.referred_user_id),
    referralCodeId: text(row.referral_code_id),
    productId: optionalText(row.product_id),
    guestSessionHash: text(row.guest_session_hash),
    deviceHash: optionalText(row.device_hash),
    ipHash: optionalText(row.ip_hash),
    // An unreadable status is treated as blocked rather than as the permissive
    // default: a row we cannot classify must never pay anybody.
    status: isAttributionStatus(status) ? status : "blocked",
    capturedAt: text(row.captured_at),
    expiresAt: text(row.expires_at),
    boundAt: optionalText(row.bound_at),
    convertedOrderId: optionalText(row.converted_order_id),
    convertedAt: optionalText(row.converted_at),
    riskScore: integer(row.risk_score),
    blockedReason: optionalText(row.blocked_reason),
    updatedAt: text(row.updated_at),
  };
}

export function toReferralReward(row: ReferralRewardRow): ReferralReward {
  const status = row.status;
  return {
    id: text(row.id),
    attributionId: optionalText(row.attribution_id),
    orderId: text(row.order_id),
    orderItemId: text(row.order_item_id),
    productId: text(row.product_id),
    referrerUserId: text(row.referrer_user_id),
    buyerUserId: text(row.buyer_user_id),
    referralCodeId: optionalText(row.referral_code_id),
    referralCode: optionalText(row.referral_code),
    originalPriceIqd: integer(row.original_price_iqd),
    buyerDiscountIqd: integer(row.buyer_discount_iqd),
    referrerRewardIqd: integer(row.referrer_reward_iqd),
    reversedAmountIqd: integer(row.reversed_amount_iqd),
    buyerPercentBps: integer(row.buyer_percent_bps),
    referrerPercentBps: integer(row.referrer_percent_bps),
    status: isRewardStatus(status) ? status : "blocked",
    riskScore: integer(row.risk_score),
    riskVerdict: optionalText(row.risk_verdict),
    blockedReason: optionalText(row.blocked_reason),
    walletTransactionId: optionalText(row.wallet_transaction_id),
    holdUntil: optionalText(row.hold_until),
    approvedAt: optionalText(row.approved_at),
    reversedAt: optionalText(row.reversed_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

export function toReferralRiskEvent(row: ReferralRiskEventRow): ReferralRiskEvent {
  return {
    id: text(row.id),
    attributionId: optionalText(row.attribution_id),
    rewardId: optionalText(row.reward_id),
    orderId: optionalText(row.order_id),
    referrerUserId: optionalText(row.referrer_user_id),
    buyerUserId: optionalText(row.buyer_user_id),
    eventType: text(row.event_type),
    riskScore: integer(row.risk_score),
    deviceHash: optionalText(row.device_hash),
    ipHash: optionalText(row.ip_hash),
    metadata: jsonObject(row.metadata),
    createdAt: text(row.created_at),
  };
}
