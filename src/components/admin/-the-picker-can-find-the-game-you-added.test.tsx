/**
 * @vitest-environment jsdom
 *
 * The admin's bundle game picker, from the admin's side.
 *
 * The owner reported it plainly: «عند اضافه العاب في البندل فعند البحث في
 * اختار الألعاب المتضمنه في هذا البندل لا يبحث عن الالعاب المضافه». Four
 * things stacked up to make that true, and each of them is pinned here:
 *
 *  1. the component was handed `products` — which in AdminDashboard is ONE
 *     PAGE of fifty rows from `/api/admin/products` (ADMIN_PAGE_SIZE = 50)
 *     against a catalogue of ~150. Two thirds of the shop was never here;
 *  2. with an empty box it showed `slice(0, 30)` of that page — thirty of a
 *     hundred and fifty, and a game already in the bundle could fall off;
 *  3. it matched `title.includes(q) || titleEn.includes(q)`, and production
 *     has `title === titleEn === the English string`, so an Arabic query
 *     matched nothing;
 *  4. and, worst of all, its source carried no Arabic name to match. The rows
 *     `/api/admin/products` returns are `ProductIndexRow`, which has `title`
 *     and `titleEn` and no `titleAr` at all — so no client-side fix could have
 *     rescued an Arabic query from that endpoint.
 *
 * There is a fifth, quieter one: `originalPrice` — the struck-through price a
 * customer sees — was re-summed from that fifty-row page on every toggle, so
 * a selected game that was not on the page silently stopped counting.
 *
 * ## A cause that was recorded and is not real
 *
 * The commit that shipped this fix also blamed `isActive !== false` for
 * excluding freshly imported games. It did not exclude anything.
 * `ProductIndexRow` has no `isActive` field (product-index.server.ts:170-210,
 * :488-512), so `p.isActive !== false` was vacuously true for every row the
 * picker ever saw. The importer marks a new game with `isHidden: true`
 * (gameImportForm.ts), which that filter never looked at.
 *
 * Hidden products still matter, for a different reason the fix now handles:
 * the public catalogue filters them out, and a bundle's contents are resolved
 * against that filtered array — so a hidden game is saved into the bundle and
 * then absent from it on the storefront. The picker says so rather than
 * letting it happen quietly.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const catalogue = vi.fn();

vi.mock("@/lib/api", () => ({
  adminApi: { catalogue: () => catalogue() },
  fileToDataUrl: async () => "data:,",
}));
vi.mock("@/components/NintendoCover", () => ({
  default: ({ product }: { product: Record<string, unknown> }) => (
    <span data-cover={String(product["id"])} />
  ),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const BundlesManager = (await import("./BundlesManager")).default;

/* Titles are real games; prices and ids are fixture values. */
const game = (n: number, en: string, ar: string, extra: Record<string, unknown> = {}) => ({
  id: `p${n}`,
  title: en,
  titleEn: en,
  titleAr: ar,
  price: 50000 + n,
  kind: "account",
  ...extra,
});

/** What AdminDashboard actually passes: one page, and not the interesting one. */
const ONE_PAGE = [
  game(1, "Super Mario Odyssey", "سوبر ماريو أوديسي"),
  game(2, "Splatoon 3", "سبلاتون ٣"),
];

/** What the shop actually holds. */
const WHOLE_CATALOGUE = [
  ...ONE_PAGE,
  game(3, "The Legend of Zelda: Tears of the Kingdom", "أسطورة زيلدا: دموع المملكة"),
  game(4, "Mario Kart 8 Deluxe", "ماريو كارت ٨ ديلوكس"),
  // Just imported: saved hidden on purpose, and the one the admin is looking for.
  // Production shape for a freshly imported game: `isHidden`, and nothing else.
  game(5, "Metroid Prime 4: Beyond", "ميترويد برايم ٤", { isHidden: true }),
  game(6, "Nintendo Switch 2 Console", "جهاز نينتندو سويتش ٢", { kind: "hardware" }),
];

const BUNDLE = {
  id: "bnd_1",
  title: "بندل الأبطال",
  titleEn: "Heroes Bundle",
  description: "",
  price: 90000,
  originalPrice: 120000,
  image: "",
  // A game that is NOT on the loaded page — the case that used to lose its name
  // and its price.
  gameIds: ["p3"],
  accountType: "primary" as const,
  stock: 5,
  isActive: true,
  badge: "",
  features: [],
  deliveryTime: "",
};

const onSaveBundles = vi.fn();

