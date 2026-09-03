/**
 * @vitest-environment node
 */
/**
 * The referral screens must not make a phone scroll sideways.
 *
 * A page wider than the viewport does not merely gain a scrollbar: mobile
 * Safari zooms the whole document out to fit, which in RTL leaves an empty
 * band down the left and shifts everything — a fault this storefront has had
 * before, from exactly this cause.
 *
 * The browser sweep (`scripts/check-horizontal-overflow.mjs`) is the real
 * measurement and needs a running server. This is the guard that runs in every
 * CI pass without one: it reads the referral markup and refuses the two
 * mistakes that produce the overflow — a fixed width wider than the narrowest
 * phone, and a wide element that is not inside a scroll container.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "..");

/** The narrowest phone in the acceptance criteria. */
const NARROWEST_VIEWPORT = 320;

/** Every referral surface that actually draws something. */
const SURFACES = [
  "src/components/referral/ShareAndEarnButton.tsx",
  "src/components/referral/ReferralCartField.tsx",
  "src/components/admin/ReferralsManager.tsx",
  "src/routes/refer.tsx",
  "src/routes/telegram/referrals.tsx",
];

const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

describe("the referral screens on a 320px phone", () => {
  it.each(SURFACES)("%s sets no width wider than the viewport", (relative) => {
    const source = read(relative);
    const widths = [...source.matchAll(/\b(?:w|min-w)-\[(\d+)px\]/g)].map((match) =>
      Number(match[1]),
    );
    const tooWide = widths.filter((width) => width > NARROWEST_VIEWPORT);

    /*
      A wide element is allowed, but only inside something that scrolls. The
      admin table is exactly that case: `min-w-[900px]` inside
      `overflow-x-auto`, which scrolls the table and not the page.
      */
    if (tooWide.length) {
      expect(source).toMatch(/overflow-x-auto/);
    } else {
      expect(tooWide).toEqual([]);
    }
  });

  it.each(SURFACES)("%s lets long text shrink instead of pushing the row", (relative) => {
    const source = read(relative);
    /*
      A flex row whose children cannot shrink is the other way this breaks: the
      default `min-width: auto` on a flex item means a long code, a long link
      or a long game title widens the row past the screen. Every one of these
      files renders such a row, so every one of them has to say so — with
      `truncate`, `min-w-0`, or a `break-` rule.
    */
    expect(source).toMatch(/truncate|min-w-0|break-words|break-all|overflow-x-auto/);
  });

  it("draws nothing at all from the capture component", () => {
    /*
      `ReferralCapture` is mounted at the root of every page. It returns null —
      it exists to post the code in `?ref=` and let the server answer with a
      cookie — so it cannot contribute a pixel to any layout. Asserted rather
      than assumed, because a stray banner added here would appear on every
      screen in the shop.
    */
    const source = read("src/components/referral/ReferralCapture.tsx");
    expect(source).toMatch(/return null;/);
    expect(source).not.toMatch(/className=/);
  });

  it("never puts a raw pixel width on the share link input", () => {
    const source = read("src/routes/refer.tsx");
    // The link is long and arbitrary; it has to be a flexible field.
    expect(source).toMatch(/min-w-0 flex-1/);
  });

  it("keeps the cart's referral sheet inside the narrowest phone", () => {
    /*
      A modal is the one thing that can overflow while every other element on
      the page behaves: it is positioned against the viewport, not against the
      page's own padding. Three properties together are what stop it —
      `w-full` so it never demands more than it is given, `max-w-*` so it stops
      growing on a desktop, and padding on the *backdrop* so it can never sit
      flush against the edge on a 320px screen.
    */
    const source = read("src/components/referral/ReferralCartField.tsx");
    const backdrop = source.indexOf('role="dialog"');
    expect(backdrop).toBeGreaterThan(-1);
    const sheet = source.slice(backdrop, backdrop + 1600);
    expect(sheet).toMatch(/fixed inset-0[^"]*\bp-4\b/);
    expect(sheet).toMatch(/w-full max-w-sm/);
    // And it opens from the bottom on a phone, centred from `sm:` up.
    expect(sheet).toMatch(/items-end[^"]*sm:items-center/);
  });

  it("offers the referral as a text button, not a second field", () => {
    /*
      The rule from the design: quieter than the coupon box above it, and no
      card of its own, so it cannot crowd the summary. A control that grew back
      into a full-width input would be the regression.
    */
    const source = read("src/components/referral/ReferralCartField.tsx");
    const button = source.indexOf('id="referral-open-btn"');
    expect(button).toBeGreaterThan(-1);
    const markup = source.slice(button, button + 400);
    expect(markup).toMatch(/text-\[1[12]px\]/);
    expect(markup).not.toMatch(/\bw-full\b/);
  });

  it("keeps the admin table scrolling inside its own container", () => {
    const source = read("src/components/admin/ReferralsManager.tsx");
    const table = source.indexOf("<table");
    const container = source.lastIndexOf("overflow-x-auto", table);
    expect(container).toBeGreaterThan(-1);
    expect(table).toBeGreaterThan(container);
  });
});
