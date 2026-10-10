import { Link, useNavigate } from "@tanstack/react-router";
import type { AccountBundle, Product } from "@/lib/types";
import { BundleCard } from "./BundleCard";
import { playSound } from "@/utils/audio";

interface BundleStripProps {
  bundles: AccountBundle[];
  products: Product[];
  onSelectBundle?: (bundle: AccountBundle) => void;
}

export function BundleStrip({ bundles, products, onSelectBundle }: BundleStripProps) {
  const navigate = useNavigate();

  if (!bundles || bundles.length === 0) {
    return null;
  }

  const activeBundles = bundles.filter((b) => b.isActive !== false);

  if (activeBundles.length === 0) {
    return null;
  }

  /*
    Headed like every other shelf on the home page — the name and «عرض الكل»,
    nothing else — and scrolled like the square game shelf above it, so the
    bundles read as one more row of the same shop rather than a banner.
  */
  return (
    <section className="mt-2 w-full max-w-full" aria-labelledby="home-bundles-title">
      <div className="mb-3 flex items-center justify-between gap-2 px-4 sm:px-8">
        <h3 id="home-bundles-title" className="truncate text-xl font-bold text-foreground">
          حزم الحسابات
        </h3>
        <Link
          to="/bundles"
          onClick={() => playSound("switch_click", 0.7)}
          className="-my-2 inline-flex min-h-11 shrink-0 items-center px-2 py-1 text-sm font-bold text-orange-500 transition-colors hover:text-orange-600"
        >
          عرض الكل
        </Link>
      </div>

      <div className="flex w-full max-w-full touch-pan-x snap-x snap-mandatory gap-2.5 overflow-x-auto overscroll-x-contain scroll-smooth px-4 pb-4 pt-1 no-scrollbar sm:gap-3 sm:px-8">
        {activeBundles.map((bundle) => (
          <div key={bundle.id} className="flex shrink-0 snap-start">
            <BundleCard
              bundle={bundle}
              products={products}
              layout="compact"
              onSelect={
                onSelectBundle
                  ? () => onSelectBundle(bundle)
                  : () =>
                      void navigate({ to: "/bundles/$bundleId", params: { bundleId: bundle.id } })
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}
