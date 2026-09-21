/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
    const { to, params, ...anchorProps } = props;
    void to;
    void params;
    return <a {...anchorProps}>{children}</a>;
  },
}));

vi.mock("@/context/CurrencyContext", () => ({
  useCurrency: () => ({ formatIQDPrice: (value: number) => `${value.toLocaleString()} د.ع` }),
}));

vi.mock("@/components/NintendoCover", () => ({
  default: ({ usage, alt }: { usage: string; alt: string }) => (
    <img data-testid="cover" data-usage={usage} alt={alt} />
  ),
}));

import { NintendoGameCard } from "@/components/NintendoGameCard";

afterEach(cleanup);

describe("compact Nintendo game card", () => {
  it("renders square artwork, title, and price with a Switch 2 band", () => {
    render(
      <NintendoGameCard
        product={{
          id: "zelda",
          titleEn: "The Legend of Zelda",
          price: 12500,
          platform: "switch2",
          nintendoCardImage: "https://cdn.example/zelda.webp",
        }}
      />,
    );

    expect(screen.getByTestId("cover").getAttribute("data-usage")).toBe("square-card");
    expect(screen.getByText("The Legend of Zelda")).not.toBeNull();
    const price = screen.getByText("12,500 د.ع");
    expect(price).not.toBeNull();
    expect(price.className).not.toContain("truncate");
    expect(screen.getByText("Nintendo Switch 2")).not.toBeNull();
  });

  it("does not add a platform band to a Switch 1 game", () => {
    render(
      <NintendoGameCard
        product={{ id: "mario", titleEn: "Super Mario Odyssey", price: 9000, platform: "switch1" }}
      />,
    );

    expect(screen.queryByText("Nintendo Switch 2")).toBeNull();
  });

  it("shows the selected tier's before/after prices without changing the charged price", () => {
    render(
      <NintendoGameCard
        product={{
          id: "metroid",
          titleEn: "Metroid Prime 4",
          price: 9000,
          originalPrice: 15000,
          options: [{ id: "offline", name: "Offline" }],
          types: [
            {
              id: "offline_base",
              optionId: "offline",
              name: "Offline Standard",
              price: 9000,
              originalPrice: 15000,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("15,000 د.ع").className).toContain("line-through");
    expect(screen.getByText("9,000 د.ع")).not.toBeNull();
  });
});
