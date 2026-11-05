/**
 * A picture in a long product folder is served like any other.
 *
 * The file route refused every folder name over 64 characters, and a
 * product's pictures sit in a folder named by its id, made from its title. On
 * 2026-11-05 eleven square cards were in the bucket — listed there by name —
 * and answered 404 «Not found» all the same, so their pages showed «لم يتم
 * إضافة الصورة بعد». These are real paths from that day.
 */
import { describe, expect, it } from "vitest";

import { isServableFilePath } from "./file-paths";

describe("the file route's path rule", () => {
  it("serves a picture whose product folder is long", () => {
    for (const path of [
      // 81 characters of folder: Kirby and the Forgotten Land + Star-Crossed World.
      "products/prd_cat_kirby-and-the-forgotten-land-star-crossed-world-nintendo-switch-2-edition/square-card-04bf5cb6cd6e7693.webp",
      // 69: DRAGON QUEST XI S.
      "products/prd_cat_dragon-quest-xi-s-echoes-of-an-elusive-age-definitive-edition/square-card-1a2b3c4d5e6f7081.webp",
      // A short folder, as before.
      "products/prd_10cbebda7dbd4c45/front-box-0123456789abcdef.webp",
      "chat/thr_0123456789abcdef/aabbccddeeff0011.ogg",
    ]) {
      expect(isServableFilePath(path), path).toBe(true);
    }
  });

  it("still refuses anything that is not plain names and a known extension", () => {
    for (const path of [
      "products/../secrets/x.png",
      "products/%2e%2e/x.png",
      "products/a b/x.png",
      "products/x.json",
      "products/x",
      "/products/x.png",
      `products/${"a".repeat(161)}/x.png`,
      `${"abcdefghij/".repeat(46)}x.png`,
    ]) {
      expect(isServableFilePath(path), path).toBe(false);
    }
  });
});
