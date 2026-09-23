/**
 * @vitest-environment jsdom
 *
 * The square-image queue, as a tool for the person actually doing the work.
 *
 * «عند الضغط على اسم اللعبة ينسخ، وزر عند الضغط عليه يذهب الى محرك جوجل لكي
 *  يبحث اللعبة بشكل يدوي عن صورة مربعة للعبة.»
 *
 * Two hundred and eighty-two games are waiting in this queue, and every one of
 * them is the same three moves: read the name, find a square cover, paste the
 * URL. The name was plain text, so finding the cover meant retyping «Crash Team
 * Racing Nitro-Fueled – Nitros Oxide Edition» into a search box by hand, with
 * an en dash in it. That is not a small friction at two hundred and eighty-two
 * repetitions; it is the difference between the queue being worked and not.
 *
 * What is asserted here is what could actually be got wrong:
 *
 *   - the name is a BUTTON, so it is reachable by keyboard and announced as
 *     something that does a thing, rather than a `<div>` with an onClick;
 *   - it copies the title and NOT the price beside it;
 *   - a copy that failed does not toast that it succeeded — the helper returns
 *     a boolean for that reason and it would be easy to ignore;
 *   - the search link carries the platform words, because «Split Fiction»
 *     alone returns stock photography rather than cover art;
 *   - and it opens with `noopener`, so the new tab cannot reach back into an
 *     admin session.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const copySilently = vi.fn(async (_text: string) => true);
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("./inbox/SupplierNameCopy", () => ({ copySilently: (t: string) => copySilently(t) }));
vi.mock("sonner", () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}));
vi.mock("./ImageUploadField", () => ({
  ImageUploadField: () => <div data-testid="upload" />,
}));

const ROW = {
  id: "p1",
  title: "Crash Team Racing Nitro-Fueled – Nitros Oxide Edition",
  slug: "crash-team-racing",
  price: 8000,
  currentImage: null,
  hidden: false,
};

vi.mock("@/lib/api", () => ({
  api: { fetch: vi.fn(async () => ({ total: 282, shown: 1, products: [ROW] })) },
}));

const mod = await import("./MissingSquareImagesView");
const MissingSquareImagesView = mod.default;
const { googleImagesUrl } = mod;

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MissingSquareImagesView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  copySilently.mockReset().mockResolvedValue(true);
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(cleanup);

describe("the search link", () => {
  it("asks for cover art on the right platform, not for the bare title", () => {
    const url = googleImagesUrl("Split Fiction");
    expect(url).toContain(encodeURIComponent("Split Fiction Nintendo Switch cover art"));
  });

  it("goes to the images tab under either of Google's spellings for it", () => {
    const url = googleImagesUrl("Balatro");
    expect(url).toContain("udm=2");
    expect(url).toContain("tbm=isch");
  });

  /* An en dash, a slash and a bracket all appear in real rows of this queue. */
  it("encodes a title that would otherwise break the query", () => {
    const url = googleImagesUrl("Pokémon Sword / Shield [0:10]");
    expect(url).not.toContain(" ");
    expect(url).not.toContain("[");
    expect(url).toContain("https://www.google.com/search?");
  });

  it("survives a missing title instead of throwing", () => {
    expect(() => googleImagesUrl(undefined as unknown as string)).not.toThrow();
  });
});

describe("the row", () => {
  it("offers the name as a button, not as text with a click handler", async () => {
    renderView();
    const button = await screen.findByRole("button", { name: `نسخ اسم اللعبة ${ROW.title}` });
    expect(button.tagName).toBe("BUTTON");
  });

  it("copies the title, and nothing of the price beside it", async () => {
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: `نسخ اسم اللعبة ${ROW.title}` }));
    await waitFor(() => expect(copySilently).toHaveBeenCalledWith(ROW.title));
    const firstArg = copySilently.mock.calls.at(0)?.at(0) ?? "";
    expect(String(firstArg)).not.toContain("8,000");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  /*
    THE ONE WORTH PINNING. `copySilently` returns false on a browser that
    refused the clipboard, and a screen that toasts «تم النسخ» anyway teaches
    the admin to trust a paste that will not happen.
  */
  it("does not claim a copy that did not happen", async () => {
    copySilently.mockResolvedValue(false);
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: `نسخ اسم اللعبة ${ROW.title}` }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("links out to the images search for that exact game", async () => {
    renderView();
    const link = await screen.findByRole("link", { name: `ابحث في صور جوجل عن ${ROW.title}` });
    expect(link.getAttribute("href")).toBe(googleImagesUrl(ROW.title));
  });

  it("opens it in a tab that cannot reach back into the admin session", async () => {
    renderView();
    const link = await screen.findByRole("link", { name: `ابحث في صور جوجل عن ${ROW.title}` });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
  });
});
