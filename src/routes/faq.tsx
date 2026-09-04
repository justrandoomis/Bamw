import { createFileRoute } from "@tanstack/react-router";

import PageHeader from "@/components/PageHeader";
import { FaqView } from "@/components/faq/FaqView";
import { loadSiteContent } from "@/lib/content.functions";
import {
  mergeFaq,
  shippedFaqCategories,
  shippedFaqItems,
} from "@/lib/siteFaq";
import type { FaqCategory, FaqItem } from "@/lib/content";

export const Route = createFileRoute("/faq")({
  head: ({ loaderData }) => ({
    meta: [
      { title: "الأسئلة الشائعة — بنانا ستور" },
      {
        name: "description",
        content:
          "أجوبة قصيرة عن الخيار والإصدار وتسجيل الدخول ورمز التحقق والتحميل والتشغيل والضمان.",
      },
      { property: "og:title", content: "الأسئلة الشائعة — بنانا ستور" },
      { property: "og:type", content: "website" },
    ],
    scripts: loaderData?.items?.length
      ? [
          {
            type: "application/ld+json",
            /*
              Only what is already on the page, and only text the shop wrote
              for the public. No customer data can reach here: these questions
              come from the shipped file and the admin's own edits.
            */
            children: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: loaderData.items.slice(0, 30).map((item) => ({
                "@type": "Question",
                name: item.question_ar,
                acceptedAnswer: { "@type": "Answer", text: item.answer_ar },
              })),
            }),
          },
        ]
      : [],
  }),
  /*
    Shipped questions first, the shop's own over them.

    `mergeContent` takes `faq` from the store whenever the key is an array, so
    the first admin save would have deleted every shipped question. Merging by
    id lets an admin rewrite an answer, add a question, reorder or unpublish
    one — and lets a release add questions without touching any of that.
  */
  loader: async () => {
    let storedItems: FaqItem[] = [];
    let storedCategories: FaqCategory[] = [];
    try {
      const content = await loadSiteContent();
      storedItems = content.faq ?? [];
      storedCategories = content.faqCategories ?? [];
    } catch (error) {
      console.error("[faq:store_unreadable]", error);
    }

    return {
      categories: mergeFaq(shippedFaqCategories(), storedCategories),
      items: mergeFaq(shippedFaqItems(), storedItems),
    };
  },
  component: FaqPage,
});

function FaqPage() {
  const { categories, items } = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-background">
      <PageHeader />
      <FaqView categories={categories} items={items} />
    </div>
  );
}
