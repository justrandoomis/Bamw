/**
 * Details page for every non-game section: amiibo, accessories, gift cards,
 * used items and account bundles. (Hardware keeps its own richer page, and
 * Nintendo Switch Games keep the Game Hub; neither is touched from here.)
 *
 * ## One framework, category-specific shapes
 *
 * The page does not decide what it contains. `buildProductView` turns the
 * stored record into a view model with the empty parts already dropped, and
 * `resolveSections` turns that view model into the ordered list of sections
 * this particular product has. The body maps over that list, and the sticky
 * navigation is built from the same list — so a tab can never point at a
 * section that was dropped, and a section can never render as a heading with
 * nothing under it.
 *
 * That is what makes a used console lead with its condition grade, a gift card
 * lead with its region, and an amiibo lead with what it unlocks, without any of
 * them being a separate page.
 *
 * ## Mobile first
 *
 * The hero is a single column that only becomes two at `lg`, in the order a
 * phone should read it: picture, name, price, key facts, then the buy button.
 * Every horizontal thing — the nav chips, the compatibility table, the
 * thumbnail strip — scrolls inside its own container, so nothing widens the
 * page itself.
 */

import { BadgeCheck, ExternalLink, FileText, Minus, Play, Plus, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

import { useCurrency } from "@/context/CurrencyContext";
import { useTranslation } from "@/i18n";
import { formatDate } from "@/lib/i18n";
import { buildProductView, type ProductView } from "@/lib/productImport/productView";
import { navSections, resolveSections, type SectionDef } from "@/lib/productImport/sectionRegistry";
import type { ProductSchema } from "@/lib/productImport/types";
import { useCartStore } from "@/store/useCartStore";
import type { ProductKind } from "@/lib/types";
import { showAddToCartToast } from "@/utils/cart-toast";
import { resolvePurchaseImage } from "@/lib/nintendoImages";
import { initialOptionId } from "@/lib/productPricing";

import {
  AmiiboFunctionalityBlock,
  BundleContentsBlock,
  CardDetailsBlock,
  CollectorBlock,
  ConditionBlock,
  DeliveryBlock,
  GameCompatibilityBlock,
  InspectionBlock,
} from "./CategoryBlocks";
import { ProductGallery } from "./ProductGallery";
import { HardwareProductDetails } from "./HardwareProductDetails";
import { SectionNav } from "./SectionNav";
import { BulletList, Section, SpecTable } from "./Section";

export function ProductDetails({
  product,
  schema,
}: {
  product: Record<string, unknown>;
  /** Section schema resolved by the caller; detected from the record otherwise. */
  schema?: ProductSchema | undefined;
}) {
  const { t, locale, dir } = useTranslation();
  const view = useMemo(() => buildProductView(product, locale, schema), [product, locale, schema]);
  if (!view) return null;
  if (view.schema.id === "hardware") {
    return <HardwareProductDetails product={product} schema={view.schema} />;
  }
  return (
    <DetailsBody
      product={product}
      view={view}
      t={t}
      locale={locale}
      dir={dir === "rtl" ? "rtl" : "ltr"}
    />
  );
}

function DetailsBody({
  product,
  view,
  t,
  locale,
  dir,
}: {
  product: Record<string, unknown>;
  view: ProductView;
  t: ReturnType<typeof useTranslation>["t"];
  locale: ReturnType<typeof useTranslation>["locale"];
  dir: "rtl" | "ltr";
}) {
  const { formatIQDPrice } = useCurrency();
  const addToCart = useCartStore((s) => s.add);
  const navigate = useNavigate();

  /*
    The page opens on the option the listing card priced: the one matching the
    base price when a priced option carries it, the cheapest priced option
    otherwise. Landing on an arbitrary first option showed a different price
    two seconds after the card's.
  */
  const [optionId, setOptionId] = useState(() => initialOptionId(view.options, view.price));
  const [variantName, setVariantName] = useState("");
  const [quantity, setQuantity] = useState(1);

  const selectedOption = view.options.find((o) => o.id === optionId);
  // Only variants belonging to the chosen option are offered, so the two
  // selectors can never combine into a variant that doesn't exist.
  const variantsForOption = view.variants.filter((v) => !v.optionId || v.optionId === optionId);
  const selectedVariant = variantsForOption.find((v) => v.name === variantName);

  const effectivePrice = selectedVariant?.price ?? selectedOption?.price ?? view.price;
  const effectiveStock = view.isInfiniteStock
    ? Number.POSITIVE_INFINITY
    : (selectedVariant?.stock ?? selectedOption?.stock ?? view.stock);
  const soldOut = effectiveStock <= 0;

  const sections = useMemo(() => resolveSections(view), [view]);
  const navItems = useMemo(() => navSections(sections), [sections]);

  const handleAddToCart = () => {
    if (soldOut) {
      toast.error(t("errors.productOutOfStock"));
      return;
    }
    const labelParts = [selectedOption?.name, selectedVariant?.name].filter(Boolean);
    /*
      The variant / option picture is a genuine per-selection override; anything
      else has to be the product's canonical front cover. This used to fall
      through to `view.images[0]`, which is the first *gallery* frame — so a
      screenshot ended up in the cart line and in the toast.
    */
    const variantImage = selectedVariant?.image || selectedOption?.image || "";
    const itemImage = variantImage || resolvePurchaseImage(product).url;
    addToCart(
      {
        productId: String(product["id"] ?? ""),
        title: view.title,
        image: itemImage,
        price: effectivePrice,
        kind: (view.schema.kind as ProductKind) ?? "accessory",
        requiresAddress: true,
        ...(labelParts.length
          ? { offerKind: labelParts.join(" / "), offerLabel: labelParts.join(" / ") }
          : {}),
      },
      quantity,
    );
    showAddToCartToast({
      title: t("product.addedToCart") || "أُضيف إلى السلة",
      message: `${quantity > 1 ? `${quantity} × ` : ""}${view.title}${labelParts.length ? ` (${labelParts.join(" / ")})` : ""}`,
      product: variantImage ? { image: variantImage } : product,
      quantity,
      navigate,
    });
  };

  return (
    <div
      className="mx-auto w-full min-w-0 max-w-6xl px-4 pt-20 pb-16 sm:px-6 sm:pt-24 lg:px-8 [overflow-wrap:anywhere]"
      dir={dir}
    >
      {/* ------------------------------ hero ------------------------------ */}
      <div className="grid min-w-0 grid-cols-1 gap-6 py-6 lg:grid-cols-2 lg:gap-10">
        <div className="min-w-0">
          <ProductGallery images={view.images} alt={view.title} />
        </div>

        <div className="min-w-0 space-y-5">
          <div className="space-y-2">
            {view.brand ? (
              <p className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
                {view.brand}
              </p>
            ) : null}
            <h1 className="text-2xl font-bold leading-snug sm:text-3xl">{view.title}</h1>
            {view.subtitle ? <p className="text-muted-foreground">{view.subtitle}</p> : null}
          </div>

          {/* Price */}
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-bold" dir="ltr">
              {formatIQDPrice(effectivePrice)}
            </span>
            {view.originalPrice > effectivePrice ? (
              <span className="text-lg text-muted-foreground line-through" dir="ltr">
                {formatIQDPrice(view.originalPrice)}
              </span>
            ) : null}
            {view.discountPercent > 0 ? (
              <span className="rounded-full bg-[var(--bad-bg,#fee)] px-2 py-0.5 text-[12px] font-bold text-[var(--brand-red-dark,#c00)]">
                −{view.discountPercent}%
              </span>
            ) : null}
          </div>

          {/* Stock */}
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold ${
                soldOut
                  ? "bg-[var(--bad-bg,#fee)] text-[var(--brand-red-dark,#c00)]"
                  : "bg-[var(--ok-bg,#e9f7ef)] text-[var(--ok-ink,#137a41)]"
              }`}
            >
              <BadgeCheck className="h-3.5 w-3.5" />
              {soldOut ? t("product.outOfStock") : t("product.inStock")}
            </span>
            {view.availability && !soldOut ? (
              <span className="text-muted-foreground">
                {t(`enums.availability.${view.availability}` as never)}
              </span>
            ) : null}
          </div>

          {view.descriptionShort ? (
            <p className="leading-relaxed text-muted-foreground">{view.descriptionShort}</p>
          ) : null}

          {/*
            The facts a buyer checks before the price: on a phone they belong
            above the button, not below it, because that is the order the
            decision is made in.
          */}
          <HeroFacts view={view} t={t} locale={locale} formatPrice={formatIQDPrice} />

          {/* Options */}
          {view.options.length > 0 && (
            <div className="space-y-2">
              <label className="text-[13px] font-bold">{t("product.selectOption")}</label>
              <div className="flex flex-wrap gap-2">
                {view.options.map((option) => {
                  const isSelected = option.id === optionId;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setOptionId(option.id);
                        setVariantName("");
                      }}
                      className={`flex min-w-0 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-start text-[13px] font-semibold transition ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary shadow-2xs"
                          : "border-border text-foreground hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>{option.name}</span>
                        {option.price != null && option.price > 0 && (
                          <span
                            className={`font-mono text-[11px] font-bold ${
                              isSelected ? "text-primary" : "text-emerald-600 dark:text-emerald-400"
                            }`}
                            dir="ltr"
                          >
                            ({formatIQDPrice(option.price)})
                          </span>
                        )}
                      </div>
                      {option.description && (
                        <span className="text-[11px] font-normal text-muted-foreground">
                          {option.description}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Variants */}
          {variantsForOption.length > 0 && (
            <div className="space-y-2">
              <label className="text-[13px] font-bold">{t("product.selectVariant")}</label>
              <div className="flex flex-wrap gap-2">
                {variantsForOption.map((variant) => {
                  const isSelected = variant.name === variantName;
                  return (
                    <button
                      key={variant.name}
                      type="button"
                      onClick={() =>
                        setVariantName(variant.name === variantName ? "" : variant.name)
                      }
                      className={`flex min-w-0 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-start text-[13px] font-semibold transition ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary shadow-2xs"
                          : "border-border text-foreground hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>{variant.name}</span>
                        {variant.price != null && variant.price > 0 && (
                          <span
                            className={`font-mono text-[11px] font-bold ${
                              isSelected ? "text-primary" : "text-emerald-600 dark:text-emerald-400"
                            }`}
                            dir="ltr"
                          >
                            ({formatIQDPrice(variant.price)})
                          </span>
                        )}
                      </div>
                      {variant.description && (
                        <span className="text-[11px] font-normal text-muted-foreground">
                          {variant.description}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quantity + add to cart */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <div className="flex items-center rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                aria-label={t("common.previous")}
                className="p-2.5 transition hover:bg-muted"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-10 text-center text-[15px] font-bold" dir="ltr">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                aria-label={t("common.next")}
                className="p-2.5 transition hover:bg-muted"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={handleAddToCart}
              disabled={soldOut}
              className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--brand-red,#e11d48)] px-6 py-3 font-bold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShoppingCart className="h-4 w-4" />
              {t("product.addToCart")}
            </button>
          </div>
        </div>
      </div>

      <SectionNav sections={navItems} />

      {/* ---------------------------- sections ---------------------------- */}
      {sections.map((section) => (
        <Section key={section.id} id={section.id} title={t(section.titleKey as never)}>
          <SectionBody
            section={section}
            view={view}
            t={t}
            locale={locale}
            formatPrice={formatIQDPrice}
          />
        </Section>
      ))}
    </div>
  );
}

/**
 * The identity strip under the price.
 *
 * Each category contributes the two or three facts it is actually sold on
 * rather than the same generic brand/model pair, and an empty strip is not
 * rendered at all.
 */
function HeroFacts({
  view,
  t,
  locale,
  formatPrice,
}: {
  view: ProductView;
  t: ReturnType<typeof useTranslation>["t"];
  locale: ReturnType<typeof useTranslation>["locale"];
  formatPrice: (value: number) => string;
}) {
  const enumLabel = (namespace: string, value: string) => {
    if (!value) return "";
    const label = t(`enums.${namespace}.${value}` as never);
    return label && !label.startsWith("enums.") ? label : value;
  };

  const rows: { label: string; value: string }[] = [];

  if (view.condition) {
    rows.push(
      { label: t("used.grade"), value: enumLabel("conditionGrade", view.condition.grade) },
      { label: t("used.packaging"), value: enumLabel("packaging", view.condition.packaging) },
      {
        label: t("used.guarantee"),
        value: enumLabel("guaranteeStatus", view.condition.guarantee),
      },
    );
  }
  if (view.giftCard) {
    rows.push(
      {
        label: t("giftCard.value"),
        value: [view.giftCard.value, view.giftCard.currency].filter(Boolean).join(" "),
      },
      { label: t("giftCard.region"), value: view.giftCard.region },
      {
        label: t("giftCard.deliveryMethod"),
        value: enumLabel("deliveryMethod", view.giftCard.deliveryMethod),
      },
    );
  }
  if (view.bundle) {
    rows.push(
      {
        label: t("bundle.gamesCount"),
        value: view.bundle.gamesCount > 0 ? String(view.bundle.gamesCount) : "",
      },
      {
        label: t("bundle.totalValue"),
        value: view.bundle.totalValue > 0 ? formatPrice(view.bundle.totalValue) : "",
      },
      {
        label: t("bundle.savings"),
        value:
          view.bundle.savingsAmount > 0
            ? `${formatPrice(view.bundle.savingsAmount)} (${view.bundle.savingsPercent}%)`
            : view.bundle.savingsPercent > 0
              ? `${view.bundle.savingsPercent}%`
              : "",
      },
      {
        label: t("bundle.accountType"),
        value: enumLabel("accountType", view.bundle.accountType),
      },
    );
  }
  if (view.amiibo) {
    rows.push(
      { label: t("amiibo.character"), value: view.amiibo.character },
      { label: t("amiibo.franchise"), value: view.amiibo.franchise },
      { label: t("amiibo.amiiboSeries"), value: view.amiibo.series },
      { label: t("amiibo.rarity"), value: enumLabel("rarity", view.amiibo.rarity) },
    );
  }

  /*
    Deliberately not `view.identity`: brand, model and SKU are the "Key facts"
    section's content, and printing them in both places is the duplication the
    page is supposed to have stopped. This strip is the category's own headline
    facts, capped so the buy button stays above the fold on a phone.
  */
  const visible = rows.filter((row) => row.value).slice(0, 4);
  if (visible.length === 0) return null;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1 text-[13px]">
      {visible.map((row, index) => (
        <div key={`${row.label}-${index}`} className="flex min-w-0 flex-col">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="break-words font-semibold">
            {row.label === t("product.releaseDate")
              ? formatDate(locale, row.value) || row.value
              : row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One section's contents, chosen by id.
 *
 * The registry has already decided this section exists and where it sits; all
 * that is left is what to draw. Anything not listed here is a registry entry
 * without a renderer, which returns null rather than an empty card.
 */
function SectionBody({
  section,
  view,
  t,
  locale,
  formatPrice,
}: {
  section: SectionDef;
  view: ProductView;
  t: ReturnType<typeof useTranslation>["t"];
  locale: ReturnType<typeof useTranslation>["locale"];
  formatPrice: (value: number) => string;
}) {
  switch (section.id) {
    case "keyFacts":
      return view.identity.length > 0 ? <SpecTable rows={view.identity} /> : null;

    case "condition":
      return view.condition ? <ConditionBlock condition={view.condition} /> : null;

    case "inspection":
      return view.condition ? <InspectionBlock condition={view.condition} /> : null;

    case "bundleContents":
      return view.bundle ? (
        <BundleContentsBlock bundle={view.bundle} formatPrice={formatPrice} />
      ) : null;

    case "cardDetails":
      return view.giftCard ? <CardDetailsBlock card={view.giftCard} /> : null;

    case "delivery":
      return <DeliveryBlock view={view} />;

    case "aboutCharacter":
      return view.amiibo ? (
        <p className="whitespace-pre-line leading-relaxed text-muted-foreground">
          {view.amiibo.characterDescription}
        </p>
      ) : null;

    case "amiiboFunctionality":
      return view.amiibo ? <AmiiboFunctionalityBlock amiibo={view.amiibo} /> : null;

    case "collector":
      return view.amiibo ? <CollectorBlock amiibo={view.amiibo} /> : null;

    case "overview":
      /*
        One description, not five. The templates carry description_full,
        description_ar, description_en, description_tr and overview because they
        are data sources; the view model has already picked the one that matches
        the reader's language.
      */
      return (
        <div className="space-y-3 whitespace-pre-line leading-relaxed text-muted-foreground">
          {view.overview ? <p>{view.overview}</p> : null}
          {view.descriptionFull && view.descriptionFull !== view.overview ? (
            <p>{view.descriptionFull}</p>
          ) : null}
        </div>
      );

    case "features":
      return <BulletList items={view.features} />;

    case "highlights":
      return <BulletList items={view.highlights} />;

    case "gameCompatibility":
      return <GameCompatibilityBlock view={view} />;

    case "compatibility":
      return (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {view.compatibility.map((item, index) => (
            <div
              key={`${item.name}-${index}`}
              className="min-w-0 rounded-xl border border-border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{item.name}</span>
                {item.status ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      item.status === "compatible"
                        ? "bg-[var(--ok-bg,#e9f7ef)] text-[var(--ok-ink,#137a41)]"
                        : item.status === "incompatible"
                          ? "bg-[var(--bad-bg,#fee)] text-[var(--brand-red-dark,#c00)]"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {t(`enums.compatibility.${item.status}` as never)}
                  </span>
                ) : null}
              </div>
              {item.notes ? (
                <p className="mt-1 text-[13px] text-muted-foreground">{item.notes}</p>
              ) : null}
              {item.productId ? (
                <a
                  href={`/product/${item.productId}`}
                  className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t("product.productDetails")}
                </a>
              ) : null}
            </div>
          ))}
        </div>
      );

    case "figureDetails":
    case "specs":
      return (
        <div className="space-y-6">
          {view.specGroups.map((group, index) => (
            <div key={`${group.label}-${index}`} className="space-y-2">
              {group.label ? (
                <h3 className="text-[15px] font-bold text-foreground">{group.label}</h3>
              ) : null}
              <SpecTable rows={group.specs} />
            </div>
          ))}
        </div>
      );

    case "boxContents":
      return (
        <ul className="grid gap-2 sm:grid-cols-2">
          {view.boxContents.map((item, index) => (
            <li
              key={`${item.name}-${index}`}
              className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-[14px]"
            >
              <span className="min-w-0">
                {item.name}
                {item.notes ? (
                  <span className="block text-[12px] text-muted-foreground">{item.notes}</span>
                ) : null}
              </span>
              {item.quantity ? (
                <span
                  className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[12px] font-bold"
                  dir="ltr"
                >
                  ×{item.quantity}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      );

    case "howToRedeem":
      return (
        <>
          {view.usageSteps.length > 0 ? (
            <ol className="space-y-2">
              {view.usageSteps.map((step, index) => (
                <li
                  key={`${step}-${index}`}
                  className="flex min-w-0 items-start gap-3 rounded-xl border border-border px-4 py-3 text-[14px] leading-relaxed"
                >
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-bold text-primary"
                    dir="ltr"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {view.usageUrl ? (
            <a
              href={view.usageUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex items-center gap-1 text-[13px] font-bold text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("product.officialSite")}
            </a>
          ) : null}
          {view.usageTerms ? (
            <p className="mt-3 whitespace-pre-line text-[13px] text-muted-foreground">
              {view.usageTerms}
            </p>
          ) : null}
        </>
      );

    case "requirements":
      return <BulletList items={view.requirements} />;

    case "gallery":
      return (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {view.gallery.map((item, index) => (
            <figure
              key={`${item.url}-${index}`}
              className="min-w-0 overflow-hidden rounded-xl border border-border"
            >
              {/*
                `contain` on a product photograph, never `cover`: these are
                packshots of one object at whatever aspect the supplier shot
                them, and cropping them to a uniform rectangle cuts the product.
              */}
              <img
                src={item.url}
                alt={item.title ?? view.title}
                loading="lazy"
                className="aspect-video w-full bg-muted/30 object-contain"
              />
              {item.title || item.description ? (
                <figcaption className="p-3 text-[13px]">
                  {item.title ? <span className="font-bold">{item.title}</span> : null}
                  {item.description ? (
                    <span className="block text-muted-foreground">{item.description}</span>
                  ) : null}
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      );

    case "videos":
      return (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {view.videos.map((video, index) => (
            <a
              key={`${video.url}-${index}`}
              href={video.url}
              target="_blank"
              rel="noreferrer noopener"
              className="group flex min-w-0 items-center gap-3 rounded-xl border border-border p-3 transition hover:border-primary/50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Play className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{video.title || video.url}</span>
                {video.type ? (
                  <span className="text-[12px] text-muted-foreground">
                    {t(`enums.videoType.${video.type}` as never)}
                  </span>
                ) : null}
              </span>
            </a>
          ))}
        </div>
      );

    case "documentation":
      return (
        <ul className="space-y-2">
          {view.documents.map((doc, index) => (
            <li key={`${doc.url}-${index}`} className="min-w-0">
              <a
                href={doc.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex min-w-0 items-center gap-2 rounded-xl border border-border px-4 py-3 text-[14px] transition hover:border-primary/50"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate font-semibold">{doc.title || doc.url}</span>
                {doc.type ? (
                  <span className="ms-auto shrink-0 text-[12px] text-muted-foreground">
                    {t(`enums.documentType.${doc.type}` as never)}
                  </span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      );

    case "warranty":
      return (
        <div className="space-y-3">
          {view.warranty.length > 0 ? <SpecTable rows={view.warranty} /> : null}
          {view.refundPolicy ? (
            <div>
              <h3 className="mb-1 text-[14px] font-bold">{t("giftCard.refundPolicy")}</h3>
              <p className="whitespace-pre-line text-[14px] leading-relaxed text-muted-foreground">
                {view.refundPolicy}
              </p>
            </div>
          ) : null}
        </div>
      );

    case "updates":
      return (
        <ol className="space-y-3">
          {view.updates.map((update, index) => (
            <li
              key={`${update.version}-${index}`}
              className="min-w-0 rounded-xl border border-border p-4"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                {update.version ? (
                  <span className="font-bold" dir="ltr">
                    v{update.version}
                  </span>
                ) : null}
                {update.date ? (
                  <span className="text-[12px] text-muted-foreground">
                    {formatDate(locale, update.date) || update.date}
                  </span>
                ) : null}
              </div>
              {update.title ? <p className="mt-1 font-semibold">{update.title}</p> : null}
              {update.changes ? (
                <p className="mt-1 whitespace-pre-line text-[13px] text-muted-foreground">
                  {update.changes}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      );

    case "reviews":
      return (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {view.externalReviews.map((review, index) => (
            <blockquote
              key={`${review.source}-${index}`}
              className="min-w-0 rounded-xl border border-border p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <cite className="font-bold not-italic">{review.source}</cite>
                {review.score ? (
                  <span className="font-bold text-primary" dir="ltr">
                    {review.score}
                  </span>
                ) : null}
              </div>
              {review.quote ? (
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  {review.quote}
                </p>
              ) : null}
            </blockquote>
          ))}
        </div>
      );

    case "prosCons":
      return (
        <div className="grid min-w-0 gap-6 sm:grid-cols-2">
          {view.pros.length > 0 && (
            <div className="min-w-0">
              <h3 className="mb-2 text-[15px] font-bold">{t("product.sections.pros")}</h3>
              <BulletList items={view.pros} tone="good" />
            </div>
          )}
          {view.cons.length > 0 && (
            <div className="min-w-0">
              <h3 className="mb-2 text-[15px] font-bold">{t("product.sections.cons")}</h3>
              <BulletList items={view.cons} tone="bad" />
            </div>
          )}
        </div>
      );

    case "faq":
      return (
        <div className="space-y-2">
          {view.faq.map((item, index) => (
            <details
              key={`${item.question}-${index}`}
              className="min-w-0 rounded-xl border border-border p-4"
            >
              <summary className="cursor-pointer font-semibold">{item.question}</summary>
              <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-muted-foreground">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      );

    case "sources":
      return (
        <ul className="space-y-2">
          {view.sources.map((source, index) => (
            <li key={`${source.url}-${index}`} className="min-w-0">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex min-w-0 items-center gap-2 text-[13px] text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 truncate font-semibold">{source.name}</span>
                {source.type ? (
                  <span className="shrink-0 text-muted-foreground">
                    · {t(`enums.sourceType.${source.type}` as never)}
                  </span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      );

    default:
      return null;
  }
}
