import { describe, expect, it } from "vitest";
import { gameFromProduct } from "./fromProduct";

describe("gameFromProduct Timeline and Similar Games", () => {
  const catalog = [
    {
      id: "zelda-botw",
      title: "The Legend of Zelda: Breath of the Wild",
      titleEn: "The Legend of Zelda: Breath of the Wild",
      genres: ["Action", "Adventure", "Open World"],
      developer: "Nintendo",
      publisher: "Nintendo",
      series: "The Legend of Zelda",
      platform: "switch",
      active: true,
      hidden: false,
    },
    {
      id: "zelda-totk",
      title: "The Legend of Zelda: Tears of the Kingdom",
      titleEn: "The Legend of Zelda: Tears of the Kingdom",
      genres: ["Action", "Adventure", "Open World"],
      developer: "Nintendo",
      publisher: "Nintendo",
      series: "The Legend of Zelda",
      platform: "switch",
      active: true,
      hidden: false,
    },
    {
      id: "mario-odyssey",
      title: "Super Mario Odyssey",
      titleEn: "Super Mario Odyssey",
      genres: ["Platformer", "Action", "Adventure"],
      developer: "Nintendo",
      publisher: "Nintendo",
      series: "Super Mario",
      platform: "switch",
      active: true,
      hidden: false,
    },
    {
      id: "hidden-game",
      title: "Hidden Secret Game",
      genres: ["Action"],
      hidden: true,
      active: true,
    },
    {
      id: "deleted-game",
      title: "Deleted Game",
      genres: ["Action"],
      isDeleted: true,
      active: true,
    },
  ];

  it("handles games with full timeline data across multiple sources", () => {
    const raw = {
      id: "test-game-1",
      title: "Test Game 1",
      releaseDate: "2023-05-12",
      timeline: [
        {
          date: "2022-09-13",
          title: "Announcement",
          body: "Game announced during Nintendo Direct",
          kind: "announcement",
        },
        {
          date: "2023-05-12",
          title: "Launch Day",
          body: "Worldwide release",
        },
      ],
      patchNotes: [
        {
          version: "1.1.0",
          date: "2023-05-19",
          body: "Fixed duplicate glitch",
        },
      ],
      dlc: [
        {
          title: "Expansion Pass",
          releaseDate: "2023-11-01",
          description: "New dungeons and quests",
        },
      ],
    };

    const game = gameFromProduct(raw, "en", catalog);
    expect(game.timeline).toBeDefined();
    expect(game.timeline?.length).toBeGreaterThanOrEqual(4);

    const dates = game.timeline!.map((e) => e.date);
    expect(dates).toContain("2022-09-13");
    expect(dates).toContain("2023-05-12");
    expect(dates).toContain("2023-05-19");
    expect(dates).toContain("2023-11-01");
  });

  it("handles games with single event timeline without crashing", () => {
    const raw = {
      id: "single-event-game",
      title: "Single Event Game",
      releaseDate: "2024-01-01",
    };

    const game = gameFromProduct(raw, "ar", catalog);
    expect(game.timeline).toBeDefined();
    expect(game.timeline?.length).toBe(1);
    expect(game.timeline?.[0]?.kind).toBe("release");
    expect(game.timeline?.[0]?.date).toBe("2024-01-01");
  });

  it("handles games with no timeline data gracefully", () => {
    const raw = {
      id: "no-timeline-game",
      title: "No Timeline Game",
    };

    const game = gameFromProduct(raw, "ar", catalog);
    expect(game.timeline).toBeUndefined();
  });

  it("builds similar games from series, genres, and developer matching", () => {
    const raw = {
      id: "zelda-totk",
      title: "The Legend of Zelda: Tears of the Kingdom",
      genres: ["Action", "Adventure", "Open World"],
      developer: "Nintendo",
      publisher: "Nintendo",
      series: "The Legend of Zelda",
    };

    const game = gameFromProduct(raw, "en", catalog);
    expect(game.similar).toBeDefined();
    expect(game.similar?.length).toBeGreaterThan(0);

    const similarIds = game.similar!.map((s) => s.slug);
    // Should find Zelda BotW as top match
    expect(similarIds[0]).toBe("zelda-botw");
    // Should NOT include self
    expect(similarIds).not.toContain("zelda-totk");
    // Should NOT include hidden or deleted games
    expect(similarIds).not.toContain("hidden-game");
    expect(similarIds).not.toContain("deleted-game");
  });

  it("builds similar games from explicit similar_ids or seriesEntries", () => {
    const raw = {
      id: "custom-game",
      title: "Custom Game",
      similarIds: ["mario-odyssey", "zelda-botw"],
    };

    const game = gameFromProduct(raw, "ar", catalog);
    expect(game.similar).toBeDefined();
    expect(game.similar?.length).toBe(2);
    expect(game.similar?.map((s) => s.slug)).toEqual(["mario-odyssey", "zelda-botw"]);
  });

  it("survives corrupted, null, or malformed data safely", () => {
    const raw = {
      id: "corrupted-game",
      title: null,
      timeline: [null, undefined, 123, "just a string", { date: "invalid-date" }],
      similarIds: null,
      genres: [null, undefined, ""],
      dlc: [null],
      patchNotes: "not an array",
    };

    expect(() => gameFromProduct(raw as any, "ar", catalog)).not.toThrow();
    const game = gameFromProduct(raw as any, "ar", catalog);
    expect(game.id).toBe("corrupted-game");
  });
});

