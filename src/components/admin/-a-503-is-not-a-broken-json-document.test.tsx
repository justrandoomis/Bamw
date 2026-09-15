/**
 * @vitest-environment jsdom
 *
 * What the owner saw when the import stopped, and why it said nothing useful.
 *
 * The run died at batch three of sixteen with «توقف عند الدفعة 3 من 16: The
 * string did not match the expected pattern». That sentence is Safari's, and
 * it is about `JSON.parse` — not about the server, which had answered a plain
 * 503 with Cloudflare's HTML error page after the Worker was cut off with
 * `exceededCpu`.
 *
 * The modal called `response.json()` *before* `if (!response.ok)`, so the
 * parser always threw first and the status — the one fact worth reporting —
 * was never read. This drives the real component against a fetch that answers
 * exactly as production did.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CatalogueImportModal from "./CatalogueImportModal";

const CSV = [
  "English Name,Cost IQD,Chinese Name,Platform,Offline Price IQD,English Support",
  "Kirby and the Forgotten Land,1711,星之卡比 探索发现,Nintendo Switch,9000,نعم",
  "Metroid Dread,7000,密特罗德 生存恐惧,Nintendo Switch,10250,نعم",
].join("\n");

/** Cloudflare's 503, near enough: an HTML body and no JSON anywhere in it. */
const CLOUDFLARE_503 = () =>
  new Response("<!DOCTYPE html><html><head><title>banan.to | 503</title></head></html>", {
    status: 503,
    headers: { "content-type": "text/html" },
  });

const ok = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function loadFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([CSV], "catalogue.csv", { type: "text/csv" });
  // jsdom's File has no `text()`; the component only needs that one method.
  Object.defineProperty(file, "text", { value: async () => CSV, configurable: true });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  /*
    Without this the previous render's markup is still mounted and
    `querySelector` hands back *its* file input — which is already carrying a
    file, and refuses to be given another.
  */
  cleanup();
  vi.restoreAllMocks();
});

describe("a batch the server refuses", () => {
  it("reports the status, not the parser's opinion of the error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => CLOUDFLARE_503()),
    );
    render(<CatalogueImportModal onClose={() => {}} onImported={() => {}} />);
    loadFile();
    await screen.findByText(/قُرئ 2 صف صالح/);

    fireEvent.click(screen.getByText("فحص بدون كتابة"));

    const message = await screen.findByText(/توقف عند الدفعة 1/, {}, { timeout: 20000 });
    expect(message.textContent).toContain("HTTP 503");
    // The sentence that reached the owner instead, and must not any more.
    expect(message.textContent).not.toContain("did not match the expected pattern");
  }, 30000);

  it("tries again before giving up, because a 503 is the Worker being cut off", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        // First attempt fails the way production did; the retry succeeds.
        return calls === 1 ? CLOUDFLARE_503() : ok({ created: 2, updated: 0, skipped: 0, results: [] });
      }),
    );
    render(<CatalogueImportModal onClose={() => {}} onImported={() => {}} />);
    loadFile();
    await screen.findByText(/قُرئ 2 صف صالح/);

    fireEvent.click(screen.getByText("فحص بدون كتابة"));

    await waitFor(
      () => expect(screen.getByText(/ستُنشأ 2 لعبة جديدة/)).toBeTruthy(),
      { timeout: 20000 },
    );
    expect(calls).toBeGreaterThan(1);
  }, 30000);

  it("does not retry a 400, because the batch itself is wrong", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: "الحد الأقصى 100 صف في الطلب الواحد" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    render(<CatalogueImportModal onClose={() => {}} onImported={() => {}} />);
    loadFile();
    await screen.findByText(/قُرئ 2 صف صالح/);

    fireEvent.click(screen.getByText("فحص بدون كتابة"));

    const message = await screen.findByText(/توقف عند الدفعة 1/, {}, { timeout: 20000 });
    // The server's own words, which say what to do about it.
    expect(message.textContent).toContain("الحد الأقصى");
    expect(calls).toBe(1);
  }, 30000);
});
