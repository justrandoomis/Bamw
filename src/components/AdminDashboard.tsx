import React, { useState, useEffect } from "react";

import { financeTotals } from "@/lib/finance";
import { lastModifiedAt, sortProducts, type ProductSort } from "@/lib/productSort";
import {
  createProductsRequestGate,
  loadAdminProducts,
  productsRequestKey,
  LOAD_ATTEMPTS,
  type ProductsQuery,
  showsPerformanceWarning,
} from "@/lib/adminProductsLoad";
import {
  productSortQuery,
  readProductSort,
  toggleProductSort,
  writeProductSort,
} from "@/lib/productSort.browser";
import { useTranslation } from "../i18n";
import {
  Search,
  LayoutDashboard,
  Tag,
  MessageSquare,
  Package,
  BarChart2,
  Settings,
  Menu,
  ArrowRight,
  ArrowLeft,
  Plus,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  Filter,
  HelpCircle,
  ArrowUpRight,
  ChevronDown,
  Folder,
  Image as ImageIcon,
  Music,
  Bell,
  Calendar,
  Upload,
  FileUp,
  Link,
  Clock,
  Megaphone,
  ChevronUp,
  Sparkles,
  Star,
  Layers,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Send,
  MessageCircle,
  DollarSign,
  Users,
  ShoppingCart,
  PieChart,
  Download,
  Lightbulb,
  Zap,
  Check,
  X,
  Wallet,
  Coins,
  Gift,
  CreditCard,
  MapPin,
  FileText,
  TrendingDown,
  ChevronRight,
  ClipboardList,
  BookOpen,
  ShieldCheck,
  LifeBuoy,
  Copy,
  CheckCircle2,
  UserCheck,
  Key,
  ShieldAlert,
  FileArchive,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminShortcuts } from "./support/AdminShortcuts";
import {
  getAdminThreads,
  getThreadMessages,
  sendMessage,
  setThreadMode,
} from "@/lib/support.functions";
import { ChatMessage, Thread, StoreDoc, AccountBundle } from "@/lib/types";

import { Sidebar, SidebarBody, SidebarLink } from "./ui/sidebar";
import AdminProductEditor from "./AdminProductEditor";
import AdminZipImportModal from "./admin/AdminZipImportModal";
import { AdminMediaRepairModal } from "./admin/AdminMediaRepairModal";
import KbEditor from "./admin/KbEditor";
import ServicesManager from "./admin/ServicesManager";
import ServicesDiscTradesAdminView from "./admin/services/DiscTradesAdminView";
import TradePriceManager from "./admin/TradePriceManager";
import ReviewsManager from "./admin/ReviewsManager";
import BundlesManager from "./admin/BundlesManager";
import { BananaManagementView } from "./admin/BananaManagementView";
import CouponsManager from "./admin/CouponsManager";
import ReferralsManager from "./admin/ReferralsManager";
import UsedListingsManager from "./admin/UsedListingsManager";
import { StoreAdvisorSection } from "./admin/StoreAdvisorSection";
import AdminInboxView from "./admin/inbox/AdminInboxView";
import OrdersManagerView from "./admin/OrdersManagerView";
import { RechargeReviewPanel } from "./admin/RechargeReviewPanel";
import { ImageMigrationPanel } from "./admin/ImageMigrationPanel";
import { AdminErrorBoundary } from "./admin/AdminErrorBoundary";
import { adminApi, fileToDataUrl } from "@/lib/api";
import { notifyCatalogChanged } from "@/lib/catalog-cache";

/**
 * The image-role warnings a save came back with.
 *
 * `sanitizeAndVerifyProductImages` has produced these on every save since it
 * was written and every caller discarded them, so the one place they were
 * meant to be seen — in front of the person who just saved, and can still fix
 * it — never saw one. They are advisory: the save has already succeeded by
 * the time these appear.
 */
function reportMediaWarnings(warnings: unknown) {
  if (!Array.isArray(warnings)) return;
  for (const warning of warnings.slice(0, 4)) {
    if (typeof warning !== "string" || !warning.trim()) continue;
    toast(warning, { icon: "⚠️", duration: 8000 });
  }
}
import mascot from "@/assets/bananto_logo.webp.asset.json";
import { useAuth } from "@/hooks/useAuth";
import { getDefaultRadioTracks } from "@/config/publicAssets";
import { resolveCategoryType } from "@/lib/productSection";
import { requiresPerformanceReview } from "@/lib/devicePerformance";

interface BannerDraft {
  imageUrl: string;
  targetUrl: string;
  startDate: string;
  endDate: string;
  posX: number;
  posY: number;
  scale: number;
  bgColor: string;
  width?: string;
  height?: string;
  id?: string;
}

