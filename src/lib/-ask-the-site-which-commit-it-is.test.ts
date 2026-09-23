/**
 * banan.to could not be asked which commit it was running.
 *
 * `/api/health` reported the database, the bucket, the catalogue count and the
 * latency of each — everything except the one fact that decides whether the
 * code you are reading is the code that is serving. So «production is serving
 * the reverted version» was a BELIEF, held for twenty minutes, while a second
 * deploy path had already put the newer commit live about fifty seconds after
 * the push. Nothing anywhere would have said so, and nothing I could have
 * asked would have corrected me.
 *
 * A build stamp is cheap and it closes that hole: a deploy becomes something
 * verified instead of assumed, and a second deploy path becomes something SEEN
 * instead of inferred from the timestamps in somebody else's deployment list.
 *
 * ## Why «unknown» is a feature
 *
 * A bundle built without the define — this test run, a dev server, some future
 * builder nobody has thought of — must say it does not know. The tempting
 * alternatives are all worse: reading git at REQUEST time is impossible inside
 * a Worker, and falling back to a version number or a date invents an answer.
 * A verification that accepts a guessed commit verifies nothing, so the guess
 * is refused at the source.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BUILD_COMMIT_UNKNOWN,
  buildCommit,
  normalizeCommit,
  shortBuildCommit,
  shorten,
} from "./build-commit";

const root = resolve(import.meta.dirname, "../..");
const VITE_CONFIG = readFileSync(resolve(root, "vite.config.ts"), "utf8");
const HEALTH = readFileSync(resolve(root, "src/routes/api/health.ts"), "utf8");

describe("the stamp itself", () => {
  it("answers something, always", () => {
    expect(typeof buildCommit()).toBe("string");
    expect(buildCommit().length).toBeGreaterThan(0);
  });

  /*
    AND THE DEFINE REALLY REACHES A BUNDLE.

    I assumed vitest would leave it alone and wrote this test expecting
    «unknown»; it failed with a real forty-character sha. That failure is worth
    keeping as an assertion, because it is the end-to-end proof that the
    `define` in `vite.config.ts` survives into compiled code rather than a claim
    that it ought to.
  */
  it("is a real commit here, because vite replaced it", () => {
    expect(buildCommit()).toMatch(/^[0-9a-f]{40}$/);
    expect(shortBuildCommit()).toMatch(/^[0-9a-f]{8}$/);
  });

  /*
    `import.meta.env` is replaced statically, so no test can stub it. The
    judgement is therefore a pure function, and these are the cases a builder
    can actually produce.
  */
  it("says it does not know rather than inventing a commit", () => {
    expect(normalizeCommit(undefined)).toBe(BUILD_COMMIT_UNKNOWN);
    expect(normalizeCommit("")).toBe(BUILD_COMMIT_UNKNOWN);
    expect(normalizeCommit("   ")).toBe(BUILD_COMMIT_UNKNOWN);
    expect(normalizeCommit(null)).toBe(BUILD_COMMIT_UNKNOWN);
    expect(normalizeCommit(123)).toBe(BUILD_COMMIT_UNKNOWN);
    expect(shorten(BUILD_COMMIT_UNKNOWN)).toBe(BUILD_COMMIT_UNKNOWN);
  });

  it("shortens a real sha to the eight characters Cloudflare prints", () => {
    const sha = "37bcb500d1975a0657261e81fe49f493334349bf";
    expect(normalizeCommit(` ${sha}\n`)).toBe(sha);
    expect(shorten(sha)).toBe("37bcb500");
  });
});

describe("who fills it in", () => {
  /*
    Compared against the config rather than against a list here, so a builder
    dropped from one side cannot quietly stop being covered.
  */
  it("reads whichever builder is doing the building", () => {
    for (const variable of ["GITHUB_SHA", "WORKERS_CI_COMMIT_SHA", "CF_PAGES_COMMIT_SHA"]) {
      expect(VITE_CONFIG, `${variable} must be one of the sources`).toContain(variable);
    }
  });

  /*
    THE SECOND DEPLOY PATH IS THE POINT. A Cloudflare build that deploys on a
    push to `main` is not going to set `GITHUB_SHA`, and it is precisely the
    deploy nobody was watching — so it has to be covered, or the stamp only
    ever identifies the builds that were already accounted for.
  */
  it("covers the Cloudflare builder, not only GitHub's", () => {
    expect(VITE_CONFIG).toMatch(/WORKERS_CI_COMMIT_SHA|CF_PAGES_COMMIT_SHA/);
  });

  it("falls back to git before it gives up", () => {
    expect(VITE_CONFIG).toContain("git rev-parse HEAD");
  });

  it("bakes it in where the Worker can read it", () => {
    expect(VITE_CONFIG).toMatch(/define:\s*\{/);
    expect(VITE_CONFIG).toContain("import.meta.env.VITE_BUILD_COMMIT");
  });
});

describe("where it can be asked", () => {
  it("is part of the health answer", () => {
    expect(HEALTH).toContain("build: buildCommit()");
    expect(HEALTH).toContain('from "@/lib/build-commit"');
  });

  /*
    A git SHA of a PUBLIC repository identifies code, never a customer —
    «لا تخزن بيانات عميل حساسة». This is the line that keeps it that way: the
    endpoint is public, so nothing may be added beside the stamp that is not.
  */
  it("adds a commit and nothing about a person", () => {
    const [, body] = HEALTH.match(/return json\(\{([\s\S]*?)\n\s*\}\);/) ?? [];
    expect(body, "the health payload").toBeTruthy();
    for (const forbidden of ["email", "phone", "userId", "user_id", "session", "token", "secret"]) {
      expect(String(body).toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
