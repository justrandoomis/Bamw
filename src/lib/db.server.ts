import type { Product } from "./types";
import { randomAvatar, randomDisplayName } from "./avatars";
import { readMessageRow } from "./chat-message-row";
import { DELIVERY_OTP_TTL_MINUTES, deliveryOtpExpiry } from "./delivery-otp";
import { randomId, hashPassword } from "./crypto.server";
import {
  d1All as d1RawAll,
  d1First as d1RawFirst,
  d1Run as d1RawRun,
  d1RunChanges,
  ensureSchema,
  ensureUsersSchema,
  getD1,
} from "./d1.server";
import { normalizePhone, arePhonesEqual } from "./phone";
import { listKeys, mutateJson, readJson, writeJson } from "./storage.server";
import {
  productIndexStatements,
  readProductIndexFingerprints,
} from "./product-index.server";
import { sendWhatsappMessage } from "./whatsapp.server";
import { sendTelegramMessage } from "./telegram.server";
import { isOwnerAccount } from "./owner-auth.server";
import {
  type AdminAvailabilityConfig,
  type AdminAvailabilityStatus,
  checkAdminAvailability,
  DEFAULT_AVAILABILITY_CONFIG,
} from "./admin-availability";
import { dedupeDevicePerformance, getDevicePerformanceList } from "./devicePerformance";
import {
  normalizeProductOption,
  normalizeProductType,
} from "./productOptionDescriptions";
export {
  isOwnerAccount,
  isOwnerEmail,
  isOwnerPhone,
  verifiedOwnerIdentity,
} from "./owner-auth.server";
export type { AdminAvailabilityConfig, AdminAvailabilityStatus };
export { checkAdminAvailability, DEFAULT_AVAILABILITY_CONFIG };

import type {
  Address,
  BananCode,
  ChatMessage,
  Gender,
  Order,
  PublicUser,
  StoreDoc,
  Thread,
  User,
  UserSettings,
  WalletRechargeRequest,
  RechargeRequestWithUser,
  RechargeMethod,
  RechargeStatus,
  WalletTransaction,
  WalletTransactionKind,
  ProductReview,
  ReviewStatus,
  Coupon,
  BananaLedgerEntry,
  BananaMarketOffer,
  BananaRedemptionOffer,
  BananaBot,
  StoreBanner,
  StoreGuide,
  ProblemSolution,
  GameRequest,
  DiscTrade,
  AuditLog,
  StoreNotification,
} from "./types";

/**
 * Executes multiple D1 statements in a single batch transaction.
 * Falls back to sequential execution in non-D1 environments.
 */
export async function d1Batch(sqls: { sql: string; params: unknown[] }[]) {
  const db = getD1();
  if (db && db.batch) {
    // `.bind()` with no arguments is not accepted by every D1 adapter, and a
    // parameterless statement (a plain DELETE) is a legitimate batch member.
    const stmts = sqls.map((s) =>
      s.params.length ? db.prepare(s.sql).bind(...s.params) : db.prepare(s.sql),
    );
    return db.batch(stmts);
  } else {
    for (const s of sqls) {
      await d1RawRun(s.sql, ...s.params);
    }
    return [];
  }
}

/**
 * Store an in-app notice for one member.
 *
 * The table has `type` and `reference_id`; it has never had a `link` column.
 * This function wrote `link`, so every insert failed with "no such column" and
 * no in-app notification was ever stored — the failure was invisible because a
 * second, losing `CREATE TABLE IF NOT EXISTS notifications` elsewhere in the
 * schema described the shape this code was written against. That duplicate is
 * gone, and `schema-coverage.test.ts` now holds this honest.
 */
export async function createNotification(
  userId: string,
  title: string,
  body: string,
  link?: string,
  type = "general",
) {
  await d1RawRun(
    `INSERT INTO notifications (id, user_id, title, body, type, reference_id, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    randomId("ntf"),
    userId,
    title,
    body,
    type,
    link || null,
    new Date().toISOString(),
  );
}

export async function createAuditLog(
  actorId: string,
  action: string,
  entityType?: string,
  entityId?: string,
  oldVal?: any,
  newVal?: any,
  details?: any,
) {
  await d1RawRun(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomId("aud"),
    actorId,
    action,
    entityType || null,
    entityId || null,
    oldVal ? JSON.stringify(oldVal) : null,
    newVal ? JSON.stringify(newVal) : null,
    details ? JSON.stringify(details) : null,
    new Date().toISOString(),
  );
}

// Export raw D1 helpers for use in other server routes
export const d1All = d1RawAll;
export const d1First = d1RawFirst;
export async function d1Run(
  sql: string,
  ...binds: unknown[]
): Promise<{ meta: { changes: number } }> {
  const changes = await d1RunChanges(sql, ...binds).catch(() => 0);
  return { meta: { changes } };
}
export const d1Execute = d1RawRun;
export { randomId, hashPassword } from "./crypto.server";

const STORE_KEY = "store.json";
const USERS_KEY = "users.json";
const ORDER_INDEX_KEY = "orders/index.json";
const THREAD_INDEX_KEY = "threads/index.json";

export const emptyStore: StoreDoc = {
  banners: [],
  products: [],
  categories: [],
  musicList: [],
  notifications: [],
  settings: {},
  quickReplies: [],
  autoReplies: {
    onlineIntro: "مرحباً بك! فريق الدعم متصل الآن وسيرد عليك خلال دقائق.",
    offlineIntro: "مرحباً بك! فريق الدعم غير متصل حالياً، اترك رسالتك وسيتم الرد قريباً.",
  },
  adminPresence: { online: false },
  paymentMethods: [],
  visits: 0,
  views: 0,
  gameRequests: [],
  discTrades: [],
  problemSolutions: [],
};

const defaultSettings: UserSettings = {
  language: "ar",
  theme: "light",
  soundEnabled: true,
  musicEnabled: true,
};

/** True when running on Cloudflare with the D1 binding available. */
export async function d1Ready() {
  if (!getD1()) return false;
  // When D1 is configured, schema/query failures must fail closed. Silently
  // falling back to JSON storage here creates a split-brain production store.
  await Promise.all([ensureSchema(), ensureUsersSchema()]);
  return true;
}

function parse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/* ---------------------------------- store --------------------------------- */

/**
 * The store document is one large JSON blob (the whole catalogue). Reading it
 * from D1 costs a full round trip, so keep the last copy in the isolate for a
 * few seconds and let bursts of requests share a single read.
 */
let storeCache: { doc: StoreDoc; at: number } | undefined;
let storeInFlight: Promise<StoreDoc> | undefined;
let storeCacheVersion = 0;
const STORE_TTL_MS = 60_000;

export function getStoreCacheVersion(): number {
  return storeCacheVersion;
}

export function invalidateStoreCache() {
  storeCache = undefined;
  storeInFlight = undefined;
  // The metadata snapshot is a projection of the same rows, so a write that
  // invalidates one has to invalidate the other or the two disagree.
  storeMetaCache = undefined;
  storeMetaInFlight = undefined;
  storeCacheVersion++;
}

/**
 * "This store is empty because the read failed", as distinct from "this store
 * is empty".
 *
 * Nothing downstream could tell those apart. A failed catalogue read was
 * swallowed into an empty row set, `getStore` returned `emptyStore`, and
 * `/api/data` served it as a perfectly good 200 — which the edge then cached
 * for five seconds and the service worker kept for six hours. The storefront
 * drew its section headings over nothing, with no error and no retry, because
 * as far as every layer knew the shop genuinely had no products.
 *
 * The marker is a symbol so it cannot reach a customer: `JSON.stringify`
 * ignores symbol keys, and it is defined non-enumerable so a spread of the
 * document does not carry it either. Callers ask {@link isStoreDegraded}.
 */
export const STORE_DEGRADED = Symbol.for("bananto.store.degraded");

/** Whether this document is a failure dressed as an empty catalogue. */
export function isStoreDegraded(store: unknown): boolean {
  if (!store || typeof store !== "object") return false;
  return (store as Record<symbol, unknown>)[STORE_DEGRADED] === true;
}

function asDegraded(doc: StoreDoc): StoreDoc {
  return Object.defineProperty({ ...doc }, STORE_DEGRADED, {
    value: true,
    enumerable: false,
  }) as StoreDoc;
}

/**
 * D1 rejects single column values above ~1MB, and the catalogue blob passed
 * that ceiling once products carried full hub data. The heavy sections are
 * therefore stored in their own rows (and split into chunks when a single
 * section is still too big), so saving a product never fails on size.
 */
const HEAVY_SECTIONS = ["products", "banners", "content", "bundles"] as const;
const CHUNK_LIMIT = 400_000;

export function isValidProductRecord(item: unknown): item is Product {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const p = item as Record<string, unknown>;
  const id =
    typeof p.id === "string"
      ? p.id.trim()
      : typeof p.id === "number"
        ? String(p.id).trim()
        : "";
  if (!id) return false;

  // Exclude known non-product sub-objects (like option ids, type ids, feature fragments)
  if (id.startsWith("opt_") || id.startsWith("typ_") || id.startsWith("feat_")) {
    return false;
  }

  const title =
    (typeof p.title === "string" && p.title.trim()) ||
    (typeof p.titleEn === "string" && p.titleEn.trim()) ||
    (typeof p.titleAr === "string" && p.titleAr.trim()) ||
    (typeof p.english_name === "string" && p.english_name.trim()) ||
    (typeof p.canonical_name === "string" && p.canonical_name.trim()) ||
    (typeof p.name === "string" && p.name.trim()) ||
    (typeof p.slug === "string" && p.slug.trim());

  if (!title) return false;

  return true;
}

const KNOWN_GAME_COVERS: Record<string, string> = {
  prd_ca9a9392db394624: "https://art.gametdb.com/switch/cover/US/AC4NA.jpg",
  prd_ebcb11cda2854251: "https://art.gametdb.com/switch/cover/US/AKZRA.jpg",
  prd_ed0f0c2742ab46d8: "https://art.gametdb.com/switch/cover/US/A24MA.jpg",
  prd_032470e4f7dd4cf0: "https://gamesdb-images.launchbox.gg/r2_a1a586f9-c64e-4401-9fa0-073209704dbe.jpg",
  prd_6e23a34819ac4bc6: "https://assets.nintendo.com/image/upload/ar_16:9,b_auto:border,c_lpad/b_white/f_auto/q_auto/dpr_1.5/store/software/switch2/70010000101665/3a8331b2f7b73d1fdb9b92dd9afdb2aff9602f1d89a9cfa171bf2561e480076e",
  prd_91e34a020d374ca5: "https://cdn.switch-images-julio.com/file/switch-images-julio/A7HLA/front.png",
  prd_6143c4166fc84049: "https://cdn.essential-japan.com/wp-content/uploads/2025/09/super-mario-galaxy-1-2-switch-2.webp",
  prd_7037e22716fa4681: "https://www.jnlgame.com/cdn/shop/files/71-VuMoP_vL.jpg?v=1772148408&width=5760",
  prd_7415614215294c49: "https://www.nintendo.com/my/games/switch2/aaaca/assets/img/product-img.jpg",
  prd_34be2de35cbe4d6b: "https://www.nintendo.com/ph/games/switch2/aaaaa/assets/img/product/package.webp",
  prd_3c36dc21c4964b5e: "https://www.nintendo.com/my/games/switch2/aadla/img/package.jpg",
  prd_10cbc863226547e2: "https://art.gametdb.com/switch/cover/US/AXN7A.jpg",
  prd_c5e13fa3f0c84edd: "https://cdn.switch-images-julio.com/file/switch-images-julio/AZ89A/front.png",
  prd_0dbec174d9834d8e: "https://art.gametdb.com/switch/cover/US/AAAAA.jpg",
  prd_8305beacb7f14685: "https://art.gametdb.com/switch/cover/US/AAACA.jpg",
};

function fixDisplayUrl(url?: string | null): string | undefined {
  if (!url || typeof url !== "string") return undefined;
  const trimmed = url.trim();
  const julioMatch = /switch-images-julio\.com\/.*\/display\/index\.html\?code=([A-Z0-9]+)/i.exec(trimmed);
  if (julioMatch && julioMatch[1]) {
    return `https://cdn.switch-images-julio.com/file/switch-images-julio/${julioMatch[1]}/front.png`;
  }
  return trimmed;
}