interface NewGameRequest {
  id: string;
  game_name: string;
  user_id: string;
  user_name?: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

interface ProblemSolution {
  id: string;
  title: string;
  description: string;
  steps: string[];
  images: string[];
  category: string;
  created_at: string;
}

const defaultCategories: any[] = [];
const defaultOrders: any[] = [];
const defaultMessages: any[] = [];

import { safeStringify } from "../utils/safeJson";
import { isProductPriced, isProductHidden } from "@/lib/purchasable";
import { productsTableState } from "@/lib/adminProductsTableState";

/**
 * Rows per request.
 *
 * The endpoint's own default. Asking for more moves work back into the request
 * that used to time out, and the table shows one page at a time regardless.
 */
const ADMIN_PAGE_SIZE = 50;

/**
 * The read-only notice, with the reason and a way out.
 *
 * A banner that only says "something failed" leaves an admin with nothing to
 * do and nothing to report, so this carries the status, the server's error
 * reference and which binding the diagnostics endpoint says is down — and a
 * button, because an outage that ends should not need a page reload.
 */
function DbErrorBanner({
  message,
  detail,
  isRetrying,
  onRetry,
  className,
}: {
  message: string;
  detail: string;
  isRetrying: boolean;
  onRetry: () => void;
  className: string;
}) {
  return (
    <div
      className={`${className} rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">{message}</span>
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="rounded-md border border-red-400 px-3 py-1 text-[12px] font-bold transition-colors hover:bg-red-100 disabled:opacity-50 dark:hover:bg-red-500/20"
        >
          {isRetrying ? "جارٍ إعادة المحاولة..." : "إعادة المحاولة"}
        </button>
      </div>
      {detail && (
        <p className="mt-1 font-mono text-[11px] opacity-80" dir="ltr">
          {detail}
        </p>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const [activeSidebar, setActiveSidebar] = useState("dashboard");
  const [selectedChatThreadId, setSelectedChatThreadId] = useState<string | null>(null);
  const navigate = useNavigate();

  // Read URL query parameters on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      const threadParam = params.get("thread");
      if (tabParam) {
        setActiveSidebar(tabParam);
      }
      if (threadParam) {
        setSelectedChatThreadId(threadParam);
      }
    }
  }, []);

  const [isLoaded, setIsLoaded] = useState(false);
  const [productLoadStatus, setProductLoadStatus] = useState<
    "loading" | "loaded_with_data" | "loaded_empty" | "failed"
  >("loading");
  const [d1ProductCount, setD1ProductCount] = useState<number | null>(null);

  const [products, setProducts] = useState<any[]>([]);
  const [bundles, setBundles] = useState<AccountBundle[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [banners, setBanners] = useState<any[]>([]);
  const [musicList, setMusicList] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [visits, setVisits] = useState<number>(0);
  const [views, setViews] = useState<number>(0);
  const [gameRequests, setGameRequests] = useState<NewGameRequest[]>([]);
  const [discTrades, setDiscTrades] = useState<any[]>([]);
  const [problemSolutions, setProblemSolutions] = useState<ProblemSolution[]>([]);

  // Real database queries for orders and messages to ensure accurate statistics
  const { data: dbOrdersData } = useQuery({
    queryKey: ["admin_db_orders"],
    queryFn: async () => {
      const res = await fetch("/api/orders?all=true", { credentials: "include" });
      if (!res.ok) return { orders: [] };
      return (await res.json()) as { orders?: any[] };
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const { data: dbThreadsData } = useQuery({
    queryKey: ["admin_db_threads"],
    queryFn: async () => {
      const res = await fetch("/api/chat?surface=admin", { credentials: "include" });
      if (!res.ok) return { threads: [] };
      return (await res.json()) as { threads?: any[] };
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const effectiveOrders = React.useMemo(() => {
    if (
      dbOrdersData?.orders &&
      Array.isArray(dbOrdersData.orders) &&
      dbOrdersData.orders.length > 0
    ) {
      return dbOrdersData.orders;
    }
    return orders;
  }, [dbOrdersData?.orders, orders]);

  const effectiveMessages = React.useMemo(() => {
    if (
      dbThreadsData?.threads &&
      Array.isArray(dbThreadsData.threads) &&
      dbThreadsData.threads.length > 0
    ) {
      return dbThreadsData.threads;
    }
    return messages;
  }, [dbThreadsData?.threads, messages]);

  // true only after a SUCCESSFUL read; a failed read must never trigger writes
  const canWrite = React.useRef(false);
  // skip the first write per key (it would just echo the loaded snapshot back)
  const hydrated = React.useRef<Record<string, boolean>>({});
  const loadedSnapshots = React.useRef<Record<string, string>>({});
  const [dbError, setDbError] = useState("");
  /** What the server actually said, so a report can be matched to one log line. */
  const [dbErrorDetail, setDbErrorDetail] = useState("");
  /*
    The products endpoint reports separately from the store endpoint, because
    they fail separately: the store banner is about saving, this one is about
    the table, and collapsing them is what let a store outage present itself as
    an empty catalogue.
  */
  const [productsErrorDetail, setProductsErrorDetail] = useState("");
  /*
    The catalogue is paginated server-side now, so the table holds one page and
    the endpoint holds the total. Fifty is the endpoint's own default; asking
    for more only moves work back into the request that used to time out.
  */
  const [productPage, setProductPage] = useState({ page: 1, limit: 50, hasMore: false });
  /** A refresh in progress over rows that are still on screen. */
  const [isRefreshingProducts, setIsRefreshingProducts] = useState(false);
  /** Filter-chip counts over the whole catalogue, from the endpoint. */
  const [productFacets, setProductFacets] = useState({
    hidden: 0,
    unpriced: 0,
    performanceRequired: 0,
  });
  const [isReloading, setIsReloading] = useState(false);

  /**
   * One endpoint, one verdict.
   *
   * The admin table used to fail as a pair. `/api/admin/store` and
   * `/api/admin/products` shared a single `AbortController` and a single 45s
   * timeout, and the loader ended with one opaque throw —
   * `Store HTTP err, Products HTTP err` — whenever *either* half came back
   * wrong. Three separate failures wore that one message:
   *
   *  - store failed, products succeeded → the table had its rows and still
   *    showed the red "protection mode" banner, because the throw came after
   *    the rows were already in state;
   *  - store hung → `Promise.allSettled` held the products response for up to
   *    45 seconds, which is the spinner that looked like it never ended;
   *  - either fetch rejected → the rejection reason was dropped on the floor
   *    and replaced by the word `err`, so nothing said *what* had gone wrong.
   *
   * Each endpoint now carries its own controller, timeout, bounded retry and
   * reported state, and every attempt logs the path, the HTTP status, the
   * server's own error body and the elapsed time.
   */
  const fetchAdminJson = React.useCallback(
    async <T,>(
      path: string,
      signal: AbortSignal,
      timeoutMs = 20000,
    ): Promise<{ ok: boolean; data: T | null; detail: string }> => {
      const startedAt = Date.now();
      const controller = new AbortController();
      const onOuterAbort = () => controller.abort();
      signal.addEventListener("abort", onOuterAbort);
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const describe = (what: string) => `${path} — ${what} — ${Date.now() - startedAt}ms`;

      try {
        const res = await fetch(path, { credentials: "include", signal: controller.signal });
        if (!res.ok) {
          /*
            The body is where the server names the binding that failed and the
            reference to match it to a log line, so it goes in front of the
            admin rather than into a swallowed console call.
          */
          const body = (await res.text().catch(() => "")).trim().slice(0, 300);
          const detail = describe(`HTTP ${res.status}${body ? ` — ${body}` : ""}`);
          console.error("[admin:load]", detail);
          return { ok: false, data: null, detail };
        }
        const data = (await res.json()) as T;
        const detail = describe(`HTTP ${res.status}`);
        console.info("[admin:load]", detail);
        return { ok: true, data, detail };
      } catch (err) {
        const outerAbort = signal.aborted;
        const timedOut = !outerAbort && err instanceof Error && err.name === "AbortError";
        const detail = describe(
          timedOut
            ? `انتهت المهلة بعد ${timeoutMs}ms`
            : err instanceof Error
              ? `${err.name}: ${err.message}`
              : "fetch failed",
        );
        // An unmount is not a failure; anything else is worth a log line.
        if (!outerAbort) console.error("[admin:load]", detail);
        return { ok: false, data: null, detail };
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onOuterAbort);
      }
    },
    [],
  );

  /** A wait that ends early when the page is left, so nothing lingers past unmount. */
  const backoff = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });

  /** Hydrates the store metadata (categories, orders, banners…) around the table. */
  const applyStore = React.useCallback((data: any) => {
    for (const key of [
      "products",
      "bundles",
      "banners",
      "categories",
      "orders",
      "messages",
      "musicList",
      "notifications",
      "gameRequests",
      "discTrades",
      "problemSolutions",
    ]) {
      hydrated.current[key] = true;
      if (data[key] !== undefined) {
        loadedSnapshots.current[key] = safeStringify(data[key]);
      }
    }

    const cleanArray = <T,>(arr: unknown): T[] =>
      (Array.isArray(arr) ? arr : []).filter((x) => x && typeof x === "object") as T[];

    if (Array.isArray(data.bundles)) setBundles(cleanArray(data.bundles));
    if (Array.isArray(data.banners)) setBanners(cleanArray(data.banners));
    if (Array.isArray(data.categories))
      setCategories(
        cleanArray<any>(data.categories).map((c) => ({
          ...c,
          id: String(c.id || ""),
          title: String(c.title || c.name || ""),
        })),
      );
    if (Array.isArray(data.orders)) setOrders(cleanArray(data.orders));
    if (Array.isArray(data.messages)) setMessages(cleanArray(data.messages));
    if (Array.isArray(data.musicList)) setMusicList(cleanArray(data.musicList));
    if (Array.isArray(data.notifications)) setNotifications(cleanArray(data.notifications));
    if (Array.isArray(data.gameRequests)) setGameRequests(cleanArray(data.gameRequests));
    if (Array.isArray(data.discTrades)) setDiscTrades(cleanArray(data.discTrades));
    if (Array.isArray(data.problemSolutions))
      setProblemSolutions(cleanArray(data.problemSolutions));

    if (typeof data.visits === "number") setVisits(data.visits);
    if (typeof data.views === "number") setViews(data.views);
  }, []);

  /**
   * Loads the product table, and settles on exactly one of three states:
   * loaded with rows, a catalogue the server confirms is empty, or an error
   * carrying the failing path and status next to a Retry button. The retry
   * policy lives in `loadAdminProducts`, which is bounded — so there is no
   * fourth state where the spinner just keeps turning.
   */
  /*
    One request per distinct question. A sort change used to be able to fire
    from the click handler and again from an effect watching the sort state,
    and the two answers raced — the slower one landing last and putting the
    table back in the previous order. The gate collapses simultaneous
    duplicates by key and keeps nothing after they settle, so Retry still
    really re-asks.
  */
  const requestGate = React.useRef(createProductsRequestGate()).current;

  const loadProducts = React.useCallback(
    async (signal: AbortSignal, request?: ProductsQuery): Promise<boolean> => {
      const sort = request?.sort ?? readProductSort();
      const page = Math.max(1, request?.page ?? 1);
      const search = (request?.search ?? "").trim();
      /*
        Filters travel with the request. Applying them in the browser would
        filter the fifty rows this page happens to hold, so "المخفية" would
        mean "hidden on this page" — and the counts beside the chips would mean
        even less. Both come from the endpoint, over the whole catalogue.
      */
      const filters = [
        request?.hidden ? "hidden" : "",
        request?.unpriced ? "unpriced" : "",
        request?.performance ? "performance" : "",
        request?.category ?? "",
      ]
        .filter(Boolean)
        .join(",");

      const key = productsRequestKey({
        page,
        limit: ADMIN_PAGE_SIZE,
        sort: sort.field,
        dir: sort.direction,
        search: `${search}#${filters}`,
      });

      const params = new URLSearchParams(productSortQuery(sort));
      params.set("page", String(page));
      params.set("limit", String(ADMIN_PAGE_SIZE));
      if (search) params.set("search", search);
      if (request?.hidden) params.set("hidden", "1");
      if (request?.unpriced) params.set("unpriced", "1");
      if (request?.performance) params.set("performance", "1");
      if (request?.category) params.set("category", request.category);

      /*
        The table is not cleared first. A refresh that empties the rows and then
        refills them flashes an empty catalogue on every sort click, and if the
        refresh fails the admin is left looking at zero products that do exist.
        Rows are replaced only after a response has been validated.
      */
      setIsRefreshingProducts(true);
      const outcome = await requestGate
        .run(key, () =>
          loadAdminProducts({
            fetchJson: (path, sig) => fetchAdminJson<unknown>(path, sig),
            path: `/api/admin/products?${params.toString()}`,
            signal,
            delay: (ms) => backoff(ms, signal),
          }),
        )
        .finally(() => setIsRefreshingProducts(false));

      if (outcome.state === "aborted") return true;

      if (outcome.state === "loaded") {
        setProducts(outcome.products as any);
        setD1ProductCount(outcome.d1Count);
        setProductPage({ page: outcome.page, limit: outcome.limit, hasMore: outcome.hasMore });
        if (outcome.facets) setProductFacets(outcome.facets);
        setProductLoadStatus("loaded_with_data");
        setProductsErrorDetail("");
        return true;
      }

      if (outcome.state === "empty") {
        setProducts([]);
        setD1ProductCount(outcome.d1Count);
        setProductPage({ page: outcome.page, limit: outcome.limit, hasMore: outcome.hasMore });
        if (outcome.facets) setProductFacets(outcome.facets);
        setProductLoadStatus("loaded_empty");
        setProductsErrorDetail("");
        return true;
      }

      setProductsErrorDetail(outcome.detail);
      // Rows already on screen stay on screen; only a table that never loaded
      // switches to the error state.
      setProductLoadStatus((prev) =>
        prev === "loaded_with_data" || prev === "loaded_empty" ? prev : "failed",
      );
      return false;
    },
    [fetchAdminJson, requestGate],
  );

  /**
   * Loads store metadata. Failing here disables saving — writing a store key
   * from a page that never read one would publish whatever the empty local
   * state happens to hold — but it deliberately says nothing about the product
   * table, which has its own endpoint and its own verdict.
   */
  const loadStoreMeta = React.useCallback(
    async (signal: AbortSignal): Promise<boolean> => {
      let lastDetail = "";
      for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt++) {
        if (signal.aborted) return true;
        const result = await fetchAdminJson<any>("/api/admin/store", signal);
        if (signal.aborted) return true;

        if (result.ok && result.data && typeof result.data === "object") {
          applyStore(result.data);
          canWrite.current = true;
          setDbError("");
          setDbErrorDetail("");
          return true;
        }
        lastDetail = result.ok ? `${result.detail} — استجابة غير صالحة` : result.detail;
        if (attempt < LOAD_ATTEMPTS - 1) await backoff(1000 * 2 ** attempt, signal);
      }

      if (signal.aborted) return true;
      setDbError(
        "تعذر قراءة إعدادات المتجر — الحفظ متوقف مؤقتاً. قائمة المنتجات تُحمَّل بشكل مستقل.",
      );
      setDbErrorDetail(lastDetail);
      return false;
    },
    [applyStore, fetchAdminJson],
  );

  /*
    Started together, reported apart.

    Both halves write their own state the moment they resolve, so the product
    table paints as soon as its own response arrives — a slow or failing store
    read can no longer hold it back, and can no longer take it down. Awaiting
    both only decides what the Retry button reports.
  */
  const loadFromDb = React.useCallback(
    async (signal: AbortSignal): Promise<boolean> => {
      const [productsOk, storeOk] = await Promise.all([
        loadProducts(signal),
        loadStoreMeta(signal),
      ]);
      if (!signal.aborted) setIsLoaded(true);
      return productsOk && storeOk;
    },
    [loadProducts, loadStoreMeta],
  );

  /*
    The products view asks for a page, an order or a filter; this runs it.

    Each call aborts the one before it, so an answer that arrives late — a slow
    first sort landing after a fast second one — cannot write its rows over the
    newer result. That is the other half of "one authoritative request": the
    gate stops duplicates, this stops stale winners.
  */
  const productsQueryController = React.useRef<AbortController | null>(null);
  const runProductsQuery = React.useCallback(
    (query: ProductsQuery) => {
      productsQueryController.current?.abort();
      const controller = new AbortController();
      productsQueryController.current = controller;
      void loadProducts(controller.signal, query);
    },
    [loadProducts],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void loadFromDb(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadFromDb]);

  const retryDbLoad = React.useCallback(async () => {
    setIsReloading(true);
    setProductLoadStatus((prev) => (prev === "failed" ? "loading" : prev));
    try {
      const controller = new AbortController();
      const ok = await loadFromDb(controller.signal);
      if (ok) {
        toast.success("تم الاتصال بقاعدة البيانات بنجاح — الحفظ مفعّل");
      } else {
        toast.error("تعذر استرجاع كامل البيانات، يرجى المحاولة بعد لحظات");
      }
    } finally {
      setIsReloading(false);
    }
  }, [loadFromDb]);

  const saveToDb = React.useCallback(async (key: string, value: any) => {
    if (!canWrite.current) return;
    const serialized = safeStringify(value);
    if (!hydrated.current[key]) {
      hydrated.current[key] = true;
      loadedSnapshots.current[key] = serialized;
      return;
    }
    // Skip saving if data did not actually change from the loaded snapshot
    if (loadedSnapshots.current[key] === serialized) {
      return;
    }
    loadedSnapshots.current[key] = serialized;

    try {
      const res = await fetch("/api/data", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: safeStringify({ [key]: value }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`فشل حفظ (${key}):`, text.slice(0, 100));
        return;
      }
      setDbError("");
      console.log(`Saved ${key} to DB`);
    } catch (e) {
      console.error(`Save ${key} network error:`, e);
    }
  }, []);

  React.useEffect(() => {
    void saveToDb("categories", categories);
  }, [categories, isLoaded, saveToDb]);
  React.useEffect(() => {
    void saveToDb("bundles", bundles);
  }, [bundles, isLoaded, saveToDb]);
  React.useEffect(() => {
    void saveToDb("orders", orders);
  }, [orders, isLoaded, saveToDb]);
  React.useEffect(() => {
    void saveToDb("messages", messages);
  }, [messages, isLoaded, saveToDb]);
  React.useEffect(() => {
    void saveToDb("banners", banners);
  }, [banners, isLoaded, saveToDb]);
  React.useEffect(() => {
    void saveToDb("musicList", musicList);
  }, [musicList, isLoaded, saveToDb]);
  React.useEffect(() => {
    void saveToDb("notifications", notifications);
  }, [notifications, isLoaded, saveToDb]);
  React.useEffect(() => {
    void saveToDb("gameRequests", gameRequests);
  }, [gameRequests, isLoaded, saveToDb]);
  React.useEffect(() => {
    void saveToDb("discTrades", discTrades);
  }, [discTrades, isLoaded, saveToDb]);
  React.useEffect(() => {
    void saveToDb("problemSolutions", problemSolutions);
  }, [problemSolutions, isLoaded, saveToDb]);

  const [open, setOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (groupId: string) => {
    if (!open) setOpen(true);
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const sidebarItems = [
    { id: "dashboard", icon: LayoutDashboard, label: "لوحة التحكم" },
    { id: "store_advisor", icon: Sparkles, label: "مستشار المتجر الذكي" },
    { id: "categories", icon: Folder, label: "الأقسام" },
    {
      id: "listings",
      icon: Package,
      label: "المنتجات",
      children: [
        { id: "listings_all", icon: Tag, label: "جميع المنتجات" },
        ...(Array.isArray(categories) ? categories : [])
          .filter((c: any) => c && c.id)
          .map((c: any) => ({
            id: `listings_${c.id}`,
            icon: Tag,
            label: c.title || c.name || "قسم",
          })),
      ],
    },
    { id: "bundles", icon: Layers, label: "حزم الحسابات (Bundles)" },
    {
      id: "marketing",
      icon: Megaphone,
      label: "الإعلانات",
      children: [
        { id: "banners", icon: ImageIcon, label: "البنرات الإعلانية" },
        { id: "notifications", icon: Bell, label: "الإشعارات" },
      ],
    },
    { id: "music", icon: Music, label: "الموسيقى" },
    { id: "messages", icon: MessageSquare, label: "الدعم والمحادثات" },

    { id: "reviews", icon: Star, label: "تقييمات الأعضاء" },
    { id: "game_requests", icon: Sparkles, label: "طلبات الألعاب" },
    { id: "used_listings", icon: Tag, label: "سوق المستعمل والمسترجع" },

    {
      id: "financial_mgmt",
      icon: DollarSign,
      label: "الإدارة المالية",
      children: [
        { id: "financial_stats", icon: PieChart, label: "التكلفة والأرباح" },
        { id: "pricing_settings", icon: Settings, label: "إعدادات السعر" },
        { id: "wallet_mgmt", icon: Wallet, label: "إدارة المحفظة" },
        { id: "binance_mgmt", icon: Zap, label: "عمليات Binance Pay" },
        { id: "banan_codes", icon: Coins, label: "إدارة أكواد بنانتا" },
        { id: "coupons", icon: Tag, label: "أكواد الخصم والكوبونات" },
        { id: "referrals", icon: Gift, label: "الإحالات — دعوة صديق" },
      ],
    },

    {
      id: "store_services",
      icon: HelpCircle,
      label: "خدمات وإرشادات المتجر",
      children: [
        { id: "services_requests", icon: Plus, label: "طلبات المنتجات" },
        { id: "services_disc_trades", icon: RefreshCw, label: "مقايضة الأقراص" },
        { id: "services_trade_library", icon: BookOpen, label: "مكتبة وأسعار المقايضة" },
        { id: "services_faq", icon: HelpCircle, label: "الأسئلة الشائعة" },
        { id: "services_policy", icon: ShieldCheck, label: "سياسة المتجر والمقايضة" },
        { id: "services_support", icon: LifeBuoy, label: "إعدادات الدعم" },
        { id: "services_guides", icon: BookOpen, label: "إرشادات الحساب" },
      ],
    },
    { id: "orders", icon: ShoppingCart, label: "إدارة الطلبات" },
    { id: "market_settings", icon: Sparkles, label: "إدارة واقتصاد الموز" },
    { id: "users", icon: Users, label: "إدارة المستخدمين" },
    {
      id: "import",
      icon: FileUp,
      label: "استيراد بيانات الألعاب",
      subtitle: "Deterministic Import",
    },
    { id: "image_migration", icon: ImageIcon, label: "نظام صور المنتجات (WebP)" },

    { id: "stats", icon: BarChart2, label: "الإحصائيات" },
    { id: "settings", icon: Settings, label: "الإعدادات" },
  ];

  const renderContent = () => {
    switch (activeSidebar) {
      case "dashboard":
        return (
          <DashboardHome
            changeTab={setActiveSidebar}
            orders={effectiveOrders}
            messages={effectiveMessages}
            products={products}
            categories={categories}
            visits={visits}
            views={views}
          />
        );
      case "store_advisor":
        return (
          <div className="w-full p-2 sm:p-6">
            <StoreAdvisorSection
              orders={effectiveOrders}
              messages={effectiveMessages}
              products={products}
              categories={categories}
              changeTab={setActiveSidebar}
            />
          </div>
        );
      case "categories":
        return <CategoriesView categories={categories} setCategories={setCategories} />;
      case "products":
      case "listings":
      case "listings_all":
      case activeSidebar.startsWith("listings_") ? activeSidebar : "": {
        const selectedCategoryId =
          activeSidebar === "listings_all" ||
          activeSidebar === "listings" ||
          activeSidebar === "products"
            ? null
            : activeSidebar.replace("listings_", "");
        return (
          <ListingsView
            products={products || []}
            setProducts={setProducts}
            categories={categories}
            initialCategoryId={selectedCategoryId}
            loadStatus={productLoadStatus}
            d1ProductCount={d1ProductCount}
            onRetry={retryDbLoad}
            isReloading={isReloading}
            loadError={dbError}
            loadErrorDetail={productsErrorDetail}
            onQuery={runProductsQuery}
            pageInfo={productPage}
            facets={productFacets}
            isRefreshing={isRefreshingProducts}
          />
        );
      }
      case "bundles":
        return (
          <BundlesManager
            bundles={bundles}
            products={products}
            onSaveBundles={(newBundles) => {
              setBundles(newBundles);
              void saveToDb("bundles", newBundles);
            }}
          />
        );
      case "banners":
        return <BannersView banners={banners} setBanners={setBanners} products={products} />;
      case "music":
        return <MusicView musicList={musicList} setMusicList={setMusicList} />;
      case "notifications":
        return (
          <NotificationsView notifications={notifications} setNotifications={setNotifications} />
        );
      case "reviews":
        return <ReviewsManager />;

      case "game_requests":
        return <GameRequestsView gameRequests={gameRequests} setGameRequests={setGameRequests} />;

      case "trade_prices":
        return <TradePriceManager />;
      case activeSidebar.startsWith("services_") ? activeSidebar : "":
        return <ServicesManager activeSubMenu={activeSidebar} />;
      case "disc_trades_admin":
        /*
          There used to be a second, inline trade screen here whose status
          dropdown only mutated React state — nothing it did reached the server.
          Both sidebar entries now render the one real view, which persists
          through the API and drives the status from the primary action.
        */
        return <ServicesDiscTradesAdminView />;
      case "messages":
        return (
          <AdminInboxView
            initialThreadId={selectedChatThreadId}
            onNavigateToOrder={() => {
              setActiveSidebar("orders");
            }}
          />
        );
      case "orders":
        return (
          <OrdersManagerView
            onNavigateToChat={(threadId) => {
              setSelectedChatThreadId(threadId);
              setActiveSidebar("messages");
            }}
          />
        );
      case "market_settings":
        return <BananaManagementView />;
      case "financial_stats":
        return <FinancialStatsView products={products} orders={effectiveOrders} />;
      case "pricing_settings":
        return <PricingSettingsView />;
      case "wallet_mgmt":
        return <WalletManagementView />;
      case "coupons":
        return <CouponsManager />;
      case "referrals":
        return <ReferralsManager />;
      case "used_listings":
        return <UsedListingsManager />;
      case "binance_mgmt":
        return <BinanceManagementView />;
      case "banan_codes":
        return <BananCodesView />;
      case "users":
        return <UsersManagementView />;
      case "import":
        void navigate({ to: "/admin/import" });
        return null;

      case "image_migration":
        return <ImageMigrationPanel />;

      case "stats":
        return (
          <StatsView
            orders={effectiveOrders}
            products={products}
            categories={categories}
            visits={visits}
            views={views}
            changeTab={setActiveSidebar}
          />
        );
      case "settings":
        return <SettingsView />;
      default:
        return (
          <DashboardHome
            changeTab={setActiveSidebar}
            orders={effectiveOrders}
            messages={effectiveMessages}
            products={products}
            categories={categories}
            visits={visits}
            views={views}
          />
        );
    }
  };

  return (
    <div
      className="flex flex-col md:flex-row h-[100dvh] w-full bg-card overflow-hidden text-[var(--admin-ink)] font-sans"
      dir="rtl"
    >
      {/* 
          '''Do not make any visual modifications. The phrases I write are commands to understand what I want, not to be written down. Understand their content well, then execute what is required.'''
                                        
                                            
                                            For the code present, I get the error below.

Please think step-by-step in order to resolve it.
      */}
      <Sidebar open={open} setOpen={setOpen} animate={true}>
        <SidebarBody className="border-l border-border bg-card">
          <div className="flex flex-col flex-1 h-full">
            <div className="flex items-center justify-between mb-4 mt-2 px-1">
              <h2
                className={`font-bold text-lg tracking-tight whitespace-nowrap overflow-hidden transition-all ${open ? "opacity-100 w-auto" : "opacity-0 w-0 hidden"}`}
              >
                إدارة المتجر
              </h2>
              <button
                onClick={() => setOpen(!open)}
                className="p-1 hover:bg-muted rounded-md text-muted-foreground transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4">
              <div className="flex items-center gap-2 py-2 text-muted-foreground hover:bg-muted rounded-md cursor-pointer transition-colors px-1">
                <Search className="w-5 h-5 flex-shrink-0" />
                <span
                  className={`text-[15px] whitespace-nowrap overflow-hidden transition-all ${open ? "opacity-100" : "opacity-0 w-0"}`}
                >
                  بحث
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar py-2">
              <div className="space-y-0.5">
                {sidebarItems.map((item) => {
                  if (item.children) {
                    const isExpanded = expandedGroups[item.id];
                    return (
                      <div key={item.id} className="space-y-0.5 px-2">
                        <button
                          onClick={() => toggleGroup(item.id)}
                          className={`w-full flex items-center justify-between px-2 py-2 rounded-md text-[15px] hover:bg-muted text-foreground transition-colors ${open ? "" : "px-0 justify-center"}`}
                        >
                          <div
                            className={`flex items-center gap-2 ${!open && "justify-center w-full"}`}
                          >
                            <item.icon
                              className="w-5 h-5 flex-shrink-0 text-muted-foreground"
                              strokeWidth={1.5}
                            />
                            <span
                              className={`whitespace-nowrap overflow-hidden transition-all ${open ? "opacity-100" : "opacity-0 w-0 hidden"}`}
                            >
                              {item.label}
                            </span>
                          </div>
                          {open && (
                            <div className="flex-shrink-0 text-muted-foreground">
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </div>
                          )}
                        </button>
                        {isExpanded && open && (
                          <div className="mr-4 pr-3 border-r border-border space-y-0.5 animate-in slide-in-from-top-2">
                            {item.children.map((child) => {
                              const isActive = activeSidebar === child.id;
                              return (
                                <SidebarLink
                                  key={child.id}
                                  link={{
                                    label: child.label,
                                    icon: (
                                      <child.icon
                                        className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-[var(--brand-red-dark)]" : "text-blue-500"}`}
                                        strokeWidth={isActive ? 2 : 1.5}
                                      />
                                    ),
                                    onClick: () => setActiveSidebar(child.id),
                                  }}
                                  className={`w-full rounded-md px-2 text-[14px] transition-colors py-1.5 ${isActive ? "bg-muted font-semibold text-[var(--brand-red-dark)]" : "hover:bg-muted text-muted-foreground"}`}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }

                  const isActive = activeSidebar === item.id;
                  return (
                    <div key={item.id} className="px-2">
                      <SidebarLink
                        link={{
                          label: item.label,
                          icon: (
                            <item.icon
                              className={`w-5 h-5 flex-shrink-0 ${isActive ? "text-foreground" : "text-muted-foreground"}`}
                              strokeWidth={isActive ? 2 : 1.5}
                            />
                          ),
                          onClick: () => setActiveSidebar(item.id),
                        }}
                        className={`w-full px-2 rounded-md text-[15px] transition-colors ${isActive ? "bg-muted font-semibold text-foreground" : "hover:bg-muted text-foreground"}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Sales Channels */}
            <div className="pt-4 border-t border-border mt-4">
              <div
                className={`text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 whitespace-nowrap overflow-hidden transition-all ${open ? "opacity-100" : "opacity-0 h-0 w-0 m-0 p-0 hidden"}`}
              >
                قنوات البيع
              </div>
              <div
                className="flex items-center justify-between hover:bg-muted cursor-pointer p-1 rounded-md transition-colors"
                onClick={() => navigate({ to: "/" })}
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 flex-shrink-0 rounded bg-amber-500/20 text-white flex items-center justify-center p-0.5 overflow-hidden">
                    <img src={mascot.url} alt="Logo" className="w-full h-full object-contain" />
                  </div>
                  <div
                    className={`whitespace-nowrap overflow-hidden transition-all ${open ? "opacity-100" : "opacity-0 w-0"}`}
                  >
                    <div className="text-sm font-medium text-[var(--admin-ink)]">عرض المتجر</div>
                  </div>
                </div>
                {open && <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
              </div>
            </div>
          </div>
        </SidebarBody>
      </Sidebar>

      {/* Main Content - RTL for Arabic content */}
      <main
        className={`flex-1 h-full relative no-scrollbar ${
          activeSidebar === "messages" ? "overflow-hidden flex flex-col p-0 m-0" : "overflow-y-auto"
        }`}
        dir="rtl"
      >
        {activeSidebar === "messages" ? (
          <div className="w-full h-full flex-1 flex flex-col min-h-0 overflow-hidden p-0 m-0 max-w-none">
            {dbError && (
              <DbErrorBanner
                message={dbError}
                detail={dbErrorDetail}
                isRetrying={isReloading}
                onRetry={retryDbLoad}
                className="m-2"
              />
            )}
            <AdminErrorBoundary sectionName="صندوق الدعم والمحادثات">
              {renderContent()}
            </AdminErrorBoundary>
          </div>
        ) : (
          <div className="w-full px-4 py-6 pb-24 sm:px-8 lg:px-10">
            {dbError && (
              <DbErrorBanner
                message={dbError}
                detail={dbErrorDetail}
                isRetrying={isReloading}
                onRetry={retryDbLoad}
                className="mb-4"
              />
            )}
            <AdminErrorBoundary sectionName={activeSidebar}>{renderContent()}</AdminErrorBoundary>
          </div>
        )}
      </main>
    </div>
  );
}

// --- SUB-VIEWS ---

function DashboardHome({
  changeTab,
  orders = [],
  messages = [],
  products = [],
  categories = [],
  visits = 0,
  views = 0,
}: {
  changeTab: (tab: string) => void;
  orders?: any[];
  messages?: any[];
  products?: any[];
  categories?: any[];
  visits?: number;
  views?: number;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<"year" | "month" | "week" | "day">("year");
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);

  // Store Name state and inline editing
  const [storeName, setStoreName] = useState("بنانتو");
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("بنانتو");
  const [isSavingName, setIsSavingName] = useState(false);

  // Fetch store name setting
  useEffect(() => {
    fetch("/api/data")
      .then((res) => res.json())
      .then((data) => {
        if (data.settings?.storeName) {
          setStoreName(data.settings.storeName);
          setNameInput(data.settings.storeName);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveStoreName = async () => {
    if (!nameInput.trim()) return;
    setIsSavingName(true);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: safeStringify({
          settings: {
            storeName: nameInput.trim(),
          },
        }),
      });
      if (res.ok) {
        setStoreName(nameInput.trim());
        setIsEditingName(false);
        toast.success("تم تحديث اسم المتجر بنجاح");
      }
    } catch {
      toast.error("تعذر حفظ اسم المتجر");
    } finally {
      setIsSavingName(false);
    }
  };

  // Dynamic Time Greeting
  const currentHour = new Date().getHours();
  const greeting = currentHour >= 4 && currentHour < 12 ? "صباح الخير" : "مساء الخير";

  // Community Reviews calculation
  const { data: reviewsData } = useQuery({
    queryKey: ["admin_community_reviews"],
    queryFn: async () => {
      const res = await fetch("/api/reviews?scope=all", { credentials: "include" });
      if (!res.ok) return { reviews: [] };
      return res.json() as Promise<{ reviews?: any[] }>;
    },
    staleTime: 30_000,
  });

  const reviewsList = reviewsData?.reviews || [];
  const reviewsCount = reviewsList.length;
  const avgRating =
    reviewsCount > 0
      ? Math.round(
          (reviewsList.reduce((acc: number, r: any) => acc + (Number(r.rating) || 5), 0) /
            reviewsCount) *
            10,
        ) / 10
      : 5.0;

  const totalOrdersCount = orders.length;
  const totalVisitsCount = visits || 0;
  const totalViewsCount = views || 0;

  // Orders needing attention (awaiting payment or still being processed)
  const delayedOrdersCount = orders.filter((o) =>
    ["pending", "processing"].includes(String(o?.status ?? "")),
  ).length;
  const shippingTodayCount = orders.filter((o) => String(o?.status ?? "") === "delivering").length;

  // Inbox split: threads flagged for admin vs. ordinary buyer messages
  const helpRequestsCount = messages.filter(
    (m) => Boolean(m?.needsAdmin) || String(m?.mode ?? "") === "SUPPORT",
  ).length;
  const buyerMessagesCount = Math.max(0, messages.length - helpRequestsCount);

  // Catalog health
  const outOfStockCount = products.filter((p) => Number(p?.stock ?? p?.quantity ?? 0) <= 0).length;
  const inactiveProductsCount = products.filter(
    (p) => p?.active === false || p?.published === false,
  ).length;

  const periodLabel =
    period === "day"
      ? "اليوم"
      : period === "week"
        ? "آخر 7 أيام"
        : period === "month"
          ? "آخر شهر"
          : "آخر سنة";

  const periodStartMs = (() => {
    const day = 24 * 60 * 60 * 1000;
    const spans = { day: day, week: 7 * day, month: 30 * day, year: 365 * day } as const;
    return Date.now() - spans[period];
  })();

  /*
    Revenue is what customers paid for goods, so it goes through the same
    reckoning as the finance screen: `order.total` includes the delivery fee we
    collect for the courier, and a cancelled order stays "paid" right up until
    it is refunded. Both used to be counted here. Only the period filter is
    local — `financeTotals` decides what a sale is.

    Markup below is deliberately untouched; this is a change to the number, not
    to the screen.
  */
  const totalRevenue = financeTotals(
    orders.filter((o) => {
      const createdAt = Date.parse(String(o?.createdAt ?? o?.created_at ?? ""));
      return Number.isNaN(createdAt) ? true : createdAt >= periodStartMs;
    }),
  ).net;

  return (
    <div className="animate-in fade-in duration-300">
      {/* Do not make any visual modifications. The phrases I write are commands to understand what I want, not to be written down. Understand their content well, then execute what is required.
                                        
                                            
                                            أكمل الدفعة السادسة */}
      {/* Header */}
      <div className="flex items-start gap-4 mb-8">
        <div className="relative flex-shrink-0">
          <div
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-amber-500/10 border-2 border-amber-500/20 overflow-hidden flex items-center justify-center p-2.5 shadow-sm"
            title="أيقونة المتجر"
          >
            <img
              src={mascot.url}
              alt="Store Logo"
              className="w-full h-full object-contain drop-shadow-sm"
            />
          </div>
          <div
            className="w-10 h-10 rounded-full border-2 border-background absolute -bottom-2 -right-2 shadow-md overflow-hidden bg-muted flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary transition-all"
            onClick={() => void navigate({ to: "/profile" })}
            title="الملف الشخصي للمدير"
          >
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={user.name || "Admin"}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-[var(--admin-ink)] text-white flex items-center justify-center text-xs font-bold font-serif">
                {user?.name?.charAt(0) || "👤"}
              </div>
            )}
          </div>
        </div>
        <div className="pt-1 flex-1">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <span className="text-[20px] sm:text-[26px] font-serif text-[var(--admin-ink)]">
                  {greeting}،
                </span>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="text-[18px] sm:text-[22px] font-bold border border-border rounded-lg px-2.5 py-1 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveStoreName();
                    if (e.key === "Escape") setIsEditingName(false);
                  }}
                />
                <button
                  onClick={() => void handleSaveStoreName()}
                  disabled={isSavingName}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[var(--admin-ink)] text-white hover:opacity-90 transition-opacity"
                >
                  {isSavingName ? "جارٍ الحفظ…" : "حفظ"}
                </button>
                <button
                  onClick={() => {
                    setNameInput(storeName);
                    setIsEditingName(false);
                  }}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-muted text-foreground hover:bg-muted/80 transition-colors"
                >
                  إلغاء
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h1 className="text-[22px] sm:text-[28px] font-normal text-[var(--admin-ink)] font-serif flex items-center gap-1.5">
                  <span>{greeting}،</span>
                  <span className="font-bold">{storeName}</span>
                </h1>
                <button
                  onClick={() => {
                    setNameInput(storeName);
                    setIsEditingName(true);
                  }}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors opacity-70 group-hover:opacity-100"
                  title="تعديل اسم المتجر"
                >
                  <Edit className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
            <button
              type="button"
              onClick={() => changeTab("reviews")}
              className="flex items-center gap-1.5 hover:bg-muted/70 px-2 py-0.5 rounded-lg transition-colors group cursor-pointer border border-transparent hover:border-border"
              title="انقر للانتقال إلى إدارة تقييمات الأعضاء"
            >
              <div className="flex items-center gap-0.5 text-amber-500">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    className={`w-3.5 h-3.5 ${
                      reviewsCount > 0 && star <= Math.round(avgRating)
                        ? "fill-amber-400 text-amber-500"
                        : reviewsCount === 0
                          ? "fill-amber-400 text-amber-500"
                          : "text-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
              <span className="font-bold text-[13px] text-foreground group-hover:text-primary transition-colors">
                {reviewsCount > 0 ? avgRating.toFixed(1) : "جديد"}
              </span>
              <span className="text-muted-foreground text-[12px]">
                ({reviewsCount > 0 ? `${reviewsCount} تقييم` : "لا توجد تقييمات"})
              </span>
            </button>

            <span className="text-muted-foreground hidden sm:inline">|</span>
            <button
              type="button"
              onClick={() => changeTab("orders")}
              className="text-[13px] text-muted-foreground hover:text-foreground hover:underline transition-colors cursor-pointer"
            >
              {orders.length} طلبات
            </button>

            <span className="text-muted-foreground hidden sm:inline">|</span>
            <button
              type="button"
              onClick={() => changeTab("orders")}
              className="text-[13px] text-muted-foreground hover:text-foreground hover:underline transition-colors cursor-pointer"
            >
              {orders.length} مبيعات
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-border mb-8 flex gap-6 text-[15px]">
        <button className="pb-3 border-b-2 border-[var(--admin-ink)] font-semibold text-[var(--admin-ink)]">
          الرئيسية
        </button>
        <button
          onClick={() => changeTab("stats")}
          className="pb-3 border-b-2 border-transparent text-muted-foreground hover:text-[var(--admin-ink)] transition-colors"
        >
          النشاط الأخير
        </button>
      </div>

      {/* المهام الأساسية (Core Tasks) */}
      <div className="mb-10">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-[18px] font-bold text-[var(--admin-ink)]">المهام الأساسية</h2>
          <span className="text-xs text-green-700 bg-green-50 px-2.5 py-1 rounded-full font-medium border border-green-200 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            مُحدثة تلقائياً
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            onClick={() => changeTab("orders")}
            className="border border-border rounded-lg p-5 hover:border-black hover:shadow-md transition-all cursor-pointer bg-card group relative"
          >
            <div className="flex items-center justify-between mb-3 text-[var(--admin-ink)]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Package className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-[16px] flex items-center gap-1">
                  الطلبات{" "}
                  <ArrowLeft className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                </h3>
              </div>
              <span className="text-xs font-bold text-foreground bg-muted px-2 py-0.5 rounded-full">
                {orders.length}
              </span>
            </div>
            <div className="text-[13px] text-muted-foreground space-y-1.5">
              <p className="flex justify-between items-center">
                <span>طلبات بانتظار الشحن/الدفع:</span>
                <span
                  className={`font-semibold ${delayedOrdersCount > 0 ? "text-amber-600" : "text-foreground"}`}
                >
                  {delayedOrdersCount} طلبات
                </span>
              </p>
              <p className="flex justify-between items-center">
                <span>طلبات قيد الشحن اليوم:</span>
                <span className="font-semibold text-blue-600">{shippingTodayCount} طلبات</span>
              </p>
            </div>
          </div>

          <div
            onClick={() => changeTab("messages")}
            className="border border-border rounded-lg p-5 hover:border-black hover:shadow-md transition-all cursor-pointer bg-card group relative"
          >
            <div className="flex items-center justify-between mb-3 text-[var(--admin-ink)]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-[16px] flex items-center gap-1">
                  الرسائل{" "}
                  <ArrowLeft className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                </h3>
              </div>
              <span className="text-xs font-bold text-foreground bg-muted px-2 py-0.5 rounded-full">
                {messages.length}
              </span>
            </div>
            <div className="text-[13px] text-muted-foreground space-y-1.5">
              <p className="flex justify-between items-center">
                <span>طلبات الدعم والاستفسار:</span>
                <span className="font-semibold text-purple-600">{helpRequestsCount} طلبات</span>
              </p>
              <p className="flex justify-between items-center">
                <span>رسائل من مشترين محتملين:</span>
                <span className="font-semibold text-foreground">{buyerMessagesCount} رسائل</span>
              </p>
            </div>
          </div>

          <div
            onClick={() => changeTab("listings")}
            className="border border-border rounded-lg p-5 hover:border-black hover:shadow-md transition-all cursor-pointer bg-card group relative"
          >
            <div className="flex items-center justify-between mb-3 text-[var(--admin-ink)]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Tag className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-[16px] flex items-center gap-1">
                  المنتجات{" "}
                  <ArrowLeft className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                </h3>
              </div>
              <span className="text-xs font-bold text-foreground bg-muted px-2 py-0.5 rounded-full">
                {products.length}
              </span>
            </div>
            <div className="text-[13px] text-muted-foreground space-y-1.5">
              <p className="flex justify-between items-center">
                <span>منتجات نفدت كميتها:</span>
                <span
                  className={`font-semibold ${outOfStockCount > 0 ? "text-red-600" : "text-foreground"}`}
                >
                  {outOfStockCount} منتجات
                </span>
              </p>
              <p className="flex justify-between items-center">
                <span>منتجات متوقفة/غير نشطة:</span>
                <span className="font-semibold text-foreground">
                  {inactiveProductsCount} منتجات
                </span>
              </p>
            </div>
          </div>
        </div>
        <p className="text-[12px] text-muted-foreground mt-3 flex items-center gap-1">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          تظهر المهام الأساسية نشاط وتفاعل متجرك المباشر.
          <button
            onClick={() => changeTab("orders")}
            className="underline hover:text-foreground mr-1"
          >
            إدارة الطلبات بالتفصيل
          </button>
        </p>
      </div>

      {/* الإحصائيات (Statistics) */}
      <div className="mb-10">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-[18px] font-bold text-[var(--admin-ink)]">الإحصائيات</h2>
          <button
            onClick={() => changeTab("stats")}
            className="text-sm font-semibold underline text-[var(--admin-ink)] hover:text-foreground flex items-center gap-1"
          >
            عرض التقرير الكامل <ArrowLeft className="w-4 h-4" />
          </button>
        </div>
        <div className="border border-border rounded-lg p-6 bg-card shadow-sm">
          <div className="mb-6 relative inline-block">
            <button
              onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
              className="text-[13px] font-semibold flex items-center gap-2 text-[var(--admin-ink)] bg-muted border border-border hover:bg-muted px-3 py-1.5 rounded-md transition-colors"
            >
              <Calendar className="w-4 h-4 text-muted-foreground" />
              المدة: {periodLabel}
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
            {showPeriodDropdown && (
              <div className="absolute right-0 mt-1 w-44 bg-card border border-border rounded-lg shadow-lg z-20 overflow-hidden py-1">
                {[
                  { id: "day", label: "اليوم" },
                  { id: "week", label: "آخر 7 أيام" },
                  { id: "month", label: "آخر شهر" },
                  { id: "year", label: "آخر سنة" },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setPeriod(item.id as any);
                      setShowPeriodDropdown(false);
                    }}
                    className={`w-full text-right px-4 py-2 text-xs font-medium transition-colors ${period === item.id ? "bg-muted text-foreground font-bold" : "text-foreground hover:bg-muted"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-0 divide-x divide-x-reverse divide-border">
            <div className="pl-6">
              <h4 className="text-[14px] font-semibold text-muted-foreground mb-1">
                إجمالي المشاهدات
              </h4>
              <div className="text-[28px] sm:text-[32px] font-light text-[var(--admin-ink)] mb-1">
                {totalViewsCount.toLocaleString()}
              </div>
              <div className="text-[12px] text-muted-foreground flex items-center gap-1 mt-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div> تتبع
                مباشر
              </div>
            </div>
            <div className="px-6">
              <h4 className="text-[14px] font-semibold text-muted-foreground mb-1">الزيارات</h4>
              <div className="text-[28px] sm:text-[32px] font-light text-[var(--admin-ink)] mb-1">
                {totalVisitsCount.toLocaleString()}
              </div>
              <div className="text-[12px] text-muted-foreground flex items-center gap-1 mt-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div> تتبع
                مباشر
              </div>
            </div>
            <div className="px-6">
              <h4 className="text-[14px] font-semibold text-muted-foreground mb-1">الطلبات</h4>
              <div className="text-[28px] sm:text-[32px] font-light text-[var(--admin-ink)] mb-1">
                {totalOrdersCount}
              </div>
              <div className="text-[12px] text-muted-foreground flex items-center gap-1 mt-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div> مسجلة بالنظام
              </div>
            </div>
            <div className="pr-6">
              <h4 className="text-[14px] font-semibold text-muted-foreground mb-1">
                إجمالي الإيرادات
              </h4>
              <div
                className="text-[28px] sm:text-[32px] font-light text-[var(--admin-ink)] mb-1"
                dir="ltr"
              >
                د.ع {Math.round(totalRevenue).toLocaleString()}
              </div>
              <div className="text-[12px] text-muted-foreground flex items-center gap-1 mt-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div> حسب الطلبات
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* مستشار المتجر الذكي (Store Advisor) */}
      <StoreAdvisorSection
        orders={orders}
        messages={messages}
        products={products}
        categories={categories}
        changeTab={changeTab}
      />
    </div>
  );
}

/**
 * A column header that sorts the products table.
 *
 * The arrow points the way the column is currently ordered and is only drawn on
 * the active column, so it reads as state rather than as an affordance on every
 * header. `aria-sort` carries the same information to a screen reader, which the
 * arrow glyph alone does not.
 */
function SortHeader({
  label,
  field,
  sort,
  onSort,
}: {
  label: string;
  field: ProductSort["field"];
  sort: ProductSort;
  onSort: (field: ProductSort["field"]) => void;
}) {
  const active = sort.field === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className={`inline-flex items-center gap-1 rounded transition-colors hover:text-primary ${
        active ? "text-primary" : "text-foreground"
      }`}
    >
      <span>{label}</span>
      <span aria-hidden className="text-[10px] leading-none opacity-80">
        {active ? (sort.direction === "asc" ? "\u25B2" : "\u25BC") : "\u21C5"}
      </span>
    </button>
  );
}

function ListingsView({
  products,
  setProducts,
  categories,
  initialCategoryId,
  loadStatus = "loaded_with_data",
  d1ProductCount,
  onRetry,
  isReloading,
  loadError,
  loadErrorDetail,
  onQuery,
  pageInfo,
  facets,
  isRefreshing,
}: {
  products: any[];
  setProducts: any;
  categories: any[];
  initialCategoryId?: string | null;
  loadStatus?: "loading" | "loaded_with_data" | "loaded_empty" | "failed";
  d1ProductCount?: number | null;
  onRetry?: () => void;
  isReloading?: boolean;
  loadError?: string;
  loadErrorDetail?: string;
  /** Asks the server for a different page, order or filter. */
  onQuery?: (query: ProductsQuery) => void;
  pageInfo?: { page: number; limit: number; hasMore: boolean };
  facets?: { hidden: number; unpriced: number; performanceRequired: number };
  isRefreshing?: boolean;
}) {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [isOpeningEditor, setIsOpeningEditor] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [onlyUnpriced, setOnlyUnpriced] = useState(false);
  const [onlyMissingPerformance, setOnlyMissingPerformance] = useState(false);
  const [onlyHidden, setOnlyHidden] = useState(false);
  /*
    Read from storage, not reset to a default. Changing the search box or a
    filter changes *which* products are listed, never the order they are listed
    in, and an admin working through a price audit must not lose their place
    because they opened a product and came back.
  */
  const [sort, setSortState] = useState<ProductSort>(() => readProductSort());
  const applySort = (field: ProductSort["field"]) => {
    const next = toggleProductSort(sort, field);
    setSortState(next);
    writeProductSort(next);
  };
  const [showZipImport, setShowZipImport] = useState(false);
  const [showMediaRepair, setShowMediaRepair] = useState(false);
  const [productToDelete, setProductToDelete] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  /*
    Counted by the endpoint over the whole catalogue. Counting the loaded rows
    would make "المخفية (0)" mean "none on this page", which reads as a fact
    about the store and is not one.
  */
  const unpricedCount = facets?.unpriced ?? 0;
  const hiddenCount = facets?.hidden ?? 0;
  const isGameProduct = (product: any) => {
    const categoryId =
      typeof product.category === "string"
        ? product.category
        : typeof product.categoryId === "string"
          ? product.categoryId
          : product.category?.id;
    const category = categories.find((item: any) => String(item.id) === String(categoryId));
    return (
      resolveCategoryType(categoryId, category?.title, product.kind, product.schemaId) === "game"
    );
  };
  const missingPerformanceCount = facets?.performanceRequired ?? 0;
  /* The batch importer belongs to Nintendo Switch Games and nowhere else. */
  const sectionCategory = categories.find((item: any) => item.id === initialCategoryId);
  const isGamesSection =
    Boolean(initialCategoryId) &&
    resolveCategoryType(initialCategoryId || undefined, sectionCategory?.title) === "game";

  const hardwareProducts = (products || []).filter((product: any) => {
    const categoryId =
      typeof product.category === "string"
        ? product.category
        : typeof product.categoryId === "string"
          ? product.categoryId
          : product.category?.id;
    const category = categories.find((item: any) => String(item.id) === String(categoryId));
    return (
      resolveCategoryType(categoryId, category?.title, product.kind, product.schemaId) ===
      "hardware"
    );
  });

  /*
    The search box, the chips, the column headers and the pager all describe one
    question, and the endpoint answers it. Filtering here as well would filter
    the fifty rows this page holds — so "unpriced" would mean "unpriced on page
    one" and a search would miss every product the page does not contain.

    Debounced, because a search box fires per keystroke and each keystroke is a
    different question; the request gate collapses the duplicates a fast typist
    still produces.
  */
  React.useEffect(() => {
    if (!onQuery) return;
    const timer = window.setTimeout(
      () => {
        onQuery({
          page: 1,
          sort,
          search: searchTerm,
          hidden: onlyHidden,
          unpriced: onlyUnpriced,
          performance: onlyMissingPerformance,
          ...(initialCategoryId ? { category: initialCategoryId } : {}),
        });
      },
      searchTerm ? 300 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [
    onQuery,
    sort,
    searchTerm,
    onlyHidden,
    onlyUnpriced,
    onlyMissingPerformance,
    initialCategoryId,
  ]);

  const filteredProducts = (products || []).filter((p: any) => p && typeof p === "object");

  /*
    The same comparator the server used, applied again here.

    Not redundant: this view keeps the catalogue in memory and edits it in place
    — saving a price updates the row without a refetch — so a locally changed
    product has to move to its new position immediately. Sharing one comparator
    is what stops the two orders drifting, which shows up as a row that is in
    the right place right up until you touch it.
  */
  const sortedProducts = sortProducts(filteredProducts, sort);

  /*
    One rule for what the table shows, shared with its tests. Four independent
    `loadStatus === X && products.length === 0` conditions had no guarantee that
    exactly one of them held — which is how a response that set no state left
    every branch false but the spinner.
  */
  const tableState = productsTableState({
    status: loadStatus,
    rowCount: sortedProducts.length,
    isRefreshing,
  });

  // Log product diagnostics to verify D1 single source of truth and active filters
  useEffect(() => {
    console.log("[AdminProductsDiagnostics]", {
      d1ProductCount,
      fetchedCount: products.length,
      filteredCount: filteredProducts.length,
      renderedCount: sortedProducts.length,
      activeFilters: {
        searchTerm: searchTerm || undefined,
        onlyUnpriced,
        onlyMissingPerformance,
        onlyHidden,
        initialCategoryId: initialCategoryId || "all",
      },
      loadStatus,
    });
  }, [
    d1ProductCount,
    products.length,
    filteredProducts.length,
    sortedProducts.length,
    searchTerm,
    onlyUnpriced,
    onlyMissingPerformance,
    onlyHidden,
    initialCategoryId,
    loadStatus,
  ]);

  const resetAllFilters = () => {
    setSearchTerm("");
    setOnlyUnpriced(false);
    setOnlyMissingPerformance(false);
    setOnlyHidden(false);
  };

  const handleDelete = async (id: string) => {
    if (!id) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/admin/products?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || t("admin.deleteFailed") || "Delete failed");
      }
      /*
        The server has verified the product is gone from every representation
        before returning. Drop the catalogue snapshot and the service worker's
        data cache so the storefront cannot paint it again from a stale copy —
        targeted, so cached images are untouched.
      */
      notifyCatalogChanged(data?.catalogVersion);
      setProducts((prev: any[]) => prev.filter((p: any) => String(p.id) !== String(id)));
      toast.success(t("admin.deleted") || "تم الحذف بنجاح");
      setProductToDelete(null);
    } catch (err: any) {
      console.error("[DeleteProductError]", err);
      toast.error(err.message || t("admin.deleteFailed"));
    } finally {
      setIsDeleting(false);
    }
  };

  /*
    The row the table holds is a `product_index` projection — id, title, price,
    a single image. It is display data. Opening the editor on it meant the form
    initialised every field the projection lacks to "" or [], and `handleSave`
    diffed the result against that same thin row, so those empty defaults came
    back as deliberate changes and the server wrote them over the real product.

    The editor is therefore never handed a listing row. It gets the stored
    document, fetched by id, or it does not open.
  */
  const openProductForEdit = React.useCallback(async (row: any) => {
    const id = row?.id === undefined || row?.id === null ? "" : String(row.id).trim();
    if (!id) {
      toast.error("لا يمكن فتح منتج بدون معرّف");
      return;
    }
    setIsOpeningEditor(id);
    try {
      const res = await fetch(`/api/admin/products?id=${encodeURIComponent(id)}`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.product) {
        toast.error(
          data?.error || `تعذر تحميل المنتج الكامل (HTTP ${res.status}) — لم يتم فتح المحرر`,
          { duration: 8000 },
        );
        return;
      }
      setEditingProduct(data.product);
    } catch (err: any) {
      toast.error(`تعذر تحميل المنتج: ${err?.message || "خطأ في الشبكة"}`, { duration: 8000 });
    } finally {
      setIsOpeningEditor(null);
    }
  }, []);

  /*
    The publication floor refused a hidden→visible save: the product cannot yet
    answer "what is this and what does it cost". The refusal names the gaps.
    Publishing anyway stays possible — deliberate, one click, and recorded
    server-side — instead of a dead end the admin can only escape by re-hiding.
  */
  const offerPublishOverride = (result: any, productData: any) => {
    const missing = Array.isArray(result?.missing) ? result.missing.join("، ") : "";
    toast.error(`لا يمكن نشر المنتج قبل إكمال: ${missing || "الحقول الأساسية"}`, {
      id: "save-product",
      duration: 15000,
      description: "أكمل الحقول الناقصة، أو انشر رغم النقص وسيُسجَّل ذلك.",
      action: {
        label: "نشر على أي حال",
        onClick: () => {
          void handleSave({ ...productData, publishOverride: true });
        },
      },
    });
  };

  const handleSave = async (productData: any) => {
    try {
      if (!isAdding && editingProduct) {
        const dirtyFields: any = { id: editingProduct.id };
        let hasChanges = false;
        for (const key in productData) {
          if (JSON.stringify(productData[key]) !== JSON.stringify(editingProduct[key])) {
            dirtyFields[key] = productData[key];
            hasChanges = true;
          }
        }

        if (!hasChanges) {
          toast.success("لم يتم إجراء أي تعديلات", { id: "save-product" });
          setEditingProduct(null);
          setIsAdding(false);
          return;
        }

        toast.loading("جاري الحفظ...", { id: "save-product" });
        const res = await fetch("/api/admin/products", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: safeStringify(dirtyFields),
        });
        const result = await res.json().catch(() => null);
        if (!res.ok || !result?.success) {
          const errorMsg = result?.error || `HTTP ${res.status}: Failed to update product`;
          if (result?.code === "PRODUCT_NOT_PUBLISHABLE" && productData?.publishOverride !== true) {
            offerPublishOverride(result, productData);
          } else {
            toast.error(errorMsg, { id: "save-product", duration: 8000 });
          }
          throw Object.assign(new Error(errorMsg), { reported: true });
        }

        const savedProduct = result.product || { ...editingProduct, ...dirtyFields };
        notifyCatalogChanged(result?.catalogVersion);
        setProducts((prev: any[]) => {
          const index = prev.findIndex((p: any) => String(p.id) === String(savedProduct.id));
          if (index >= 0) {
            const next = [...prev];
            next[index] = savedProduct;
            return next;
          }
          return [savedProduct, ...prev];
        });
        toast.success("تم تحديث المنتج بنجاح", { id: "save-product" });
        setEditingProduct(null);
        setIsAdding(false);
        return;
      }

      const payloadString = safeStringify(productData);

      // If the payload is larger than 50KB, use staged/chunked save
      if (payloadString.length > 50 * 1024) {
        toast.loading("يتم الآن تجهيز الحفظ المجزأ...", { id: "save-product" });

        // 1. Start session
        const startRes = await fetch("/api/admin/products/save/start", {
          method: "POST",
          credentials: "include",
        });
        const startData = await startRes.json();
        if (!startData.save_session_id) throw new Error("Failed to start staged save session");
        const sessionId = startData.save_session_id;

        // 2. Split payload into logical chunks
        const coreKeys = [
          "id",
          "title",
          "titleEn",
          "description",
          "descriptionEn",
          "price",
          "cost",
          "stock",
          "categoryId",
          "category",
          "status",
          "isActive",
          "kind",
          "schemaId",
        ];
        const coreData: any = {};
        const imagesData: any = {};
        const contentData: any = {};
        const variantsData: any = {};
        const performanceData: any = {};
        const metadataData: any = {};

        for (const [key, value] of Object.entries(productData)) {
          if (coreKeys.includes(key)) {
            coreData[key] = value;
          } else if (key.toLowerCase().includes("image") || key === "gallery" || key === "banner") {
            imagesData[key] = value;
          } else if (key === "options" || key === "types" || key === "variants") {
            variantsData[key] = value;
          } else if (
            key.startsWith("perf_") ||
            key.includes("performance") ||
            key === "devicePerformance"
          ) {
            performanceData[key] = value;
          } else if (
            key === "content" ||
            key.includes("description") ||
            key === "specs" ||
            key === "details"
          ) {
            contentData[key] = value;
          } else {
            metadataData[key] = value;
          }
        }

        const chunks = [
          { part: "core", data: coreData },
          { part: "images", data: imagesData },
          { part: "variants", data: variantsData },
          { part: "performance", data: performanceData },
          { part: "content", data: contentData },
          { part: "metadata", data: metadataData },
        ];

        // 3. Upload chunks
        let i = 1;
        for (const chunk of chunks) {
          if (Object.keys(chunk.data).length === 0) continue;
          toast.loading(`يتم حفظ الجزء ${i} من ${chunks.length} (${chunk.part})...`, {
            id: "save-product",
          });
          const chunkRes = await fetch("/api/admin/products/save/chunk", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              save_session_id: sessionId,
              part: chunk.part,
              data: chunk.data,
            }),
          });
          if (!chunkRes.ok) throw new Error(`Failed to save chunk ${chunk.part}`);
          i++;
        }

        // 4. Finalize
        toast.loading("يتم الآن إتمام الحفظ وبناء المنتج...", { id: "save-product" });
        const finalRes = await fetch("/api/admin/products/save/finalize", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ save_session_id: sessionId }),
        });

        const result = await finalRes.json().catch(() => null);
        if (!finalRes.ok || !result?.success) {
          const errorMsg = result?.error || `HTTP ${finalRes.status}: Finalize failed`;
          if (result?.code === "PRODUCT_NOT_PUBLISHABLE" && productData?.publishOverride !== true) {
            offerPublishOverride(result, productData);
            throw Object.assign(new Error(errorMsg), { reported: true });
          }
          throw new Error(errorMsg);
        }

        toast.success(t("admin.saved") || "تم الحفظ بنجاح", { id: "save-product" });
        reportMediaWarnings(result?.mediaWarnings);
        notifyCatalogChanged(result?.catalogVersion);

        // Update local state
        setProducts((prev: any[]) => {
          const idx = prev.findIndex((p: any) => String(p.id) === String(productData.id));
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], ...productData };
            return next;
          }
          return [productData, ...prev];
        });

        setEditingProduct(null);
        return;
      }

      toast.loading("جاري الحفظ...", { id: "save-product" });
      const res = await fetch("/api/admin/products", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: payloadString,
      });

      const result = await res.json().catch(() => null);

      if (!res.ok || !result?.success) {
        const errorMsg =
          result?.error || `HTTP ${res.status}: Failed to save product - ${JSON.stringify(result)}`;
        console.error(`[SaveProductError] code=${result?.code} ref=${result?.ref}`, result);

        /*
          A refused duplicate names the product already holding the identity, so
          say which one and offer to open it. The server only reports a product
          that is still in the catalogue — a row left behind by an old deletion
          is released rather than reported — but if the id is one this list does
          not have, say that plainly instead of pointing at nothing.
        */
        if (result?.code === "PRODUCT_ALREADY_EXISTS") {
          const existing = products.find(
            (p: any) => String(p.id) === String(result?.existingProductId || ""),
          );
          if (existing) {
            toast.error(`منتج بنفس الاسم موجود بالفعل: ${existing.title}`, {
              id: "save-product",
              duration: 10000,
              action: {
                label: "فتح المنتج الموجود",
                onClick: () => {
                  setIsAdding(false);
                  void openProductForEdit(existing);
                },
              },
            });
          } else {
            toast.error(
              "تم رفض الحفظ بسبب تعارض اسم لم يعد له منتج في القائمة. أعد المحاولة — سيُحرَّر السجل القديم تلقائياً.",
              { id: "save-product", duration: 10000 },
            );
          }
        } else {
          toast.error(errorMsg, { id: "save-product", duration: 8000 });
        }
        // Already reported above; the outer catch must not toast it twice.
        throw Object.assign(new Error(errorMsg), { reported: true });
      }

      const savedProduct = result.product || productData;
      notifyCatalogChanged(result?.catalogVersion);

      // Update local state with the exact server-returned product without duplication
      setProducts((prev: any[]) => {
        const index = prev.findIndex((p: any) => String(p.id) === String(savedProduct.id));
        if (index >= 0) {
          const next = [...prev];
          next[index] = savedProduct;
          return next;
        } else {
          return [savedProduct, ...prev];
        }
      });

      toast.success("تم حفظ المنتج بنجاح", { id: "save-product" });
      setEditingProduct(null);
      setIsAdding(false);
    } catch (err: any) {
      console.error("[handleSave:error]", err);
      toast.dismiss("save-product");
      if (!err?.reported) toast.error(err?.message || t("admin.saveFailed"));
      throw err;
    }
  };

  if (isAdding || editingProduct) {
    return (
      <AdminProductEditor
        product={isAdding ? null : editingProduct}
        categories={categories}
        hardwareProducts={hardwareProducts}
        initialCategoryId={initialCategoryId}
        onSave={handleSave}
        onCancel={() => {
          setIsAdding(false);
          setEditingProduct(null);
        }}
      />
    );
  }

  return (
    <div className="animate-in fade-in duration-300">
      <div className="flex justify-between items-center mb-6">
        <div className="flex flex-col">
          <h1 className="text-[22px] font-bold text-[var(--admin-ink)]">
            {initialCategoryId
              ? categories.find((c: any) => c.id === initialCategoryId)?.title ||
                t("admin.products")
              : t("admin.products")}
          </h1>
          <span className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            {tableState.view === "loading"
              ? "جاري مزامنة المنتجات مع قاعدة البيانات D1..."
              : tableState.view === "error"
                ? /*
                    A failed read knows nothing about how many products exist.
                    "عرض 0 من أصل 0" beside an error reads as "the store is
                    empty", which is a claim about the catalogue that the
                    failure gives no grounds for.
                  */
                  "تعذّر قراءة عدد المنتجات — لم تكتمل القراءة من D1"
                : `عرض ${sortedProducts.length} من أصل ${d1ProductCount ?? products.length} منتج مسجل في D1`}
            {/* A refresh runs *over* the rows — the table is never blanked. */}
            {tableState.isRefreshing ? (
              <RefreshCw className="w-3 h-3 animate-spin text-primary" aria-label="جاري التحديث" />
            ) : null}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Nintendo Switch Games only — every other section keeps its own flow. */}
          {isGamesSection && (
            <>
              <button
                onClick={() => setShowMediaRepair(true)}
                className="rounded-full border border-border px-3.5 py-2 text-sm font-bold text-foreground flex items-center gap-2 transition-colors hover:bg-muted"
                title="فحص وتحميل صور الألعاب الخارجية إلى التخزين السحابي الدائم"
              >
                <ImageIcon className="w-4 h-4 text-primary" />
                فحص وإصلاح الصور
              </button>
              <button
                onClick={() => setShowZipImport(true)}
                className="rounded-full border border-border px-4 py-2 text-sm font-bold text-foreground flex items-center gap-2 transition-colors hover:bg-muted"
              >
                <FileArchive className="w-4 h-4" />
                استيراد مجموعة ألعاب
              </button>
            </>
          )}
          <button
            onClick={() => setIsAdding(true)}
            className="bg-[var(--admin-ink)] text-white px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 hover:bg-black transition-colors border-2 border-transparent focus:border-white focus:ring-2 focus:ring-[var(--admin-ink)]"
          >
            <Plus className="w-4 h-4" />
            {t("admin.addProduct")}
          </button>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
        <div className="p-3 border-b border-border flex flex-wrap justify-between items-center gap-2 bg-card">
          <div className="relative w-full max-w-sm">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder={t("admin.searchProducts")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-card border border-border rounded-md py-1.5 pr-9 pl-3 text-[14px] focus:outline-none focus:border-black transition-colors"
            />
          </div>
          <button
            onClick={() => setOnlyUnpriced((v) => !v)}
            className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-[12px] font-bold transition-colors ${onlyUnpriced ? "border-[var(--brand-red-dark)] bg-[var(--bad-bg)] text-[var(--brand-red-dark)]" : "border-border text-muted-foreground hover:border-black"}`}
          >
            {t("admin.unpriced")} ({unpricedCount})
          </button>
          <button
            onClick={() => setOnlyMissingPerformance((value) => !value)}
            className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-[12px] font-bold transition-colors ${onlyMissingPerformance ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-border text-muted-foreground hover:border-black"}`}
          >
            Missing Performance Data ({missingPerformanceCount})
          </button>
          <button
            onClick={() => setOnlyHidden((value) => !value)}
            className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-[12px] font-bold transition-colors ${onlyHidden ? "border-slate-500 bg-slate-500/10 text-slate-700 dark:text-slate-300" : "border-border text-muted-foreground hover:border-black"}`}
          >
            المخفية ({hiddenCount})
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted text-foreground font-semibold border-b border-border">
              <tr>
                <th className="px-4 py-3">
                  <SortHeader
                    label={t("admin.products")}
                    field="name"
                    sort={sort}
                    onSort={applySort}
                  />
                </th>
                <th className="px-4 py-3">
                  <SortHeader
                    label={t("admin.price")}
                    field="price"
                    sort={sort}
                    onSort={applySort}
                  />
                </th>
                <th className="px-4 py-3">{t("admin.categories")}</th>
                <th className="px-4 py-3">{t("admin.stock")}</th>
                <th className="px-4 py-3">المبيعات</th>
                <th className="px-4 py-3">
                  <SortHeader label="آخر تعديل" field="updated" sort={sort} onSort={applySort} />
                </th>
                <th className="px-4 py-3">{t("common.status")}</th>
                <th className="px-4 py-3">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-[14px]">
              {tableState.view === "loading" && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <RefreshCw className="w-6 h-6 animate-spin text-primary" />
                      <p className="text-sm font-medium text-foreground">
                        جاري تحميل قائمة المنتجات من قاعدة البيانات D1...
                      </p>
                      <p className="text-xs text-muted-foreground">
                        يتم التحقق من المصدر الفعلي لقاعدة البيانات
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {tableState.view === "error" && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center">
                    <div className="max-w-md mx-auto rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
                      <p className="text-sm font-bold text-destructive mb-1">
                        فشل تحميل قائمة المنتجات من قاعدة البيانات
                      </p>
                      <p className="text-xs text-muted-foreground mb-3">
                        {loadErrorDetail ||
                          loadError ||
                          "تعذر الاتصال بقاعدة البيانات D1 أو استرجاع سجلات المنتجات."}
                      </p>
                      {onRetry && (
                        <button
                          onClick={onRetry}
                          disabled={isReloading}
                          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${isReloading ? "animate-spin" : ""}`}
                          />
                          إعادة المحاولة الآن
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}

              {tableState.view === "empty" && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Package className="w-8 h-8 text-muted-foreground/50" />
                      <p className="text-sm font-medium text-foreground">
                        لا توجد منتجات مضافة حتى الآن في قاعدة البيانات D1
                      </p>
                      <button
                        onClick={() => setIsAdding(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--admin-ink)] text-white text-xs font-bold hover:bg-black transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        إضافة أول منتج
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {products.length > 0 && sortedProducts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <p className="text-sm font-medium text-foreground">
                        لا توجد منتجات تطابق الفلاتر المحددة
                      </p>
                      <p className="text-xs text-muted-foreground">
                        إجمالي المنتجات المتاحة في قاعدة البيانات: {products.length} منتج
                      </p>
                      <button
                        onClick={resetAllFilters}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted/60 text-xs font-bold hover:bg-muted text-foreground transition-colors"
                      >
                        إلغاء تفعيل الفلاتر
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {sortedProducts.map((p: any) => {
                const safeTitle =
                  typeof p.title === "string"
                    ? p.title
                    : typeof p.titleEn === "string"
                      ? p.titleEn
                      : String(p.id || "");
                const catId =
                  typeof p.category === "string"
                    ? p.category
                    : typeof p.categoryId === "string"
                      ? p.categoryId
                      : p.category?.id || "";
                const catTitle =
                  categories.find((c: any) => String(c.id) === String(catId))?.title ||
                  t("category.uncategorized");
                const safeStock = p.isInfiniteStock
                  ? t("admin.infiniteStock")
                  : String(p.stock ?? "0");
                const safeSales = String(p.sales ?? "0");
                const safeStatus = String(p.status ?? "نشط");
                const editedAt = lastModifiedAt(p);
                const lastEdited =
                  editedAt === null ? null : new Date(editedAt).toISOString().slice(0, 10);
                return (
                  <tr
                    key={String(p.id || Math.random())}
                    className="hover:bg-muted transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--admin-ink)]">
                      {safeTitle}
                      {!isProductPriced(p) && (
                        <span className="ms-2 inline-block rounded-md bg-[var(--bad-bg)] px-2 py-0.5 text-[11px] font-bold text-[var(--brand-red-dark)]">
                          مخفي — بحاجة سعر/تكلفة
                        </span>
                      )}
                      {showsPerformanceWarning(p) && (
                        <span className="ms-2 inline-block rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                          Performance review required
                        </span>
                      )}
                      {isProductHidden(p) && (
                        <span className="ms-2 inline-block rounded-md bg-slate-500/10 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:text-slate-300">
                          مخفي
                        </span>
                      )}
                      {p.isDuplicate && (
                        <span className="ms-2 inline-block rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                          مكرر
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground" dir="ltr">
                      {(Number(p.price) || 0).toLocaleString()} د.ع
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{catTitle}</td>
                    <td className="px-4 py-3 text-foreground" dir="ltr">
                      {safeStock}
                    </td>
                    <td className="px-4 py-3 text-foreground">{safeSales}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap" dir="ltr">
                      {/* A sortable column an admin cannot read is half a feature. */}
                      {lastEdited ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[12px] font-medium ${safeStatus === "نشط" ? "bg-[var(--ok-bg)] text-[var(--ok-ink)]" : "bg-[var(--bad-bg)] text-[var(--brand-red-dark)]"}`}
                      >
                        {safeStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => void openProductForEdit(p)}
                          disabled={isOpeningEditor !== null}
                          aria-busy={isOpeningEditor === String(p.id)}
                          title={
                            isOpeningEditor === String(p.id)
                              ? "جاري تحميل المنتج الكامل..."
                              : t("admin.editProduct" as any) || "تعديل"
                          }
                          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                        >
                          <Edit
                            className={`w-4 h-4 ${isOpeningEditor === String(p.id) ? "animate-pulse" : ""}`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => setProductToDelete(p)}
                          className="text-muted-foreground hover:text-[var(--brand-red-dark)] transition-colors p-1 rounded hover:bg-destructive/10"
                          title={t("admin.deleteProduct" as any) || "حذف"}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/*
          The catalogue is paginated server-side, so a page that does not say so
          would simply hide every product past the fiftieth. Rendered only when
          there is more than one page — a pager over a single page is noise.
        */}
        {pageInfo && (pageInfo.hasMore || pageInfo.page > 1) ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-[13px]">
            <span className="text-muted-foreground">
              صفحة <b dir="ltr">{pageInfo.page}</b> — عرض{" "}
              <b dir="ltr">
                {(pageInfo.page - 1) * pageInfo.limit + 1}–
                {(pageInfo.page - 1) * pageInfo.limit + products.length}
              </b>{" "}
              من <b dir="ltr">{d1ProductCount ?? products.length}</b>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pageInfo.page <= 1 || isRefreshing}
                onClick={() =>
                  onQuery?.({
                    page: pageInfo.page - 1,
                    sort,
                    search: searchTerm,
                    hidden: onlyHidden,
                    unpriced: onlyUnpriced,
                    performance: onlyMissingPerformance,
                    ...(initialCategoryId ? { category: initialCategoryId } : {}),
                  })
                }
                className="rounded-lg border border-border px-3 py-1.5 font-bold transition-colors hover:bg-muted disabled:opacity-40"
              >
                السابق
              </button>
              <button
                type="button"
                disabled={!pageInfo.hasMore || isRefreshing}
                onClick={() =>
                  onQuery?.({
                    page: pageInfo.page + 1,
                    sort,
                    search: searchTerm,
                    hidden: onlyHidden,
                    unpriced: onlyUnpriced,
                    performance: onlyMissingPerformance,
                    ...(initialCategoryId ? { category: initialCategoryId } : {}),
                  })
                }
                className="rounded-lg border border-border px-3 py-1.5 font-bold transition-colors hover:bg-muted disabled:opacity-40"
              >
                التالي
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {productToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            className="bg-card border border-border rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150"
            dir="rtl"
          >
            <div className="flex items-center gap-3 text-destructive">
              <div className="p-2.5 rounded-full bg-destructive/10">
                <Trash2 className="w-6 h-6 text-destructive" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">تأكيد حذف المنتج</h3>
                <p className="text-xs text-muted-foreground">
                  لا يمكن التراجع عن هذه العملية بعد التأكيد
                </p>
              </div>
            </div>

            <div className="bg-muted/40 p-3 rounded-lg border border-border/60 text-sm">
              <p className="font-semibold text-foreground">
                {productToDelete.title || productToDelete.titleEn || productToDelete.id}
              </p>
              {productToDelete.id && (
                <p className="text-xs text-muted-foreground mt-0.5" dir="ltr">
                  ID: {productToDelete.id}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setProductToDelete(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted text-foreground transition-colors disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => handleDelete(productToDelete.id)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>جاري الحذف...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>تأكيد الحذف</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showZipImport && (
        <AdminZipImportModal
          categoryId={initialCategoryId || "cat_nintendo"}
          onClose={() => setShowZipImport(false)}
          onProductSaved={(saved: any) =>
            setProducts((prev: any[]) => {
              const index = prev.findIndex((p: any) => String(p.id) === String(saved.id));
              if (index < 0) return [saved, ...prev];
              const next = [...prev];
              next[index] = saved;
              return next;
            })
          }
        />
      )}

      <AdminMediaRepairModal
        isOpen={showMediaRepair}
        onClose={() => setShowMediaRepair(false)}
        onRefreshProducts={onRetry}
      />
    </div>
  );
}

function OrdersView({ orders, setOrders }: { orders: any[]; setOrders: any }) {
  const [filterStatus, setFilterStatus] = useState<string>("الكل");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<any | null>(null);

  const [newOrder, setNewOrder] = useState({
    customer: "",
    total: "",
    status: "بانتظار الدفع",
  });

  const filteredOrders = orders.filter((o: any) => {
    const matchesStatus = filterStatus === "الكل" || o.status === filterStatus;
    const matchesSearch =
      o.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.id.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const handleUpdateStatus = (orderId: string, newStatus: string) => {
    setOrders(orders.map((o: any) => (o.id === orderId ? { ...o, status: newStatus } : o)));
  };

  const handleCreateOrder = () => {
    if (!newOrder.customer.trim() || !newOrder.total.trim()) return;
    const orderObj = {
      id: `#ORD-${Math.floor(1000 + Math.random() * 9000)}`,
      customer: newOrder.customer.trim(),
      date: new Date().toISOString().split("T")[0],
      total: parseFloat(newOrder.total).toLocaleString("en-US", { minimumFractionDigits: 2 }),
      status: newOrder.status,
    };
    setOrders([orderObj, ...orders]);
    setNewOrder({ customer: "", total: "", status: "بانتظار الدفع" });
    setShowAddModal(false);
  };

  const statusColors: Record<string, string> = {
    مكتمل: "bg-emerald-100 text-emerald-800 border-emerald-200",
    "قيد الشحن": "bg-blue-100 text-blue-800 border-blue-200",
    "بانتظار الدفع": "bg-amber-100 text-amber-800 border-amber-200",
    ملغى: "bg-red-100 text-red-800 border-red-200",
  };

  return (
    <div className="animate-in fade-in duration-300 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--admin-ink)]">الطلبات والمبيعات</h1>
          <p className="text-xs text-muted-foreground mt-1">
            إدارة وتتبع الطلبات المباشرة وتحديث حالات الشحن والدفع
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-[var(--admin-ink)] hover:bg-black text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          إضافة طلب يدوي
        </button>
      </div>

      {/* Filter Tabs & Search */}
      <div className="bg-card border border-border rounded-lg p-4 mb-6 shadow-sm flex flex-col sm:flex-row justify-between gap-4">
        <div className="flex flex-wrap gap-1 bg-muted p-1 rounded-lg">
          {["الكل", "بانتظار الدفع", "قيد الشحن", "مكتمل", "ملغى"].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${filterStatus === status ? "bg-card text-foreground shadow-sm font-bold" : "text-muted-foreground hover:text-foreground"}`}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="بحث برقم الطلب أو اسم العميل..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-card border border-border rounded-md py-1.5 pr-9 pl-3 text-xs focus:outline-none focus:border-black transition-colors"
          />
        </div>
      </div>

      {/* Orders Table */}
      <div className="border border-border rounded-lg bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted text-foreground font-semibold border-b border-border">
              <tr>
                <th className="px-4 py-3">رقم الطلب</th>
                <th className="px-4 py-3">العميل</th>
                <th className="px-4 py-3">التاريخ</th>
                <th className="px-4 py-3">الإجمالي</th>
                <th className="px-4 py-3">حالة الطلب</th>
                <th className="px-4 py-3">تحديث الحالة</th>
                <th className="px-4 py-3">التفاصيل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-[14px]">
              {filteredOrders.map((o: any) => (
                <tr key={o.id} className="hover:bg-muted transition-colors">
                  <td className="px-4 py-3 font-medium text-[var(--admin-ink)]" dir="ltr">
                    {o.id}
                  </td>
                  <td className="px-4 py-3 font-semibold text-[var(--admin-ink)]">{o.customer}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{o.date}</td>
                  <td className="px-4 py-3 font-bold text-foreground" dir="ltr">
                    د.ع {o.total}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-bold border ${statusColors[o.status] || "bg-muted text-foreground"}`}
                    >
                      {o.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={o.status}
                      onChange={(e) => handleUpdateStatus(o.id, e.target.value)}
                      className="text-xs bg-muted border border-border rounded-md px-2 py-1 focus:outline-none focus:border-black cursor-pointer"
                    >
                      <option value="بانتظار الدفع">بانتظار الدفع</option>
                      <option value="قيد الشحن">قيد الشحن</option>
                      <option value="مكتمل">مكتمل</option>
                      <option value="ملغى">ملغى</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedOrderDetails(o)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-semibold underline flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" /> عرض
                    </button>
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    لا توجد طلبات تطابق الفلتر المحدد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Order Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl max-w-md w-full p-6 shadow-xl animate-in zoom-in-95">
            <h2 className="text-lg font-bold mb-4">إضافة طلب يدوي جديد</h2>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  اسم العميل
                </label>
                <input
                  type="text"
                  placeholder="مثال: محمد علي"
                  value={newOrder.customer}
                  onChange={(e) => setNewOrder({ ...newOrder, customer: e.target.value })}
                  className="w-full border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:border-black"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  المبلغ الإجمالي (د.ع)
                </label>
                <input
                  type="number"
                  placeholder="مثال: 1500"
                  value={newOrder.total}
                  onChange={(e) => setNewOrder({ ...newOrder, total: e.target.value })}
                  className="w-full border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:border-black"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  حالة الطلب الأولية
                </label>
                <select
                  value={newOrder.status}
                  onChange={(e) => setNewOrder({ ...newOrder, status: e.target.value })}
                  className="w-full border border-border rounded-lg p-2.5 text-sm focus:outline-none focus:border-black bg-card"
                >
                  <option value="بانتظار الدفع">بانتظار الدفع</option>
                  <option value="قيد الشحن">قيد الشحن</option>
                  <option value="مكتمل">مكتمل</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                إلغاء
              </button>
              <button
                onClick={handleCreateOrder}
                className="px-5 py-2 bg-black text-white rounded-lg text-sm font-bold"
              >
                حفظ الطلب
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order Details Modal */}
      {selectedOrderDetails && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl max-w-md w-full p-6 shadow-xl animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-4 border-b pb-3">
              <h2 className="text-lg font-bold">تفاصيل الطلب {selectedOrderDetails.id}</h2>
              <button
                onClick={() => setSelectedOrderDetails(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-sm mb-6">
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-muted-foreground">اسم العميل:</span>
                <span className="font-bold text-foreground">{selectedOrderDetails.customer}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-muted-foreground">تاريخ الطلب:</span>
                <span className="font-medium text-foreground">{selectedOrderDetails.date}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border">
                <span className="text-muted-foreground">المبلغ الإجمالي:</span>
                <span className="font-bold text-foreground" dir="ltr">
                  د.ع {selectedOrderDetails.total}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">الحالة الحالية:</span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${statusColors[selectedOrderDetails.status]}`}
                >
                  {selectedOrderDetails.status}
                </span>
              </div>
            </div>
            <button
              onClick={() => setSelectedOrderDetails(null)}
              className="w-full py-2 bg-muted hover:bg-muted text-foreground rounded-lg text-sm font-bold"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MessagesView() {
  return <AdminInboxView />;
}

function StatsView({
  orders = [],
  products = [],
  categories = [],
  visits = 0,
  views = 0,
  changeTab,
}: {
  orders?: any[];
  products?: any[];
  categories?: any[];
  visits?: number;
  views?: number;
  changeTab?: (t: string) => void;
}) {
  const [statsPeriod, setStatsPeriod] = useState<"day" | "week" | "month" | "year">("month");
  const [exportNotice, setExportNotice] = useState(false);

  const totalSales = orders.reduce((sum, o) => {
    const numeric = parseFloat(String(o.total || "0").replace(/[^0-9.]/g, "")) || 0;
    return sum + numeric;
  }, 0);

  const totalOrdersCount = orders.length;
  const avgOrderValue = totalOrdersCount > 0 ? Math.round(totalSales / totalOrdersCount) : 0;
  const conversionRate = visits > 0 ? ((totalOrdersCount / visits) * 100).toFixed(1) : "0.0";

  // Chart data for monthly breakdown from actual orders
  const monthLabels = [
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ];
  const currentMonthIdx = new Date().getMonth();

  const monthlySalesMap: Record<number, number> = {};
  orders.forEach((o) => {
    if (o.date) {
      const d = new Date(o.date);
      if (!isNaN(d.getTime())) {
        const m = d.getMonth();
        const val = parseFloat(String(o.total || "0").replace(/[^0-9.]/g, "")) || 0;
        monthlySalesMap[m] = (monthlySalesMap[m] || 0) + val;
      }
    }
  });

  const chartData = monthLabels.slice(0, currentMonthIdx + 1).map((label, idx) => ({
    label,
    sales: monthlySalesMap[idx] || 0,
  }));

  const maxSales = Math.max(...chartData.map((d) => d.sales), 1);

  const topProducts = products.length > 0 ? products.slice(0, 5) : [];

  const categoryColors = [
    "bg-black",
    "bg-amber-500",
    "bg-emerald-500",
    "bg-blue-500",
    "bg-purple-500",
    "bg-red-500",
  ];
  const categoryBreakdown =
    categories.length > 0
      ? categories.map((cat, idx) => {
          const catProducts = products.filter(
            (p) =>
              (p.category || p.categoryId) === cat.id || (p.category || p.categoryId) === cat.title,
          );
          const percent =
            products.length > 0 ? Math.round((catProducts.length / products.length) * 100) : 0;
          return {
            title: cat.title,
            percent,
            color: categoryColors[idx % categoryColors.length],
          };
        })
      : [];

  return (
    <div className="animate-in fade-in duration-300 pb-16">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--admin-ink)]">
            لوحة الإحصائيات والتحليلات الحية
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            متابعة دقيقة وفعلية لمبيعات المتجر، أداء الأقسام، والمنتجات
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex bg-muted p-1 rounded-lg">
          {[
            { id: "day", label: "اليوم" },
            { id: "week", label: "الأسبوع" },
            { id: "month", label: "الشهر" },
            { id: "year", label: "السنة" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setStatsPeriod(item.id as any)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${statsPeriod === item.id ? "bg-card text-foreground shadow-sm font-bold" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-muted-foreground">إجمالي المبيعات</span>
            <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mb-1" dir="ltr">
            د.ع {totalSales.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground font-medium">
            مستند لإجمالي الطلبات الفعلية
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-muted-foreground">عدد الطلبات</span>
            <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
              <ShoppingCart className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mb-1">{totalOrdersCount} طلب</div>
          <div className="text-xs text-muted-foreground font-medium">
            الطلبات المسجلة في القاعدة
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-muted-foreground">متوسط قيمة الطلب</span>
            <div className="w-8 h-8 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center">
              <BarChart2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mb-1" dir="ltr">
            د.ع {avgOrderValue.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground font-medium">معدل شراء العميل لكل طلب</div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-muted-foreground">
              نسبة التحويل (Conversion)
            </span>
            <div className="w-8 h-8 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground mb-1">{conversionRate}%</div>
          <div className="text-xs text-muted-foreground font-medium">
            الطلبات بالنسبة للزيارات ({visits})
          </div>
        </div>
      </div>

      {/* Interactive Sales Chart */}
      <div className="bg-card border border-border rounded-xl p-6 mb-8 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-base font-bold text-foreground">مؤشر نمو المبيعات الشهري</h3>
            <p className="text-xs text-muted-foreground">مبيعات الطلبات لكل شهر</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-3 h-3 rounded-sm bg-black"></span> المبيعات (د.ع)
            </span>
          </div>
        </div>

        {/* Visual Bar Chart */}
        <div className="h-56 w-full flex items-end gap-3 sm:gap-6 pt-6 border-b border-border pb-2">
          {chartData.map((item, idx) => {
            const heightPercent =
              maxSales > 0 && item.sales > 0
                ? Math.max(15, Math.round((item.sales / maxSales) * 100))
                : 4;
            return (
              <div
                key={idx}
                className="flex-1 flex flex-col items-center gap-2 h-full justify-end group cursor-pointer"
              >
                <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black text-white text-[10px] py-1 px-2 rounded font-mono shadow-md whitespace-nowrap">
                  د.ع {item.sales.toLocaleString()}
                </div>
                <div
                  className={`w-full rounded-t-md transition-all duration-300 ${item.sales > 0 ? "bg-gradient-to-t from-gray-900 to-black group-hover:bg-amber-500" : "bg-muted"}`}
                  style={{ height: `${heightPercent}%` }}
                />
                <span className="text-xs font-medium text-muted-foreground mt-1">{item.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top Products & Category Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top Selling Products */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-foreground mb-4 flex items-center justify-between">
            <span>المنتجات المسجلة</span>
            {changeTab && (
              <button
                onClick={() => changeTab("listings")}
                className="text-xs text-blue-600 hover:underline"
              >
                جميع المنتجات
              </button>
            )}
          </h3>
          {topProducts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">
              لا توجد منتجات مضافة في المتجر حتى الآن.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {topProducts.map((p: any, idx: number) => (
                <div key={idx} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted font-bold text-xs flex items-center justify-center text-foreground">
                      #{idx + 1}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-foreground truncate max-w-[200px]">
                        {p.title}
                      </h4>
                      <span className="text-xs text-muted-foreground">
                        {p.category || p.categoryId || "عام"}
                      </span>
                    </div>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-bold text-foreground" dir="ltr">
                      {(Number(p.price) || 0).toLocaleString()} د.ع
                    </div>
                    <span className="text-xs font-semibold text-emerald-600">
                      المخزون: {p.isInfiniteStock ? "غير محدود" : p.stock}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Category Breakdown */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-foreground mb-4">توزيع المنتجات حسب الأقسام</h3>
          {categoryBreakdown.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">
              لم يقم الأدمن بإضافة أي أقسام بعد.
            </div>
          ) : (
            <div className="space-y-4">
              {categoryBreakdown.map((cat, idx) => (
                <div key={idx}>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-foreground">{cat.title}</span>
                    <span className="text-muted-foreground">{cat.percent}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${cat.color} rounded-full`}
                      style={{ width: `${cat.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-8 pt-4 border-t border-border flex justify-between items-center text-xs text-muted-foreground">
            <span>تاريخ تحديث التقرير: اليوم</span>
            <button
              onClick={() => setExportNotice(true)}
              className="text-foreground font-bold hover:underline flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" /> تصدير PDF/Excel
            </button>
          </div>
          {exportNotice && (
            <div className="mt-2 text-xs text-green-700 bg-green-50 border border-green-200 p-2 rounded flex justify-between items-center">
              <span>تم تصدير تقرير الإحصائيات بنجاح</span>
              <button
                onClick={() => setExportNotice(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsView() {
  const [aiKey, setAiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("https://gateway.lovable.ai/api/v1");
  const [storeName, setStoreName] = useState("Banana eShop");
  const [usdIqdRate, setUsdIqdRate] = useState<number>(1320);
  const [exchangeRatesApiKey, setExchangeRatesApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  React.useEffect(() => {
    fetch("/api/data")
      .then((res) => res.json())
      .then((data) => {
        if (data.settings?.ai_key) {
          setAiKey(data.settings.ai_key);
        }
        if (data.settings?.ai_base_url) {
          setAiBaseUrl(data.settings.ai_base_url);
        }
        if (data.settings?.storeName) {
          setStoreName(data.settings.storeName);
        }
        if (data.settings?.usd_iqd_rate) {
          setUsdIqdRate(Number(data.settings.usd_iqd_rate) || 1320);
        }
        if (data.settings?.exchange_rates_api_key) {
          setExchangeRatesApiKey(data.settings.exchange_rates_api_key);
        }
      })
      .catch(console.error);
  }, []);

  const [saveError, setSaveError] = useState("");

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: safeStringify({
          settings: {
            ai_key: aiKey,
            ai_base_url: aiBaseUrl,
            storeName,
            usd_iqd_rate: Number(usdIqdRate) || 1320,
            exchange_rates_api_key: exchangeRatesApiKey,
          },
        }),
      });
      if (res.ok) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
      } else {
        setSaveError("حدث خطأ أثناء حفظ الإعدادات");
      }
    } catch (e) {
      console.error(e);
      setSaveError("حدث خطأ أثناء حفظ الإعدادات");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full animate-in fade-in duration-300" dir="rtl">
      <h1 className="text-[22px] font-bold text-[var(--admin-ink)] mb-6">
        الإعدادات العامة وإعدادات العملة
      </h1>

      <div className="bg-card border border-border rounded-xl p-6 shadow-sm mb-6 space-y-6">
        {/* Currency & Exchange Rate Section */}
        <div>
          <h2 className="text-base font-bold text-foreground mb-1 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            إعدادات العملة وسعر الصرف (الدينار العراقي IQD والدولار الأمريكي $)
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            العملة الأساسية لإدخال أسعار المنتجات في المتجر هي{" "}
            <span className="font-bold text-foreground">الدينار العراقي (IQD)</span>. يتم تحويل
            الدينار إلى الدولار الأمريكي وباقي العملات العالمية تلقائياً بدقة بناءً على سعر الصرف
            المحدد أدناه.
          </p>

          <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-4 space-y-3">
            <div>
              <label className="block text-xs font-bold text-emerald-950 mb-1">
                سعر صرف 1 دولار أمريكي ($1) بالدينار العراقي (IQD):
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="1"
                  min="1"
                  dir="ltr"
                  className="w-full bg-card border border-emerald-300 focus:border-emerald-600 rounded-lg px-3.5 py-2.5 text-base font-bold text-foreground outline-none transition-colors"
                  value={usdIqdRate}
                  onChange={(e) => setUsdIqdRate(parseFloat(e.target.value) || 0)}
                  placeholder="1320"
                />
                <span className="text-xs font-bold text-emerald-800 shrink-0 bg-emerald-100 px-3 py-2.5 rounded-lg border border-emerald-300">
                  د.ع / $1
                </span>
              </div>
            </div>

            <div className="text-xs text-emerald-900 bg-card/80 p-3 rounded-lg border border-emerald-100 space-y-1">
              <div className="flex justify-between items-center font-semibold">
                <span>معاينة التحويل الفوري:</span>
                <span className="font-bold font-mono text-foreground">
                  100$ = {(100 * (Number(usdIqdRate) || 1320)).toLocaleString()} د.ع
                </span>
              </div>
              <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                <span>منتج بسعر 25,000 د.ع:</span>
                <span className="font-mono text-foreground font-bold">
                  ${(25000 / (Number(usdIqdRate) || 1320)).toFixed(2)} USD
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-emerald-200/60">
              <label className="block text-xs font-bold text-emerald-950 mb-1">
                مفتاح Exchange Rates API (اختياري - لتحديث أسعار الصرف العالمية للعملات الأخرى):
              </label>
              <input
                type="password"
                dir="ltr"
                className="w-full bg-card border border-emerald-300 focus:border-emerald-600 rounded-lg px-3 py-2 text-xs font-mono text-foreground outline-none transition-colors"
                value={exchangeRatesApiKey}
                onChange={(e) => setExchangeRatesApiKey(e.target.value)}
                placeholder="أدخل مفتاح EXCHANGE_RATES_API_KEY (مثال: e.g. exchangerate-api.com)"
              />
              <p className="text-[11px] text-emerald-800/80 mt-1">
                في حال عدم إدخال مفتاح، يعتمد النظام تلقائياً على الخدمة المجانية المباشرة
                (open.er-api.com) لتوفير أسعار الصرف العالمية المحدثة.
              </p>
            </div>
          </div>
        </div>

        <hr className="border-border" />

        <div>
          <h2 className="text-base font-bold text-foreground mb-1 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            إعدادات الذكاء الاصطناعي (AI Gateway)
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            يتم استخدام مفتاح{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-amber-700 font-mono">ai_key</code>{" "}
            والرابط المباشر لاستخراج بيانات المنتجات تلقائياً وتفعيل خدمات مستشار المتجر.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                رابط الخدمة الأساسي (Base URL):
              </label>
              <input
                type="text"
                dir="ltr"
                placeholder="https://gateway.lovable.ai/api/v1"
                className="w-full border border-border focus:border-black rounded-lg px-3.5 py-2.5 text-sm outline-none font-mono transition-colors"
                value={aiBaseUrl}
                onChange={(e) => setAiBaseUrl(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                مفتاح API الخاص بك (API Key / ai_key):
              </label>
              <input
                type="password"
                dir="ltr"
                placeholder="أدخل مفتاح ai_key هنا..."
                className="w-full border border-border focus:border-black rounded-lg px-3.5 py-2.5 text-sm outline-none font-mono transition-colors"
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
              />
            </div>
          </div>
        </div>

        <hr className="border-border" />

        <div>
          <label className="block text-xs font-semibold text-foreground mb-1">اسم المتجر:</label>
          <input
            type="text"
            className="w-full border border-border focus:border-black rounded-lg px-3.5 py-2.5 text-sm outline-none transition-colors"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-black text-white hover:bg-foreground font-bold text-sm px-5 py-2.5 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> جاري الحفظ...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" /> حفظ الإعدادات
              </>
            )}
          </button>
          {savedSuccess && (
            <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
              <CheckCircle className="w-4 h-4" /> تم الحفظ بنجاح!
            </span>
          )}
          {saveError && (
            <span className="text-xs text-red-600 font-semibold flex items-center gap-1">
              {saveError}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function BannersView({
  banners,
  setBanners,
  products,
}: {
  banners: any[];
  setBanners: any;
  products: any[];
}) {
  const [newBanner, setNewBanner] = useState<BannerDraft>({
    imageUrl: "",
    targetUrl: "",
    startDate: "",
    endDate: "",
    posX: 0,
    posY: 0,
    scale: 1,
    bgColor: "transparent",
  });
  const [showDropdown, setShowDropdown] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null);
  const [previewDevice, setPreviewDevice] = useState<"mobile" | "tablet" | "desktop">("desktop");
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const options = [
    { label: "الصفحة الرئيسية", value: "/" },
    { label: "صفحة المتجر", value: "/shop" },
    ...products.map((p) => ({ label: p.title, value: `/product/${p.id}` })),
  ];

  const filteredOptions = options.filter(
    (opt) =>
      opt.label.toLowerCase().includes(newBanner.targetUrl.toLowerCase()) ||
      opt.value.toLowerCase().includes(newBanner.targetUrl.toLowerCase()),
  );

  const extractColor = (url: string) => {
    try {
      if (!url) return;
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.src = url;
      img.onload = () => {
        try {
          if (img.width <= 0 || img.height <= 0) return;
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, 1, 1).data;
            const color = `rgba(${data[0] ?? 0}, ${data[1] ?? 0}, ${data[2] ?? 0}, ${(data[3] ?? 255) / 255})`;
            setNewBanner((prev: BannerDraft) => ({ ...prev, bgColor: color }));
          }
        } catch (e) {
          console.warn("Canvas extract color warning:", e);
        }
      };
      img.onerror = (e) => console.warn("Image load warning:", e);
    } catch (e) {
      console.warn("extractColor exception:", e);
    }
  };

  const startPan = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizing(true);
    const startX = e.clientX;
    const startY = e.clientY;

    const startPosX = newBanner.posX ?? 0;
    const startPosY = newBanner.posY ?? 0;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      setNewBanner((prev: BannerDraft) => ({
        ...prev,
        posX: startPosX + deltaX,
        posY: startPosY + deltaY,
      }));
    };

    const onPointerUp = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      setIsResizing(false);
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  };

  const handleZoom = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomFactor = -e.deltaY * 0.002;
    setNewBanner((prev: BannerDraft) => ({
      ...prev,
      scale: Math.max(0.5, Math.min(3, (prev.scale ?? 1) + zoomFactor)),
    }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const result = reader.result as string;
        try {
          const res = await adminApi.upload(result, "banners");
          if (res?.url) {
            setNewBanner({ ...newBanner, imageUrl: res.url });
            extractColor(res.url); // Use remote URL or local base64 to extract color? extractColor works on URL
          } else {
            toast.error("فشل رفع الصورة: لم يتم إرجاع رابط.");
          }
        } catch (err: any) {
          console.error("Banner upload error:", err);
          toast.error("فشل رفع البانر: " + (err.message || "خطأ غير معروف"));
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAdd = () => {
    if (newBanner.imageUrl) {
      const finalWidth = newBanner.width || "100%";
      const finalHeight = newBanner.height || "200px";

      if (editingBannerId) {
        setBanners(
          banners.map((b) =>
            b.id === editingBannerId ? { ...newBanner, id: editingBannerId } : b,
          ),
        );
        setEditingBannerId(null);
      } else {
        setBanners([{ ...newBanner, id: Date.now().toString() }, ...banners]);
      }
      setNewBanner({
        imageUrl: "",
        targetUrl: "",
        startDate: "",
        endDate: "",
        posX: 0,
        posY: 0,
        scale: 1,
        bgColor: "transparent",
      });
    }
  };

  const handleEdit = (banner: any) => {
    setNewBanner(banner);
    setEditingBannerId(banner.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditingBannerId(null);
    setNewBanner({
      imageUrl: "",
      targetUrl: "",
      startDate: "",
      endDate: "",
      posX: 0,
      posY: 0,
      scale: 1,
      bgColor: "transparent",
    });
  };

  const moveBanner = (index: number, direction: "up" | "down") => {
    const newBanners = [...banners];
    if (direction === "up" && index > 0) {
      [newBanners[index - 1], newBanners[index]] = [newBanners[index], newBanners[index - 1]];
      setBanners(newBanners);
    } else if (direction === "down" && index < banners.length - 1) {
      [newBanners[index + 1], newBanners[index]] = [newBanners[index], newBanners[index + 1]];
      setBanners(newBanners);
    }
  };

  return (
    <div className="animate-in fade-in duration-300 pb-10">
      <h1 className="text-[22px] font-bold text-[var(--admin-ink)] mb-6">البنرات الإعلانية</h1>
      <div className="bg-card border border-border rounded-lg p-6 mb-8 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-[16px] font-bold">
            {editingBannerId ? "تعديل البنر" : "إضافة بنر جديد"}
          </h2>
          {editingBannerId && (
            <button
              onClick={cancelEdit}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              إلغاء التعديل
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[13px] text-muted-foreground mb-1">
              صورة البنر (Image/GIF)
            </label>
            <div className="flex items-center gap-2 w-full border border-border focus-within:border-black rounded-lg px-3 py-2 text-sm bg-card overflow-hidden">
              <Upload className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                type="file"
                accept="image/*"
                className="w-full outline-none text-[13px] file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-muted file:text-foreground hover:file:bg-muted"
                onChange={handleFileChange}
              />
            </div>
          </div>
          <div className="relative" ref={dropdownRef}>
            <label className="block text-[13px] text-muted-foreground mb-1">
              رابط التوجيه (اختياري)
            </label>
            <input
              type="text"
              className="w-full border border-border focus:border-black rounded-lg px-3 py-2 text-sm outline-none"
              value={newBanner.targetUrl}
              onChange={(e) => setNewBanner({ ...newBanner, targetUrl: e.target.value })}
              onFocus={() => setShowDropdown(true)}
              placeholder="رابط مباشر أو ابحث عن صفحة..."
              dir="ltr"
            />
            {showDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((opt, i) => (
                    <div
                      key={i}
                      className="px-3 py-2 text-sm hover:bg-muted cursor-pointer flex justify-between"
                      onClick={() => {
                        setNewBanner({ ...newBanner, targetUrl: opt.value });
                        setShowDropdown(false);
                      }}
                    >
                      <span>{opt.label}</span>
                      <span className="text-muted-foreground text-xs" dir="ltr">
                        {opt.value}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-2 text-sm text-muted-foreground text-center">
                    لا توجد نتائج
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-[13px] text-muted-foreground mb-1">
              تاريخ البدء (اختياري)
            </label>
            <input
              type="datetime-local"
              className="w-full border border-border focus:border-black rounded-lg px-3 py-2 text-sm outline-none"
              value={newBanner.startDate}
              onChange={(e) => setNewBanner({ ...newBanner, startDate: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-[13px] text-muted-foreground mb-1">
              تاريخ الانتهاء (اختياري)
            </label>
            <input
              type="datetime-local"
              className="w-full border border-border focus:border-black rounded-lg px-3 py-2 text-sm outline-none"
              value={newBanner.endDate}
              onChange={(e) => setNewBanner({ ...newBanner, endDate: e.target.value })}
            />
          </div>
        </div>

        {newBanner.imageUrl && (
          <div className="mb-4">
            <label className="block text-[13px] text-muted-foreground mb-2 flex justify-between items-center">
              <span>معاينة البنر (اسحب الصورة لضبط مكانها داخل الإطار)</span>
              <div className="flex items-center gap-2">
                <div className="flex bg-muted p-1 rounded-md">
                  <button
                    type="button"
                    onClick={() => setPreviewDevice("desktop")}
                    className={`px-2 py-1 text-[11px] rounded ${previewDevice === "desktop" ? "bg-card shadow-sm font-bold" : "text-muted-foreground"}`}
                  >
                    سطح المكتب
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewDevice("tablet")}
                    className={`px-2 py-1 text-[11px] rounded ${previewDevice === "tablet" ? "bg-card shadow-sm font-bold" : "text-muted-foreground"}`}
                  >
                    جهاز لوحي
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewDevice("mobile")}
                    className={`px-2 py-1 text-[11px] rounded ${previewDevice === "mobile" ? "bg-card shadow-sm font-bold" : "text-muted-foreground"}`}
                  >
                    جوال
                  </button>
                </div>
                <span className="text-muted-foreground font-mono text-xs" dir="ltr">
                  X: {Math.round(newBanner.posX ?? 0)} | Y: {Math.round(newBanner.posY ?? 0)}
                </span>
              </div>
            </label>
            <div
              className="relative rounded-lg overflow-hidden flex flex-col items-center justify-center p-8 min-h-[300px]"
              dir="ltr"
            >
              {/* Pattern Background */}
              <div
                className="absolute inset-0 z-0 pointer-events-none opacity-50 bg-[#f8f9fa]"
                style={{
                  backgroundImage:
                    "linear-gradient(var(--line-3) 1px, transparent 1px), linear-gradient(90deg, var(--line-3) 1px, transparent 1px)",
                  backgroundSize: "20px 20px",
                }}
              />

              <div
                className={`relative shadow-lg w-full ${previewDevice === "mobile" ? "max-w-sm" : previewDevice === "tablet" ? "max-w-2xl" : "max-w-4xl"} aspect-[16/9] z-10 overflow-hidden touch-none ${isResizing ? "cursor-grabbing" : "cursor-grab"} border-2 ${isResizing ? "border-[var(--admin-ink)]" : "border-transparent hover:border-[var(--admin-ink)]/20"} rounded-lg group transition-all duration-200`}
                style={{ backgroundColor: newBanner.bgColor || "transparent" }}
                onPointerDown={startPan}
                onWheel={handleZoom}
                onDoubleClick={() =>
                  setNewBanner((prev: BannerDraft) => ({ ...prev, posX: 0, posY: 0, scale: 1 }))
                }
                title="اسحب الصورة لضبط مكانها أو استخدم عجلة الماوس للتكبير (انقر مرتين لإعادة الضبط)"
              >
                <img
                  src={newBanner.imageUrl}
                  alt="معاينة"
                  className={`w-full h-full object-contain pointer-events-none select-none transition-transform duration-200`}
                  style={{
                    transform: `translate(${newBanner.posX ?? 0}px, ${newBanner.posY ?? 0}px) scale(${newBanner.scale ?? 1})`,
                  }}
                />

                {/* Grid Overlay while dragging */}
                <div
                  className={`absolute inset-0 pointer-events-none transition-opacity duration-200 ${isResizing ? "opacity-100" : "opacity-0"}`}
                >
                  <div className="w-full h-full grid grid-cols-3 grid-rows-3 mix-blend-overlay border border-white/40">
                    <div className="border-b border-r border-white/40"></div>
                    <div className="border-b border-r border-white/40"></div>
                    <div className="border-b border-white/40"></div>
                    <div className="border-b border-r border-white/40"></div>
                    <div className="border-b border-r border-white/40"></div>
                    <div className="border-b border-white/40"></div>
                    <div className="border-r border-white/40"></div>
                    <div className="border-r border-white/40"></div>
                    <div className=""></div>
                  </div>
                </div>

                {/* Overlay position */}
                <div
                  className={`absolute inset-0 bg-black/5 transition-opacity flex items-center justify-center pointer-events-none z-10 ${isResizing ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                >
                  <span className="text-white font-mono text-xs font-medium bg-black/70 px-3 py-1.5 rounded-full shadow-sm backdrop-blur-md">
                    X: {Math.round(newBanner.posX ?? 0)} | Y: {Math.round(newBanner.posY ?? 0)} |
                    Zoom: {Math.round((newBanner.scale ?? 1) * 100)}%
                  </span>
                </div>
              </div>

              <div className="w-full max-w-sm mt-6 flex items-center gap-3 z-10 bg-card px-4 py-2 rounded-full shadow-sm border border-border">
                <span className="text-xs font-medium text-muted-foreground">تصغير</span>
                <input
                  type="range"
                  min="0.5"
                  max="3"
                  step="0.05"
                  value={newBanner.scale ?? 1}
                  onChange={(e) =>
                    setNewBanner({ ...newBanner, scale: parseFloat(e.target.value) })
                  }
                  className="flex-1 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-[var(--admin-ink)]"
                />
                <span className="text-xs font-medium text-muted-foreground">تكبير</span>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={handleAdd}
          className="bg-[var(--admin-ink)] text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-black transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> {editingBannerId ? "حفظ التعديلات" : "إضافة بنر"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {banners.map((b: any, index: number) => (
          <div
            key={b.id}
            className="border border-border rounded-lg overflow-hidden bg-card shadow-sm relative group flex flex-col"
          >
            <div className="relative overflow-hidden rounded-t-lg">
              {b.imageUrl ? (
                <div
                  className="w-full aspect-[21/9]"
                  style={{ backgroundColor: b.bgColor || "transparent" }}
                >
                  <img
                    src={b.imageUrl}
                    alt="Banner"
                    className="w-full h-full object-contain"
                    style={{
                      transform: `translate(${b.posX ?? 0}px, ${b.posY ?? 0}px) scale(${b.scale ?? 1})`,
                    }}
                  />
                </div>
              ) : (
                <div className="w-full aspect-[21/9] bg-muted flex items-center justify-center text-muted-foreground">
                  بدون صورة
                </div>
              )}
            </div>
            <div className="p-4 border-t border-border flex-1">
              <p className="text-[13px] text-muted-foreground mb-1 flex items-center gap-2">
                <Link className="w-3 h-3" /> {b.targetUrl || "بدون رابط"}
              </p>
              <div className="flex gap-4 text-[12px] text-muted-foreground mb-4">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> البدء:{" "}
                  {b.startDate ? new Date(b.startDate).toLocaleString("ar-EG") : "فوراً"}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> الانتهاء:{" "}
                  {b.endDate ? new Date(b.endDate).toLocaleString("ar-EG") : "مفتوح"}
                </span>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-border">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEdit(b)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                    title="تعديل"
                  >
                    <Edit className="w-3.5 h-3.5" /> تعديل
                  </button>
                  <button
                    onClick={() => setBanners(banners.filter((x: any) => x.id !== b.id))}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                    title="حذف"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> حذف
                  </button>
                </div>
                <div className="flex items-center gap-1 bg-muted rounded-md p-0.5 border border-border">
                  <button
                    onClick={() => moveBanner(index, "up")}
                    disabled={index === 0}
                    className={`p-1.5 rounded ${index === 0 ? "text-muted-foreground" : "text-muted-foreground hover:bg-card hover:shadow-sm"} transition-all`}
                    title="تحريك لأعلى"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => moveBanner(index, "down")}
                    disabled={index === banners.length - 1}
                    className={`p-1.5 rounded ${index === banners.length - 1 ? "text-muted-foreground" : "text-muted-foreground hover:bg-card hover:shadow-sm"} transition-all`}
                    title="تحريك لأسفل"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
        {banners.length === 0 && (
          <div className="col-span-full py-10 text-center text-muted-foreground text-sm bg-muted rounded-lg border border-border">
            لا توجد بنرات حالياً
          </div>
        )}
      </div>
    </div>
  );
}

function MusicView({ musicList, setMusicList }: { musicList: any[]; setMusicList: any }) {
  const [newMusic, setNewMusic] = useState({ title: "", fileUrl: "" });
  const [isUploading, setIsUploading] = useState(false);

  const handleAdd = () => {
    if (newMusic.title && newMusic.fileUrl) {
      setMusicList([{ ...newMusic, id: Date.now().toString(), active: true }, ...musicList]);
      setNewMusic({ title: "", fileUrl: "" });
    }
  };

  const handleImportDefaultRadio = () => {
    const defaults = getDefaultRadioTracks();
    setMusicList(defaults);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch("/api/admin/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataUrl,
          folder: "Audio/Music/",
          filename: file.name,
        }),
      });
      const data = await res.json();
      if (data.url) {
        setNewMusic({
          title: file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " "),
          fileUrl: data.url,
        });
      }
    } catch (err) {
      console.error("Failed to upload audio file:", err);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="animate-in fade-in duration-300 pb-10">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-[22px] font-bold text-[var(--admin-ink)]">موسيقى راديو بانانتو (R2)</h1>
        <button
          onClick={handleImportDefaultRadio}
          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-2 shadow-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" /> استيراد قائمة راديو بانانتو (49 مقطع من R2)
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 mb-8 shadow-sm">
        <h2 className="text-[16px] font-bold mb-4">إضافة مقطع صوتي (WebM / MP3)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[13px] text-muted-foreground mb-1">اسم المقطع</label>
            <input
              type="text"
              className="w-full border border-border focus:border-black rounded-lg px-3 py-2 text-sm outline-none"
              value={newMusic.title}
              onChange={(e) => setNewMusic({ ...newMusic, title: e.target.value })}
              placeholder="موسيقى هادئة..."
            />
          </div>
          <div>
            <label className="block text-[13px] text-muted-foreground mb-1">
              رابط الملف (assets.banan.to)
            </label>
            <input
              type="text"
              className="w-full border border-border focus:border-black rounded-lg px-3 py-2 text-sm outline-none"
              value={newMusic.fileUrl}
              onChange={(e) => setNewMusic({ ...newMusic, fileUrl: e.target.value })}
              placeholder="https://assets.banan.to/Audio/Music/..."
              dir="ltr"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleAdd}
            disabled={!newMusic.title || !newMusic.fileUrl}
            className="bg-[var(--admin-ink)] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-black transition-colors flex items-center gap-2"
          >
            <Upload className="w-4 h-4" /> إضافة مقطع
          </button>

          <label className="cursor-pointer bg-muted hover:bg-muted/80 text-foreground px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 border border-border">
            <FileUp className="w-4 h-4 text-purple-600" />
            {isUploading ? "جاري الرفع إلى R2..." : "رفع ملف صوتي إلى R2"}
            <input
              type="file"
              accept="audio/webm,audio/mpeg,audio/mp3,video/webm"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isUploading}
            />
          </label>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted text-foreground font-semibold border-b border-border">
              <tr>
                <th className="px-4 py-3">الاسم</th>
                <th className="px-4 py-3">الرابط</th>
                <th className="px-4 py-3">الحالة</th>
                <th className="px-4 py-3">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {musicList.map((m: any) => (
                <tr key={m.id} className="hover:bg-muted">
                  <td className="px-4 py-3 font-medium">{m.title}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs font-mono" dir="ltr">
                    {m.fileUrl}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        setMusicList(
                          musicList.map((x: any) =>
                            x.id === m.id ? { ...x, active: !x.active } : x,
                          ),
                        )
                      }
                      className={`px-3 py-1 rounded-full text-xs font-medium ${m.active ? "bg-[var(--ok-bg)] text-[var(--ok-ink)]" : "bg-muted text-muted-foreground"}`}
                    >
                      {m.active ? "مُفعّل" : "مُعطل"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setMusicList(musicList.filter((x: any) => x.id !== m.id))}
                      className="text-muted-foreground hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {musicList.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    لا توجد مقاطع مخصصة — يعمل راديو بانانتو الافتراضي (49 مقطع)
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function NotificationsView({
  notifications,
  setNotifications,
}: {
  notifications: any[];
  setNotifications: any;
}) {
  const [newNotif, setNewNotif] = useState({ title: "", message: "", scheduledDate: "" });

  const handleAdd = () => {
    if (newNotif.title && newNotif.message) {
      setNotifications([
        {
          ...newNotif,
          id: Date.now().toString(),
          status: newNotif.scheduledDate ? "مجدول" : "تم الإرسال",
        },
        ...notifications,
      ]);
      setNewNotif({ title: "", message: "", scheduledDate: "" });
    }
  };

  return (
    <div className="animate-in fade-in duration-300 pb-10">
      <h1 className="text-[22px] font-bold text-[var(--admin-ink)] mb-6">الإشعارات</h1>

      <div className="bg-card border border-border rounded-lg p-6 mb-8 shadow-sm">
        <h2 className="text-[16px] font-bold mb-4">إرسال / جدولة إشعار جديد</h2>
        <div className="space-y-4 mb-4">
          <div>
            <label className="block text-[13px] text-muted-foreground mb-1">عنوان الإشعار</label>
            <input
              type="text"
              className="w-full border border-border focus:border-black rounded-lg px-3 py-2 text-sm outline-none"
              value={newNotif.title}
              onChange={(e) => setNewNotif({ ...newNotif, title: e.target.value })}
              placeholder="عرض خاص..."
            />
          </div>
          <div>
            <label className="block text-[13px] text-muted-foreground mb-1">نص الإشعار</label>
            <textarea
              className="w-full border border-border focus:border-black rounded-lg px-3 py-2 text-sm outline-none resize-none"
              rows={3}
              value={newNotif.message}
              onChange={(e) => setNewNotif({ ...newNotif, message: e.target.value })}
              placeholder="تفاصيل الإشعار..."
            ></textarea>
          </div>
          <div>
            <label className="block text-[13px] text-muted-foreground mb-1">
              تاريخ ووقت الجدولة (اختياري)
            </label>
            <input
              type="datetime-local"
              className="w-full border border-border focus:border-black rounded-lg px-3 py-2 text-sm outline-none max-w-sm"
              value={newNotif.scheduledDate}
              onChange={(e) => setNewNotif({ ...newNotif, scheduledDate: e.target.value })}
            />
          </div>
        </div>
        <button
          onClick={handleAdd}
          className="bg-[var(--admin-ink)] text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-black transition-colors flex items-center gap-2"
        >
          <Bell className="w-4 h-4" /> إرسال الإشعار
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted text-foreground font-semibold border-b border-border">
              <tr>
                <th className="px-4 py-3">العنوان</th>
                <th className="px-4 py-3">الرسالة</th>
                <th className="px-4 py-3">التاريخ المجدول</th>
                <th className="px-4 py-3">الحالة</th>
                <th className="px-4 py-3">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {notifications.map((n: any) => (
                <tr key={n.id} className="hover:bg-muted">
                  <td className="px-4 py-3 font-medium">{n.title}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{n.message}</td>
                  <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                    {n.scheduledDate ? new Date(n.scheduledDate).toLocaleString("ar-EG") : "فوري"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[12px] font-medium ${n.status === "تم الإرسال" ? "bg-[var(--ok-bg)] text-[var(--ok-ink)]" : "bg-orange-100 text-orange-700"}`}
                    >
                      {n.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        setNotifications(notifications.filter((x: any) => x.id !== n.id))
                      }
                      className="text-muted-foreground hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {notifications.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    لا توجد إشعارات
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CategoriesView({ categories, setCategories }: { categories: any[]; setCategories: any }) {
  const [newCat, setNewCat] = useState("");

  const handleAdd = () => {
    if (!newCat.trim()) return;
    setCategories([...categories, { id: Date.now().toString(), title: newCat.trim() }]);
    setNewCat("");
  };

  const handleDelete = (id: string) => {
    setCategories(categories.filter((c: any) => c.id !== id));
  };

  return (
    <div className="animate-in fade-in duration-300">
      <h1 className="text-[22px] font-bold text-[var(--admin-ink)] mb-6">الأقسام</h1>
      <div className="bg-card border border-border rounded-lg p-6 mb-8 shadow-sm flex flex-col sm:flex-row gap-4 items-end sm:items-center">
        <div className="flex-1 w-full">
          <label className="block text-[13px] text-muted-foreground mb-1">اسم القسم الجديد</label>
          <input
            type="text"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            placeholder="مثال: Nintendo Switch Games"
            className="w-full border border-border focus:border-black rounded-lg px-4 py-2 outline-none text-sm"
          />
        </div>
        <button
          onClick={handleAdd}
          className="w-full sm:w-auto bg-black text-white px-6 py-2 rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-foreground transition-colors"
        >
          <Plus className="w-5 h-5" /> إضافة قسم
        </button>
      </div>
      <div className="border border-border rounded-lg bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted text-foreground font-semibold border-b border-border">
              <tr>
                <th className="px-4 py-3">القسم</th>
                <th className="px-4 py-3 w-24">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-[14px]">
              {categories.map((c: any) => (
                <tr key={c.id} className="hover:bg-muted transition-colors">
                  <td className="px-4 py-3 text-[var(--admin-ink)] font-medium" dir="ltr">
                    {c.title}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="text-muted-foreground hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">
                    لا توجد أقسام
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GameRequestsView({
  gameRequests,
  setGameRequests,
}: {
  gameRequests: any[];
  setGameRequests: any;
}) {
  const handleStatus = (id: string, status: string) => {
    setGameRequests(gameRequests.map((r: any) => (r.id === id ? { ...r, status } : r)));
  };

  return (
    <div className="animate-in fade-in duration-300">
      <h1 className="text-[22px] font-bold text-[var(--admin-ink)] mb-6">
        طلبات إضافة ألعاب جديدة
      </h1>
      <div className="border border-border rounded-lg bg-card overflow-hidden shadow-sm">
        <table className="w-full text-sm text-right">
          <thead className="bg-muted font-semibold border-b border-border">
            <tr>
              <th className="px-4 py-3">اسم اللعبة</th>
              <th className="px-4 py-3">المستخدم</th>
              <th className="px-4 py-3">التاريخ</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3">إجراء</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {gameRequests.map((r: any) => (
              <tr key={r.id} className="hover:bg-muted">
                <td className="px-4 py-3 font-medium">{r.game_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.user_name || "مستخدم"}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString("ar-EG")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${r.status === "approved" ? "bg-green-100 text-green-700" : r.status === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
                  >
                    {r.status === "approved"
                      ? "مقبول"
                      : r.status === "rejected"
                        ? "مرفوض"
                        : "قيد الانتظار"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStatus(r.id, "approved")}
                      className="text-green-600 hover:text-green-800"
                    >
                      <CheckCircle className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleStatus(r.id, "rejected")}
                      className="text-red-600 hover:text-red-800"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProblemSolutionsView({
  problemSolutions,
  setProblemSolutions,
}: {
  problemSolutions: any[];
  setProblemSolutions: any;
}) {
  const [editing, setEditing] = useState<any>(null);
  const [draft, setDraft] = useState({ title: "", description: "", steps: [""], category: "" });

  const handleAddStep = () => setDraft({ ...draft, steps: [...draft.steps, ""] });

  const handleSave = () => {
    if (editing) {
      setProblemSolutions(
        problemSolutions.map((ps: any) => (ps.id === editing.id ? { ...draft, id: ps.id } : ps)),
      );
    } else {
      setProblemSolutions([...problemSolutions, { ...draft, id: Date.now().toString() }]);
    }
    setEditing(null);
    setDraft({ title: "", description: "", steps: [""], category: "" });
  };

  return (
    <div className="animate-in fade-in duration-300">
      <h1 className="text-[22px] font-bold text-[var(--admin-ink)] mb-6">حلول المشاكل التقنية</h1>

      <div className="bg-card border border-border rounded-lg p-6 mb-8 shadow-sm">
        <h2 className="text-lg font-bold mb-4">{editing ? "تعديل حل" : "إضافة حل جديد لمشكلة"}</h2>
        <div className="space-y-4">
          <input
            className="w-full border border-border rounded-lg px-4 py-2 outline-none"
            placeholder="عنوان المشكلة"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <textarea
            className="w-full border border-border rounded-lg px-4 py-2 outline-none min-h-[100px]"
            placeholder="وصف مختصر للمشكلة"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <div className="space-y-2">
            <label className="text-sm font-bold">خطوات الحل:</label>
            {draft.steps.map((step, idx) => (
              <input
                key={idx}
                className="w-full border border-border rounded-lg px-4 py-2 outline-none"
                placeholder={`خطوة ${idx + 1}`}
                value={step}
                onChange={(e) => {
                  const s = [...draft.steps];
                  s[idx] = e.target.value;
                  setDraft({ ...draft, steps: s });
                }}
              />
            ))}
            <button onClick={handleAddStep} className="text-sm text-blue-600 font-bold">
              + إضافة خطوة
            </button>
          </div>
          <button
            onClick={handleSave}
            className="bg-black text-white px-6 py-2 rounded-lg font-bold"
          >
            حفظ الحل
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {problemSolutions.map((ps: any) => (
          <div
            key={ps.id}
            className="bg-card border border-border rounded-lg p-4 flex justify-between items-center"
          >
            <div>
              <h3 className="font-bold">{ps.title}</h3>
              <p className="text-sm text-muted-foreground">{ps.description}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditing(ps);
                  setDraft(ps);
                }}
                className="p-2 hover:bg-muted rounded-md"
              >
                <Edit className="w-4 h-4" />
              </button>
              <button
                onClick={() =>
                  setProblemSolutions(problemSolutions.filter((x: any) => x.id !== ps.id))
                }
                className="p-2 hover:bg-muted rounded-md text-red-500"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function XCircle({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

function MarketSettingsView() {
  const [rate, setRate] = React.useState(6.8);
  const [price, setPrice] = React.useState(0.24);
  const [promo, setPromo] = React.useState(2);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/banana/admin")
      .then((res) => res.json())
      .then((data) => {
        setRate(data.rewardRate ?? 6.8);
        setPrice(data.openingPrice ?? 0.24);
        setPromo(data.promoRate ?? 2);
      });
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await fetch("/api/banana/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardRate: rate, openingPrice: price, promoRate: promo }),
      });
      alert("تم حفظ إعدادات السوق بنجاح");
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full p-6 animate-in fade-in duration-300">
      <h1 className="text-2xl font-bold mb-6">إعدادات سوق الموز</h1>
      <div className="bg-card border border-border rounded-xl p-6 space-y-6 shadow-sm">
        <div>
          <label className="block text-sm font-bold mb-2">
            عدد الموز المكتسب لكل 1 دينار عراقي:
          </label>
          <input
            type="number"
            step="0.1"
            className="w-full p-3 rounded-lg border border-border bg-muted/50 focus:border-black outline-none transition-colors"
            value={rate}
            onChange={(e) => setRate(parseFloat(e.target.value))}
          />
          <p className="text-xs text-muted-foreground mt-1">
            مثال: إذا أنفق المستخدم 1000 دينار، يحصل على {Math.round(rate * 1000)} موزة.
          </p>
        </div>

        <div>
          <label className="block text-sm font-bold mb-2">سعر الافتتاح للموز (دولار):</label>
          <input
            type="number"
            step="0.01"
            className="w-full p-3 rounded-lg border border-border bg-muted/50 focus:border-black outline-none transition-colors"
            value={price}
            onChange={(e) => setPrice(parseFloat(e.target.value))}
          />
        </div>

        <div>
          <label className="block text-sm font-bold mb-2">تكلفة الترويج (موزة/دقيقة):</label>
          <input
            type="number"
            className="w-full p-3 rounded-lg border border-border bg-muted/50 focus:border-black outline-none transition-colors"
            value={promo}
            onChange={(e) => setPromo(parseInt(e.target.value))}
          />
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full bg-black text-white font-bold py-3 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isSaving ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          حفظ التغييرات
        </button>
      </div>
    </div>
  );
}

function UsersManagementView() {
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [bananAmount, setBananAmount] = useState("");

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => adminApi.getUsers(),
  });

  const logsQuery = useQuery({
    queryKey: ["user-logs", selectedUserId],
    queryFn: () => (selectedUserId ? adminApi.getUserLogs(selectedUserId) : null),
    enabled: !!selectedUserId,
  });

  const adjustBalance = useMutation({
    mutationFn: (payload: any) => adminApi.adjustBalance(payload),
    onSuccess: () => {
      toast.success("تم تحديث الرصيد بنجاح");
      setAdjustAmount("");
      setAdjustNote("");
      refetch();
    },
  });

  const approveRecharge = useMutation({
    mutationFn: (requestId: string) => adminApi.approveRecharge(requestId, "Approved by admin"),
    onSuccess: () => {
      toast.success("تمت الموافقة على طلب الشحن");
      refetch();
    },
  });

  const rejectRecharge = useMutation({
    mutationFn: (requestId: string) => adminApi.rejectRecharge(requestId, "Rejected by admin"),
    onSuccess: () => {
      toast.success("تم رفض طلب الشحن");
      refetch();
    },
  });

  const createBananCodeAction = useMutation({
    mutationFn: (amount: number) => adminApi.createBananCode(amount),
    onSuccess: (res: any) => {
      toast.success(`تم إنشاء كود بنانتو: ${res.code.code}`);
      setBananAmount("");
    },
  });

  const filteredUsers =
    data?.users.filter(
      (u: any) =>
        (u?.name || "").toLowerCase().includes((search || "").toLowerCase()) ||
        (u?.username || "").toLowerCase().includes((search || "").toLowerCase()) ||
        (u?.email || "").toLowerCase().includes((search || "").toLowerCase()) ||
        (u?.phone || "").includes(search || ""),
    ) || [];

  if (isLoading) return <div className="p-10 text-center">جاري التحميل...</div>;

  return (
    <div className="w-full p-6 space-y-8 animate-in fade-in duration-300">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Users className="w-8 h-8 text-blue-600" />
          إدارة المستخدمين
        </h1>
      </div>

      {/* Banan Code Generator */}
      <div className="bg-card rounded-3xl p-6 border border-border shadow-sm">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5 text-green-600" />
          إنشاء أكواد بنانتو
        </h2>
        <div className="flex gap-2">
          <input
            type="number"
            value={bananAmount}
            onChange={(e) => setBananAmount(e.target.value)}
            placeholder="المبلغ ($)"
            className="flex-1 rounded-xl border border-border px-4 py-2 outline-none bg-muted/30 focus:border-black transition-colors"
          />
          <button
            onClick={() => createBananCodeAction.mutate(Number(bananAmount))}
            disabled={createBananCodeAction.isPending || !bananAmount}
            className="bg-green-600 text-white font-bold px-6 py-2 rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            إنشاء كود
          </button>
        </div>
      </div>

      {/* Recharge Requests — review with the receipt and the member in view */}
      <div className="bg-card rounded-3xl p-6 border border-border shadow-sm">
        <RechargeReviewPanel
          requests={(data?.rechargeRequests ?? []) as any}
          onSettled={() => refetch()}
          compact
        />
      </div>

      {/* Users Table */}
      <div className="bg-card rounded-3xl border border-border shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border bg-muted/30">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="البحث بالاسم، البريد، الهاتف أو المعرف..."
              className="w-full pl-12 pr-4 py-3 rounded-2xl bg-white border border-border outline-none focus:ring-2 ring-blue-500/20"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead>
              <tr className="text-xs text-muted-foreground bg-muted/50 border-b border-border">
                <th className="px-6 py-4 font-bold">المستخدم</th>
                <th className="px-6 py-4 font-bold">التواصل</th>
                <th className="px-6 py-4 font-bold">المحفظة</th>
                <th className="px-6 py-4 font-bold">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredUsers.map((u: any) => (
                <tr key={u.id} className="hover:bg-muted/10 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                        {u.name ? u.name[0] : u.username ? u.username[0] : "👤"}
                      </div>
                      <div>
                        <p className="font-bold text-sm">{u.name}</p>
                        <p className="text-xs text-muted-foreground">
                          @{u.username || "بدون_معرف"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-xs font-medium">{u.email}</p>
                    <p className="text-xs text-muted-foreground">{u.phone}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-black text-blue-600">{u.walletBalance || 0} $</p>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => setSelectedUserId(u.id)}
                      className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-lg font-bold transition-colors"
                    >
                      إدارة الرصيد والسجل
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Details Modal */}
      {selectedUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-2xl rounded-3xl p-6 border border-border shadow-2xl space-y-6 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center sticky top-0 bg-card py-2 border-b border-border mb-4">
              <h2 className="text-lg font-bold">تفاصيل المستخدم ورصيده</h2>
              <button
                onClick={() => setSelectedUserId(null)}
                className="p-2 hover:bg-muted rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="font-bold text-sm text-muted-foreground uppercase tracking-wider">
                  تعديل الرصيد يدوياً
                </h3>
                <div className="space-y-3">
                  <input
                    type="number"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value)}
                    placeholder="المبلغ (مثال: 50 أو -20)"
                    className="w-full rounded-xl border border-border px-4 py-2 outline-none bg-muted/30 focus:border-black transition-colors"
                  />
                  <input
                    value={adjustNote}
                    onChange={(e) => setAdjustNote(e.target.value)}
                    placeholder="ملاحظة التعديل"
                    className="w-full rounded-xl border border-border px-4 py-2 outline-none bg-muted/30 focus:border-black transition-colors"
                  />
                  <button
                    onClick={() =>
                      adjustBalance.mutate({
                        userId: selectedUserId,
                        amount: Number(adjustAmount),
                        description: adjustNote,
                      })
                    }
                    disabled={adjustBalance.isPending || !adjustAmount}
                    className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    تحديث الرصيد
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="font-bold text-sm text-muted-foreground uppercase tracking-wider">
                  سجل الحركات
                </h3>
                <div className="bg-muted/50 rounded-2xl p-4 max-h-[300px] overflow-y-auto space-y-2 border border-border">
                  {logsQuery.isLoading ? (
                    <div className="flex justify-center py-8">
                      <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : logsQuery.data?.logs?.length === 0 ? (
                    <p className="text-center text-xs py-8 text-muted-foreground">
                      لا يوجد حركات مسجلة
                    </p>
                  ) : (
                    logsQuery.data?.logs.map((tx: any) => (
                      <div
                        key={tx.id}
                        className="bg-white p-3 rounded-xl border border-border flex justify-between items-center shadow-sm"
                      >
                        <div className="max-w-[70%]">
                          <p className="text-[11px] font-bold leading-tight line-clamp-2">
                            {tx.description}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {new Date(tx.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <span
                          className={`text-xs font-black shrink-0 ${tx.amount > 0 ? "text-green-600" : "text-rose-600"}`}
                        >
                          {tx.amount > 0 ? "+" : ""}
                          {tx.amount} $
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * What the store actually earned.
 *
 * The five figures are shown as a chain — Gross, less discounts, less refunds,
 * gives Net; less cost, gives Profit — because a single "صافي الأرباح" number
 * cannot show *where* the margin went, which is the question this screen exists
 * to answer. See `src/lib/finance.ts` for the four errors the previous figure
 * made, all of which pushed profit up.
 */
function FinancialStatsView({ products, orders }: { products: any[]; orders: any[] }) {
  /*
    Only consulted for lines with no cost snapshot — orders placed before
    checkout started recording one. Every such consultation is surfaced below
    rather than presented as fact, because the catalogue's cost today is not
    what the order cost then.
  */
  const currentCostOf = (productId: unknown) => {
    const product = products.find((p: any) => String(p.id) === String(productId));
    const cost = Number(product?.cost);
    return Number.isFinite(cost) ? cost : undefined;
  };

  const totals = financeTotals(orders || [], currentCostOf);
  const iqd = (value: number) => `${Math.round(value).toLocaleString()} د.ع`;

  const chain: { label: string; value: number; tone: string; hint?: string }[] = [
    {
      label: "إجمالي المبيعات (قبل الخصم)",
      value: totals.gross,
      tone: "text-emerald-600",
      hint: "مجموع أسعار المنتجات كما هي في الطلبات",
    },
    {
      label: "الخصومات والكوبونات",
      value: -totals.discount,
      tone: "text-amber-600",
      hint: "ما تم التنازل عنه من الهامش",
    },
    {
      label: "المبالغ المُعادة",
      value: -totals.refunded,
      tone: "text-amber-600",
      hint: "الطلبات الملغاة غير محتسبة أصلاً",
    },
    {
      label: "صافي المبيعات",
      value: totals.net,
      tone: "text-emerald-700",
      hint: "ما دفعه الزبون فعلياً مقابل المنتجات",
    },
    {
      label: "تكلفة البضاعة المباعة",
      value: -totals.cost,
      tone: "text-rose-600",
      hint: "من التكلفة المسجّلة وقت الطلب",
    },
  ];

  return (
    <div className="p-6 space-y-8 animate-in fade-in duration-300">
      <h1 className="text-2xl font-black flex items-center gap-2">
        <BarChart2 className="w-8 h-8 text-indigo-600" />
        التكلفة والأرباح
      </h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {chain.map((row) => (
          <div key={row.label} className="bg-white p-5 rounded-3xl border border-border shadow-sm">
            <p className="text-muted-foreground text-xs font-bold mb-1">{row.label}</p>
            <p className={`text-2xl font-black ${row.tone}`} dir="ltr">
              {iqd(row.value)}
            </p>
            {row.hint && <p className="mt-1 text-[11px] text-muted-foreground">{row.hint}</p>}
          </div>
        ))}
      </div>

      <div className="bg-white p-6 rounded-3xl border border-border shadow-sm">
        <p className="text-muted-foreground text-sm font-bold mb-1">صافي الأرباح</p>
        <p
          className={`text-4xl font-black ${totals.profit >= 0 ? "text-blue-600" : "text-rose-600"}`}
          dir="ltr"
        >
          {iqd(totals.profit)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          صافي المبيعات ناقص التكلفة، من {totals.orders.toLocaleString()} طلب محتسب
          {totals.margin !== null && <> · هامش {(totals.margin * 100).toFixed(1)}%</>}
        </p>
        {totals.shipping > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {/* Collected for the courier, so it is neither revenue nor margin. */}
            رسوم التوصيل المحصّلة ({iqd(totals.shipping)}) غير محتسبة ضمن المبيعات أو الأرباح
          </p>
        )}
        {totals.costIsEstimated && (
          <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-700">
            {/* Saying so beats quietly presenting a guess as a fact. */}
            {totals.ordersWithEstimatedCost.toLocaleString()} طلب لا يحمل تكلفة مسجّلة وقت الشراء،
            فاستُخدمت تكلفة المنتج الحالية لها — الرقم تقديري لهذه الطلبات
          </p>
        )}
      </div>

      <div className="bg-white p-8 rounded-3xl border border-border shadow-sm h-[400px] flex items-center justify-center">
        <div className="text-center space-y-2">
          <PieChart className="w-12 h-12 text-muted-foreground mx-auto opacity-20" />
          <p className="text-muted-foreground font-bold italic">
            الرسوم البيانية التفصيلية قيد التطوير...
          </p>
        </div>
      </div>
    </div>
  );
}

function PricingSettingsView() {
  const [isSaving, setIsSaving] = useState(false);
  const { data: store, refetch } = useQuery({
    queryKey: ["store"],
    queryFn: () => adminApi.store(),
  });
  const settings = store?.settings || {};

  const [form, setForm] = useState({
    bananaPerDinar: Number(settings["bananaPerDinar"] || 1),
    dinarPerBanana: Number(settings["dinarPerBanana"] || 1000),
    usdExchangeRate: Number(settings["usdExchangeRate"] || 1500),
    deliveryBase: Number(settings["deliveryBase"] || 5000),
    deliveryExceptions: (Array.isArray(settings["deliveryExceptions"])
      ? settings["deliveryExceptions"]
      : []) as { city: string; price: number }[],
  });

  useEffect(() => {
    if (settings) {
      setForm({
        bananaPerDinar: Number(settings["bananaPerDinar"] || 1),
        dinarPerBanana: Number(settings["dinarPerBanana"] || 1000),
        usdExchangeRate: Number(settings["usdExchangeRate"] || 1500),
        deliveryBase: Number(settings["deliveryBase"] || 5000),
        deliveryExceptions: (Array.isArray(settings["deliveryExceptions"])
          ? settings["deliveryExceptions"]
          : []) as { city: string; price: number }[],
      });
    }
  }, [settings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await adminApi.saveStore({ settings: { ...settings, ...form } });
      toast.success("تم حفظ إعدادات السعر بنجاح");
      refetch();
    } catch (e) {
      toast.error("فشل الحفظ");
    } finally {
      setIsSaving(false);
    }
  };

  const addException = () => {
    setForm({
      ...form,
      deliveryExceptions: [...form.deliveryExceptions, { city: "", price: 5000 }],
    });
  };

  const removeException = (index: number) => {
    setForm({
      ...form,
      deliveryExceptions: form.deliveryExceptions.filter((_, i) => i !== index),
    });
  };

  const updateException = (index: number, patch: Partial<{ city: string; price: number }>) => {
    setForm({
      ...form,
      deliveryExceptions: form.deliveryExceptions.map((ex, i) =>
        i === index ? { ...ex, ...patch } : ex,
      ),
    });
  };

  return (
    <div className="w-full p-6 space-y-8 animate-in fade-in duration-300">
      <h1 className="text-2xl font-black flex items-center gap-2">
        <Settings className="w-8 h-8 text-blue-600" />
        إعدادات السعر
      </h1>

      <div className="bg-white p-8 rounded-3xl border border-border shadow-sm space-y-6">
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-black">سعر الموزة مقابل الدينار (للمستخدم)</label>
            <div className="text-[10px] text-muted-foreground leading-tight mb-1">
              تستخدم لتحويل رصيد الموز المكتسب إلى قيمة شرائية (د.ع)
            </div>
            <input
              type="number"
              value={form.bananaPerDinar}
              onChange={(e) => setForm({ ...form, bananaPerDinar: Number(e.target.value) })}
              className="w-full p-3 rounded-xl bg-muted/50 border border-border outline-none focus:border-black"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-black">كل دينار كم موزة يحصل عليها المستخدم؟</label>
            <div className="text-[10px] text-muted-foreground leading-tight mb-1">
              تستخدم لمكافأة المستخدم بموزات عند الشراء أو الشحن
            </div>
            <input
              type="number"
              value={form.dinarPerBanana}
              onChange={(e) => setForm({ ...form, dinarPerBanana: Number(e.target.value) })}
              className="w-full p-3 rounded-xl bg-muted/50 border border-border outline-none focus:border-black"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-black">سعر الصرف (دينار مقابل 1 دولار)</label>
            <div className="text-[10px] text-muted-foreground leading-tight mb-1">
              السعر المعتمد لتحويل الدولار إلى دينار عراقي في المحفظة والمتجر
            </div>
            <input
              type="number"
              value={form.usdExchangeRate}
              onChange={(e) => setForm({ ...form, usdExchangeRate: Number(e.target.value) })}
              className="w-full p-3 rounded-xl bg-muted/50 border border-border outline-none focus:border-black"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-black">تكلفة التوصيل الأساسية (للمحافظات)</label>
            <div className="text-[10px] text-muted-foreground leading-tight mb-1">
              سعر التوصيل القياسي لجميع المحافظات (د.ع)
            </div>
            <input
              type="number"
              value={form.deliveryBase}
              onChange={(e) => setForm({ ...form, deliveryBase: Number(e.target.value) })}
              className="w-full p-3 rounded-xl bg-muted/50 border border-border outline-none focus:border-black"
            />
          </div>
        </div>

        <div className="pt-6 border-t border-border">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-black">استثناءات المحافظات</h3>
            <button
              onClick={addException}
              className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            {form.deliveryExceptions.map((ex, idx) => (
              <div key={idx} className="flex gap-3">
                <input
                  placeholder="المحافظة"
                  value={ex.city}
                  onChange={(e) => {
                    const next = [...form.deliveryExceptions];
                    const current = next[idx] || { city: "", price: 5000 };
                    next[idx] = { city: e.target.value, price: current.price };
                    setForm({ ...form, deliveryExceptions: next });
                  }}
                  className="flex-1 p-3 rounded-xl bg-muted/50 border border-border outline-none"
                />
                <input
                  type="number"
                  placeholder="السعر"
                  value={ex.price}
                  onChange={(e) => {
                    const next = [...form.deliveryExceptions];
                    const current = next[idx] || { city: "", price: 5000 };
                    next[idx] = { city: current.city, price: Number(e.target.value) };
                    setForm({ ...form, deliveryExceptions: next });
                  }}
                  className="w-32 p-3 rounded-xl bg-muted/50 border border-border outline-none"
                />
                <button
                  onClick={() => {
                    const next = form.deliveryExceptions.filter((_, i) => i !== idx);
                    setForm({ ...form, deliveryExceptions: next });
                  }}
                  className="p-3 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full bg-black text-white font-black py-4 rounded-2xl hover:bg-zinc-800 transition-all flex items-center justify-center gap-2"
        >
          {isSaving ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : (
            <Check className="w-5 h-5" />
          )}
          حفظ جميع الإعدادات
        </button>
        <div className="space-y-4 pt-4 border-t border-border">
          <div className="flex justify-between items-center">
            <label className="text-sm font-black">استثناءات التوصيل (حسب المدينة)</label>
            <button
              onClick={addException}
              className="text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg font-bold hover:bg-blue-100 transition-colors flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              إضافة استثناء
            </button>
          </div>

          <div className="space-y-3">
            {form.deliveryExceptions.length === 0 ? (
              <p className="text-xs text-muted-foreground italic text-center py-4 bg-muted/20 rounded-xl">
                لا توجد استثناءات محددة حالياً
              </p>
            ) : (
              form.deliveryExceptions.map((ex, idx) => (
                <div key={idx} className="flex gap-2 items-center animate-in slide-in-from-right-2">
                  <input
                    placeholder="اسم المدينة"
                    value={ex.city}
                    onChange={(e) => updateException(idx, { city: e.target.value })}
                    className="flex-1 p-3 rounded-xl bg-muted/50 border border-border outline-none focus:border-black text-sm"
                  />
                  <input
                    type="number"
                    placeholder="السعر (د.ع)"
                    value={ex.price}
                    onChange={(e) => updateException(idx, { price: Number(e.target.value) })}
                    className="w-32 p-3 rounded-xl bg-muted/50 border border-border outline-none focus:border-black text-sm"
                  />
                  <button
                    onClick={() => removeException(idx)}
                    className="p-3 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-4"
        >
          {isSaving ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : (
            <Check className="w-5 h-5" />
          )}
          حفظ جميع إعدادات الأسعار
        </button>
      </div>
    </div>
  );
}

function WalletManagementView() {
  const { data, refetch } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => adminApi.getUsers(),
  });
  const [isSaving, setIsSaving] = useState(false);
  const { data: store } = useQuery({ queryKey: ["store"], queryFn: () => adminApi.store() });
  const settings = store?.settings || {};

  const [form, setForm] = useState({
    zainCashNumber: String(settings["zainCashNumber"] || ""),
    zainCashQR: String(settings["zainCashQR"] || ""),
    rafidainNumber: String(settings["rafidainNumber"] || ""),
    rafidainQR: String(settings["rafidainQR"] || ""),
    rafidainOwner: String(settings["rafidainOwner"] || "ali amer musa"),
    cryptoID: String(settings["cryptoID"] || ""),
  });

  useEffect(() => {
    if (settings) {
      setForm({
        zainCashNumber: String(settings["zainCashNumber"] || ""),
        zainCashQR: String(settings["zainCashQR"] || ""),
        rafidainNumber: String(settings["rafidainNumber"] || ""),
        rafidainQR: String(settings["rafidainQR"] || ""),
        rafidainOwner: String(settings["rafidainOwner"] || "ali amer musa"),
        cryptoID: String(settings["cryptoID"] || ""),
      });
    }
  }, [settings]);

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await adminApi.saveStore({ settings: { ...settings, ...form } });
      toast.success("تم تحديث إعدادات الدفع");
    } catch (e) {
      toast.error("فشل التحديث");
    } finally {
      setIsSaving(false);
    }
  };

  const approveRecharge = useMutation({
    mutationFn: (requestId: string) => adminApi.approveRecharge(requestId),
    onSuccess: () => {
      toast.success("تم القبول");
      refetch();
    },
  });

  const rejectRecharge = useMutation({
    mutationFn: (requestId: string) => adminApi.rejectRecharge(requestId),
    onSuccess: () => {
      toast.success("تم الرفض");
      refetch();
    },
  });

  return (
    <div className="p-6 space-y-8 animate-in fade-in duration-300">
      <h1 className="text-2xl font-black flex items-center gap-2">
        <Wallet className="w-8 h-8 text-emerald-600" />
        إدارة المحفظة
      </h1>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-white p-4 rounded-2xl border border-border shadow-sm space-y-4">
          <h2 className="font-black flex items-center gap-2 mb-2">
            <CreditCard className="w-5 h-5 text-blue-600" /> إعدادات التعبئة
          </h2>
          <div className="space-y-4">
            <div className="space-y-4">
              <label className="text-xs font-bold text-muted-foreground uppercase">زين كاش</label>
              <div className="flex flex-col gap-2">
                <input
                  value={form.zainCashNumber}
                  onChange={(e) => setForm({ ...form, zainCashNumber: e.target.value })}
                  placeholder="الرقم"
                  className="w-full p-3 rounded-xl bg-muted/50 border border-border outline-none"
                />
                <div className="flex items-center gap-2">
                  <input
                    value={form.zainCashQR}
                    onChange={(e) => setForm({ ...form, zainCashQR: e.target.value })}
                    placeholder="رابط صورة الباركود"
                    className="flex-1 p-3 rounded-xl bg-muted/50 border border-border outline-none"
                  />
                  <label className="cursor-pointer bg-muted hover:bg-muted/80 p-3 rounded-xl border border-border transition-colors">
                    <Upload className="w-5 h-5 text-muted-foreground" />
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          try {
                            const dataUrl = await fileToDataUrl(file);
                            const { url } = await adminApi.upload(dataUrl, "wallets");
                            setForm({ ...form, zainCashQR: url });
                            toast.success("تم رفع الباركود");
                          } catch (err) {
                            toast.error("فشل رفع الصورة");
                          }
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <label className="text-xs font-bold text-muted-foreground uppercase">
                ماستركارد الرافدين
              </label>
              <div className="flex flex-col gap-2">
                <input
                  value={form.rafidainNumber}
                  onChange={(e) => setForm({ ...form, rafidainNumber: e.target.value })}
                  placeholder="رقم البطاقة"
                  className="w-full p-3 rounded-xl bg-muted/50 border border-border outline-none"
                />
                <input
                  value={form.rafidainOwner}
                  onChange={(e) => setForm({ ...form, rafidainOwner: e.target.value })}
                  placeholder="اسم صاحب البطاقة"
                  className="w-full p-3 rounded-xl bg-muted/50 border border-border outline-none"
                />
                <div className="flex items-center gap-2">
                  <input
                    value={form.rafidainQR}
                    onChange={(e) => setForm({ ...form, rafidainQR: e.target.value })}
                    placeholder="رابط صورة الباركود"
                    className="flex-1 p-3 rounded-xl bg-muted/50 border border-border outline-none"
                  />
                  <label className="cursor-pointer bg-muted hover:bg-muted/80 p-3 rounded-xl border border-border transition-colors">
                    <Upload className="w-5 h-5 text-muted-foreground" />
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          try {
                            const dataUrl = await fileToDataUrl(file);
                            const { url } = await adminApi.upload(dataUrl, "wallets");
                            setForm({ ...form, rafidainQR: url });
                            toast.success("تم رفع باركود الرافدين");
                          } catch (err) {
                            toast.error("فشل رفع الصورة");
                          }
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase">
                العملات الرقمية - ID الحساب
              </label>
              <input
                value={form.cryptoID}
                onChange={(e) => setForm({ ...form, cryptoID: e.target.value })}
                className="w-full p-3 rounded-xl bg-muted/50 border border-border outline-none"
              />
            </div>
            <button
              onClick={handleSaveSettings}
              disabled={isSaving}
              className="w-full bg-blue-600 text-white font-black py-3 rounded-2xl hover:bg-blue-700 transition-all"
            >
              حفظ الإعدادات
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <RechargeReviewPanel
            requests={(data?.rechargeRequests ?? []) as any}
            onSettled={() => refetch()}
          />
        </div>
      </div>
    </div>
  );
}

function BananCodesView() {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("10000");
  const [count, setCount] = useState("1");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "used">("all");
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [latestBatch, setLatestBatch] = useState<any[] | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin-banan-codes"],
    queryFn: () => adminApi.listBananCodes(),
  });

  const createBatchMutation = useMutation({
    mutationFn: ({ val, cnt }: { val: number; cnt: number }) => adminApi.createBananCode(val, cnt),
    onSuccess: (res) => {
      const created = res.codes || (res.code ? [res.code] : []);
      setLatestBatch(created);
      toast.success(`تم إنشاء وحفظ ${created.length} كود بنانتو بنجاح في النظام`);
      queryClient.invalidateQueries({ queryKey: ["admin-banan-codes"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "فشل إنشاء الأكواد");
    },
  });

  const deleteCodeMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteBananCode(id),
    onSuccess: () => {
      toast.success("تم حذف الكود بنجاح");
      queryClient.invalidateQueries({ queryKey: ["admin-banan-codes"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "فشل حذف الكود");
    },
  });

  const handleGenerate = () => {
    const numAmount = Number(amount);
    const numCount = Number(count) || 1;
    if (!numAmount || numAmount <= 0) {
      toast.error("يرجى تحديد قيمة الكود بالدينار العراقي");
      return;
    }
    if (numCount < 1 || numCount > 100) {
      toast.error("الكمية يجب أن تكون بين 1 و 100 كود");
      return;
    }
    createBatchMutation.mutate({ val: numAmount, cnt: numCount });
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeId(id);
    toast.success(`تم نسخ الكود: ${text}`);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const copyAllBatchCodes = (codes: any[]) => {
    const textList = codes
      .map((c) => `${c.code} (${c.value?.toLocaleString("en-US")} د.ع)`)
      .join("\n");
    navigator.clipboard.writeText(textList);
    toast.success(`تم نسخ جميع الأكواد (${codes.length} كود) إلى الحافظة`);
  };

  const allCodes = data?.codes || [];

  const totalCodesCount = allCodes.length;
  const activeCodes = allCodes.filter((c: any) => !c.isUsed && !c.is_used);
  const usedCodes = allCodes.filter((c: any) => c.isUsed || c.is_used);
  const totalValue = allCodes.reduce((acc: number, c: any) => acc + (Number(c.value) || 0), 0);
  const activeValue = activeCodes.reduce((acc: number, c: any) => acc + (Number(c.value) || 0), 0);
  const usedValue = usedCodes.reduce((acc: number, c: any) => acc + (Number(c.value) || 0), 0);

  const filteredCodes = allCodes.filter((c: any) => {
    const isCodeUsed = Boolean(c.isUsed || c.is_used);
    if (statusFilter === "active" && isCodeUsed) return false;
    if (statusFilter === "used" && !isCodeUsed) return false;

    if (!search.trim()) return true;
    const query = search.trim().toLowerCase();

    const codeMatch = String(c.code || "")
      .toLowerCase()
      .includes(query);
    const userNameMatch = String(c.usedByUser?.name || "")
      .toLowerCase()
      .includes(query);
    const userPhoneMatch = String(c.usedByUser?.phone || "").includes(query);
    const userEmailMatch = String(c.usedByUser?.email || "")
      .toLowerCase()
      .includes(query);
    const userMemberMatch = String(c.usedByUser?.memberNo || "")
      .toLowerCase()
      .includes(query);
    const usedByMatch = String(c.usedBy || c.used_by || "")
      .toLowerCase()
      .includes(query);

    return (
      codeMatch ||
      userNameMatch ||
      userPhoneMatch ||
      userEmailMatch ||
      userMemberMatch ||
      usedByMatch
    );
  });

  const PRESET_AMOUNTS = [5000, 10000, 25000, 50000, 100000];
  const PRESET_COUNTS = [1, 5, 10, 20, 50];

  return (
    <div className="p-6 space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Coins className="w-8 h-8 text-amber-500" />
            إدارة وتتبع أكواد بنانتو
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            إنشاء أكواد التعبئة الفورية وتتبع المستخدمين المستفيدين لحماية وأمان النظام
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="self-start sm:self-auto flex items-center gap-2 bg-muted/60 hover:bg-muted border border-border px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin text-amber-500" : ""}`} />
          تحديث السجلات
        </button>
      </div>

      {/* KPI Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card rounded-2xl p-5 border border-border shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-muted-foreground">إجمالي الأكواد</span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-600">
              <Key className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black">{totalCodesCount.toLocaleString("en-US")}</div>
          <div className="text-xs text-muted-foreground mt-1">
            القيمة الكلية: {totalValue.toLocaleString("en-US")} د.ع
          </div>
        </div>

        <div className="bg-card rounded-2xl p-5 border border-border shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-green-600">الأكواد المتاحة والنشطة</span>
            <div className="w-8 h-8 rounded-xl bg-green-500/10 flex items-center justify-center text-green-600">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-green-600">
            {activeCodes.length.toLocaleString("en-US")}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            قيمة المتاح: {activeValue.toLocaleString("en-US")} د.ع
          </div>
        </div>

        <div className="bg-card rounded-2xl p-5 border border-border shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-blue-600">الأكواد المستخدمة والمشحونة</span>
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-600">
              <UserCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-blue-600">
            {usedCodes.length.toLocaleString("en-US")}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            قيمة المشحون: {usedValue.toLocaleString("en-US")} د.ع
          </div>
        </div>

        <div className="bg-card rounded-2xl p-5 border border-border shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-muted-foreground">نسبة الاستهلاك</span>
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-600">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black">
            {totalCodesCount > 0
              ? `${Math.round((usedCodes.length / totalCodesCount) * 100)}%`
              : "0%"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            تتبع فوري ومحمي في قاعدة البيانات
          </div>
        </div>
      </div>

      {/* Code Generation Form */}
      <div className="bg-card rounded-3xl p-6 border border-border shadow-sm space-y-6">
        <div>
          <h2 className="text-lg font-black flex items-center gap-2">
            <Plus className="w-5 h-5 text-amber-500" />
            إنشاء وتوليد دفعة أكواد بنانتو جديدة
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            الأكواد تنشأ فورياً وتُحفظ تلقائياً في النظام ويمكن نسخها وتوزيعها على المستخدمين
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Amount Section */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-muted-foreground">
              قيمة الكود (بالدينار العراقي د.ع)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-muted/40 border border-border outline-none focus:border-amber-500 font-bold text-lg"
              placeholder="مثال: 10000"
            />
            <div className="flex flex-wrap gap-1.5">
              {PRESET_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setAmount(String(amt))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    amount === String(amt)
                      ? "bg-amber-500 text-white shadow-sm"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {amt.toLocaleString("en-US")} د.ع
                </button>
              ))}
            </div>
          </div>

          {/* Count Section */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-muted-foreground">عدد الأكواد المطلوبة</label>
            <input
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-muted/40 border border-border outline-none focus:border-amber-500 font-bold text-lg"
              placeholder="مثال: 10"
            />
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COUNTS.map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setCount(String(cnt))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    count === String(cnt)
                      ? "bg-amber-500 text-white shadow-sm"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {cnt} {cnt === 1 ? "كود واحد" : "أكواد"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={createBatchMutation.isPending || !amount || !count}
          className="w-full bg-amber-500 hover:bg-amber-600 text-white font-black py-4 rounded-2xl transition-all shadow-md flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none"
        >
          {createBatchMutation.isPending ? (
            <>
              <RefreshCw className="w-5 h-5 animate-spin" />
              جاري توليد وحفظ الأكواد في النظام...
            </>
          ) : (
            <>
              <Coins className="w-5 h-5" />
              توليد وحفظ {count || 1} كود بقيمة {Number(amount || 0).toLocaleString("en-US")} د.ع
            </>
          )}
        </button>

        {/* Newly Generated Batch Highlight Card */}
        {latestBatch && latestBatch.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 space-y-4 animate-in slide-in-from-top-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-amber-600" />
                <span className="font-black text-amber-900 dark:text-amber-300">
                  تم توليد {latestBatch.length} كود جديد بنجاح
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyAllBatchCodes(latestBatch)}
                  className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-black px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all shadow-sm"
                >
                  <Copy className="w-3.5 h-3.5" />
                  نسخ جميع الأكواد الـ ({latestBatch.length})
                </button>
                <button
                  onClick={() => setLatestBatch(null)}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                >
                  إخفاء
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 max-h-48 overflow-y-auto p-1">
              {latestBatch.map((c) => (
                <div
                  key={c.id}
                  onClick={() => copyToClipboard(c.code, `batch-${c.id}`)}
                  className="bg-card border border-amber-500/20 hover:border-amber-500 p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between group shadow-sm"
                  title="انقر لنسخ الكود"
                >
                  <span className="font-mono font-black text-sm tracking-wider text-amber-700 dark:text-amber-400">
                    {c.code}
                  </span>
                  {copiedCodeId === `batch-${c.id}` ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-muted-foreground group-hover:text-amber-600" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Codes List & Tracking Table */}
      <div className="bg-card rounded-3xl border border-border shadow-sm overflow-hidden space-y-4">
        {/* Table Header & Search Bar */}
        <div className="p-6 border-b border-border bg-muted/10 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-black text-lg flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-amber-500" />
                سجل الأكواد وتتبع الاستخدام ({filteredCodes.length} من {allCodes.length})
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                تتبع كامل وهوية المستفيد من كل كود للحماية ومكافحة التلاعب
              </p>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center bg-muted/50 p-1 rounded-xl border border-border self-start sm:self-auto">
              <button
                onClick={() => setStatusFilter("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  statusFilter === "all"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                الكل ({allCodes.length})
              </button>
              <button
                onClick={() => setStatusFilter("active")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  statusFilter === "active"
                    ? "bg-card text-green-600 shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                🟢 المتاحة ({activeCodes.length})
              </button>
              <button
                onClick={() => setStatusFilter("used")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  statusFilter === "used"
                    ? "bg-card text-blue-600 shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                🔴 المستخدمة ({usedCodes.length})
              </button>
            </div>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="البحث برقم الكود، اسم المستخدم، رقم الهاتف، رقم العضوية أو البريد..."
              className="w-full pr-10 pl-4 py-2.5 rounded-xl bg-card border border-border text-sm outline-none focus:border-amber-500 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                مسح
              </button>
            )}
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="text-xs text-muted-foreground bg-muted/30 border-b border-border">
                <th className="px-6 py-3.5 font-bold">الكود</th>
                <th className="px-6 py-3.5 font-bold">القيمة</th>
                <th className="px-6 py-3.5 font-bold">الحالة</th>
                <th className="px-6 py-3.5 font-bold">المستخدم المستفيد (تتبع وأمان)</th>
                <th className="px-6 py-3.5 font-bold">تاريخ الإنشاء</th>
                <th className="px-6 py-3.5 font-bold text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-sm">
              {filteredCodes.map((c: any) => {
                const isCodeUsed = Boolean(c.isUsed || c.is_used);
                const user = c.usedByUser;
                const usedAtDate = c.usedAt || c.used_at;
                const createdAtDate = c.createdAt || c.created_at;

                return (
                  <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                    {/* Code Column */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-black text-amber-600 dark:text-amber-400 text-base tracking-wider bg-amber-500/10 px-3 py-1 rounded-lg border border-amber-500/20">
                          {c.code}
                        </span>
                        <button
                          onClick={() => copyToClipboard(c.code, c.id)}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="نسخ الكود"
                        >
                          {copiedCodeId === c.id ? (
                            <Check className="w-4 h-4 text-green-600" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </td>

                    {/* Value Column */}
                    <td className="px-6 py-4">
                      <span className="font-black text-foreground">
                        {Number(c.value || 0).toLocaleString("en-US")} د.ع
                      </span>
                    </td>

                    {/* Status Column */}
                    <td className="px-6 py-4">
                      {isCodeUsed ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20">
                            <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                            تم الاستخدام والشحن
                          </span>
                          {usedAtDate && (
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(usedAtDate).toLocaleString("ar-IQ", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20">
                          <span className="w-2 h-2 rounded-full bg-green-500"></span>
                          نشط (جاهز للشحن)
                        </span>
                      )}
                    </td>

                    {/* User Tracking & Security Info */}
                    <td className="px-6 py-4">
                      {isCodeUsed ? (
                        <div className="space-y-1 bg-muted/40 p-2.5 rounded-xl border border-border">
                          <div className="flex items-center gap-1.5 font-bold text-foreground">
                            <UserCheck className="w-4 h-4 text-blue-600 shrink-0" />
                            <span>{user?.name || "مستخدم مسجل"}</span>
                            {user?.memberNo && (
                              <span className="text-[10px] bg-primary/10 text-primary font-mono px-1.5 py-0.5 rounded">
                                #{user.memberNo}
                              </span>
                            )}
                          </div>
                          {user?.phone && (
                            <div className="text-xs text-muted-foreground font-mono">
                              📱 {user.phone}
                            </div>
                          )}
                          {user?.email && (
                            <div className="text-xs text-muted-foreground font-mono">
                              ✉️ {user.email}
                            </div>
                          )}
                          {!user && (c.usedBy || c.used_by) && (
                            <div className="text-xs text-muted-foreground font-mono">
                              ID: {c.usedBy || c.used_by}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic font-medium">
                          — لم يُستخدم بعد
                        </span>
                      )}
                    </td>

                    {/* Created Date */}
                    <td className="px-6 py-4 text-xs text-muted-foreground">
                      {createdAtDate
                        ? new Date(createdAtDate).toLocaleString("ar-IQ", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "—"}
                    </td>

                    {/* Actions */}
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => copyToClipboard(c.code, c.id)}
                          className="p-2 rounded-xl bg-muted/60 hover:bg-muted text-foreground transition-all hover:scale-105"
                          title="نسخ الكود"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        {!isCodeUsed && (
                          <button
                            onClick={() => {
                              if (confirm(`هل أنت متأكد من حذف الكود ${c.code} نهائياً؟`)) {
                                deleteCodeMutation.mutate(c.id);
                              }
                            }}
                            disabled={deleteCodeMutation.isPending}
                            className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-600 transition-all hover:scale-105"
                            title="إلغاء وحذف الكود غير المستخدم"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredCodes.length === 0 && !isLoading && (
                <tr>
                  <td
                    colSpan={6}
                    className="p-12 text-center text-muted-foreground font-bold space-y-2"
                  >
                    <Coins className="w-10 h-10 mx-auto text-muted-foreground/40" />
                    <div>
                      {search
                        ? "لا توجد أكواد مطابقة لمعايير البحث"
                        : "لا توجد أكواد حتى الآن. قم بتوليد دفعة جديدة لتظهر هنا."}
                    </div>
                  </td>
                </tr>
              )}

              {isLoading && (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-muted-foreground font-bold">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-500 mb-2" />
                    جاري تحميل سجل الأكواد من النظام...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BinanceManagementView() {
  const [activeTab, setActiveTab] = useState<"topups" | "intents" | "logs">("topups");
  const [searchTerm, setSearchTerm] = useState("");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-binance-topups"],
    queryFn: () => adminApi.getBinanceTopups(),
  });

  const topups = data?.topups || [];
  const intents = data?.intents || [];
  const logs = data?.logs || [];

  const totalCreditedUsdt = topups.reduce(
    (acc: number, t: any) => acc + (t.amount_atomic || 0) / 1_000_000,
    0,
  );

  const pendingIntentsCount = intents.filter((i: any) => i.status === "pending").length;

  const filteredTopups = topups.filter(
    (t: any) =>
      t.user_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.transaction_id_masked?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.id?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const filteredIntents = intents.filter(
    (i: any) =>
      i.user_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      i.status?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const filteredLogs = logs.filter(
    (l: any) =>
      l.user_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.intent_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.result?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.rejection_reason?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="p-6 space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Zap className="w-8 h-8 text-amber-500 fill-amber-500" />
            إدارة ومراقبة تعبئة Binance Pay
          </h1>
          <p className="text-xs text-muted-foreground font-medium mt-1">
            سجلات التحقق الآلي والإيداع الفوري عبر Binance Transaction History API
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-border hover:bg-muted/50 rounded-xl text-xs font-bold transition-all shadow-xs"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          تحديث السجلات
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-border shadow-xs">
          <span className="text-[11px] font-bold text-muted-foreground uppercase">
            إجمالي الرصيد المودع
          </span>
          <div className="text-2xl font-black text-emerald-600 mt-1">
            ${totalCreditedUsdt.toFixed(2)}{" "}
            <span className="text-xs font-bold text-zinc-500">USDT</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-border shadow-xs">
          <span className="text-[11px] font-bold text-muted-foreground uppercase">
            العمليات المكتملة
          </span>
          <div className="text-2xl font-black text-zinc-900 mt-1">{topups.length}</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-border shadow-xs">
          <span className="text-[11px] font-bold text-muted-foreground uppercase">
            طلبات جارية (Pending)
          </span>
          <div className="text-2xl font-black text-amber-600 mt-1">{pendingIntentsCount}</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-border shadow-xs">
          <span className="text-[11px] font-bold text-muted-foreground uppercase">
            سجلات التدقيق الأمني
          </span>
          <div className="text-2xl font-black text-blue-600 mt-1">{logs.length}</div>
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("topups")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                activeTab === "topups"
                  ? "bg-zinc-900 text-white shadow-xs"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted"
              }`}
            >
              العمليات الناجحة ({topups.length})
            </button>
            <button
              onClick={() => setActiveTab("intents")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                activeTab === "intents"
                  ? "bg-zinc-900 text-white shadow-xs"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted"
              }`}
            >
              طلبات التعبئة ({intents.length})
            </button>
            <button
              onClick={() => setActiveTab("logs")}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${
                activeTab === "logs"
                  ? "bg-zinc-900 text-white shadow-xs"
                  : "bg-muted/40 text-muted-foreground hover:bg-muted"
              }`}
            >
              سجل التدقيق ({logs.length})
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث بالمعرف أو المستخدم..."
              className="w-full pl-9 pr-3 py-2 bg-white border border-border rounded-xl text-xs font-medium outline-none focus:ring-2 ring-blue-500/20"
            />
          </div>
        </div>

        {/* Tab 1: Top-Ups Table */}
        {activeTab === "topups" && (
          <div className="bg-white rounded-2xl border border-border shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-muted/40 text-muted-foreground font-bold border-b border-border">
                  <tr>
                    <th className="p-3">معرف العملية</th>
                    <th className="p-3">المستخدم</th>
                    <th className="p-3">المبلغ</th>
                    <th className="p-3">رقم العملية (Masked)</th>
                    <th className="p-3">النوع</th>
                    <th className="p-3">تاريخ الإيداع</th>
                    <th className="p-3">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">
                        جاري تحميل البيانات...
                      </td>
                    </tr>
                  ) : filteredTopups.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground font-bold">
                        لا توجد عمليات تعبئة مطابقة
                      </td>
                    </tr>
                  ) : (
                    filteredTopups.map((item: any) => (
                      <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                        <td className="p-3 font-mono font-bold text-zinc-900">{item.id}</td>
                        <td className="p-3 font-mono text-muted-foreground">{item.user_id}</td>
                        <td className="p-3 font-black text-emerald-600">
                          +{(item.amount_atomic / 1_000_000).toFixed(2)} USDT
                        </td>
                        <td className="p-3 font-mono">{item.transaction_id_masked}</td>
                        <td className="p-3 text-muted-foreground">{item.order_type || "C2C"}</td>
                        <td className="p-3 text-muted-foreground font-medium">
                          {item.credited_at
                            ? new Date(item.credited_at).toLocaleString("ar-EG")
                            : "—"}
                        </td>
                        <td className="p-3">
                          <span className="bg-emerald-50 text-emerald-700 font-bold px-2.5 py-1 rounded-full text-[10px]">
                            مكتملة ومقيدة
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Intents Table */}
        {activeTab === "intents" && (
          <div className="bg-white rounded-2xl border border-border shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-muted/40 text-muted-foreground font-bold border-b border-border">
                  <tr>
                    <th className="p-3">معرف الطلب</th>
                    <th className="p-3">المستخدم</th>
                    <th className="p-3">المبلغ المتوقع</th>
                    <th className="p-3">المحاولات</th>
                    <th className="p-3">وقت الإنشاء</th>
                    <th className="p-3">انتهاء الصلاحية</th>
                    <th className="p-3">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">
                        جاري تحميل البيانات...
                      </td>
                    </tr>
                  ) : filteredIntents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground font-bold">
                        لا توجد طلبات تعبئة مطابقة
                      </td>
                    </tr>
                  ) : (
                    filteredIntents.map((intent: any) => (
                      <tr key={intent.id} className="hover:bg-muted/20 transition-colors">
                        <td className="p-3 font-mono font-bold text-zinc-900">{intent.id}</td>
                        <td className="p-3 font-mono text-muted-foreground">{intent.user_id}</td>
                        <td className="p-3 font-black text-zinc-900">
                          {(intent.expected_amount_atomic / 1_000_000).toFixed(2)} USDT
                        </td>
                        <td className="p-3 font-mono">{intent.verify_attempts} / 5</td>
                        <td className="p-3 text-muted-foreground">
                          {new Date(intent.created_at).toLocaleString("ar-EG")}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {new Date(intent.expires_at).toLocaleString("ar-EG")}
                        </td>
                        <td className="p-3">
                          <span
                            className={`font-bold px-2.5 py-1 rounded-full text-[10px] ${
                              intent.status === "credited"
                                ? "bg-emerald-50 text-emerald-700"
                                : intent.status === "pending"
                                  ? "bg-amber-50 text-amber-700"
                                  : intent.status === "expired"
                                    ? "bg-zinc-100 text-zinc-600"
                                    : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {intent.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Security Logs Table */}
        {activeTab === "logs" && (
          <div className="bg-white rounded-2xl border border-border shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-muted/40 text-muted-foreground font-bold border-b border-border">
                  <tr>
                    <th className="p-3">معرف السجل</th>
                    <th className="p-3">المستخدم</th>
                    <th className="p-3">رقم العملية المدخل</th>
                    <th className="p-3">النتيجة</th>
                    <th className="p-3">السبب / التفاصيل</th>
                    <th className="p-3">عنوان IP</th>
                    <th className="p-3">الوقت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">
                        جاري تحميل البيانات...
                      </td>
                    </tr>
                  ) : filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground font-bold">
                        لا توجد سجلات مطابقة
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log: any) => (
                      <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                        <td className="p-3 font-mono font-bold text-zinc-900">{log.id}</td>
                        <td className="p-3 font-mono text-muted-foreground">{log.user_id}</td>
                        <td className="p-3 font-mono">{log.input_transaction_id_masked}</td>
                        <td className="p-3">
                          <span
                            className={`font-bold px-2.5 py-1 rounded-full text-[10px] ${
                              log.result === "credited"
                                ? "bg-emerald-50 text-emerald-700"
                                : log.result === "rejected"
                                  ? "bg-rose-50 text-rose-700"
                                  : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {log.result}
                          </span>
                        </td>
                        <td className="p-3 font-medium text-zinc-700">
                          {log.rejection_reason || "تم التحقق والإيداع بنجاح"}
                        </td>
                        <td className="p-3 font-mono text-muted-foreground">
                          {log.client_ip || "—"}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {new Date(log.created_at).toLocaleString("ar-EG")}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
