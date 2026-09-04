import type { NotificationPreferences } from "./notification-preferences";

export type ProductKind =
  | "account"
  | "offline_account"
  | "online_account"
  | "bundle"
  | "physical"
  | "accessory"
  | "hardware"
  | "device"
  | "collectible"
  | "preorder"
  | "digital_code";

export function isAccountKind(kind?: string | null): boolean {
  return kind === "account" || kind === "offline_account" || kind === "online_account";
}

export interface GameMetadata {
  title: string;
  slug: string;
  description: string;
  descriptionEn?: string;
  releaseDate: string | null;
  releaseStatus: "RELEASED" | "PREORDER" | "UPCOMING" | "TBA" | "DELAYED";
  preorderAvailable: boolean | null;
  developer: string;
  publisher: string;
  metacriticScore: number | null;
  genres: string[];
  gameTypes: string[];
  gameSizeGb: number | null;
  players: string | null;
  supportedLanguages: string[];
  editionOptions: { edition_name: string; cover_image?: string; contents: string[] }[];

  images: {
    cartridgeFront: string;
    boxArt: string;
    screenshots: { imageUrl: string; caption: string; sourceUrl: string }[];
  };

  trailer: {
    title: string;
    youtubeUrl: string;
    thumbnail?: string;
    source?: string;
  };

  nintendo?: {
    officialStoreUrl?: string;
    requiresNintendoSwitchOnline?: boolean;
    supportsCloudSave?: boolean;
    gameKeyCard?: boolean;
    physicalRequiresDownload?: boolean;
    playModes?: ("TV" | "Tabletop" | "Handheld")[];
    nintendoNotes?: string;
  };

  switch2?: {
    isSwitch2Edition?: boolean;
    upgradePrice?: number;
    switch2Features?: { title: string; description: string }[];
  };

  overview?: {
    intro: string;
    targetAudience: string[];
    notFor: string[];
    mainStoryHours?: number;
    completionistHours?: number;
  };

  gameplayPillars?: { title: string; description: string; image?: string }[];

  story?: {
    worldSummary: string;
    chapters: { chapterNumber: number; title: string; description: string; image?: string }[];
  };

  videos?: { title: string; youtubeUrl: string; thumbnail?: string }[];
  galleryDetails?: { imageUrl: string; description: string; sourceUrl: string }[];
  features?: string[];

  performance?: {
    resolutionTv?: string | null;
    resolutionHandheld?: string | null;
    fps?: string | null;
    hdrSupport?: boolean | null;
    performanceNotes?: string | null;
  };

  storage?: {
    downloadSizeGb: number | null;
    requiredStorageGb: number | null;
    microSdRecommended?: boolean;
    storageNotes?: string;
  };

  languagesInfo?: {
    audioLanguages: string[];
    textLanguages: string[];
    arabicSupported: boolean;
  };

  multiplayer?: {
    localMultiplayer: boolean | null;
    onlineMultiplayer: boolean | null;
    cooperative: boolean | null;
    competitive: boolean | null;
    splitScreen: boolean | null;
    localWireless: boolean | null;
  };

  dlc?: {
    title: string;
    description: string;
    image?: string;
    releaseDate?: string;
    sourceUrl?: string;
  }[];
  guides?: { title: string; summary: string; url: string; source: string }[];

  completion?: {
    mainStoryHours?: number;
    storyPlusExtrasHours?: number;
    oneHundredPercentHours?: number;
    minHours?: number;
    maxHours?: number;
    source?: string;
  };

  faq?: { question: string; answer: string; sourceUrl?: string }[];
  verdict?: { score: number; summary: string; pros: string[]; cons: string[] };

  reviews?: {
    metacriticScore: number | null;
    opencriticScore: number | null;
    playerScore: number | null;
    selectedReviews: { source: string; score: string; quote: string; url: string }[];
  };

