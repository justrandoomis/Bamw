import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import AppShell from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { isSessionStable } from "@/lib/authRedirect";
import { rememberAfterSignIn } from "@/lib/signInReturn";
import { useI18n } from "@/i18n";

/**
 * A screen that belongs to one member, and shows nobody else anything.
 *
 * The wallet had no gate at all. A signed-out visitor was shown the page, its
 * balance card reading 0 د.ع as though that were their balance, an empty
 * transaction list as though they had never bought anything — and then, on the
 * first thing they tapped, an English toast reading «unauthorised». Every part
 * of that is a lie told confidently.
 *
 * The rule the owner asked for is the simple one: «لا يظهر إلا عند تسجيل
 * الدخول». So nothing of the page is rendered until the session is known, and
 * a confirmed signed-out visitor is sent to sign in with the page they wanted
 * remembered.
 *
 * Waiting matters as much as redirecting. `isSessionStable` is false while the
 * session query is in flight and during SSR, and acting on that would bounce a
 * signed-in member to /auth on every hard refresh — which is the bug the same
 * helper was written to fix on /profile.
 */
export default function RequireSignIn({ children }: { children: ReactNode }) {
  const { user, isLoading, isFetching } = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const stable = isSessionStable({ user, isLoading, isFetching, isClient });

  useEffect(() => {
    if (!stable || user !== null) return;
    rememberAfterSignIn(path);
    void navigate({ to: "/auth", replace: true });
  }, [stable, user, path, navigate]);

  if (!stable || user === null) {
    return (
      <AppShell currentView="profile">
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-[var(--brand-red)]" />
          <p className="text-sm font-bold text-muted-foreground">{t("جاري التحميل...")}</p>
        </div>
      </AppShell>
    );
  }

  return <>{children}</>;
}
