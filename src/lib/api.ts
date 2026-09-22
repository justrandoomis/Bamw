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
    /*
      A 401 says one thing and it is not an error the member can act on by
      reading it. The server answers `{ "error": "unauthorised" }`, this turned
      that word straight into a toast, and a signed-out visitor tapping "شحن
      الرصيد" was shown the English string «unauthorised» with nothing to do
      about it.

      So the status decides the wording, not the payload, and the flag below is
      what lets a screen send the visitor to sign in instead of apologising to
      them.
    */
    const unauthorized = response.status === 401;
    // Keep structured hints on the thrown error
    const errorText = unauthorized
      ? "سجّل الدخول للمتابعة"
      : data.message ||
        (data.error && data.error !== "server_error" ? data.error : null) ||
        data.details ||
        data.sqlError ||
        (data.error === "server_error"
          ? "خطأ في السيرفر أو قاعدة البيانات"
          : "حدث خطأ، حاول مرة أخرى");
    const error = Object.assign(new Error(errorText), data, {
      message: errorText,
      status: response.status,
      unauthorized,
    });
    throw error;
  }
  return data;
}

/**
 * POSTs that must never be retried, and why each one is here.
 *
 * A timeout means the answer did not arrive. It does not mean the request did
 * not happen — the server may have done the work and lost the reply. Retrying
 * is therefore only safe where the second attempt cannot spend anything twice,
 * and the rule was written with `/api/otp` alone in it while three other
 * endpoints had grown the same problem.
 *
 * `/api/wheel`: a spin claims a ticket, and the claim carries no key the
 * server could recognise a second time. A slow network on a spin costs the
 * member a ticket they never watched being spent. (Buying tickets is safe —
 * it sends a `requestId` — but the spin shares the route, and excluding the
 * route is the honest boundary.)
 *
 * `/api/banana`: creating a market listing debits the seller's bananas and
 * inserts a row, with no idempotency key anywhere on the path. A retry makes
 * two listings and takes the bananas twice.
 *
 * Anything carrying an idempotency key — order creation does — is safe to
 * retry and deliberately absent from this list.
 */
const NEVER_RETRY_POST = ["/api/otp", "/api/wheel", "/api/banana"];

async function request<T>(url: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
  // A hung request must never leave the UI stuck on a loading screen,
  // but a single slow network hiccup should not fail the whole action either.
  try {
    return await attempt<T>(url, init, timeoutMs);
  } catch (err) {
    if (err instanceof RequestTimeoutError && !init?.signal?.aborted) {
      const method = String(init?.method ?? "GET").toUpperCase();
      if (method === "POST" && NEVER_RETRY_POST.some((path) => url.includes(path))) {
        throw err;
      }
      return await attempt<T>(url, init, timeoutMs);
    }
    throw err;
  }
}

