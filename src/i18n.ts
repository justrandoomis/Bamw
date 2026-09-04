import { create } from "zustand";

import {
  DEFAULT_LOCALE,
  isLocale,
  loadKeyedDictionary,
  plural as pluralOf,
  translate,
  type Locale,
  type TranslationKey,
} from "./lib/i18n";
import { dirOf, isLang, writeManualLanguage, type Lang } from "./lib/prefs";

type Language = Lang;

interface I18nStore {
  lang: Language;
  /** Bumped when a language pack finishes loading, to re-render with the new copy. */
  assetsVersion: number;
  setLang: (lang: Language) => void;
  t: (key: string) => string;
}

/**
 * Dictionary keyed by the Arabic source string, so any untranslated literal
 * still renders correctly (the key itself is the Arabic copy).
 *
 * Turkish lives in `src/i18n.tr.ts` and is merged in below, which keeps this
 * (already long) table readable and its existing entries untouched.
 */

function initialLang(): Language {
  if (typeof document === "undefined") return "ar";
  const match = /(?:^|;\s*)bananto_lang_manual=([^;]+)/.exec(document.cookie);
  const manual = match?.[1];
  const langMatch = /(?:^|;\s*)bananto_lang=([^;]+)/.exec(document.cookie);
  const langValue = langMatch?.[1];
  
  if (manual === "1" && isLang(langValue)) return langValue;
  return "ar"; // Default to Arabic if not manually selected
}

/** Kurdish predates the key-based dictionaries; it reads Arabic there. */
function toLocale(lang: Language): Locale {
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}

/* ------------------------- on-demand language assets ------------------------ */

type LegacyTable = Record<string, { en: string; ku: string; tr?: string }>;

/**
 * Non-Arabic copy is fetched on demand.
 *
 * Arabic keys are the Arabic copy, so `t()` short-circuits before touching this
 * table and an Arabic shopper never downloads the English, Kurdish and Turkish
 * strings at all. `ensureLanguageAssets()` is awaited by the root route loader
 * on both the server and the client, so a non-Arabic visitor has the copy in
 * hand before the first render — no flash of untranslated text.
 */
let legacyTable: LegacyTable = {};
const languageAssets = new Map<Language, Promise<void>>();

export function ensureLanguageAssets(lang: Language): Promise<void> {
  if (lang === "ar") return Promise.resolve();
  let pending = languageAssets.get(lang);
  if (!pending) {
    pending = Promise.all([
      import("./i18n.data").then((mod) => {
        legacyTable = mod.translations;
      }),
      loadKeyedDictionary(toLocale(lang)),
    ])
      .then(() => undefined)
      .catch((error) => {
        // Falling back to Arabic copy is survivable; a hard failure is not.
        console.error("[i18n] failed to load language assets", error);
        languageAssets.delete(lang);
      });
    languageAssets.set(lang, pending);
  }
  return pending;
}

export const useI18n = create<I18nStore>((set, get) => ({
  lang: initialLang(),
  assetsVersion: 0,
  setLang: (lang) => {
    writeManualLanguage(lang);
    // Switching language at runtime needs the pack too. Nothing awaits this:
    // the store already holds the new language, and the tree remounts again
    // when the copy lands, so the switch is never blocked on the network.
    void ensureLanguageAssets(lang).then(() => {
      if (get().lang === lang) set({ assetsVersion: get().assetsVersion + 1 });
    });
    // RootInner already remounts the rendered route when this state changes.
    // Reloading the document here caused an infinite loop for signed-in users:
    // ThemeApplier restored the profile language after every reload, which
    // immediately reloaded the page again over the session-check screen.
    if (get().lang !== lang) set({ lang });
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
      document.documentElement.dir = dirOf(lang);
    }
  },
  t: (key) => {
    const lang = get().lang;
    if (lang === "ar") return key;
    // Arabic source string is the key, so an untranslated literal still reads
    // correctly rather than showing a blank or a dotted path.
    return legacyTable[key]?.[lang] || legacyTable[key]?.["en"] || key;
  },
}));

/**
 * Render-time translation without a hook. The whole tree is remounted when the
 * language changes (see src/routes/__root.tsx), so reading the store directly
 * stays in sync.
 */
export function tr(key: string) {
  return useI18n.getState().t(key);
}

/**
 * The active language, read the same way {@link tr} reads its copy.
 *
 * `useI18n((s) => s.lang)` is the wrong tool during server rendering: the store
 * hook resolves through React's server snapshot, which is the value the store
 * was created with rather than the one it holds now — so a page rendered for an
 * English reader picked its *content* fields with "ar" while its chrome, which
 * goes through `t()` and reads `getState()`, came out in English. Half a
 * translated page is harder to notice than none of one.
 *
 * Reading the store directly is safe for the same reason `tr` is: the whole
 * tree remounts when the language changes (see `src/routes/__root.tsx`).
 */
export function currentLang(): Language {
  return useI18n.getState().lang;
}

/* --------------------------- key-based translation -------------------------- */

/**
 * Contextual, typed translation: `t("product.addToCart")`.
 *
 * Prefer this over `tr("أضف إلى السلة")` in new code — the key carries the
 * context, so "Order" as a purchase and "Order" as a sort position never
 * collapse into the same string. Typos are compile errors.
 *
 * Reads the store directly rather than through a hook because the whole tree is
 * remounted when the language changes (see `src/routes/__root.tsx`), exactly
 * like `tr()` above.
 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  return translate(toLocale(useI18n.getState().lang), key, vars);
}

/** Plural-aware counter: `count("counts.products", 2)` → "منتجان" / "2 products". */
export function count(
  baseKey: string,
  value: number,
  vars?: Record<string, string | number>,
): string {
  return pluralOf(toLocale(useI18n.getState().lang), baseKey, value, vars);
}

/** Current locale for the key-based dictionaries (Kurdish resolves to Arabic). */
export function currentLocale(): Locale {
  return toLocale(useI18n.getState().lang);
}

/**
 * Hook form for components that should re-render on a language change without
 * relying on the root remount (modals rendered in a portal, for example).
 */
export function useTranslation() {
  const lang = useI18n((s) => s.lang);
  const locale = toLocale(lang);
  return {
    locale,
    lang,
    dir: dirOf(lang),
    t: (key: TranslationKey, vars?: Record<string, string | number>) =>
      translate(locale, key, vars),
    count: (baseKey: string, value: number, vars?: Record<string, string | number>) =>
      pluralOf(locale, baseKey, value, vars),
  };
}

export type { Locale, TranslationKey };
