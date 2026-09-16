/**
 * Where to put a visitor back after they sign in.
 *
 * A member tapping «المحفظة» while signed out used to be shown the wallet with
 * no balance in it and an English toast reading «unauthorised». Sending them to
 * /auth instead is only half an answer: arriving at the profile afterwards,
 * having asked for the wallet, is its own small insult. So the page they asked
 * for is remembered while they sign in, and they are returned to it.
 *
 * `sessionStorage`, not the URL: this is one tab's business, it should not
 * survive being closed, and it must never end up in a link somebody shares.
 * Every access is guarded — Safari's private mode throws on the whole API
 * rather than returning null, and a sign-in screen that throws is worse than
 * one that forgets where you were going.
 */
const KEY = "bananto:after-sign-in";

/** Only a path inside this site, so a stored value can never send anyone off it. */
function isSafePath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith("/")) return false;
  // `//host` and `/\host` are both read as protocol-relative URLs by browsers.
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  if (value === "/auth") return false;
  return true;
}

export function rememberAfterSignIn(path: string): void {
  if (!isSafePath(path)) return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    /* Private mode, or storage refused. The visitor lands on /profile instead. */
  }
}

/** Reads and clears in one step, so a stale path cannot redirect a later visit. */
export function takeAfterSignIn(): string | null {
  try {
    const stored = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return isSafePath(stored) ? stored : null;
  } catch {
    return null;
  }
}
