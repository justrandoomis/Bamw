import type {
  ChatMessage,
  Order,
  PublicUser,
  StoreDoc,
  Thread,
  ChatType,
  AdminAvailabilityStatus,
  AdminAvailabilityConfig,
  MemberMatch,
} from "./types";

/** One queued account in a bulk preparation batch (mirrors the server shape). */
export interface AccountBatchEntry {
  id: string;
  seq: number;
  email: string;
  status: "staged" | "sent" | "registered";
  sent_at: string | null;
  registered_at: string | null;
}

export interface AccountBatchProgress {
  total: number;
  staged: number;
  sent: number;
  registered: number;
  current?: AccountBatchEntry;
  next?: AccountBatchEntry;
  entries: AccountBatchEntry[];
}

export interface AdminReplySuggestion {
  id: string;
  text: string;
  reason: string;
  score: number;
}

export class RequestTimeoutError extends Error {
  constructor(message = "انتهت مهلة الاتصال، تحقق من الإنترنت وحاول مجدداً") {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

function isAbort(err: unknown) {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message));
}

async function attempt<T>(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const external = init?.signal;
  if (external) {
    if (external.aborted) throw new DOMException("Aborted", "AbortError");
    external.addEventListener("abort", () => controller.abort(), { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "include",
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (err) {
    if (isAbort(err)) {
      // Caller-driven cancellation (e.g. React Query) must stay a cancellation,
      // never a user-visible error.
      if (!timedOut) throw new DOMException("Aborted", "AbortError");
      throw new RequestTimeoutError();
    }
    throw new Error("تعذر الاتصال بالخادم، حاول مرة أخرى");
  } finally {
    clearTimeout(timer);
  }
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
    details?: string;
    sqlError?: string;
  };
  if (!response.ok) {
    // Keep structured hints on the thrown error
    const errorText =
      data.message ||
      (data.error && data.error !== "server_error" ? data.error : null) ||
      data.details ||
      data.sqlError ||
      (data.error === "server_error"
        ? "خطأ في السيرفر أو قاعدة البيانات"
        : "حدث خطأ، حاول مرة أخرى");
    const error = Object.assign(new Error(errorText), data);
    throw error;
  }
  return data;
}

async function request<T>(url: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
  // A hung request must never leave the UI stuck on a loading screen,
  // but a single slow network hiccup should not fail the whole action either.
  try {
    return await attempt<T>(url, init, timeoutMs);
  } catch (err) {
    if (err instanceof RequestTimeoutError && !init?.signal?.aborted) {
      // Don't retry non-idempotent endpoints like OTP
      if (url.includes("/api/otp") && init?.method === "POST") {
        throw err;
      }
      return await attempt<T>(url, init, timeoutMs);
    }
    throw err;
  }
}

export const api = {
  fetch: <T = any>(url: string, init?: RequestInit, timeoutMs = 20000) =>
    request<T>(url, init, timeoutMs),
  store: () => request<StoreDoc>("/api/data"),
  saveStore: (patch: Partial<StoreDoc>) =>
    request<{ success: boolean; data: StoreDoc }>("/api/data", {
      method: "POST",
      body: JSON.stringify(patch),
    }),

  me: () => request<{ user: PublicUser | null }>("/api/auth", undefined, 5000),
  login: (identifier: string, password: string) =>
    request<{ user: PublicUser }>("/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "login", identifier, password }),
    }),

  /** OTP verification codes via WhatsApp or Telegram. */
  sendOtp: (
    phone: string,
    purpose: "signup" | "reset" | "verify",
    channel: "whatsapp" | "telegram" = "telegram",
  ) =>
    request<{
      sent: boolean;
      /** false when the answer is deliberately neutral and nothing was sent. */
      delivered?: boolean;
      phone: string;
      notice?: string;
      hint?: string;
      channel?: "whatsapp" | "telegram";
    }>(
      "/api/otp",
      {
        method: "POST",
        body: JSON.stringify(
          phone.startsWith("member:")
            ? { action: "send", purpose, memberId: phone.slice(7), channel }
            : { action: "send", purpose, phone, channel },
        ),
      },
      45000,
    ),

  verifyOtp: ({
    phone,
    ...input
  }: {
    phone: string;
    code: string;
    purpose: "signup" | "reset" | "verify";
    name?: string;
    email?: string;
    password?: string;
  }) =>
    request<{ user?: PublicUser; verified?: boolean }>(
      "/api/otp",
      {
        method: "POST",
        body: JSON.stringify({
          action: "verify",
          ...input,
          ...(phone.startsWith("member:") ? { memberId: phone.slice(7) } : { phone }),
        }),
      },
      60000,
    ),

  register: (input: { name: string; email: string; password: string; phone?: string }) =>
    request<{ user: PublicUser }>("/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "register", ...input }),
    }),
  logout: () =>
    request<{ user: null }>("/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "logout" }),
    }),

  updateProfile: (patch: Record<string, unknown>) =>
    request<{ user: PublicUser }>("/api/profile", { method: "POST", body: JSON.stringify(patch) }),

  /** Telegram account linking (enables Telegram as an OTP channel). */
  telegramStatus: () =>
    request<{
      linked: boolean;
      telegram_username: string | null;
      linked_at: string | null;
      bot_username: string;
    }>("/api/telegram"),
  telegramLink: () =>
    request<{ ok: boolean; bot_username: string; deep_link: string }>("/api/telegram", {
      method: "POST",
      body: JSON.stringify({ action: "link" }),
    }),
  telegramUnlink: () =>
    request<{ ok: boolean; linked: boolean }>("/api/telegram", {
      method: "POST",
      body: JSON.stringify({ action: "unlink" }),
    }),
  /** Poll the ownership proof (Signup/OTP) */
  telegramLinkStatus: (tokenOrSessionId: string) => {
    return request<{
      status:
        "pending" | "used" | "verified" | "failed" | "expired" | "unknown" | "contact_required";
    }>(`/api/otp?verificationRef=${encodeURIComponent(tokenOrSessionId)}`);
  },
  bindTelegramIdentity: (sessionId: string, initData: string) =>
    request<{ success: boolean; status: string; sessionId?: string }>("/api/otp", {
      method: "POST",
      body: JSON.stringify({ action: "telegram_init", sessionId, initData }),
    }),

  orders: () => request<{ orders: Order[] }>("/api/orders"),
  order: (orderId: string) =>
    request<{ order: Order; thread: Thread; messages: ChatMessage[] }>(
      `/api/orders?orderId=${encodeURIComponent(orderId)}`,
    ),
  checkout: (
    items: {
      productId: string | number;
      quantity: number;
      editionId?: string | null;
      dlcIds?: string[] | null;
    }[],
    address?: unknown,
    couponCode?: string,
    acceptedTerms?: boolean,
    idempotencyKey?: string,
    targetProductId?: string | number,
    /* A referral code the member typed. The server resolves and re-prices it. */
    referralCode?: string,
  ) =>
    request<{ order: Order }>("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        items,
        address,
        couponCode,
        acceptedTerms,
        idempotencyKey,
        targetProductId,
        referralCode,
      }),
    }),
  setOrderAddress: (orderId: string, address: unknown) =>
    request<{ order: Order }>("/api/orders", {
      method: "PATCH",
      body: JSON.stringify({ orderId, address }),
    }),

  threads: () =>
    request<{ threads: Thread[]; adminAvailability?: AdminAvailabilityStatus }>("/api/chat"),
  createThread: (subject?: string, chatType?: ChatType, orderId?: string) =>
    request<{ thread: Thread; messages: ChatMessage[] }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ create: true, subject, chatType, orderId }),
    }),

  getAdminAvailability: () =>
    request<{ availability: AdminAvailabilityStatus; config?: AdminAvailabilityConfig }>(
      "/api/chat",
      {
        method: "POST",
        body: JSON.stringify({ action: "get_admin_availability" }),
      },
    ),

  setAdminAvailability: (adminAvailabilityConfig: Partial<AdminAvailabilityConfig>) =>
    request<{
      success: boolean;
      config: AdminAvailabilityConfig;
      availability: AdminAvailabilityStatus;
    }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ action: "set_admin_availability", adminAvailabilityConfig }),
    }),

  requestHumanSupport: (threadId?: string) =>
    request<{
      success: boolean;
      isAvailable: boolean;
      thread?: Thread;
      offlineMessage?: string;
      workingHoursText?: string;
      currentBaghdadTime?: string;
    }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ action: "request_human", threadId }),
    }),

  thread: (threadId: string) =>
    request<{
      thread: Thread;
      messages: ChatMessage[];
      hasMore?: boolean;
      nextCursor?: string | null;
      totalCount?: number;
      typers?: { userId: string; userName: string; senderRole: "user" | "admin" }[];
      isOnline?: boolean;
      adminAvailability?: AdminAvailabilityStatus;
    }>(`/api/chat?threadId=${encodeURIComponent(threadId)}`),

  threadMessages: (
    threadId?: string,
    options?: {
      orderId?: string;
      limit?: number;
      before?: string;
      around?: string;
      signal?: AbortSignal;
    },
  ) => {
    const params = new URLSearchParams();
    if (threadId) params.set("threadId", threadId);
    if (options?.orderId) params.set("orderId", options.orderId);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.before) params.set("before", options.before);
    if (options?.around) params.set("around", options.around);
    return request<{
      thread: Thread;
      messages: ChatMessage[];
      hasMore: boolean;
      nextCursor: string | null;
      totalCount: number;
      typers?: { userId: string; userName: string; senderRole: "user" | "admin" }[];
      isOnline?: boolean;
      adminAvailability?: AdminAvailabilityStatus;
      queueMetrics?: any;
    }>(`/api/chat?${params.toString()}`, { signal: options?.signal });
  },

  searchThreadMessages: (threadId: string, q: string) =>
    request<{
      results: {
        id: string;
        senderRole: string;
        senderName?: string;
        kind: string;
        createdAt: string;
        snippet: string;
        fullText: string;
      }[];
    }>(
      `/api/chat?action=search&threadId=${encodeURIComponent(threadId)}&q=${encodeURIComponent(q)}`,
    ),

  sendTyping: (threadId: string, isTyping: boolean, surface: "store" | "admin" = "store") =>
    request<{ success: boolean }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ action: "typing", threadId, isTyping, surface }),
    }),

  sendPresence: (threadId: string, surface: "store" | "admin" = "store") =>
    request<{ success: boolean }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ action: "presence", threadId, surface }),
    }),

  markThreadRead: (threadId: string, surface: "store" | "admin" = "store") =>
    request<{ success: boolean }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ action: "mark_read", threadId, surface }),
    }),

  sendMessage: (payload: {
    threadId: string;
    text?: string;
    imageUrl?: string;
    kind?: string;
    body?: any;
    surface?: "store" | "admin";
    clientMessageId?: string;
    pageContext?: { path?: string; productId?: string; productTitle?: string };
    viewHistory?: { productId: string; title: string }[];
  }) =>
    request<{
      message: ChatMessage;
      assistant?: ChatMessage | null;
      clientMessageId?: string;
      /** True when this message was the final delivery item on its order. */
      orderFinished?: boolean;
      /** The next order in the preparation queue, when this one just finished. */
      nextOrder?: { orderId: string; threadId?: string; code?: string; userName?: string };
    }>("/api/chat", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  setThreadMode: (payload: {
    threadId: string;
    mode?: string;
    aiPaused?: boolean;
    close?: boolean;
  }) =>
    request<{ thread: Thread }>("/api/chat", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  adminOrders: () => request<{ orders: Order[] }>("/api/admin/orders"),
  adminOrderAction: (payload: Record<string, unknown>) =>
    request<{
      order?: Order;
      state?: unknown;
      orderFinished?: boolean;
      nextReadyDeliveryItemId?: string;
      nextOrder?: { orderId: string; threadId?: string; code?: string; userName?: string };
    }>("/api/admin/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /** Queue several accounts at once; they are released to the buyer one by one. */
  stageAccountBatch: (payload: {
    orderId: string;
    itemId: string;
    accounts: { email: string; password?: string }[];
  }) =>
    request<{ added: number; progress: AccountBatchProgress }>("/api/admin/orders", {
      method: "POST",
      body: JSON.stringify({ action: "stage_account_batch", ...payload }),
    }),

  /** Hand the next staged account to the buyer. */
  releaseNextAccount: (payload: { orderId: string; itemId: string }) =>
    request<{ released: number; order: Order; progress: AccountBatchProgress }>(
      "/api/admin/orders",
      {
        method: "POST",
        body: JSON.stringify({ action: "release_next_account", ...payload }),
      },
    ),

  accountBatchStatus: (payload: { orderId: string; itemId: string }) =>
    request<{ progress: AccountBatchProgress }>("/api/admin/orders", {
      method: "POST",
      body: JSON.stringify({ action: "batch_status", ...payload }),
    }),

  /** Ranked reply suggestions for the staff member answering a thread. */
  replySuggestions: (threadId: string, signal?: AbortSignal) =>
    request<{ suggestions: AdminReplySuggestion[] }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ action: "reply_suggestions", threadId }),
      ...(signal ? { signal } : {}),
    }),

  /**
   * Member-side steps on their own order: attaching the sign-in proof and
   * asking for the next prepared account.
   */
  orderAction: (payload: {
    orderId: string;
    action: "submit_login_proof" | "account_next" | "confirm_received" | "report_delivery_issue";
    itemId?: string;
    deliveryItemId?: string;
    imageUrl?: string;
    reason?: string;
  }) =>
    request<{
      order?: Order;
      released?: number | null;
      waiting?: boolean;
      progress?: AccountBatchProgress;
    }>("/api/orders", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  revealPassword: (orderId: string, itemId: string) =>
    request<{ password: string }>("/api/reveal-password", {
      method: "POST",
      body: JSON.stringify({ orderId, itemId }),
    }),

  extractProduct: (name: string) =>
    request<{ product: Record<string, unknown> }>("/api/ai/extract-product", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  upload: (dataUrl: string, folder?: string) =>
    request<{ url: string }>("/api/upload", {
      method: "POST",
      body: JSON.stringify({ dataUrl, folder }),
    }),

  getMyDiscTrades: () => request<{ items: any[] }>("/api/disc-trade"),

  submitDiscTrade: (payload: {
    game_name: string;
    platform?: string;
    condition?: string;
    notes?: string;
    photo_url?: string;
    preferred_trade?: string;
    estimated_iqd?: number;
  }) =>
    request<{ success: boolean; id: string }>("/api/disc-trade", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  content: () => request<import("./content").ContentDoc>("/api/content"),
  saveContent: (patch: Partial<import("./content").ContentDoc>) =>
    request<{ success: boolean; data: import("./content").ContentDoc }>("/api/content", {
      method: "POST",
      body: JSON.stringify(patch),
    }),

  gameRequests: () => request<{ requests: any[] }>("/api/game-requests"),
  submitGameRequest: (payload: {
    gameName: string;
    platform?: string;
    reference?: string;
    notes?: string;
    contact?: string;
  }) =>
    request<{ success: boolean; request: any }>("/api/game-requests", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateGameRequest: (id: string, status: string, adminNote?: string) =>
    request<{ success: boolean }>("/api/game-requests", {
      method: "PATCH",
      body: JSON.stringify({ id, status, adminNote }),
    }),

  cancelDiscTrade: (tradeId: string) =>
    request<{ success: boolean }>("/api/disc-trade", {
      method: "POST",
      body: JSON.stringify({ action: "cancel", trade_id: tradeId }),
    }),
};

export const walletApi = {
  getTransactions: () =>
    request<{
      transactions: any[];
      rechargeRequests?: any[];
      activeBinanceIntent?: any;
      binanceConfig?: any;
    }>("/api/wallet"),
  recharge: (payload: {
    amount: number;
    method: string;
    proofUrl?: string;
    eshopCode?: string;
    bananCode?: string;
    action: "recharge";
  }) =>
    request<{ success: boolean; request: any }>("/api/wallet", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  consumeBanan: (code: string) =>
    request<{ success: boolean; amount: number }>("/api/wallet", {
      method: "POST",
      body: JSON.stringify({ action: "consume_banan", code }),
    }),
  createBinanceIntent: (amountUsdt: string | number) =>
    request<{
      success: boolean;
      intent: any;
      config: {
        enabled: boolean;
        receiverId: string;
        allowedAsset: string;
        minTopUpUsdt: number;
        maxTopUpUsdt: number;
        intentTtlMinutes: number;
      };
      isExisting?: boolean;
    }>("/api/wallet/binance/topup-intent", {
      method: "POST",
      body: JSON.stringify({ amountUsdt }),
    }),
  verifyBinanceTopUp: (intentId: string, transactionId: string) =>
    request<{
      success: boolean;
      status?: string;
      amount?: string;
      currency?: string;
      transactionId?: string;
      code?: string;
      message?: string;
      retryAfter?: number;
      attemptsLeft?: number;
    }>("/api/wallet/binance/verify", {
      method: "POST",
      body: JSON.stringify({ intentId, transactionId }),
    }),
  getActiveBinanceIntent: () =>
    request<{
      activeIntent: any | null;
      config: {
        enabled: boolean;
        receiverId: string;
        allowedAsset: string;
        minTopUpUsdt: number;
        maxTopUpUsdt: number;
        intentTtlMinutes: number;
      };
    }>("/api/wallet/binance/active-intent"),
  cancelBinanceIntent: (intentId: string) =>
    request<{ success: boolean }>("/api/wallet", {
      method: "POST",
      body: JSON.stringify({ action: "binance_cancel", intentId }),
    }),
};

export interface DeliveryLine {
  itemId: string;
  productId: string | null;
  title: string;
  quantity: number;
  status: string;
  username: string;
  password: string;
  needsMapping: boolean;
  sentAt: string | null;
  proofReceivedAt: string | null;
  otpSentAt: string | null;
  completedAt: string | null;
}

export const adminApi = {
  store: () => request<StoreDoc>("/api/data"),

  /**
   * Per-line delivery state for one order.
   *
   * The delivery tool reads this when it opens and writes it as the admin
   * types, so nothing typed is lost to a refresh and two admins on the same
   * order see the same progress.
   */
  deliveryItems: (orderId: string) =>
    request<{
      success: boolean;
      orderId: string;
      items: DeliveryLine[];
      progress: { total: number; delivered: number; completed: number; label: string };
    }>(`/api/admin/delivery-items?orderId=${encodeURIComponent(orderId)}`),

  saveDeliveryDraft: (payload: {
    orderId: string;
    itemId: string;
    productId?: string | null;
    username?: string;
    password?: string;
    needsMapping?: boolean;
  }) =>
    request<{ success: boolean; item: DeliveryLine | null }>("/api/admin/delivery-items", {
      method: "POST",
      body: JSON.stringify({ ...payload, action: "save_draft" }),
    }),

  /** `sendKey` makes a retry idempotent — the customer never gets two copies. */
  markDeliverySent: (payload: { orderId: string; itemId: string; sendKey?: string }) =>
    request<{ success: boolean; item: DeliveryLine; duplicate: boolean }>(
      "/api/admin/delivery-items",
      { method: "POST", body: JSON.stringify({ ...payload, action: "mark_sent" }) },
    ),

  markDeliveryOtpSent: (payload: { orderId: string; itemId: string }) =>
    request<{ success: boolean; item: DeliveryLine | null }>("/api/admin/delivery-items", {
      method: "POST",
      body: JSON.stringify({ ...payload, action: "mark_otp" }),
    }),

  saveStore: (patch: Partial<StoreDoc>) =>
    request<{ success: boolean; data: StoreDoc }>("/api/data", {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  getCoupons: () => request<{ coupons: any[] }>("/api/admin/coupons"),
  createCoupon: (data: any) =>
    request<{ success: boolean; id: string }>("/api/admin/coupons", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateCoupon: (data: any) =>
    request<{ success: boolean }>("/api/admin/coupons", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteCoupon: (id: string) =>
    request<{ success: boolean }>(`/api/admin/coupons?id=${id}`, { method: "DELETE" }),
  getUsers: () => request<{ users: any[]; rechargeRequests: any[] }>("/api/admin/users"),
  /*
    One member, by what an operator knows about them — a name, an email, a
    phone as they read it off a message. Answered by the database, so the
    picker that uses it no longer needs the whole members table in the browser.
  */
  searchMembers: (term: string) =>
    request<{ members: MemberMatch[] }>(`/api/admin/users?q=${encodeURIComponent(term)}`),
  membersByIds: (ids: string[]) =>
    ids.length === 0
      ? Promise.resolve({ members: [] as MemberMatch[] })
      : request<{ members: MemberMatch[] }>(
          `/api/admin/users?ids=${encodeURIComponent(ids.join(","))}`,
        ),
  createBananCode: (value: number, count = 1) =>
    request<{ success: boolean; codes: any[]; code: any }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "create_code", value, count }),
    }),
  listBananCodes: () =>
    request<{ codes: any[] }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "list_codes" }),
    }),
  deleteBananCode: (id: string) =>
    request<{ success: boolean }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "delete_code", id }),
    }),

  getBinanceTopups: () =>
    request<{ topups: any[]; intents: any[]; logs: any[] }>("/api/admin/binance-topups"),
  getUserLogs: (userId: string) =>
    request<{ logs: any[] }>(`/api/admin/users?userId=${encodeURIComponent(userId)}`),
  adjustBalance: (payload: { userId: string; amount: number; description?: string }) =>
    request<{ success: boolean; user: any }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ action: "adjust_balance", ...payload }),
    }),
  approveRecharge: (requestId: string, adminNotes?: string) =>
    request<{ success: boolean }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ action: "approve_recharge", requestId, adminNotes }),
    }),
  rejectRecharge: (requestId: string, adminNotes?: string) =>
    request<{ success: boolean }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ action: "reject_recharge", requestId, adminNotes }),
    }),
  upload: (dataUrl: string, folder?: string) =>
    request<{ url: string }>("/api/upload", {
      method: "POST",
      body: JSON.stringify({ dataUrl, folder }),
    }),
  importGame: (data: any, mode: "create" | "update" | "replace") =>
    request<{ success: boolean; gameId: string }>("/api/admin/import-game", {
      method: "POST",
      body: JSON.stringify({ data, mode }),
    }),
  getBananaData: () =>
    request<{
      stats: {
        circulatingBananas: number;
        userWalletsCount: number;
        activeListingsCount: number;
        activeListingsVolume: number;
        totalRedemptionsCount: number;
        totalBananasRedeemed: number;
      };
      settings: {
        rewardRatePerIqd: number;
        dinarPerBanana: number;
        openingPrice: number;
        promoRatePerMinute: number;
        signupGrant: number;
      };
      marketConfig: {
        basePrice: number;
        minPrice: number;
        maxPrice: number;
        commissionPercent: number;
        volatilityPercent: number;
        botsEnabled: boolean;
        botCount: number;
        botMinQuantity: number;
        botMaxQuantity: number;
        minListingQuantity: number;
        maxListingQuantity: number;
        promoRatePerMinute: number;
      };
      livePrice: number;
      bots: any[];
      rewards: any[];
      redemptions: any[];
      listings: any[];
      topUsers: any[];
    }>("/api/admin/banana"),
  saveBananaMarketConfig: (config: Record<string, unknown>) =>
    request<{ success: boolean; marketConfig: any }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "save_market_config", config }),
    }),
  saveBananaBot: (bot: any) =>
    request<{ success: boolean; id: string }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "save_bot", bot }),
    }),
  deleteBananaBot: (botId: string) =>
    request<{ success: boolean }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "delete_bot", botId }),
    }),

  saveBananaSettings: (settings: {
    rewardRatePerIqd?: number;
    dinarPerBanana?: number;
    openingPrice?: number;
    promoRatePerMinute?: number;
    signupGrant?: number;
  }) =>
    request<{ success: boolean; settings: any }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "save_settings", ...settings }),
    }),
  saveBananaReward: (reward: any) =>
    request<{ success: boolean; reward: any }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "save_reward", reward }),
    }),
  deleteBananaReward: (rewardId: string) =>
    request<{ success: boolean; rewardId: string }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "delete_reward", rewardId }),
    }),
  toggleBananaReward: (rewardId: string, isActive: boolean) =>
    request<{ success: boolean; rewardId: string; isActive: boolean }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "toggle_reward", rewardId, isActive }),
    }),
  updateBananaRedemption: (
    redemptionId: string,
    payload: { status?: string; adminNotes?: string; deliveryCode?: string },
  ) =>
    request<{ success: boolean; redemptionId: string }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "update_redemption", redemptionId, ...payload }),
    }),
  cancelBananaListing: (listingId: string) =>
    request<{ success: boolean; refundedBananas: number }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "cancel_listing", listingId }),
    }),
  adjustUserBanana: (userId: string, amount: number, reason?: string) =>
    request<{ success: boolean; userId: string; oldBalance: number; newBalance: number }>(
      "/api/admin/banana",
      {
        method: "POST",
        body: JSON.stringify({ action: "adjust_balance", userId, amount, reason }),
      },
    ),
};

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("failed_to_read_file"));
    reader.readAsDataURL(file);
  });
}

export function uploadFileWithProgress(
  file: File,
  folder = "chat",
  onProgress?: (percent: number) => void,
): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", folder);

    xhr.open("POST", "/api/upload");
    xhr.withCredentials = true;

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch {
          reject(new Error("Invalid response from server"));
        }
      } else {
        try {
          const errData = JSON.parse(xhr.responseText);
          reject(new Error(errData.error || `Upload failed with status ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.timeout = 60000;

    xhr.send(formData);
  });
}
