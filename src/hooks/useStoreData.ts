import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  readCatalogSnapshot,
  rememberCatalogVersion,
  writeCatalogSnapshot,
} from "@/lib/catalog-cache";

export type StoreData = {
  products?: any[];
  categories?: any[];
  banners?: any[];
  bundles?: any[];
  settings?: Record<string, any>;
  [key: string]: any;
};

/**
 * First-paint snapshot.
 *
 * Now version-stamped (see src/lib/catalog-cache.ts): a snapshot older than the
 * newest catalogue version this browser has seen is refused, so a product the
 * admin just deleted cannot flash back for a frame before the network answers.
 */
function getCachedStoreData(): StoreData | undefined {
  const snapshot = readCatalogSnapshot<StoreData>();
  if (snapshot && Array.isArray(snapshot.products) && snapshot.products.length > 0) {
    return snapshot;
  }
  return undefined;
}

/** Save fresh snapshot in the background, stamped with the version it came from. */
function saveCachedStoreData(data: StoreData, version: number) {
  if (data && Array.isArray(data.products) && data.products.length > 0) {
    // Don't store oversized fields in localStorage
    const compact: StoreData = {
      products: data.products,
      categories: Array.isArray(data.categories) ? data.categories : [],
      banners: Array.isArray(data.banners) ? data.banners : [],
      bundles: Array.isArray(data.bundles) ? data.bundles : [],
      settings: data.settings && typeof data.settings === "object" ? data.settings : {},
    };
    writeCatalogSnapshot(compact, version);
  }
}

// In-flight fetch deduplicator
let inFlightFetch: Promise<StoreData> | null = null;

async function fetchStoreData(): Promise<StoreData> {
  if (inFlightFetch) return inFlightFetch;

  const fetchPromise = (async () => {
    const startTime = Date.now();
    const reqId = `req_${Math.random().toString(36).slice(2, 7)}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8500);

      const res = await fetch("/api/data?slim=1", {
        credentials: "include",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const elapsed = Date.now() - startTime;
      if (elapsed > 2000) {
        console.warn(`[SLOW_REQUEST] /api/data duration=${elapsed}ms reqId=${reqId}`);
      }

      if (!res.ok) {
        throw new Error(`failed_to_load_store_${res.status}`);
      }

      // The catalogue version the server served this payload at. Recorded before
      // anything is cached, so a later snapshot can be judged against it.
      const catalogVersion = Number(res.headers.get("x-catalog-version") || 0) || 0;
      rememberCatalogVersion(catalogVersion);

      const json = (await res.json()) as StoreData;
      if (json && Array.isArray(json.products) && json.products.length > 0) {
        console.log(`[HOME_REFRESH_SUCCESS] reqId=${reqId} duration=${elapsed}ms count=${json.products.length} catalog=${catalogVersion}`);
        saveCachedStoreData(json, catalogVersion);
        return json;
      } else {
        // If the server returned an empty products payload unexpectedly, fallback to cached snapshot
        const cached = getCachedStoreData();
        if (cached && Array.isArray(cached.products) && cached.products.length > 0) {
          console.warn(`[HOME_REFRESH_EMPTY_FALLBACK] Server returned empty payload, retaining local cache.`);
          return cached;
        }
        return json || { products: [], categories: [], banners: [], bundles: [] };
      }
    } catch (err: any) {
      console.warn(`[HOME_REFRESH_FAILED] reqId=${reqId} error=${err?.message}`);
      const cached = getCachedStoreData();
      if (cached && Array.isArray(cached.products) && cached.products.length > 0) {
        console.log("[HOME_CACHE_HIT] Network/DB unavailable, seamlessly serving local cache.");
        return cached;
      }
      throw err;
    }
  })();

  inFlightFetch = fetchPromise;
  // The deduplication bookkeeping is its own promise chain, and a rejected
  // fetch would surface there as an unhandled rejection as well as at the
  // caller. Now that a failed load is retried twice, that is three console
  // errors per outage on top of the one the caller already reports.
  void fetchPromise
    .catch(() => undefined)
    .finally(() => {
      inFlightFetch = null;
    });

  return fetchPromise;
}

/**
 * Single cached read of /api/data for every storefront screen.
 * Employs true Stale-While-Revalidate with localStorage persistence:
 * - Immediately mounts with local cached data if available (0ms delay)
 * - Retains previous data across background revalidations (no flash/empty state)
 * - Validates in background with an 8.5s timeout & automatic fallback
 * - Deduplicates concurrent calls
 */
export function useStoreData() {
  return useQuery<StoreData>({
    queryKey: ["store"],
    queryFn: fetchStoreData,
    initialData: () => getCachedStoreData(),
    placeholderData: (previousData) => previousData,
    staleTime: 0,
    gcTime: 24 * 60 * 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    /*
      A single retry 1.5s later was one attempt short of the fault this hook
      actually meets: the catalogue read is heavy, and when an isolate has no
      warm snapshot the first request can exceed the 8.5s bound above. That
      request keeps running on the server and leaves the snapshot warm, so the
      attempt after it usually returns immediately — but only if there is one.
      Three attempts, spaced 1s then 2s, cover a transient D1 failure and the
      503 the server now sends while it cannot read the catalogue, and still
      settle in well under fifteen seconds before the retry button appears.
    */
    retry: (failureCount) => failureCount < 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 4000),
  });
}

