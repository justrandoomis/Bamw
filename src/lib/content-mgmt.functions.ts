import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { d1All, d1First, d1Run, randomId, createAuditLog } from "./db.server";
import { requireAdmin, authed } from "./auth.middleware";
import type { StoreBanner, StoreGuide, ProblemSolution } from "./types";

/**
 * Admin: Add or update a store banner.
 */
export const updateStoreBanner = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(
    z.object({
      id: z.string().optional(),
      imageUrl: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      targetUrl: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      priority: z.number().default(0),
      isActive: z.boolean().default(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const adminId = authed(context).userId;
    const now = new Date().toISOString();
    const id = data.id || randomId("bnr");

    await d1Run(
      `INSERT INTO store_banners (id, image_url, title, description, target_url, start_date, end_date, priority, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         image_url = excluded.image_url, title = excluded.title, description = excluded.description,
         target_url = excluded.target_url, start_date = excluded.start_date, end_date = excluded.end_date,
         priority = excluded.priority, is_active = excluded.is_active`,
      id,
      data.imageUrl,
      data.title || null,
      data.description || null,
      data.targetUrl || null,
      data.startDate || null,
      data.endDate || null,
      data.priority,
      data.isActive ? 1 : 0,
      now,
    );

    await createAuditLog(adminId, data.id ? "update_banner" : "create_banner", "banner", id);
    return { success: true, id };
  });

/**
 * Admin: Add or update a store guide.
 */
export const updateStoreGuide = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(
    z.object({
      id: z.string().optional(),
      title: z.string(),
      slug: z.string(),
      contentHtml: z.string(),
      category: z.string().optional(),
      images: z.array(z.string()).default([]),
      videoUrl: z.string().optional(),
      priority: z.number().default(0),
      isActive: z.boolean().default(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const adminId = authed(context).userId;
    const now = new Date().toISOString();
    const id = data.id || randomId("gd");

    await d1Run(
      `INSERT INTO store_guides (id, title, slug, content_html, category, images_json, video_url, priority, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, slug = excluded.slug, content_html = excluded.content_html,
         category = excluded.category, images_json = excluded.images_json, video_url = excluded.video_url,
         priority = excluded.priority, is_active = excluded.is_active, updated_at = excluded.updated_at`,
      id,
      data.title,
      data.slug,
      data.contentHtml,
      data.category || null,
      JSON.stringify(data.images),
      data.videoUrl || null,
      data.priority,
      data.isActive ? 1 : 0,
      now,
      now,
    );

    await createAuditLog(adminId, data.id ? "update_guide" : "create_guide", "guide", id);
    return { success: true, id };
  });

/**
 * Admin: Add or update a problem solution.
 */
export const updateProblemSolution = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator(
    z.object({
      id: z.string().optional(),
      title: z.string(),
      description: z.string(),
      steps: z.array(
        z.object({
          stepNumber: z.number(),
          text: z.string(),
          image: z.string().optional(),
        }),
      ),
      images: z.array(z.string()).default([]),
      videoUrl: z.string().optional(),
      relatedProductId: z.string().optional(),
      tags: z.array(z.string()).default([]),
      isActive: z.boolean().default(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const adminId = authed(context).userId;
    const now = new Date().toISOString();
    const id = data.id || randomId("sol");

    await d1Run(
      `INSERT INTO problem_solutions (id, title, description, steps_json, images_json, video_url, related_product_id, tags_json, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, description = excluded.description, steps_json = excluded.steps_json,
         images_json = excluded.images_json, video_url = excluded.video_url,
         related_product_id = excluded.related_product_id, tags_json = excluded.tags_json,
         is_active = excluded.is_active`,
      id,
      data.title,
      data.description,
      JSON.stringify(data.steps),
      JSON.stringify(data.images),
      data.videoUrl || null,
      data.relatedProductId || null,
      JSON.stringify(data.tags),
      data.isActive ? 1 : 0,
      now,
    );

    await createAuditLog(adminId, data.id ? "update_solution" : "create_solution", "solution", id);
    return { success: true, id };
  });
