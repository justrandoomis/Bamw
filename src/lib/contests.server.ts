/**
 * Contests: the server's half.
 *
 *   «الدخول للمسابقة ممكن أن يكون مجاني أو عن طريق الموز أو عن طريق التذاكر
 *    التي ينشئها الأدمن ... أو عن طريق رابط الإحالة»
 *   «انتهاء المسابقة يكون إما انتهاء يدوي أو يكون هنالك موعد للانتهاء ويكون
 *    السحب عادل عن طريق النظام يحدد التذكرة الفائزة»
 *   «في المسابقات أيضاً يضيف اللعبة في قسم جوائزي ... ويستطيع عمل استرداد
 *    لاستيراد اللعبة»
 *
 * The rules this file keeps, and where:
 *
 * - A TICKET IS A ROW. Every way in — free, bananas, an admin's code, a friend
 *   brought — writes rows to `contest_entries`, each with the next public
 *   number. Caps (tickets per member, members per contest) are checked inside
 *   the INSERT itself, so two taps at once cannot both slip under a cap that
 *   only one of them fits under.
 * - MONEY MOVES ONCE. A banana entry debits through
 *   `debitBananaBalanceAtomic` under a key built from the member and the
 *   press, and refunds whatever the cap refused under that key's `:refund`.
 *   Bananas still obey their maintenance switch.
 * - ONE DRAW. `drawContest` writes the seed, the winners, their alternates and
 *   the prizes in one batch, and every row after the first is conditioned on
 *   the seed being the one this call wrote — so two draws racing produce one
 *   result, and there is never a second roll.
 * - THE PRIZE IS A ROULETTE PRIZE. A winner's game is a row in
 *   `roulette_prizes` (source `contest`), so it sits in «ألعابك» and imports
 *   through the roulette's own import: a zero-price gift order and its chat.
 */
import { creditBananaBalance, debitBananaBalanceAtomic } from "./banana-balance.server";
import { DRAW_ALGORITHM, drawPicks, newDrawSeed, poolDigest, type DrawPick } from "./contestDraw";
import {
  CONTEST_ENTRY_METHODS,
  CONTEST_LIMITS,
  DEFAULT_CONTEST_SETTINGS,
  contestPhase,
  maskName,
  type ContestDrawProof,
  type ContestEntryMethod,
  type ContestSettings,
  type ContestStatus,
  type ContestView,
  type ContestWinnerView,
} from "./contests";
import type { AdminContestDetail, AdminContestRow, InstagramPreview } from "./contests.admin";
import { randomId } from "./crypto.server";
import { d1All, d1BatchRun, d1First, d1Run, d1RunChanges, getD1 } from "./d1.server";
import { createAuditLog, getStore } from "./db.server";
import {
  DEFAULT_IG_FILTERS,
  isIgUsername,
  normalizeIgUsername,
  qualifyComments,
  type IgComment,
  type IgFilters,
} from "./instagramComments";
import { LOGIN_CODE_ALPHABET } from "./loginCode";
import { isUnderMaintenance, maintenanceError } from "./maintenance";
import { ensureRouletteSchema } from "./roulette.server";
import { prizePriceOf, squareImageOf } from "./roulette-pool.server";
import type { User } from "./types";

/* ------------------------------------------------------------------ schema */

let schemaReady: Promise<void> | undefined;

/**
 * The contest tables, made on first use like the roulette's.
 *
 * Each statement is written out whole rather than built from a list: the
 * schema-coverage test reads `CREATE TABLE` and `ALTER TABLE … ADD COLUMN`
 * out of the source text to check every INSERT and UPDATE against, and SQL
 * assembled from a variable is invisible to it.
 */
