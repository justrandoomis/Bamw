// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The delivery code is the customer's own 2FA code, relayed — never ours.
 *
 * When a member buys a game account, the code that arrives during handover
 * comes from the publisher and is typed in by whoever is delivering. If any
 * part of that path ever generated one instead, the store would be handing a
 * customer a number that unlocks nothing while telling them it does, and the
 * failure would look exactly like a delivery that worked.
 *
 * A unit test cannot prove a negative about a whole subsystem, so this is a
 * source audit: it names the modules the delivery path is made of and asserts
 * that none of them can produce a code. The account-verification OTP the store
 * sends to its own members is a different thing and lives in `otp.server.ts`,
 * which is deliberately outside this set.
 */

/** Every module the delivery hand-over actually runs through. */
const DELIVERY_PATH = [
  "src/lib/order-delivery-items.server.ts",
  "src/lib/order-delivery.server.ts",
  "src/lib/delivery-items.server.ts",
  "src/lib/delivery-items.ts",
  "src/lib/delivery-kinds.ts",
  "src/lib/delivery-otp.ts",
  "src/lib/digital-delivery-state.ts",
  "src/lib/order-completion.server.ts",
  "src/lib/support/engine.ts",
];

/**
 * Files whose name says "delivery" and whose subject is not the hand-over.
 *
 * This codebase uses the word for two unrelated things: handing a member their
 * game account, and the courier who carries a console. `delivery-fee.ts`
 * computes «رسوم التوصيل» from the shop's base fee and its per-city list, and
 * has no idea a code exists. Excluded by name, with the reason written down,
 * rather than by loosening the sweep that catches a real new module.
 */
const NOT_THE_HANDOVER = ["src/lib/delivery-fee.ts"];

/** Anything that could invent a number to hand to a customer. */
const GENERATORS =
  /\b(Math\s*\.\s*random|crypto\s*\.\s*getRandomValues|randomInt|generateSecureOtpCode|nanoid)\b/;

function sourceOf(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), "utf8");
}

describe("the delivery code is never fabricated", () => {
  it("has no generator anywhere in the delivery path", () => {
    const offenders: string[] = [];
    for (const file of DELIVERY_PATH) {
      const text = sourceOf(file);
      for (const [index, line] of text.split("\n").entries()) {
        // A comment saying the word is the point; a call is the problem.
        const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        if (GENERATORS.test(code)) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    }
    expect(
      offenders,
      `a code generator reached the delivery path:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("refuses to advance a delivery without a code somebody supplied", () => {
    const text = sourceOf("src/lib/order-delivery-items.server.ts");
    /*
      The guard, not a substitute for it: an empty code throws rather than
      falling through to a default, and the item must already have proof before
      a code is accepted at all.
    */
    expect(text).toMatch(/if \(!code\) throw new Error\("OTP_REQUIRED"\)/);
    expect(text).toContain('throw new Error("DELIVERY_PROOF_REQUIRED")');
  });

  it("keeps the support assistant out of the business of issuing codes", () => {
    const text = sourceOf("src/lib/support/engine.ts");
    expect(GENERATORS.test(text)).toBe(false);
  });

  it("stores a hash rather than the code itself", () => {
    // If the code were recoverable from the database, "we never generate one"
    // would stop being the whole protection.
    const schema = sourceOf("src/lib/d1.server.ts");
    expect(schema).toContain("code_hash TEXT NOT NULL");
    expect(schema).not.toMatch(/otp_codes \([^)]*\bcode TEXT\b/s);
  });

  it("names files that all exist, so the audit cannot rot into passing on nothing", () => {
    for (const file of DELIVERY_PATH) {
      const path = resolve(process.cwd(), file);
      expect(statSync(path).isFile(), file).toBe(true);
    }
    // And the delivery path has not grown a module this list does not know
    // about: any `*delivery*` source in lib is either audited or deliberately
    // excluded here.
    const known = new Set([...DELIVERY_PATH, ...NOT_THE_HANDOVER]);
    const stray: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (/delivery.*\.ts$/.test(entry) && !/\.test\./.test(entry)) {
          const relative = path.replace(`${process.cwd()}/`, "");
          if (!known.has(relative)) stray.push(relative);
        }
      }
    };
    // And the excuses still have to name real files, so one cannot be left
    // behind covering a module that has since been renamed or deleted.
    for (const file of NOT_THE_HANDOVER) {
      expect(statSync(resolve(process.cwd(), file)).isFile(), file).toBe(true);
    }
    walk(resolve(process.cwd(), "src/lib"));
    expect(stray, `unaudited delivery module: ${stray.join(", ")}`).toEqual([]);
  });
});
