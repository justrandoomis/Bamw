/**
 * The `product_requests` row as D1 stores it, and the object the app expects.
 *
 * D1 columns are snake_case; every reader in this codebase — the admin
 * requests screen, the customer's own history, the Telegram notifications —
 * reads the camelCase `ProductRequest`. `SELECT *` returns the row unchanged,
 * so handing it straight to those readers means every multi-word field is
 * `undefined`: the game name is blank, the date renders "Invalid Date", the
 * contact method shows "-", and the admin's reply never reaches the customer.
 * Only `id`, `platform`, `notes` and `status` survived, because those column
 * names happen to be one word.
 *
 * The translation therefore happens in exactly one place, named per field.
 * `SELECT *` with a cast cannot express it, and a generic snake→camel
 * converter would silently follow the schema wherever it drifted; this breaks
 * loudly at the type level instead.
 */

import type { ProductRequest } from "./types";

/** Exactly the columns of `product_requests`. See `SCHEMA` in d1.server.ts. */
export interface ProductRequestRow {
  id: string;
  user_id: string;
  request_type: string;
  product_name: string;
  game_id: string | null;
  platform: string | null;
  product_category: string | null;
  reference_url: string | null;
  notes: string | null;
  preferred_version: string | null;
  preferred_region: string | null;
  contact_method: string | null;
  status: string;
  admin_note: string | null;
  user_visible_note: string | null;
  linked_product_id: string | null;
  status_history: string | null;
  created_at: string;
  updated_at: string;
}

type HistoryEntry = ProductRequest["statusHistory"][number];

/** `undefined` rather than `null` or `""`, which is what the optional fields mean. */
function optional(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

/**
 * The stored status trail, or an empty one.
 *
 * The column holds JSON text written by this app, but it is still text in a
 * database: a truncated or hand-edited value must not take down the whole
 * requests screen with a parse error, and a shape that is not a list of status
 * entries is not a trail. Entries missing a status are dropped rather than
 * rendered as blanks in the customer's timeline.
 */
export function parseStatusHistory(raw: unknown): HistoryEntry[] {
  if (Array.isArray(raw)) return normaliseHistory(raw);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    return normaliseHistory(JSON.parse(raw));
  } catch {
    console.warn("[product_requests:unreadable_status_history]");
    return [];
  }
}

function normaliseHistory(parsed: unknown): HistoryEntry[] {
  if (!Array.isArray(parsed)) return [];
  const entries: HistoryEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const status = optional(record["status"]);
    if (!status) continue;
    entries.push({
      status,
      timestamp: String(record["timestamp"] ?? ""),
      ...(optional(record["note"]) ? { note: optional(record["note"]) } : {}),
    });
  }
  return entries;
}

/** One stored row, as the rest of the application reads it. */
export function toProductRequest(row: ProductRequestRow): ProductRequest {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? ""),
    requestType: String(row.request_type ?? "game"),
    productName: String(row.product_name ?? ""),
    gameId: optional(row.game_id),
    platform: optional(row.platform),
    productCategory: optional(row.product_category),
    referenceUrl: optional(row.reference_url),
    notes: optional(row.notes),
    preferredVersion: optional(row.preferred_version),
    preferredRegion: optional(row.preferred_region),
    contactMethod: optional(row.contact_method),
    status: String(row.status ?? "submitted"),
    adminNote: optional(row.admin_note),
    userVisibleNote: optional(row.user_visible_note),
    linkedProductId: optional(row.linked_product_id),
    statusHistory: parseStatusHistory(row.status_history),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}
