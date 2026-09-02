import { createFileRoute } from "@tanstack/react-router";
import AppShell from "../components/AppShell";
import { ProblemSolutionView } from "@/components/problem-solution/problem-solution-view";
import { getPublishedProblems } from "@/lib/problems/repository";
import { applyProblemOverrides, countCategories } from "@/lib/problems/merge";
import { loadSiteContent } from "@/lib/content.functions";

export const Route = createFileRoute("/problem")({
  head: () => ({
    meta: [
      { title: "حلول المشاكل" },
      { name: "description", content: "دليل تفاعلي لحل أشهر المشاكل" },
    ],
  }),
  loader: async () => {
    const [base, content] = await Promise.all([getPublishedProblems(), loadSiteContent()]);
    const problems = applyProblemOverrides(base, content.problems ?? []);
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