  timeline?: { date: string; title: string; description: string; sourceUrl?: string }[];
  updates?: { version: string; date: string; changes: string[]; sourceUrl?: string }[];
  music?: { title: string; url: string; platform: string }[];

  similarGamesInfo?: { gameId: string; title: string; similarityScore: number }[];
  seriesInfo?: {
    seriesName: string;
    seriesGames: { title: string; releaseDate: string; gameId?: string }[];
  };
  studioInfo?: { studioName: string; website?: string; location?: string; description?: string };
  requirements?: string[];

  sources: { sourceName: string; url: string; sourceType: string; lastVerified: string }[];
  ageRating?: string;
  metacriticRating?: string | number;
  opencriticRating?: string | number;
  userScore?: string | number;

  // Internal confidence tracking
  dataConfidence?: Record<
    string,
    {
      value: any;
      source: string;
      sourceUrl?: string;
      confidence: number;
      lastVerified: string;
      evidence?: string;
    }
  >;
  modelInfo?: { provider: string; model: string; startedAt: string; completedAt: string };
  rawData?: Record<string, any>;
}

export interface ExtractionJob {
  id: string;
  gameId?: string;
  gameName: string;
  status:
    | "QUEUED"
    | "RESEARCHING"
    | "VERIFYING"
    | "SAVING"
    | "PAUSED"
    | "COMPLETED"
    | "FAILED"
    | "NEEDS_REVIEW"
    | "WAITING";
  currentSection?: string;
  currentField?: string;
  progress: number;
  model?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface FieldAudit {
  id: string;
  jobId: string;
  gameId?: string;
  fieldName: string;
  fieldValue: string | null;
  sourceName?: string;
  sourceUrl?: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNVERIFIED";
  verified: boolean;
  evidence?: string;
  lastVerified: string;
}

export interface ProductEdition {
  id: string;
  name: string;
  price: number;
}

export interface ProductDLC {
  id: string;
  name: string;
  price: number;
}

export interface Product extends Partial<GameMetadata> {
  id: string | number;
  kind?: ProductKind;
  title: string;
  titleEn?: string;
  titleKu?: string;
  slug?: string;
  description?: string;
  descriptionEn?: string;
  descriptionKu?: string;
  badge?: string;
  badgeEn?: string;
  badgeKu?: string;
  genreEn?: string;
  genreKu?: string;
  featuresEn?: string[];
  featuresKu?: string[];
  price: number;
  cost?: number;
  stock: number;
  status: string;
  displayOrder?: number;
  categoryId: string | number;
  isActive?: boolean;
  /**
   * Hidden from every customer-facing surface while staying fully visible in
   * the admin panel. Absent means visible: products saved before this existed
   * keep showing exactly as they did.
   */
  isHidden?: boolean;
  /** Set when the product was imported while its slug was already taken. */
  isDuplicate?: boolean;
  /** The slug the duplicate copy wanted, kept because the stored one is suffixed. */
  duplicateOriginalSlug?: string;
  isInfiniteStock?: boolean;
  requiresAddress?: boolean;
  editions?: ProductEdition[];
  dlcs?: ProductDLC[];

