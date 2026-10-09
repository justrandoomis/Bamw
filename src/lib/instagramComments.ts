/**
 * Instagram comments, judged against a contest's rules.
 *
 *   «أضف نظام أنه يسحب الفائز بشكل تلقائي من التعليقات في الانستغرام إذا طبق
 *    شروط ... إذا كان التعليق مكرر يسحب تعليق واحد فقط مع عمل شروط مثلاً تعليق
 *    نصي، عمل تاج للأصدقاء وغيرها»
 *
 * The comments come from the Graph API or from a pasted export; either way
 * they arrive here as plain records, and everything this file decides is a
 * pure function of them and of the filters — so the same comments and the
 * same rules always qualify the same people, and a test can say so.
 *
 * What a comment-picker has to get right, and this does:
 * - one person, one ticket: an account that comments forty times is one
 *   entrant, unless the admin deliberately counts every comment;
 * - a person qualifies if ANY of their comments meets the rules — the
 *   comment with three tags counts even when the next one is only an emoji;
 * - a tag is a real account: not the commenter, not the shop, not an email
 *   address, and the same friend tagged twice is one tag;
 * - Arabic is compared as Arabic is written: with or without hamza, taa
 *   marbuta or tashkeel, «أبطال» and «ابطال» are the same word.
 */

export type IgComment = {
  id: string;
  username: string;
  text: string;
  /** ISO time the comment was posted, when known */
  timestamp?: string | undefined;
  /** a reply under another comment rather than a comment on the post */
  isReply?: boolean | undefined;
};

export type IgFilters = {
  /** one ticket per account (default), or one per qualifying comment */
  oneEntryPerUser: boolean;
  /** distinct accounts a single comment must tag */
  minMentions: number;
  /** the comment must say something in words, not only tags and emoji */
  requireText: boolean;
  /** words or #hashtags that must ALL appear in the comment */
  requiredWords: string[];
  /** words that disqualify the comment */
  bannedWords: string[];
  /** minimum characters, tags and spaces not counted */
  minLength: number;
  /** accounts that cannot win: the shop, its staff, past winners */
  excludeAccounts: string[];
  /** count replies under other comments too (off: comments on the post only) */
  includeReplies: boolean;
  /** comments after this moment do not count (ISO) */
  before?: string | undefined;
};

export const DEFAULT_IG_FILTERS: IgFilters = {
  oneEntryPerUser: true,
  minMentions: 0,
  requireText: false,
  requiredWords: [],
  bannedWords: [],
  minLength: 0,
  excludeAccounts: [],
  includeReplies: false,
};

export type IgRejection =
  "reply" | "late" | "excluded" | "mentions" | "text" | "length" | "required" | "banned";

export const IG_REJECTION_LABELS: Record<IgRejection, string> = {
  reply: "ردّ على تعليق",
  late: "بعد الموعد",
  excluded: "حساب مستبعد",
  mentions: "تاغات أقل من المطلوب",
  text: "بلا نص",
  length: "أقصر من المطلوب",
  required: "ينقصه كلمة مطلوبة",
  banned: "فيه كلمة ممنوعة",
};

export type IgEntrant = {
  username: string;
  /** the comments that met the rules, oldest first */
  comments: IgComment[];
  /** the most tags any one of them carried */
  mentions: number;
};

export type IgQualification = {
  entrants: IgEntrant[];
  /** one per entrant, or one per qualifying comment — what the draw picks from */
  tickets: { id: string; username: string; comment: IgComment }[];
  stats: {
    comments: number;
    accounts: number;
    qualifiedComments: number;
    qualifiedAccounts: number;
    duplicatesDropped: number;
    rejected: Partial<Record<IgRejection, number>>;
  };
};

/** Instagram's own rule: letters, digits, dots and underscores, at most 30. */
const USERNAME = /^[a-z0-9._]{1,30}$/;

export function normalizeIgUsername(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
}