function renderManager(bundles = [BUNDLE]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BundlesManager
        bundles={bundles as never}
        products={ONE_PAGE as never}
        onSaveBundles={onSaveBundles}
      />
    </QueryClientProvider>,
  );
}

/** Open the editor for the one bundle. */
async function openEditor() {
  renderManager();
  fireEvent.click(screen.getByTitle("تعديل البندل"));
  await screen.findByPlaceholderText(/ابحث بالاسم العربي/);
}

const pickerBox = () => screen.getByPlaceholderText(/ابحث بالاسم العربي/);
const type = (value: string) => fireEvent.change(pickerBox(), { target: { value } });
const rowIds = () =>
  screen.queryAllByTestId("picker-row").map((el) => el.getAttribute("data-id"));

beforeEach(() => {
  onSaveBundles.mockClear();
  catalogue.mockReset();
  catalogue.mockResolvedValue({ products: WHOLE_CATALOGUE });
});
afterEach(cleanup);

describe("what the picker is searching", () => {
  it("asks for the whole catalogue, not the page it was handed", async () => {
    await openEditor();
    await waitFor(() => expect(catalogue).toHaveBeenCalled());
  });

  it("says how many products it is searching, so «not found» means something", async () => {
    await openEditor();
    // Five: the six in the catalogue, minus the console.
    await screen.findByText(/البحث في 5 منتجًا من كامل الكتالوج/);
  });

  it("leaves hardware out — a console is not a game in a bundle", async () => {
    await openEditor();
    await screen.findByText(/البحث في 5 منتجًا/);
    type("switch");
    expect(screen.queryByText("Nintendo Switch 2 Console")).toBeNull();
  });
});

describe("finding a game that is not on the loaded page", () => {
  it("finds it by its English name", async () => {
    await openEditor();
    await screen.findByText(/البحث في 5 منتجًا/);
    type("mario kart");
    await screen.findByText("Mario Kart 8 Deluxe");
  });

  it("finds it by its Arabic name — the thing that was reported", async () => {
    await openEditor();
    await screen.findByText(/البحث في 5 منتجًا/);
    type("ماريو كارت");
    await screen.findByText("Mario Kart 8 Deluxe");
  });

  it("forgives a typo", async () => {
    await openEditor();
    await screen.findByText(/البحث في 5 منتجًا/);
    type("mairo kart");
    await screen.findByText("Mario Kart 8 Deluxe");
  });

  it("finds a game the importer saved hidden, and says that it is hidden", async () => {
    await openEditor();
    await screen.findByText(/البحث في 5 منتجًا/);
    type("metroid");
    await screen.findByText("Metroid Prime 4: Beyond");
    expect(screen.getAllByText("مخفي").length).toBeGreaterThan(0);
  });

  it("says so plainly when the shop really does not have it", async () => {
    await openEditor();
    await screen.findByText(/البحث في 5 منتجًا/);
    type("غسالة");
    await screen.findByText(/لا توجد لعبة تطابق/);
  });
});