  // Backward compatibility / Simplified fields
  image?: string;
  banner?: string;
  gallery?: string[];
  trailerUrl?: string;
  genre?: string;
  publisher?: string;
  developer?: string;
  releaseDate?: string;
  players?: string;
  ageRating?: string;
  size?: string;
  languages?: string;
  tags?: string[];
  series?: string;
  game_id?: string;
  trade_value_iqd?: number;
  store_offer_bonus_iqd?: number;
  store_offer_total_iqd?: number;
  trade_enabled?: boolean;
  [key: string]: unknown;
}

export interface AccountBundle {
  id: string;
  title: string;
  titleEn?: string;
  titleKu?: string;
  slug?: string;
  description?: string;
  descriptionEn?: string;
  descriptionKu?: string;
  price: number;
  originalPrice?: number;
  image?: string;
  banner?: string;
  gameIds: (string | number)[];
  accountType?: "primary" | "secondary" | "full" | "offline" | "online";
  stock?: number;
  isActive: boolean;
  badge?: string;
  badgeEn?: string;
  badgeKu?: string;
  features?: string[];
  featuresEn?: string[];
  featuresKu?: string[];
  deliveryTime?: string;
  displayOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface StoreDoc {
  banners: Record<string, unknown>[];
  products: Product[];
  bundles?: AccountBundle[];
  categories: Record<string, unknown>[];
  musicList: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  settings: Record<string, unknown>;
  quickReplies: { id: string; title: string; body: string }[];
  autoReplies: { onlineIntro?: string; offlineIntro?: string };
  adminPresence: { online: boolean; updatedAt?: string };
  paymentMethods: { id: string; name: string; details: string }[];
  visits: number;
  views: number;
  gameRequests: Record<string, unknown>[];
  discTrades: Record<string, unknown>[];
  problemSolutions: Record<string, unknown>[];
  /** editable copy for FAQ / policy / support / add-game pages */
  content?: import("./content").ContentDoc;
}

export interface UserSettings {
  /** Persisted per member, so a signed-in user keeps their language on any device. */
  language: "ar" | "en" | "ku" | "tr";
  /** background pack id (see src/lib/themes.ts); legacy values: light | dark */
  theme: string;
  soundEnabled: boolean;
  musicEnabled: boolean;
  /** reduced animations for low-end devices */
  liteMotion?: boolean;
  musicTrack?: string;
  currency?: string;
  /**
   * Which Telegram messages this member has asked to receive.
   *
   * Absent means the defaults in `notification-preferences.ts`, which are all
   * on: every one of these messages is delivered today, and an unset
   * preference must not silently switch one off.
   */
  notifications?: NotificationPreferences;
}

export interface Address {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  city: string;
  area?: string;
  street?: string;
  notes?: string;
  isDefault?: boolean;
}

export type Gender = "male" | "female" | "unspecified";

export interface User {
  id: string;
  name: string;
  /** public handle, e.g. banan7x42q — unique, usable for sign-in */
  username?: string;
  /** membership number, unique, usable for sign-in (custom numbers can be bought later) */
  memberNo?: string;
  email: string;
  /** set once the email has been confirmed */
  emailVerifiedAt?: string;
  phone?: string;
  /** set once the number has been confirmed with a WhatsApp code */
  phoneVerifiedAt?: string;
  passwordHash: string;
  avatar?: string;
  gender?: Gender;
  /** ISO date (YYYY-MM-DD) */
  birthDate?: string;
  /** genre ids the member picked at signup or in profile preferences */
  preferredGenres?: string[];
  /** set once the optional profile step was completed or skipped */
  profileCompletedAt?: string;
  isAdmin?: boolean;
  /** true for system/service accounts (e.g. automated bots) */
  isService?: boolean;
  /** how the account was created: local password, Google or Apple */
  provider?: "password" | "google" | "apple";
  providerId?: string;
  settings: UserSettings;
  addresses: Address[];
  favorites: (string | number)[];
  telegramId?: string;
  friendId?: string;
  createdAt: string;
  walletBalance: number;
  bananaBalance?: number;
  bananaLocked?: number;
}

export type ReviewStatus = "pending" | "approved" | "rejected";

export interface ProductReview {
  id: string;
  productId: string | number;
  userId: string;
  orderId?: string;
  rating: number;
  comment: string;
  screenshotUrl?: string;
  instagramProofUrl?: string;
  status: ReviewStatus;
  isAutoReview: boolean;
  reviewDueAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type DiscountType = "percentage" | "fixed" | "single_item_percent";

export interface Coupon {
  id: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  startAt?: string;
  start_at?: string;
  expirationAt?: string;
  expiration_at?: string;
  expires_at?: string;
  usageLimit?: number;
  usage_limit?: number;
  perUserLimit: number;
  per_user_limit?: number;
  eligibleProducts: (string | number)[];
  eligible_products?: (string | number)[];
  eligibleCategories: (string | number)[];
  eligible_categories?: (string | number)[];
  eligibleUsers: string[];
  eligible_users?: string[];
  minOrderAmount: number;
  min_order_amount?: number;
  maxDiscountAmount?: number;
  max_discount_amount?: number;
  isActive: boolean;
  is_active?: boolean | number;
  onlyDigitalProducts?: boolean;
  only_digital_products?: boolean | number;
  isStackable?: boolean;
  is_stackable?: boolean | number;
  oncePerUserLifetime?: boolean;
  once_per_user_lifetime?: boolean | number;
  /** Applies only to a game bought with the Offline account option, one copy. */
  offlineAccountOnly?: boolean;
  offline_account_only?: boolean | number;
  createdAt: string;
  created_at?: string;
}

export type BananaTransactionType =
  "reward" | "market_sell" | "market_buy" | "redemption" | "adjustment" | "bot_trade";

export interface BananaLedgerEntry {
  id: string;
  userId: string;
  amount: number;
  type: BananaTransactionType;
  direction: "in" | "out";
  balanceBefore: number;
  balanceAfter: number;
  referenceType?: string;
  referenceId?: string;
  status: string;
  createdAt: string;
}

export type BananaMarketOfferStatus = "active" | "sold" | "cancelled";

export interface BananaMarketOffer {
  id: string;
  userId: string;
  quantity: number;
  priceIqd: number;
  lockedBanana: number;
  status: BananaMarketOfferStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BananaRedemptionOffer {
  id: string;
  productId?: string | number;
  title: string;
  description?: string;
  imageUrl?: string;
  bananaPrice: number;
  stock: number;
  quantityLimit: number;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
  createdAt: string;
}

export interface BananaBot {
  id: string;
  name: string;
  budgetIqd: number;
  maxTradeBanana?: number;
  dailyLimitBanana?: number;
  maxTotalBanana?: number;
  minPriceIqd?: number;
  maxPurchasePriceIqd?: number;
  delayStrategyJson?: string;
  tradingScheduleJson?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoreBanner {
  id: string;
  imageUrl: string;
  title?: string;
  description?: string;
  targetUrl?: string;
  startDate?: string;
  endDate?: string;
  priority: number;
  isActive: boolean;
  createdAt: string;
}

export interface StoreGuide {
  id: string;
  title: string;
  slug: string;
  contentHtml: string;
  category?: string;
  images: string[];
  videoUrl?: string;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProblemSolution {
  id: string;
  title: string;
  description: string;
  steps: { stepNumber: number; text: string; image?: string }[];
  images: string[];
  videoUrl?: string;
  relatedProductId?: string | number;
  tags: string[];
  isActive: boolean;
  createdAt: string;
}

export interface GameRequest {
  id: string;
  userId: string;
  gameName: string;
  edition?: string;
  platform?: string;
  imageUrl?: string;
  notes?: string;
  status: "pending" | "approved" | "rejected" | "added";
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type DiscTradeStatus =
  | "waiting_review"
  | "waiting_shipment"
  | "received"
  | "inspecting"
  | "approved"
  | "coupon_issued"
  | "cash_paid"
  | "completed"
  | "rejected"
  | "cancelled"
  | "pending"
  | "under_review"
  | "offer_sent"
  | "user_approved"
  | "waiting_shipping"
  | "cancelled_by_user"
  | "auto_cancelled";

export interface DiscTrade {
  id: string;
  userId: string;
  gameId?: string;
  gameName: string;
  platform: string;
  condition: string;
  boxCondition?: string;
  region?: string;
  accessories?: string[];
  damage?: string;
  photoUrl?: string;
  notes?: string;
  status: DiscTradeStatus;
  baseIqd?: number;
  adminValuationIqd?: number;
  finalIqd?: number;
  payoutType?: string;
  shippingOption?: "dropoff" | "courier";
  statusHistory: { status: DiscTradeStatus; at: string; note?: string }[];
  adminNotes?: string;
  threadId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  oldValue?: string;
  newValue?: string;
  details?: string;
  createdAt: string;
}

export interface StoreNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

/**
 * `referral_reward` and `referral_reversal` are store credit moving because of
 * the Refer a Friend programme. They are kept as their own kinds rather than
 * folded into `deposit`/`refund` so the wallet history can name them, and so a
 * clawback is never mistaken for an order refund.
 */
export type WalletTransactionKind =
  | "deposit"
  | "purchase"
  | "refund"
  | "admin_adjustment"
  | "referral_reward"
  | "referral_reversal";

export interface WalletTransaction {
  id: string;
  userId: string;
  kind: WalletTransactionKind;
  amount: number;
  description: string;
  orderId: string;
  createdAt: string;
}

export type RechargeStatus = "pending" | "approved" | "rejected";
export type RechargeMethod = "zain_cash" | "rafidain" | "crypto" | "eshop_card" | "banan_code";

export interface WalletRechargeRequest {
  id: string;
  userId: string;
  amount: number;
  method: RechargeMethod;
  proofUrl?: string; // for zain, rafidain, crypto
  eshopCode?: string; // for eshop
  bananCode?: string; // for banan codes
  status: RechargeStatus;
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
  /** Who settled the request, and when — never set while pending. */
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  /** Where the decision came from, e.g. the dashboard or the Telegram bot. */
  reviewSource?: string;
  /** What actually reached the wallet, bonus included. Set on approval only. */
  creditedAmount?: number;
}

/**
 * A top-up request with the member's details attached, for review screens.
 *
 * Staff cannot judge a transfer receipt without knowing whose it is, so the
 * listing carries the identity and the current balance rather than an opaque
 * user id.
 */
export interface RechargeRequestWithUser extends WalletRechargeRequest {
  /** Convenience copy of the member's name for compact review cards. */
  userName?: string;
  user?: {
    id: string;
    name: string;
    phone?: string;
    username?: string;
    email?: string;
    walletBalance: number;
    isAdmin: boolean;
    createdAt?: string;
  };
}

export interface BananCode {
  id: string;
  code: string;
  value: number;
  isUsed: boolean;
  usedBy?: string;
  usedAt?: string;
  createdAt: string;
}

export type PublicUser = Omit<User, "passwordHash" | "providerId">;

export interface OrderItem {
  id: string;
  productId: string | number;
  title: string;
  image?: string;
  kind: ProductKind;
  quantity: number;
  unitPrice: number;
  /**
   * What this unit cost us, recorded at checkout.
   *
   * Without it, profit on an old order has to be recomputed from whatever the
   * catalogue says today — so re-pricing a product retroactively rewrites the
   * margin on every order ever placed for it. Absent on orders placed before
   * this field existed; `orderFinance` falls back to the catalogue there and
   * marks the result estimated.
   */
  unitCost?: number;
  edition?: string;
  meta?: {
    editionId?: string | null | undefined;
    dlcIds?: string[] | null | undefined;
    /** The option and type the member picked, resolved from the catalogue. */
    optionId?: string | null | undefined;
    optionName?: string | null | undefined;
    typeId?: string | null | undefined;
    typeName?: string | null | undefined;
    /**
     * Which console, snapshotted at the sale.
     *
     * Absent on orders placed before it was recorded; the fulfilment screens
     * simply omit the line rather than guessing from today's catalogue.
     */
    platform?: string | null | undefined;
  };
  /** account items only */
  deliveryEmail?: string;
  deliveryPasswordEnc?: string;
  credsSentAt?: string;
  verificationCodeSentAt?: string;
  verificationCode?: string;
  loggedInAt?: string;
  /** The member's own screenshot proving they signed in to this account. */
  loginProofUrl?: string;
  loginProofAt?: string;
  completedAt?: string;
  /** hardware items only */
  shippedAt?: string;
  deliveredAt?: string;
}

/**
 * `awaiting_customer_confirmation` is the state an order enters the moment the
 * last delivery item has been handed over. The admin's work is finished at that
 * point, so the order leaves the preparation queue and the admin moves on; the
 * customer's "تم استلام الطلب" (or the auto-completion timer) is what takes it
 * to `completed`, independently and without holding the queue.
 */
export type OrderStatus =
  | "pending"
  | "processing"
  | "delivering"
  | "awaiting_customer_confirmation"
  | "delivery_issue"
  | "completed"
  | "cancelled";

/** Orders in these states are done as far as the admin queue is concerned. */
export const ADMIN_FINISHED_ORDER_STATUSES: readonly OrderStatus[] = [
  "awaiting_customer_confirmation",
  "delivery_issue",
  "completed",
  "cancelled",
];
export type PaymentStatus = "unpaid" | "review" | "paid" | "rejected";

/**
 * The referral recorded on an order.
 *
 * Every figure is the one the *server* computed at the moment of purchase, in
 * whole dinars, at the rates then in force. Nothing here is ever read back
 * from a request.
 */
export interface OrderReferral {
  /** The code as it was typed or shared, for the audit trail. */
  code?: string;
  referralCodeId?: string;
  attributionId?: string;
  referrerUserId: string;
  /** The friend who bought. The same as `Order.userId`; kept for clarity. */
  referredUserId: string;
  /** The qualifying game. */
  productId: string;
  productTitle?: string;
  /** The catalogue price of one copy, before the referral discount. */
  originalPriceIqd: number;
  buyerDiscountIqd: number;
  referrerRewardIqd: number;
  buyerPercentBps: number;
  referrerPercentBps: number;
  /** Where the reward stood when the order was written. */
  rewardStatus: "eligible" | "pending" | "approved" | "blocked" | "reversed" | "expired";
  /** The anti-abuse result: `clear`, or the reasons that were found. */
  riskVerdict: string;
  riskScore: number;
}

export interface Order {
  id: string;
  code: string;
  userId: string;
  userName: string;
  items: OrderItem[];
  total: number;
  discountAmount?: number;
  couponCode?: string;
  /**
   * The product a single-product coupon was applied to, when the coupon was
   * restricted to one.
   *
   * Checkout already resolves this to decide the discount; without recording it
   * the order keeps only the code and the amount, so per-product profit has to
   * spread a discount that really came off one line across all of them. The
   * order totals never depended on it, but the per-product breakdown did.
   */
  couponTargetProductId?: string;
  /** The variant of {@link couponTargetProductId} that was discounted. */
  couponTargetVariantId?: string;
  /**
   * The referral this order was placed under, when there was one.
   *
   * Recorded on the order itself as well as in `referral_rewards`, so the
   * numbers behind a discount can be read from the order alone — months later,
   * with the settings since changed and the catalogue re-priced.
   */
  referral?: OrderReferral;
  currency: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentReceiptUrl?: string;
  address?: Address;
  needsAddress: boolean;
  threadId: string;
  cancelledAt?: string;
  completedAt?: string;
  customerConfirmedAt?: string;
  autoCompletedAt?: string;
  /**
   * When the last item on this order was handed over.
   *
   * Stamped once every item has been delivered, and the only thing the
   * auto-completion hour runs from — see `order-completion.ts`.
   */
  lastOtpSentAt?: string;
  /** `lastOtpSentAt` + 60 minutes: when the order closes itself. */
  autoCompleteAt?: string;
  /** Timestamp of the final expected delivery item's OTP/code. */
  deliveryIssueOpenedAt?: string;
  deliveryViewedAt?: string;
  ratingCardSentAt?: string;
  createdAt: string;
  updatedAt: string;
  events: { type: string; at: string; payload?: unknown }[];
  source?: string;
  checkoutSessionId?: string;
  paymentReference?: string;
  idempotencyKey?: string;
  createdBy?: string;
  legacyImport?: boolean;
}

export type MessageKind =
  | "text"
  | "image"
  | "video"
  | "system"
  | "payment_methods_card"
  | "payment_receipt_prompt"
  | "payment_receipt"
  | "item_credentials"
  | "item_verification_code"
  | "login_proof"
  | "instructions"
  | "shipping_update"
  | "order_completed"
  | "review_request"
  | "discount_code"
  | "digital_order_card";

export interface ChatMessage {
  id: string;
  threadId: string;
  senderRole: "user" | "admin" | "system" | "assistant";
  senderName?: string;
  kind: MessageKind;
  body: Record<string, unknown>;
  createdAt: string;
}

export type ChatType = "GENERAL_SUPPORT" | "AUTOMATED_SUPPORT" | "ORDER_SUPPORT" | "DELIVERY";

export type AdminAvailabilityMode = "available" | "unavailable" | "schedule";

export interface AdminAvailabilityConfig {
  mode: AdminAvailabilityMode;
  startHour: number;
  startMinute?: number;
  endHour: number;
  endMinute?: number;
  workDays?: number[]; // [0,1,2,3,4,5,6] (0=Sunday ... 6=Saturday)
  timezone?: string; // "Asia/Baghdad"
  offlineMessage?: string;
  updatedAt?: string;
}

export interface AdminAvailabilityStatus {
  isAvailable: boolean;
  status: AdminAvailabilityMode;
  workingHoursText: string;
  offlineMessage: string;
  currentBaghdadTime: string;
}

export type ThreadMode =
  | "AI_ACTIVE"
  | "ADMIN_ACTIVE"
  | "ADMIN_ONLY"
  | "ORDER_PREPARATION"
  | "WAITING_FOR_USER"
  | "WAITING_FOR_ADMIN"
  | "RESOLVED"
  | "ESCALATED";

export interface Thread {
  id: string;
  userId: string;
  userName: string;
  orderId?: string;
  subject: string;
  status: "open" | "closed";
  chatType?: ChatType;
  /** support workflow state; defaults to AI_ACTIVE */
  mode?: ThreadMode;
  /** admin switched the automated support off for this thread */
  aiPaused?: boolean;
  /** the automated support handed this thread over and is waiting for an admin */
  needsAdmin?: boolean;
  escalatedAt?: string;

