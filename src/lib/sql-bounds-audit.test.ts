/**
 * Every dynamically sized statement in the codebase, checked against D1's
 * bound-parameter ceiling.
 *
 * A source audit rather than a unit test, because the failure mode is a
 * statement whose parameter count is a function of the *data* — it passes every
 * test at ten rows and fails in production at four hundred. The one that
 * shipped bound 540 and D1 answered `too many SQL variables at offset 488`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.|\.bench\./.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

const FILES = [
  ...sourceFiles(resolve(process.cwd(), "src/lib")),
  ...sourceFiles(resolve(process.cwd(), "src/routes")),
];

/** `x.map(() => "?").join(...)` — a placeholder list sized by an array. */
const DYNAMIC_PLACEHOLDERS = /(\w+)\s*\.map\(\s*\(\s*\)\s*=>\s*["'`]\?["'`]\s*\)\s*\.join/g;

describe("no statement can outgrow D1's parameter limit", () => {
  it("finds every dynamically sized placeholder list", () => {
    const found: { file: string; source: string }[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(DYNAMIC_PLACEHOLDERS)) {
        found.push({ file: file.replace(`${process.cwd()}/`, ""), source: match[1]! });
      }
    }

    /*
      The catalogue of dynamic statements, and why each is safe. A new entry
      here is a new statement whose size depends on data — it needs a bound
      before it ships, which is what this list is for.
    */
    const KNOWN: Record<string, string> = {
      // Sized by chunkForParams against SAFE_SQL_VARIABLES, asserted in
      // product-index.test.ts at catalogue sizes up to 5000.
      "src/lib/product-index.server.ts:COLUMNS": "chunked",
      "src/lib/product-index.server.ts:group": "chunked",
      // Bound by the number of hardware devices attached to one game — a
      // handful, and not a function of the catalogue.
      "src/lib/devicePerformance.server.ts:activeHardwareIds": "per-game, small",
      // A fixed column list: 49 parameters, constant.
      "src/lib/devicePerformance.server.ts:DATABASE_COLUMNS": "fixed width",
      // The five statuses that count as live. A literal in the source, not a
      // function of how many listings exist.
      "src/lib/used-marketplace.server.ts:ACTIVE_STATUSES": "fixed width",
      // Two identity hashes per check — the one on this request and the one
      // recorded at capture — and sliced to MAX_IDENTITY_COMPARISONS in the
      // source, so the bound does not depend on what the callers pass.
      "src/lib/referral/risk.server.ts:wanted": "sliced to a constant",
    };

    const unknown = found.filter((entry) => !(`${entry.file}:${entry.source}` in KNOWN));
    expect(unknown, `unbounded dynamic SQL: ${JSON.stringify(unknown)}`).toEqual([]);
  });

  it("keeps the projection's writer behind the guard", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/product-index.server.ts"), "utf8");
    // Every statement this file emits is sized and then checked.
    expect(source).toContain("chunkForParams");
    expect(source).toContain("assertBoundParameters");
  });

  it("keeps the listing free of IN() hydration entirely", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/product-index.server.ts"), "utf8");
    // The page is read from one table. No relation is hydrated per row, so
    // there is no id list to bind in the first place.
    // Just this function: the bootstrap below it legitimately reads store_kv,
    // which is the one place the catalogue document is still touched.
    const from = source.indexOf("export async function readProductIndexPage");
    const next = source.indexOf("\nexport ", from + 1);
    const readPage = source.slice(from, next === -1 ? undefined : next);
    // SQL keywords, not JavaScript's `.join(` — matched inside the statements.
    const statements = [...readPage.matchAll(/`([^`]*SELECT[^`]*)`/gi)]
      // Interpolations are JavaScript, not SQL — `.join(",")` inside one is not
      // a SQL JOIN, and matching it would make this assert nothing useful.
      .map((m) => m[1]!.replace(/\$\{[^}]*\}/g, " ? "));
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement).not.toMatch(/\bIN\s*\(\s*\?/i);
      expect(statement).not.toMatch(/\b(LEFT|INNER|OUTER|CROSS)?\s*JOIN\b/i);
      // One table: the projection. Nothing else is read to draw a row.
      expect(statement.match(/\bFROM\s+(\w+)/i)?.[1]).toBe("product_index");
    }
  });
});
