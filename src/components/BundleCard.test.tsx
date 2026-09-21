/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: React.PropsWithChildren) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock("motion/react", () => ({
  motion: {
    div: ({
      children,
      whileHover: _whileHover,
      whileTap: _whileTap,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
  },
}));

vi.mock("@/context/CurrencyContext", () => ({
  useCurrency: () => ({ formatGenericPrice: (value: number) => `${value} IQD` }),
}));

vi.mock("@/utils/audio", () => ({ playSound: vi.fn() }));
vi.mock("@/store/useCartStore", () => ({
  useCartStore: (selector: (state: { add: ReturnType<typeof vi.fn> }) => unknown) =>
    selector({ add: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({
  useMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/cart.functions", () => ({ addToCart: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/utils/cart-toast", () => ({ showAddToCartToast: vi.fn() }));

vi.mock("@/components/NintendoCover", () => ({
  default: ({ product }: { product?: Record<string, unknown> }) => (
    <img data-testid="bundle-artwork" data-product-id={String(product?.id ?? "missing")} alt="" />
  ),
}));

const { BundleCard } = await import("./BundleCard");

const games = [
  { id: "game-1", title: "Game One", price: 10_000, image: "https://cdn.test/one.webp" },
  { id: "game-2", title: "Game Two", price: 12_000, image: "https://cdn.test/two.webp" },
];

const bundle = {
  id: "bundle-1",
  title: "Test Bundle",
  price: 15_000,
  gameIds: games.map((game) => game.id),
  accountType: "offline",
};

afterEach(cleanup);

describe("home-page bundle artwork", () => {
  it("prefers the image selected by the admin over a game collage", () => {
    render(
      <BundleCard
        bundle={{ ...bundle, image: "https://cdn.test/admin-bundle.webp" } as never}
        products={games as never}
        layout="compact"
      />,
    );

    const artwork = screen.getAllByTestId("bundle-artwork");
    expect(artwork).toHaveLength(1);
    expect(artwork[0]?.getAttribute("data-product-id")).toBe("bundle-1");
  });

  it("keeps the existing game collage when no admin image exists", () => {
    render(<BundleCard bundle={bundle as never} products={games as never} layout="compact" />);

    expect(
      screen.getAllByTestId("bundle-artwork").map((image) => image.getAttribute("data-product-id")),
    ).toEqual(["game-1", "game-2"]);
  });
});
