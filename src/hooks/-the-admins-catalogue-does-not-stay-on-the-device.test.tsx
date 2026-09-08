/**
 * @vitest-environment jsdom
 *
 * The admin's catalogue must not be left on the device.
 *
 * `/api/data` answers admins and shoppers at the same URL, and the two answers
 * are not the same document. The public one goes through `publicStore` —
 * hidden products filtered out, `redactPrivateKeys` run over everything, each
 * variant row rebuilt by `publicProduct`. The admin one skips all three, so it
 * carries hidden products and raw `options`/`types` rows with their `cost` and
 * supplier fields.
 *
 * `useStoreData` wrote whatever came back into `localStorage`, with no check
 * for which of the two it was, and nothing removed it when the admin signed
 * out. On a shared machine the next person's storefront was seeded from the
 * admin's copy.
 *
 * The server already marks those answers `private, no-store`, and the service
 * worker already honours it. These tests hold the last place that did not.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "@/hooks/useAuth";
import { useStoreData } from "@/hooks/useStoreData";
import { readCatalogSnapshot, writeCatalogSnapshot } from "@/lib/catalog-cache";

const logoutMock = vi.fn();
const meMock = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    me: (...a: unknown[]) => meMock(...a),
    logout: (...a: unknown[]) => logoutMock(...a),
    updateProfile: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    sendOtp: vi.fn(),
    verifyOtp: vi.fn(),
  },
}));

/** A product row as the admin branch serves it: hidden, and priced at cost. */
const ADMIN_PRODUCT = {
  id: "p-hidden-1",
  title: "لعبة لم تُنشر بعد",
  price: 25000,
  isHidden: true,
  options: [{ id: "o1", name: "أوفلاين", price: 25000, supplierCost: 9000 }],
};

/** The same catalogue as a shopper gets it: visible, and with no cost in it. */
const PUBLIC_PRODUCT = {
  id: "p-public-1",
  title: "لعبة معروضة",
  price: 25000,
  options: [{ id: "o1", name: "أوفلاين", price: 25000 }],
};

/** The headers the server actually sends on each branch — see src/routes/api/data.ts. */
const ADMIN_HEADERS = {
  "content-type": "application/json",
  "cache-control": "private, no-store",
  "x-catalog-version": "7",
  "x-data-source": "d1:admin",
};
const PUBLIC_HEADERS = {
  "content-type": "application/json",
  "cache-control": "public, max-age=0, s-maxage=5, must-revalidate",
  "x-catalog-version": "7",
  "x-data-source": "d1:public",
};

function answer(products: unknown[], headers: Record<string, string>) {
  return new Response(JSON.stringify({ products, categories: [], banners: [], bundles: [] }), {
    status: 200,
    headers,
  });
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { Wrapper, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the catalogue snapshot in localStorage", () => {
  it("is not written when the answer was the admin's", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer([ADMIN_PRODUCT], ADMIN_HEADERS)),
    );
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useStoreData(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data?.products?.length).toBe(1));

    expect(readCatalogSnapshot()).toBeUndefined();
  });

  it("does not keep a cost or a hidden product anywhere in storage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer([ADMIN_PRODUCT], ADMIN_HEADERS)),
    );
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useStoreData(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data?.products?.length).toBe(1));

    /*
      Read the raw store rather than the parsed snapshot: the point is that
      none of this reaches the disk under any key, not that one reader
      declines to return it.
    */
    const raw = Object.keys(window.localStorage)
      .map((key) => window.localStorage.getItem(key) ?? "")
      .join("\n");
    expect(raw).not.toContain("supplierCost");
    expect(raw).not.toContain("9000");
    expect(raw).not.toContain("لعبة لم تُنشر بعد");
  });

  it("drops a snapshot that is already there when an admin answer arrives", async () => {
    /*
      An admin who signed in before this shipped already has one. A fix that
      only stops new writes leaves the old copy for as long as its version
      stamp keeps it valid.
    */
    writeCatalogSnapshot({ products: [ADMIN_PRODUCT] }, 7);
    expect(readCatalogSnapshot()).toBeTruthy();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer([ADMIN_PRODUCT], ADMIN_HEADERS)),
    );
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useStoreData(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data?.products?.length).toBe(1));

    expect(readCatalogSnapshot()).toBeUndefined();
  });

  it("is still written for a shopper, because first paint depends on it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer([PUBLIC_PRODUCT], PUBLIC_HEADERS)),
    );
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useStoreData(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data?.products?.length).toBe(1));

    const snapshot = readCatalogSnapshot<{ products: { id: string }[] }>();
    expect(snapshot?.products?.[0]?.id).toBe("p-public-1");
  });
});

describe("signing out", () => {
  it("takes the catalogue snapshot with it", async () => {
    meMock.mockResolvedValue({ user: { id: "u-1", name: "المالك" } });
    logoutMock.mockResolvedValue({ ok: true });
    writeCatalogSnapshot({ products: [ADMIN_PRODUCT] }, 7);

    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.user).toBeTruthy());

    await result.current.logout.mutateAsync();

    await waitFor(() => expect(readCatalogSnapshot()).toBeUndefined());
  });

  it("drops the in-memory catalogue too, which outlives the session by a day", async () => {
    meMock.mockResolvedValue({ user: { id: "u-1", name: "المالك" } });
    logoutMock.mockResolvedValue({ ok: true });

    const { Wrapper, client } = wrapper();
    client.setQueryData(["store"], { products: [ADMIN_PRODUCT] });

    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.user).toBeTruthy());

    await result.current.logout.mutateAsync();

    await waitFor(() => expect(client.getQueryData(["store"])).toBeUndefined());
  });

  it("clears even when the logout request itself failed", async () => {
    /* The cookie may already be gone; the cost of clearing anyway is a refetch. */
    meMock.mockResolvedValue({ user: { id: "u-1", name: "المالك" } });
    logoutMock.mockRejectedValue(new Error("network"));
    writeCatalogSnapshot({ products: [ADMIN_PRODUCT] }, 7);

    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.user).toBeTruthy());

    await result.current.logout.mutateAsync().catch(() => undefined);

    await waitFor(() => expect(readCatalogSnapshot()).toBeUndefined());
  });
});