export function normalizeProductRecord(p: any): Product {
  if (!p || typeof p !== "object") {
    return {
      id: `prod_${Date.now()}`,
      title: "منتج بدون اسم",
      titleEn: "Untitled Product",
      slug: `prod-${Date.now()}`,
      price: 0,
      cost: 0,
      stock: 0,
      options: [],
      types: [],
      editions: [],
      dlcs: [],
      images: [],
      gallery: [],
      boxContents: [],
      modes: [],
    } as unknown as Product;
  }

  const id = String(p.id || "").trim();
  const rawTitle =
    (typeof p.title === "string" && p.title.trim()) ||
    (typeof p.titleAr === "string" && p.titleAr.trim()) ||
    (typeof p.name === "string" && p.name.trim()) ||
    (typeof p.titleEn === "string" && p.titleEn.trim()) ||
    (typeof p.english_name === "string" && p.english_name.trim()) ||
    (typeof p.canonical_name === "string" && p.canonical_name.trim()) ||
    id;

  const rawTitleEn =
    (typeof p.titleEn === "string" && p.titleEn.trim()) ||
    (typeof p.english_name === "string" && p.english_name.trim()) ||
    (typeof p.canonical_name === "string" && p.canonical_name.trim()) ||
    rawTitle;

  const title = rawTitle;
  const titleEn = rawTitleEn;
  const slug =
    typeof p.slug === "string" && p.slug.trim()
      ? p.slug.trim()
      : typeof p.id === "string" && p.id.trim()
        ? p.id.trim()
        : `product-${Date.now().toString(36)}`;

  const createdAt =
    p.createdAt ||
    p.created_at ||
    p.created_time ||
    p.createdTime ||
    (id.startsWith("prd_") ? new Date().toISOString() : undefined);
  const updatedAt = p.updatedAt || p.updated_at || createdAt || new Date().toISOString();

  // Normalize image fields and inject verified covers for known catalogue games
  const knownCover = KNOWN_GAME_COVERS[id];
  const boxFront = fixDisplayUrl(p.box_front_url || p.boxFrontUrl || (knownCover ? knownCover : undefined));
  const coverUrl = fixDisplayUrl(p.coverUrl || p.cover_front_url || p.cover_box_url || (knownCover ? knownCover : undefined));
  const cartridgeImage = fixDisplayUrl(p.cartridgeImage);
  const coverImage = fixDisplayUrl(p.coverImage);
  const image = fixDisplayUrl(p.image || boxFront || coverUrl || knownCover);

  return {
    ...p,
    id,
    title,
    titleEn,
    slug,
    ...(boxFront ? { box_front_url: boxFront, boxFrontUrl: boxFront } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(cartridgeImage ? { cartridgeImage } : {}),
    ...(coverImage ? { coverImage } : {}),
    ...(image ? { image } : {}),
    price: Number(p.price) || 0,
    cost: Number(p.cost) || 0,
    stock: Number(p.stock) || 0,
    sales: Number(p.sales) || 0,
    status: p.status || "نشط",
    isActive: p.isActive !== false,
    isHidden: p.isHidden === true,
    categoryId: p.categoryId || p.category || "cat_nintendo",
    category: p.category || p.categoryId || "cat_nintendo",
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
    options: Array.isArray(p.options)
      ? p.options.filter(Boolean).map((o: any) => normalizeProductOption(o))
      : [],
    types: Array.isArray(p.types)
      ? p.types.filter(Boolean).map((t: any) => normalizeProductType(t))
      : Array.isArray(p.variants)
        ? p.variants.filter(Boolean).map((t: any) => normalizeProductType(t))
        : [],
    editions: Array.isArray(p.editions)
      ? p.editions.filter(Boolean).map((e: any) => normalizeProductType(e))
      : [],
    dlcs: Array.isArray(p.dlcs) ? p.dlcs.filter(Boolean) : [],
    images: Array.isArray(p.images) ? p.images.filter(Boolean) : [],
    gallery: Array.isArray(p.gallery) ? p.gallery.filter(Boolean) : [],
    boxContents: Array.isArray(p.boxContents) ? p.boxContents.filter(Boolean) : [],
    modes: Array.isArray(p.modes) ? p.modes.filter(Boolean) : [],
    ...(p.devicePerformance || p.device_performance
      ? { devicePerformance: dedupeDevicePerformance(getDevicePerformanceList(p)) }
      : {}),
  };
}

function chunkJson(value: unknown): string[] {
  const raw = JSON.stringify(value ?? null);
  if (raw.length <= CHUNK_LIMIT) return [raw];
  const parts: string[] = [];
  for (let i = 0; i < raw.length; i += CHUNK_LIMIT) parts.push(raw.slice(i, i + CHUNK_LIMIT));
  return parts;
}

/**
 * Safely parse JSON array data, with automatic recovery/salvaging for truncated or slightly corrupted JSON.
 */
function parseArraySafely<T>(raw: string, fallback: T[] = []): T[] {
  if (!raw || typeof raw !== "string" || !raw.trim()) return fallback;
  const trimmed = raw.trim();
  try {
    const result = JSON.parse(trimmed);
    if (Array.isArray(result)) return result as T[];
    if (result && typeof result === "object") return [result as unknown as T];
  } catch (err) {
    console.warn("[parseArraySafely:attempting_salvage]", err);
  }

  // Robust object scanner to salvage all valid items even if some elements or boundaries are broken
  const items: T[] = [];
  let pos = 0;
  while (pos < trimmed.length) {
    const nextStart = trimmed.indexOf('{"', pos);
    if (nextStart === -1) break;

    let depth = 0;
    let inString = false;
    let escape = false;
    let foundEnd = -1;

    for (let i = nextStart; i < Math.min(trimmed.length, nextStart + 600000); i++) {
      const char = trimmed[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) {
          foundEnd = i;
          break;
        }
      }
    }

    if (foundEnd !== -1) {
      const candidate = trimmed.slice(nextStart, foundEnd + 1);
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object") {
          items.push(parsed as T);
        }
        pos = foundEnd + 1;
      } catch {
        pos = nextStart + 1;
      }
    } else {
      pos = nextStart + 1;
    }
  }

  return items.length > 0 ? items : fallback;
}

/**
 * Visit/view counters live in their own `store_kv` rows rather than inside the
 * store blob. Tracking a page view used to go through `updateStore()`, which
 * rewrites the entire catalogue (products, banners, content, bundles — hundreds
 * of KB) on every single hit and could clobber a concurrent admin edit. They are
 * overlaid onto the loaded document below so readers still see `store.visits`
 * and `store.views` exactly as before.
 */
const COUNTER_KEYS = { visits: "analytics:visits", views: "analytics:views" } as const;

/**
 * The revision the loaded document was read at.
 *
 * A write is only accepted when the catalogue has not moved since; see
 * `persistStore`. Kept beside the cached document rather than inside it so the
 * shape handed to callers never changes.
 */
let storeRev = 0;

