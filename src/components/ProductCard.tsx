import React from "react";
import { getProductCategory } from "@/lib/productSection";
import { GameCard } from "./cards/GameCard";
import { HardwareCard } from "./cards/HardwareCard";
import { AccessoryCard } from "./cards/AccessoryCard";
import { GiftCardCard } from "./cards/GiftCardCard";
import type { NintendoMediaRole } from "@/lib/nintendoImages";

/**
 * Intelligent Grid Card Dispatcher.
 * Renders tailored card templates for Game, Hardware, and Accessory products.
 *
 * `imageRole` is passed straight through to the game card. The card is reused
 * across surfaces that legitimately want different pictures of the same
 * product, so the **caller** names the role and the card never guesses. See
 * src/lib/nintendoImages.ts for what each role means.
 */
export function ProductCard({
  product,
  imageRole = "front-box",
  priority = false,
}: {
  product: any;
  /** Which picture this surface wants. Defaults to the retail box cover. */
  imageRole?: NintendoMediaRole;
  priority?: boolean;
}) {
  if (!product) return null;

  const category = getProductCategory(product);

  if (category === "hardware") {
    return <HardwareCard product={product} />;
  }

  if (category === "accessory") {
    return <AccessoryCard product={product} />;
  }

  if (category === "gift_card") {
    return <GiftCardCard product={product} />;
  }

  return <GameCard product={product} imageRole={imageRole} priority={priority} />;
}
