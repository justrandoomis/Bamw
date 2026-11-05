import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CurrencyCode, Money, RegionCode } from "@/hub/types";
import { formatAmount, formatMoney } from "@/hub/utils/format";
import { useI18n } from "@/hub/i18n";
import { useCurrency as useSiteCurrency } from "@/context/CurrencyContext";
import { fetchExchangeRates, type ExchangeRates } from "@/hub/services/exchangeService";

/**
 * Display currency + FX.
 *
 * Store prices are always kept in the store's own currency; conversion happens
 * at render time only, and the converted figure is always labelled as
 * approximate next to the authoritative local price.
 */

const STORAGE_KEY = "banam:currency";

export const CURRENCY_BY_REGION: Record<RegionCode, CurrencyCode> = {
  US: "USD",
  JP: "JPY",
  EU: "EUR",
  UK: "GBP",
  HK: "HKD",
  AU: "AUD",
  CA: "CAD",
  BR: "BRL",
  SA: "SAR",
  AE: "AED",
};

export const SUPPORTED_CURRENCIES: CurrencyCode[] = [
  "IQD",
  "USD",
  "SAR",
  "AED",
  "EUR",
  "GBP",
  "JPY",
  "HKD",
  "AUD",
  "CAD",
  "BRL",
];

interface CurrencyValue {
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  rates: ExchangeRates | null;
  ratesUpdatedAt: string | null;
  /** Converts between any two supported currencies via the USD base. */
  convert: (amount: number, from: CurrencyCode, to?: CurrencyCode) => number;
  /** Formats in the money's own currency (authoritative store price). */
  formatNative: (money: Money | undefined) => string | null;
  /** Converts into the display currency, then formats. */
  formatConverted: (money: Money | undefined) => string | null;
  formatIn: (amount: number, currency: CurrencyCode) => string;
  isStale: boolean;
}

const CurrencyContext = createContext<CurrencyValue | null>(null);

function readStored(): CurrencyCode {
  if (typeof window === "undefined") return "IQD";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) as CurrencyCode | null;
    if (stored && SUPPORTED_CURRENCIES.includes(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "IQD";
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { intlLocale } = useI18n();
  // The hub prices in whatever the shopper picked in the flower menu; IQD is
  // the store's own currency and the default.
  const site = useSiteCurrency();
  const siteCurrency = site.currency.toUpperCase();
  /*
    The shop's own dollar rate — the one the cards, the cart and the wallet use.
    The game pages used to convert at the 1310 snapshot bundled with the app
    (`VITE_FX_ENDPOINT` was never set), so the same game cost one dollar figure
    on its card and another on its own page.
  */
  const shopIqdRate = site.usdIqdRate;
  const [currency, setCurrencyState] = useState<CurrencyCode>(readStored);

  useEffect(() => {
    if (SUPPORTED_CURRENCIES.includes(siteCurrency as CurrencyCode)) {
      setCurrencyState(siteCurrency as CurrencyCode);
    }
  }, [siteCurrency]);
  const [fetchedRates, setRates] = useState<ExchangeRates | null>(null);
  /*
    Dinars and dollars always come from the shop, so dinar→dollar conversion
    works from the first frame (no "$25,000.00" while the other rates load);
    the remaining currencies come from the FX source as before.
  */
  const rates = useMemo<ExchangeRates>(
    () => ({
      base: "USD",
      updatedAt: fetchedRates?.updatedAt ?? new Date().toISOString(),
      live: fetchedRates?.live ?? false,
      rates: { ...(fetchedRates?.rates ?? {}), USD: 1, IQD: shopIqdRate },
    }),
    [fetchedRates, shopIqdRate],
  );

  useEffect(() => {
    let cancelled = false;
    fetchExchangeRates()
      .then((next) => {
        if (!cancelled) setRates(next);
      })
      .catch(() => {
        /* the UI falls back to native prices only */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setCurrency = useCallback((next: CurrencyCode) => {
    setCurrencyState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<CurrencyValue>(() => {
    const convert = (amount: number, from: CurrencyCode, to: CurrencyCode = currency) => {
      if (from === to) return amount;
      if (!rates) return amount;
      const fromRate = rates.rates[from];
      const toRate = rates.rates[to];
      if (!fromRate || !toRate) return amount;
      const inUsd = amount / fromRate;
      const converted = inUsd * toRate;
      // Yen-style currencies read wrong with decimals.
      return to === "JPY" ? Math.round(converted) : Math.round(converted * 100) / 100;
    };

    // Staleness is about the third-party currencies only; dinars and dollars are the shop's.
    const ageMs = fetchedRates ? Date.now() - new Date(fetchedRates.updatedAt).getTime() : 0;

    return {
      currency,
      setCurrency,
      rates,
      ratesUpdatedAt: fetchedRates?.updatedAt ?? null,
      convert,
      formatNative: (money) => formatMoney(money, intlLocale),
      formatConverted: (money) =>
        money ? formatAmount(convert(money.amount, money.currency), currency, intlLocale) : null,
      formatIn: (amount, code) => formatAmount(amount, code, intlLocale),
      isStale: Boolean(fetchedRates) && ageMs > 24 * 3600_000,
    };
  }, [currency, rates, fetchedRates, setCurrency, intlLocale]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): CurrencyValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within <CurrencyProvider>");
  return ctx;
}
