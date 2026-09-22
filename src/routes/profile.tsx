import { createFileRoute } from "@tanstack/react-router";
import AppShell from "@/components/AppShell";
import ProfileView from "@/components/ProfileView";
import RequireSignIn from "@/components/RequireSignIn";

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

/*
  The same gate as the wallet's, from the same component. This page kept its
  own copy of the wait-then-redirect rule; two copies of that rule is how one
  of them ends up bouncing a signed-in member to /auth on a hard refresh.
*/
function ProfilePage() {
  return (
    <RequireSignIn>
      <AppShell currentView="profile">
        <ProfileView />
      </AppShell>
    </RequireSignIn>
  );
}