export function ensureContestSchema(): Promise<void> {
  if (!getD1()) return Promise.resolve();
  if (!schemaReady) {
    schemaReady = (async () => {
      await d1Run(`CREATE TABLE IF NOT EXISTS contests (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'draft',
        title TEXT NOT NULL DEFAULT '',
        settings TEXT NOT NULL DEFAULT '{}',
        product_id TEXT,
        draw_source TEXT NOT NULL DEFAULT 'site',
        starts_at TEXT,
        ends_at TEXT,
        auto_draw INTEGER NOT NULL DEFAULT 1,
        draw_seed TEXT,
        draw_proof TEXT,
        drawn_at TEXT,
        closed_at TEXT,
        ig_media_id TEXT,
        ig_cursor TEXT,
        ig_fetched_at TEXT,
        ig_complete INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      await d1Run(
        `CREATE INDEX IF NOT EXISTS contests_due_idx ON contests (status, auto_draw, ends_at)`,
      );

      await d1Run(`CREATE TABLE IF NOT EXISTS contest_entries (
        id TEXT PRIMARY KEY,
        contest_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        method TEXT NOT NULL,
        entry_no INTEGER NOT NULL,
        ticket_code TEXT,
        referral_ref TEXT,
        request_id TEXT,
        bananas_spent INTEGER NOT NULL DEFAULT 0,
        removed_at TEXT,
        removed_reason TEXT,
        created_at TEXT NOT NULL
      )`);
      /* Ticket numbers are public and permanent: never two alike in one contest. */
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS contest_entries_no_idx ON contest_entries (contest_id, entry_no)`,
      );
      /* One entry per admin code, per friend brought, and one free entry per member. */
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS contest_entries_ticket_idx
           ON contest_entries (contest_id, ticket_code) WHERE ticket_code IS NOT NULL`,
      );
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS contest_entries_referral_idx
           ON contest_entries (contest_id, referral_ref) WHERE referral_ref IS NOT NULL`,
      );
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS contest_entries_free_idx
           ON contest_entries (contest_id, user_id) WHERE method = 'free'`,
      );
      await d1Run(
        `CREATE INDEX IF NOT EXISTS contest_entries_user_idx ON contest_entries (contest_id, user_id)`,
      );

      await d1Run(`CREATE TABLE IF NOT EXISTS contest_tickets (
        code TEXT PRIMARY KEY,
        contest_id TEXT NOT NULL,
        note TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        redeemed_by TEXT,
        redeemed_at TEXT,
        entry_id TEXT,
        revoked_at TEXT
      )`);
      await d1Run(
        `CREATE INDEX IF NOT EXISTS contest_tickets_contest_idx ON contest_tickets (contest_id, created_at)`,
      );

      await d1Run(`CREATE TABLE IF NOT EXISTS contest_winners (
        id TEXT PRIMARY KEY,
        contest_id TEXT NOT NULL,
        draw_seed TEXT NOT NULL,
        position INTEGER NOT NULL,
        alternate INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        source TEXT NOT NULL DEFAULT 'site',
        entry_id TEXT,
        entry_no INTEGER,
        user_id TEXT,
        display_name TEXT,
        instagram_username TEXT,
        comment_text TEXT,
        claim_code TEXT,
        claimed_by TEXT,
        claimed_at TEXT,
        prize_id TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS contest_winners_position_idx
           ON contest_winners (contest_id, position)`,
      );
      await d1Run(
        `CREATE UNIQUE INDEX IF NOT EXISTS contest_winners_claim_idx
           ON contest_winners (claim_code) WHERE claim_code IS NOT NULL`,
      );

      await d1Run(`CREATE TABLE IF NOT EXISTS contest_ig_comments (
        contest_id TEXT NOT NULL,
        comment_id TEXT NOT NULL,
        username TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        commented_at TEXT,
        is_reply INTEGER NOT NULL DEFAULT 0,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (contest_id, comment_id)
      )`);
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

/* ----------------------------------------------------------------- rows */

export type ContestRow = {
  id: string;
  status: ContestStatus;
  title: string;
  settings: string;
  product_id: string | null;
  draw_source: string;
  starts_at: string | null;
  ends_at: string | null;
  auto_draw: number;
  draw_seed: string | null;
  draw_proof: string | null;
  drawn_at: string | null;
  closed_at: string | null;
  ig_media_id: string | null;
  ig_cursor: string | null;
  ig_fetched_at: string | null;
  ig_complete: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type EntryRow = {
  id: string;
  contest_id: string;
  user_id: string;
  method: ContestEntryMethod;
  entry_no: number;
  ticket_code: string | null;
  referral_ref: string | null;
  request_id: string | null;
  bananas_spent: number;
  removed_at: string | null;
  created_at: string;
};

export type WinnerRow = {
  id: string;
  contest_id: string;
  draw_seed: string;
  position: number;
  alternate: number;
  status: "pending" | "confirmed" | "standby" | "disqualified";
  source: "site" | "instagram";
  entry_id: string | null;
  entry_no: number | null;
  user_id: string | null;
  display_name: string | null;
  instagram_username: string | null;
  comment_text: string | null;
  claim_code: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  prize_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export async function readContestRow(id: string): Promise<ContestRow | null> {
  if (!id || !getD1()) return null;
  await ensureContestSchema();
  const row = await d1First<ContestRow>(`SELECT * FROM contests WHERE id = ?`, id);
  return row?.id ? row : null;
}

/* ------------------------------------------------------------- settings */

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const text = (value: unknown, max: number): string =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean"
    ? value
    : value === "true"
      ? true
      : value === "false"
        ? false
        : fallback;

/** An ISO time, or "" — and nothing that does not parse as one. */
const isoOrEmpty = (value: unknown): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const at = Date.parse(raw);
  return Number.isFinite(at) ? new Date(at).toISOString() : "";
};

const wordList = (value: unknown, maxItems: number, maxLength: number): string[] => {
  const items = Array.isArray(value) ? value : String(value ?? "").split(/[,،\n]/);
  return [...new Set(items.map((item) => text(item, maxLength)).filter(Boolean))].slice(
    0,
    maxItems,
  );
};

/** An Instagram link, or "" — never a link to anywhere else. */
function instagramUrlOrEmpty(value: unknown): string {
  const raw = text(value, 300);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return "";
    if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function normalizeIgFilters(raw: unknown): IgFilters {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    oneEntryPerUser: bool(input["oneEntryPerUser"], DEFAULT_IG_FILTERS.oneEntryPerUser),
    minMentions: clampInt(input["minMentions"], 0, 20, 0),
    requireText: bool(input["requireText"], false),
    requiredWords: wordList(input["requiredWords"], 20, 60),
    bannedWords: wordList(input["bannedWords"], 50, 60),
    minLength: clampInt(input["minLength"], 0, 500, 0),
    excludeAccounts: wordList(input["excludeAccounts"], 300, 40)
      .map(normalizeIgUsername)
      .filter(isIgUsername),
    includeReplies: bool(input["includeReplies"], false),
    before: isoOrEmpty(input["before"]) || undefined,
  };
}

/**
 * The admin's settings, held to what the server will run.
 *
 * Unknown fields are dropped and every number is clamped, so nothing the
 * browser sends can widen a limit; the prize's title, picture and value are
 * not taken from it at all — `saveContest` reads them off the catalogue.
 */
export function normalizeContestSettings(
  raw: unknown,
  base: ContestSettings = DEFAULT_CONTEST_SETTINGS,
): ContestSettings {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <K extends keyof ContestSettings>(key: K): unknown =>
    key in input ? input[key] : base[key];

  const drawSource = pick("drawSource") === "instagram" ? "instagram" : "site";
  const methodsRaw = pick("entryMethods");
  const entryMethods =
    drawSource === "instagram"
      ? []
      : CONTEST_ENTRY_METHODS.filter((method) =>
          (Array.isArray(methodsRaw) ? methodsRaw : []).includes(method),
        );
  const conditionsRaw = pick("conditions");
  const conditions = (
    Array.isArray(conditionsRaw) ? conditionsRaw : String(conditionsRaw ?? "").split("\n")
  )
    .map((line) => text(line, CONTEST_LIMITS.condition))
    .filter(Boolean)
    .slice(0, CONTEST_LIMITS.conditions);

  const startsAt = isoOrEmpty(pick("startsAt"));
  const endsAt = isoOrEmpty(pick("endsAt"));

  return {
    title: text(pick("title"), CONTEST_LIMITS.title),
    description: text(pick("description"), CONTEST_LIMITS.description),
    conditions,
    instagramUrl: instagramUrlOrEmpty(pick("instagramUrl")),
    productId: text(pick("productId"), 120),
    prizeTitle: base.prizeTitle,
    prizeImage: base.prizeImage,
    prizeNote: text(pick("prizeNote"), 120),
    winnersCount: clampInt(pick("winnersCount"), 1, CONTEST_LIMITS.winners, 1),
    alternatesCount: clampInt(pick("alternatesCount"), 0, CONTEST_LIMITS.alternates, 2),
    entryMethods,
    bananaCost: entryMethods.includes("bananas")
      ? clampInt(pick("bananaCost"), 1, CONTEST_LIMITS.bananaCost, 1)
      : 0,
    maxEntriesPerUser: clampInt(pick("maxEntriesPerUser"), 1, CONTEST_LIMITS.entriesPerUser, 1),
    maxParticipants: clampInt(pick("maxParticipants"), 0, 1_000_000, 0),
    referralQualifier: pick("referralQualifier") === "signup" ? "signup" : "purchase",
    requireTelegram: bool(pick("requireTelegram"), false),
    minCompletedOrders: clampInt(pick("minCompletedOrders"), 0, 1000, 0),
    minAccountAgeDays: clampInt(pick("minAccountAgeDays"), 0, 3650, 0),
    startsAt,
    endsAt,
    autoDraw: bool(pick("autoDraw"), true),
    oneWinPerUser: bool(pick("oneWinPerUser"), true),
    requireConfirmation: bool(pick("requireConfirmation"), false),
    showEntrants: bool(pick("showEntrants"), true),
    drawSource,
    igFilters: normalizeIgFilters(pick("igFilters")),
  };
}

/** What is missing before a contest can be published, in the admin's words. */
export function publishProblems(settings: ContestSettings): string[] {
  const problems: string[] = [];
  if (!settings.title) problems.push("اكتب عنوان المسابقة.");
  if (!settings.productId) problems.push("اختر اللعبة الجائزة.");
  if (settings.drawSource === "site" && settings.entryMethods.length === 0) {
    problems.push("اختر طريقة دخول واحدة على الأقل.");
  }
  if (settings.drawSource === "instagram" && !settings.instagramUrl) {
    problems.push("ضع رابط منشور إنستغرام الذي يُسحب من تعليقاته.");
  }
  if (settings.endsAt && Date.parse(settings.endsAt) <= Date.now()) {
    problems.push("موعد الانتهاء في الماضي.");
  }
  if (
    settings.startsAt &&
    settings.endsAt &&
    Date.parse(settings.endsAt) <= Date.parse(settings.startsAt)
  ) {
    problems.push("موعد الانتهاء قبل موعد البدء.");
  }
  return problems;
}

/** The stored settings, read back through the same normalisation. */
export function readSettings(row: Pick<ContestRow, "settings">): ContestSettings {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(row.settings || "{}");
  } catch {
    parsed = {};
  }
  const stored = parsed as Partial<ContestSettings>;
  return normalizeContestSettings(stored, {
    ...DEFAULT_CONTEST_SETTINGS,
    prizeTitle: String(stored.prizeTitle ?? ""),
    prizeImage: String(stored.prizeImage ?? ""),
  });
}

/** The prize's own value, kept in the settings beside its title and picture. */
function prizeValueOf(row: Pick<ContestRow, "settings">): number {
  try {
    return Number((JSON.parse(row.settings || "{}") as { prizeValue?: unknown }).prizeValue) || 0;
  } catch {
    return 0;
  }
}

/* ---------------------------------------------------------- the catalogue */

/** The game a contest gives away, as the catalogue has it now. */
async function productSnapshot(
  productId: string,
): Promise<{ title: string; image: string; value: number } | null> {
  if (!productId) return null;
  const store = await getStore();
  const product = (store.products ?? []).find((item) => String(item.id) === productId) as
    (Record<string, unknown> & { title?: string; titleEn?: string; image?: string }) | undefined;
  if (!product) return null;
  return {
    title: String(product.titleEn ?? product.title ?? ""),
    image: squareImageOf(product) ?? String(product.image ?? ""),
    value: prizePriceOf(product),
  };
}

/* --------------------------------------------------------------- admin */

export async function saveContest(input: {
  adminId: string;
  id?: string | null;
  settings: unknown;
}): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  await ensureContestSchema();
  const now = new Date().toISOString();
  const existing = input.id ? await readContestRow(input.id) : null;
  if (input.id && !existing) return { ok: false, status: 404, error: "المسابقة غير موجودة" };
  if (existing && (existing.status === "drawn" || existing.status === "cancelled")) {
    return { ok: false, status: 409, error: "لا يمكن تعديل مسابقة انتهت بالسحب أو أُلغيت." };
  }

  const previous = existing ? readSettings(existing) : DEFAULT_CONTEST_SETTINGS;
  const settings = normalizeContestSettings(input.settings, previous);
  if (existing && existing.status !== "draft" && settings.drawSource !== previous.drawSource) {
    return {
      ok: false,
      status: 409,
      error: "لا يمكن تغيير مصدر السحب بعد نشر المسابقة.",
    };
  }

  let prizeValue = existing ? prizeValueOf(existing) : 0;
  if (settings.productId && settings.productId !== previous.productId) {
    const product = await productSnapshot(settings.productId);
    if (!product) return { ok: false, status: 400, error: "اللعبة المختارة غير موجودة في المتجر" };
    settings.prizeTitle = product.title;
    settings.prizeImage = product.image;
    prizeValue = product.value;
  } else if (!settings.productId) {
    settings.prizeTitle = "";
    settings.prizeImage = "";
    prizeValue = 0;
  }

  const stored = JSON.stringify({ ...settings, prizeValue });
  if (existing) {
    await d1Run(
      `UPDATE contests SET title = ?, settings = ?, product_id = ?, draw_source = ?, starts_at = ?,
              ends_at = ?, auto_draw = ?, updated_at = ?
        WHERE id = ?`,
      settings.title,
      stored,
      settings.productId || null,
      settings.drawSource,
      settings.startsAt || null,
      settings.endsAt || null,
      settings.autoDraw ? 1 : 0,
      now,
      existing.id,
    );
    await createAuditLog(input.adminId, "contest_update", "contest", existing.id).catch(() => {});
    return { ok: true, id: existing.id };
  }

  const id = randomId("cst");
  await d1Run(
    `INSERT INTO contests (id, status, title, settings, product_id, draw_source, starts_at, ends_at,
                           auto_draw, created_by, created_at, updated_at)
     VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    settings.title,
    stored,
    settings.productId || null,
    settings.drawSource,
    settings.startsAt || null,
    settings.endsAt || null,
    settings.autoDraw ? 1 : 0,
    input.adminId,
    now,
    now,
  );
  await createAuditLog(input.adminId, "contest_create", "contest", id).catch(() => {});
  return { ok: true, id };
}

export type StatusAction = "publish" | "unpublish" | "close" | "reopen" | "cancel";

export async function setContestStatus(input: {
  adminId: string;
  id: string;
  action: StatusAction;
}): Promise<
  | { ok: true; status: ContestStatus; refunded?: number }
  | { ok: false; status: number; error: string }
> {
  const row = await readContestRow(input.id);
  if (!row) return { ok: false, status: 404, error: "المسابقة غير موجودة" };
  const settings = readSettings(row);
  const now = new Date().toISOString();

  if (input.action === "publish") {
    const problems = publishProblems(settings);
    if (problems.length) return { ok: false, status: 400, error: problems.join(" ") };
    const changed = await d1RunChanges(
      `UPDATE contests SET status = 'open', updated_at = ? WHERE id = ? AND status = 'draft'`,
      now,
      row.id,
    );
    if (changed !== 1) return { ok: false, status: 409, error: "المسابقة منشورة بالفعل." };
  } else if (input.action === "unpublish") {
    const entries = await countEntries(row.id);
    if (entries.tickets > 0) {
      return { ok: false, status: 409, error: "دخلها مشاركون — أنهِها أو ألغِها بدل إخفائها." };
    }
    const changed = await d1RunChanges(
      `UPDATE contests SET status = 'draft', updated_at = ? WHERE id = ? AND status = 'open'`,
      now,
      row.id,
    );
    if (changed !== 1) return { ok: false, status: 409, error: "لا يمكن إخفاؤها الآن." };
  } else if (input.action === "close") {
    const changed = await d1RunChanges(
      `UPDATE contests SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`,
      now,
      now,
      row.id,
    );
    if (changed !== 1) return { ok: false, status: 409, error: "المسابقة ليست مفتوحة." };
  } else if (input.action === "reopen") {
    if (settings.endsAt && Date.parse(settings.endsAt) <= Date.now()) {
      return { ok: false, status: 400, error: "مدّد موعد الانتهاء أولاً، ثم أعد فتحها." };
    }
    const changed = await d1RunChanges(
      `UPDATE contests SET status = 'open', closed_at = NULL, updated_at = ? WHERE id = ? AND status = 'closed'`,
      now,
      row.id,
    );
    if (changed !== 1) return { ok: false, status: 409, error: "لا يمكن إعادة فتحها." };
  } else if (input.action === "cancel") {
    const changed = await d1RunChanges(
      `UPDATE contests SET status = 'cancelled', updated_at = ?
        WHERE id = ? AND status IN ('draft', 'open', 'closed')`,
      now,
      row.id,
    );
    if (changed !== 1)
      return { ok: false, status: 409, error: "لا يمكن إلغاء مسابقة تم السحب فيها." };
    const refunded = await refundBananaEntries(row.id);
    await createAuditLog(input.adminId, "contest_cancel", "contest", row.id, null, null, {
      refunded,
    }).catch(() => {});
    return { ok: true, status: "cancelled", refunded };
  } else {
    return { ok: false, status: 400, error: "إجراء غير معروف" };
  }
  await createAuditLog(input.adminId, `contest_${input.action}`, "contest", row.id).catch(() => {});
  const after = await readContestRow(row.id);
  return { ok: true, status: (after?.status ?? row.status) as ContestStatus };
}

/** A cancelled contest owes its banana entrants their bananas back — once each. */
async function refundBananaEntries(contestId: string): Promise<number> {
  const rows = await d1All<{ id: string; user_id: string; bananas_spent: number }>(
    `SELECT id, user_id, bananas_spent FROM contest_entries
      WHERE contest_id = ? AND method = 'bananas' AND bananas_spent > 0`,
    contestId,
  );
  let refunded = 0;
  for (const row of rows) {
    const result = await creditBananaBalance(row.user_id, Number(row.bananas_spent), {
      reason: "contest_cancelled",
      kind: "refund",
      meta: { contestId, entryId: row.id },
      idempotencyKey: `cstx_${row.id}`,
    }).catch(() => ({ success: false }));
    if (result.success) refunded += Number(row.bananas_spent);
  }
  return refunded;
}

/* ------------------------------------------------------------- counting */

async function countEntries(contestId: string): Promise<{ tickets: number; participants: number }> {
  const row = await d1First<{ tickets: number; participants: number }>(
    `SELECT COUNT(*) AS tickets, COUNT(DISTINCT user_id) AS participants
       FROM contest_entries WHERE contest_id = ? AND removed_at IS NULL`,
    contestId,
  );
  return { tickets: Number(row?.tickets ?? 0), participants: Number(row?.participants ?? 0) };
}

async function memberEntries(contestId: string, userId: string): Promise<EntryRow[]> {
  return d1All<EntryRow>(
    `SELECT * FROM contest_entries
      WHERE contest_id = ? AND user_id = ? AND removed_at IS NULL ORDER BY entry_no`,
    contestId,
    userId,
  );
}

async function completedOrders(userId: string): Promise<number> {
  const row = await d1First<{ n: number }>(
    `SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status = 'completed'`,
    userId,
  );
  return Number(row?.n ?? 0);
}

/* -------------------------------------------------------- who may enter */

/**
 * Why this member cannot take a ticket now — every reason, in their words,
 * so the screen can say all of it at once. Empty when they can.
 */
async function entryBlockers(
  row: ContestRow,
  settings: ContestSettings,
  user: User,
  held: number,
  participants: number,
): Promise<string[]> {
  const blockers: string[] = [];
  const phase = contestPhase({
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  });
  if (phase === "upcoming") blockers.push("المسابقة لم تبدأ بعد.");
  else if (phase !== "open") blockers.push("انتهى وقت الدخول في هذه المسابقة.");
  if (settings.drawSource === "instagram") {
    blockers.push("الدخول في هذه المسابقة بالتعليق على منشور إنستغرام.");
    return blockers;
  }
  if (held >= settings.maxEntriesPerUser) {
    blockers.push(
      settings.maxEntriesPerUser === 1
        ? "أنت مشارك بالفعل."
        : `وصلت للحد الأعلى: ${settings.maxEntriesPerUser} تذاكر.`,
    );
  }
  if (held === 0 && settings.maxParticipants > 0 && participants >= settings.maxParticipants) {
    blockers.push("اكتمل عدد المشاركين.");
  }
  if (settings.requireTelegram) {
    const { getUserTelegramChatId } = await import("./telegram-notifications.server");
    if (!(await getUserTelegramChatId(user.id).catch(() => undefined))) {
      blockers.push("اربط حسابك بتلغرام أولاً (من الملف الشخصي) ليصلك خبر الفوز.");
    }
  }
  if (settings.minCompletedOrders > 0) {
    const done = await completedOrders(user.id);
    if (done < settings.minCompletedOrders) {
      blockers.push(
        `المسابقة لمن أكمل ${settings.minCompletedOrders} طلبات على الأقل (لديك ${done}).`,
      );
    }
  }
  if (settings.minAccountAgeDays > 0) {
    const created = Date.parse(String(user.createdAt ?? ""));
    const days = Number.isFinite(created) ? (Date.now() - created) / 86_400_000 : 0;
    if (days < settings.minAccountAgeDays) {
      blockers.push(`المسابقة لحسابات عمرها ${settings.minAccountAgeDays} يوماً على الأقل.`);
    }
  }
  return blockers;
}

/* ------------------------------------------------------- writing tickets */

type NewEntry = {
  id: string;
  ticketCode?: string | null;
  referralRef?: string | null;
  requestId?: string | null;
  bananas?: number;
};

/**
 * Write tickets, each only while the member is under their cap and the
 * contest under its participant cap — both checked inside the statement, so
 * a race cannot overshoot either. Returns how many were written.
 */
async function insertEntries(input: {
  contestId: string;
  userId: string;
  method: ContestEntryMethod;
  rows: NewEntry[];
  cap: number;
  participantCap: number;
  now: string;
}): Promise<number> {
  if (!input.rows.length) return 0;
  const participantCap = input.participantCap > 0 ? input.participantCap : 1_000_000_000;
  const results = await d1BatchRun(
    input.rows.map((row) => ({
      sql: `INSERT OR IGNORE INTO contest_entries
              (id, contest_id, user_id, method, entry_no, ticket_code, referral_ref, request_id,
               bananas_spent, created_at)
            SELECT ?, ?, ?, ?,
                   COALESCE((SELECT MAX(entry_no) FROM contest_entries WHERE contest_id = ?), 0) + 1,
                   ?, ?, ?, ?, ?
             WHERE (SELECT COUNT(*) FROM contest_entries
                     WHERE contest_id = ? AND user_id = ? AND removed_at IS NULL) < ?
               AND (EXISTS (SELECT 1 FROM contest_entries
                             WHERE contest_id = ? AND user_id = ? AND removed_at IS NULL)
                    OR (SELECT COUNT(DISTINCT user_id) FROM contest_entries
                         WHERE contest_id = ? AND removed_at IS NULL) < ?)`,
      binds: [
        row.id,
        input.contestId,
        input.userId,
        input.method,
        input.contestId,
        row.ticketCode ?? null,
        row.referralRef ?? null,
        row.requestId ?? null,
        Math.max(0, Math.floor(row.bananas ?? 0)),
        input.now,
        input.contestId,
        input.userId,
        input.cap,
        input.contestId,
        input.userId,
        input.contestId,
        participantCap,
      ],
    })),
  );
  return results.reduce((sum, result) => sum + Number(result?.meta?.changes ?? 0), 0);
}

export type EnterResult =
  | { ok: true; added: number; message: string }
  | { ok: false; status: number; error: string; code?: string };

/**
 * A member takes tickets, by one of the contest's ways in.
 */
export async function enterContest(input: {
  user: User;
  contestId: string;
  method: ContestEntryMethod;
  count?: number;
  requestId?: string;
  code?: string;
  now?: string;
}): Promise<EnterResult> {
  await ensureContestSchema();
  const now = input.now ?? new Date().toISOString();
  const row = await readContestRow(input.contestId);
  if (!row || row.status === "draft") {
    return { ok: false, status: 404, error: "المسابقة غير موجودة" };
  }
  const settings = readSettings(row);
  if (
    !CONTEST_ENTRY_METHODS.includes(input.method) ||
    !settings.entryMethods.includes(input.method)
  ) {
    return { ok: false, status: 400, error: "طريقة الدخول هذه غير متاحة في هذه المسابقة." };
  }

  const held = (await memberEntries(row.id, input.user.id)).length;
  const { participants } = await countEntries(row.id);
  const blockers = await entryBlockers(row, settings, input.user, held, participants);
  if (blockers.length) return { ok: false, status: 409, error: blockers.join(" ") };

  const cap = settings.maxEntriesPerUser;
  const room = Math.max(0, cap - held);
  const common = {
    contestId: row.id,
    userId: input.user.id,
    method: input.method,
    cap,
    participantCap: settings.maxParticipants,
    now,
  };

  if (input.method === "free") {
    const added = await insertEntries({
      ...common,
      rows: [{ id: `ce_f_${row.id}_${input.user.id}` }],
    });
    if (!added) return { ok: false, status: 409, error: "أنت مشارك مجاناً بالفعل." };
    return { ok: true, added, message: "دخلت المسابقة ✅" };
  }

  if (input.method === "bananas") {
    if (isUnderMaintenance("bananas")) {
      const refused = maintenanceError("bananas");
      return { ok: false, status: 503, error: refused.error, code: refused.code };
    }
    const requestId = String(input.requestId ?? "");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) {
      return { ok: false, status: 400, error: "طلب غير صالح، أعد المحاولة." };
    }
    const count = clampInt(input.count, 1, CONTEST_LIMITS.entriesPerUser, 1);
    const already = await d1First<{ n: number }>(
      `SELECT COUNT(*) AS n FROM contest_entries WHERE contest_id = ? AND user_id = ? AND request_id = ?`,
      row.id,
      input.user.id,
      requestId,
    );
    if (Number(already?.n ?? 0) > 0) {
      return { ok: true, added: Number(already?.n ?? 0), message: "تمت إضافة تذاكرك ✅" };
    }
    if (count > room) {
      return { ok: false, status: 409, error: `يمكنك أخذ ${room} تذاكر فقط.` };
    }
    const cost = count * settings.bananaCost;
    const key = `cstb_${input.user.id}_${requestId}`;
    const debit = await debitBananaBalanceAtomic(input.user.id, cost, {
      reason: "contest_entry",
      kind: "spend",
      meta: { contestId: row.id, tickets: count },
      idempotencyKey: key,
    });
    if (!debit.success) {
      return {
        ok: false,
        status: 402,
        error:
          debit.error === "insufficient_balance"
            ? `رصيدك من الموز لا يكفي: تحتاج ${cost.toLocaleString("en-US")} 🍌.`
            : "تعذّر خصم الموز، حاول مرة أخرى.",
      };
    }
    const rows = Array.from({ length: count }, (_, index) => ({
      id: `ce_b_${input.user.id}_${requestId}_${index + 1}`,
      requestId,
      bananas: settings.bananaCost,
    }));
    const added = await insertEntries({ ...common, rows });
    if (added < count) {
      await creditBananaBalance(input.user.id, (count - added) * settings.bananaCost, {
        reason: "contest_entry_refused",
        kind: "refund",
        meta: { contestId: row.id, refused: count - added },
        idempotencyKey: `${key}:refund`,
      }).catch(() => undefined);
    }
    if (!added) return { ok: false, status: 409, error: "لم تُضف تذاكر — وصلت للحد. أُعيد موزك." };
    return {
      ok: true,
      added,
      message:
        added < count ? `أُضيفت ${added} تذاكر وأُعيد موز الباقي.` : `أُضيفت ${added} تذاكر ✅`,
    };
  }

  if (input.method === "ticket") {
    const code = normalizeContestCode(input.code ?? "");
    if (!code) return { ok: false, status: 400, error: "اكتب كود التذكرة كما وصلك." };
    const ticket = await d1First<{
      code: string;
      contest_id: string;
      redeemed_by: string | null;
      revoked_at: string | null;
    }>(
      `SELECT code, contest_id, redeemed_by, revoked_at FROM contest_tickets WHERE code = ?`,
      code,
    );
    if (!ticket?.code || ticket.contest_id !== row.id) {
      return { ok: false, status: 404, error: "الكود غير صحيح لهذه المسابقة." };
    }
    if (ticket.revoked_at) return { ok: false, status: 410, error: "هذا الكود أُلغي." };
    if (ticket.redeemed_by) {
      return {
        ok: false,
        status: 409,
        error:
          ticket.redeemed_by === input.user.id ? "استخدمت هذا الكود من قبل." : "هذا الكود مستخدم.",
      };
    }
    const claimed = await d1RunChanges(
      `UPDATE contest_tickets SET redeemed_by = ?, redeemed_at = ?
        WHERE code = ? AND redeemed_by IS NULL AND revoked_at IS NULL`,
      input.user.id,
      now,
      code,
    );
    if (claimed !== 1) return { ok: false, status: 409, error: "هذا الكود مستخدم." };
    const entryId = `ce_t_${code}`;
    const added = await insertEntries({ ...common, rows: [{ id: entryId, ticketCode: code }] });
    if (!added) {
      await d1Run(
        `UPDATE contest_tickets SET redeemed_by = NULL, redeemed_at = NULL
          WHERE code = ? AND redeemed_by = ? AND entry_id IS NULL`,
        code,
        input.user.id,
      );
      return { ok: false, status: 409, error: "وصلت للحد الأعلى من التذاكر، فلم يُستخدم الكود." };
    }
    await d1Run(`UPDATE contest_tickets SET entry_id = ? WHERE code = ?`, entryId, code);
    return { ok: true, added, message: "قُبلت التذكرة ودخلت المسابقة ✅" };
  }

  // referral
  const since = row.starts_at || row.created_at;
  const friends = await qualifyingReferrals(input.user.id, since, settings.referralQualifier);
  const counted = new Set(
    (
      await d1All<{ referral_ref: string }>(
        `SELECT referral_ref FROM contest_entries WHERE contest_id = ? AND user_id = ? AND referral_ref IS NOT NULL`,
        row.id,
        input.user.id,
      )
    ).map((r) => r.referral_ref),
  );
  const fresh = friends.filter((friend) => !counted.has(friend)).slice(0, room);
  if (!fresh.length) {
    return {
      ok: true,
      added: 0,
      message:
        settings.referralQualifier === "signup"
          ? "لا يوجد أصدقاء جدد سجّلوا برابطك منذ بدء المسابقة بعد — شارك رابطك."
          : "لا يوجد أصدقاء جدد اشتروا برابطك منذ بدء المسابقة بعد — شارك رابطك.",
    };
  }
  const added = await insertEntries({
    ...common,
    rows: fresh.map((friend) => ({ id: `ce_r_${row.id}_${friend}`, referralRef: friend })),
  });
  return {
    ok: true,
    added,
    message: added ? `أُضيفت ${added} تذاكر عن أصدقائك ✅` : "وصلت للحد الأعلى من التذاكر.",
  };
}

/**
 * The friends a member brought since `since`: new accounts made through their
 * link, or — the stricter, default reading — friends whose first purchase
 * went through it, which a pile of empty sign-ups cannot fake.
 */
async function qualifyingReferrals(
  userId: string,
  since: string,
  qualifier: "signup" | "purchase",
): Promise<string[]> {
  if (qualifier === "signup") {
    const rows = await d1All<{ id: string }>(
      `SELECT id FROM users WHERE referred_by_user_id = ? AND created_at >= ? ORDER BY created_at LIMIT 200`,
      userId,
      since,
    ).catch(() => []);
    return [...new Set(rows.map((r) => String(r.id)).filter((id) => id && id !== userId))];
  }
  const rows = await d1All<{ referred_user_id: string | null }>(
    `SELECT referred_user_id FROM referral_attributions
      WHERE referrer_user_id = ? AND status IN ('used', 'converted') AND converted_at >= ?
      ORDER BY converted_at LIMIT 200`,
    userId,
    since,
  ).catch(() => []);
  return [
    ...new Set(
      rows.map((r) => String(r.referred_user_id ?? "")).filter((id) => id && id !== userId),
    ),
  ];
}

/* -------------------------------------------------------------- codes */

/** Ten characters of the login code's alphabet: nothing reads two ways. */
export function generateContestCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let code = "";
  for (const byte of bytes) code += LOGIN_CODE_ALPHABET[byte % 32];
  return code;
}

