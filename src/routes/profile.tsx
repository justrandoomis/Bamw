import { createFileRoute, useNavigate } from "@tanstack/react-router";
import AppShell from "@/components/AppShell";
import ProfileView from "@/components/ProfileView";
import { useAuth } from "@/hooks/useAuth";
import { profileRedirectTarget } from "@/lib/authRedirect";
import { useI18n } from "@/i18n";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "الملف الشخصي — بنانا ستور" },
      { name: "description", content: "إدارة إعدادات حسابك، العناوين، والطلبات في متجر بنانا." },
      { property: "og:title", content: "الملف الشخصي — بنانا ستور" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, isLoading, isFetching } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    const target = profileRedirectTarget({ user, isLoading, isFetching, isClient });
    if (target) void navigate({ to: target, replace: true });
  }, [user, isLoading, isFetching, navigate, isClient]);

  if (!isClient || isLoading || (isFetching && !user)) {
    return (
      <AppShell currentView="profile">
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-[var(--brand-red)]" />
          <p className="text-sm font-bold text-muted-foreground">
            {t("جاري تحميل الملف الشخصي...")}
          </p>
        </div>
      </AppShell>
    );
  }

  if (!user) return null;

  return (
    <AppShell currentView="profile">
      <ProfileView />
    </AppShell>
  );
}
