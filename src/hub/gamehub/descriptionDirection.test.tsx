/**
 * @vitest-environment jsdom
 *
 * A game's own words read in their own direction.
 *
 * Nintendo's catalogue fills a game's tagline and description in English, and
 * the page around them is Arabic, right to left. Laid out right to left, an
 * English sentence put its closing punctuation first: ASTRAL CHAIN's page read
 * «… in ASTRAL !CHAIN™» on 2026-11-05. Each paragraph now takes its direction
 * from its own first letter (`dir="auto"`), so English reads left to right and
 * Arabic stays right to left.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let game: { description?: string } = {};
vi.mock("./hubContext", () => ({ useHub: () => ({ game }) }));
vi.mock("@/hub/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const { GlanceSection } = await import("./Overview");

afterEach(cleanup);

describe("the description", () => {
  it("is laid out by its own language, whatever the page's direction", () => {
    game = {
      description:
        "Team up with a special weapon, the Legion, to investigate and fight against alien-like creatures invaders in ASTRAL CHAIN™, only on Nintendo Switch!",
    };
    const { getByText } = render(
      <div dir="rtl">
        <GlanceSection />
      </div>,
    );
    const paragraph = getByText(/Team up with a special weapon/);
    expect(paragraph.tagName).toBe("P");
    expect(paragraph.getAttribute("dir")).toBe("auto");
  });
});

describe("the tagline under the name", () => {
  it("is laid out by its own language too", () => {
    const hero = readFileSync(resolve(process.cwd(), "src/hub/gamehub/Hero.tsx"), "utf8");
    // The paragraph that prints the tagline carries dir="auto".
    expect(hero).toMatch(/<p\s+dir="auto"[^>]*>\s*\{game\.tagline\}/);
  });
});
