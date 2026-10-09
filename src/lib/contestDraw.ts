/**
 * The draw: which tickets win, decided by the system and checkable afterwards.
 *
 *   «يكون السحب عادل عن طريق النظام يحدد التذكرة الفائزة»
 *
 * Fair here means three things, and each is a property of this code rather
 * than a promise:
 *
 * - NOBODY PICKS. The seed is 32 bytes from the platform's cryptographic
 *   random source, made at the moment of the draw. The admin presses «اسحب»;
 *   they never see a list to choose from.
 * - ONE DRAW. Winners and their alternates come out of the same draw, in
 *   order. Replacing a winner who broke the rules promotes the next alternate
 *   from that draw — it never draws again, so there is no re-rolling until a
 *   friend comes up.
 * - ANYONE CAN CHECK. The seed is published with the result. Given the seed
 *   and the numbered tickets — both shown — the same picks fall out of
 *   `drawPicks` every time: HMAC-SHA-256 over a counter, with rejection
 *   sampling, so every remaining ticket is exactly as likely as any other.
 *
 * Shared by the server, which draws, and anything that wants to verify one.
 */

/** Named in every proof, so a later change of method cannot pass for this one. */
export const DRAW_ALGORITHM = "hmac-sha256-rejection-v1";

export type DrawTicket = {
  /** what the pick refers back to: an entry, or an Instagram comment */
  id: string;
  /** the ticket's public number, the order the pool is drawn in */
  number: number;
  /** who holds it: one person can hold several tickets */
  holder: string;
};

export type DrawPick = DrawTicket & {
  /** 1-based: 1 is the first winner, and alternates continue the count */
  position: number;
  alternate: boolean;
};

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) throw new Error("invalid_seed");
  const out = new Uint8Array(new ArrayBuffer(clean.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A fresh seed: 32 random bytes, as hex. */
export function newDrawSeed(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 of a text, as hex. */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/**
 * The pool's fingerprint: every ticket's number and holder, in draw order.
 * Published beside the seed, it pins down exactly which tickets were drawn
 * from — a ticket added or removed afterwards changes it.
 */
export async function poolDigest(tickets: readonly DrawTicket[]): Promise<string> {
  const ordered = [...tickets].sort((a, b) => a.number - b.number);
  return sha256Hex(ordered.map((t) => `${t.number}:${t.holder}`).join("\n"));
}

/**
 * A stream of uniform indices below `n`, from the seed.
 *
 * Each step is HMAC-SHA-256(seed, "draw:<counter>"); its first four bytes are
 * a 32-bit number, kept only when it falls under the largest multiple of `n`
 * — the rejection that keeps `% n` from favouring the low indices.
 */
async function makeIndexer(seedHex: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    fromHex(seedHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  let counter = 0;
  return async (n: number): Promise<number> => {
    if (!Number.isInteger(n) || n <= 0) throw new Error("empty_pool");
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    for (;;) {
      const mac = new Uint8Array(
        await crypto.subtle.sign("HMAC", key, encoder.encode(`draw:${counter}`)),
      );
      counter += 1;
      const value = ((mac[0]! << 24) | (mac[1]! << 16) | (mac[2]! << 8) | mac[3]!) >>> 0;
      if (value < limit) return value % n;
    }
  };
}

/**
 * Draw `winners` tickets, then `alternates` more, from the pool.
 *
 * The pool is taken in ticket-number order, whatever order it was given in.
 * With `oneWinPerHolder`, a holder's other tickets leave the pool once one of
 * theirs is picked: several tickets raise a member's chance, never their
 * number of prizes.
 */
export async function drawPicks(input: {
  tickets: readonly DrawTicket[];
  seed: string;
  winners: number;
  alternates?: number;
  oneWinPerHolder?: boolean;
}): Promise<DrawPick[]> {
  const winners = Math.max(0, Math.floor(input.winners));
  const wanted = winners + Math.max(0, Math.floor(input.alternates ?? 0));
  let pool = [...input.tickets].sort((a, b) => a.number - b.number);
  const next = await makeIndexer(input.seed);
  const picks: DrawPick[] = [];
  while (picks.length < wanted && pool.length > 0) {
    const index = await next(pool.length);
    const ticket = pool[index]!;
    picks.push({ ...ticket, position: picks.length + 1, alternate: picks.length >= winners });
    pool =
      input.oneWinPerHolder === false
        ? pool.filter((t) => t.id !== ticket.id)
        : pool.filter((t) => t.holder !== ticket.holder);
  }
  return picks;
}
