/**
 * @vitest-environment jsdom
 */
/**
 * The friend's code, from the link to the server, exercised rather than read.
 *
 * Four ways it was lost before it got there, all of them in this one small
 * component, and none of them visible to anybody: the code simply stopped
 * working and the friend paid full price.
 */

import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The address bar, as the component's router hook reports it. */
let location = { pathname: "/", searchStr: "" };

vi.mock("@tanstack/react-router", () => ({
  useLocation: ({ select }: { select: (loc: typeof location) => unknown }) => select(location),
}));

const toasts: { level: string; text: string }[] = [];
vi.mock("sonner", () => ({
  toast: {
    success: (text: string) => toasts.push({ level: "success", text }),
    error: (text: string) => toasts.push({ level: "error", text }),
    info: (text: string) => toasts.push({ level: "info", text }),
  },
}));

const { ReferralCapture } = await import("./ReferralCapture");

/** Point both the fake router and the real jsdom URL at one address. */
function goTo(url: string) {
  const parsed = new URL(url, "https://banan.to");
  location = { pathname: parsed.pathname, searchStr: parsed.search };
  window.history.replaceState({ tanstack: "keep-me" }, "", `${parsed.pathname}${parsed.search}`);
}

let posts: string[] = [];
function respond(status: number, body: unknown) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    posts.push(String(init?.body ?? ""));
    return {
      status,
      json: async () => body,
    } as unknown as Response;
  });
}

/*
  One query client for the whole render, reused across rerenders.

  This matters more than it looks: the effect used to depend on the query
  client alone, so handing `rerender` a *fresh* client re-runs it and the
  navigation test passes against the unfixed component. The client has to stay
  the same thing so that the location is the only thing that changed.
*/
let client = new QueryClient();

function draw() {
  return render(
    <QueryClientProvider client={client}>
      <ReferralCapture />
    </QueryClientProvider>,
  );
}

function again(view: ReturnType<typeof draw>) {
  view.rerender(
    <QueryClientProvider client={client}>
      <ReferralCapture />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  posts = [];
  toasts.length = 0;
  window.sessionStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a referral code that arrives in the address bar", () => {
  it("is sent to the server and then taken out of the URL", async () => {
    goTo("/product/mario?ref=sami");
    vi.stubGlobal("fetch", respond(200, { ok: true, message: "تم تطبيق إحالة @sami." }));
    draw();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(JSON.parse(posts[0]!)).toMatchObject({ code: "sami", product: "mario" });
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(toasts).toEqual([{ level: "success", text: "تم تطبيق إحالة @sami." }]);
  });

  it("keeps the code when the request never got an answer", async () => {
    /*
      Offline, or a blocked request. The URL was cleaned in a `finally`, so the
      one case where the code was worth keeping was the case it was thrown away
      in — and `?ref` is the only copy the friend has.
    */
    goTo("/product/mario?ref=sami");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    draw();

    await waitFor(() => expect(window.sessionStorage.length).toBe(0));
    expect(window.location.search).toBe("?ref=sami");
  });

  it("keeps the code, and says so, when the limiter turns it away", async () => {
    goTo("/product/mario?ref=sami");
    vi.stubGlobal("fetch", respond(429, { error: "طلبات كثيرة، حاول لاحقاً", retryAfter: 60 }));
    draw();

    await waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0]!.level).toBe("error");
    // The 429 body has no `message`, so before this the friend saw nothing at
    // all — and the code went with it.
    expect(window.location.search).toBe("?ref=sami");
  });

  it("is picked up when it arrives through a navigation, not just on mount", async () => {
    /*
      The effect depended on the query client alone, so it ran once and never
      again: the shop's own links, the back button, and a friend who lands on
      the home page and taps through to the game all dropped the code.
    */
    goTo("/");
    vi.stubGlobal("fetch", respond(200, { ok: true, message: "تم" }));
    const view = draw();
    await waitFor(() => expect(posts).toHaveLength(0));

    goTo("/product/mario?ref=sami");
    again(view);

    await waitFor(() => expect(posts).toHaveLength(1));
  });

  it("leaves the router's history state alone when it cleans the URL", async () => {
    /*
      `replaceState({}, …)` blanked the entry the router was standing on, so
      the next back-navigation and anything restoring scroll had nothing to
      read.
    */
    goTo("/product/mario?ref=sami");
    vi.stubGlobal("fetch", respond(200, { ok: true, message: "تم" }));
    draw();

    await waitFor(() => expect(window.location.search).toBe(""));
    expect(window.history.state).toMatchObject({ tanstack: "keep-me" });
  });

  it("does not post the same link twice", async () => {
    goTo("/product/mario?ref=sami");
    vi.stubGlobal("fetch", respond(200, { ok: true, message: "تم" }));
    const view = draw();
    await waitFor(() => expect(posts).toHaveLength(1));

    goTo("/product/mario?ref=sami");
    again(view);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toHaveLength(1);
  });
});
