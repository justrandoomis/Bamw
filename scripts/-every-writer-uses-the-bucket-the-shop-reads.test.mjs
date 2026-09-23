/**
 * There is one bucket a stored `/api/files/...` URL can be answered from.
 *
 * `src/routes/api/files/$.ts` reads `files/<path>` through `storage.server.ts`
 * → `getPrivateBucket()` → the `BANANTO_PRIVATE_BUCKET` binding. A script that
 * uploads somewhere else and then stores that URL has written a 404.
 *
 * ## WHAT THIS COST, MEASURED
 *
 * `square-card-fill.mjs` took `CLOUDFLARE_R2_BUCKET_NAME || "bananto"`. It
 * uploaded each square cover, READ IT BACK from the bucket it had just written
 * to — so its own verification passed — stored `/api/files/...`, and reported
 * success. On 2026-09-23, 849 of the catalogue's 1,428 square cards were in
 * `bananto` and none of them was in the bucket the shop reads. Every one was a
 * `square-card-*.webp`, which is the only thing that script makes.
 *
 * Nothing said so. `hasNintendoSquareCard` asks whether a URL is STORED, so
 * each of those games counted as having a picture: it left the admin's
 * «ألعاب بلا صورة مربعة» queue, sorted to the FRONT of the cartridge shelf
 * ahead of the games that really had one, and then 404'd and printed «لم يتم
 * إضافة الصورة بعد». Three symptoms, one line.
 *
 * ## WHY A TEST AND NOT JUST A FIX
 *
 * Because six files answered this question and they did not agree — three said
 * `bananto-private`, two said the env var, and one declared a `PUBLIC_BUCKET`
 * it never used. Fixing the two leaves the disagreement, and the disagreement
 * is the defect. This makes `lib/r2-buckets.mjs` the only way to name a bucket,
 * so a seventh answer cannot be added quietly.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bucketForBinding,
  LEGACY_BUCKET,
  SERVING_BINDING,
  SERVING_BUCKET,
} from "./lib/r2-buckets.mjs";

const dir = path.resolve("scripts");
const scripts = readdirSync(dir)
  .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
  .map((f) => [f, readFileSync(path.join(dir, f), "utf8")]);
const libs = readdirSync(path.join(dir, "lib"))
  .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
  .map((f) => [`lib/${f}`, readFileSync(path.join(dir, "lib", f), "utf8")]);

/** Comments explain the history; they are not code, and they name both buckets. */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("the bucket is read from the app's own configuration", () => {
  it("is the one `wrangler.jsonc` binds, not a constant somebody typed", () => {
    const config = readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    expect(bucketForBinding(config, SERVING_BINDING)).toBe(SERVING_BUCKET);
  });

  it("is the binding `storage.server.ts` actually reads", () => {
    const storage = readFileSync(path.resolve("src/lib/storage.server.ts"), "utf8");
    expect(storage).toContain(`getBinding<R2Like>("${SERVING_BINDING}")`);
  });

  it("reads a binding out of a JSONC file that has comments in it", () => {
    const sample = `
      // a comment
      "r2_buckets": [
        { /* inline */ "binding": "OTHER", "bucket_name": "not-this-one" },
        {
          "binding": "${SERVING_BINDING}",
          "bucket_name": "the-right-one",
        },
      ],`;
    expect(bucketForBinding(sample, SERVING_BINDING)).toBe("the-right-one");
  });

  it("returns null rather than a guess when the binding is not there", () => {
    expect(bucketForBinding('{"binding":"OTHER","bucket_name":"x"}', SERVING_BINDING)).toBe(null);
    expect(bucketForBinding("", SERVING_BINDING)).toBe(null);
    expect(bucketForBinding(null, SERVING_BINDING)).toBe(null);
  });

  it("is not the bucket the two mistaken scripts used to write to", () => {
    expect(SERVING_BUCKET).not.toBe(LEGACY_BUCKET);
  });
});

describe("no script names a bucket any other way", () => {
  /*
    THE ONE THAT WOULD HAVE CAUGHT IT. `createR2(x)` decides where bytes land,
    and the only name it may be given is the one this repo derives from the
    app's own binding.
  */
  it.each(scripts.filter(([, s]) => codeOf(s).includes("createR2(")))(
    "%s hands createR2 the serving bucket",
    (_name, source) => {
      const args = [...codeOf(source).matchAll(/createR2\(\s*([^,)]+)/g)].map((m) => m[1].trim());
      expect(args.length).toBeGreaterThan(0);
      for (const arg of args) expect(arg).toBe("SERVING_BUCKET");
    },
  );

  /*
    And the env var is gone. A secret that can disagree with `wrangler.jsonc` is
    a secret that eventually does — silently, and invisibly until a customer
    looks at a card.
  */
  it.each([...scripts, ...libs])("%s does not read CLOUDFLARE_R2_BUCKET_NAME", (_name, source) => {
    expect(codeOf(source)).not.toContain("CLOUDFLARE_R2_BUCKET_NAME");
  });

  /*
    A bucket literal anywhere but `r2-buckets.mjs` is a second answer to a
    question that has one. The reports that only READ are no exception: one of
    them declared a `PUBLIC_BUCKET` it never used, and a named bucket nothing
    uses is what the next edit reaches for.
  */
  it.each([...scripts, ...libs].filter(([name]) => name !== "lib/r2-buckets.mjs"))(
    "%s writes no bucket name of its own",
    (_name, source) => {
      const code = codeOf(source);
      expect(code).not.toContain('"bananto-private"');
      expect(code).not.toContain("'bananto-private'");
    },
  );

  /* The one file allowed to say it, so the rule above cannot pass vacuously. */
  it("r2-buckets.mjs is where the fallback actually lives", () => {
    const source = readFileSync(path.join(dir, "lib/r2-buckets.mjs"), "utf8");
    expect(codeOf(source)).toContain('"bananto-private"');
  });
});
