/**
 * The games a spin can land on.
 *
 * This was a closure inside the `/api/wheel` route, which made it unreachable
 * from anywhere else: its tests could only read the route's source and assert
 * that the gates were still written there, and the live check could not ask
 * production what its wheel actually contains without reimplementing every
 * gate — a second copy that would drift from this one and report on a wheel
 * the shop does not have.
 *
 * Nothing here changed in the move. The gates are the same, in the same order,
 * for the same reasons.
 */
import { getStore } from "./db.server";
import { isGameProduct } from "./productSection";
import { resolveProductImage } from "./productImages";
import { filterPurchasable } from "./purchasable";
import { isAwaitingRelease } from "./release";
import type { WheelCandidate } from "./wheel.server";

/**
 * Kinds that are not a game, whatever the product's category says.
 *
 * `isGameProduct` is the shop's classifier and it answers "game" by default:
 * once a product carries any category id, `getProductCategory` decides from
 * that id alone, and an id it does not recognise falls through to "game".
 * Category ids created in the admin's الأقسام tab are `Date.now()` strings, so
 * they recognise nothing — and a Nintendo Switch 2 console at 749,000 IQD
 * filed under one is, to that function, a game.
 *
 * That default is load-bearing everywhere else: the imported catalogue stores
 * Arabic category titles that match no alias either, and the storefront relies
 * on them still being games. So the fix belongs here rather than in the
 * classifier, where changing it would move every shelf in the shop.
 *
 * `kind` is the field the record itself carries, independent of whatever
 * category it was later filed under.
 */
export const NOT_A_GAME = new Set([
  "hardware",
  "device",
  "accessory",
  "amiibo",
  "collectible",
  "bundle",
  "gift_card",
  "digital_code",
  "used",
]);

/** The wheel's pool, built from a list of products rather than from the store. */
export function wheelCandidatesFrom(
  products: ReadonlyArray<Record<string, unknown>>,
): WheelCandidate[] {
  const purchasable = filterPurchasable<Record<string, unknown>>(
    Array.isArray(products) ? [...products] : [],
  );

  const list: WheelCandidate[] = [];
  for (const product of purchasable) {
    if (!isGameProduct(product)) continue;
    /*
      Both gates, because they answer different questions. The classifier says
      what shelf this belongs on; this says what the record calls itself. A
      prize has to pass both — the wheel gives things away, so a wrong answer
      here costs the shop a console.
    */
    if (
      NOT_A_GAME.has(
        String(product["kind"] ?? "")
          .trim()
          .toLowerCase(),
      )
    )
      continue;
    const price = Number(product["price"]);
    /*
      A price is required, and not only because the odds are priced. A product
      with no price is not a thing the shop has decided to sell yet, and
      winning one would hand out something nobody has valued.
    */
    if (!Number.isFinite(price) || price <= 0) continue;

    /*
      A game that has not come out yet cannot be a prize.

      `filterPurchasable` does not exclude a pre-order — `isProductPriced`
      whitelists the kind on purpose, because a pre-order is a real listing a
      member may register interest in. Checkout is where the gate lives, and it
      is the right place for it: `orders.server.ts` throws `AwaitingReleaseError`
      for every line from every surface.

      Which is exactly the problem. The wheel would happily land on one, spend
      the ticket, mint the coupon and record the spin — and the member would
      then be refused at the till, with a prize that expires in fourteen days
      and a release date that may be further out than that. They lose the
      ticket and get nothing, and no path anywhere gives it back.
    */
    if (isAwaitingRelease(product)) continue;

    /*
      Nor one the shop has run out of.

      The same shape of fault as the pre-order: the storefront refuses to add
      a sold-out line to the cart, so the prize is a code the member cannot
      spend and a ticket nobody gives back. Unknown stock is not "sold out" —
      most of the imported catalogue carries none, and reading absence as zero
      would empty the wheel.
    */
    const stock = Number(product["stock"]);
    const infiniteStock = product["isInfiniteStock"] === true || stock < 0;
    if (!infiniteStock && Number.isFinite(stock) && stock <= 0) continue;

    /*
      Artwork is NOT required. Nine hundred and ninety-four of the catalogue's
      games arrived from the supplier's sheet with no cover, and they are
      overwhelmingly the 5,000-dinar games — which is precisely the bucket the
      owner asked to come up most often. Excluding them would have quietly
      removed the common prize from a wheel designed around it. They show the
      «لم يتم إضافة الصورة بعد» card, which is honest.
    */
    list.push({
      id: String(product["id"] ?? ""),
      title: String(product["title"] || product["titleEn"] || product["english_name"] || "لعبة"),
      price,
      image: resolveProductImage(product, "listing").url || null,
    });
  }
  return list.filter((candidate) => candidate.id);
}

/** The wheel's pool, read from the live catalogue. */
export async function wheelCandidates(): Promise<WheelCandidate[]> {
  const store = await getStore();
  return wheelCandidatesFrom(
    Array.isArray(store?.products) ? (store.products as Record<string, unknown>[]) : [],
  );
}
