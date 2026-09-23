import { createFileRoute } from "@tanstack/react-router";

import { getStore, updateStore } from "@/lib/db.server";
import { body, guard, json } from "@/lib/http.server";
import { hasNintendoSquareCard } from "@/lib/nintendoListing";
import { SQUARE_CARD_FIELDS } from "@/lib/nintendoImages";
import { isGameProduct } from "@/lib/productSection";
import { requireAdmin } from "@/lib/session.server";
import { resolveProductImage } from "@/lib/productImages";
import { hasObject } from "@/lib/storage.server";
import type { StoreDoc } from "@/lib/types";

/**
 * Is there actually a file at this URL?
 *
 * «بالرغم من رفع الأدمن الصورة المربعة من القسم إلا أنه يظهر في الشاشة
 *  الرئيسية بدون صورة مربعة» — the owner, describing a picture he had saved
 * and that the shop would not show.
 *
 * The cause is that a stored URL was the only evidence anyone asked for.
 * `hasNintendoSquareCard` answers "is a URL stored", not "is the file there",
 * and a row holding a URL that 404s is therefore a row WITH a picture: it
 * leaves this queue, it sorts to the FRONT of the cartridge shelf ahead of the
 * games that really have one, and then the card prints «لم يتم إضافة الصورة
 * بعد». One dead link produces all three symptoms.
 *
 * `square-card-verify.mjs` clears the ones already stored. This stops the next
 * one being stored at all.
 *
 * The two kinds of URL are asked in the two different ways that actually
 * answer:
 *
 *   - one this shop serves resolves to an R2 key, so the bucket is asked
 *     directly — no subrequest, and no chance of a self-call being the thing
 *     that fails;
 *   - an external one is asked with a HEAD, briefly. It is given the benefit of
 *     the doubt on a timeout or a 403: a host that dislikes our HEAD is not the
 *     same as a missing file, and refusing the admin's work on that would be
 *     the worse error.
 *
 * @returns the reason it cannot be accepted, or null when it can.
 */
async function reasonImageIsMissing(imageUrl: string): Promise<string | null> {
  const local = /^(?:https?:\/\/[^/]+)?\/api\/files\/(.+)$/i.exec(imageUrl);
  if (local) {
    const key = `files/${(local[1] ?? "").split(/[?#]/, 1)[0]}`;
    return (await hasObject(key)) ? null : "الملف غير موجود في التخزين — أعد رفع الصورة";
  }

  if (!/^https?:\/\//i.test(imageUrl)) {
    /* A shop-relative path that is not `/api/files/` — nothing here can prove
       it either way, and inventing a verdict is worse than not having one. */
    return null;
  }

  try {
    const response = await fetch(imageUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(6_000),
    });
    if (response.status === 404 || response.status === 410) {
      return `الرابط يجيب ${response.status} — لا توجد صورة هناك`;
    }
    return null;
  } catch {
    /* Unreachable is not absent. See above. */
    return null;
  }
}

/**
 * The games still waiting for a square card, and a way to give them one.
 *
 * «الألعاب التي ليس لها صورة مربعة يتم تمييزها للأدمن لإضافة الصورة المربعة
 * فقط من دون التفاصيل الثانية» — so this answers exactly one question and
 * accepts exactly one field. Opening the full product editor to set one image
 * is how a queue of hundreds stops being worked.
 *
 * ## Why not a column on `product_index`
 *
 * That is where the admin table's other chips come from, and mirroring the
 * whole stack for this would mean a column, a migration, a projection, a facet
 * aggregate, two query guards and a bootstrap that only fills in on the next
 * reindex — which means the count reads zero until every product is re-saved.
 * The question here is cheap to ask directly: the store document holds every
 * image field already, and `hasNintendoSquareCard` is the same predicate the
 * storefront sorts by, so the queue and the shelf can never disagree.
 */

interface QueueRow {
  id: string;
  title: string;
  slug: string;
  price: number;
  /** Whatever picture it does have, so the admin can see what they are working on. */
  currentImage: string | null;
  hidden: boolean;
}

export const Route = createFileRoute("/api/admin/missing-square-images")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        guard(async () => {
          await requireAdmin(request);
          const url = new URL(request.url);
          const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 200));
          const search = (url.searchParams.get("q") || "").trim().toLowerCase();

          const store = await getStore();
          const products = Array.isArray(store?.products)
            ? (store.products as Record<string, unknown>[])
            : [];

          const rows: QueueRow[] = [];
          let total = 0;
          for (const product of products) {
            if (!isGameProduct(product)) continue;
            if (hasNintendoSquareCard(product)) continue;
            total += 1;

            const title = String(
              product["title"] || product["titleEn"] || product["english_name"] || "",
            );
            if (search && !title.toLowerCase().includes(search)) continue;
            if (rows.length >= limit) continue;

            rows.push({
              id: String(product["id"] ?? ""),
              title,
              slug: String(product["slug"] ?? ""),
              price: Number(product["price"]) || 0,
              currentImage: resolveProductImage(product, "listing").url || null,
              hidden: product["hidden"] === true,
            });
          }

          return json({ total, shown: rows.length, products: rows });
        }),

      /**
       * Set the square card on one product, and nothing else.
       *
       * Deliberately one field. A handler that accepted a product patch would
       * be a second product editor with none of its guards, and this one is
       * reached from a screen whose whole purpose is to move fast.
       */
      POST: async ({ request }) =>
        guard(async () => {
          await requireAdmin(request);
          const input = await body<Record<string, unknown>>(request);
          const productId = String(input["productId"] ?? "").trim();
          const imageUrl = String(input["imageUrl"] ?? "").trim();

          if (!productId) return json({ error: "معرّف المنتج مطلوب" }, { status: 400 });
          if (!imageUrl) return json({ error: "رابط الصورة مطلوب" }, { status: 400 });
          /*
            Only a URL this shop serves or an absolute http(s) one. A
            `javascript:` or `data:` value here would be written into the
            catalogue document and rendered on the storefront.
          */
          if (!/^(https?:\/\/|\/)/i.test(imageUrl)) {
            return json({ error: "رابط الصورة غير صالح" }, { status: 400 });
          }
          /*
            And it must be THERE. A URL that answers 404 is worse than no URL
            at all — it takes the game off this queue, where somebody would
            have fixed it, and puts it at the front of the shelf claiming a
            picture it has not got.
          */
          const missing = await reasonImageIsMissing(imageUrl);
          if (missing) return json({ error: missing }, { status: 400 });

          let found = false;
          await updateStore((current: StoreDoc) => {
            const products = Array.isArray(current.products)
              ? (current.products as Record<string, unknown>[])
              : [];
            const next = products.map((product) => {
              if (String(product["id"] ?? "") !== productId) return product;
              found = true;
              /*
                The canonical field, and only it. The other four names in
                `SQUARE_CARD_FIELDS` are read for compatibility with older
                imported rows; writing all five would fan one value out across
                the document and make a later correction miss four copies.
              */
              return { ...product, [SQUARE_CARD_FIELDS[0]]: imageUrl };
            });
            return { ...current, products: next } as StoreDoc;
          });

          if (!found) return json({ error: "المنتج غير موجود" }, { status: 404 });
          return json({ ok: true, productId, imageUrl });
        }),
    },
  },
});