export function isIgUsername(value: string): boolean {
  return USERNAME.test(value) && !value.endsWith(".");
}

/**
 * The accounts a comment tags: distinct, lower-cased, without a trailing dot
 * (a sentence can end straight after a tag). An address like a@b.com is not a
 * tag: what comes before the @ is part of a word.
 */
export function extractMentions(text: string): string[] {
  const found = new Set<string>();
  for (const match of String(text ?? "").matchAll(/(^|[^\w.@])@([A-Za-z0-9._]{1,30})/g)) {
    const name = match[2]!.toLowerCase().replace(/\.+$/, "");
    if (name && isIgUsername(name)) found.add(name);
  }
  return [...found];
}

/** Arabic and Latin text, folded so spelling variants compare equal. */
export function foldText(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "") // tashkeel and tatweel
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

/** The comment with its tags removed: what is left to read. */
function wordsOnly(text: string): string {
  return String(text ?? "")
    .replace(/(^|[^\w.@])@[A-Za-z0-9._]{1,30}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** At least two letters, in any script: emoji and punctuation alone are not text. */
function hasWords(text: string): boolean {
  return (wordsOnly(text).match(/\p{L}/gu) ?? []).length >= 2;
}

function splitWords(list: string[] | string | undefined): string[] {
  const items = Array.isArray(list) ? list : String(list ?? "").split(/[,،\n]/);
  return items.map((w) => foldText(w).trim()).filter(Boolean);
}

/** Why a comment does not count, or null when it does. */
export function rejectComment(comment: IgComment, filters: IgFilters): IgRejection | null {
  const username = normalizeIgUsername(comment.username);
  const excluded = new Set(filters.excludeAccounts.map(normalizeIgUsername).filter(Boolean));
  if (comment.isReply && !filters.includeReplies) return "reply";
  if (filters.before && comment.timestamp) {
    const at = Date.parse(comment.timestamp);
    const limit = Date.parse(filters.before);
    if (Number.isFinite(at) && Number.isFinite(limit) && at > limit) return "late";
  }
  if (!username || excluded.has(username)) return "excluded";
  if (filters.minMentions > 0) {
    const tags = extractMentions(comment.text).filter((m) => m !== username && !excluded.has(m));
    if (tags.length < filters.minMentions) return "mentions";
  }
  if (filters.requireText && !hasWords(comment.text)) return "text";
  if (filters.minLength > 0 && wordsOnly(comment.text).length < filters.minLength) return "length";
  const folded = foldText(comment.text);
  const required = splitWords(filters.requiredWords);
  if (required.some((word) => !folded.includes(word))) return "required";
  const banned = splitWords(filters.bannedWords);
  if (banned.some((word) => folded.includes(word))) return "banned";
  return null;
}

/**
 * Who qualifies, and with how many tickets.
 *
 * Comments are taken oldest first, so with one ticket per person the ticket
 * carries their FIRST qualifying comment — the one that was on time.
 */
export function qualifyComments(
  comments: readonly IgComment[],
  input: Partial<IgFilters> = {},
): IgQualification {
  const filters: IgFilters = { ...DEFAULT_IG_FILTERS, ...input };
  const ordered = [...comments].sort(
    (a, b) => (Date.parse(a.timestamp ?? "") || 0) - (Date.parse(b.timestamp ?? "") || 0),
  );
  const seenIds = new Set<string>();
  const accounts = new Set<string>();
  const rejected: Partial<Record<IgRejection, number>> = {};
  const byUser = new Map<string, IgEntrant>();
  let qualifiedComments = 0;

  for (const comment of ordered) {
    if (comment.id && seenIds.has(comment.id)) continue;
    if (comment.id) seenIds.add(comment.id);
    const username = normalizeIgUsername(comment.username);
    if (username) accounts.add(username);
    const reason = rejectComment(comment, filters);
    if (reason) {
      rejected[reason] = (rejected[reason] ?? 0) + 1;
      continue;
    }
    qualifiedComments += 1;
    const tags = extractMentions(comment.text).filter((m) => m !== username).length;
    const entrant = byUser.get(username) ?? { username, comments: [], mentions: 0 };
    entrant.comments.push({ ...comment, username });
    entrant.mentions = Math.max(entrant.mentions, tags);
    byUser.set(username, entrant);
  }

  const entrants = [...byUser.values()];
  const tickets = filters.oneEntryPerUser
    ? entrants.map((e) => ({
        id: e.comments[0]!.id,
        username: e.username,
        comment: e.comments[0]!,
      }))
    : entrants.flatMap((e) =>
        e.comments.map((c) => ({ id: c.id, username: e.username, comment: c })),
      );

  return {
    entrants,
    tickets,
    stats: {
      comments: seenIds.size || ordered.length,
      accounts: accounts.size,
      qualifiedComments,
      qualifiedAccounts: entrants.length,
      duplicatesDropped: filters.oneEntryPerUser ? qualifiedComments - entrants.length : 0,
      rejected,
    },
  };
}

/**
 * Comments pasted by the admin, from an export or copied by hand.
 *
 * Takes a JSON array (`username`/`text`/`timestamp`, or the Graph API's own
 * `from.username`), CSV with a header naming `username` and `text`, or one
 * comment per line as «username: text» or «@username text».
 */
export function parsePastedComments(raw: string): IgComment[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];

  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { data?: unknown[] })?.data)
          ? (parsed as { data: unknown[] }).data
          : [];
      return list
        .map((item, index) => {
          const row = item as Record<string, unknown>;
          const from = row["from"] as { username?: string } | undefined;
          const username = normalizeIgUsername(
            String(row["username"] ?? from?.username ?? row["user"] ?? row["owner"] ?? ""),
          );
          return {
            id: String(row["id"] ?? `pasted-${index + 1}`),
            username,
            text: String(row["text"] ?? row["comment"] ?? row["body"] ?? ""),
            timestamp: row["timestamp"] ? String(row["timestamp"]) : undefined,
            isReply: Boolean(row["isReply"] ?? row["parent_id"]),
          };
        })
        .filter((c) => isIgUsername(c.username));
    } catch {
      /* not JSON after all: read it as lines */
    }
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const header = lines[0]?.toLowerCase() ?? "";
  if (/(^|,)\s*"?username"?\s*(,|$)/.test(header) && header.includes("text")) {
    const columns = splitCsvLine(lines[0]!).map((c) => c.toLowerCase());
    const at = (name: string) => columns.indexOf(name);
    return lines
      .slice(1)
      .filter(Boolean)
      .map((line, index) => {
        const cells = splitCsvLine(line);
        return {
          id: (at("id") >= 0 && cells[at("id")]) || `pasted-${index + 1}`,
          username: normalizeIgUsername(cells[at("username")] ?? ""),
          text: cells[at("text")] ?? "",
          timestamp: at("timestamp") >= 0 ? cells[at("timestamp")] || undefined : undefined,
        };
      })
      .filter((c) => isIgUsername(c.username));
  }

  const comments: IgComment[] = [];
  lines.forEach((line, index) => {
    if (!line) return;
    const match =
      /^@?([A-Za-z0-9._]{1,30})\s*[:：\-–—]\s*(.*)$/.exec(line) ??
      /^@([A-Za-z0-9._]{1,30})\s+(.*)$/.exec(line);
    if (!match) return;
    const username = normalizeIgUsername(match[1]!);
    if (!isIgUsername(username)) return;
    comments.push({ id: `pasted-${index + 1}`, username, text: match[2] ?? "" });
  });
  return comments;
}

/** One CSV line, honouring double quotes. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

/** The post a link points at: its shortcode, from /p/, /reel/ or /tv/ links. */
export function instagramShortcode(url: string): string | null {
  const match =
    /instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/i.exec(
      String(url ?? ""),
    );
  return match ? match[1]! : null;
}
