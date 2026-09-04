"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import type { FaqCategory, FaqItem } from "@/lib/content";
import { faqMoreHref } from "@/lib/siteFaq";

/**
 * Short answers, and a link to whoever owns the long one.
 *
 * The FAQ is the page a customer opens first, so it answers in three sentences
 * and then points at the guide or the policy clause that owns the subject.
 * Writing the full answer here as well would mean two copies of every rule,
 * and the copy nobody remembers to update is the one a customer reads.
 *
 * Every question is a `<details>`. Closed content is still in the document, so
 * the browser's own find-in-page reaches it and so does a search engine —
 * which a div toggled by React state does not, and this page's whole job is
 * being findable.
 */
export function FaqView({
  categories,
  items,
}: {
  categories: FaqCategory[];
  items: FaqItem[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== "all" && item.category_id !== category) return false;
      if (!needle) return true;
      return `${item.question_ar} ${item.answer_ar} ${item.keywords ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [items, query, category]);

  const grouped = useMemo(() => {
    return categories
      .map((entry) => ({
        category: entry,
        questions: visible.filter((item) => item.category_id === entry.id),
      }))
      .filter((group) => group.questions.length > 0);
  }, [categories, visible]);

  /* Questions whose category was deleted still have to appear somewhere. */
  const orphans = visible.filter(
    (item) => !categories.some((entry) => entry.id === item.category_id),
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-black leading-tight text-foreground sm:text-3xl">
          الأسئلة الشائعة
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          أجوبة قصيرة، ورابط للشرح الكامل في الدليل أو السياسة.
        </p>
      </header>

      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث عن سؤال…"
          aria-label="ابحث في الأسئلة الشائعة"
          className="w-full rounded-xl border border-border bg-card py-2.5 pe-10 ps-3 text-sm outline-none focus:border-primary"
        />
      </div>

      {categories.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <Chip active={category === "all"} onClick={() => setCategory("all")}>
            الكل
          </Chip>
          {categories.map((entry) => (
            <Chip
              key={entry.id}
              active={category === entry.id}
              onClick={() => setCategory(entry.id)}
            >
              {entry.name_ar}
            </Chip>
          ))}
        </div>
      )}

      {grouped.length === 0 && orphans.length === 0 && (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          لا يوجد سؤال يطابق بحثك.
        </p>
      )}

      <div className="space-y-8">
        {grouped.map((group) => (
          <section key={group.category.id}>
            <h2 className="mb-2 text-sm font-black text-foreground">{group.category.name_ar}</h2>
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {group.questions.map((item) => (
                <Answer key={item.id} item={item} />
              ))}
            </div>
          </section>
        ))}

        {orphans.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-black text-foreground">أسئلة أخرى</h2>
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {orphans.map((item) => (
                <Answer key={item.id} item={item} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Answer({ item }: { item: FaqItem }) {
  const more = faqMoreHref(item);
  return (
    <details id={item.id} className="group scroll-mt-24 px-4 py-3">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 text-sm font-bold text-foreground marker:content-['']">
        <span className="min-w-0">{item.question_ar}</span>
        <ChevronLeft
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:-rotate-90"
          aria-hidden
        />
      </summary>
      <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.answer_ar}</div>
      {more && (
        <a
          href={more}
          className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
        >
          الشرح الكامل
          <ChevronLeft className="h-3 w-3" aria-hidden />
        </a>
      )}
    </details>
  );
}