export function formatContestCode(code: string): string {
  return code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

/** What was typed, as the bare code — O read as 0, I and L as 1 — or "". */
export function normalizeContestCode(input: string): string {
  const bare = String(input ?? "")
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (bare.length !== 10) return "";
  for (const char of bare) if (!LOGIN_CODE_ALPHABET.includes(char)) return "";
  return bare;
}

export async function createTickets(input: {
  adminId: string;
  contestId: string;
  count: number;
  note?: string;
}): Promise<{ ok: true; codes: string[] } | { ok: false; status: number; error: string }> {
  const row = await readContestRow(input.contestId);
  if (!row) return { ok: false, status: 404, error: "المسابقة غير موجودة" };
  if (row.status === "drawn" || row.status === "cancelled") {
    return { ok: false, status: 409, error: "المسابقة انتهت." };
  }
  if (!readSettings(row).entryMethods.includes("ticket")) {
    return { ok: false, status: 400, error: "فعّل «بتذكرة» في طرق الدخول أولاً." };
  }
  const count = clampInt(input.count, 1, CONTEST_LIMITS.ticketsPerBatch, 1);
  const note = text(input.note, 120) || null;
  const now = new Date().toISOString();
  const codes = Array.from({ length: count }, generateContestCode);
  await d1BatchRun(
    codes.map((code) => ({
      sql: `INSERT OR IGNORE INTO contest_tickets (code, contest_id, note, created_by, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      binds: [code, row.id, note, input.adminId, now],
    })),
  );
  await createAuditLog(input.adminId, "contest_tickets_create", "contest", row.id, null, null, {
    count,
  }).catch(() => {});
  return { ok: true, codes: codes.map(formatContestCode) };
}

export async function revokeTicket(input: {
  adminId: string;
  code: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  await ensureContestSchema();
  const code = normalizeContestCode(input.code);
  const changed = await d1RunChanges(
    `UPDATE contest_tickets SET revoked_at = ? WHERE code = ? AND redeemed_by IS NULL AND revoked_at IS NULL`,
    new Date().toISOString(),
    code,
  );
  if (changed !== 1) return { ok: false, status: 409, error: "الكود مستخدم أو ملغى بالفعل." };
  await createAuditLog(input.adminId, "contest_ticket_revoke", "contest_ticket", code).catch(
    () => {},
  );
  return { ok: true };
}

export async function removeEntry(input: {
  adminId: string;
  entryId: string;
  reason?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  await ensureContestSchema();
  const entry = await d1First<EntryRow>(
    `SELECT * FROM contest_entries WHERE id = ?`,
    input.entryId,
  );
  if (!entry?.id) return { ok: false, status: 404, error: "التذكرة غير موجودة" };
  const row = await readContestRow(entry.contest_id);
  if (!row || row.status === "drawn") {
    return { ok: false, status: 409, error: "لا تُحذف تذكرة بعد السحب." };
  }
  await d1Run(
    `UPDATE contest_entries SET removed_at = ?, removed_reason = ? WHERE id = ? AND removed_at IS NULL`,
    new Date().toISOString(),
    text(input.reason, 200) || "استبعدها المشرف",
    entry.id,
  );
  await createAuditLog(input.adminId, "contest_entry_remove", "contest_entry", entry.id).catch(
    () => {},
  );
  return { ok: true };
}

/* --------------------------------------------------------------- prizes */

/** The statement that puts a winner's game in «ألعابك» — once, for this draw's winner only. */
function grantPrizeStatement(input: {
  row: ContestRow;
  settings: ContestSettings;
  winnerId: string;
  userId: string;
  prizeId: string;
  now: string;
}): { sql: string; binds: unknown[] } {
  return {
    sql: `INSERT OR IGNORE INTO roulette_prizes
            (id, user_id, spin_id, product_id, product_title, product_image, product_price, bucket,
             status, won_at, source, contest_id)
          SELECT ?, ?, ?, ?, ?, ?, ?, 'contest', 'available', ?, 'contest', ?
           WHERE (SELECT prize_id FROM contest_winners WHERE id = ?) = ?`,
    binds: [
      input.prizeId,
      input.userId,
      `contest:${input.row.id}:${input.winnerId}`,
      input.settings.productId,
      input.settings.prizeTitle || input.row.title,
      input.settings.prizeImage || null,
      prizeValueOf(input.row),
      input.now,
      input.row.id,
      input.winnerId,
      input.prizeId,
    ],
  };
}

/* ---------------------------------------------------------------- draw */

export type DrawResult =
  | { ok: true; seed: string; winners: number; alternates: number; already?: boolean }
  | { ok: false; status: number; error: string };

const winnerName = async (userId: string): Promise<string> => {
  const row = await d1First<{ name: string | null; username: string | null }>(
    `SELECT name, username FROM users WHERE id = ?`,
    userId,
  ).catch(() => undefined);
  return String(row?.name || row?.username || "عضو");
};

/**
 * The draw from tickets held on the site.
 *
 * Allowed while the contest is open (the admin ending it now) or closed, and
 * never twice. A contest with no tickets is closed rather than drawn, so the
 * admin can extend it.
 */
export async function drawContest(input: {
  contestId: string;
  actor: string;
  now?: string;
}): Promise<DrawResult> {
  await ensureContestSchema();
  await ensureRouletteSchema();
  const now = input.now ?? new Date().toISOString();
  const row = await readContestRow(input.contestId);
  if (!row) return { ok: false, status: 404, error: "المسابقة غير موجودة" };
  if (row.status === "drawn" && row.draw_seed) {
    return { ok: true, seed: row.draw_seed, winners: 0, alternates: 0, already: true };
  }
  if (row.status !== "open" && row.status !== "closed") {
    return { ok: false, status: 409, error: "لا يمكن السحب في مسابقة بهذه الحالة." };
  }
  const settings = readSettings(row);
  if (settings.drawSource !== "site") {
    return { ok: false, status: 400, error: "هذه المسابقة تُسحب من تعليقات إنستغرام." };
  }
  if (!settings.productId) return { ok: false, status: 400, error: "اختر اللعبة الجائزة أولاً." };

  const pool = await d1All<{ id: string; entry_no: number; user_id: string }>(
    `SELECT id, entry_no, user_id FROM contest_entries
      WHERE contest_id = ? AND removed_at IS NULL ORDER BY entry_no`,
    row.id,
  );
  if (!pool.length) {
    await d1Run(
      `UPDATE contests SET status = 'closed', closed_at = COALESCE(closed_at, ?), updated_at = ?
        WHERE id = ? AND status = 'open'`,
      now,
      now,
      row.id,
    );
    return {
      ok: false,
      status: 409,
      error: "لا توجد تذاكر للسحب — أُغلقت المسابقة، ويمكنك تمديدها.",
    };
  }

  const tickets = pool.map((entry) => ({
    id: entry.id,
    number: Number(entry.entry_no),
    holder: entry.user_id,
  }));
  const seed = newDrawSeed();
  const picks = await drawPicks({
    tickets,
    seed,
    winners: settings.winnersCount,
    alternates: settings.alternatesCount,
    oneWinPerHolder: settings.oneWinPerUser,
  });
  const proof: ContestDrawProof = {
    algorithm: DRAW_ALGORITHM,
    seed,
    poolDigest: await poolDigest(tickets),
    poolSize: tickets.length,
    drawnAt: now,
  };

  const names = new Map<string, string>();
  for (const pick of picks) {
    if (!names.has(pick.holder)) names.set(pick.holder, await winnerName(pick.holder));
  }

  const result = await writeDraw({
    row,
    settings,
    seed,
    proof,
    now,
    winners: picks.map((pick) => ({
      pick,
      source: "site" as const,
      entryId: pick.id,
      entryNo: pick.number,
      userId: pick.holder,
      displayName: names.get(pick.holder) ?? "عضو",
    })),
  });
  if (result.ok && !result.already) {
    await createAuditLog(input.actor, "contest_draw", "contest", row.id, null, null, {
      seed,
      poolSize: proof.poolSize,
    }).catch(() => {});
    await notifyWinners(row.id).catch(() => undefined);
  }
  return result;
}

type DrawnWinner = {
  pick: DrawPick;
  source: "site" | "instagram";
  entryId?: string | null;
  entryNo?: number | null;
  userId?: string | null;
  displayName?: string | null;
  instagramUsername?: string | null;
  commentText?: string | null;
};

/**
 * The seed, the winners, the alternates and the prizes — one batch, and every
 * row after the first only for the draw whose seed the first one wrote.
 */
async function writeDraw(input: {
  row: ContestRow;
  settings: ContestSettings;
  seed: string;
  proof: ContestDrawProof & { comments?: number; qualifiedAccounts?: number };
  now: string;
  winners: DrawnWinner[];
}): Promise<DrawResult> {
  const { row, settings, seed, now } = input;
  const statements: { sql: string; binds: unknown[] }[] = [
    {
      sql: `UPDATE contests SET status = 'drawn', draw_seed = ?, draw_proof = ?, drawn_at = ?,
                   closed_at = COALESCE(closed_at, ?), updated_at = ?
             WHERE id = ? AND status IN ('open', 'closed') AND draw_seed IS NULL`,
      binds: [seed, JSON.stringify(input.proof), now, now, now, row.id],
    },
  ];
  for (const winner of input.winners) {
    const id = randomId("cw");
    const isAlternate = winner.pick.alternate;
    const status = isAlternate ? "standby" : settings.requireConfirmation ? "pending" : "confirmed";
    const grantNow = winner.source === "site" && status === "confirmed" && winner.userId;
    const prizeId = grantNow ? randomId("przw") : null;
    statements.push({
      sql: `INSERT INTO contest_winners
              (id, contest_id, draw_seed, position, alternate, status, source, entry_id, entry_no,
               user_id, display_name, instagram_username, comment_text, claim_code, prize_id,
               created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE (SELECT draw_seed FROM contests WHERE id = ?) = ?`,
      binds: [
        id,
        row.id,
        seed,
        winner.pick.position,
        isAlternate ? 1 : 0,
        status,
        winner.source,
        winner.entryId ?? null,
        winner.entryNo ?? null,
        winner.userId ?? null,
        winner.displayName ?? null,
        winner.instagramUsername ?? null,
        winner.commentText ?? null,
        winner.source === "instagram" ? generateContestCode() : null,
        prizeId,
        now,
        now,
        row.id,
        seed,
      ],
    });
    if (grantNow && prizeId) {
      statements.push(
        grantPrizeStatement({ row, settings, winnerId: id, userId: winner.userId!, prizeId, now }),
      );
    }
  }
  await d1BatchRun(statements);
  const after = await readContestRow(row.id);
  if (after?.draw_seed !== seed) {
    return after?.draw_seed
      ? { ok: true, seed: after.draw_seed, winners: 0, alternates: 0, already: true }
      : { ok: false, status: 409, error: "تعذّر حفظ السحب، حاول مرة أخرى." };
  }
  return {
    ok: true,
    seed,
    winners: input.winners.filter((w) => !w.pick.alternate).length,
    alternates: input.winners.filter((w) => w.pick.alternate).length,
  };
}

/** Tell each site winner, on Telegram, that the game is in «ألعابك». Best effort. */
async function notifyWinners(contestId: string, onlyWinnerId?: string): Promise<void> {
  const row = await readContestRow(contestId);
  if (!row) return;
  const settings = readSettings(row);
  const winners = await d1All<WinnerRow>(
    `SELECT * FROM contest_winners WHERE contest_id = ? AND status = 'confirmed' AND source = 'site'`,
    contestId,
  );
  const { getUserTelegramChatId } = await import("./telegram-notifications.server");
  const { escapeHtml, sendTelegramMessage, telegramPublicOrigin } =
    await import("./telegram.server");
  for (const winner of winners) {
    if (!winner.user_id || (onlyWinnerId && winner.id !== onlyWinnerId)) continue;
    const chatId = await getUserTelegramChatId(winner.user_id).catch(() => undefined);
    if (!chatId) continue;
    await sendTelegramMessage(
      chatId,
      `🎉 <b>مبروك! فزت في مسابقة «${escapeHtml(row.title)}»</b>\n\n` +
        `أُضيفت <b>${escapeHtml(settings.prizeTitle || "اللعبة")}</b> إلى ألعابك. ` +
        `اضغط «استيراد» لتصلك كطلب هدية مجاني.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🎁 افتح ألعابي", url: `${telegramPublicOrigin()}/banana` }],
          ],
        },
      },
    ).catch(() => undefined);
  }
}

/* ---------------------------------------------------- winners: admin acts */

export async function confirmWinner(input: {
  adminId: string;
  winnerId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  await ensureContestSchema();
  await ensureRouletteSchema();
  const winner = await d1First<WinnerRow>(
    `SELECT * FROM contest_winners WHERE id = ?`,
    input.winnerId,
  );
  if (!winner?.id) return { ok: false, status: 404, error: "الفائز غير موجود" };
  if (winner.status !== "pending") return { ok: false, status: 409, error: "ليس بانتظار التأكيد." };
  const row = await readContestRow(winner.contest_id);
  if (!row) return { ok: false, status: 404, error: "المسابقة غير موجودة" };
  const settings = readSettings(row);
  const now = new Date().toISOString();
  const prizeId = winner.source === "site" && winner.user_id ? randomId("przw") : null;
  const statements: { sql: string; binds: unknown[] }[] = [
    {
      sql: `UPDATE contest_winners SET status = 'confirmed', prize_id = COALESCE(prize_id, ?), updated_at = ?
             WHERE id = ? AND status = 'pending'`,
      binds: [prizeId, now, winner.id],
    },
  ];
  if (prizeId && winner.user_id) {
    statements.push(
      grantPrizeStatement({
        row,
        settings,
        winnerId: winner.id,
        userId: winner.user_id,
        prizeId,
        now,
      }),
    );
  }
  await d1BatchRun(statements);
  await createAuditLog(input.adminId, "contest_winner_confirm", "contest_winner", winner.id).catch(
    () => {},
  );
  await notifyWinners(row.id, winner.id).catch(() => undefined);
  return { ok: true };
}

/**
 * A winner who broke the rules is set aside, and the next alternate from the
 * same draw takes the place — never a fresh draw.
 */
export async function disqualifyWinner(input: {
  adminId: string;
  winnerId: string;
  reason?: string;
}): Promise<{ ok: true; promoted: string | null } | { ok: false; status: number; error: string }> {
  await ensureContestSchema();
  await ensureRouletteSchema();
  const winner = await d1First<WinnerRow>(
    `SELECT * FROM contest_winners WHERE id = ?`,
    input.winnerId,
  );
  if (!winner?.id) return { ok: false, status: 404, error: "الفائز غير موجود" };
  if (winner.status === "disqualified") return { ok: false, status: 409, error: "مستبعد بالفعل." };
  if (winner.claimed_by && winner.source === "instagram") {
    return { ok: false, status: 409, error: "استلم الجائزة بالفعل." };
  }
  if (winner.prize_id) {
    const prize = await d1First<{ status: string }>(
      `SELECT status FROM roulette_prizes WHERE id = ?`,
      winner.prize_id,
    );
    if (prize?.status && prize.status !== "available") {
      return {
        ok: false,
        status: 409,
        error: "استورد اللعبة بالفعل — ألغِ طلبه من صفحة الطلبات أولاً.",
      };
    }
  }
  const row = await readContestRow(winner.contest_id);
  if (!row) return { ok: false, status: 404, error: "المسابقة غير موجودة" };
  const settings = readSettings(row);
  const now = new Date().toISOString();
  const wasWinner = winner.status === "pending" || winner.status === "confirmed";

  const statements: { sql: string; binds: unknown[] }[] = [
    {
      sql: `UPDATE contest_winners SET status = 'disqualified', note = ?, updated_at = ?
             WHERE id = ? AND status != 'disqualified'`,
      binds: [text(input.reason, 200) || "استبعده المشرف", now, winner.id],
    },
  ];
  if (winner.prize_id) {
    statements.push({
      sql: `UPDATE roulette_prizes SET status = 'expired' WHERE id = ? AND status = 'available'`,
      binds: [winner.prize_id],
    });
  }

  let promoted: string | null = null;
  if (wasWinner) {
    const next = await d1First<WinnerRow>(
      `SELECT * FROM contest_winners WHERE contest_id = ? AND status = 'standby' ORDER BY position LIMIT 1`,
      row.id,
    );
    if (next?.id) {
      promoted = next.id;
      const status = settings.requireConfirmation ? "pending" : "confirmed";
      const prizeId =
        next.source === "site" && next.user_id && status === "confirmed" ? randomId("przw") : null;
      statements.push({
        sql: `UPDATE contest_winners SET status = ?, prize_id = COALESCE(prize_id, ?), updated_at = ?
               WHERE id = ? AND status = 'standby'`,
        binds: [status, prizeId, now, next.id],
      });
      if (prizeId && next.user_id) {
        statements.push(
          grantPrizeStatement({
            row,
            settings,
            winnerId: next.id,
            userId: next.user_id,
            prizeId,
            now,
          }),
        );
      }
    }
  }
  await d1BatchRun(statements);
  await createAuditLog(
    input.adminId,
    "contest_winner_disqualify",
    "contest_winner",
    winner.id,
    null,
    null,
    {
      promoted,
    },
  ).catch(() => {});
  if (promoted) await notifyWinners(row.id, promoted).catch(() => undefined);
  return { ok: true, promoted };
}

/* -------------------------------------------- Instagram winners claim on site */

/**
 * «يضيف اللعبة في قسم جوائزي» for a winner drawn from Instagram: the admin
 * sends them their code, they enter it here, and the game is theirs.
 */
export async function claimContestPrize(input: {
  user: User;
  code: string;
}): Promise<
  { ok: true; message: string; prizeId: string } | { ok: false; status: number; error: string }
> {
  await ensureContestSchema();
  await ensureRouletteSchema();
  const code = normalizeContestCode(input.code);
  if (!code) return { ok: false, status: 400, error: "اكتب كود الجائزة كما وصلك." };
  const winner = await d1First<WinnerRow>(
    `SELECT * FROM contest_winners WHERE claim_code = ?`,
    code,
  );
  if (!winner?.id) return { ok: false, status: 404, error: "كود الجائزة غير صحيح." };
  if (winner.claimed_by) {
    return winner.claimed_by === input.user.id && winner.prize_id
      ? {
          ok: true,
          message: "استلمت هذه الجائزة من قبل — تجدها في ألعابك.",
          prizeId: winner.prize_id,
        }
      : { ok: false, status: 409, error: "استُخدم هذا الكود." };
  }
  if (winner.status === "standby") return { ok: false, status: 409, error: "هذا الكود لم يُفعّل." };
  if (winner.status === "pending") {
    return { ok: false, status: 409, error: "الجائزة بانتظار تأكيد الإدارة، أعد المحاولة لاحقاً." };
  }
  if (winner.status !== "confirmed")
    return { ok: false, status: 410, error: "هذا الكود لم يعد صالحاً." };
  const row = await readContestRow(winner.contest_id);
  if (!row) return { ok: false, status: 404, error: "المسابقة غير موجودة" };
  const settings = readSettings(row);
  const now = new Date().toISOString();
  const prizeId = randomId("przw");
  await d1BatchRun([
    {
      sql: `UPDATE contest_winners SET claimed_by = ?, claimed_at = ?, user_id = ?, prize_id = ?, updated_at = ?
             WHERE id = ? AND claimed_by IS NULL AND status = 'confirmed'`,
      binds: [input.user.id, now, input.user.id, prizeId, now, winner.id],
    },
    grantPrizeStatement({
      row,
      settings,
      winnerId: winner.id,
      userId: input.user.id,
      prizeId,
      now,
    }),
  ]);
  const after = await d1First<WinnerRow>(`SELECT * FROM contest_winners WHERE id = ?`, winner.id);
  if (after?.claimed_by !== input.user.id)
    return { ok: false, status: 409, error: "استُخدم هذا الكود." };
  await createAuditLog(input.user.id, "contest_prize_claim", "contest_winner", winner.id).catch(
    () => {},
  );
  return {
    ok: true,
    message: "مبروك! أُضيفت اللعبة إلى ألعابك ✅",
    prizeId: after.prize_id ?? prizeId,
  };
}

/* ------------------------------------------------------------ Instagram */

export async function storeInstagramComments(
  contestId: string,
  comments: readonly IgComment[],
  now = new Date().toISOString(),
): Promise<number> {
  const rows = comments.filter((c) => c.id && isIgUsername(normalizeIgUsername(c.username)));
  let stored = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const results = await d1BatchRun(
      chunk.map((comment) => ({
        sql: `INSERT OR REPLACE INTO contest_ig_comments
                (contest_id, comment_id, username, text, commented_at, is_reply, fetched_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        binds: [
          contestId,
          String(comment.id).slice(0, 80),
          normalizeIgUsername(comment.username),
          String(comment.text ?? "").slice(0, 2200),
          comment.timestamp ?? null,
          comment.isReply ? 1 : 0,
          now,
        ],
      })),
    );
    stored += results.reduce((sum, r) => sum + Number(r?.meta?.changes ?? 0), 0);
  }
  return stored;
}

export async function readInstagramComments(contestId: string): Promise<IgComment[]> {
  const rows = await d1All<{
    comment_id: string;
    username: string;
    text: string;
    commented_at: string | null;
    is_reply: number;
  }>(
    `SELECT comment_id, username, text, commented_at, is_reply FROM contest_ig_comments WHERE contest_id = ?`,
    contestId,
  );
  return rows.map((r) => ({
    id: r.comment_id,
    username: r.username,
    text: r.text,
    timestamp: r.commented_at ?? undefined,
    isReply: Number(r.is_reply) === 1,
  }));
}

/**
 * Pull the post's comments into the contest, a run of pages at a time.
 * `restart` empties what was pulled before and begins again from the newest.
 */
export async function pullInstagramComments(input: {
  contestId: string;
  restart?: boolean;
  maxPages?: number;
}): Promise<
  | { ok: true; added: number; total: number; complete: boolean }
  | { ok: false; status: number; error: string }
> {
  const row = await readContestRow(input.contestId);
  if (!row) return { ok: false, status: 404, error: "المسابقة غير موجودة" };
  if (row.status === "drawn") return { ok: false, status: 409, error: "تم السحب في هذه المسابقة." };
  const settings = readSettings(row);
  const { InstagramError, fetchCommentPages, findMediaByShortcode } =
    await import("./instagram.server");
  const { instagramShortcode } = await import("./instagramComments");
  try {
    let mediaId = input.restart ? null : row.ig_media_id;
    let cursor = input.restart ? null : row.ig_cursor;
    if (input.restart) {
      await d1Run(`DELETE FROM contest_ig_comments WHERE contest_id = ?`, row.id);
    }
    if (!mediaId) {
      const shortcode = instagramShortcode(settings.instagramUrl);
      if (!shortcode) return { ok: false, status: 400, error: "رابط منشور إنستغرام غير صالح." };
      const media = await findMediaByShortcode(shortcode);
      if (!media) {
        return {
          ok: false,
          status: 404,
          error: "لم يُعثر على المنشور في حساب المتجر — هل الرابط لمنشور من حساب المتجر نفسه؟",
        };
      }
      mediaId = media.id;
      cursor = null;
    }
    const page = await fetchCommentPages(mediaId, {
      cursor,
      maxPages: input.maxPages ?? 30,
      includeReplies: settings.igFilters.includeReplies,
    });
    const now = new Date().toISOString();
    const added = await storeInstagramComments(row.id, page.comments, now);
    await d1Run(
      `UPDATE contests SET ig_media_id = ?, ig_cursor = ?, ig_fetched_at = ?, ig_complete = ?, updated_at = ?
        WHERE id = ?`,
      mediaId,
      page.nextCursor,
      now,
      page.nextCursor ? 0 : 1,
      now,
      row.id,
    );
    const total = await d1First<{ n: number }>(
      `SELECT COUNT(*) AS n FROM contest_ig_comments WHERE contest_id = ?`,
      row.id,
    );
    return { ok: true, added, total: Number(total?.n ?? 0), complete: !page.nextCursor };
  } catch (error) {
    if (error instanceof InstagramError) return { ok: false, status: 502, error: error.message };
    throw error;
  }
}

/** Comments the admin pasted, kept like fetched ones. */
export async function importPastedComments(input: {
  contestId: string;
  raw: string;
  replace?: boolean;
}): Promise<
  { ok: true; added: number; total: number } | { ok: false; status: number; error: string }
> {
  const row = await readContestRow(input.contestId);
  if (!row) return { ok: false, status: 404, error: "المسابقة غير موجودة" };
  if (row.status === "drawn") return { ok: false, status: 409, error: "تم السحب في هذه المسابقة." };
  const { parsePastedComments } = await import("./instagramComments");
  const comments = parsePastedComments(String(input.raw ?? "").slice(0, 2_000_000));
  if (!comments.length) {
    return {
      ok: false,
      status: 400,
      error: "لم أجد تعليقات بصيغة مفهومة — سطر لكل تعليق: الحساب: النص",
    };
  }
  if (input.replace) await d1Run(`DELETE FROM contest_ig_comments WHERE contest_id = ?`, row.id);
  /* Pasted ids are only line numbers: prefix them, so two pastes do not overwrite each other. */
  const batch = input.replace ? "p" : `p${Date.now().toString(36)}`;
  const added = await storeInstagramComments(
    row.id,
    comments.map((c) => (c.id.startsWith("pasted-") ? { ...c, id: `${batch}-${c.id}` } : c)),
  );
  const total = await d1First<{ n: number }>(
    `SELECT COUNT(*) AS n FROM contest_ig_comments WHERE contest_id = ?`,
    row.id,
  );
  return { ok: true, added, total: Number(total?.n ?? 0) };
}

/** What the rules would do to the comments in hand, without drawing. */
export async function previewInstagram(input: {
  contestId: string;
  filters?: unknown;
}): Promise<InstagramPreview | null> {
  const row = await readContestRow(input.contestId);
  if (!row) return null;
  const settings = readSettings(row);
  const filters = input.filters ? normalizeIgFilters(input.filters) : settings.igFilters;
  const qualification = qualifyComments(await readInstagramComments(row.id), filters);
  return {
    stats: qualification.stats,
    sample: qualification.entrants.slice(0, 30).map((e) => ({
      username: e.username,
      comment: e.comments[0]?.text ?? "",
      mentions: e.mentions,
      comments: e.comments.length,
    })),
  };
}

/** The draw from the post's comments, with the rules saved on the contest. */
export async function drawFromInstagram(input: {
  contestId: string;
  actor: string;
  filters?: unknown;
  now?: string;
}): Promise<DrawResult> {
  await ensureContestSchema();
  const now = input.now ?? new Date().toISOString();
  const row = await readContestRow(input.contestId);
  if (!row) return { ok: false, status: 404, error: "المسابقة غير موجودة" };
  if (row.status === "drawn" && row.draw_seed) {
    return { ok: true, seed: row.draw_seed, winners: 0, alternates: 0, already: true };
  }
  if (row.status !== "open" && row.status !== "closed") {
    return { ok: false, status: 409, error: "لا يمكن السحب في مسابقة بهذه الحالة." };
  }
  let settings = readSettings(row);
  if (settings.drawSource !== "instagram") {
    return { ok: false, status: 400, error: "هذه المسابقة تُسحب من تذاكر الموقع." };
  }
  if (input.filters) {
    /* The rules used are saved with the contest, so the published draw can be re-run. */
    settings = { ...settings, igFilters: normalizeIgFilters(input.filters) };
    await d1Run(
      `UPDATE contests SET settings = ?, updated_at = ? WHERE id = ?`,
      JSON.stringify({ ...settings, prizeValue: prizeValueOf(row) }),
      now,
      row.id,
    );
  }
  const qualification = qualifyComments(await readInstagramComments(row.id), settings.igFilters);
  if (!qualification.tickets.length) {
    return {
      ok: false,
      status: 409,
      error: "لا يوجد تعليق يطابق الشروط — راجع الشروط أو اجلب التعليقات.",
    };
  }
  const tickets = qualification.tickets.map((ticket, index) => ({
    id: ticket.id,
    number: index + 1,
    holder: ticket.username,
  }));
  const byId = new Map(qualification.tickets.map((t) => [t.id, t]));
  const seed = newDrawSeed();
  const picks = await drawPicks({
    tickets,
    seed,
    winners: settings.winnersCount,
    alternates: settings.alternatesCount,
    oneWinPerHolder: settings.oneWinPerUser,
  });
  const proof = {
    algorithm: DRAW_ALGORITHM,
    seed,
    poolDigest: await poolDigest(tickets),
    poolSize: tickets.length,
    drawnAt: now,
    comments: qualification.stats.comments,
    qualifiedAccounts: qualification.stats.qualifiedAccounts,
  };
  const result = await writeDraw({
    row,
    settings,
    seed,
    proof,
    now,
    winners: picks.map((pick) => ({
      pick,
      source: "instagram" as const,
      entryNo: pick.number,
      instagramUsername: pick.holder,
      commentText: (byId.get(pick.id)?.comment.text ?? "").slice(0, 500),
    })),
  });
  if (result.ok && !result.already) {
    await createAuditLog(input.actor, "contest_draw_instagram", "contest", row.id, null, null, {
      seed,
      poolSize: proof.poolSize,
    }).catch(() => {});
  }
  return result;
}

/* ------------------------------------------------------------ the clock */

/**
 * Draw what is due. Run by the minute cron; idempotent, because a draw is.
 *
 * An Instagram contest is pulled first when the shop's account is connected —
 * across several runs if the post has many comments — and drawn once the last
 * page is in. Without the connection it is closed for the admin to draw.
 */
export async function settleDueContests(now = new Date().toISOString()): Promise<number> {
  if (!getD1()) return 0;
  await ensureContestSchema();
  const due = await d1All<{ id: string; draw_source: string; ig_complete: number }>(
    `SELECT id, draw_source, ig_complete FROM contests
      WHERE status = 'open' AND auto_draw = 1 AND ends_at IS NOT NULL AND ends_at <= ?
      ORDER BY ends_at LIMIT 3`,
    now,
  );
  let settled = 0;
  for (const contest of due) {
    if (contest.draw_source === "instagram") {
      const { instagramConfigured } = await import("./instagram.server");
      if (!instagramConfigured()) {
        await d1Run(
          `UPDATE contests SET status = 'closed', closed_at = COALESCE(closed_at, ?), updated_at = ?
            WHERE id = ? AND status = 'open'`,
          now,
          now,
          contest.id,
        );
        continue;
      }
      if (Number(contest.ig_complete) !== 1) {
        const pulled = await pullInstagramComments({ contestId: contest.id, maxPages: 20 }).catch(
          () => null,
        );
        if (!pulled || !pulled.ok || !pulled.complete) continue;
      }
      const drawn = await drawFromInstagram({ contestId: contest.id, actor: "system", now });
      if (drawn.ok) settled += 1;
      continue;
    }
    const drawn = await drawContest({ contestId: contest.id, actor: "system", now });
    if (drawn.ok) settled += 1;
  }
  return settled;
}

/* ---------------------------------------------------------- member views */

async function winnersOf(contestId: string): Promise<WinnerRow[]> {
  return d1All<WinnerRow>(
    `SELECT * FROM contest_winners WHERE contest_id = ? ORDER BY position`,
    contestId,
  );
}

function proofOf(row: ContestRow): ContestDrawProof | null {
  if (!row.draw_proof) return null;
  try {
    const parsed = JSON.parse(row.draw_proof) as ContestDrawProof;
    return parsed?.seed ? parsed : null;
  } catch {
    return null;
  }
}

/** A contest as the member (or a visitor) sees it. */
export async function contestView(row: ContestRow, viewer?: User | null): Promise<ContestView> {
  const settings = readSettings(row);
  const phase = contestPhase({
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  });
  const counts = await countEntries(row.id);
  const allWinners = await winnersOf(row.id);
  const winners = allWinners
    .filter((w) => w.status === "pending" || w.status === "confirmed")
    .map<ContestWinnerView>((w) => ({
      position: w.position,
      entryNo: w.entry_no ?? null,
      name:
        w.source === "instagram"
          ? `@${w.instagram_username ?? ""}`
          : maskName(String(w.display_name ?? "")),
      source: w.source,
      status: w.status as "pending" | "confirmed",
    }));

  const view: ContestView = {
    id: row.id,
    drawSource: settings.drawSource,
    title: row.title,
    description: settings.description,
    conditions: settings.conditions,
    instagramUrl: settings.instagramUrl,
    prize: {
      productId: settings.productId,
      title: settings.prizeTitle,
      image: settings.prizeImage,
      note: settings.prizeNote,
    },
    winnersCount: settings.winnersCount,
    entryMethods: settings.entryMethods,
    bananaCost: settings.bananaCost,
    maxEntriesPerUser: settings.maxEntriesPerUser,
    maxParticipants: settings.maxParticipants,
    referralQualifier: settings.referralQualifier,
    requirements: {
      telegram: settings.requireTelegram,
      minCompletedOrders: settings.minCompletedOrders,
      minAccountAgeDays: settings.minAccountAgeDays,
    },
    startsAt: row.starts_at ?? "",
    endsAt: row.ends_at ?? "",
    phase,
    participants: settings.showEntrants ? counts.participants : null,
    tickets: settings.showEntrants ? counts.tickets : null,
    winners,
    proof: phase === "drawn" ? proofOf(row) : null,
  };

  if (viewer?.id) {
    const mine = await memberEntries(row.id, viewer.id);
    const byMethod: Partial<Record<ContestEntryMethod, number>> = {};
    for (const entry of mine) byMethod[entry.method] = (byMethod[entry.method] ?? 0) + 1;
    const won = allWinners.some(
      (w) => w.user_id === viewer.id && (w.status === "pending" || w.status === "confirmed"),
    );
    view.mine = {
      tickets: mine.length,
      byMethod,
      entryNumbers: mine.map((entry) => Number(entry.entry_no)),
      blockers: await entryBlockers(row, settings, viewer, mine.length, counts.participants),
      won,
    };
  }
  return view;
}

const PHASE_ORDER: Record<string, number> = {
  open: 0,
  upcoming: 1,
  ended: 2,
  drawn: 3,
  cancelled: 4,
  draft: 5,
};

/**
 * Every published contest, open ones first.
 *
 * It draws nothing: the minute cron does, so a member opening the page never
 * waits on a draw or on Instagram. A contest past its end reads «انتهت» and
 * refuses entries from the moment it is due.
 */
export async function listContestViews(viewer?: User | null): Promise<ContestView[]> {
  if (!getD1()) return [];
  await ensureContestSchema();
  const rows = await d1All<ContestRow>(
    `SELECT * FROM contests WHERE status IN ('open', 'closed', 'drawn') ORDER BY created_at DESC LIMIT 30`,
  );
  const views: ContestView[] = [];
  for (const row of rows) views.push(await contestView(row, viewer));
  return views.sort(
    (a, b) =>
      (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9) ||
      Date.parse(b.endsAt || "0") - Date.parse(a.endsAt || "0"),
  );
}

/* ----------------------------------------------------------- admin views */

export async function adminListContests(): Promise<AdminContestRow[]> {
  await ensureContestSchema();
  const rows = await d1All<ContestRow>(`SELECT * FROM contests ORDER BY created_at DESC LIMIT 100`);
  const counts = await d1All<{ contest_id: string; tickets: number; participants: number }>(
    `SELECT contest_id, COUNT(*) AS tickets, COUNT(DISTINCT user_id) AS participants
       FROM contest_entries WHERE removed_at IS NULL GROUP BY contest_id`,
  );
  const byId = new Map(counts.map((c) => [c.contest_id, c]));
  return rows.map((row) => {
    const settings = readSettings(row);
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      phase: contestPhase({
        status: row.status,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      }),
      drawSource: settings.drawSource,
      prizeTitle: settings.prizeTitle,
      prizeImage: settings.prizeImage,
      startsAt: row.starts_at ?? "",
      endsAt: row.ends_at ?? "",
      tickets: Number(byId.get(row.id)?.tickets ?? 0),
      participants: Number(byId.get(row.id)?.participants ?? 0),
      createdAt: row.created_at,
    };
  });
}

export async function adminContestDetail(id: string): Promise<AdminContestDetail | null> {
  const row = await readContestRow(id);
  if (!row) return null;
  const settings = readSettings(row);
  const counts = await countEntries(row.id);
  const byMethod = await d1All<{ method: string; n: number }>(
    `SELECT method, COUNT(*) AS n FROM contest_entries
      WHERE contest_id = ? AND removed_at IS NULL GROUP BY method`,
    row.id,
  );
  const entries = await d1All<
    EntryRow & { removed_reason: string | null; name: string | null; username: string | null }
  >(
    `SELECT e.id, e.user_id, e.method, e.entry_no, e.ticket_code, e.referral_ref, e.bananas_spent,
            e.removed_at, e.removed_reason, e.created_at, u.name, u.username
       FROM contest_entries e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.contest_id = ? ORDER BY e.entry_no DESC LIMIT 400`,
    row.id,
  );
  const tickets = await d1All<{
    code: string;
    note: string | null;
    created_at: string;
    redeemed_by: string | null;
    redeemed_at: string | null;
    revoked_at: string | null;
  }>(
    `SELECT code, note, created_at, redeemed_by, redeemed_at, revoked_at
       FROM contest_tickets WHERE contest_id = ? ORDER BY created_at DESC LIMIT 400`,
    row.id,
  );
  const winners = await winnersOf(row.id);
  const ig = await d1First<{ n: number }>(
    `SELECT COUNT(*) AS n FROM contest_ig_comments WHERE contest_id = ?`,
    row.id,
  );
  const { instagramConfigured } = await import("./instagram.server");
  return {
    contest: {
      id: row.id,
      status: row.status,
      phase: contestPhase({
        status: row.status,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      }),
      settings,
      proof: proofOf(row),
      createdAt: row.created_at,
      drawnAt: row.drawn_at,
      closedAt: row.closed_at,
    },
    stats: {
      ...counts,
      byMethod: Object.fromEntries(byMethod.map((m) => [m.method, Number(m.n)])),
      ticketsCreated: tickets.length,
      ticketsRedeemed: tickets.filter((t) => t.redeemed_by).length,
    },
    entries: entries.map((e) => ({
      id: e.id,
      userId: e.user_id,
      name: e.name || e.username || "عضو",
      username: e.username,
      method: e.method,
      entryNo: Number(e.entry_no),
      ticketCode: e.ticket_code ? formatContestCode(e.ticket_code) : null,
      bananas: Number(e.bananas_spent ?? 0),
      removedAt: e.removed_at,
      removedReason: e.removed_reason,
      createdAt: e.created_at,
    })),
    tickets: tickets.map((t) => ({
      code: formatContestCode(t.code),
      note: t.note,
      createdAt: t.created_at,
      redeemedBy: t.redeemed_by,
      redeemedAt: t.redeemed_at,
      revokedAt: t.revoked_at,
    })),
    winners: winners.map((w) => ({
      id: w.id,
      position: w.position,
      alternate: Number(w.alternate) === 1,
      status: w.status,
      source: w.source,
      entryNo: w.entry_no,
      userId: w.user_id,
      name: w.display_name,
      instagramUsername: w.instagram_username,
      comment: w.comment_text,
      claimCode: w.claim_code ? formatContestCode(w.claim_code) : null,
      claimedBy: w.claimed_by,
      claimedAt: w.claimed_at,
      prizeId: w.prize_id,
      note: w.note,
    })),
    instagram: {
      configured: instagramConfigured(),
      comments: Number(ig?.n ?? 0),
      fetchedAt: row.ig_fetched_at,
      complete: Number(row.ig_complete) === 1,
    },
  };
}