  /** Queue management properties */
  queueStatus?: "queued" | "active" | "snoozed" | "completed";
  queueEnteredAt?: string;
  queue_entered_at?: string;
  queueSnoozedAt?: string;
  pausedAt?: string;
  paused_at?: string;
  inactivityReminders?: string[];
  lastAdminMessageAt?: string;
  lastUserMessageAt?: string;
  lastUserActivityAt?: string;
  last_user_activity_at?: string;
  lastAdminActivityAt?: string;
  last_admin_activity_at?: string;
  humanRequested?: boolean;

  /**
   * When an assistant thread drops out of the member's list.
   *
   * Derived from `chatType` and `lastMessageAt` on every read and write —
   * never authored — so it cannot go stale against the kind. Absent means the
   * thread keeps for ever, which is every order thread and every conversation
   * that reached a person.
   */
  expiresAt?: string;
  lastMessageAt: string;
  lastMessagePreview?: string;
  userLastReadAt?: string;
  adminLastReadAt?: string;
  createdAt: string;
}

export interface UserActivityLog {
  id: string;
  userId?: string;
  sessionId?: string;
  activityType: string;
  entityType?: string;
  entityId?: string;
  action: string;
  metadataJson: Record<string, any>;
  ipHash?: string;
  userAgent?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  referrer?: string;
  path?: string;
  createdAt: string;
}

export interface BrowsingHistory {
  id: string;
  userId: string;
  sessionId?: string;
  path: string;
  entityType?: string;
  entityId?: string;
  metadataJson: Record<string, any>;
  referrer?: string;
  durationSeconds?: number;
  createdAt: string;
}

export interface SearchHistory {
  id: string;
  userId: string;
  query: string;
  filtersJson: Record<string, any>;
  category?: string;
  resultsCount?: number;
  createdAt: string;
}

export interface ProductInteraction {
  id: string;
  userId: string;
  productId: string;
  interactionType: string;
  metadataJson: Record<string, any>;
  createdAt: string;
}

export interface UserSession {
  id: string;
  userId: string;
  deviceInfoJson: Record<string, any>;
  ipHash?: string;
  lastSeenAt: string;
  expiresAt?: string;
  createdAt: string;
}

export interface LoginHistory {
  id: string;
  userId: string;
  type: string;
  provider?: string;
  deviceInfoJson: Record<string, any>;
  ipHash?: string;
  region?: string;
  createdAt: string;
}

export interface OrderItemsSnapshot {
  id: string;
  orderId: string;
  productId: string;
  title: string;
  priceIqd: number;
  quantity: number;
  optionsJson: Record<string, any>;
  imageUrl?: string;
  createdAt: string;
}

export interface WalletLedgerEntry {
  id: string;
  userId: string;
  amount: number;
  type: string;
  balanceBefore: number;
  balanceAfter: number;
  referenceType?: string;
  referenceId?: string;
  description?: string;
  createdAt: string;
}

export interface OrderStatusHistoryV2 {
  id: string;
  orderId: string;
  oldStatus?: string;
  newStatus: string;
  changedByUserId?: string;
  changedByRole: "USER" | "ADMIN" | "SUPPORT_AGENT" | "SYSTEM";
  reason?: string;
  metadataJson: Record<string, any>;
  createdAt: string;
}

export interface ProductRequest {
  id: string;
  userId: string;
  requestType: string;
  productName: string;
  gameId?: string;
  platform?: string;
  productCategory?: string;
  referenceUrl?: string;
  notes?: string;
  preferredVersion?: string;
  preferredRegion?: string;
  contactMethod?: string;
  status: string;
  adminNote?: string;
  userVisibleNote?: string;
  linkedProductId?: string;
  statusHistory: { status: string; timestamp: string; note?: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface TypingParticipant {
  userId: string;
  userName: string;
  senderRole: "user" | "admin";
}

export interface PresenceParticipant {
  userId: string;
  lastSeen: number;
}

export type ChatRealtimeEvent =
  | {
      type: "message.created";
      payload: {
        message: ChatMessage;
        clientMessageId?: string;
      };
    }
  | {
      type: "typing.update";
      payload: {
        typers: TypingParticipant[];
      };
    }
  | {
      type: "presence.update";
      payload: {
        participants: PresenceParticipant[];
      };
    }
  | {
      type: "read.update";
      payload: {
        threadId: string;
        readerRole: "user" | "admin";
        readerUserId: string;
        lastReadAt: string;
      };
    }
  | {
      /** Event name on the wire — the SSE client listens for `thread.updated`. */
      type: "thread.updated";
      payload: {
        threadId: string;
        status?: Thread["status"];
        mode?: ThreadMode;
        queueStatus?: Thread["queueStatus"];
        thread?: Thread;
      };
    };

/**
 * The least that identifies a member, for an admin picker.
 *
 * Deliberately not `PublicUser`: a picker needs to tell two members apart, and
 * a wallet balance or a saved address does not help with that. What is not
 * sent to the browser cannot leak from the screen that received it.
 */
export interface MemberMatch {
  id: string;
  name: string;
  email: string;
  phone?: string;
  memberNo?: string;
  username?: string;
}
