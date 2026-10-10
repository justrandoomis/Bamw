import { checkAdminAccess } from "@/lib/admin-access.functions";
import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazyRetry";

const AdminDashboard = lazyWithRetry(() => import("@/components/AdminDashboard"));
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/admin/")({
  /**
   * Server-side gate. Runs during SSR and before a client navigation resolves,
   * so a non-admin never receives the dashboard bundle at all — the client-side
   * `user.isAdmin` check below is now only a second line of defence.
   */
  beforeLoad: async () => {
    const { isAdmin, signedIn } = await checkAdminAccess();
    if (!isAdmin) {
      throw redirect({ to: signedIn ? "/" : "/auth" });
    }
  },
  head: () => ({
    meta: [
      { title: "لوحة الإدارة — بنانتو" },
      {
        name: "description",
        content:
          "إدارة المنتجات، البانرات، الطلبات، والمحادثات مع استخراج بيانات المنتج بالذكاء الاصطناعي.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "لوحة الإدارة — بنانتو" },
      { property: "og:description", content: "إدارة كامل المتجر من مكان واحد." },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !user) void navigate({ to: "/auth" });
  }, [isLoading, user, navigate]);

  if (isLoading)
    return <div className="p-10 text-center text-sm text-muted-foreground">جاري التحميل...</div>;

  if (!user?.isAdmin) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--page)] px-4 text-center"
        dir="rtl"
      >
        <p className="text-foreground">هذه الصفحة للمدير فقط.</p>
        <Link
          to="/"
          className="rounded-xl bg-[var(--brand-red)] px-4 py-2 text-sm font-bold text-white"
        >
          الرجوع للمتجر
        </Link>
      </div>
    );
  }

  /*
    The dashboard brings its own frame — sidebar, top bar, search — so this
    page adds none: a second bar above it was a second place for the same
    two links, and it pushed the dashboard's own bar off the top.
  */
  return (
    <div dir="rtl">
      <Suspense
        fallback={
          <div className="flex h-[100dvh] items-center justify-center bg-[var(--page)] text-sm font-bold text-muted-foreground">
            جارٍ تحميل لوحة الإدارة…
          </div>
        }
      >
        <AdminDashboard />
      </Suspense>
    </div>
  );
}
