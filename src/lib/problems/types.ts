/**
 * Content model for the troubleshooting knowledge base.
 *
 * The page never hardcodes a problem. Everything renders from this shape, so
 * adding a problem means adding an entry to `content/problems.json` — no
 * component changes, no layout changes.
 */

import type { ContentImage } from "../content";

export const CATEGORY_IDS = [
  "games",
  "accounts",
  "errors",
  "switch",
  "orders",
  "shipping",
  "hardware",
  "payment",
  "other",
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export interface Category {
  id: CategoryId;
  label: string;
  emoji: string;
}

export type ImageKind = "illustration" | "screenshot" | "error" | "before" | "after" | "step";

export interface ProblemImage {
  /** Path under /public. Bound to one problem only — never shared. */
  src: string;
  /**
   * Optional modern-format variants. When present they are offered ahead of
   * `src`, which stays as the universal fallback. Vector sources (SVG) do not
   * need them.
   */
  avif?: string;
  webp?: string;
  /** Required: describes the image for screen readers. */
  alt: string;
  caption?: string;
  kind: ImageKind;
  width: number;
  height: number;
}

export interface SolutionStep {
  title: string;
  detail?: string;
  /** Optional aside rendered as a tip under the step. */
  hint?: string;
  /*
    Admin-managed picture slots for this step.

    Separate from `images` below, which are files committed to this repository
    with known dimensions. These are declared empty by a shipped entry — the
    screenshot of the error dialog, the button to press — and filled by the
    shop owner from the admin screen. An unfilled slot renders nothing.
  */
  slots?: ContentImage[];
}

export interface Problem {
  /** Stable public ID — also the URL hash, e.g. /problem_solution#LOGIN_001 */
  id: string;
  emoji: string;
  title: string;
  description: string;
  category: CategoryId;
  /** Extra categories this problem should also appear under when filtering. */
  alsoIn?: CategoryId[];
  /** Answers "لماذا تحدث المشكلة؟" */
  cause: string;
  keywords: string[];
  /** Alternative phrasings, including colloquial ones. */
  aliases: string[];
  symptoms: string[];
  images: ProblemImage[];
  /** Admin-managed slots for the problem itself, usually the error screen. */
  slots?: ContentImage[];
  /** What the customer must not do — the part that loses an account. */
  avoid?: string[];
  /** When to stop and ask a person instead of trying again. */
  contactAdminWhen?: string;
  steps: SolutionStep[];
  relatedGames: string[];
  relatedProducts: string[];
  /** Error codes users may literally type, e.g. "2813-0999". */
  relatedErrors: string[];
  arabicKeywords: string[];
  englishKeywords: string[];
  kurdishKeywords: string[];
  /** ID of the canonical solution, for support-bot cross references. */
  solutionId?: string;
  /** Higher shows first when scores tie. */
  priority: number;
  /** Surfaced in the "المشاكل الأكثر شيوعًا" strip. */
  featured?: boolean;
  published: boolean;
}

export const CATEGORIES: Category[] = [
  { id: "games", label: "الألعاب", emoji: "🎮" },
  { id: "accounts", label: "الحسابات", emoji: "🔐" },
  { id: "errors", label: "الأخطاء", emoji: "⚠️" },
  { id: "switch", label: "Nintendo Switch", emoji: "🕹️" },
  { id: "orders", label: "الطلبات", emoji: "📦" },
  { id: "shipping", label: "الشحن", emoji: "🚚" },
  { id: "hardware", label: "Hardware", emoji: "🛠️" },
  { id: "payment", label: "الدفع", emoji: "💳" },
  { id: "other", label: "مشاكل أخرى", emoji: "❓" },
];

export const CATEGORY_MAP: Record<CategoryId, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, Category>;

/** Every category a problem belongs to, primary first. */
export function problemCategories(problem: Problem): CategoryId[] {
  return [problem.category, ...(problem.alsoIn ?? [])];
}
