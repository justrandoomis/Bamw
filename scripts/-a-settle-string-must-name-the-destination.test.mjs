/**
 * What the production checker waits for must exist on the page it waited for.
 *
 * `routeTo(path, settled)` navigates in-app and then polls the body for
 * `settled`, so that the screen is read after its data has arrived rather than
 * on a stopwatch. That is only a wait if `settled` is absent until the
 * destination renders. Name something the destination shares with every other
 * screen and the poll returns at zero milliseconds, having waited for nothing.
 *
 * WHICH IS WHAT HAPPENED. The market's string was «سوق الموز» — its `<h1>`, and
 * also the label of the market tab in `BottomNav`, which is on every page of
 * this shop. The twenty-five second wait returned instantly on every run from
 * the day it was written, and nobody noticed because the router usually swapped
 * fast enough that the read caught the market anyway.
 *
 * Then the home shelf check started scrolling the home page, which renders all
 * its lazy sections, and the read caught 6,217 characters of HOME — «سوق الموز»
 * among them, from the nav — with every market assertion failing against a page
 * that was perfectly healthy. A check reporting its own fault as the shop's,
 * for the third time in one night.
 *
 * So: a settle string must appear in the route it is waiting for, and must not
 * appear in the chrome that is on screen whatever the route.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const CHECKER = read("scripts/market-roulette-check.mjs");
/** On screen on every route, so nothing here can mean «the page arrived». */
const CHROME = ["src/components/BottomNav.tsx"].map(read).join("\n");

/**
 * Every string a `routeTo` call waits for, with the route it waits on.
 *
 * Both forms are collected — the literal and the alternation — because the
 * wheel legitimately settles on any of three sentences, and each of them has to
 * hold up on its own.
 */
const settleStrings = () => {
  const found = [];
  /* `routeTo("/path", "literal")` and `routeTo(old, CONST)`. */
  for (const [, route, literal] of CHECKER.matchAll(
    /routeTo\(\s*(?:"([^"]+)"|(\w+))\s*,\s*"([^"]+)"\s*\)/g,
  )) {
    found.push({ route: route ?? "«متغيّر»", strings: [literal] });
  }
  /* `routeTo("/path", CONST)` — resolve the const's own literal. */
  for (const [, route, name] of CHECKER.matchAll(
    /routeTo\(\s*(?:"([^"]+)"|\w+)\s*,\s*([A-Z_][A-Z0-9_]*)\s*\)/g,
  )) {
    const [, value] = CHECKER.match(new RegExp(`const ${name} = "([^"]+)"`)) ?? [];
    if (value) found.push({ route: route ?? "«متغيّر»", strings: [value] });
  }
  /* `routeTo("/path", /a|b|c/)`. */
  for (const [, route, pattern] of CHECKER.matchAll(
    /routeTo\(\s*"([^"]+)"\s*,\s*\/([^/]+)\/[gimsuy]*\s*\)/g,
  )) {
    found.push({ route, strings: pattern.split("|") });
  }
  return found;
};

const WAITS = settleStrings();

describe("the checker waits for something that means it arrived", () => {
  it("finds the calls at all, so the rest of this file is testing something", () => {
    expect(WAITS.length).toBeGreaterThanOrEqual(3);
    expect(WAITS.flatMap((w) => w.strings).length).toBeGreaterThanOrEqual(5);
  });

  /*
    THE MUTATION THIS FILE EXISTS FOR. Put «سوق الموز» back as the market's
    settle string and this fails, naming the tab it collides with.
  */
  it.each(WAITS.flatMap((w) => w.strings.map((s) => [w.route, s])))(
    "%s — «%s» is not on every page",
    (_route, string) => {
      expect(
        CHROME.includes(string),
        `«${string}» is in BottomNav, so it is on screen before the route changes`,
      ).toBe(false);
    },
  );

  it("waits, on the market, for something only the market draws", () => {
    const market = WAITS.filter((w) => w.route === "/banana_market");
    expect(market.length, "a wait on /banana_market").toBeGreaterThan(0);
    const page = read("src/routes/banana_market.tsx");
    for (const string of market.flatMap((w) => w.strings)) {
      expect(page, `«${string}» must be drawn by banana_market.tsx`).toContain(string);
    }
  });

  it("waits, on the wheel, for whichever answer that screen resolves to", () => {
    const wheel = WAITS.filter((w) => w.route === "/wheel");
    expect(wheel.length, "a wait on /wheel").toBeGreaterThan(0);
    const page = read("src/routes/wheel.tsx");
    const strings = wheel.flatMap((w) => w.strings);
    /*
      Three states, all of them settled: signed out, empty pool, ready to spin.
      Insisting on one would fail an honest rendering of the others.
    */
    expect(strings.length).toBeGreaterThanOrEqual(3);
    for (const string of strings) {
      expect(page, `«${string}» must be drawn by wheel.tsx`).toContain(string);
    }
  });

  /*
    The old addresses redirect to the market, so they settle on the market's
    string — the same one, from the same constant, rather than a second copy
    that could drift away from it.
  */
  it("uses one market string, not two copies of it", () => {
    const market = new Set(
      WAITS.filter((w) => w.route === "/banana_market" || w.route === "«متغيّر»").flatMap(
        (w) => w.strings,
      ),
    );
    expect(market.size, `settle strings in use: ${[...market].join(" · ")}`).toBe(1);
  });
});
