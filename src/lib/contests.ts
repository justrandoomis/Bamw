/**
 * Contests — what the member's screen and the admin's screen share.
 *
 *   «إضافة قسم المسابقات وإدارة كاملة من صفحة الإدارة ... الدخول للمسابقة ممكن
 *    أن يكون مجاني أو عن طريق الموز أو عن طريق التذاكر التي ينشئها الأدمن ...
 *    أو عن طريق رابط الإحالة»
 *
 * A contest is a game the shop gives away. Members hold TICKETS in it — one
 * for joining free, one per entry bought with bananas, one per code the admin
 * handed them, one per friend they brought — and the draw picks tickets. The
 * winner's game lands in «ألعابك» beside the roulette's, and is imported the
 * same way: a zero-price gift order that opens its own chat.
 *
 * Nothing in this file touches storage; the server's half is
 * `contests.server.ts`.
 */

import { DEFAULT_IG_FILTERS, type IgFilters } from "./instagramComments";

export type ContestEntryMethod = "free" | "bananas" | "ticket" | "referral";

/**
 * Where the winners come from: tickets members hold on the site, or the
 * comments under the contest's Instagram post.
 */
export type ContestDrawSource = "site" | "instagram";

export const CONTEST_ENTRY_METHODS: readonly ContestEntryMethod[] = [
  "free",
  "bananas",
  "ticket",
  "referral",
];

export const ENTRY_METHOD_LABELS: Record<ContestEntryMethod, string> = {
  free: "مجاني",
  bananas: "بالموز",
  ticket: "بتذكرة",
  referral: "بالإحالة",
};

/** What the admin set: draft until published, then open, closed, drawn — or cancelled. */
export type ContestStatus = "draft" | "open" | "closed" | "drawn" | "cancelled";

/** What a member sees, with the clock applied to `open`. */
export type ContestPhase = "draft" | "upcoming" | "open" | "ended" | "drawn" | "cancelled";

export const PHASE_LABELS: Record<ContestPhase, string> = {
  draft: "مسودة",
  upcoming: "قريباً",
  open: "مفتوحة",
  ended: "انتهت — بانتظار السحب",
  drawn: "تم السحب",
  cancelled: "أُلغيت",
};

/** A friend counts once they sign up, or only once they buy — the admin's choice. */
export type ReferralQualifier = "signup" | "purchase";

/** Everything the admin decides about a contest. */
export interface ContestSettings {
  title: string;
  /** the story of the contest, and anything else the admin wants to say */
  description: string;
  /** the steps, one per line: «علّق على المنشور», «شارك المنشور ستوري», … */
  conditions: string[];
  /** the Instagram post the conditions point at */
  instagramUrl: string;
  /** the game given away, from the catalogue */
  productId: string;
  prizeTitle: string;
  prizeImage: string;
  /** which edition or account type, in words: «حساب أوفلاين», «النسخة الكاملة» */
  prizeNote: string;
  winnersCount: number;
  /** backups drawn with the winners, promoted if a winner is disqualified */
  alternatesCount: number;
  entryMethods: ContestEntryMethod[];
  /** bananas per ticket, when bananas are an entry method */
  bananaCost: number;
  /** tickets one member may hold, all methods together */
  maxEntriesPerUser: number;
  /** members who may take part at all; 0 is no limit */
  maxParticipants: number;
  referralQualifier: ReferralQualifier;
  /** entry needs a linked Telegram, so a winner can be told */
  requireTelegram: boolean;
  /** entry needs this many completed orders: a customers-only contest */
  minCompletedOrders: number;
  /** entry needs an account at least this old: a guard against fresh fakes */
  minAccountAgeDays: number;
  /** ISO; empty opens on publishing */
  startsAt: string;
  /** ISO; empty ends only when the admin ends it */
  endsAt: string;
  /** draw by itself the moment `endsAt` passes */
  autoDraw: boolean;
  /** several tickets raise a chance, never the number of prizes */
  oneWinPerUser: boolean;
  /** winners wait for the admin's confirmation before the game is theirs */
  requireConfirmation: boolean;
  /** show members how many have entered */
  showEntrants: boolean;
  drawSource: ContestDrawSource;
  /** the rules a comment must meet, when the draw is from Instagram */
  igFilters: IgFilters;
}

