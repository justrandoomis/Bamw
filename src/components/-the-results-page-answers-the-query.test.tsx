/**
 * @vitest-environment jsdom
 *
 * /search — the page Enter goes to.
 *
 * A dropdown holds six rows, cannot be shared, cannot be bookmarked and is
 * gone the moment the box loses focus. This is the page that answers the
 * question instead: a real URL, the whole result set, and a filter per section
 * so «نينتندو» does not bury the console under a hundred games.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
let currentSearch: { q?: string } = {};
let storeState: { data: { products: unknown[] } | undefined; isPending: boolean } = {
  data: { products: [] },
  isPending: false,
};

/*
  Partial, not whole: the router plugin rewrites a route file at build time and
  the rewritten module reaches for exports this test never names.
*/
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useSearch: () => currentSearch,
  }),
  useNavigate: () => navigate,
}));
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
}));
vi.mock("@/components/ProductCard", () => ({
  ProductCard: ({ product }: { product: Record<string, unknown> }) => (
    <a data-testid="result" data-id={String(product["id"])}>
      {String(product["titleEn"] ?? "")}
    </a>
  ),
}));
vi.mock("@/hooks/useStoreData", () => ({ useStoreData: () => storeState }));

/*
  The rest of Nintendo's games: the shop's own search answers first, then the
  titles of Nintendo's index the shop does not sell (useNintendoCatalogue).
*/
const emptyCatalogue = {
  items: [] as { slug: string; title: string }[],
  total: 0,
  genres: [],
  ready: true,
  isPending: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: () => {},
};
let catalogueState = emptyCatalogue;
const catalogueCalls: { q?: string }[] = [];
vi.mock("@/hooks/useNintendoCatalogue", () => ({
  useNintendoCatalogue: (filters: { q?: string }) => {
    catalogueCalls.push(filters);
    return catalogueState;
  },
  useNearViewport: () => () => {},
}));
vi.mock("@/components/games-db/CatalogueTitleCard", () => ({
  CatalogueTitleCard: ({ item }: { item: { slug: string; title: string } }) => (
    <a data-testid="nintendo-result" data-slug={item.slug}>
      {item.title}
    </a>
  ),
}));
vi.mock("@/utils/audio", () => ({ playSound: () => {} }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, lang: "ar" }) }));

const { Route } = await import("@/routes/search");
const SearchResultsPage = (await import("./SearchResultsPage")).default;

/*
  The route's `component` is not rendered here: the code-splitter replaces it
  with a lazily-loaded chunk that suspends. The route wires `q` from the URL
  into the page, and this renders the page the same way.
*/
const SearchPage = () => <SearchResultsPage q={currentSearch.q} />;

/* Titles are real games; prices, sales and ordering are fixture values. */
const PRODUCTS = [
  {
    id: "p1",
    title: "The Legend of Zelda: Tears of the Kingdom",
    titleEn: "The Legend of Zelda: Tears of the Kingdom",
    titleAr: "أسطورة زيلدا: دموع المملكة",
    categoryId: "cat_nintendo",
    price: 65000,
    sales: 10,
  },
  {
    id: "p2",
    title: "Mario Kart 8 Deluxe",
    titleEn: "Mario Kart 8 Deluxe",
    titleAr: "ماريو كارت ٨ ديلوكس",
    categoryId: "cat_nintendo",
    price: 55000,
    sales: 40,
  },
  {
    id: "p3",
    title: "Nintendo eShop Gift Card 50 USD",
    titleEn: "Nintendo eShop Gift Card 50 USD",
    titleAr: "بطاقة شحن نينتندو إي شوب ٥٠ دولار",
    categoryId: "cat_gift_cards",
    price: 75000,
    sales: 3,
  },
  {
    id: "p4",
    title: "Nintendo Switch 2 Console",
    titleEn: "Nintendo Switch 2 Console",
    titleAr: "جهاز نينتندو سويتش ٢",
    categoryId: "cat_hardware",
    price: 600000,
    sales: 2,
  },
  /* Not for sale: it must not appear in a result set. */
  {
    id: "p5",
    title: "Zelda Prototype",
    titleEn: "Zelda Prototype",
    titleAr: "زيلدا نموذج",
    categoryId: "cat_nintendo",
    price: 0,
    isActive: false,
  },
];

/*
  `createFileRoute` is mocked to hand the options object straight back, so the
  route's own contract can be read off it. TypeScript still sees the real
  Route type, hence the cast.
*/
const routeOptions = Route as unknown as {
  validateSearch: (input: Record<string, unknown>) => { q?: string };
  head: () => { meta: Record<string, string>[] };
};
const validate = routeOptions.validateSearch;

const shown = () => screen.queryAllByTestId("result").map((el) => el.getAttribute("data-id"));

beforeEach(() => {
  navigate.mockClear();
  currentSearch = {};
  storeState = { data: { products: PRODUCTS }, isPending: false };
  catalogueState = emptyCatalogue;
  catalogueCalls.length = 0;
});
afterEach(cleanup);

