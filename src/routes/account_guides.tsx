import { createFileRoute } from "@tanstack/react-router";

import PageHeader from "@/components/PageHeader";
import { GuidesView } from "@/components/account-guides/GuidesView";
import { loadSiteContent } from "@/lib/content.functions";
import { applyGuideOverrides, shippedGuides } from "@/lib/siteGuides";
import { stripAdminNotes, type GuideItem } from "@/lib/content";

export const Route = createFileRoute("/account_guides")({
  head: () => ({
    meta: [
      { title: "دليل الحساب والتشغيل — بنانا ستور" },
      {
        name: "description",
        content:
          "خطوات تسجيل الدخول ورمز التحقق وOnline License وتحميل اللعبة وتشغيلها بخيار Offline أو Online.",
      },
      { property: "og:title", content: "دليل الحساب والتشغيل — بنانا ستور" },
      { property: "og:type", content: "article" },
    ],
  }),
  /*
    The shipped manual first, the admin's edits over it.

    `mergeContent` reads `guides` from the store whenever the key is an array,
    so the first time an admin saved one guide every shipped guide would have
    disappeared — a release that looks like it deleted the manual. Reading both
    and matching by id is the same shape the troubleshooting entries already
    use, and it means an edit survives the next deploy and a deploy survives
    the last edit.

    Neither source may take the page down: a customer sent here from a
    delivery card has already been told this is where the answer is.
  */
  loader: async () => {
    let base: GuideItem[] = [];
    try {
      base = shippedGuides();
    } catch (error) {
      console.error("[guides:shipped_unreadable]", error);
    }

    let overrides: GuideItem[] = [];
    try {
      overrides = (await loadSiteContent()).guides ?? [];
    } catch (error) {
      console.error("[guides:overrides_unreadable]", error);
    }

    /*
      Stripped here, at the boundary where this becomes public. A loader's
      return value is serialised into the page for hydration, so the note
      saying which screenshot belongs in a slot would travel to every visitor
      inside the JSON even though no element prints it.
    */
    try {
      return { guides: stripAdminNotes(applyGuideOverrides(base, overrides)) };
    } catch (error) {
      console.error("[guides:unmergeable]", error);
      return { guides: stripAdminNotes(base) };
    }
  },
  component: GuidesPage,
});

function GuidesPage() {
  const { guides } = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-background">
      <PageHeader />
      <GuidesView guides={guides} />
    </div>
  );
}
