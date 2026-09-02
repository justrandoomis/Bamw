import { useEffect, useMemo, useState } from "react";
import { Bell, Check, Minus, Plus, ShoppingBag, TrendingDown } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Modal } from "@/hub/ui/Modal";
import { Chip } from "@/hub/ui/Bits";
import { useI18n } from "@/hub/i18n";
import { useCurrency } from "@/hub/context/CurrencyContext";
import { useNotifications } from "@/hub/context/NotificationContext";
import { DEFAULT_FOLLOW_PREFS, useUser, type FollowPrefs } from "@/hub/context/UserContext";
import { formatAmount } from "@/hub/utils/format";
import { suggestAlertTarget } from "@/hub/utils/priceIntelligence";
import { playSound } from "@/hub/utils/audio";
import { cn } from "@/hub/utils/cn";
import type { CurrencyCode, GameVideo } from "@/hub/types";
import { useCartStore } from "@/store/useCartStore";
import { useHub } from "./hubContext";
import { showAddToCartToast } from "@/utils/cart-toast";
import { resolvePurchaseImage } from "@/lib/nintendoImages";

/** Cart labels for the admin offer kinds encoded in the offer id. */
const OFFER_LABELS_AR: Record<string, string> = {
  account: "حساب أوفلاين",
  accountOnline: "حساب أونلاين",
  lend: "إقراض كارتلج",
  disc: "قرص",
};
const OFFER_LABELS_EN: Record<string, string> = {
  account: "Offline Account",
  accountOnline: "Online Account",
  lend: "Cartridge Lend",
  disc: "Disc",
};

/* -------------------------------------------------------------------------- */
/* Buy sheet                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Purchase sheet.
 *
 * Opens preselected to whichever edition the user clicked, and always shows the
 * offer that will actually be charged — including its region lock — rather than
 * a generic "add to cart".
 */
