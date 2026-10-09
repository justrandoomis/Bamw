/**
 * @vitest-environment node
 *
 * «يسحب الفائز بشكل تلقائي من التعليقات في الانستغرام»
 *
 * The Graph API client, against a fake of Meta's answers: it finds the shop's
 * post by its link, reads every page of comments by cursor (never by storing
 * the token-bearing `next` URL), keeps replies apart, and turns Meta's error
 * codes into sentences the admin can act on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const secrets: Record<string, string | undefined> = {};
vi.mock("./env.server", () => ({
  env: (name: string) => secrets[name],
  getEnv: () => ({}),
  getBinding: () => undefined,
  publishEnv: () => undefined,
}));

const calls: URL[] = [];
type Answer = { status?: number; body: unknown };
let answer: (url: URL) => Answer = () => ({ body: { data: [] } });

beforeEach(() => {
  calls.length = 0;
  secrets["INSTAGRAM_ACCESS_TOKEN"] = "tok_secret";
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    const { status = 200, body } = answer(url);
    return new Response(JSON.stringify(body), { status });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete secrets["INSTAGRAM_ACCESS_TOKEN"];
  delete secrets["INSTAGRAM_USER_ID"];
});

const ig = await import("./instagram.server");

describe("the shop's post", () => {
  it("is found among the account's media by the link's shortcode, across pages", async () => {
    answer = (url) =>
      url.searchParams.get("after") === "page2"
        ? { body: { data: [{ id: "m2", shortcode: "DUBtwxGEqz2" }] } }
        : {
            body: {
              data: [{ id: "m1", shortcode: "other" }],
              paging: { cursors: { after: "page2" }, next: "x" },
            },
          };
    const media = await ig.findMediaByShortcode("DUBtwxGEqz2");
    expect(media?.id).toBe("m2");
    expect(calls[0]!.pathname).toBe("/v25.0/me/media");
    expect(calls[0]!.hostname).toBe("graph.instagram.com");
  });

  it("uses the account id given, for a Facebook-Login token", async () => {
    secrets["INSTAGRAM_USER_ID"] = "1784";
    answer = () => ({ body: { data: [] } });
    await ig.findMediaByShortcode("abc12");
    expect(calls[0]!.pathname).toBe("/v25.0/1784/media");
  });
});

describe("the comments", () => {
  it("are read page by page by cursor, with replies marked", async () => {
    answer = (url) =>
      url.searchParams.get("after") === "c2"
        ? {
            body: {
              data: [
                { id: "3", text: "@c", username: "Omar", timestamp: "2026-10-01T00:00:00+0000" },
              ],
            },
          }
        : {
            body: {
              data: [
                {
                  id: "1",
                  text: "@a @b",
                  from: { username: "Sara" },
                  replies: { data: [{ id: "1r", text: "thanks", username: "banan.to" }] },
                },
                { id: "2", text: "hi", username: "ali" },
              ],
              paging: {
                cursors: { after: "c2" },
                next: "https://graph.instagram.com/...access_token=tok_secret",
              },
            },
          };
    const run = await ig.fetchCommentPages("m2", { includeReplies: true });
    expect(run.nextCursor).toBeNull();
    expect(run.comments.map((c) => [c.id, c.username, c.isReply])).toEqual([
      ["1", "sara", false],
      ["1r", "banan.to", true],
      ["2", "ali", false],
      ["3", "omar", false],
    ]);
    expect(calls[0]!.searchParams.get("fields")).toContain("replies");
    // The cursor is what carries on — never the `next` URL with the token in it.
    expect(calls[1]!.searchParams.get("after")).toBe("c2");
  });

  it("stops at the page limit and says where to pick up", async () => {
    answer = () => ({
      body: {
        data: [{ id: "x", text: "", username: "a" }],
        paging: { cursors: { after: "more" }, next: "y" },
      },
    });
    const run = await ig.fetchCommentPages("m2", { maxPages: 2 });
    expect(run.comments).toHaveLength(2);
    expect(run.nextCursor).toBe("more");
  });
});

describe("what goes wrong", () => {
  it("says the token expired, in words the admin can act on", async () => {
    answer = () => ({
      status: 400,
      body: { error: { code: 190, message: "Error validating access token" } },
    });
    await expect(ig.fetchCommentPages("m2")).rejects.toMatchObject({ code: "token" });
  });

  it("says the account is not connected, without calling Meta", async () => {
    delete secrets["INSTAGRAM_ACCESS_TOKEN"];
    expect(ig.instagramConfigured()).toBe(false);
    await expect(ig.fetchCommentPages("m2")).rejects.toMatchObject({ code: "not_configured" });
    expect(calls).toHaveLength(0);
  });
});
