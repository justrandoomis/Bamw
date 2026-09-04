import { createFileRoute } from "@tanstack/react-router";
import { getStore } from "@/lib/db.server";
import { json, guard } from "@/lib/http.server";
import { slugifyDevice, getDevicePerformanceList } from "@/lib/devicePerformance";
import { resolveCategoryType } from "@/lib/productSection";
import { isVisibleToPublic } from "@/lib/purchasable";
import { toPublicProduct } from "@/lib/public-product.server";

export const Route = createFileRoute("/api/hardware/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) =>
        guard(async () => {
          const store = await getStore();
          const wanted = slugifyDevice(params.slug);
          const visible = (store.products || []).filter((product) => isVisibleToPublic(product));
          const hardware = visible.find((product) => {
            const section = resolveCategoryType(
              String(product.categoryId || product.category || ""),
              "",
              String(product.kind || ""),
              String(product.schemaId || ""),
            );
            return (
              section === "hardware" &&
              slugifyDevice(product.slug || product.title || product.shortName) === wanted
            );
          });
          if (!hardware) return json({ error: "Hardware not found" }, { status: 404 });

          const linkedGames = visible.filter((product) =>
            getDevicePerformanceList(product).some((record) => record.deviceSlug === wanted),
          ).length;
          /*
            The same serializer every other public product path goes through.

            This route returned the store document as it is stored — cost,
            supplier fields, internal notes and all — to anybody who could
            guess a console's slug. `isVisibleToPublic` decides *whether* a
            product may be seen; it says nothing about *what* of it may be,
            and that is what `toPublicProduct` is for.
          */
          return json({
            hardware: toPublicProduct(hardware as unknown as Record<string, unknown>),
            linkedGames,
          });
        }, "api:hardware"),
    },
  },
});
