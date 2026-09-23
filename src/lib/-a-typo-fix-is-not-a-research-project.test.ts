/**
 * Renaming a listing must not require measuring its frame rate.
 *
 * «هناك مشكلة عند تغيير اسم اللعبة التي تحتوي فقط على اسم اللعبة والصورة
 *  المربعة والسعر للعبة الأوفلاين بدون أي معلومات ثانية يظهر الخطأ… اريد تغيير
 *  فقط الاسم والسعر مثلا بدون ان ادخل المعلومات الاخرى.»
 *
 * The admin edit path runs `validateGameDevicePerformance` and refuses the save
 * on any error. For the fifteen hundred supplier listings — a name, a price,
 * and lately a square cover — the blank performance record reports all four of
 * `handheld.resolution`, `handheld.fps`, `tv.resolution`, `tv.fps` missing, so
 * the owner could not correct a typo in a title without first researching
 * resolutions and frame rates for a game he has not even described yet.
 *
 * ## The rule, and why it is this one
 *
 * A BLANK table means nobody has started. A HALF-FILLED table means somebody
 * started and stopped, and that is the fault worth catching — it is how a game
 * ends up claiming 1080p with no frame rate. So:
 *
 *   - blank + the page is not finished  → warning, the save goes through;
 *   - partially filled                  → error, exactly as before;
 *   - finished page with a blank table  → error, exactly as before.
 *
 * "Not finished" reuses the floor `publishGate.ts` already waives for these
 * same listings, and for the same documented reason. Two definitions of
 * "still only a name and a price" would drift, and then the save gate and the
 * publish gate would disagree about which products are the special case.
 */
import { describe, expect, it } from "vitest";

import { CATALOGUE_SOURCE } from "./catalogueImport";
import { validateGameDevicePerformance } from "./devicePerformance";

/** The shape the admin editor sends for a supplier listing being renamed. */
const bareGame = (over: Record<string, unknown> = {}) => ({
  id: "prod_absolute_fear",
  title: "Absolute Fear -AOONI-",
  titleEn: "Absolute Fear -AOONI-",
  slug: "absolute-fear-aooni-d9j11",
  platform: "switch",
  price: 7000,
  cost: 2000,
  nintendoCardImage: "/api/files/products/prod_absolute_fear/square-card-abc.webp",
  description: "",
  catalogueSource: CATALOGUE_SOURCE,
  devicePerformance: [{ deviceSlug: "nintendo-switch" }],
  ...over,
});

/*
  `allowUnstarted` is what the admin save paths pass. The importer does NOT,
  and must not: importing a game record is someone supplying the data on
  purpose, and three of the importer's own tests failed the moment I inferred
  the waiver from the product's shape instead of letting the caller grant it.
*/
const errorsOf = (product: Record<string, unknown>) =>
  validateGameDevicePerformance(product, { allowUnstarted: true }).filter(
    (i) => i.severity === "error",
  );

describe("a listing nobody has researched yet can still be renamed", () => {
  it("does not block the save when the performance table is entirely blank", () => {
    // The exact case in the owner's screenshot.
    expect(errorsOf(bareGame())).toEqual([]);
  });

  it("keeps the importer strict, because an import is someone supplying data", () => {
    /*
      The regression that the first version of this fix caused. Without the
      flag the rule is unchanged, so `parseGameImport` still refuses a game
      record that arrives with no performance table.
    */
    const strict = validateGameDevicePerformance(bareGame()).filter(
      (i) => i.severity === "error",
    );
    expect(strict.length).toBeGreaterThan(0);
  });

  it("still says something, so the gap is visible rather than forgotten", () => {
    /*
      Waived is not the same as silent. The admin should see that the table is
      empty — just not be stopped by it.
    */
    const issues = validateGameDevicePerformance(bareGame(), { allowUnstarted: true });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("lets the save through for a listing that has a cover but no description", () => {
    /*
      The trap this fixes. Giving one of these listings a square picture used to
      promote it out of every exemption — so the reward for adding art was that
      you could no longer edit the title.
    */
    expect(errorsOf(bareGame({ catalogueSource: undefined }))).toEqual([]);
  });

  it("lets the price be corrected too, which is the other half of the ask", () => {
    expect(errorsOf(bareGame({ price: 9000 }))).toEqual([]);
  });

  it("waives it whether the record is an empty object, an empty array or absent", () => {
    for (const devicePerformance of [[], [{ deviceSlug: "nintendo-switch" }], undefined]) {
      expect(errorsOf(bareGame({ devicePerformance })), String(devicePerformance)).toEqual([]);
    }
  });
});

describe("a half-finished table is still an error, which is the point", () => {
  it("refuses a record with a resolution and no frame rate", () => {
    /*
      Somebody started and stopped. This is the fault the validator exists for,
      and the waiver above must not swallow it: a game claiming 1080p with no
      frame rate is worse than a game claiming nothing.
    */
    const errors = errorsOf(
      bareGame({
        devicePerformance: [
          { deviceSlug: "nintendo-switch", handheld: { outputResolution: "720p" } },
        ],
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain("performance data is required");
  });

  it("refuses a record where only the TV mode was filled in", () => {
    const errors = errorsOf(
      bareGame({
        devicePerformance: [
          { deviceSlug: "nintendo-switch", tv: { outputResolution: "1080p", fps: 60 } },
        ],
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("accepts a table that is genuinely complete", () => {
    expect(
      errorsOf(
        bareGame({
          devicePerformance: [
            {
              deviceSlug: "nintendo-switch",
              handheld: { outputResolution: "720p", fps: 30 },
              tv: { outputResolution: "1080p", fps: 30 },
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("accepts a mode explicitly marked unsupported, as the message invites", () => {
    // «If a mode is not supported, mark it as Not Supported» — so that must work.
    expect(
      errorsOf(
        bareGame({
          devicePerformance: [
            {
              deviceSlug: "nintendo-switch",
              handheld: { outputResolution: "720p", fps: 30 },
              tv: { supported: false },
            },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("a finished game is held to the old standard", () => {
  it("still refuses a blank table on a game with a real description", () => {
    /*
      The waiver is for listings nobody has written yet. A game with a cover AND
      a description is a page a customer reads, and its performance table is
      part of what they came for.
    */
    const errors = errorsOf(
      bareGame({
        catalogueSource: undefined,
        description:
          "A survival horror game where you are hunted through a haunted mansion by the Aooni, " +
          "with several endings and a hard mode unlocked on completion.",
      }),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain("performance data is required");
  });
});