export const DEFAULT_CONTEST_SETTINGS: ContestSettings = {
  title: "",
  description: "",
  conditions: [],
  instagramUrl: "",
  productId: "",
  prizeTitle: "",
  prizeImage: "",
  prizeNote: "",
  winnersCount: 1,
  alternatesCount: 2,
  entryMethods: ["free"],
  bananaCost: 0,
  maxEntriesPerUser: 1,
  maxParticipants: 0,
  referralQualifier: "purchase",
  requireTelegram: false,
  minCompletedOrders: 0,
  minAccountAgeDays: 0,
  startsAt: "",
  endsAt: "",
  autoDraw: true,
  oneWinPerUser: true,
  requireConfirmation: false,
  showEntrants: true,
  drawSource: "site",
  igFilters: DEFAULT_IG_FILTERS,
};

/** Limits the server holds the settings to. */
export const CONTEST_LIMITS = {
  title: 120,
  description: 4000,
  conditions: 12,
  condition: 240,
  winners: 50,
  alternates: 20,
  entriesPerUser: 100,
  bananaCost: 1_000_000,
  ticketsPerBatch: 200,
} as const;

/** A winner as the public sees one: the ticket, and a name only as much as the member allows. */
export interface ContestWinnerView {
  position: number;
  entryNo: number | null;
  /** a member's display name, partly hidden; or an Instagram account */
  name: string;
  source: "site" | "instagram";
  status: "pending" | "confirmed" | "disqualified";
}

/** The published proof of a draw: enough to re-run it. */
export interface ContestDrawProof {
  algorithm: string;
  seed: string;
  poolDigest: string;
  poolSize: number;
  drawnAt: string;
}

/** A contest as a member sees it. */
export interface ContestView {
  id: string;
  drawSource: ContestDrawSource;
  title: string;
  description: string;
  conditions: string[];
  instagramUrl: string;
  prize: { productId: string; title: string; image: string; note: string };
  winnersCount: number;
  entryMethods: ContestEntryMethod[];
  bananaCost: number;
  maxEntriesPerUser: number;
  maxParticipants: number;
  referralQualifier: ReferralQualifier;
  requirements: { telegram: boolean; minCompletedOrders: number; minAccountAgeDays: number };
  startsAt: string;
  endsAt: string;
  phase: ContestPhase;
  /** members taken part, when the admin shows it */
  participants: number | null;
  /** tickets held, when the admin shows it */
  tickets: number | null;
  winners: ContestWinnerView[];
  proof: ContestDrawProof | null;
  /** the viewer's own standing; absent for a visitor */
  mine?: {
    tickets: number;
    byMethod: Partial<Record<ContestEntryMethod, number>>;
    entryNumbers: number[];
    /** why the viewer cannot enter right now, in the member's words; empty when they can */
    blockers: string[];
    won: boolean;
  };
}

/** `open` with the clock applied: not yet started, or past its end. */
export function contestPhase(
  contest: { status: ContestStatus; startsAt?: string | null; endsAt?: string | null },
  now = Date.now(),
): ContestPhase {
  if (contest.status === "draft") return "draft";
  if (contest.status === "cancelled") return "cancelled";
  if (contest.status === "drawn") return "drawn";
  if (contest.status === "closed") return "ended";
  const starts = contest.startsAt ? Date.parse(contest.startsAt) : NaN;
  const ends = contest.endsAt ? Date.parse(contest.endsAt) : NaN;
  if (Number.isFinite(starts) && now < starts) return "upcoming";
  if (Number.isFinite(ends) && now >= ends) return "ended";
  return "open";
}

/** «علي حسن» → «علي ح***»: enough for friends to recognise, not enough to find. */
export function maskName(name: string): string {
  const clean = String(name ?? "").trim();
  if (!clean) return "عضو";
  const [first, ...rest] = clean.split(/\s+/);
  if (!rest.length) {
    return first!.length <= 2 ? `${first}***` : `${first!.slice(0, 2)}***`;
  }
  return `${first} ${rest[0]!.slice(0, 1)}***`;
}

/** «2 يوم 4 ساعة» style countdown parts, or null once it is due. */
export function timeLeft(
  target: string | null | undefined,
  now = Date.now(),
): { days: number; hours: number; minutes: number; seconds: number } | null {
  const at = target ? Date.parse(target) : NaN;
  if (!Number.isFinite(at)) return null;
  let rest = Math.floor((at - now) / 1000);
  if (rest <= 0) return null;
  const days = Math.floor(rest / 86_400);
  rest -= days * 86_400;
  const hours = Math.floor(rest / 3600);
  rest -= hours * 3600;
  const minutes = Math.floor(rest / 60);
  return { days, hours, minutes, seconds: rest - minutes * 60 };
}

/** An ISO time as a `datetime-local` value in the browser's own zone, or "". */
export function toLocalInput(iso: string | null | undefined): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return "";
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value, read in the browser's own zone, as ISO — or "". */
export function fromLocalInput(value: string): string {
  if (!value) return "";
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? new Date(at).toISOString() : "";
}
