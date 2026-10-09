/**
 * «يسحب الفائز بشكل تلقائي من التعليقات في الانستغرام إذا طبق شروط ... إذا كان
 *  التعليق مكرر يسحب تعليق واحد فقط مع عمل شروط مثلاً تعليق نصي، عمل تاج
 *  للأصدقاء»
 *
 * The rules a serious comment picker applies, held one by one.
 */
import { describe, expect, it } from "vitest";

import {
  extractMentions,
  instagramShortcode,
  parsePastedComments,
  qualifyComments,
  type IgComment,
} from "./instagramComments";

const c = (id: string, username: string, text: string, extra: Partial<IgComment> = {}) => ({
  id,
  username,
  text,
  timestamp: `2026-10-0${Math.min(9, Number(id.replace(/\D/g, "")) || 1)}T10:00:00Z`,
  ...extra,
});

describe("a tag", () => {
  it("is a real account, counted once, and never an email address", () => {
    expect(extractMentions("@Ali_1 @ali_1 @sara. ali@gmail.com @x")).toEqual([
      "ali_1",
      "sara",
      "x",
    ]);
    expect(extractMentions("بدون تاغ")).toEqual([]);
  });
});

describe("qualifying comments", () => {
  it("gives a person who commented many times one ticket", () => {
    const result = qualifyComments([
      c("1", "ali", "@a @b"),
      c("2", "ali", "@c @d"),
      c("3", "Ali", "@e @f"),
      c("4", "sara", "@a @b"),
    ]);
    expect(result.tickets.map((t) => t.username)).toEqual(["ali", "sara"]);
    expect(result.stats.duplicatesDropped).toBe(2);
  });

  it("counts every comment only when the admin asks for that", () => {
    const result = qualifyComments([c("1", "ali", "x"), c("2", "ali", "y")], {
      oneEntryPerUser: false,
    });
    expect(result.tickets).toHaveLength(2);
  });

  it("asks for tags of other people — not yourself, not the shop", () => {
    const result = qualifyComments(
      [
        c("1", "ali", "@ali @banan.to @friend"),
        c("2", "sara", "@one @two"),
        c("3", "omar", "@one"),
      ],
      { minMentions: 2, excludeAccounts: ["@banan.to"] },
    );
    expect(result.entrants.map((e) => e.username)).toEqual(["sara"]);
    expect(result.stats.rejected.mentions).toBe(2);
  });

  it("qualifies a person by any one of their comments", () => {
    const result = qualifyComments([c("1", "ali", "🔥"), c("2", "ali", "@a @b")], {
      minMentions: 2,
    });
    expect(result.entrants).toHaveLength(1);
    expect(result.tickets[0]!.comment.id).toBe("2");
  });

  it("wants words when a text comment is the rule, not just tags and emoji", () => {
    const result = qualifyComments(
      [c("1", "ali", "@a @b 🔥🔥"), c("2", "sara", "@a @b أتمنى الفوز")],
      { requireText: true },
    );
    expect(result.entrants.map((e) => e.username)).toEqual(["sara"]);
  });

  it("matches required words however the Arabic is spelled", () => {
    const result = qualifyComments(
      [c("1", "ali", "انا مع #بنانتو إن شاء الله"), c("2", "sara", "مشاركة")],
      { requiredWords: ["#بنانتو", "ان شاء الله"] },
    );
    expect(result.entrants.map((e) => e.username)).toEqual(["ali"]);
  });

  it("leaves out replies, late comments, banned words and excluded accounts", () => {
    const result = qualifyComments(
      [
        c("1", "a", "ok", { isReply: true }),
        c("2", "b", "ok", { timestamp: "2026-10-20T00:00:00Z" }),
        c("3", "c", "spam link"),
        c("4", "shop", "ok"),
        c("5", "d", "ok"),
      ],
      { before: "2026-10-10T00:00:00Z", bannedWords: ["link"], excludeAccounts: ["shop"] },
    );
    expect(result.entrants.map((e) => e.username)).toEqual(["d"]);
    expect(result.stats.rejected).toMatchObject({ reply: 1, late: 1, banned: 1, excluded: 1 });
  });
});

describe("pasted comments", () => {
  it("reads lines, CSV and the Graph API's own JSON", () => {
    expect(parsePastedComments("ali: @a @b\n@sara أتمنى الفوز\n\nnot a comment line ##")).toEqual([
      { id: "pasted-1", username: "ali", text: "@a @b" },
      { id: "pasted-2", username: "sara", text: "أتمنى الفوز" },
    ]);
    const csv = parsePastedComments('username,text\nali,"hi, @a"\nsara,@b');
    expect(csv.map((x) => [x.username, x.text])).toEqual([
      ["ali", "hi, @a"],
      ["sara", "@b"],
    ]);
    const json = parsePastedComments(
      JSON.stringify({ data: [{ id: "9", text: "@a", from: { username: "Omar" } }] }),
    );
    expect(json[0]).toMatchObject({ id: "9", username: "omar", text: "@a" });
  });
});

describe("a post link", () => {
  it("gives the post's shortcode", () => {
    expect(instagramShortcode("https://www.instagram.com/p/DUBtwxGEqz2/?igsh=x")).toBe(
      "DUBtwxGEqz2",
    );
    expect(instagramShortcode("https://instagram.com/reel/C9abcDEF12/")).toBe("C9abcDEF12");
    expect(instagramShortcode("https://example.com/p/abc")).toBeNull();
  });
});
