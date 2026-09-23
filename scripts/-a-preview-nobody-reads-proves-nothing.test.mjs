/**
 * A preview is only worth having if something reads it — and says nothing.
 *
 * Two faults, one run apart, are what this file pins.
 *
 * ## 1. The fallback I wrote could never run
 *
 * The step that uploads a preview version ended with:
 *
 *     url="$(grep -oiE '…workers\.dev' preview.log | tail -1)"
 *     if [ -n "$url" ]; then … else
 *       echo "wrangler printed no preview URL — check whether workers.dev is enabled"
 *     fi
 *
 * `grep` exits 1 when it matches nothing. The step's shell is `bash -e` and the
 * script sets `pipefail`, so on the one occasion that message was needed — the
 * very first preview run — the assignment killed the step and the message never
 * printed. The job went red saying only «Process completed with exit code 1»,
 * while the version had in fact uploaded perfectly. A diagnostic that only runs
 * when nothing is wrong is not a diagnostic.
 *
 * ## 2. A preview URL is a live copy of the shop
 *
 * A version preview URL is wired to the PRODUCTION D1 and R2. Printing it into
 * the log of a public repository publishes an unlisted, unprotected address
 * that answers with the real store. So the address is masked and the reading
 * happens inside the same step: nothing downstream ever needs to be told where
 * the preview was.
 *
 * Both of these are properties of a file, so they are tested against the file.
 * Change the step and one of these fails; that is the point of them.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const DEPLOY = readFileSync(resolve(root, ".github/workflows/deploy.yml"), "utf8");
const WRANGLER = readFileSync(resolve(root, "wrangler.jsonc"), "utf8");

/**
 * The body of one `run:` block, by the step's `name:`.
 *
 * Read from the file rather than from a YAML parse so the test needs no parser
 * and still fails on the thing that matters: the shell that actually runs.
 */
const stepBody = (namePattern) => {
  const start = DEPLOY.search(namePattern);
  if (start === -1) return "";
  const rest = DEPLOY.slice(start);
  const run = rest.indexOf("\n        run: |\n");
  if (run === -1) return "";
  const after = rest.slice(run + "\n        run: |\n".length);
  const end = after.search(/\n {0,6}\S/);
  return end === -1 ? after : after.slice(0, end);
};

const PREVIEW = stepBody(/- name: Upload a version[^\n]*\n/);

describe("the preview step", () => {
  it("is found at all, so the rest of this file is testing something", () => {
    expect(PREVIEW.length, "no `run:` block found for the upload step").toBeGreaterThan(200);
  });

  /*
    THE MUTATION THIS FILE EXISTS FOR. Delete the `|| true` and this fails:
    `grep` finding nothing would once again kill the step under `bash -e`
    before the message explaining what went wrong could print.
  */
  it("cannot be killed by a grep that matches nothing", () => {
    const capture = PREVIEW.split("\n").find((line) => line.includes("grep -oiE"));
    expect(capture, "the line that captures the preview URL").toBeTruthy();
    expect(
      /\|\|\s*true\s*\)?"?\s*$/.test(String(capture).trim()),
      `a no-match grep must not end the step: ${capture}`,
    ).toBe(true);
  });

  it("says what went wrong when there is no URL, instead of just exiting", () => {
    const [, diagnostic] = PREVIEW.match(/if \[ -z "\$url" \]; then\n([\s\S]*?)\n\s*fi\n/) ?? [];
    expect(diagnostic, "an empty URL must be handled explicitly").toBeTruthy();
    expect(diagnostic).toMatch(/workers\.dev|preview_urls/);
    expect(diagnostic, "and it must still fail the job — a silent skip reads as a pass").toContain(
      "exit 1",
    );
  });

  it("masks the address before anything else in the step can print it", () => {
    const mask = PREVIEW.indexOf("::add-mask::$url");
    expect(mask, "the URL must be masked").toBeGreaterThan(-1);
    const check = PREVIEW.indexOf("market-roulette-check.mjs");
    expect(check, "the step must read the preview").toBeGreaterThan(-1);
    expect(mask, "masked BEFORE the checker runs, not after").toBeLessThan(check);
  });

  it("never echoes the address into the log of a public repository", () => {
    for (const line of PREVIEW.split("\n")) {
      if (line.includes("add-mask")) continue;
      expect(
        /echo[^\n]*"[^"]*\$url/.test(line),
        `the preview URL must not be echoed: ${line.trim()}`,
      ).toBe(false);
    }
    expect(PREVIEW, "nor written to a step output for another job to print").not.toMatch(
      /url=\$url" >> "\$GITHUB_OUTPUT/,
    );
  });

  it("reads the screens itself, so nothing downstream needs the address", () => {
    expect(PREVIEW).toMatch(/node scripts\/market-roulette-check\.mjs --origin "\$url"/);
    expect(PREVIEW, "and reports what it saw even when the checker fails").toContain(
      "market-roulette-check.md",
    );
    expect(PREVIEW, "while still failing the job on a failed check").toMatch(/exit \$rc/);
  });

  it("keeps the checker's report out of the artifacts, which are not masked", () => {
    const at = DEPLOY.indexOf("uses: actions/upload-artifact@v4");
    expect(at, "the reports upload step").toBeGreaterThan(-1);
    const artifact = DEPLOY.slice(at);
    expect(artifact, "the step must still name what it uploads").toContain("path: |");
    expect(artifact).not.toContain("market-roulette-check.md");
  });
});

describe("the worker's own addresses", () => {
  it("hands every uploaded version a preview URL", () => {
    expect(WRANGLER).toMatch(/"preview_urls":\s*true/);
  });

  /*
    `workers_dev` is the OTHER toggle, and it is the one that would give
    production a second permanent address. banan.to and www.banan.to are the
    only hostnames a customer has; a per-version URL exists only for a version
    somebody uploaded, and dies with it.
  */
  it("does not give production a second permanent address", () => {
    expect(WRANGLER).not.toMatch(/"workers_dev":\s*true/);
    expect(WRANGLER).toMatch(/"pattern":\s*"banan\.to",\s*"custom_domain":\s*true/);
  });
});