export function BuySheet({
  open,
  editionId,
  onClose,
}: {
  open: boolean;
  editionId?: string | undefined;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { formatNative, formatConverted, convert, currency } = useCurrency();
  const { addNotification } = useNotifications();
  const { game, ranked } = useHub();
  const addToCart = useCartStore((state) => state.add);
  const navigate = useNavigate();

  const options = game.options ?? [];
  const allTypes = game.types ?? [];
  const editions = game.editions ?? [];

  const [selectedOptionId, setSelectedOptionId] = useState<string>(() => options[0]?.id ?? "");
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [selectedEdition, setSelectedEdition] = useState<string>(
    () => editionId ?? editions[0]?.id ?? "",
  );
  const [quantity, setQuantity] = useState(1);

  // Available types for the currently selected option
  const availableTypes = useMemo(() => {
    if (!allTypes.length) return [];
    if (!selectedOptionId) return allTypes;
    return allTypes.filter(
      (t) => !t.optionId || t.optionId === "all" || t.optionId === selectedOptionId,
    );
  }, [allTypes, selectedOptionId]);

  useEffect(() => {
    if (open) {
      const initialOpt = options[0]?.id ?? "";
      setSelectedOptionId(initialOpt);
      const initialTypes = initialOpt
        ? allTypes.filter((t) => !t.optionId || t.optionId === "all" || t.optionId === initialOpt)
        : allTypes;
      setSelectedTypeId(initialTypes[0]?.id ?? "");
      setSelectedEdition(editionId ?? editions[0]?.id ?? "");
      setQuantity(1);
    }
  }, [open, editionId, options, allTypes, editions]);

  // When selected option changes, ensure valid selected type
  const handleSelectOption = (optId: string) => {
    setSelectedOptionId(optId);
    playSound("select");
    const matchingTypes = allTypes.filter(
      (t) => !t.optionId || t.optionId === "all" || t.optionId === optId,
    );
    if (matchingTypes.length && !matchingTypes.some((t) => t.id === selectedTypeId)) {
      setSelectedTypeId(matchingTypes[0]!.id);
    }
  };

  const selectedOption = options.find((o) => o.id === selectedOptionId);
  const selectedType = availableTypes.find((t) => t.id === selectedTypeId);
  const chosenEdition = editions.find((e) => e.id === selectedEdition);

  // Fallback candidate offers
  const candidates = useMemo(
    () =>
      ranked.filter(
        (r) => !selectedEdition || !r.offer.editionId || r.offer.editionId === selectedEdition,
      ),
    [ranked, selectedEdition],
  );
  const chosen = candidates[0];

  // Calculate unit price dynamically based on chosen Type -> Option -> Edition -> Ranked Offer
  const unitPrice = useMemo(() => {
    if (selectedType?.price != null && Number(selectedType.price) > 0) {
      return Number(selectedType.price);
    }
    if (selectedOption?.price != null && Number(selectedOption.price) > 0) {
      return Number(selectedOption.price);
    }
    if (chosenEdition?.msrp?.amount != null && chosenEdition.msrp.amount > 0) {
      return chosenEdition.msrp.amount;
    }
    if (chosen?.offer.price.amount != null) {
      return chosen.offer.price.amount;
    }
    return 0;
  }, [selectedType, selectedOption, chosenEdition, chosen]);

  const total = convert(unitPrice, "IQD") * quantity;

  const isPhysical =
    selectedOption?.id === "lend" ||
    selectedOption?.id === "disc" ||
    selectedOption?.name?.includes("Disc") ||
    selectedOption?.name?.includes("Lend") ||
    chosen?.offer.id.startsWith("lend") ||
    chosen?.offer.id.startsWith("disc");

  return (
    <Modal open={open} onClose={onClose} title={t("hero.buyNow")} size="md">
      <div className="max-h-[min(65vh,560px)] max-w-full space-y-4 overflow-y-auto overflow-x-hidden px-0.5 pe-1 [overflow-wrap:anywhere] [word-break:break-word]">
        {/* 1. Options Selection (الخيار - مثل: حساب أوفلاين / حساب أونلاين) */}
        {options.length > 0 && (
          <div>
            <p className="eyebrow mb-2">{t("purchase.title")}</p>
            <div className="grid gap-2">
              {options.map((opt, optIdx) => {
                const selected = opt.id === selectedOptionId;
                return (
                  <button
                    key={`${opt.id || opt.name}-${optIdx}`}
                    type="button"
                    onClick={() => handleSelectOption(opt.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-2xl border p-3 text-start transition-all",
                      selected
                        ? "border-primary/80 bg-primary/10 ring-1 ring-primary/25"
                        : "border-border/70 bg-card/50 hover:bg-card hover:border-border",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <span
                        dir="auto"
                        className="block truncate text-xs sm:text-sm font-bold text-foreground"
                      >
                        {opt.name}
                      </span>
                      {opt.description && (
                        <span
                          dir="auto"
                          className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-muted-foreground"
                        >
                          {opt.description}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {opt.price != null && (
                        <span className="whitespace-nowrap text-xs sm:text-sm font-black text-foreground">
                          {formatConverted({ amount: Number(opt.price), currency: "IQD" })}
                        </span>
                      )}
                      {selected && <Check className="h-4 w-4 text-emerald-600 shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. Types Selection (النوع - مثل: النسخة القياسية / نسخة الإضافة DLC) */}
        {availableTypes.length > 0 && (
          <div>
            <p className="eyebrow mb-2">{t("prices.format")}</p>
            <div className="grid gap-2">
              {availableTypes.map((typ, typIdx) => {
                const selected = typ.id === selectedTypeId;
                return (
                  <button
                    key={`${typ.id || typ.name}-${typIdx}`}
                    type="button"
                    onClick={() => {
                      setSelectedTypeId(typ.id);
                      playSound("select");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-2xl border p-3 text-start transition-all",
                      selected
                        ? "border-primary/80 bg-primary/10 ring-1 ring-primary/25"
                        : "border-border/70 bg-card/50 hover:bg-card hover:border-border",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <span
                        dir="auto"
                        className="block truncate text-xs sm:text-sm font-bold text-foreground"
                      >
                        {typ.name}
                      </span>
                      {typ.description && (
                        <span
                          dir="auto"
                          className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-muted-foreground"
                        >
                          {typ.description}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {typ.price != null && (
                        <span className="whitespace-nowrap text-xs sm:text-sm font-black text-foreground">
                          {formatConverted({ amount: Number(typ.price), currency: "IQD" })}
                        </span>
                      )}
                      {selected && <Check className="h-4 w-4 text-emerald-600 shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. Editions Selection (إذا لم تكن هناك خيارات أو لتحديد الإصدار) */}
        {editions.length > 0 && options.length === 0 && (
          <div>
            <p className="eyebrow mb-2">{t("prices.edition")}</p>
            <div className="grid gap-2">
              {editions.map((edition, edIdx) => {
                const selected = edition.id === selectedEdition;
                return (
                  <button
                    key={`${edition.id || edition.name}-${edIdx}`}
                    type="button"
                    onClick={() => {
                      setSelectedEdition(edition.id);
                      playSound("select");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-2xl border p-3 text-start transition-all",
                      selected
                        ? "border-primary/80 bg-primary/10 ring-1 ring-primary/25"
                        : "border-border/70 bg-card/50 hover:bg-card hover:border-border",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <span
                        dir="auto"
                        className="block truncate text-xs sm:text-sm font-bold text-foreground"
                      >
                        {edition.name}
                      </span>
                      {edition.description && (
                        <span
                          dir="auto"
                          className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-muted-foreground"
                        >
                          {edition.description}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {edition.msrp && (
                        <span className="whitespace-nowrap text-xs sm:text-sm font-black text-foreground">
                          {formatConverted(edition.msrp)}
                        </span>
                      )}
                      {selected && <Check className="h-4 w-4 text-emerald-600 shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Store Offer summary if applicable */}
        {chosen && !options.length && (
          <div className="rounded-xl bg-black/25 p-4">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="muted">{t("prices.store")}</span>
              <span className="font-bold">
                {chosen.offer.storeName} · {chosen.offer.region}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs">
              <span className="muted">{t("prices.price")}</span>
              <span className="num font-bold">{formatNative(chosen.offer.price)}</span>
            </div>
            {chosen.offer.regionLocked && chosen.offer.accountRegionRequired && (
              <p className="mt-3 rounded-lg bg-warn/[0.09] p-2.5 text-[11px] leading-relaxed text-warn">
                {t("prices.regionLockedNote")} ({chosen.offer.accountRegionRequired})
              </p>
            )}
          </div>
        )}

        {/* Quantity selector */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs font-bold muted">{t("common.more")}</span>
          <div className="flex items-center gap-1 rounded-xl bg-white/[0.05] p-1">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label="−"
              className="rounded-lg p-2 transition-colors hover:bg-white/[0.08]"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-8 text-center text-sm font-extrabold tabular-nums">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(10, q + 1))}
              aria-label="+"
              className="rounded-lg p-2 transition-colors hover:bg-white/[0.08]"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-white/[0.07] pt-4">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-sm font-bold">{t("prices.price")}</span>
          <span className="num text-2xl font-extrabold text-good">
            {formatAmount(total, currency)}
          </span>
        </div>
        <button
          disabled={unitPrice <= 0 && !chosen}
          onClick={() => {
            playSound("confirm");
            onClose();

            const offerKind = selectedOption?.id || chosen?.offer.id.split("-")[0] || "standard";
            const offerLabelParts = [selectedOption?.name, selectedType?.name].filter(Boolean);
            const OFFER_LABELS = t("common.yes") === "Yes" ? OFFER_LABELS_EN : OFFER_LABELS_AR;
            const offerLabel = offerLabelParts.length
              ? offerLabelParts.join(" / ")
              : (OFFER_LABELS[offerKind] ?? offerKind);

            // One source for the picture the cart line and the toast will show.
            const purchaseArt = resolvePurchaseImage(game.rawProduct ?? { image: game.coverUrl });
            const image = purchaseArt.isPlaceholder ? "" : purchaseArt.url;
            addToCart(
              {
                productId: game.id,
                title: game.title,
                ...(image ? { image } : {}),
                price: unitPrice,
                kind: isPhysical ? "hardware" : "account",
                offerKind,
                offerLabel,
                optionId: selectedOption?.id,
                optionName: selectedOption?.name,
                typeId: selectedType?.id,
                typeName: selectedType?.name,
                editionId: selectedEdition || undefined,
                requiresAddress: Boolean(isPhysical),
                meta: {
                  editionId: selectedEdition || undefined,
                  optionId: selectedOption?.id,
                  optionName: selectedOption?.name,
                  typeId: selectedType?.id,
                  typeName: selectedType?.name,
                },
              },
              quantity,
            );
            showAddToCartToast({
              title: "أُضيف إلى السلة",
              message: `${quantity > 1 ? `${quantity} × ` : ""}${game.title}${offerLabel ? ` (${offerLabel})` : ""}`,
              product: game.rawProduct ?? (image ? { image } : undefined),
              quantity,
              navigate,
              playSoundEffect: false,
            });
          }}
          className="btn btn-primary h-12 w-full text-sm disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
        >
          <ShoppingBag className="h-4 w-4" />
          {t("hero.addToCart")}
        </button>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Price alert                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Price alert dialog.
 *
 * The suggested target is the game's own recorded all-time low, not an
 * arbitrary percentage — a target the price has actually reached is one that
 * can realistically fire again.
 */
export function PriceAlertDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, intlLocale } = useI18n();
  const { currency, convert } = useCurrency();
  const { addNotification } = useNotifications();
  const { getAlert, setAlert, removeAlert } = useUser();
  const { game, headlineStats, history, bestOffer } = useHub();

  const existing = getAlert(game.slug);

  const suggestion = useMemo(() => {
    const raw = suggestAlertTarget(headlineStats, history?.allTimeLow);
    if (raw == null) return null;
    const seriesCurrency: CurrencyCode = history?.currency ?? "USD";
    return Math.round(convert(raw, seriesCurrency, currency) * 100) / 100;
  }, [headlineStats, history, convert, currency]);

  const [value, setValue] = useState("");

  useEffect(() => {
    if (!open) return;
    setValue(String(existing?.targetAmount ?? suggestion ?? ""));
  }, [open, existing, suggestion]);

  const currentAmount = bestOffer
    ? convert(bestOffer.offer.price.amount, bestOffer.offer.price.currency)
    : null;
  const parsed = Number.parseFloat(value);
  const valid = Number.isFinite(parsed) && parsed > 0;

  return (
    <Modal open={open} onClose={onClose} title={t("alert.title")} size="sm">
      <p className="text-xs leading-relaxed muted">{t("alert.subtitle")}</p>

      <label className="mt-5 block">
        <span className="eyebrow mb-2 block">{t("alert.notifyBelow")}</span>
        <span className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/25 px-4 focus-within:border-nin/50">
          <span className="text-sm font-bold muted">{currency}</span>
          <input
            data-autofocus
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="h-12 flex-1 bg-transparent font-mono text-lg font-extrabold outline-none"
          />
        </span>
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        {currentAmount != null && (
          <Chip tone="muted">
            {t("history.current")}: {formatAmount(currentAmount, currency, intlLocale)}
          </Chip>
        )}
        {suggestion != null && (
          <button onClick={() => setValue(String(suggestion))}>
            <Chip tone="good" icon={TrendingDown}>
              {t("history.allTimeLow")}: {formatAmount(suggestion, currency, intlLocale)}
            </Chip>
          </button>
        )}
      </div>

      <div className="mt-6 flex gap-2">
        <button
          disabled={!valid}
          onClick={() => {
            setAlert({
              slug: game.slug,
              targetAmount: parsed,
              currency,
              createdAt: new Date().toISOString(),
            });
            playSound("alert");
            onClose();
            addNotification({
              title: t("alert.created"),
              message: t("alert.createdBody", {
                title: game.title,
                price: formatAmount(parsed, currency, intlLocale),
              }),
              type: "price",
            });
          }}
          className="btn btn-primary h-11 flex-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Bell className="h-4 w-4" />
          {t("alert.notifyMe")}
        </button>
        {existing && (
          <button
            onClick={() => {
              removeAlert(game.slug);
              onClose();
              addNotification({ title: t("alert.removed"), type: "info" });
            }}
            className="btn btn-quiet h-11 px-4 text-xs"
          >
            {t("alert.remove")}
          </button>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Video player                                                               */
/* -------------------------------------------------------------------------- */

/** Extracts the YouTube id from any watch / short / embed URL shape. */
function youtubeId(url: string): string | undefined {
  return (
    /(?:v=|youtu\.be\/|embed\/|shorts\/|\/v\/)([\w-]{6,})/.exec(url)?.[1] ??
    (/^[\w-]{6,15}$/.test(url) ? url : undefined)
  );
}

/**
 * YouTube refuses to play (error 153) when the embed is served from
 * youtube.com without an `origin`, so the player is built from the video id
 * with the privacy-enhanced host and an explicit origin every time.
 */
function playerSrc(video: GameVideo): string | undefined {
  const id = youtubeId(video.embedUrl);
  if (!id) return undefined;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const params = new URLSearchParams({
    autoplay: "1",
    rel: "0",
    playsinline: "1",
    modestbranding: "1",
  });
  if (origin) params.set("origin", origin);
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

export function VideoDialog({ video, onClose }: { video: GameVideo | null; onClose: () => void }) {
  const src = video ? playerSrc(video) : undefined;
  return (
    <Modal open={video !== null} onClose={onClose} size="full" bare>
      {video && (
        <div className="aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
          {src ? (
            <iframe
              src={src}
              title={video.title}
              className="h-full w-full border-0"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
              allowFullScreen
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <a
                href={video.embedUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-nin px-4 py-2 text-sm font-bold text-white"
              >
                YouTube
              </a>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Follow preferences                                                         */
/* -------------------------------------------------------------------------- */

/** Notification preferences, offered right after a game is wishlisted. */
export function FollowDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { game } = useHub();
  const { getFollowPrefs, setFollowPrefs } = useUser();
  const [prefs, setPrefs] = useState<FollowPrefs>(
    () => getFollowPrefs(game.slug) ?? DEFAULT_FOLLOW_PREFS,
  );

  useEffect(() => {
    if (open) setPrefs(getFollowPrefs(game.slug) ?? DEFAULT_FOLLOW_PREFS);
  }, [open, game.slug, getFollowPrefs]);

  const rows: Array<{ key: keyof FollowPrefs; label: string }> = [
    { key: "priceDrop", label: t("wishlist.notifyDiscount") },
    { key: "newDlc", label: t("wishlist.notifyDlc") },
    { key: "newEdition", label: t("editions.title") },
    { key: "release", label: t("wishlist.notifyRelease") },
    { key: "majorUpdate", label: t("patches.title") },
    { key: "newGuide", label: t("guides.title") },
    { key: "community", label: t("community.title") },
  ];

  return (
    <Modal open={open} onClose={onClose} title={t("wishlist.added")} size="sm">
      <p className="text-xs leading-relaxed muted">
        {t("wishlist.addedBody", { title: game.title })}
      </p>

      <ul className="mt-4 space-y-1">
        {rows.map((row, rowIdx) => (
          <li key={`${row.key}-${rowIdx}`}>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.04]">
              <span className="text-sm">{row.label}</span>
              <input
                type="checkbox"
                checked={prefs[row.key]}
                onChange={(event) => setPrefs({ ...prefs, [row.key]: event.target.checked })}
                className="h-4 w-4 shrink-0 accent-[#e60012]"
              />
            </label>
          </li>
        ))}
      </ul>

      <button
        onClick={() => {
          setFollowPrefs(game.slug, prefs);
          onClose();
        }}
        className="btn btn-primary mt-5 h-11 w-full text-sm"
      >
        {t("common.save")}
      </button>
    </Modal>
  );
}
