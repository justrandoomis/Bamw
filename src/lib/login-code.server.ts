/**
 * Accounts that sign in with a login code alone — see src/lib/loginCode.ts.
 *
 * The code is shown to the member once, when it is made, and never stored:
 * the database keeps a SHA-256 of it, which is enough to recognise it and
 * useless for reading it back. That is why the member is asked to keep it,
 * and why a lost code is replaced rather than recovered.
 *
 * A plain hash and not a slow one on purpose. A slow hash protects passwords
 * people choose, which are guessable; this code has 80 random bits, so there
 * is nothing to guess, and a fast hash lets sign-in look it up by index.
 */
import {
  createCodeUser,
  findUserByLoginCodeHash,
  findUserByUsername,
  markUserLoginCodeSaved,
  setUserLoginCodeHash,
} from "./db.server";
import {
  formatLoginCode,
  generateLoginCode,
  normalizeLoginCode,
  normalizeUsername,
  usernameProblem,
  type UsernameProblem,
} from "./loginCode";
import type { User } from "./types";

export async function hashLoginCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`bananto-login-code:v1:${code}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type UsernameVerdict =
  | { available: true; username: string }
  | { available: false; username: string; problem: UsernameProblem | "taken" };

/** Whether a username can be had, and if not, why. */
export async function usernameVerdict(raw: string): Promise<UsernameVerdict> {
  const username = normalizeUsername(raw);
  const problem = usernameProblem(username);
  if (problem) return { available: false, username, problem };
  if (await findUserByUsername(username)) return { available: false, username, problem: "taken" };
  return { available: true, username };
}

export type CodeAccountResult =
  | { ok: true; user: User; code: string }
  | { ok: false; username: string; problem: UsernameProblem | "taken" };

/**
 * A new account under `raw`, and the login code that opens it, formatted for
 * the member to keep. The only time the code exists outside their hands.
 */
export async function createCodeAccount(raw: string): Promise<CodeAccountResult> {
  const verdict = await usernameVerdict(raw);
  if (!verdict.available)
    return { ok: false, username: verdict.username, problem: verdict.problem };
  const code = generateLoginCode();
  const user = await createCodeUser({
    username: verdict.username,
    loginCodeHash: await hashLoginCode(code),
  });
  if (!user) return { ok: false, username: verdict.username, problem: "taken" };
  return { ok: true, user, code: formatLoginCode(code) };
}

/** The account a typed code opens, or undefined. */
export async function findUserByLoginCode(raw: string): Promise<User | undefined> {
  const code = normalizeLoginCode(raw);
  if (!code) return undefined;
  return findUserByLoginCodeHash(await hashLoginCode(code));
}

/** Replace an account's login code; the old one stops working at once. */
export async function issueNewLoginCode(userId: string): Promise<string> {
  const code = generateLoginCode();
  await setUserLoginCodeHash(userId, await hashLoginCode(code));
  return formatLoginCode(code);
}

export async function confirmLoginCodeSaved(userId: string): Promise<void> {
  await markUserLoginCodeSaved(userId);
}
