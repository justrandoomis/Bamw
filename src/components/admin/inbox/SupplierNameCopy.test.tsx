/**
 * @vitest-environment jsdom
 */
/**
 * What the click actually does, exercised rather than read.
 *
 * The earlier version of this test asserted against the source text of
 * `AccountToolsModal.tsx` — that the file contained `stopPropagation`, that it
 * did not contain `toast.`. That is a test of the spelling, not the behaviour,
 * and it passed the whole time the detail card was missing `stopPropagation`
 * altogether, because the chip a thousand lines above it had one.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupplierNameCopy, copySilently } from "./SupplierNameCopy";

const ZELDA_ZH = "塞尔达传说 王国之泪";

/** A card that selects itself when clicked — which is what the real one does. */
function Card({
  supplierName,
  onSelect,
  onMissing,
}: {
  supplierName: string;
  onSelect: () => void;
  onMissing?: () => void;
}) {
  return (
    <button type="button" onClick={onSelect}>
      <SupplierNameCopy supplierName={supplierName} onMissing={onMissing}>
        The Legend of Zelda: Tears of the Kingdom
      </SupplierNameCopy>
    </button>
  );
}

let written: string[] = [];

beforeEach(() => {
  written = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async (text: string) => {
        written.push(text);
      }),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("clicking the game name", () => {
  it("puts the Chinese supplier name on the clipboard", async () => {
    render(<Card supplierName={ZELDA_ZH} onSelect={() => {}} />);

    fireEvent.click(screen.getByText("The Legend of Zelda: Tears of the Kingdom"));
    await vi.waitFor(() => expect(written).toEqual([ZELDA_ZH]));
  });

  it("copies the name for this edition, not the one beside it", async () => {
    /*
      The Switch 1 and Switch 2 releases of one game are two products on this
      shelf, ordered under two names. The component is handed the name for the
      line it is rendered on and cannot reach any other.
    */
    const switch2 = "塞尔达传说 王国之泪 Nintendo Switch 2 版";
    render(
      <>
        <Card supplierName={ZELDA_ZH} onSelect={() => {}} />
        <Card supplierName={switch2} onSelect={() => {}} />
      </>,
    );

    const [, second] = screen.getAllByText("The Legend of Zelda: Tears of the Kingdom");
    fireEvent.click(second!);
    await vi.waitFor(() => expect(written).toEqual([switch2]));
  });

  it("does not select or open the card", () => {
    const onSelect = vi.fn();
    render(<Card supplierName={ZELDA_ZH} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("The Legend of Zelda: Tears of the Kingdom"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still lets the rest of the card select it", () => {
    /* Stopping the click must not make the card itself unusable. */
    const onSelect = vi.fn();
    render(<Card supplierName={ZELDA_ZH} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("what the admin sees", () => {
  it("renders no button, no icon and no copy label of its own", () => {
    const { container } = render(
      <SupplierNameCopy supplierName={ZELDA_ZH}>Splatoon 3</SupplierNameCopy>,
    );

    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("svg")).toHaveLength(0);
    expect(container.textContent).toBe("Splatoon 3");
    expect(container.textContent).not.toMatch(/نسخ|copy/i);
  });

  it("never renders the Chinese name", () => {
    const { container } = render(
      <SupplierNameCopy supplierName={ZELDA_ZH}>Splatoon 3</SupplierNameCopy>,
    );
    expect(container.innerHTML).not.toContain(ZELDA_ZH);
  });

  it("carries no tooltip and no styling of its own", () => {
    /*
      The name has to look exactly as it did before the copy existed — no
      title attribute, no cursor change, nothing that hints at a hidden action.
      The class it is given is the caller's, unchanged.
    */
    render(
      <SupplierNameCopy supplierName={ZELDA_ZH} className="block truncate">
        Splatoon 3
      </SupplierNameCopy>,
    );

    const name = screen.getByText("Splatoon 3");
    expect(name.getAttribute("title")).toBeNull();
    expect(name.className).toBe("block truncate");
    expect(name.getAttribute("style")).toBeNull();
    expect(name.getAttribute("role")).toBeNull();
  });

  it("says nothing when the name is missing, and copies nothing", async () => {
    const onMissing = vi.fn();
    render(
      <SupplierNameCopy supplierName="" onMissing={onMissing}>
        Rotwood
      </SupplierNameCopy>,
    );

    fireEvent.click(screen.getByText("Rotwood"));
    expect(onMissing).toHaveBeenCalledTimes(1);
    /* The English title is never the fallback — an order placed against it is
       an order placed for the wrong game. */
    await vi.waitFor(() => expect(written).toEqual([]));
  });
});

describe("copySilently", () => {
  it("uses the clipboard API when the browser allows it", async () => {
    await expect(copySilently(ZELDA_ZH)).resolves.toBe(true);
    expect(written).toEqual([ZELDA_ZH]);
  });

  it("falls back to a selectable textarea when the API is absent", async () => {
    /* Mobile Safari and Chrome on iOS refuse `navigator.clipboard` inside a
       modal, which is exactly where this runs. */
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: () => boolean }).execCommand = exec;

    await expect(copySilently(ZELDA_ZH)).resolves.toBe(true);
    expect(exec).toHaveBeenCalled();
  });

  it("falls back when the clipboard API is present but refuses", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("NotAllowedError");
        }),
      },
    });
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: () => boolean }).execCommand = exec;

    await expect(copySilently(ZELDA_ZH)).resolves.toBe(true);
    expect(exec).toHaveBeenCalled();
  });

  it("puts the textarea off-screen rather than hiding it", async () => {
    /*
      An element with `display: none` cannot be selected, which is why the
      obvious version of this trick silently does nothing on Safari. The
      element is checked while it is on the page, since it is removed after.
    */
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    let seen: CSSStyleDeclaration | null = null;
    (document as unknown as { execCommand: () => boolean }).execCommand = () => {
      seen = document.querySelector("textarea")?.style ?? null;
      return true;
    };

    await copySilently(ZELDA_ZH);
    expect(seen).not.toBeNull();
    expect(seen!.display).not.toBe("none");
    expect(seen!.position).toBe("fixed");
    /* And it does not stay behind on the page. */
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("copies nothing when there is nothing to copy", async () => {
    await expect(copySilently("")).resolves.toBe(false);
    expect(written).toEqual([]);
  });
});