describe("gameFromProduct trailer", () => {
  it("reads the youtubeTrailer field the import schema and admin form write", () => {
    const game = gameFromProduct(
      { id: "t1", title: "T", youtubeTrailer: "https://www.youtube.com/watch?v=abcdefgh123" },
      "ar",
    );
    expect(game.videos?.length).toBe(1);
    expect(game.videos?.[0]?.kind).toBe("trailer");
    expect(game.videos?.[0]?.embedUrl).toContain("abcdefgh123");
  });

  it("still reads the legacy trailerUrl field first", () => {
    const game = gameFromProduct(
      {
        id: "t2",
        title: "T",
        trailerUrl: "https://www.youtube.com/watch?v=legacy12345",
        youtubeTrailer: "https://www.youtube.com/watch?v=newer123456",
      },
      "ar",
    );
    expect(game.videos?.[0]?.embedUrl).toContain("legacy12345");
  });
});

describe("gameFromProduct user score", () => {
  it("halves an imported 0-10 player score into the site's 5-star scale", () => {
    const game = gameFromProduct({ id: "u1", title: "T", userScore: 8.1 }, "ar");
    expect(game.userScore).toBe(4.1);
  });

  it("keeps a native 0-5 aggregate untouched", () => {
    const game = gameFromProduct({ id: "u2", title: "T", userScore: 4.4 }, "ar");
    expect(game.userScore).toBe(4.4);
  });
});

describe("gameFromProduct languages", () => {
  it("reads the array-valued audio/text language fields the importer writes", () => {
    const game = gameFromProduct(
      {
        id: "g1",
        title: "Game",
        languagesAudio: ["English, Japanese"],
        languagesText: ["English", "Arabic"],
      },
      "ar",
    );
    const names = (game.languages ?? []).map((l) => l.name).sort();
    expect(names).toEqual(["Arabic", "English", "Japanese"]);
    const english = game.languages?.find((l) => l.name === "English");
    expect(english?.channels).toContain("audio");
    expect(english?.channels).toContain("subtitles");
  });

  it("falls back to the free-text supported languages list", () => {
    const game = gameFromProduct(
      { id: "g2", title: "Game", supportedLanguages: "English, French, German" },
      "ar",
    );
    expect((game.languages ?? []).map((l) => l.name)).toEqual(["English", "French", "German"]);
    expect(game.languages?.[0]?.channels).toEqual(["interface"]);
  });

  it("does not render referral sentences as languages", () => {
    const game = gameFromProduct(
      {
        id: "g3",
        title: "Game",
        languagesAudio: [
          "Audio language availability varies by title and region; see official product information",
        ],
      },
      "ar",
    );
    expect(game.languages).toBeUndefined();
  });
});
