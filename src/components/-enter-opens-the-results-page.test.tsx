/**
 * @vitest-environment jsdom
 *
 * The header search box, from the customer's side.
 *
 * Two things were missing and this pins both. The dropdown was a substring
 * test over `title` and `titleEn` — the same English string on every product
 * in the catalogue — so an Arabic query found nothing at all. And Enter did
 * nothing: there was no results page to go to, so the five rows the dropdown
 * could hold were the entire search.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../utils/audio", () => ({ playSound: () => {} }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => ({ user: null, updateProfile: null }) }));
vi.mock("./LanguageCurrencyModal", () => ({ default: () => null }));
vi.mock("./FlowerMenu", () => ({
  default: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
}));
vi.mock("@/lib/img", () => ({ cdnImage: (url: string) => url }));
vi.mock("@/components/NintendoCover", () => ({
  default: ({ product }: { product: Record<string, unknown> }) => (
    <span data-cover={String(product["id"])} />
  ),
}));
vi.mock("../store/useSettingsStore", () => ({
  useSettingsStore: () => ({
    soundEnabled: false,
    musicEnabled: false,
    setSoundEnabled: () => {},
    setMusicEnabled: () => {},
  }),
}));
vi.mock("../i18n", () => {
  const useI18n = () => ({ t: (key: string) => key, lang: "ar" });
  (useI18n as never as { setState: unknown }).setState = () => {};
  return { useI18n };
});

const Header = (await import("./Header")).default;

/* Titles are real games; prices and ordering are fixture values. */
const PRODUCTS = [
  {
    id: "p1",
    title: "The Legend of Zelda: Tears of the Kingdom",
    titleEn: "The Legend of Zelda: Tears of the Kingdom",
    titleAr: "أسطورة زيلدا: دموع المملكة",
    price: 65000,
    sales: 10,
  },
  {
    id: "p2",
    title: "Mario Kart 8 Deluxe",
    titleEn: "Mario Kart 8 Deluxe",
    titleAr: "ماريو كارت ٨ ديلوكس",
    price: 55000,
    sales: 40,
  },
  {
    id: "p3",
    title: "Super Mario Odyssey",
    titleEn: "Super Mario Odyssey",
    titleAr: "سوبر ماريو أوديسي",
    price: 50000,
    sales: 5,
  },
  /* Priced at nothing and inactive: the storefront does not offer it, so neither does search. */
  {
    id: "p4",
    title: "Zelda Prototype",
    titleEn: "Zelda Prototype",
    titleAr: "زيلدا نموذج",
    price: 0,
    isActive: false,
  },
];

const onNavigate = vi.fn();

function renderHeader() {
  return render(
    <Header currentView="home" onBack={() => {}} onNavigate={onNavigate} products={PRODUCTS} />,
  );
}

const box = () => screen.getByRole("combobox");
/* The list only exists while the box has focus, which a change event does not give it. */
const type = (value: string) => {
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value } });
};
const options = () => screen.queryAllByRole("option");

beforeEach(() => {
  navigate.mockClear();
  onNavigate.mockClear();
});
afterEach(cleanup);

describe("typing in the header", () => {
  it("finds a game by its Arabic name", () => {
    renderHeader();
    type("زيلدا");
    expect(options()).toHaveLength(1);
    expect(options()[0]?.textContent).toContain("Tears of the Kingdom");
  });

  it("shows the Arabic name under the English one", () => {
    renderHeader();
    type("ماريو كارت");
    expect(options()[0]?.textContent).toContain("ماريو كارت ٨ ديلوكس");
  });

  it("forgives a typo in the English name", () => {
    renderHeader();
    type("mairo kart");
    expect(options()[0]?.textContent).toContain("Mario Kart 8 Deluxe");
  });

  it("does not offer a product the storefront is not selling", () => {
    renderHeader();
    type("زيلدا");
    expect(screen.queryByText(/Zelda Prototype/)).toBeNull();
  });

  it("says so plainly when nothing matches", () => {
    renderHeader();
    type("غسالة");
    expect(options()).toHaveLength(0);
    expect(screen.getByText("لا توجد نتائج")).toBeTruthy();
  });

  it("offers nothing at all before a word is typed", () => {
    renderHeader();
    fireEvent.focus(box());
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("Enter", () => {
  it("opens the results page for what was typed", () => {
    renderHeader();
    type("ماريو");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith({ to: "/search", search: { q: "ماريو" } });
  });

  it("trims what it puts in the URL", () => {
    renderHeader();
    type("  ماريو  ");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith({ to: "/search", search: { q: "ماريو" } });
  });

  it("does nothing on an empty box", () => {
    renderHeader();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens the highlighted game instead, once the customer has arrowed to one", () => {
    renderHeader();
    type("ماريو");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("product/p2");
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("the arrow keys", () => {
  it("walk down the list", () => {
    renderHeader();
    type("ماريو");
    expect(options()).toHaveLength(2);
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("come back to the typed text after the last row", () => {
    renderHeader();
    type("ماريو");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(options().some((o) => o.getAttribute("aria-selected") === "true")).toBe(false);
  });

  it("go up from the typed text to the last row", () => {
    renderHeader();
    type("ماريو");
    fireEvent.keyDown(box(), { key: "ArrowUp" });
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("drop the highlight when the query changes under it", () => {
    renderHeader();
    type("ماريو");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    type("زيلدا");
    expect(options().some((o) => o.getAttribute("aria-selected") === "true")).toBe(false);
  });
});

describe("the rest of the list", () => {
  it("offers to show every result on its own page", () => {
    renderHeader();
    type("ماريو");
    fireEvent.click(screen.getByText("عرض كل النتائج"));
    expect(navigate).toHaveBeenCalledWith({ to: "/search", search: { q: "ماريو" } });
  });

  it("opens a game when its row is clicked", () => {
    renderHeader();
    type("زيلدا");
    fireEvent.click(options()[0]!);
    expect(onNavigate).toHaveBeenCalledWith("product/p1");
  });
});
