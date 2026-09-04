import { createFileRoute } from "@tanstack/react-router";
import AppShell from "../components/AppShell";
import { ProblemSolutionView } from "@/components/problem-solution/problem-solution-view";
import { getPublishedProblems } from "@/lib/problems/repository";
import { applyProblemOverrides, countCategories } from "@/lib/problems/merge";
import { loadSiteContent } from "@/lib/content.functions";
import type { Problem } from "@/lib/problems/types";

export const Route = createFileRoute("/problem")({
  head: () => ({
    meta: [
      { title: "حلول المشاكل — بنانا ستور" },
      {
        name: "description",
        content: "دليل تفاعلي لحل أشهر مشاكل تسجيل الدخول ورمز التحقق والتحميل وتشغيل الألعاب.",
      },
      { property: "og:title", content: "حلول المشاكل — بنانا ستور" },
      { property: "og:type", content: "website" },
    ],
  }),
  /*
    A help page is the last thing that may be down.

    This loader used to be two awaits with nothing around them, and it answered
    500 with an empty body in production for every visitor — the state a
    customer reaches precisely when something has already gone wrong for them.
    Whatever fails here, the page still renders: the shipped troubleshooting
    entries survive an unreadable store, and an unreadable content document
    costs the admin's overrides rather than the whole page.
  */
  loader: async () => {
    let base: Problem[] = [];
    try {
      base = await getPublishedProblems();
    } catch (error) {
      console.error("[problem:shipped_entries_unreadable]", error);
    }

    let overrides: Awaited<ReturnType<typeof loadSiteContent>>["problems"] = [];
    try {
      overrides = (await loadSiteContent()).problems ?? [];
    } catch (error) {
      console.error("[problem:overrides_unreadable]", error);
    }

    let problems = base;
    try {
      problems = applyProblemOverrides(base, overrides ?? []);
    } catch (error) {
      console.error("[problem:overrides_unmergeable]", error);
    }

    return { problems, counts: countCategories(problems) };
  },
  component: ProblemPage,
});

export function ProblemPage() {
  const { problems, counts } = Route.useLoaderData();

  return (
    <AppShell currentView="problem">
      <ProblemSolutionView problems={problems} counts={counts} />
    </AppShell>
  );
}
