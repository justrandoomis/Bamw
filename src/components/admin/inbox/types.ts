import type { Thread, ChatMessage, ThreadMode, Order } from "@/lib/types";

export type InboxFilter =
  | "order_queue"
  | "digital_queue"
  | "open_tickets"
  | "other_chats"
  | "queue"
  | "all"
  | "needs_reply"
  | "active_chats"
  | "active_orders"
  | "active_tickets"
  | "order_preparation"
  | "waiting_user"
  | "waiting_admin"
  | "escalated"
  | "completed_orders"
  | "closed_tickets";

export interface FilterOption {
  id: InboxFilter;
  label: string;
  countKey?: string;
  icon?: string;
  badgeColor?: string;
}

export interface QuickReply {
  id: string;
  title: string;
  text: string;
  category: "greeting" | "prep" | "done" | "request_info" | "troubleshoot" | "closing";
}

export interface AccountCredentialsPayload {
  platform?: string;
  email: string;
  password: string;
  backupCodes?: string;
  notes?: string;
}

export interface VerificationCodePayload {
  code: string;
  service?: string;
  expiresInMinutes?: number;
}

export interface InstructionsPayload {
  title: string;
  text: string;
  steps?: string[];
}

/**
 * What a surface hands up when the admin asks to complete an order by hand.
 * The counts are optional: only the delivery tool has the state loaded, and a
 * dialog that guessed a count would be worse than one that stays quiet.
 */
export interface ManualCompletionRequest {
  orderId: string;
  code: string;
  pendingCount?: number;
  unmappedCount?: number;
}
