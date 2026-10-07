import { Link } from "@tanstack/react-router";

import { MaintenanceNotice } from "@/components/MaintenanceNotice";

/**
 * The banana market while it is under maintenance: the page's title, the
 * sentence, and a way home. Nothing on it polls the price, offers a sale or
 * opens the ticket shop — and the server would refuse each of those anyway.
 */
export function MarketMaintenance() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4" dir="rtl">
      <header className="mb-4">
        <h1 className="text-[19px] font-black tracking-[-0.02em] text-foreground">سوق الموز</h1>
      </header>
      <MaintenanceNotice feature="bananaMarket" />
      <Link
        to="/"
        data-ui-sound="klick"
        className="mt-3 flex min-h-11 items-center justify-center text-center text-xs font-bold text-primary underline"
      >
        العودة إلى الرئيسية
      </Link>
    </div>
  );
}

export default MarketMaintenance;