describe("the URL", () => {
  it("carries the query", () => {
    expect(validate({ q: "زيلدا" })).toEqual({ q: "زيلدا" });
  });

  it("stays optional, so /search with no query still type-checks and renders", () => {
    expect(validate({})).toEqual({});
    expect(validate({ q: "" })).toEqual({});
    expect(validate({ q: 42 })).toEqual({});
  });

  it("refuses an unbounded query string", () => {
    const long = "ا".repeat(500);
    expect(validate({ q: long }).q).toHaveLength(120);
  });

  it("is not indexable — one customer's query is not a page", () => {
    const head = routeOptions.head();
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex,follow" });
  });
});

describe("with a query", () => {
  it("answers an Arabic name", () => {
    currentSearch = { q: "زيلدا" };
    render(<SearchPage />);
    expect(shown()).toEqual(["p1"]);
  });

  it("leaves out a product the storefront is not selling", () => {
    currentSearch = { q: "زيلدا" };
    render(<SearchPage />);
    expect(shown()).not.toContain("p5");
  });

  it("counts what it found", () => {
    currentSearch = { q: "نينتندو" };
    render(<SearchPage />);
    expect(screen.getByText(/نتيجة لـ/)).toBeTruthy();
  });

  it("fills the box with the query, so it can be edited rather than retyped", () => {
    currentSearch = { q: "ماريو" };
    render(<SearchPage />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("ماريو");
  });

  it("says so when nothing matched, and offers somewhere to go", () => {
    currentSearch = { q: "غسالة" };
    render(<SearchPage />);
    expect(shown()).toEqual([]);
    expect(screen.getByText(/لا توجد نتائج لـ/)).toBeTruthy();
    expect(screen.getByText("زيلدا")).toBeTruthy();
  });
});

describe("the section filter", () => {
  it("appears once a query spans more than one shelf", () => {
    currentSearch = { q: "نينتندو" };
    render(<SearchPage />);
    expect(screen.getByText(/كل النتائج/)).toBeTruthy();
    expect(screen.getByText(/بطاقات الشحن/)).toBeTruthy();
  });

  it("narrows the grid to one shelf", () => {
    currentSearch = { q: "نينتندو" };
    render(<SearchPage />);
    fireEvent.click(screen.getByText(/بطاقات الشحن/));
    expect(shown()).toEqual(["p3"]);
  });

  it("stays out of the way when every result is on the same shelf", () => {
    currentSearch = { q: "زيلدا" };
    render(<SearchPage />);
    expect(screen.queryByText(/كل النتائج/)).toBeNull();
  });
});

describe("with no query", () => {
  it("invites a search instead of showing an empty grid", () => {
    render(<SearchPage />);
    expect(shown()).toEqual([]);
    expect(screen.getByText("ابحث في المتجر")).toBeTruthy();
  });

  it("a suggestion runs a real search", () => {
    render(<SearchPage />);
    fireEvent.click(screen.getByText("ماريو كارت"));
    expect(navigate).toHaveBeenCalledWith({ to: "/search", search: { q: "ماريو كارت" } });
  });
});

describe("while the catalogue is still loading", () => {
  it("does not claim the query found nothing", () => {
    storeState = { data: undefined, isPending: true };
    currentSearch = { q: "زيلدا" };
    render(<SearchPage />);
    expect(screen.queryByText(/لا توجد نتائج لـ/)).toBeNull();
    expect(screen.getByText("جارٍ البحث...")).toBeTruthy();
  });
});

describe("the rest of Nintendo's games", () => {
  const nintendo = (titles: string[]) => ({
    ...emptyCatalogue,
    items: titles.map((title, i) => ({ slug: `game-${i}`, title })),
    total: titles.length,
  });

  it("answer the same query, below the shop's own results", () => {
    currentSearch = { q: "زيلدا" };
    catalogueState = nintendo(["The Legend of Zelda: Echoes of Wisdom"]);
    render(<SearchPage />);
    expect(shown()).toEqual(["p1"]);
    expect(screen.getAllByTestId("nintendo-result").map((el) => el.textContent)).toEqual([
      "The Legend of Zelda: Echoes of Wisdom",
    ]);
    expect(screen.getByText("من فهرس نينتندو")).toBeTruthy();
    expect(catalogueCalls.at(-1)?.q).toBe("زيلدا");
  });

  it("make a game only Nintendo has a result, not «nothing found»", () => {
    currentSearch = { q: "Chivalware" };
    catalogueState = nintendo(["Chivalware"]);
    render(<SearchPage />);
    expect(shown()).toEqual([]);
    expect(screen.getAllByTestId("nintendo-result")).toHaveLength(1);
    expect(screen.queryByText(/لا توجد نتائج لـ/)).toBeNull();
    expect(screen.queryByText("لم نجد ما يطابق بحثك")).toBeNull();
  });
});

describe("submitting", () => {
  it("pushes a history entry, so back leaves the results", () => {
    render(<SearchPage />);
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "ماريو" } });
    fireEvent.submit(box.closest("form")!);
    expect(navigate).toHaveBeenCalledWith({ to: "/search", search: { q: "ماريو" } });
  });
});