async function readStoreRev(): Promise<number> {
  try {
    const row = await d1RawFirst<{ rev: number | null }>(`SELECT MAX(rev) as rev FROM store_rev`);
    return Number(row?.rev ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Everything except the catalogue.
 *
 * `store:products#NNN` chunks are 400 KB apiece and the per-product overlay
 * rows are the rest of the document; together they are almost all of it. A
 * caller that only wants categories, banners or settings was still reading,
 * transferring, parsing and normalising the entire catalogue to get them —
 * which is why `/api/admin/store`, an endpoint that *deletes* `products` from
 * its own response, was timing out alongside the products endpoint.
 */
const NON_PRODUCT_ROWS_SQL = `SELECT key, value FROM store_kv
   WHERE (key = 'store' OR key LIKE 'store:%' OR key LIKE 'analytics:%')
     AND key NOT LIKE 'store:product:%'
     AND key <> 'store:products'
     AND key NOT LIKE 'store:products#%'
   ORDER BY key ASC`;

const ALL_ROWS_SQL = `SELECT key, value FROM store_kv WHERE key = 'store' OR key LIKE 'store:%' OR key LIKE 'analytics:%' ORDER BY key ASC`;

async function loadStore(options?: { skipProducts?: boolean }): Promise<StoreDoc> {
  const skipProducts = options?.skipProducts === true;
  if (await d1Ready()) {
    /*
      A failed read is not an empty catalogue.

      This used to be `.catch(() => [])`, which turned a D1 timeout or a
      transient error into a store with no rows — and from there into a
      successful, cacheable, empty response that the storefront rendered as
      bare section headings. The error now travels; `getStore` decides what to
      serve instead (a stale snapshot when it has one) and marks the result
      when it has nothing.
    */
    const [allStoreRows, rev] = await Promise.all([
      d1RawAll<{ key: string; value: string }>(
        skipProducts ? NON_PRODUCT_ROWS_SQL : ALL_ROWS_SQL,
      ).catch((err) => {
        throw new Error(
          `store_rows_unreadable: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }),
      readStoreRev(),
    ]);
    storeRev = rev;
    const base = allStoreRows.find((r) => r.key === "store");
    const doc = { ...emptyStore, ...parse<Partial<StoreDoc>>(base?.value, {}) } as Record<
      string,
      unknown
    >;

    // Process each heavy section from the fetched rows
    for (const section of HEAVY_SECTIONS) {
      if (skipProducts && section === "products") {
        doc.products = [];
        continue;
      }
      try {
        const chunkRegex = new RegExp(`^store:${section}#(\\d+)$`);
        const chunkRows = allStoreRows
          .map((r) => {
            const m = r.key.match(chunkRegex);
            return m && m[1] ? { index: parseInt(m[1], 10), key: r.key, value: r.value } : null;
          })
          .filter((c): c is { index: number; key: string; value: string } => c !== null);

        let parsed: unknown;
        if (chunkRows.length > 0) {
          // Deduplicate chunks by numeric index
          const chunkMap = new Map<number, string>();
          for (const r of chunkRows) {
            chunkMap.set(r.index, r.value);
          }
          const sortedIndices = Array.from(chunkMap.keys()).sort((a, b) => a - b);
          const chunkedParts = sortedIndices.map((idx) => chunkMap.get(idx)!).join("");

          if (chunkedParts.trim()) {
            if (section === "content") {
              try {
                parsed = JSON.parse(chunkedParts);
              } catch {
                parsed = {};
              }
            } else {
              parsed = parseArraySafely(chunkedParts, []);
            }
          }

          // If joined chunks yielded empty or failed, salvage item-by-item from individual chunk rows
          if ((parsed === undefined || (Array.isArray(parsed) && parsed.length === 0)) && section !== "content") {
            const salvagedFromChunks: any[] = [];
            for (const r of chunkRows) {
              if (r.value && r.value.trim()) {
                const items = parseArraySafely(r.value, []);
                if (Array.isArray(items) && items.length > 0) {
                  salvagedFromChunks.push(...items);
                }
              }
            }
            if (salvagedFromChunks.length > 0) {
              parsed = salvagedFromChunks;
              console.warn(`[store:load_section:chunk_salvage_success] section=${section} salvagedCount=${salvagedFromChunks.length}`);
            }
          }
        }

        if (parsed === undefined || (Array.isArray(parsed) && parsed.length === 0)) {
          const baseRow = allStoreRows.find((r) => r.key === `store:${section}`);
          if (baseRow?.value && baseRow.value.trim()) {
            if (section === "content") {
              try {
                parsed = JSON.parse(baseRow.value);
              } catch (err) {
                console.warn(`[store:corrupt_content_isolated] section=${section}`);
                parsed = {};
              }
            } else {
              try {
                parsed = JSON.parse(baseRow.value);
              } catch (err) {
                const salvaged = parseArraySafely(baseRow.value, []);
                if (salvaged.length === 0) {
                  throw new Error(`store_section_unreadable:${section}`);
                }
                console.warn(`[store:corrupt_section_salvaged] section=${section} salvagedCount=${salvaged.length}`);
                parsed = salvaged;
              }
            }
          }
        }

        if (parsed !== undefined) {
          if (section === "products" && Array.isArray(parsed)) {
            const validProducts: Product[] = [];
            for (const item of parsed) {
              if (isValidProductRecord(item)) {
                validProducts.push(normalizeProductRecord(item));
              } else {
                console.warn(`[store:corrupt_product_isolated] Skipping invalid product record:`, {
                  id: (item as any)?.id,
                  title: (item as any)?.title,
                  type: typeof (item as any)?.title,
                });
              }
            }
            doc[section] = validProducts;
          } else {
            doc[section] = parsed;
          }
        }
      } catch (sectionErr) {
        console.error(`[store:load_section_failed] section=${section}`, sectionErr);
        if (sectionErr instanceof Error && sectionErr.message.startsWith('store_section_unreadable')) {
          throw sectionErr;
        }
        /*
          Emptying the failed section is fine for banners or bundles — the page
          loses a strip. For `products` it is the whole shop, and passing an
          empty array off as the catalogue is the fault this file exists to
          stop. It travels instead, so `getStore` can answer from its last good
          snapshot and mark the result if it has none.
        */
        if (section === "products") {
          throw new Error(
            `store_products_unreadable: ${sectionErr instanceof Error ? sectionErr.message : String(sectionErr)}`,
            { cause: sectionErr },
          );
        }
        doc[section] = section === "content" ? {} : [];
      }
    }

    // Load granular products and merge them
    try {
      const granularRows = skipProducts
        ? []
        : allStoreRows.filter((r) => r.key.startsWith("store:product:"));
      if (granularRows.length > 0) {
        if (!Array.isArray(doc.products)) {
          doc.products = [];
        }
        const granularProducts = granularRows.map((r) => {
          try {
            return JSON.parse(r.value);
          } catch {
            return null;
          }
        }).filter(Boolean);

        // Deduplicate: granular products overwrite chunked products
        const productsMap = new Map<string, any>();
        const existingIds = new Set((doc.products as any[]).map((p) => String(p?.id || "")));
        
        // 1. First add newly created granular products that aren't in base chunks yet (so they appear first!)
        for (const p of granularProducts) {
          if (p && p.id && !p._deleted && isValidProductRecord(p)) {
            const pid = String(p.id);
            if (!existingIds.has(pid)) {
              productsMap.set(pid, normalizeProductRecord(p));
            }
          }
        }

        // 2. Add base chunked products, overlaying any granular updates
        const granularMap = new Map<string, any>();
        for (const p of granularProducts) {
          if (p && p.id) {
            granularMap.set(String(p.id), p);
          }
        }

        for (const p of doc.products as any[]) {
          if (!p || !p.id) continue;
          const pid = String(p.id);
          const override = granularMap.get(pid);
          if (override) {
            if (!override._deleted && isValidProductRecord(override)) {
              productsMap.set(pid, normalizeProductRecord(override));
            }
          } else {
            productsMap.set(pid, p);
          }
        }

        doc.products = Array.from(productsMap.values());
      }
    } catch (err) {
      console.error(`[store:load_granular_products] failed`, err);
    }

    for (const [field, key] of Object.entries(COUNTER_KEYS)) {
      const row = allStoreRows.find((r) => r.key === key);
      if (!row) continue;
      const value = Number(row.value);
      if (Number.isFinite(value)) doc[field] = value;
    }

    // Ensure all sections are strictly sanitized arrays / objects
    const cleanList = <T>(list: unknown): T[] =>
      (Array.isArray(list) ? list : []).filter((x) => x && typeof x === "object") as T[];

    doc.products = cleanList<Product>(doc.products).filter(isValidProductRecord).map(normalizeProductRecord);

    // If products is completely empty, attempt recovery from game_catalog table
    const currentProducts = doc.products as Product[];
    if (currentProducts.length === 0) {
      try {
        const catalogRows = await d1RawAll<any>(
          `SELECT id, game_id, title, english_name, canonical_name, slug, release_date, description_en, description_ar, publisher, developer, box_front_url, cover_front_url, cover_box_url, metacritic_score, genres, is_active FROM game_catalog WHERE is_active = 1 OR is_active IS NULL LIMIT 2000`
        );
        if (catalogRows && catalogRows.length > 0) {
          const recoveredProducts: Product[] = [];
          for (const row of catalogRows) {
            const rowId = row.game_id || row.id || `prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const rowTitle = row.title || row.canonical_name || row.english_name || "Game";
            const rowImg = row.box_front_url || row.cover_front_url || row.cover_box_url || "";
            let genres: string[] = [];
            try {
              genres = JSON.parse(row.genres || "[]");
            } catch {
              genres = [];
            }
            recoveredProducts.push(
              normalizeProductRecord({
                id: String(rowId),
                title: String(rowTitle),
                titleEn: String(row.english_name || rowTitle),
                titleAr: String(rowTitle),
                slug: String(row.slug || rowId),
                price: 0,
                cost: 0,
                stock: 10,
                image: rowImg,
                gallery: rowImg ? [rowImg] : [],
                description: String(row.description_ar || row.description_en || ""),
                categories: genres.length > 0 ? genres : ["games"],
                tags: genres,
              })
            );
          }
          if (recoveredProducts.length > 0) {
            console.warn(`[store:recovered_from_game_catalog] Count=${recoveredProducts.length}`);
            doc.products = recoveredProducts;
          }
        }
      } catch (catErr) {
        console.warn(`[store:catalog_recovery_skipped]`, catErr);
      }
    }
    doc.categories = cleanList<any>(doc.categories).map((c: any) => ({
      ...c,
      id: String(c.id || ""),
      title: String(c.title || c.name || ""),
    }));
    doc.banners = cleanList(doc.banners);
    doc.bundles = cleanList<any>(doc.bundles).map((b: any) => ({
      ...b,
      gameIds: Array.isArray(b.gameIds) ? b.gameIds.filter(Boolean) : [],
    }));
    doc.musicList = cleanList(doc.musicList);
    doc.notifications = cleanList(doc.notifications);
    doc.gameRequests = cleanList(doc.gameRequests);
    doc.discTrades = cleanList(doc.discTrades);
    doc.problemSolutions = cleanList(doc.problemSolutions);
    doc.settings = doc.settings && typeof doc.settings === "object" ? doc.settings : {};

    return doc as unknown as StoreDoc;
  }
  return readJson<StoreDoc>(STORE_KEY, emptyStore);
}

/**
 * Bump the site counters without touching the catalogue.
 *
 * The increment happens inside the UPSERT so parallel hits add up instead of
 * overwriting each other. The first write seeds from whatever the store blob
 * already held, so existing totals carry over.
 */
export async function incrementSiteCounters(delta: {
  visits?: number;
  views?: number;
}): Promise<{ visits: number; views: number }> {
  const store = await getStore();
  const current = { visits: store.visits ?? 0, views: store.views ?? 0 };
  const next = {
    visits: current.visits + (delta.visits ?? 0),
    views: current.views + (delta.views ?? 0),
  };

  if (!(await d1Ready())) {
    await updateStore((doc) => ({ ...doc, ...next }));
    return next;
  }

  const now = new Date().toISOString();
  for (const [field, key] of Object.entries(COUNTER_KEYS) as ["visits" | "views", string][]) {
    const amount = delta[field] ?? 0;
    if (!amount) continue;
    await d1Execute(
      `INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = CAST(CAST(store_kv.value AS INTEGER) + ? AS TEXT),
         updated_at = excluded.updated_at`,
      key,
      String(next[field]),
      now,
      amount,
    );
  }

  // Keep the in-isolate cache coherent so the next reader does not serve a
  // stale total for the rest of the TTL.
  if (storeCache) storeCache = { doc: { ...storeCache.doc, ...next }, at: storeCache.at };
  return next;
}

class StoreConflictError extends Error {
  constructor() {
    super("store_revision_conflict");
  }
}

/**
 * Write the whole catalogue, atomically, and only if nobody else has.
 *
 * ## Why a revision guard
 *
 * The catalogue is one document, so every save rewrites all of it from the
 * snapshot the request started with. Two saves that overlap therefore do not
 * merge — the second one's snapshot simply does not contain the first one's
 * change, and writing it erases that change. Across Workers isolates, each with
 * its own read cache, this is not a rare race: a product created a moment ago
 * disappears, and a product deleted a moment ago comes back.
 *
 * `store_rev` closes it. Every write inserts the next revision number, and the
 * primary key makes a second writer at the same revision fail rather than
 * overwrite. The failure rolls back the whole batch, and `updateStore` re-reads
 * and re-applies the change to the newer catalogue.
 *
 * ## Why one batch
 *
 * The base row, four heavy sections and their chunk cleanups are a dozen
 * statements. Run one at a time, a failure halfway leaves a catalogue whose
 * sections disagree — products from the new save, bundles from the old. D1's
 * `batch` runs them in a single transaction, so the store either moves forward
 * completely or not at all.
 */
async function persistStore(next: StoreDoc, expectedRev: number): Promise<number> {
  const now = new Date().toISOString();
  const nextRev = expectedRev + 1;
  const statements: { sql: string; params: unknown[] }[] = [];

  // Ensure products are completely valid and normalized before persisting to D1
  if (Array.isArray(next.products)) {
    const cleanProducts: Product[] = [];
    for (const p of next.products) {
      if (isValidProductRecord(p)) {
        cleanProducts.push(normalizeProductRecord(p));
      } else {
        console.error(`[store:persist_corrupt_product_prevented] Filtered out invalid product before persist:`, {
          id: (p as any)?.id,
          title: (p as any)?.title,
        });
      }
    }
    next = {
      ...next,
      products: cleanProducts,
    };
  }

  /*
    The guard, first: a duplicate primary key aborts the transaction before any
    catalogue row is touched. An UPDATE ... WHERE would report zero changes and
    let the rest of the batch commit regardless, which is exactly the overwrite
    this exists to prevent.
  */
  statements.push({
    sql: `INSERT INTO store_rev (rev, updated_at) VALUES (?, ?)`,
    params: [nextRev, now],
  });

  const write = (key: string, value: string) =>
    statements.push({
      sql: `INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      params: [key, value, now],
    });

  const base = { ...(next as unknown as Record<string, unknown>) };
  for (const section of HEAVY_SECTIONS) delete base[section];
  write("store", JSON.stringify(base));

  for (const section of HEAVY_SECTIONS) {
    const parts = chunkJson((next as unknown as Record<string, unknown>)[section]);
    // Always clear old chunks for this section to prevent stale or duplicate chunk keys
    statements.push({
      sql: `DELETE FROM store_kv WHERE key LIKE ?`,
      params: [`store:${section}#%`],
    });

    if (parts.length === 1) {
      write(`store:${section}`, parts[0]!);
    } else {
      // Multi-part payloads are stored as `store:section#001…` so the loader can
      // stitch them back together in order.
      write(`store:${section}`, "");
      for (let i = 0; i < parts.length; i++) {
        write(`store:${section}#${String(i + 1).padStart(3, "0")}`, parts[i]!);
      }
    }
  }

  /*
    The admin listing projection, in the same batch as the catalogue it
    describes. Committing them together is what makes the projection safe to
    read as authoritative: it cannot exist without the products it came from,
    and a failed catalogue write leaves neither behind.

    Only the rows that changed. A save edits one product; rewriting the whole
    table to reflect it would be hundreds of statements on every save, because
    D1 caps a statement at 100 bound variables and a projection row is 27 of
    them. Reading the current fingerprints costs one narrow indexed scan and
    turns a typical save into a single INSERT OR REPLACE.
  */
  const currentIndex = await readProductIndexFingerprints().catch((err) => {
    // A projection that cannot be read is rebuilt wholesale rather than skipped
    // — a stale listing is worse than a slower save.
    console.warn("[product_index:fingerprints_unavailable]", err);
    return undefined;
  });
  statements.push(
    ...productIndexStatements(
      (next.products ?? []) as Record<string, unknown>[],
      nextRev,
      currentIndex,
    ),
  );

  /*
    Tombstones are redundant once the aggregate is rewritten without them.

    A delete writes `store:product:<id>` with `_deleted: true` and leaves the
    aggregate alone, because rewriting ten megabytes to remove one product is
    what made sequential deletes degrade. The rows are tiny, but they are also
    unbounded — so the next full aggregate write, which by construction already
    excludes every tombstoned product, clears them. Only `_deleted` rows: a live
    granular overlay is somebody else's unsaved write.
  */
  statements.push({
    sql: `DELETE FROM store_kv WHERE key LIKE 'store:product:%' AND value LIKE '%"_deleted":true%'`,
    params: [],
  });

  // Keep the revision table at a single row.
  statements.push({ sql: `DELETE FROM store_rev WHERE rev < ?`, params: [nextRev] });

  try {
    /*
      `d1Batch` runs the statements in one transaction where the binding
      supports it, and falls back to running them in order where it does not.
      In the fallback the revision guard still holds — the insert is first, and
      a duplicate revision throws before any catalogue row is written — but the
      section writes are not one transaction, which is the best that backend
      can offer.
    */
    await d1Batch(statements);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|constraint|primary key/i.test(message)) throw new StoreConflictError();
    throw err;
  }

  return nextRev;
}

/**
 * Last time this isolate confirmed its snapshot against the durable revision.
 *
 * A Worker runs many isolates and each keeps its own `storeCache` for up to
 * `STORE_TTL_MS`. `invalidateStoreCache()` only ever clears the isolate that
 * handled the mutation, so the *next* request — very likely a different isolate
 * — kept answering from a snapshot taken up to a minute earlier. That is why a
 * product deleted or edited in Admin could still be served to the storefront,
 * and no amount of client-side cache busting could fix it: the server itself
 * was returning the old catalogue.
 *
 * `store_rev` is written by `persistStore` inside the same transaction as the
 * catalogue, so it is the one number every isolate agrees on. Confirming a
 * cached snapshot against it costs a single indexed read of a one-row table,
 * which is far cheaper than the full catalogue load it protects.
 */
let storeRevCheckedAt = 0;

/*
  A single request calls `getStore()` several times. This window collapses
  those into one revision check without letting a snapshot outlive a mutation
  in any way a person could notice.
*/
const REV_CHECK_GRACE_MS = 250;

/**
 * The durable catalogue version: the revision every isolate agrees on.
 *
 * Exposed so API responses can carry it (`catalogVersion`, `ETag`) and a client
 * can tell a changed catalogue from an unchanged one without diffing payloads.
 */
export async function getCatalogVersion(): Promise<number> {
  if (!(await d1Ready())) return storeRev;
  const rev = await readStoreRev();
  return rev || storeRev;
}

/**
 * Store metadata without the catalogue: categories, banners, bundles, content,
 * settings, counters.
 *
 * Its own cache slot, because it is a different document — caching it as
 * `storeCache` would hand a later caller a store whose `products` array is
 * empty and let it conclude the catalogue was deleted. Callers that need
 * products call {@link getStore}; callers that never look at them (the admin
 * store endpoint, settings) call this and skip almost the entire payload.
 */
let storeMetaCache: { doc: StoreDoc; at: number } | undefined;
let storeMetaInFlight: Promise<StoreDoc> | undefined;

export function invalidateStoreMetaCache() {
  storeMetaCache = undefined;
  storeMetaInFlight = undefined;
}

/**
 * Moves the catalogue revision without rewriting the catalogue.
 *
 * A delete does not change the products blob any more — it writes a tombstone,
 * which every read already honours — but it *is* a catalogue change, and every
 * isolate's snapshot, the edge ETag and the browser's stored snapshot are all
 * keyed on this number. So the revision moves on its own: two small writes
 * instead of a full rewrite of a document that can run to ten megabytes.
 *
 * Returns the new revision so the caller can hand it to the client, which uses
 * it to refuse a snapshot older than the change it just made.
 */
export async function bumpCatalogVersion(): Promise<number> {
  if (!(await d1Ready())) {
    storeRev += 1;
    invalidateStoreCache();
    return storeRev;
  }
  const current = await readStoreRev();
  const next = current + 1;
  const now = new Date().toISOString();
  await d1Batch([
    { sql: `INSERT INTO store_rev (rev, updated_at) VALUES (?, ?)`, params: [next, now] },
    { sql: `DELETE FROM store_rev WHERE rev < ?`, params: [next] },
  ]);
  storeRev = next;
  invalidateStoreCache();
  return next;
}

export async function getStoreMeta(): Promise<StoreDoc> {
  const cached = storeMetaCache;
  if (cached && Date.now() - cached.at < STORE_TTL_MS) return cached.doc;
  if (storeMetaInFlight) return storeMetaInFlight;

  storeMetaInFlight = loadStore({ skipProducts: true })
    .then((doc) => {
      storeMetaCache = { doc, at: Date.now() };
      return doc;
    })
    .finally(() => {
      storeMetaInFlight = undefined;
    });
  return storeMetaInFlight;
}

export async function getStore(): Promise<StoreDoc> {
  const now = Date.now();
  // Captured because the awaits below mean the module-level cache could be
  // replaced underneath this call.
  const cached = storeCache;
  if (cached && now - cached.at < STORE_TTL_MS) {
    // Within the TTL the snapshot is still only trustworthy if nothing has been
    // written since it was taken — by this isolate or any other.
    if (now - storeRevCheckedAt < REV_CHECK_GRACE_MS) return cached.doc;
    if (await d1Ready()) {
      try {
        const durableRev = await readStoreRev();
        storeRevCheckedAt = Date.now();
        if (durableRev === storeRev) return cached.doc;
        console.info("[store:stale_snapshot_refreshed]", { had: storeRev, now: durableRev });
        storeCache = undefined;
        storeCacheVersion++;
      } catch {
        // A failed revision check must not take the catalogue down; the TTL
        // remains the fallback bound on staleness.
        storeRevCheckedAt = Date.now();
        return cached.doc;
      }
    } else {
      return cached.doc;
    }
  }

  if (storeInFlight) return storeInFlight;

  const loadWithTimeout = async (): Promise<StoreDoc> => {
    return Promise.race([
      loadStore(),
      new Promise<StoreDoc>((_, reject) =>
        setTimeout(() => reject(new Error("loadStore_timeout_exceeded")), 25000),
      ),
    ]);
  };

  storeRevCheckedAt = Date.now();
  storeInFlight = loadWithTimeout()
    .then((doc) => {
      // Only cache if doc has meaningful data
      if (doc && (doc.products?.length > 0 || doc.categories?.length > 0)) {
        storeCache = { doc, at: Date.now() };
      } else if (storeCache?.doc && (storeCache.doc.products?.length ?? 0) > 0) {
        // Retain previous cache if loaded doc was unexpectedly empty
        return storeCache.doc;
      }
      return doc;
    })
    .catch(async (err) => {
      console.error("[getStore:failed_or_timed_out]", err);
      if (err instanceof Error && err.message.startsWith('store_section_unreadable')) {
        throw err;
      }
      if (storeCache?.doc && (storeCache.doc.products?.length ?? 0) > 0) {
        console.warn("[getStore:serving_stale_cache_on_error]");
        return storeCache.doc;
      }
      try {
        const fileDoc = await readJson<StoreDoc>(STORE_KEY, emptyStore);
        if (fileDoc && (fileDoc.products?.length ?? 0) > 0) {
          return fileDoc;
        }
      } catch {
        // ignore fallback error
      }
      /*
        Nothing left to serve. The shape callers expect is still returned so a
        page can render its shell rather than crash, but it is marked: an
        endpoint must not pass this off as the catalogue, and none of it may be
        cached anywhere.
      */
      console.error("[getStore:degraded_empty_store] no snapshot and no file fallback");
      return asDegraded(emptyStore);
    })
    .finally(() => {
      storeInFlight = undefined;
    });

  return storeInFlight;
}

export async function updateStore(mutate: (current: StoreDoc) => StoreDoc | void): Promise<StoreDoc> {
  let current = await getStore();
  let next = (mutate(current) ?? current) as StoreDoc;

  if (await d1Ready()) {
    /*
      Read fresh, then write under the revision the read saw.

      `getStore()` may be up to a minute stale, and every isolate keeps its own
      copy — so mutating the cached document and writing the result is how a
      product saved seconds ago on another isolate got erased, and how a
      deleted one came back. The first attempt therefore re-reads from D1, and
      a losing writer re-reads and re-applies its change rather than
      overwriting the winner.
    */
    let saved = false;
    for (let attempt = 0; attempt < 4 && !saved; attempt++) {
      current = await loadStore();
      next = (mutate(current) ?? current) as StoreDoc;
      try {
        storeRev = await persistStore(next, storeRev);
        saved = true;
      } catch (err) {
        if (!(err instanceof StoreConflictError)) {
          console.error("[store:write_failed]", {
            attempt,
            products: (next?.products ?? []).length,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
        console.warn("[store:revision_conflict]", { attempt, rev: storeRev });
        storeCache = undefined;
      }
    }
    if (!saved) {
      throw new Error("store_write_conflict");
    }
  } else {
    /*
      No D1. `mutateJson` writes to the filesystem in development and to an
      in-memory map in a Worker, where it is lost when the isolate ends — so
      say so rather than reporting a save that did not durably happen.
    */
    console.warn("[store:no_d1]", { products: (next?.products ?? []).length });
    await mutateJson<StoreDoc>(STORE_KEY, emptyStore, (c) => mutate(c) ?? c);
  }

  storeCache = { doc: next, at: Date.now() };

  // Notification: Product Price Change.
  // Collect the changes first: the previous version called getUsers() — a full
  // table scan — once per repriced product, so a bulk catalogue save loaded
  // every user hundreds of times while the admin's request was still open.
  const previousPrices = new Map(
    (current.products ?? []).map((product) => [String(product.id), product.price]),
  );
  const repriced = (next.products ?? []).filter((product) => {
    const before = previousPrices.get(String(product.id));
    return before !== undefined && before !== product.price;
  });

  if (repriced.length > 0) {
    const users = await getUsers();
    const watchers = users.filter((u) => u.telegramId && u.favorites?.length);
    for (const product of repriced) {
      const before = previousPrices.get(String(product.id));
      for (const watcher of watchers) {
        if (!watcher.favorites?.includes(product.id)) continue;
        await sendTelegramMessage(
          watcher.telegramId!,
          `🔔 *تنبيه تغيير السعر*\n\nتغير سعر المنتج *${product.title}* الذي تتابعه.\n\nالسعر السابق: ${before} IQD\nالسعر الجديد: ${product.price} IQD`,
        );
      }
    }
  }

  return next;
}

/* -------------------------- admin availability ---------------------------- */

export async function getAdminAvailabilityConfig(): Promise<AdminAvailabilityConfig> {
  if (await d1Ready()) {
    const row = await d1First<{ value: string }>(
      `SELECT value FROM store_kv WHERE key = ?`,
      "admin_availability",
    );
    if (row?.value) {
      return {
        ...DEFAULT_AVAILABILITY_CONFIG,
        ...parse<Partial<AdminAvailabilityConfig>>(row.value, {}),
      };
    }
  }
  const store = await getStore();
  const raw = store.settings?.["admin_availability"];
  if (raw && typeof raw === "object") {
    return { ...DEFAULT_AVAILABILITY_CONFIG, ...(raw as Partial<AdminAvailabilityConfig>) };
  }
  if (store.adminPresence) {
    return {
      ...DEFAULT_AVAILABILITY_CONFIG,
      mode: store.adminPresence.online ? "available" : "unavailable",
    };
  }
  return DEFAULT_AVAILABILITY_CONFIG;
}

export async function saveAdminAvailabilityConfig(
  config: Partial<AdminAvailabilityConfig>,
): Promise<AdminAvailabilityConfig> {
  const current = await getAdminAvailabilityConfig();
  const next: AdminAvailabilityConfig = {
    ...current,
    ...config,
    updatedAt: new Date().toISOString(),
  };

  if (await d1Ready()) {
    await d1Execute(
      `INSERT INTO store_kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      "admin_availability",
      JSON.stringify(next),
      next.updatedAt,
    );
  }

  const availability = checkAdminAvailability(next);

  await updateStore((s) => ({
    ...s,
    adminPresence: {
      online: availability.isAvailable,
      updatedAt: next.updatedAt,
    },
    settings: {
      ...s.settings,
      admin_availability: next,
    },
  }));

  return next;
}

export async function getAdminAvailabilityStatus(): Promise<AdminAvailabilityStatus> {
  const config = await getAdminAvailabilityConfig();
  return checkAdminAvailability(config);
}

/* ---------------------------------- users --------------------------------- */

interface UserRow {
  id: string;
  name: string;
  username: string | null;
  member_no: string | null;
  email: string;
  email_verified_at?: string | null;
  phone: string | null;
  phone_verified_at: string | null;
  password_hash: string;
  avatar: string | null;
  gender: string | null;
  birth_date: string | null;
  preferred_genres: string | null;
  profile_completed_at: string | null;
  is_admin: number;
  provider: string;
  provider_id: string | null;
  settings: string;
  addresses: string;
  favorites: string;
  friend_id?: string | null;
  wallet_balance: number;
  banana_balance: number;
  banana_locked: number;
  created_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    ...(row.username ? { username: row.username } : {}),
    ...(row.member_no ? { memberNo: row.member_no } : {}),
    email: row.email,
    ...(row.email_verified_at ? { emailVerifiedAt: row.email_verified_at } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.phone_verified_at ? { phoneVerifiedAt: row.phone_verified_at } : {}),
    passwordHash: row.password_hash,
    ...(row.avatar ? { avatar: row.avatar } : {}),
    ...(row.gender ? { gender: row.gender as Gender } : {}),
    ...(row.birth_date ? { birthDate: row.birth_date } : {}),
    preferredGenres: parse<string[]>(row.preferred_genres, []),
    ...(row.profile_completed_at ? { profileCompletedAt: row.profile_completed_at } : {}),
    isAdmin: row.is_admin === 1,
    provider: (row.provider as User["provider"]) ?? "password",
    ...(row.provider_id ? { providerId: row.provider_id } : {}),
    settings: { ...defaultSettings, ...parse<Partial<UserSettings>>(row.settings, {}) },
    addresses: parse<Address[]>(row.addresses, []),
    favorites: parse<(string | number)[]>(row.favorites, []),
    ...(row.friend_id ? { friendId: row.friend_id } : {}),
    walletBalance: row.wallet_balance ?? 0,
    bananaBalance: row.banana_balance ?? 0,
    bananaLocked: row.banana_locked ?? 0,
    createdAt: row.created_at,
  };
}

async function upsertUserRow(user: User) {
  await d1Execute(
    `INSERT INTO users (id, name, username, member_no, email, email_verified_at, phone, phone_verified_at, password_hash, avatar,
       gender, birth_date, preferred_genres, profile_completed_at, is_admin, provider,
       provider_id, settings, addresses, favorites, friend_id, wallet_balance, banana_balance, banana_locked, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, username = excluded.username, member_no = excluded.member_no,
       email = excluded.email, email_verified_at = excluded.email_verified_at,
       phone = excluded.phone,
       phone_verified_at = excluded.phone_verified_at,
       password_hash = excluded.password_hash, avatar = excluded.avatar,
       gender = excluded.gender, birth_date = excluded.birth_date,
       preferred_genres = excluded.preferred_genres,
       profile_completed_at = excluded.profile_completed_at,
       is_admin = excluded.is_admin, provider = excluded.provider,
       provider_id = excluded.provider_id, settings = excluded.settings,
        addresses = excluded.addresses, favorites = excluded.favorites,
        friend_id = excluded.friend_id,
        wallet_balance = excluded.wallet_balance,
        banana_balance = excluded.banana_balance,
        banana_locked = excluded.banana_locked`,
    user.id,
    user.name,
    user.username ?? null,
    user.memberNo ?? null,
    user.email,
    user.emailVerifiedAt ?? null,
    user.phone ?? null,
    user.phoneVerifiedAt ?? null,
    user.passwordHash,
    user.avatar ?? null,
    user.gender ?? null,
    user.birthDate ?? null,
    JSON.stringify(user.preferredGenres ?? []),
    user.profileCompletedAt ?? null,
    user.isAdmin ? 1 : 0,
    user.provider ?? "password",
    user.providerId ?? null,
    JSON.stringify(user.settings),
    JSON.stringify(user.addresses),
    JSON.stringify(user.favorites),
    user.friendId ?? null,
    user.walletBalance ?? 0,
    user.bananaBalance ?? 0,
    user.bananaLocked ?? 0,
    user.createdAt,
  );
  return user;
}

export async function getUsers(): Promise<User[]> {
  if (await d1Ready()) {
    const rows = await d1All<UserRow>(`SELECT * FROM users ORDER BY created_at ASC`);
    return rows.map(rowToUser);
  }
  return readJson<User[]>(USERS_KEY, []);
}

export async function countUsers(): Promise<number> {
  if (await d1Ready()) {
    const row = await d1First<{ total: number }>(`SELECT COUNT(*) AS total FROM users`);
    return Number(row?.total ?? 0);
  }
  return (await getUsers()).length;
}

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, providerId: _providerId, ...rest } = user;
  return rest;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const normalized = email.trim().toLowerCase();
  if (await d1Ready()) {
    const row = await d1First<UserRow>(`SELECT * FROM users WHERE email = ?`, normalized);
    return row ? rowToUser(row) : undefined;
  }
  return (await getUsers()).find((u) => u.email.toLowerCase() === normalized);
}

export async function findUserById(id: string): Promise<User | undefined> {
  if (await d1Ready()) {
    const row = await d1First<UserRow>(`SELECT * FROM users WHERE id = ?`, id);
    return row ? rowToUser(row) : undefined;
  }
  return (await getUsers()).find((u) => u.id === id);
}

export async function findUserByPhone(phone: string): Promise<User | undefined> {
  const norm = normalizePhone(phone);
  const clean = phone.replace(/[^\d+]/g, "");
  if (await d1Ready()) {
    const row = await d1First<UserRow>(
      `SELECT * FROM users WHERE phone = ? OR phone = ? OR phone = ? LIMIT 1`,
      phone,
      norm || phone,
      clean,
    );
    return row ? rowToUser(row) : undefined;
  }
  return (await getUsers()).find(
    (u) => u.phone && (u.phone === phone || u.phone === norm || arePhonesEqual(u.phone, phone)),
  );
}

export async function findUserByUsername(username: string): Promise<User | undefined> {
  const normalized = username.trim().toLowerCase().replace(/^@/, "");
  if (!normalized) return undefined;
  if (await d1Ready()) {
    const row = await d1First<UserRow>(`SELECT * FROM users WHERE lower(username) = ?`, normalized);
    return row ? rowToUser(row) : undefined;
  }
  return (await getUsers()).find((u) => (u.username ?? "").toLowerCase() === normalized);
}

export async function findUserByMemberNo(memberNo: string): Promise<User | undefined> {
  const normalized = memberNo.trim().replace(/\D/g, "");
  if (!normalized) return undefined;
  if (await d1Ready()) {
    const row = await d1First<UserRow>(`SELECT * FROM users WHERE member_no = ?`, normalized);
    return row ? rowToUser(row) : undefined;
  }
  return (await getUsers()).find((u) => u.memberNo === normalized);
}

/**
 * Try one lookup without letting it take the whole sign-in down.
 *
 * `member_no` and `username` are columns added by a schema patch. On a database
 * where that patch never landed the query fails with "no such column", and a
 * single unusable lookup used to turn every sign-in — including ones by email
 * or phone that would have succeeded — into a bare `server_error`.
 */
async function tryLookup(
  label: string,
  lookup: () => Promise<User | undefined>,
): Promise<User | undefined> {
  try {
    return await lookup();
  } catch (error) {
    console.error(`[auth:lookup] ${label} unavailable:`, (error as Error).message);
    return undefined;
  }
}

/** Sign-in accepts a username, a phone number, an email or a membership number. */
export async function findUserByIdentifier(identifier: string): Promise<User | undefined> {
  const trimmed = identifier.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("@") && !trimmed.startsWith("@")) return findUserByEmail(trimmed);

  const digitsOnly = /^[\d\s+\-()]+$/.test(trimmed);
  if (digitsOnly) {
    const phone = normalizePhone(trimmed);
    if (phone) {
      const byPhone = await tryLookup("phone", () => findUserByPhone(phone));
      if (byPhone) return byPhone;
    }
    const byMember = await tryLookup("member_no", () => findUserByMemberNo(trimmed));
    if (byMember) return byMember;
  }

  const byUsername = await tryLookup("username", () => findUserByUsername(trimmed));
  if (byUsername) return byUsername;

  return tryLookup("email", () => findUserByEmail(trimmed));
}

/** banan + short random suffix, guaranteed free. */
export async function generateUsername(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 5);
    const candidate = `banan${suffix}`;
    if (!(await findUserByUsername(candidate))) return candidate;
  }
  return `banan${Date.now().toString(36)}`;
}

/** Sequential membership numbers starting at 10001 (custom ones sold later). */
export async function nextMemberNo(): Promise<string> {
  const base = 10001 + (await countUsers());
  for (let candidate = base; candidate < base + 200; candidate += 1) {
    if (!(await findUserByMemberNo(String(candidate)))) return String(candidate);
  }
  return String(Date.now()).slice(-8);
}

export async function setUserPassword(id: string, password: string) {
  const passwordHash = await hashPassword(password);
  return updateUser(id, (user) => ({ ...user, passwordHash }));
}

export class PhoneAlreadyVerifiedError extends Error {
  constructor() {
    super("PHONE_ALREADY_VERIFIED");
    this.name = "PhoneAlreadyVerifiedError";
  }
}

/**
 * Attach a phone only after its OTP has been accepted.
 *
 * Failed/incomplete registrations may leave an unverified row holding the
 * unique phone value. A signed-in OAuth account that proves ownership of that
 * phone is allowed to reclaim it, while a verified account can never be
 * displaced. The D1 batch makes the release + claim atomic.
 */
export async function setPhoneVerified(id: string, phone: string) {
  const current = await findUserById(id);
  if (!current) return undefined;
  const existing = await findUserByPhone(phone);
  if (existing && existing.id !== id && existing.phoneVerifiedAt) {
    throw new PhoneAlreadyVerifiedError();
  }

  const verifiedAt = new Date().toISOString();
  if (await d1Ready()) {
    const statements: { sql: string; params: unknown[] }[] = [];
    if (existing && existing.id !== id) {
      statements.push({
        sql: `UPDATE users SET phone = NULL, phone_verified_at = NULL
              WHERE id = ? AND phone = ? AND phone_verified_at IS NULL`,
        params: [existing.id, phone],
      });
    }
    statements.push({
      sql: `UPDATE users SET phone = ?, phone_verified_at = ? WHERE id = ?`,
      params: [phone, verifiedAt, id],
    });
    try {
      await d1Batch(statements);
    } catch (error) {
      // A concurrent verification may have claimed the number between the
      // read and the batch. Report a stable conflict instead of server_error.
      if (/unique|constraint/i.test(error instanceof Error ? error.message : String(error))) {
        throw new PhoneAlreadyVerifiedError();
      }
      throw error;
    }
    return findUserById(id);
  }

  const users = await getUsers();
  const conflict = users.find(
    (user) => user.phone === phone && user.id !== id && Boolean(user.phoneVerifiedAt),
  );
  if (conflict) throw new PhoneAlreadyVerifiedError();
  let updated: User | undefined;
  const next = users.map((user) => {
    if (user.id === id) {
      updated = { ...user, phone, phoneVerifiedAt: verifiedAt };
      return updated;
    }
    if (user.phone === phone && !user.phoneVerifiedAt) {
      const { phone: _phone, phoneVerifiedAt: _phoneVerifiedAt, ...rest } = user;
      return rest as User;
    }
    return user;
  });
  await writeJson(USERS_KEY, next);
  return updated;
}

/** Promote only after a provider/OTP has verified the supplied owner identity. */
export async function ensureOwnerAdmin(
  user: User,
  verifiedIdentity: { email?: string; phone?: string },
): Promise<User> {
  if (user.isAdmin) return user;
  if (!isOwnerAccount(verifiedIdentity)) return user;
  const updated = await updateUser(user.id, (current) => ({ ...current, isAdmin: true }));
  return updated ?? { ...user, isAdmin: true };
}

export async function createUser(input: {
  name: string;
  email: string;
  emailVerifiedAt?: string;
  phone?: string;
  phoneVerifiedAt?: string;
  password?: string;
  isAdmin?: boolean;
  provider?: User["provider"];
  providerId?: string;
  avatar?: string;
}): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const user: User = {
    id: randomId("usr"),
    name: input.name || randomDisplayName(),
    username: await generateUsername(),
    memberNo: await nextMemberNo(),
    email,
    ...(input.emailVerifiedAt ? { emailVerifiedAt: input.emailVerifiedAt } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.phoneVerifiedAt ? { phoneVerifiedAt: input.phoneVerifiedAt } : {}),
    passwordHash: input.password ? await hashPassword(input.password) : "",
    avatar: input.avatar || randomAvatar(),
    gender: "unspecified",
    preferredGenres: [],
    // The caller must have completed a provider/OTP ownership proof before it
    // may request administrator rights. Merely typing an owner identity is
    // never sufficient.
    isAdmin: input.isAdmin === true,

    provider: input.provider ?? "password",
    ...(input.providerId ? { providerId: input.providerId } : {}),
    settings: { ...defaultSettings },
    addresses: [],
    favorites: [],
    walletBalance: 0,
    createdAt: new Date().toISOString(),
  };

  if (await d1Ready()) return upsertUserRow(user);
  const users = await getUsers();
  await writeJson(USERS_KEY, [...users, user]);
  return user;
}

export async function updateUser(
  id: string,
  mutate: (user: User) => User,
): Promise<User | undefined> {
  if (await d1Ready()) {
    const current = await findUserById(id);
    if (!current) return undefined;
    return upsertUserRow(mutate(current));
  }
  const users = await getUsers();
  let updated: User | undefined;
  const next = users.map((user) => {
    if (user.id !== id) return user;
    updated = mutate(user);
    return updated;
  });
  await writeJson(USERS_KEY, next);
  return updated;
}

/** Sign in with Google / Apple: link by provider id, then by email, else create. */
export async function findOrCreateOAuthUser(profile: {
  provider: "google" | "apple";
  providerId: string;
  email: string;
  name: string;
  avatar?: string;
}): Promise<User> {
  const now = new Date().toISOString();
  let user: User | undefined;

  if (await d1Ready()) {
    const linked = await d1First<UserRow>(
      `SELECT * FROM users WHERE provider = ? AND provider_id = ?`,
      profile.provider,
      profile.providerId,
    );
    if (linked) {
      const u = rowToUser(linked);
      if (!u.emailVerifiedAt) {
        await updateUser(u.id, (prev) => ({ ...prev, emailVerifiedAt: now }));
        u.emailVerifiedAt = now;
      }
      user = await ensureOwnerAdmin(u, { email: profile.email });
    }
  }

  if (!user) {
    const existing = await findUserByEmail(profile.email);
    if (existing) {
      const updated = await updateUser(existing.id, (u) => ({
        ...u,
        provider: profile.provider,
        providerId: profile.providerId,
        emailVerifiedAt: u.emailVerifiedAt || now,
        ...(u.avatar ? {} : profile.avatar ? { avatar: profile.avatar } : {}),
      }));
      user = await ensureOwnerAdmin(updated ?? existing, { email: profile.email });
    } else {
      user = await createUser({
        name: profile.name,
        email: profile.email,
        emailVerifiedAt: now,
        provider: profile.provider,
        providerId: profile.providerId,
        ...(profile.avatar ? { avatar: profile.avatar } : {}),
        isAdmin: isOwnerAccount({ email: profile.email }),
      });
    }
  }

  // Auto-claim legacy accounts matching verified OAuth email (Idempotent retry for all OAuth logins)
  if (user && user.email) {
    try {
      const { claimLegacyAccount } = await import("./legacy-claim.server");
      await claimLegacyAccount({
        userId: user.id,
        email: user.email,
        claimType: profile.provider === "google" ? "oauth_google" : "oauth_apple",
      });
    } catch (claimErr) {
      console.error("[OAuth] legacy claim check error:", claimErr);
    }
  }

  return user;
}

/* --------------------------------- orders --------------------------------- */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateOrderIntegrity(order: unknown): { ok: boolean; reason?: string } {
  if (!order || typeof order !== "object") return { ok: false, reason: "invalid_order_object" };
  const o = order as Record<string, unknown>;

  if (!o.id || typeof o.id !== "string" || !o.id.trim())
    return { ok: false, reason: "missing_order_id" };
  if (!o.userId || typeof o.userId !== "string" || !o.userId.trim())
    return { ok: false, reason: "missing_user_id" };
  if (!o.code || typeof o.code !== "string" || !o.code.trim())
    return { ok: false, reason: "missing_order_code" };

  const total = Number(o.total);
  if (!Number.isFinite(total) || total <= 0 || Number.isNaN(total)) {
    return { ok: false, reason: "invalid_total_amount" };
  }

  const items = o.items;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, reason: "empty_order_items" };
  }

  for (const item of items) {
    if (!item || typeof item !== "object") return { ok: false, reason: "invalid_item_object" };
    const it = item as Record<string, unknown>;

    if (it.productId === undefined || it.productId === null || it.productId === "") {
      return { ok: false, reason: "missing_product_id" };
    }

    if (!it.title || typeof it.title !== "string" || !it.title.trim()) {
      return { ok: false, reason: "missing_item_title" };
    }
    const cleanTitle = it.title.trim();
    if (
      UUID_PATTERN.test(cleanTitle) ||
      cleanTitle.toLowerCase() === "undefined" ||
      cleanTitle.toLowerCase() === "null" ||
      cleanTitle.toLowerCase() === "nan"
    ) {
      return { ok: false, reason: "illegal_uuid_or_corrupt_title" };
    }

    const unitPrice = Number(it.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0 || Number.isNaN(unitPrice)) {
      return { ok: false, reason: "invalid_unit_price" };
    }

    const quantity = Number(it.quantity);
    if (!Number.isFinite(quantity) || quantity < 1) {
      return { ok: false, reason: "invalid_quantity" };
    }
  }

  return { ok: true };
}

/**
 * Reasons that make an order impossible to identify or render at all.
 *
 * Everything else — a missing item title, a total that does not add up — makes
 * an order *degraded*, not unreadable, and a degraded order must still be
 * visible. Every read path used to `.filter(validateOrderIntegrity(o).ok)`, so
 * one item with an empty title made a paid order vanish from the admin's queue
 * and from the customer's own list. Nobody could see it to fix it, and nothing
 * said why: the exact "order stuck and invisible" complaint.
 *
 * A degraded order is now returned, and the surfaces render what is wrong with
 * it — {@link ORDER_ITEM_TITLE_UNAVAILABLE_AR} in place of a name it does not
 * have, rather than a plausible-looking stand-in.
 */
const FATAL_INTEGRITY_REASONS = new Set([
  "invalid_order_object",
  "missing_order_id",
  "missing_user_id",
]);

export function isOrderReadable(order: unknown): boolean {
  const check = validateOrderIntegrity(order);
  if (check.ok) return true;
  const reason = check.reason ?? "unknown";
  if (FATAL_INTEGRITY_REASONS.has(reason)) {
    console.warn("[orders:dropped_unreadable]", {
      orderId: (order as { id?: unknown } | null)?.id ?? null,
      reason,
    });
    return false;
  }
  console.warn("[orders:degraded]", {
    orderId: (order as { id?: unknown } | null)?.id ?? null,
    reason,
  });
  return true;
}

export function orderKey(id: string) {
  return `orders/${id}.json`;
}

export async function getOrder(id: string): Promise<Order | undefined> {
  if (!id) return undefined;
  if (await d1Ready()) {
    const row = await d1First<{ doc: string }>(
      `SELECT doc FROM orders WHERE id = ? OR code = ? LIMIT 1`,
      id,
      id,
    );
    if (!row) return undefined;
    const parsed = parse<Order | undefined>(row.doc, undefined);
    return parsed && isOrderReadable(parsed) ? parsed : undefined;
  }
  const direct = await readJson<Order | undefined>(orderKey(id), undefined);
  if (direct && isOrderReadable(direct)) return direct;
  const all = await listOrders();
  return all.find((o) => o.id === id || o.code === id);
}

export async function listOrders(limit?: number): Promise<Order[]> {
  if (await d1Ready()) {
    const rows =
      limit && limit > 0
        ? await d1All<{ doc: string }>(
            `SELECT doc FROM orders ORDER BY created_at DESC LIMIT ?`,
            limit,
          )
        : await d1All<{ doc: string }>(`SELECT doc FROM orders ORDER BY created_at DESC`);
    return rows.map((r) => parse<Order>(r.doc, {} as Order)).filter((o) => o && isOrderReadable(o));
  }
  const ids = await readJson<string[]>(ORDER_INDEX_KEY, []);
  const orders = await Promise.all(ids.map((id) => getOrder(id)));
  const all = orders.filter((o): o is Order => !!o && isOrderReadable(o));
  return limit && limit > 0 ? all.slice(0, limit) : all;
}

/**
 * A member's own orders, resolved by the `orders_user_idx` index.
 *
 * The member-facing screens used to call listOrders() and filter in JS, which
 * pulled every order in the database into the isolate and JSON-parsed all of
 * them just to show one customer their handful of purchases.
 */
export async function listOrdersByUser(userId: string, limit = 200): Promise<Order[]> {
  if (await d1Ready()) {
    const rows = await d1All<{ doc: string }>(
      `SELECT doc FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      userId,
      limit,
    );
    return rows.map((r) => parse<Order>(r.doc, {} as Order)).filter((o) => o && isOrderReadable(o));
  }
  const all = await listOrders();
  return all.filter((order) => order.userId === userId && isOrderReadable(order)).slice(0, limit);
}

export async function saveOrder(order: Order): Promise<Order> {
  const check = validateOrderIntegrity(order);
  if (!check.ok) {
    const reason = check.reason ?? "unknown";
    /*
      Refuse only what cannot be identified. Rejecting every imperfection here
      would undo the point of keeping degraded orders readable: an admin could
      finally see the order with the unnameable item, and then no action on it
      — sending an account, completing it — could ever be saved. Log the flaw
      loudly and let the work proceed.

      Only ids and the reason are logged; an order carries the credentials it
      was delivered with.
    */
    if (FATAL_INTEGRITY_REASONS.has(reason)) {
      console.error("[saveOrder:integrity_failed]", { orderId: order?.id ?? null, reason });
      throw new Error(`order_integrity_violation: ${reason}`);
    }
    console.warn("[saveOrder:degraded]", { orderId: order?.id ?? null, reason });
  }

  if (await d1Ready()) {
    try {
      await d1Execute(
        `INSERT INTO orders (
          id, code, user_id, doc, status, payment_status, total, created_at, updated_at, cancelled_at,
          idempotency_key, checkout_session_id, payment_reference, source, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET 
          code = excluded.code, 
          user_id = excluded.user_id,
          doc = excluded.doc, 
          status = excluded.status,
          payment_status = excluded.payment_status,
          total = excluded.total,
          updated_at = excluded.updated_at,
          cancelled_at = excluded.cancelled_at,
          idempotency_key = excluded.idempotency_key,
          checkout_session_id = excluded.checkout_session_id,
          payment_reference = excluded.payment_reference,
          source = excluded.source,
          created_by = excluded.created_by`,
        order.id,
        order.code,
        order.userId,
        JSON.stringify(order),
        order.status,
        order.paymentStatus,
        order.total,
        order.createdAt,
        order.updatedAt,
        order.cancelledAt || (order.status === "cancelled" ? order.updatedAt : null),
        order.idempotencyKey || null,
        order.checkoutSessionId || null,
        order.paymentReference || null,
        order.source || "checkout_web",
        order.createdBy || order.userId,
      );
    } catch {
      await d1Execute(
        `INSERT INTO orders (id, code, user_id, doc, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET code = excluded.code, user_id = excluded.user_id,
           doc = excluded.doc, updated_at = excluded.updated_at`,
        order.id,
        order.code,
        order.userId,
        JSON.stringify(order),
        order.createdAt,
        order.updatedAt,
      );
    }
    return order;
  }
  await writeJson(orderKey(order.id), order);
  await mutateJson<string[]>(ORDER_INDEX_KEY, [], (ids) =>
    ids.includes(order.id) ? ids : [order.id, ...ids],
  );
  return order;
}

export async function deleteOrder(id: string): Promise<boolean> {
  if (await d1Ready()) {
    // 1. Fetch order details before deleting to clean up thread/messages if needed
    const existing = await getOrder(id);
    const threadId = existing?.threadId;

    // 2. Delete main order row
    await d1Execute(`DELETE FROM orders WHERE id = ?`, id);

    // 3. Clean up associated dependencies safely
    try {
      await d1Execute(`DELETE FROM order_items_snapshot WHERE order_id = ?`, id);
      await d1Execute(`DELETE FROM order_queue WHERE order_id = ?`, id);
      await d1Execute(`DELETE FROM account_batch_entries WHERE order_id = ?`, id);
      await d1Execute(`DELETE FROM order_status_history WHERE order_id = ?`, id);
      await d1Execute(`DELETE FROM order_status_history_v2 WHERE order_id = ?`, id);
      await d1Execute(`DELETE FROM coupon_redemptions WHERE order_id = ?`, id);
      await d1Execute(`DELETE FROM product_reviews WHERE order_id = ?`, id);
    } catch (e) {
      console.warn("[deleteOrder:tables_cleanup_warn]", e);
    }

    // 4. Clean up order-specific conversation thread and messages
    if (threadId) {
      try {
        await d1Execute(`DELETE FROM messages WHERE thread_id = ?`, threadId);
        await d1Execute(`DELETE FROM threads WHERE id = ? OR order_id = ?`, threadId, id);
      } catch (e) {
        console.warn("[deleteOrder:thread_cleanup_warn]", e);
      }
    }
    return true;
  }
  const { deleteStoreKey } = await import("./storage.server");
  const existing = await getOrder(id);
  if (existing?.threadId) {
    await deleteStoreKey(`messages/${existing.threadId}.json`);
    await deleteStoreKey(`threads/${existing.threadId}.json`);
    await mutateJson<string[]>(THREAD_INDEX_KEY, [], (ids) =>
      ids.filter((i) => i !== existing.threadId),
    );
  }
  await deleteStoreKey(orderKey(id));
  await mutateJson<string[]>(ORDER_INDEX_KEY, [], (ids) => ids.filter((i) => i !== id));
  return true;
}

/**
 * Automatically cleans up cancelled orders that have been cancelled for >= 7 days.
 * Only targets orders with status = 'cancelled'.
 * Preserves financial transactions and wallet ledger history with order code/metadata intact.
 */
export async function cleanupExpiredCancelledOrders(): Promise<number> {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  let deletedCount = 0;

  try {
    if (await d1Ready()) {
      const expiredOrders = await d1All<{ id: string; doc: string }>(
        `SELECT id, doc FROM orders 
         WHERE status = 'cancelled' 
           AND (
             (cancelled_at IS NOT NULL AND cancelled_at <= ?)
             OR (cancelled_at IS NULL AND updated_at <= ?)
           )
         LIMIT 50`,
        cutoffDate,
        cutoffDate,
      );

      for (const row of expiredOrders) {
        try {
          const parsed = parse<Order>(row.doc, {} as Order);
          if (parsed.status === "cancelled") {
            await deleteOrder(row.id);
            deletedCount++;
          }
        } catch {
          await deleteOrder(row.id);
          deletedCount++;
        }
      }
    } else {
      const allOrders = await listOrders();
      for (const order of allOrders) {
        if (order.status === "cancelled") {
          const cancelledTime = new Date(
            order.cancelledAt || order.updatedAt || order.createdAt,
          ).getTime();
          if (Date.now() - cancelledTime >= SEVEN_DAYS_MS) {
            await deleteOrder(order.id);
            deletedCount++;
          }
        }
      }
    }
  } catch (err) {
    console.error("[cleanupExpiredCancelledOrders:err]", err);
  }

  return deletedCount;
}

/* --------------------------------- threads -------------------------------- */

function normalizeThread(thread: Thread): Thread {
  if (!thread.chatType) {
    if (thread.orderId) {
      thread.chatType = "ORDER_SUPPORT";
    } else if (thread.mode === "AI_ACTIVE") {
      thread.chatType = "AUTOMATED_SUPPORT";
    } else {
      thread.chatType = "GENERAL_SUPPORT";
    }
  }
  return thread;
}

export async function getThread(id: string): Promise<Thread | undefined> {
  if (await d1Ready()) {
    const row = await d1First<{ doc: string }>(`SELECT doc FROM threads WHERE id = ?`, id);
    const parsed = row ? parse<Thread | undefined>(row.doc, undefined) : undefined;
    return parsed ? normalizeThread(parsed) : undefined;
  }
  const parsed = await readJson<Thread | undefined>(`threads/${id}.json`, undefined);
  return parsed ? normalizeThread(parsed) : undefined;
}

export async function listThreads(): Promise<Thread[]> {
  if (await d1Ready()) {
    const rows = await d1All<{ doc: string }>(
      `SELECT doc FROM threads ORDER BY last_message_at DESC`,
    );
    return rows.map((r) => normalizeThread(parse<Thread>(r.doc, {} as Thread)));
  }
  const ids = await readJson<string[]>(THREAD_INDEX_KEY, []);
  const threads = await Promise.all(ids.map((id) => getThread(id)));
  return threads.filter((t): t is Thread => !!t).map(normalizeThread);
}

/** Threads owned by a single user — scoped at the query level, never filtered client-side. */
export async function listThreadsByUser(userId: string): Promise<Thread[]> {
  if (!userId) return [];
  if (await d1Ready()) {
    const rows = await d1All<{ doc: string }>(
      `SELECT doc FROM threads WHERE user_id = ? ORDER BY last_message_at DESC`,
      userId,
    );
    return rows.map((r) => normalizeThread(parse<Thread>(r.doc, {} as Thread)));
  }
  const all = await listThreads();
  return all.filter((t) => t.userId === userId);
}

export async function saveThread(thread: Thread): Promise<Thread> {
  const norm = normalizeThread(thread);
  if (await d1Ready()) {
    try {
      await d1Execute(
        `INSERT INTO threads (id, user_id, order_id, doc, last_message_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET 
           doc = excluded.doc, 
           last_message_at = excluded.last_message_at,
           user_id = excluded.user_id,
           order_id = excluded.order_id`,
        norm.id,
        norm.userId,
        norm.orderId ?? null,
        JSON.stringify(norm),
        norm.lastMessageAt,
      );
    } catch (err: any) {
      console.error(`[db:saveThread:error] threadId=${norm.id} userId=${norm.userId} error=`, err);
      throw err;
    }
    return norm;
  }
  await writeJson(`threads/${norm.id}.json`, norm);
  await mutateJson<string[]>(THREAD_INDEX_KEY, [], (ids) =>
    ids.includes(norm.id) ? ids : [norm.id, ...ids],
  );
  return norm;
}

/* -------------------------------- messages -------------------------------- */

/**
 * Reads one stored message document into a `ChatMessage` that is safe to hand
 * to any caller. See `chat-message-row.ts` for what the repair guarantees and
 * why a single unreadable row used to 500 the member's whole conversation.
 */
function parseMessageRow(raw: unknown, rowId?: string | null, threadId?: string): ChatMessage {
  return readMessageRow({ doc: raw, rowId, threadId });
}

export interface PaginatedMessagesResult {
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor: string | null;
  totalCount: number;
}

export interface SearchMessageResult {
  id: string;
  senderRole: string;
  senderName?: string;
  kind: string;
  createdAt: string;
  snippet: string;
  fullText?: string;
}

export function normalizeSearchText(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "") // remove tashkeel
    .replace(/[إأآٱ]/g, "ا") // normalize alef
    .replace(/ة/g, "ه") // normalize taa marbuta
    .replace(/[ىي]/g, "ي") // normalize yaa
    .replace(/ـ/g, "") // remove tatweel
    .replace(/\s+/g, " ")
    .trim();
}

export async function getMessages(threadId: string): Promise<ChatMessage[]> {
  if (await d1Ready()) {
    const rows = await d1All<{ id: string; doc: string }>(
      `SELECT id, doc FROM messages WHERE thread_id = ? ORDER BY created_at ASC`,
      threadId,
    );
    return rows.map((r) => parseMessageRow(r.doc, r.id, threadId));
  }
  return readJson<ChatMessage[]>(`messages/${threadId}.json`, []);
}

export async function getPaginatedMessages(
  threadId: string,
  options?: { limit?: number; before?: string; around?: string },
): Promise<PaginatedMessagesResult> {
  const limit = Math.min(Math.max(Number(options?.limit) || 10, 1), 50);

  if (!(await d1Ready())) {
    // Fallback to memory for non-D1 environments
    const all = await getMessages(threadId);
    const totalCount = all.length;
    let eligible = all;

    if (options?.around) {
      const targetIdx = all.findIndex((m) => m.id === options.around);
      if (targetIdx !== -1) {
        const half = Math.floor(limit / 2);
        const start = Math.max(0, targetIdx - half);
        const end = Math.min(all.length, start + limit);
        const slice = all.slice(start, end);
        const oldest = slice[0];
        const hasMore = start > 0;
        return {
          messages: slice,
          hasMore,
          nextCursor:
            oldest && hasMore
              ? btoa(JSON.stringify({ createdAt: oldest.createdAt, id: oldest.id }))
              : null,
          totalCount,
        };
      }
    }

    if (options?.before) {
      let beforeTime = "";
      let beforeId = "";
      try {
        const decoded = JSON.parse(atob(options.before));
        beforeTime = decoded.createdAt;
        beforeId = decoded.id;
      } catch {
        // Fallback for old cursor format
        const parts = options.before.split("_");
        beforeTime = parts[0] || "";
        beforeId = parts[1] || "";
      }

      eligible = all.filter((m) => {
        if (m.createdAt < beforeTime) return true;
        if (m.createdAt === beforeTime && beforeId && m.id < beforeId) return true;
        return false;
      });
    }

    const slice = eligible.slice(-limit);
    const hasMore = eligible.length > limit;
    const oldest = slice[0];

    return {
      messages: slice,
      hasMore,
      nextCursor:
        oldest && hasMore
          ? btoa(JSON.stringify({ createdAt: oldest.createdAt, id: oldest.id }))
          : null,
      totalCount,
    };
  }

  // D1 Path
  const countRes = await d1First<{ count: number }>(
    `SELECT COUNT(*) as count FROM messages WHERE thread_id = ?`,
    threadId,
  );
  const totalCount = countRes?.count || 0;

  if (options?.around) {
    // Find the around message to get its created_at
    const aroundMsg = await d1First<{ created_at: string; id: string }>(
      `SELECT created_at, id FROM messages WHERE thread_id = ? AND id = ?`,
      threadId,
      options.around,
    );

    if (aroundMsg) {
      const half = Math.floor(limit / 2);

      // Fetch messages around this timestamp
      const rows = await d1All<{ doc: string; created_at: string; id: string }>(
        `SELECT doc, created_at, id FROM (
           SELECT doc, created_at, id FROM messages WHERE thread_id = ? AND (created_at > ? OR (created_at = ? AND id >= ?)) ORDER BY created_at ASC, id ASC LIMIT ?
         )
         UNION
         SELECT doc, created_at, id FROM (
           SELECT doc, created_at, id FROM messages WHERE thread_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?
         )
         ORDER BY created_at ASC, id ASC`,
        threadId,
        aroundMsg.created_at,
        aroundMsg.created_at,
        aroundMsg.id,
        limit - half,
        threadId,
        aroundMsg.created_at,
        aroundMsg.created_at,
        aroundMsg.id,
        half,
      );

      const slice = rows.map((r) => parseMessageRow(r.doc, r.id, threadId));
      const oldest = slice[0];
      const hasMore = Boolean(
        totalCount > slice.length &&
        oldest &&
        (oldest.id !== aroundMsg.id || slice.length === limit),
      );

      return {
        messages: slice,
        hasMore,
        nextCursor:
          oldest && hasMore
            ? btoa(JSON.stringify({ createdAt: oldest.createdAt, id: oldest.id }))
            : null,
        totalCount,
      };
    }
  }

  let query = `SELECT id, doc FROM messages WHERE thread_id = ?`;
  const params: any[] = [threadId];

  if (options?.before) {
    let beforeTime = "";
    let beforeId = "";
    try {
      const decoded = JSON.parse(atob(options.before));
      beforeTime = decoded.createdAt;
      beforeId = decoded.id;
    } catch {
      const parts = options.before.split("_");
      beforeTime = parts[0] || "";
      beforeId = parts[1] || "";
    }

    query += ` AND (created_at < ? OR (created_at = ? AND id < ?))`;
    params.push(beforeTime, beforeTime, beforeId);
  }

  // Fetch exactly limit + 1 to know if there's more
  query += ` ORDER BY created_at DESC, id DESC LIMIT ?`;
  params.push(limit + 1);

  const rows = await d1All<{ id: string; doc: string }>(query, ...params);
  const hasMore = rows.length > limit;
  const fetchedRows = hasMore ? rows.slice(0, limit) : rows;

  // They are ordered DESC in SQL, we need them ASC for the chat UI
  fetchedRows.reverse();

  const slice = fetchedRows.map((r) => parseMessageRow(r.doc, r.id, threadId));
  const oldest = slice[0];

  return {
    messages: slice,
    hasMore,
    nextCursor:
      oldest && hasMore
        ? btoa(JSON.stringify({ createdAt: oldest.createdAt, id: oldest.id }))
        : null,
    totalCount,
  };
}

export async function searchMessagesInThread(
  threadId: string,
  query: string,
  limit = 20,
): Promise<SearchMessageResult[]> {
  const cleanQ = normalizeSearchText(query);
  if (!cleanQ) return [];

  let rows = [];
  if (await d1Ready()) {
    // If we have D1, we can just grab the docs, we don't need to load the whole JSON into memory array first,
    // but without FTS we still have to parse and search in JS.
    // However, fetching them from DB limits memory to just the serialized strings initially.
    const res = await d1All<{ id: string; doc: string }>(
      `SELECT id, doc FROM messages WHERE thread_id = ? ORDER BY created_at DESC`,
      threadId,
    );
    rows = res.map((r) => parseMessageRow(r.doc, r.id, threadId));
  } else {
    rows = [...(await getMessages(threadId))].reverse();
  }

  const results: SearchMessageResult[] = [];

  for (const msg of rows) {
    if (msg.kind === "item_credentials" || msg.kind === "item_verification_code") {
      continue;
    }

    const text = typeof msg.body["text"] === "string" ? msg.body["text"] : "";
    if (!text) continue;

    const normText = normalizeSearchText(text);
    if (normText.includes(cleanQ)) {
      // Find position in raw text approximately
      const matchIdx = normText.indexOf(cleanQ);
      const start = Math.max(0, matchIdx - 30);
      const end = Math.min(text.length, matchIdx + cleanQ.length + 40);
      const snippet =
        (start > 0 ? "..." : "") + text.slice(start, end).trim() + (end < text.length ? "..." : "");

      results.push({
        id: msg.id,
        senderRole: msg.senderRole,
        senderName: msg.senderName,
        kind: msg.kind,
        createdAt: msg.createdAt,
        snippet,
        // intentional omission of fullText to avoid leaking passwords in search payload
      });

      if (results.length >= limit) break;
    }
  }

  return results;
}

export async function appendMessage(
  threadId: string,
  message: Partial<ChatMessage> & { clientMessageId?: string },
): Promise<ChatMessage> {
  const clientMessageId = message.clientMessageId;
  const body = { ...(message.body || {}) };
  if (clientMessageId) {
    body["clientMessageId"] = clientMessageId;
  }

  /*
    Every verification code gets its expiry stamped here, by the server, at the
    moment it is persisted.

    There are several ways to send one — the dedicated admin action, the account
    tools modal, a quick reply — and each used to decide the lifetime for itself
    (or not at all). Stamping it at the single point they all funnel through is
    what makes the 60 minutes a property of the code rather than a label the
    sender happened to attach, and it is what lets a refreshed card compute the
    real time remaining instead of restarting a local timer.
  */
  if (message.kind === "item_verification_code") {
    const createdAt = message.createdAt || new Date().toISOString();
    if (!body["expiresAt"]) body["expiresAt"] = deliveryOtpExpiry(createdAt);
    body["expiresInMinutes"] = DELIVERY_OTP_TTL_MINUTES;
    if (!body["sentAt"]) body["sentAt"] = createdAt;
  }

  const full: ChatMessage = {
    id: message.id || randomId("msg"),
    threadId: message.threadId || threadId,
    senderRole: message.senderRole || "system",
    kind: message.kind || "text",
    body,
    createdAt: message.createdAt || new Date().toISOString(),
    ...(message.senderName ? { senderName: message.senderName } : {}),
  };

  if (await d1Ready()) {
    // Check idempotency first if clientMessageId is present
    if (clientMessageId) {
      try {
        const existingRow = await d1First<{ doc: string }>(
          `SELECT doc FROM messages WHERE thread_id = ? AND client_message_id = ?`,
          threadId,
          clientMessageId,
        );
        if (existingRow) {
          return parseMessageRow(existingRow.doc, null, threadId);
        }
      } catch (err) {
        console.warn(`[db:appendMessage:idempotency_check_failed] threadId=${threadId}`, err);
      }
    }

    try {
      await d1Execute(
        `INSERT INTO messages (id, thread_id, doc, created_at, client_message_id) VALUES (?, ?, ?, ?, ?)`,
        full.id,
        threadId,
        JSON.stringify(full),
        full.createdAt,
        clientMessageId || null,
      );
    } catch (e: any) {
      if (
        clientMessageId &&
        (e.message?.includes("UNIQUE constraint failed") ||
          e.message?.includes("constraint failed"))
      ) {
        try {
          const existingRow = await d1First<{ doc: string }>(
            `SELECT doc FROM messages WHERE thread_id = ? AND client_message_id = ?`,
            threadId,
            clientMessageId,
          );
          if (existingRow) {
            return parseMessageRow(existingRow.doc, null, threadId);
          }
        } catch {
          // ignore
        }
      }
      console.error(
        `[db:appendMessage:error] threadId=${threadId} msgId=${full.id} senderRole=${full.senderRole} clientMsgId=${clientMessageId} error=`,
        e?.message || e,
      );
      throw e;
    }
  } else {
    await mutateJson<ChatMessage[]>(`messages/${threadId}.json`, [], (msgs) => [...msgs, full]);
  }

  // Broadcast realtime event
  try {
    const { chatRealtime } = await import("./chat-realtime.server");
    chatRealtime.broadcast(threadId, {
      type: "message.created",
      payload: { message: full, clientMessageId },
    });
  } catch (rtErr) {
    console.warn(`[db:appendMessage:broadcast_warning] threadId=${threadId}`, rtErr);
  }

  // Notification: Chat Message
  const thread = await getThread(threadId);
  if (thread) {
    if (full.senderRole === "admin") {
      const user = await findUserById(thread.userId);
      if (user?.telegramId) {
        await sendTelegramMessage(
          user.telegramId,
          `💬 *رسالة جديدة من الدعم*\n\nفي محادثة: ${thread.subject}\n\n"${full.body["text"] || "أرسل صورة"}"`,
        );
      }
    }
  }

  return full;
}

/* ---------------------------------- wallet --------------------------------- */

export async function getWalletTransactions(userId: string): Promise<WalletTransaction[]> {
  if (await d1Ready()) {
    // Auto-repair legacy bugged banan code transactions with fractional amounts
    try {
      const bugged = await d1All<{
        id: string;
        user_id: string;
        amount: number;
        description: string;
      }>(
        `SELECT id, user_id, amount, description FROM wallet_transactions WHERE user_id = ? AND description LIKE 'Banan Code:% (% IQD)' AND amount < 500`,
        userId,
      );
      for (const tx of bugged) {
        const match = tx.description?.match(/\((\d+)\s*IQD\)/i);
        if (match && match[1]) {
          const correctAmount = Number(match[1]);
          if (correctAmount > 0 && tx.amount < correctAmount) {
            const diff = correctAmount - tx.amount;
            await d1Execute(
              `UPDATE wallet_transactions SET amount = ? WHERE id = ?`,
              correctAmount,
              tx.id,
            );
            await d1Execute(
              `UPDATE users SET wallet_balance = ROUND(COALESCE(wallet_balance, 0) + ?) WHERE id = ?`,
              diff,
              tx.user_id,
            );
          }
        }
      }
    } catch {
      // Ignore repair error if any
    }

    const rows = await d1All<any>(
      `SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC`,
      userId,
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id || r.userId,
      kind: r.kind,
      amount: Number(r.amount) || 0,
      description: r.description || "",
      orderId: r.order_id || r.orderId || "",
      referenceType: r.reference_type || r.referenceType || "",
      referenceId: r.reference_id || r.referenceId || "",
      createdAt: r.created_at || r.createdAt || new Date().toISOString(),
    }));
  }
  return []; // Filesystem fallback omitted for brevity
}

export async function createWalletTransaction(
  tx: Omit<WalletTransaction, "id" | "createdAt">,
): Promise<WalletTransaction> {
  const full: WalletTransaction = {
    id: randomId("wtx"),
    createdAt: new Date().toISOString(),
    ...tx,
  };
  if (await d1Ready()) {
    await d1Execute(
      `INSERT INTO wallet_transactions (id, user_id, kind, amount, description, order_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      full.id,
      full.userId,
      full.kind,
      full.amount,
      full.description ?? null,
      full.orderId ?? null,
      full.createdAt,
    );
  }
  return full;
}

/**
 * Move money in or out of a wallet.
 *
 * The balance is changed with a single conditional `UPDATE ... SET
 * wallet_balance = wallet_balance + ?` rather than a read-modify-write, so two
 * concurrent requests can never both read the same starting balance and clobber
 * each other. Debits carry their own `wallet_balance >= ?` guard, which is what
 * makes overdrawing impossible even under a race. The ledger row is written in
 * the same D1 batch and is skipped (`WHERE changes() = 1`) when the balance
 * update did not apply, so the ledger can never record a transfer that did not
 * happen.
 */
export async function adjustUserWalletBalance(
  userId: string,
  amount: number,
  kind: WalletTransactionKind,
  description?: string,
  orderId?: string,
): Promise<User | undefined> {
  if (!Number.isFinite(amount)) throw new Error("invalid_amount");

  const user = await findUserById(userId);
  if (!user) return undefined;

  if (!(await d1Ready())) {
    // JSON fallback driver (local sandbox only): no transactions available.
    const newBalance = (user.walletBalance ?? 0) + amount;
    if (newBalance < 0 && amount < 0) throw new Error("Insufficient wallet balance");
    const updated = await updateUser(userId, (u) => ({ ...u, walletBalance: newBalance }));
    if (updated) {
      await createWalletTransaction({
        userId,
        amount,
        kind,
        description: description ?? `Wallet adjustment: ${kind}`,
        orderId: orderId ?? "",
      });
    }
    return updated;
  }

  const now = new Date().toISOString();
  const balanceSql =
    amount < 0
      ? `UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ? AND wallet_balance >= ?`
      : `UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?`;
  const balanceParams = amount < 0 ? [amount, userId, -amount] : [amount, userId];
  const ledgerParams = [
    randomId("wtx"),
    userId,
    kind,
    amount,
    description ?? `Wallet adjustment: ${kind}`,
    orderId ?? "",
    now,
  ];
  const ledgerSql = `INSERT INTO wallet_transactions (id, user_id, kind, amount, description, order_id, created_at)
            SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`;

  const db = getD1();
  if (db?.batch) {
    const results = await d1Batch([
      { sql: balanceSql, params: balanceParams },
      { sql: ledgerSql, params: ledgerParams },
    ]);
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
      throw new Error("Insufficient wallet balance");
    }
    return findUserById(userId);
  }

  // Driver without batch support: the guard still runs inside the single
  // UPDATE, so the balance stays correct; only the ledger row loses atomicity.
  const changed = await d1RunChanges(balanceSql, ...balanceParams);
  if (changed !== 1) throw new Error("Insufficient wallet balance");
  await d1Execute(
    `INSERT INTO wallet_transactions (id, user_id, kind, amount, description, order_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ...ledgerParams,
  );
  return findUserById(userId);
}

export async function createRechargeRequest(
  req: Omit<WalletRechargeRequest, "id" | "status" | "createdAt" | "updatedAt">,
): Promise<WalletRechargeRequest> {
  const full: WalletRechargeRequest = {
    id: randomId("rrq"),
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...req,
  };
  if (await d1Ready()) {
    await d1Execute(
      `INSERT INTO recharge_requests (id, user_id, amount, method, proof_url, eshop_code, banan_code, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      full.id,
      full.userId,
      full.amount,
      full.method,
      full.proofUrl ?? null,
      full.eshopCode ?? null,
      full.bananCode ?? null,
      full.status,
      full.createdAt,
      full.updatedAt,
    );
  }
  return full;
}

/**
 * D1 hands back the raw column names. The rest of the app — and every review
 * screen — reads the camelCase shape, so a `SELECT *` passed straight through
 * silently produced a request with no proofUrl and no userId: staff could not
 * see the receipt or tell whose it was.
 */
function rowToRechargeRequest(row: Record<string, unknown>): WalletRechargeRequest {
  const text = (value: unknown) =>
    value === null || value === undefined ? undefined : String(value);
  return {
    id: String(row["id"] ?? ""),
    userId: String(row["user_id"] ?? row["userId"] ?? ""),
    amount: Number(row["amount"] ?? 0),
    method: String(row["method"] ?? "") as RechargeMethod,
    status: String(row["status"] ?? "pending") as RechargeStatus,
    createdAt: String(row["created_at"] ?? row["createdAt"] ?? ""),
    updatedAt: String(row["updated_at"] ?? row["updatedAt"] ?? ""),
    ...(text(row["proof_url"] ?? row["proofUrl"])
      ? { proofUrl: text(row["proof_url"] ?? row["proofUrl"])! }
      : {}),
    ...(text(row["eshop_code"] ?? row["eshopCode"])
      ? { eshopCode: text(row["eshop_code"] ?? row["eshopCode"])! }
      : {}),
    ...(text(row["banan_code"] ?? row["bananCode"])
      ? { bananCode: text(row["banan_code"] ?? row["bananCode"])! }
      : {}),
    ...(text(row["admin_notes"] ?? row["adminNotes"])
      ? { adminNotes: text(row["admin_notes"] ?? row["adminNotes"])! }
      : {}),
    ...(text(row["reviewed_by"]) ? { reviewedBy: text(row["reviewed_by"])! } : {}),
    ...(text(row["reviewed_by_name"]) ? { reviewedByName: text(row["reviewed_by_name"])! } : {}),
    ...(text(row["reviewed_at"]) ? { reviewedAt: text(row["reviewed_at"])! } : {}),
    ...(text(row["review_source"]) ? { reviewSource: text(row["review_source"])! } : {}),
    ...(row["credited_amount"] === null || row["credited_amount"] === undefined
      ? {}
      : { creditedAmount: Number(row["credited_amount"]) }),
  };
}

export async function getRechargeRequest(
  requestId: string,
): Promise<WalletRechargeRequest | undefined> {
  if (!(await d1Ready())) return undefined;
  const row = await d1First<Record<string, unknown>>(
    `SELECT * FROM recharge_requests WHERE id = ?`,
    requestId,
  );
  return row ? rowToRechargeRequest(row) : undefined;
}

/** The member's details a reviewer needs, and nothing they do not. */
function reviewerVisibleUser(user: User): NonNullable<RechargeRequestWithUser["user"]> {
  return {
    id: user.id,
    name: user.name,
    ...(user.phone ? { phone: user.phone } : {}),
    ...(user.username ? { username: user.username } : {}),
    ...(user.email ? { email: user.email } : {}),
    walletBalance: Number(user.walletBalance ?? 0),
    isAdmin: Boolean(user.isAdmin),
    ...(user.createdAt ? { createdAt: user.createdAt } : {}),
  };
}

export async function getRechargeRequestWithUser(
  requestId: string,
): Promise<RechargeRequestWithUser | undefined> {
  const request = await getRechargeRequest(requestId);
  if (!request) return undefined;
  const user = await findUserById(request.userId);
  return user ? { ...request, user: reviewerVisibleUser(user) } : request;
}

export interface RechargeReviewResult {
  ok: boolean;
  /** Why it did not go through, when it did not. */
  reason?: "not_found" | "already_settled" | "credit_failed";
  request?: WalletRechargeRequest;
  creditedAmount?: number;
  /** The member's balance after a successful approval. */
  balance?: number;
}

export interface RechargeReviewer {
  id: string;
  name?: string;
  /** Where the decision was taken: "admin_panel", "telegram", ... */
  source?: string;
  notes?: string;
}

/**
 * Approve a top-up and credit the member.
 *
 * The status is claimed with a guarded UPDATE so two reviewers — or the
 * dashboard and the Telegram bot pressing at the same moment — can never both
 * win, and the money is credited exactly once. If the credit itself fails, the
 * claim is released so the request goes back to pending rather than sitting
 * marked approved with nothing paid.
 */
export async function approveRechargeRequest(
  requestId: string,
  reviewer: RechargeReviewer,
): Promise<RechargeReviewResult> {
  if (!(await d1Ready())) return { ok: false, reason: "not_found" };

  const existing = await getRechargeRequest(requestId);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status !== "pending") {
    return { ok: false, reason: "already_settled", request: existing };
  }

  const now = new Date().toISOString();
  const claimed = await d1RunChanges(
    `UPDATE recharge_requests
        SET status = 'approved', admin_notes = ?, updated_at = ?,
            reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_source = ?
      WHERE id = ? AND status = 'pending'`,
    reviewer.notes ?? null,
    now,
    reviewer.id,
    reviewer.name ?? null,
    now,
    reviewer.source ?? "admin_panel",
    requestId,
  );
  if (claimed !== 1) {
    return { ok: false, reason: "already_settled", request: await getRechargeRequest(requestId) };
  }

  const store = await getStore();
  let finalAmount = existing.amount;

  // Apply Nintendo Bonus if applicable
  if (existing.method === "eshop_card") {
    const bonusEnabled = store.settings?.["nintendoBonusEnabled"] !== false;
    const bonusPercent = Number(store.settings?.["nintendoBonusPercent"] || 15);
    if (bonusEnabled) {
      finalAmount = existing.amount * (1 + bonusPercent / 100);
    }
  }

  let updatedUser: User | undefined;
  try {
    updatedUser = await adjustUserWalletBalance(
      existing.userId,
      finalAmount,
      "deposit",
      `Recharge approved: ${existing.method} (${requestId})${finalAmount > existing.amount ? " + Bonus" : ""}`,
    );
  } catch (error) {
    // Release the claim: an approved row with no credit is money the member
    // never receives and nobody notices.
    await d1Execute(
      `UPDATE recharge_requests
          SET status = 'pending', reviewed_by = NULL, reviewed_by_name = NULL,
              reviewed_at = NULL, review_source = NULL, updated_at = ?
        WHERE id = ? AND status = 'approved'`,
      new Date().toISOString(),
      requestId,
    );
    console.error("[wallet] crediting an approved recharge failed", requestId, error);
    return { ok: false, reason: "credit_failed", request: existing };
  }

  await d1Execute(
    `UPDATE recharge_requests SET credited_amount = ? WHERE id = ?`,
    finalAmount,
    requestId,
  );

  const settled = await getRechargeRequest(requestId);
  return {
    ok: true,
    ...(settled ? { request: settled } : {}),
    creditedAmount: finalAmount,
    ...(updatedUser ? { balance: Number(updatedUser.walletBalance ?? 0) } : {}),
  };
}

/**
 * Reject a top-up.
 *
 * Guarded on `pending` for the same reason approval is: without it an already
 * approved request could be flipped to rejected after the wallet was credited,
 * leaving a paid member with a rejected record.
 */
export async function rejectRechargeRequest(
  requestId: string,
  reviewer: RechargeReviewer,
): Promise<RechargeReviewResult> {
  if (!(await d1Ready())) return { ok: false, reason: "not_found" };

  const existing = await getRechargeRequest(requestId);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status !== "pending") {
    return { ok: false, reason: "already_settled", request: existing };
  }

  const now = new Date().toISOString();
  const claimed = await d1RunChanges(
    `UPDATE recharge_requests
        SET status = 'rejected', admin_notes = ?, updated_at = ?,
            reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ?, review_source = ?
      WHERE id = ? AND status = 'pending'`,
    reviewer.notes ?? null,
    now,
    reviewer.id,
    reviewer.name ?? null,
    now,
    reviewer.source ?? "admin_panel",
    requestId,
  );
  if (claimed !== 1) {
    return { ok: false, reason: "already_settled", request: await getRechargeRequest(requestId) };
  }

  return {
    ok: true,
    ...((await getRechargeRequest(requestId))
      ? { request: (await getRechargeRequest(requestId))! }
      : {}),
  };
}

export async function consumeBananCode(
  userId: string,
  rawCode: string,
): Promise<{ success: boolean; amount?: number; currency?: string; error?: string }> {
  const code = String(rawCode ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!code) return { success: false, error: "يرجى إدخال الكود" };

  const store = await getStore();
  const now = new Date().toISOString();

  if (await d1Ready()) {
    const bc = await d1First<{ id: string; code: string; value: number; is_used: number }>(
      `SELECT * FROM banan_codes WHERE UPPER(code) = ? AND is_used = 0`,
      code,
    );
    if (!bc) return { success: false, error: "كود غير صالح أو مستخدم مسبقاً" };

    const claimed = await d1RunChanges(
      `UPDATE banan_codes SET is_used = 1, used_by = ?, used_at = ?
       WHERE id = ? AND is_used = 0`,
      userId,
      now,
      bc.id,
    );
    if (claimed !== 1) return { success: false, error: "كود غير صالح أو مستخدم مسبقاً" };

    // Credit full amount directly in IQD (Iraqi Dinar)
    await adjustUserWalletBalance(
      userId,
      bc.value,
      "deposit",
      `كود بنانتو: ${bc.code} (${bc.value.toLocaleString("en-US")} د.ع)`,
    );

    // Reward user with bananas based on dinarPerBanana setting
    const dinarPerBanana = Number(store.settings?.["dinarPerBanana"] || 1000);
    if (dinarPerBanana > 0) {
      const bananasEarned = Math.floor(bc.value / dinarPerBanana);
      if (bananasEarned > 0) {
        await updateUser(userId, (u) => ({
          ...u,
          bananaBalance: (Number(u.bananaBalance) || 0) + bananasEarned,
        }));
      }
    }

    return { success: true, amount: bc.value, currency: "IQD" };
  }

  // Fallback storage when D1 is not active
  let targetCode: BananCode | undefined;
  await mutateJson<BananCode[]>("banan_codes.json", [], (list) => {
    return list.map((c) => {
      if (c.code.toUpperCase() === code && !c.isUsed) {
        targetCode = c;
        return {
          ...c,
          isUsed: true,
          usedBy: userId,
          usedAt: now,
        };
      }
      return c;
    });
  });

  if (!targetCode) {
    return { success: false, error: "كود غير صالح أو مستخدم مسبقاً" };
  }

  await adjustUserWalletBalance(
    userId,
    targetCode.value,
    "deposit",
    `كود بنانتو: ${targetCode.code} (${targetCode.value.toLocaleString("en-US")} د.ع)`,
  );

  const dinarPerBanana = Number(store.settings?.["dinarPerBanana"] || 1000);
  if (dinarPerBanana > 0) {
    const bananasEarned = Math.floor(targetCode.value / dinarPerBanana);
    if (bananasEarned > 0) {
      await updateUser(userId, (u) => ({
        ...u,
        bananaBalance: (Number(u.bananaBalance) || 0) + bananasEarned,
      }));
    }
  }

  return { success: true, amount: targetCode.value, currency: "IQD" };
}

export async function createBananCode(value: number): Promise<BananCode> {
  const codes = await createBananCodesBatch(value, 1);
  if (!codes[0]) {
    throw new Error("Failed to create BananCode");
  }
  return codes[0];
}

export async function createBananCodesBatch(value: number, count = 1): Promise<BananCode[]> {
  const effectiveCount = Math.max(1, Math.min(100, Math.floor(Number(count) || 1)));
  const codes: BananCode[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < effectiveCount; i++) {
    const rawSuffix = randomId("BANAN")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 7);
    const code = `BANAN${rawSuffix}`.slice(0, 12);
    codes.push({
      id: randomId("bc"),
      code,
      value,
      isUsed: false,
      createdAt: now,
    });
  }

  if (await d1Ready()) {
    for (const c of codes) {
      await d1Execute(
        `INSERT INTO banan_codes (id, code, value, is_used, created_at) VALUES (?, ?, ?, ?, ?)`,
        c.id,
        c.code,
        c.value,
        0,
        c.createdAt,
      );
    }
  } else {
    await mutateJson<BananCode[]>("banan_codes.json", [], (list) => [...codes, ...list]);
  }

  return codes;
}

export interface BananCodeDetail {
  id: string;
  code: string;
  value: number;
  isUsed: boolean;
  usedBy?: string;
  usedAt?: string;
  createdAt: string;
  usedByUser?: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    username?: string;
    memberNo?: string;
  } | null;
}

export async function listBananCodesWithDetails(): Promise<BananCodeDetail[]> {
  if (await d1Ready()) {
    const rows = await d1All<{
      id: string;
      code: string;
      value: number;
      is_used: number;
      used_by: string | null;
      used_at: string | null;
      created_at: string;
      user_name: string | null;
      user_email: string | null;
      user_phone: string | null;
      user_member_no: string | null;
      user_username: string | null;
    }>(
      `SELECT 
        bc.id,
        bc.code,
        bc.value,
        bc.is_used,
        bc.used_by,
        bc.used_at,
        bc.created_at,
        u.name as user_name,
        u.email as user_email,
        u.phone as user_phone,
        u.member_no as user_member_no,
        u.username as user_username
      FROM banan_codes bc
      LEFT JOIN users u ON u.id = bc.used_by
      ORDER BY bc.created_at DESC
      LIMIT 500`,
    );

    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      value: Number(r.value),
      isUsed: Boolean(r.is_used),
      usedBy: r.used_by ?? undefined,
      usedAt: r.used_at ?? undefined,
      createdAt: r.created_at,
      usedByUser: r.used_by
        ? {
            id: r.used_by,
            name: r.user_name || "مستخدم مسجل",
            email: r.user_email ?? undefined,
            phone: r.user_phone ?? undefined,
            username: r.user_username ?? undefined,
            memberNo: r.user_member_no ?? undefined,
          }
        : null,
    }));
  }

  // Fallback storage
  const rawCodes = await readJson<BananCode[]>("banan_codes.json", []);
  const users = await getUsers();
  const userMap = new Map(users.map((u) => [u.id, u]));

  return rawCodes.map((c) => {
    const u = c.usedBy ? userMap.get(c.usedBy) : undefined;
    return {
      id: c.id,
      code: c.code,
      value: Number(c.value),
      isUsed: Boolean(c.isUsed),
      usedBy: c.usedBy,
      usedAt: c.usedAt,
      createdAt: c.createdAt,
      usedByUser: c.usedBy
        ? {
            id: c.usedBy,
            name: u?.name || "مستخدم مسجل",
            email: u?.email,
            phone: u?.phone,
            username: u?.username,
            memberNo: u?.memberNo,
          }
        : null,
    };
  });
}

export async function deleteBananCode(id: string): Promise<boolean> {
  if (await d1Ready()) {
    const changes = await d1RunChanges(`DELETE FROM banan_codes WHERE id = ? AND is_used = 0`, id);
    return changes > 0;
  }
  let deleted = false;
  await mutateJson<BananCode[]>("banan_codes.json", [], (list) => {
    const item = list.find((c) => c.id === id);
    if (item && !item.isUsed) {
      deleted = true;
      return list.filter((c) => c.id !== id);
    }
    return list;
  });
  return deleted;
}

/**
 * Every top-up request, newest first, with the member attached.
 *
 * The listing is what a reviewer decides on, so it carries the identity and
 * the balance rather than a bare user id, and it keeps settled requests: they
 * are the log of what was approved, by whom and for how much.
 */
export async function listAllRechargeRequests(
  options: { limit?: number } = {},
): Promise<RechargeRequestWithUser[]> {
  if (!(await d1Ready())) return [];

  const limit = Math.min(Math.max(Number(options.limit ?? 400), 1), 1000);
  const rows = await d1All<Record<string, unknown>>(
    `SELECT * FROM recharge_requests ORDER BY created_at DESC LIMIT ?`,
    limit,
  );
  const requests = rows.map(rowToRechargeRequest);
  if (requests.length === 0) return [];

  // One pass over the members involved rather than a lookup per row.
  const users = await getUsers();
  const byId = new Map(users.map((user) => [user.id, user]));
  return requests.map((request) => {
    const user = byId.get(request.userId);
    if (!user) return request;
    // `userName` is kept alongside the full member object because the Mini App
    // review card reads it directly.
    return { ...request, userName: user.name, user: reviewerVisibleUser(user) };
  });
}

export async function listAllUsers(): Promise<User[]> {
  return getUsers();
}

export async function listUserTransactions(userId: string): Promise<WalletTransaction[]> {
  return getWalletTransactions(userId);
}

export async function listRechargeRequestsByUser(
  userId: string,
  options: { limit?: number } = {},
): Promise<WalletRechargeRequest[]> {
  if (!(await d1Ready())) return [];
  const limit = Math.min(Math.max(Number(options.limit ?? 100), 1), 500);
  const rows = await d1All<Record<string, unknown>>(
    `SELECT * FROM recharge_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    userId,
    limit,
  );
  return rows.map(rowToRechargeRequest);
}

/* -------------------------------- preferences ------------------------------ */

export async function getUserPreferences(userId: string): Promise<any> {
  const row = await d1First<{ prefs_json: string }>(
    `SELECT prefs_json FROM user_preferences WHERE user_id = ?`,
    userId,
  );
  return row ? JSON.parse(row.prefs_json) : {};
}

export async function saveUserPreferences(userId: string, prefs: any): Promise<void> {
  const now = new Date().toISOString();
  await d1Execute(
    `INSERT INTO user_preferences (user_id, prefs_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = excluded.updated_at`,
    userId,
    JSON.stringify(prefs),
    now,
  );
}

/* -------------------------------- activity --------------------------------- */

export async function logLogin(params: {
  userId: string;
  type: string;
  provider?: string;
  request: Request;
}) {
  const { userId, type, provider, request } = params;
  const { getRequestInfo } = await import("./activity.functions.server");
  const info = await getRequestInfo(request);

  await d1Execute(
    `INSERT INTO login_history (
      id, user_id, type, provider, device_info_json, ip_hash, region, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    randomId("log"),
    userId,
    type,
    provider || null,
    JSON.stringify({
      userAgent: info.userAgent,
      deviceType: info.deviceType,
      browser: info.browser,
      os: info.os,
    }),
    info.ipHash,
    null, // region could be added from cf-ipcountry if available
    new Date().toISOString(),
  );
}
