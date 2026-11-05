/**
 * The genre filter shows the shop's own genres — never one chip per raw string.
 *
 * On 2026-11-05 the games page carried over 200 chips: the Arabic genres, then
 * every raw English genre and tag ("football", "football / soccer", "Shop Shop",
 * "kart racing / open-world racing"), because each distinct string became a
 * chip. These are strings from that screen.
 */
import { describe, expect, it } from "vitest";

import { GAME_GENRES, canonicalGenreIds, productGenreIds } from "./genres";

describe("canonicalGenreIds", () => {
  it("folds every spelling into the shop's genres", () => {
    expect(canonicalGenreIds("Action")).toEqual(["action"]);
    expect(canonicalGenreIds("أكشن")).toEqual(["action"]);
    expect(canonicalGenreIds("turn-based rpg")).toEqual(["rpg"]);
    expect(canonicalGenreIds("jrpg")).toEqual(["rpg"]);
    expect(canonicalGenreIds("soulslike")).toEqual(["rpg"]);
    expect(canonicalGenreIds("football / soccer")).toEqual(["sports"]);
    expect(canonicalGenreIds("kart racing / open-world racing")).toEqual(["racing"]);
    expect(canonicalGenreIds("First-Person Shooter")).toEqual(["shooter"]);
    expect(canonicalGenreIds("Board Game")).toEqual(["board_game"]);
    expect(canonicalGenreIds("survival horror")).toEqual(["horror"]);
    expect(canonicalGenreIds("turn-based tactics")).toEqual(["strategy"]);
    expect(canonicalGenreIds("roguelite")).toEqual(["roguelike"]);
    expect(canonicalGenreIds("Arcade")).toEqual(["arcade"]);
  });

  it("can put one string on two shelves when it names two genres", () => {
    expect(canonicalGenreIds("action rpg").sort()).toEqual(["action", "rpg"]);
    expect(canonicalGenreIds("action-adventure").sort()).toEqual(["action", "adventure"]);
  });

  it("gives themes, modes and Nintendo's catch-alls no shelf", () => {
    for (const raw of ["Other", "Lifestyle", "Communication", "Shop Shop", "Utility", "multiplayer", "co-op", "fantasy", "atmospheric", "first-person", "Transport"]) {
      expect(canonicalGenreIds(raw), raw).toEqual([]);
    }
  });
});

describe("productGenreIds", () => {
  it("reads genres, genre and tags, in any shape", () => {
    const ids = productGenreIds({
      genres: ["Adventure", "Puzzle"],
      genre: "RPG, Simulation",
      tags: ["Switch 2", "metroidvania"],
    });
    expect([...ids].sort()).toEqual(["adventure", "metroidvania", "puzzle", "rpg", "simulation"]);
    expect([...productGenreIds({ genres: '["Racing"]' })]).toEqual(["racing"]);
    expect(productGenreIds({}).size).toBe(0);
  });

  it("only ever answers with ids the shop has a label for", () => {
    const known = new Set(GAME_GENRES.map((g) => g.id));
    const ids = productGenreIds({ genres: ["Action", "Adventure", "Arcade", "Party", "Sports", "Music"] });
    for (const id of ids) expect(known.has(id)).toBe(true);
  });
});
