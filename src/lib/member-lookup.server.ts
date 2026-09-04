/**
 * Finding a member by what an operator actually knows about them.
 *
 * ## What this replaces
 *
 * The coupon screen's "who may use this" picker, which downloaded the entire
 * members table — `GET /api/admin/users` returns every account with
 * `toPublicUser`, so every name, email, phone, wallet balance and saved
 * address in the shop — and then matched the operator's typing against it in
 * the browser. It filled a picker that shows at most forty rows.
 *
 * Two things wrong with that, and the second is the one that matters:
 *
 *   1. It grows without limit. The response is the whole table on every open
 *      of the coupons screen, and nothing about it gets smaller as the shop
 *      does better.
 *   2. It puts the entire customer list in a browser to answer a question
 *      about one person. The screen only ever needed to turn "٠٧٧٠…" into an
 *      account id.
 *
 * So the question is answered where the data already is, and only the matches
 * come back — with only the fields needed to recognise a person and no others.
 *
 * ## Why phones are matched twice
 *
 * A member's phone is stored normalised: `+9647701234567`. Operators do not
 * type it that way — they read "07701234567" off a message, or paste it with
 * spaces, or type it in Arabic-Indic digits. `normalizePhone` turns all of
 * those into the stored form, so the term is tried both as written and as
 * normalised, and either finds the member.
 */

import { d1All, d1Ready } from "./d1.server";
import { normalizePhone } from "./phone";
import { assertBoundParameters, chunkForParams } from "./sql-params";
import type { MemberMatch } from "./types";

const MAX_RESULTS = 25;

interface MemberRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  member_no: string | null;
  username: string | null;
}

const COLUMNS = `id, name, email, phone, member_no, username`;

function toMatch(row: MemberRow): MemberMatch {
  return {
    id: String(row.id),
    name: row.name ?? "",
    email: row.email ?? "",
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.member_no ? { memberNo: row.member_no } : {}),
    ...(row.username ? { username: row.username } : {}),
  };
}

/** `%` and `_` are wildcards; a term holding one must not widen the search. */
function likeTerm(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * Members matching what the operator typed: a name, an email, a phone, a
 * member number, a username, or the account id itself.
 *
 * Returns nothing for a blank term rather than everybody — an empty search box
 * is not a request for the whole customer list.
 */
export async function searchMembers(term: string, limit = MAX_RESULTS): Promise<MemberMatch[]> {
  const needle = (term ?? "").trim();
  if (!needle) return [];
  if (!(await d1Ready())) return [];

  const capped = Math.min(MAX_RESULTS, Math.max(1, Math.trunc(Number(limit) || MAX_RESULTS)));
  const lowered = needle.toLowerCase();
  const like = likeTerm(lowered);
  const binds: unknown[] = [like, like, like, like, like];

  /*
    The phone as typed and the phone as stored. `normalizePhone` returns
    nothing for a term that is not a phone at all, in which case the extra
    clause is simply not added.
  */
  const normalized = normalizePhone(needle);
  const phoneClause = normalized ? ` OR phone LIKE ? ESCAPE '\\'` : "";
  if (normalized) binds.push(likeTerm(normalized));

  const rows = await d1All<MemberRow>(
    `SELECT ${COLUMNS} FROM users
      WHERE lower(name) LIKE ? ESCAPE '\\'
         OR lower(email) LIKE ? ESCAPE '\\'
         OR lower(id) LIKE ? ESCAPE '\\'
         OR lower(COALESCE(username, '')) LIKE ? ESCAPE '\\'
         OR COALESCE(member_no, '') LIKE ? ESCAPE '\\'${phoneClause}
      ORDER BY created_at DESC
      LIMIT ?`,
    ...binds,
    capped,
  );
  return rows.map(toMatch);
}

/**
 * The members behind a set of ids, for showing names beside a saved list.
 *
 * A coupon restricted to three accounts stores three ids. Without this the
 * screen can only show the ids back, which tells the operator nothing about
 * who they restricted it to — and re-downloading every member to find three of
 * them is what this module exists to stop.
 */
export async function membersByIds(ids: readonly string[]): Promise<MemberMatch[]> {
  const wanted = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (wanted.length === 0) return [];
  if (!(await d1Ready())) return [];

  const found: MemberMatch[] = [];
  /*
    D1 refuses a statement with more than a hundred bound parameters, so the
    ids are split into statements that fit — the same guard the product index
    and the trade photos use, and the one `sql-bounds-audit.test.ts` exists to
    make sure a new dynamic statement cannot skip.
  */
  for (const group of chunkForParams(wanted, 1)) {
    const placeholders = group.map(() => "?").join(",");
    assertBoundParameters("membersByIds", group);
    const rows = await d1All<MemberRow>(
      `SELECT ${COLUMNS} FROM users WHERE id IN (${placeholders})`,
      ...group,
    );
    found.push(...rows.map(toMatch));
  }
  return found;
}

export type { MemberMatch };
