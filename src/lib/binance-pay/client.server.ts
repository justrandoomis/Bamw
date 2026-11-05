import { getBinanceConfig } from "./config.server";
import { signBinanceQuery } from "./crypto.server";
import type { BinancePayApiResponse, BinancePayTransaction } from "./types";
import { joinShared } from "../shared-wait.server";

interface CacheEntry {
  data: BinancePayTransaction[];
  timestamp: number;
}

const CACHE_TTL_MS = 30_000; // 30 seconds cache TTL
const cache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<BinancePayTransaction[]>>();

/**
 * Normalizes time intervals to 10-second buckets to improve cache hits and coalescing.
 */
function getCacheKey(startTimestamp: number, endTimestamp: number): string {
  const bucketStart = Math.floor(startTimestamp / 10_000) * 10_000;
  const bucketEnd = Math.ceil(endTimestamp / 10_000) * 10_000;
  return `${bucketStart}_${bucketEnd}`;
}

/**
 * Cleans up expired cache entries.
 */
function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS * 2) {
      cache.delete(key);
    }
  }
}

/**
 * Fetches transaction history from Binance Pay API with caching and single-flight coalescing.
 */
export async function fetchBinancePayTransactions(
  startTimestamp: number,
  endTimestamp: number,
  forceFresh = false,
): Promise<BinancePayTransaction[]> {
  const config = getBinanceConfig();

  if (!config.apiKey || !config.apiSecret) {
    throw new Error("BINANCE_API_KEYS_NOT_CONFIGURED");
  }

  const cacheKey = getCacheKey(startTimestamp, endTimestamp);
  const now = Date.now();

  if (!forceFresh) {
    const cached = cache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  // Check in-flight deduplication — bounded, because the request that started
  // it may have been cancelled with its fetch (see shared-wait.server.ts).
  const existingFlight = inFlightRequests.get(cacheKey);
  if (existingFlight) {
    return joinShared(existingFlight, {
      label: "binance-pay:transactions",
      waitMs: 12_000,
      restart: () => {
        if (inFlightRequests.get(cacheKey) === existingFlight) inFlightRequests.delete(cacheKey);
        return fetchBinancePayTransactions(startTimestamp, endTimestamp, forceFresh);
      },
    });
  }

  // A holder, so the `finally` below can compare against this attempt safely.
  const own: { promise?: Promise<BinancePayTransaction[]> } = {};
  const flightPromise: Promise<BinancePayTransaction[]> = (own.promise = (async () => {
    try {
      const serverTimestamp = Date.now();
      const recvWindow = 5000;

      // Construct query parameters strictly in order
      const params = new URLSearchParams();
      params.append("startTimestamp", String(Math.floor(startTimestamp)));
      params.append("endTimestamp", String(Math.floor(endTimestamp)));
      params.append("limit", "100");
      params.append("recvWindow", String(recvWindow));
      params.append("timestamp", String(serverTimestamp));

      const queryString = params.toString();
      const signature = await signBinanceQuery(queryString, config.apiSecret);

      const requestUrl = `https://api.binance.com/sapi/v1/pay/transactions?${queryString}&signature=${signature}`;

      const controller = new AbortController();
      const timeoutTimer = setTimeout(() => controller.abort(), 9000);

      let response: Response;
      try {
        response = await fetch(requestUrl, {
          method: "GET",
          headers: {
            "X-MBX-APIKEY": config.apiKey,
            Accept: "application/json",
            "User-Agent": "Bananto-TopUp-Worker/1.0",
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutTimer);
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        console.error(
          `[BinancePay] Upstream HTTP error ${response.status}: ${errorBody.slice(0, 200)}`,
        );
        if (response.status === 401 || response.status === 403) {
          throw new Error("BINANCE_AUTH_FAILED");
        }
        if (response.status === 429) {
          throw new Error("BINANCE_RATE_LIMITED");
        }
        throw new Error(`BINANCE_UPSTREAM_ERROR_${response.status}`);
      }

      const json = (await response.json()) as BinancePayApiResponse;

      if (json.code !== "000000" && json.code !== "0") {
        console.error(
          `[BinancePay] Business error response code=${json.code} msg=${json.message || "none"}`,
        );
        throw new Error(`BINANCE_BUSINESS_ERROR_${json.code}`);
      }

      const txList = Array.isArray(json.data) ? json.data : [];

      // Save to cache
      cache.set(cacheKey, {
        data: txList,
        timestamp: Date.now(),
      });
      pruneCache();

      return txList;
    } finally {
      // Only this attempt's own entry: a joiner may already have replaced it.
      if (inFlightRequests.get(cacheKey) === own.promise) inFlightRequests.delete(cacheKey);
    }
  })());

  inFlightRequests.set(cacheKey, flightPromise);
  return flightPromise;
}
