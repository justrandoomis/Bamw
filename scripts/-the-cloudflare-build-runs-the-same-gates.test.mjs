/**
 * Cloudflare's build must be the same gate GitHub's was.
 *
 * «الحفاظ على نفس سلوك الـ build/deploy الحالي وعدم كسر الموقع أو قاعدة
 *  البيانات أو migrations.»
 *
 * Moving the deploy to Cloudflare moves it from a workflow a person dispatches
 * to a build that runs on every push to the production branch. That is a
 * bigger change than it sounds: the protection is no longer "somebody chose to
 * release", it is only whatever the build command checks. If the build command
 * ever drifts from the four gates `deploy.yml` runs, a bad commit reaches
 * banan.to unchallenged — and it would do so silently, which is the part worth
 * a test.
 *
 * So the two are compared to each other rather than to a list written here. A
 * gate added to the workflow and not to the build fails this; a gate dropped
 * from the build fails it too.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const DEPLOY = readFileSync(resolve(root, ".github/workflows/deploy.yml"), "utf8");
const RELEASE = readFileSync(resolve(root, "scripts/cloudflare-release.mjs"), "utf8");

/** The commands `deploy.yml` runs as gates, in the order it runs them. */
const workflowGates = () => {
  const found = [];
  for (const [, name, command] of DEPLOY.matchAll(
    /- name: (Typecheck|Test|Lint|Build)\n(?:.*\n)*?\s*run: (.+)\n/g,
  )) {
    found.push({ name, command: command.trim() });
  }
  return found;
};

describe("the build command is the gate the workflow was", () => {
  it("runs a typecheck, the tests, the lint and the build", () => {
    const build = String(pkg.scripts["cf:build"] ?? "");
    expect(build).toContain("npm run typecheck");
    expect(build).toContain("vitest run");
    expect(build).toContain("eslint .");
    expect(build).toContain("npm run build");
  });

  it("runs every command the workflow's own gates run", () => {
    /*
      Compared against the workflow rather than against a list, so the two
      cannot drift apart without one of them failing here.
    */
    const gates = workflowGates();
    expect(gates.length, "deploy.yml should still have four gate steps").toBe(4);
    const build = String(pkg.scripts["cf:build"] ?? "");
    for (const gate of gates) {
      expect(build, `${gate.name} — \`${gate.command}\``).toContain(gate.command);
    }
  });

  it("stops at the first failure rather than deploying anyway", () => {
    // `&&` throughout. A `;` or a `||` here would deploy a red build.
    const build = String(pkg.scripts["cf:build"] ?? "");
    expect(build).not.toMatch(/;|\|\|/);
    expect(build.split("&&").length).toBeGreaterThanOrEqual(4);
  });
});

describe("the release command keeps the database out of it", () => {
  it("never applies a migration", () => {
    /*
      The one step that touches customer data and cannot be undone by
      re-running the job. It stays an explicit opt-in on a workflow a person
      dispatches; a build that fires on every push must not be what alters the
      database.
    */
    expect(RELEASE).not.toContain("migrations apply");
    expect(RELEASE).not.toContain("cf:migrate");
    expect(String(pkg.scripts["cf:release"] ?? "")).not.toContain("migrate");
  });

  it("uploads the version and shifts the traffic as two commands", () => {
    /*
      NOT `wrangler deploy`. That command has already failed on this account
      AFTER taking the traffic — it reconciles zone worker routes the token may
      not read, and a red build for a deploy that succeeded invites a wrongful
      rollback.
    */
    expect(RELEASE).toContain("versions");
    expect(RELEASE).toContain("upload");
    expect(RELEASE).toContain("@100%");
    expect(RELEASE).not.toMatch(/"wrangler",\s*\[\s*"deploy"/);
  });

  it("refuses to shift traffic to a version it could not identify", () => {
    // Guessing at "the newest version" would race anything else uploading.
    expect(RELEASE).toContain("Worker Version ID:");
    expect(RELEASE).toContain("could not read the uploaded version id");
    expect(RELEASE).toContain("process.exit(1)");
  });
});

describe("the workflow that still owns migrations and rollback is still there", () => {
  it("keeps the migrate opt-in", () => {
    /*
      The move is of the BUILD and the DEPLOY. Migrations, rollback and the
      post-deploy verification stay in Actions, so this asserts the workflow
      was not deleted along with the part that moved.
    */
    expect(DEPLOY).toContain("wrangler d1 migrations apply");
    expect(DEPLOY).toMatch(/migrate:\s*\n\s*description:/);
  });

  it("keeps the rollback path", () => {
    expect(DEPLOY).toContain("rollback_to");
    expect(DEPLOY).toContain("versions deploy");
  });
});
