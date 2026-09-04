import { createFileRoute } from "@tanstack/react-router";

import { createAuditLog, getStore, updateStore } from "@/lib/db.server";
import { body, guard, json } from "@/lib/http.server";
import { requireAdmin } from "@/lib/session.server";
import { mergeContent, type ContentDoc } from "@/lib/content";
import { findForbiddenSecret } from "@/lib/telegram-admin-routing.server";
import { looksLikeInternalNote } from "@/lib/internalMetadata";
import type { StoreDoc } from "@/lib/types";

/**
 * Everything the patch would publish, as flat strings with their paths.
 *
 * The guards below have to see the text a customer would end up reading, and
 * that text is nested several levels down — a guide's step's warning, a
 * problem's step's detail. Walking it once is cheaper than teaching each guard
 * the shape of every editable page.
 */
function textOf(value: unknown, trail = ""): Array<{ path: string; text: string }> {
  if (typeof value === "string") return [{ path: trail, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, i) => textOf(item, `${trail}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => textOf(child, `${trail}.${key}`));
  }
  return [];
}

/** What changed, without copying the content into the log. */
function shapeOf(patch: Partial<ContentDoc>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) out[key] = { entries: value.length };
    else if (value && typeof value === "object") {
      const sections = (value as { sections?: unknown[] }).sections;
      out[key] = Array.isArray(sections) ? { sections: sections.length } : "object";
    } else out[key] = typeof value;
  }
  return out;
}

/** Public read of the editable site content, admin-only write. */
export const Route = createFileRoute("/api/content")({
  server: {
    handlers: {
      GET: async () =>
        guard(async () => {
          const store = (await getStore()) as StoreDoc & { content?: unknown };
          return json(mergeContent(store.content), {
            headers: { "cache-control": "public, max-age=30, stale-while-revalidate=300" },
          });
        }),

      POST: async ({ request }) =>
        guard(async () => {
          const admin = await requireAdmin(request);
          const patch = await body<Partial<ContentDoc>>(request);

          const strings = textOf(patch);

          /*
            Nothing that belongs in a private message may be saved as page copy.

            These pages are public, cached at the edge and indexed. A password,
            a verification code or an account handed to one customer pasted
            into a guide — by habit, from the order chat it was copied out of —
            would be published to everyone and stay in the cache after it was
            removed. Refusing the save is the only point at which that is still
            reversible.
          */
          for (const entry of strings) {
            const secret = findForbiddenSecret(entry.text);
            if (secret) {
              return json(
                {
                  error: `لا يمكن حفظ محتوى يحتوي على بيانات سرية (${secret}) — هذه الصفحات عامة.`,
                  field: entry.path,
                },
                { status: 400 },
              );
            }
          }

          /*
            And nothing that belongs to the shop's own bookkeeping. The same
            detector the product serializer filters with: a help page is
            exactly where a note about cost or a supplier would be pasted.
          */
          for (const entry of strings) {
            if (looksLikeInternalNote(entry.text)) {
              return json(
                {
                  error:
                    "هذا النص يبدو ملاحظة داخلية (كلفة أو مورد أو سعر صرف) — لا يُنشر للزبائن.",
                  field: entry.path,
                },
                { status: 400 },
              );
            }
          }

          const updated = await updateStore((current) => {
            const merged = mergeContent({
              ...((current as StoreDoc & { content?: object }).content ?? {}),
              ...patch,
            });
            return { ...current, content: merged } as StoreDoc;
          });

          /*
            Who changed what, and when. The entry records the shape — which
            collections were sent and how many entries each held — rather than
            the content itself: the content is already stored, and copying it
            here would double every page into a table nobody prunes.

            Never allowed to fail the save. The content is written by the time
            this runs, and an unwritable log must not report an error for a
            change that happened.
          */
          try {
            await createAuditLog(
              (admin as { id?: string }).id ?? "admin",
              "content.update",
              "site_content",
              Object.keys(patch).sort().join(",") || "(empty)",
              undefined,
              undefined,
              shapeOf(patch),
            );
          } catch (error) {
            console.error("[content:audit_failed]", error);
          }

          return json({
            success: true,
            data: mergeContent((updated as StoreDoc & { content?: unknown }).content),
          });
        }),
    },
  },
});
