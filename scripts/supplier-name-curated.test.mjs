import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { curatedIndex, curatedNameFor } from "./lib/supplier-name-curated.mjs";

const HAN = /[一-鿿㐀-䶿豈-﫿]/;
/*
  Traditional-only characters a Simplified name should not contain — the same
  short guard `checkSupplierNameZh` uses. A name pasted from a Hong Kong or
  Taiwan page without conversion is the mistake this catches, and it is the one
  that actually happens: Nintendo publishes those pages in Traditional and they
  are often the only Chinese source for a game.
*/
const TRADITIONAL_HINTS = /[個們來時體國學實這會傳點寶號龍戰劍靈險緣繫觀]/;

const file = JSON.parse(
  readFileSync(path.resolve("data/supplier-names-zh.json"), "utf8"),
);
const { byTitle, problems } = curatedIndex(file);

describe("the curated names file", () => {
  it("has no malformed entry", () => {
    /* The loader refuses the whole file on any of these, so this is the guard
       that stops a bad edit reaching production rather than a nicety. */
    expect(problems).toEqual([]);
  });

  it("carries a name and a source for every game", () => {
    for (const [title, entry] of Object.entries(file.names)) {
      expect(String(entry.zh ?? "").trim(), `${title}: name`).not.toBe("");
      expect(String(entry.source ?? "").trim(), `${title}: source`).not.toBe("");
      expect(String(entry.source), `${title}: source is a URL`).toMatch(/^https:\/\//);
    }
  });

  it("writes Simplified Chinese, not Traditional", () => {
    /*
      Every name here is meant to be readable to a mainland supplier. A
      Traditional one is a different script, and asking for 「戰」 where the
      supplier's catalogue says 「战」 is a search that returns nothing.
    */
    for (const [title, entry] of Object.entries(file.names)) {
      const name = String(entry.zh);
      if (!HAN.test(name)) continue;
      expect(TRADITIONAL_HINTS.test(name), `${title}: ${name} reads as Traditional`).toBe(
        false,
      );
    }
  });

  it("carries Chinese in every single name", () => {
    /*
      No exception and no flag to opt out. A handful of games have no Chinese
      title — `1-2-Switch`, `Go-Go Town!`, the EA SPORTS FC line — and an
      earlier version let those through as bare Latin. That is a value a
      supplier cannot act on: it looks exactly like the English title nobody
      meant to send. Those say so in Chinese instead, which is a name *and* an
      explanation, and stay needs_review because an operational label is not a
      published title.
    */
    for (const [title, entry] of Object.entries(file.names)) {
      expect(HAN.test(String(entry.zh)), `${title}: ${entry.zh}`).toBe(true);
      expect(entry.latin, `${title}: the latin escape hatch is gone`).toBeUndefined();
    }
  });

  it("says so in Chinese where China has no Chinese title, and does not call it official", () => {
    const kept = Object.entries(file.names).filter(([, entry]) =>
      String(entry.zh).includes("中国区官方沿用英文名"),
    );
    expect(kept.length).toBeGreaterThan(0);
    for (const [title, entry] of kept) {
      expect(entry.status, `${title}: an operational label is never verified`).toBe(
        "needs_review",
      );
    }
  });

  it("never claims verified without a source to point at", () => {
    for (const [title, entry] of Object.entries(file.names)) {
      if (entry.status !== "verified") continue;
      expect(String(entry.source), `${title}`).toMatch(/^https:\/\//);
    }
  });

  it("distinguishes the editions and consoles the shop sells separately", () => {
    /*
      The reason this file exists at all. The automated sources answer for the
      base game and cannot tell one edition from another, but a supplier is
      handed the name of the thing being bought.
    */
    const zelda1 = file.names["The Legend of Zelda: Tears of the Kingdom switch 1"];
    const zelda2 =
      file.names["The Legend of Zelda: Tears of the Kingdom — Nintendo Switch 2 Edition"];
    expect(zelda1.zh).not.toBe(zelda2.zh);
    expect(zelda2.zh).toContain("Switch 2");

    const witcherComplete = file.names["The Witcher 3: Wild Hunt — Complete Edition"];
    const witcherRemaster = file.names["The Witcher 3: Wild Hunt — Remastered"];
    expect(witcherComplete.zh).not.toBe(witcherRemaster.zh);
  });
});

describe("looking a game up", () => {
  it("finds an entry by the shelf title", () => {
    const hit = curatedNameFor({ titleEn: "Splatoon 3" }, byTitle);
    expect(hit?.name).toBe("斯普拉遁3");
  });

  it("finds it through punctuation and case the catalogue may differ on", () => {
    const hit = curatedNameFor({ titleEn: "pokemon pokopia [switch 2]" }, byTitle);
    expect(hit?.name).toBe("宝可梦Pokopia");
  });

  it("returns nothing for a game that is not in the file", () => {
    expect(curatedNameFor({ titleEn: "A Game Nobody Sells" }, byTitle)).toBeNull();
  });
});
