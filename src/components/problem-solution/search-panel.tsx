"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The page's primary control. Sticks under the site header once the user
 * scrolls past it and shrinks slightly so it never eats the viewport on a
 * phone.
 */
export function SearchPanel({
  value,
  onChange,
  resultCount,
}: {
  value: string;
  onChange: (value: string) => void;
  /** null when no search is active. */
  resultCount: number | null;
}) {
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The sentinel sits just above the sticky element; once it leaves the top of
  // the viewport we know the panel has stuck.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(([entry]) => setStuck(!entry?.isIntersecting), {
      rootMargin: "-64px 0px 0px 0px",
      threshold: 1,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // "/" focuses search from anywhere, unless the user is already typing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      const active = document.activeElement;
      const isTyping =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (isTyping) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      <div
        className={`sticky top-[var(--header-h)] z-40 -mx-4 px-4 py-3 transition-[background-color,box-shadow,backdrop-filter] duration-300 sm:-mx-6 sm:px-6 ${
          stuck
            ? "border-b border-border/80 bg-background/90 shadow-soft backdrop-blur-md"
            : "border-b border-transparent"
        }`}
      >
        <form
          role="search"
          onSubmit={(event) => event.preventDefault()}
          className="mx-auto w-full max-w-3xl"
        >
          <label htmlFor="problem-search" className="sr-only">
            ابحث عن مشكلتك
          </label>

          <div
            className={`group relative flex items-center gap-3 rounded-pill border-2 border-border bg-card shadow-card transition-[border-color,box-shadow,padding] duration-300 ease-out-soft focus-within:border-primary focus-within:shadow-glow hover:border-primary ${
              stuck ? "px-4 py-2" : "px-5 py-3"
            }`}
          >
            <span
              aria-hidden
              className={`shrink-0 transition-[font-size] duration-300 ${
                stuck ? "text-xl" : "text-2xl"
              }`}
            >
              🔍
            </span>

            <input
              ref={inputRef}
              id="problem-search"
              type="search"
              inputMode="search"
              autoComplete="off"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="ابحث عن مشكلتك… مثال: الحساب ما يدخل"
              aria-describedby="search-hint"
              className={`min-w-0 flex-1 bg-transparent font-display font-bold text-foreground placeholder:font-normal placeholder:text-muted-foreground/60 focus:outline-none ${
                stuck ? "py-1 text-base" : "py-1.5 text-lg sm:text-xl"
              }`}
            />

            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  inputRef.current?.focus();
                }}
                aria-label="مسح البحث"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-pill text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4.5 w-4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}

            <kbd
              aria-hidden
              className="ltr hidden shrink-0 rounded-lg border border-border bg-background px-2 py-1 font-mono text-xs text-muted-foreground sm:block"
            >
              /
            </kbd>
          </div>

          <p id="search-hint" className="sr-only">
            البحث يعمل أثناء الكتابة، ويدعم العربية والإنجليزية والكردية والكلمات العامية والأخطاء
            الإملائية.
          </p>

          {/* Live region: announces result counts to screen readers. */}
          <p aria-live="polite" className="sr-only">
            {resultCount === null
              ? ""
              : resultCount === 0
                ? "لم نجد نتائج مطابقة"
                : `وجدنا ${resultCount} حلًا`}
          </p>
        </form>
      </div>
    </>
  );
}
