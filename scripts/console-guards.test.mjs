import { describe, expect, it } from "vitest";

import { isReadOnly, present, refusal, skeleton, statementsIn } from "./lib/console-guards.mjs";

/**
 * The console can run any SQL against the shop's live database. These are the
 * cases that decide whether handing it that power is safe.
 */

describe("what may run without apply", () => {
  it("lets the four reading forms through", () => {
    for (const sql of [
      "SELECT key FROM store_kv LIMIT 5",
      "WITH n AS (SELECT 1) SELECT * FROM n",
      "EXPLAIN QUERY PLAN SELECT * FROM store_kv WHERE key = 'store'",
      "PRAGMA table_info(store_kv)",
    ]) {
      expect(refusal(sql, false)).toBeNull();
    }
  });

  it("refuses a write when the run was not dispatched with apply", () => {
    expect(refusal("UPDATE store_kv SET value = '[]' WHERE key = 'store:products'", false)).toMatch(
      /not dispatched with apply/,
    );
    expect(refusal("INSERT INTO store_kv (key, value) VALUES ('a', 'b')", false)).toMatch(
      /not dispatched with apply/,
    );
  });

  it("runs that same write once apply is set", () => {
    expect(
      refusal("UPDATE store_kv SET value = '[]' WHERE key = 'store:products'", true),
    ).toBeNull();
    expect(refusal("INSERT INTO store_kv (key, value) VALUES ('a', 'b')", true)).toBeNull();
  });
});

describe("what is refused however the run was dispatched", () => {
  it("never drops or truncates", () => {
    for (const sql of [
      "DROP TABLE store_kv",
      "drop index idx_security_rate_limits_expires",
      "TRUNCATE TABLE orders",
    ]) {
      expect(refusal(sql, true)).toMatch(/DROP\/TRUNCATE/);
    }
  });

  it("never deletes or updates the whole table", () => {
    expect(refusal("DELETE FROM store_kv", true)).toBe("DELETE with no WHERE");
    expect(refusal("UPDATE store_kv SET value = '[]'", true)).toBe("UPDATE with no WHERE");
  });

  it("refuses nothing at all", () => {
    expect(refusal("   ", true)).toBe("empty statement");
    expect(refusal("-- just a note", true)).toBe("empty statement");
  });
});

describe("the classifier reads keywords, not text that looks like them", () => {
  /*
    The failure this guards against: a WHERE clause that exists only inside a
    string literal. Were the skeleton not taken first, this statement would
    appear to be scoped and would rewrite every row in the catalogue.
  */
  it("does not accept a WHERE that is inside a string literal", () => {
    expect(refusal("UPDATE store_kv SET value = 'x WHERE key = 1'", true)).toBe(
      "UPDATE with no WHERE",
    );
  });

  it("does not accept a WHERE that is inside a comment", () => {
    expect(refusal("DELETE FROM store_kv -- WHERE key = 'a'", true)).toBe("DELETE with no WHERE");
    expect(refusal("DELETE FROM store_kv /* WHERE key = 'a' */", true)).toBe(
      "DELETE with no WHERE",
    );
  });

  it("does not read a DROP out of a value being searched for", () => {
    expect(refusal("SELECT key FROM store_kv WHERE value LIKE '%drop table%'", false)).toBeNull();
  });

  it("strips comments and collapses whitespace", () => {
    expect(skeleton("SELECT 1 -- note\n  FROM   t")).toBe("SELECT 1 FROM t");
  });

  it("knows a read from a write", () => {
    expect(isReadOnly("  select 1")).toBe(true);
    expect(isReadOnly("INSERT INTO t VALUES (1)")).toBe(false);
  });
});

describe("splitting a dispatched script", () => {
  it("separates statements on a semicolon that ends a line", () => {
    expect(statementsIn("SELECT 1;\nSELECT 2;\n")).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("keeps a semicolon inside a literal with its statement", () => {
    expect(statementsIn("SELECT key FROM t WHERE key LIKE 'a;b';\n")).toEqual([
      "SELECT key FROM t WHERE key LIKE 'a;b'",
    ]);
  });

  it("accepts a final statement with no trailing semicolon", () => {
    expect(statementsIn("SELECT 1")).toEqual(["SELECT 1"]);
  });
});

describe("what reaches the report", () => {
  it("hides a column whose name says it is private", () => {
    expect(present("password_hash", "correct horse battery")).toBe("«hidden» (21 chars)");
    expect(present("phone", "0770 000 0000")).toMatch(/^«hidden»/);
    /* Private by the owner's instruction, not by the column's type. */
    expect(present("supplier_name_zh_cn", "塞尔达传说")).toMatch(/^«hidden»/);
  });

  it("hides a value that looks private even under an innocent column name", () => {
    expect(present("blob", "someone@example.com")).toMatch(/^«looks private»/);
    expect(present("blob", "+9647700000000")).toMatch(/^«looks private»/);
    expect(present("blob", "a".repeat(8) + "0".repeat(24))).toMatch(/^«looks private»/);
  });

  it("prints a count, a key and a length in full — they are the diagnosis", () => {
    expect(present("n", 876)).toBe("876");
    expect(present("key", "store:products#003")).toBe("store:products#003");
  });

  /*
    The first report this console produced printed `store:content`'s size as
    `«n»` — the one fact that row existed to give, masked as though a byte
    count were somebody's phone number. A number SQLite returns as a number is
    a count, a length or a timestamp; contact details arrive as text.
  */
  it("prints a large number in full rather than masking it as an identifier", () => {
    expect(present("bytes", 10889492)).toBe("10889492");
    expect(present("n", 1530)).toBe("1530");
  });

  it("still hides a number in a column whose name says it is private", () => {
    expect(present("phone", 7701234567)).toMatch(/^«hidden»/);
  });

  it("masks long digit runs in text, which here are identifiers", () => {
    expect(present("slug", "order-1234567")).toBe("order-«n»");
  });

  it("cuts a long value to a preview and says how long it was", () => {
    const out = present("value", "x".repeat(5000), { preview: 20 });
    expect(out).toBe(`${"x".repeat(20)}… (5000 chars)`);
  });

  it("escapes a pipe so one cell cannot forge a row", () => {
    expect(present("title", "a | b")).toBe("a \\| b");
  });

  it("applies the caller's redaction to whatever is printed", () => {
    const redact = (t) => String(t).split("s3cret-token").join("«redacted»");
    expect(present("value", "bearer s3cret-token", { redact })).toBe("bearer «redacted»");
  });

  it("prints an absent value as a dash rather than the word null", () => {
    expect(present("value", null)).toBe("—");
    expect(present("value", undefined)).toBe("—");
  });
});
