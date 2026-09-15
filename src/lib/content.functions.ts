import { createServerFn } from "@tanstack/react-start";

import { mergeContent, type ContentDoc } from "./content";

/**
 * Public read of the editable site content, usable from route loaders during
 * SSR and client navigation alike (a relative fetch would not resolve on SSR).
 */
export const loadSiteContent = createServerFn({ method: "GET" }).handler(
  async (): Promise<ContentDoc> => {
    /*
      The page copy, without the catalogue behind it.

      `content` is a heavy section but it is not the products, and
      `getStoreMeta()` reads everything except those. Through `getStore()` this
      loader parsed 3.8 MB of catalogue and normalised every product to render
      /policy and /account_guides — pages that mention no product at all, and
      which were measured at 590 ms and 514 ms of CPU apiece.
    */
    const { getStoreMeta } = await import("./db.server");
    const store = (await getStoreMeta()) as { content?: unknown };
    return mergeContent(store?.content);
  },
);