describe("the games already in the bundle", () => {
  it("shows the name of one that is not on the loaded page", async () => {
    await openEditor();
    await screen.findByText(/البحث في 5 منتجًا/);
    // Before the fix this chip read «لعبة #p3» — the id, with no name behind it.
    const chip = screen.getByText(/^🎮/);
    expect(chip.textContent).toContain("Tears of the Kingdom");
    expect(screen.queryByText(/لعبة #p3/)).toBeNull();
  });

  it("keeps it in the list even while a search that excludes it is running", async () => {
    await openEditor();
    await screen.findByText(/البحث في 5 منتجًا/);
    type("metroid");
    // The chosen game stays selectable, so a choice can always be undone.
    await screen.findByText("Metroid Prime 4: Beyond");
    expect(screen.getAllByText(/Tears of the Kingdom/).length).toBeGreaterThan(0);
  });
});

describe("the struck-through price", () => {
  it("is left alone when a selected game cannot be resolved", async () => {
    // The catalogue never arrives, so only the two-row page is available and
    // `p3` cannot be priced. The admin's own figure must survive.
    catalogue.mockRejectedValue(new Error("offline"));
    await openEditor();
    // And it says so, rather than claiming to be searching the whole shop.
    await screen.findByText(/تعذّر تحميل كامل الكتالوج/);
    type("splatoon");
    fireEvent.click(await screen.findByText("Splatoon 3"));
    fireEvent.click(screen.getByText("حفظ التعديلات"));
    const saved = onSaveBundles.mock.calls.at(-1)?.[0]?.[0];
    expect(saved.originalPrice).toBe(120000);
  });

  it("is the sum of the selection once the whole catalogue is there", async () => {
    await openEditor();
    await screen.findByText(/البحث في 5 منتجًا/);
    type("mario kart");
    fireEvent.click(await screen.findByText("Mario Kart 8 Deluxe"));
    fireEvent.click(screen.getByText("حفظ التعديلات"));
    const saved = onSaveBundles.mock.calls.at(-1)?.[0]?.[0];
    // p3 (50003) + p4 (50004)
    expect(saved.originalPrice).toBe(100007);
    expect(saved.gameIds.map(String).sort()).toEqual(["p3", "p4"]);
  });
});

describe("when the catalogue does not arrive", () => {
  it("says so instead of quietly becoming the bug again", async () => {
    catalogue.mockRejectedValue(new Error("offline"));
    await openEditor();
    await screen.findByText(/تعذّر تحميل كامل الكتالوج/);
    expect(screen.queryByText(/من كامل الكتالوج، بما فيها المخفية/)).toBeNull();
  });
});

describe("the bundle card in the list", () => {
  it("counts the games the bundle actually has, not the ones on the loaded page", async () => {
    renderManager();
    // p3 is in the bundle and not in the two-row page it was handed.
    await screen.findByText(/Tears of the Kingdom/);
  });
});

describe("the row cap", () => {
  it("counts every match, and only draws the first sixty", async () => {
    /* Eighty games, all matching «mario», so the cap is in play. */
    const many = Array.from({ length: 80 }, (_, i) =>
      game(100 + i, `Super Mario Game ${i}`, `سوبر ماريو ${i}`),
    );
    catalogue.mockResolvedValue({ products: [...WHOLE_CATALOGUE, ...many] });
    await openEditor();
    await screen.findByText(/البحث في 85 منتجًا/);
    type("mario");
    // The count is the true number of matches, not the number of rows drawn.
    await screen.findByText(/— 8[0-9] نتيجة/);
    await screen.findByText(/يُعرض أول 60/);
    expect(rowIds().length).toBe(60);
  });
});

describe("searching a bundle that already has games in it", () => {
  /*
    The two ways the fix reproduced the very bug it fixed. Both were found by
    an adversarial read of the shipped code, and both are the owner's sentence
    read literally: «لا يبحث عن الالعاب المضافه».
  */
  const MANY = Array.from({ length: 12 }, (_, i) =>
    game(200 + i, `Filler Game ${i}`, `لعبة ${i}`),
  );
  const CROWDED = {
    ...BUNDLE,
    gameIds: MANY.map((g) => g.id),
  };

  function renderCrowded() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(
      <QueryClientProvider client={client}>
        <BundlesManager
          bundles={[CROWDED] as never}
          products={ONE_PAGE as never}
          onSaveBundles={onSaveBundles}
        />
      </QueryClientProvider>,
    );
  }

  it("puts the match first, not below a dozen games already chosen", async () => {
    catalogue.mockResolvedValue({ products: [...WHOLE_CATALOGUE, ...MANY] });
    renderCrowded();
    fireEvent.click(screen.getByTitle("تعديل البندل"));
    await screen.findByText(/البحث في 17 منتجًا/);
    type("ماريو كارت");
    await screen.findByText("Mario Kart 8 Deluxe");
    // Row zero. Before this, it was row thirteen of a box that shows about ten.
    expect(rowIds()[0]).toBe("p4");
  });

  it("does not call a game it is displaying unfindable", async () => {
    await openEditor();
    await screen.findByText(/البحث في 5 منتجًا/);
    // p3 — Tears of the Kingdom — is already in the bundle.
    type("زيلدا");
    await screen.findByText(/— 1 نتيجة/);
    expect(screen.queryByText(/لا توجد لعبة تطابق/)).toBeNull();
  });
});

describe("a hidden game inside a bundle", () => {
  it("warns that the customer will not see it in the bundle's contents", async () => {
    await openEditor();
    await screen.findByText(/البحث في 5 منتجًا/);
    type("metroid");
    fireEvent.click(await screen.findByText("Metroid Prime 4: Beyond"));
    await screen.findByText(/من الألعاب المختارة مخفية/);
  });

  it("says nothing when every chosen game is live", async () => {
    await openEditor();
    await screen.findByText(/البحث في 5 منتجًا/);
    expect(screen.queryByText(/من الألعاب المختارة مخفية/)).toBeNull();
  });
});