/** Exported for the test that holds this list to its reasons. */
export const __NEVER_RETRY_POST = NEVER_RETRY_POST;

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
    /*
      «المحفظة» or «الدفع عند الاستلام». The server offers cash only when every
      line is something a courier carries, and refuses this outright otherwise —
      so sending it is asking, not choosing.
    */
    paymentMethod?: "wallet" | "cash_on_delivery",
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
        paymentMethod,
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
      /* Returned by `complete_digital_manual`: which slots were forced, and
         from what state. Ids only — never what was in them. */
      forcedDeliveryItems?: { id: string; from: string }[];
      archivedUnmappedItems?: string[];
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
   * The whole catalogue, as an admin sees it, in the listing projection.
   *
   * `/api/admin/products` answers a *page* — fifty rows of `product_index`,
   * which carries `title` and `title_en` and no Arabic name at all. Any admin
   * tool that has to search or pick across the catalogue (the bundle game
   * picker) therefore could not see two thirds of the shop, and could not
   * search the third it saw in the language the shop is written in.
   *
   * This is `/api/data?slim=1`, which for an admin skips the public filter and
   * so carries hidden products — the ones just imported, which are exactly the
   * ones an admin is looking for — and carries `titleAr`. The response is
   * `private, no-store`, and it must never be written to `localStorage`.
   */
  catalogue: (signal?: AbortSignal) =>
    request<StoreDoc>("/api/data?slim=1", signal ? { signal } : undefined),

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
  /**
   * A game the shop does not carry yet, created from a bundle's description.
   *
   * Hidden and unpriced on purpose: it exists so the bundle can point at
   * something real and so the admin has a row to fill in, not so it can be
   * sold. `isProductPriced` refuses a zero price, so it cannot reach a
   * customer before somebody finishes it.
   */
  createPlaceholderGame: (name: string) =>
    request<{ success?: boolean; product?: { id: string }; id?: string }>("/api/admin/products", {
      method: "POST",
      body: JSON.stringify({
        title: name,
        titleEn: name,
        price: 0,
        isHidden: true,
        category: "cat_nintendo",
        categoryId: "cat_nintendo",
      }),
    }),

  saveBananaMarketConfig: (config: Record<string, unknown>) =>
    request<{ success: boolean; marketConfig: any }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "save_market_config", config }),
    }),
  /** «حظ أوفر», the price bands and what a ticket costs — all one save. */
  saveWheelOdds: (odds: {
    tiers?: { upTo: number | null; weight: number; label: string }[];
    losingPercent?: number;
    ticketPriceBananas?: number;
  }) =>
    request<{ success: boolean; wheelOdds: any }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "save_wheel_odds", odds }),
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
  /*
    How many wheel tickets a redemption reward hands over. Zero removes it
    from the wheel, which is why the argument is a number and not a flag.
  */
  setBananaRewardTickets: (offerId: string, ticketQuantity: number) =>
    request<{ success: boolean; offerId: string; ticketQuantity: number }>("/api/admin/banana", {
      method: "POST",
      body: JSON.stringify({ action: "set_ticket_offer", offerId, ticketQuantity }),
    }),
  /*
    The other way a member gets a ticket: the shop hands one over.
    `referenceId` is what makes a double press harmless — the ledger's unique
    index refuses the second one and the reply says it changed nothing.
  */
  grantWheelTickets: (payload: {
    userId: string;
    quantity: number;
    reason?: string;
    referenceId?: string;
  }) =>
    request<{ success: boolean; granted: boolean; tickets: number; note?: string }>(
      "/api/admin/banana",
      {
        method: "POST",
        body: JSON.stringify({ action: "grant_wheel_tickets", ...payload }),
      },
    ),
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

/**
 * What to tell a member when an upload is refused, in their own language.
 *
 * The codes are the server's, and every one of them has a thing the member can
 * actually do about it. An unrecognised code falls through to the general
 * sentence rather than being printed — printing it is how «unsupported_image_
 * format» ended up on somebody's screen.
 */
function uploadErrorText(code: unknown, status: number): string {
  switch (String(code ?? "")) {
    case "unsupported_image_format":
      return "تعذر تحويل هذه الصورة. أرسلها بصيغة JPG أو PNG، أو اخترها من الاستوديو بدل «الملفات».";
    case "invalid_image":
      return "هذه الصورة بصيغة لا يدعمها المتجر. جرّب JPG أو PNG.";
    case "missing_file":
      return "لم يصل أي ملف. اختر الصورة مرة أخرى.";
    case "invalid_upload_folder":
      return "تعذر حفظ الملف في مكانه الصحيح، حاول مرة أخرى.";
    case "upload_storage_verification_failed":
      return "لم يكتمل حفظ الصورة، أعد المحاولة.";
    default:
      if (status === 401 || status === 403) return "انتهت الجلسة. سجّل الدخول ثم أعد الإرسال.";
      if (status === 413) return "الملف كبير جداً. أرسل صورة أصغر أو مقطعاً أقصر.";
      if (status === 429) return "محاولات كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة.";
      return "تعذر رفع الملف، حاول مرة أخرى.";
  }
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
          reject(new Error("تعذر فهم رد الخادم، حاول مرة أخرى."));
        }
      } else {
        /*
          The server writes an Arabic `message` beside its machine-readable
          `error`, and this read the machine-readable one — so a member whose
          photo was refused was shown the token «unsupported_image_format» and
          left to work out what to do about it.
        */
        try {
          const errData = JSON.parse(xhr.responseText);
          reject(new Error(errData.message || uploadErrorText(errData.error, xhr.status)));
        } catch {
          reject(new Error(uploadErrorText(undefined, xhr.status)));
        }
      }
    };

    xhr.onerror = () => reject(new Error("انقطع الاتصال أثناء الرفع، حاول مرة أخرى."));
    xhr.ontimeout = () =>
      reject(new Error("استغرق الرفع وقتاً طويلاً. تحقق من الاتصال أو أرسل ملفاً أصغر."));
    /*
      A minute is plenty for a photograph and nowhere near enough for a clip on
      a phone connection — a member sending a short video watched the progress
      bar reach ninety-odd percent and then be told it had timed out.
    */
    xhr.timeout = (file.type || "").toLowerCase().startsWith("video/") ? 180000 : 60000;

    xhr.send(formData);
  });
}
