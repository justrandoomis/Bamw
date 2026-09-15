import { useNavigate, useRouter } from "@tanstack/react-router";

import { useStoreData } from "@/hooks/useStoreData";
import Header from "./Header";

const viewToPath: Record<string, string> = {
  home: "/",
  store: "/",
  market: "/banana_market",
  chats: "/chat",
  cart: "/cart",
  profile: "/profile",
  wallet: "/wallet",
  admin: "/admin",
};

/**
 * Floating back + profile menu for pages that are not wrapped in AppShell.
 * The header itself is pointer-events-none, so it never blocks page content.
 */
export default function PageHeader({ view = "page" }: { view?: string }) {
  const navigate = useNavigate();
  const router = useRouter();
  /*
    The catalogue, so the search box in this header has something to search.

    It was constructed without it, which was invisible while the box only
    rendered on the home page — `AppShell` passes the products there. Now that
    the box is on every page, a header with no catalogue would draw a search
    field that silently answers nothing, which is worse than the spacer it
    replaced. React Query serves the same cached `["store"]` entry the rest of
    the app already holds, so this costs no extra request.
  */
  const { data: store } = useStoreData();

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.history.back();
      return;
    }
    void navigate({ to: "/" });
  };

  const handleNavigate = (target: string) => {
    if (target.startsWith("product/")) {
      const id = target.split("/")[1] ?? "";
      void navigate({ to: "/product/$productId", params: { productId: id } });
      return;
    }
    void navigate({ to: viewToPath[target] ?? "/" });
  };

  return (
    <Header
      currentView={view}
      onBack={handleBack}
      onNavigate={handleNavigate}
      products={store?.products ?? []}
    />
  );
}
