import { createFileRoute } from "@tanstack/react-router";

import PageHeader from "@/components/PageHeader";
import { PolicyView } from "@/components/policy/PolicyView";
import { loadSiteContent } from "@/lib/content.functions";
import { resolvePolicy } from "@/lib/sitePolicy";
import { stripAdminNotes, type PolicyData } from "@/lib/content";

export const Route = createFileRoute("/policy")({
  head: () => ({
    meta: [
      { title: "سياسة المتجر — بنانا ستور" },
      {
        name: "description",
        content: "الشروط والحقوق وضمان الحظر وسياسة الاسترجاع والاستخدام الصحيح لحساب اللعبة.",
      },
      { property: "og:title", content: "سياسة المتجر — بنانا ستور" },
      { property: "og:type", content: "article" },
    ],
  }),
  /*
    The shipped clauses, with whatever the shop has written laid over them.

    `mergeContent` spreads the stored policy over the default, so a store
    holding a `sections` array replaces the shipped one wholesale — the first
    admin save would have deleted every clause written here, the warranty
    included. Merging by id keeps both, and keeps this page from being the one
    place a customer cannot reach when the store is unreadable.
  */
  loader: async () => {
    let stored: PolicyData | undefined;
    try {
      stored = (await loadSiteContent()).policy;
    } catch (error) {
      console.error("[policy:store_unreadable]", error);
    }
    // Admin-only slot notes never enter the hydration payload.
    return { policy: stripAdminNotes(resolvePolicy(stored)) };
  },
  component: PolicyPage,
});

function PolicyPage() {
  const { policy } = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-background">
      <PageHeader />
      <PolicyView policy={policy} />
    </div>
  );
}
