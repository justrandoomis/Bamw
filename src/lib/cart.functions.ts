import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { d1All, d1Run, d1First, randomId } from "@/lib/db.server";
import { requireAppAuth, authed } from "@/lib/auth.middleware";

async function logActivity(params: any) {
  const { logActivity: logger } = await import("./activity.functions.server");
  return logger(params);
}

export const getCart = createServerFn({ method: "GET" })
  .middleware([requireAppAuth])
  .handler(async ({ context }) => {
    const userId = authed(context).userId;
    const items = await d1All(
      `SELECT * FROM cart_items WHERE user_id = ? ORDER BY created_at ASC`,
      userId,
    );
    return items.map((item: any) => ({
      ...item,
      options: JSON.parse(item.options || "{}"),
    }));
  });

export const addToCart = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(
    z.object({
      productId: z.string(),
      quantity: z.number().default(1),
      options: z.record(z.string(), z.any()).optional(),
    }),
  )
  .handler(async (args) => {
    const { data: input, context } = args;
    const userId = authed(context).userId;
    const now = new Date().toISOString();

    // Check if item exists
    const existing = await d1First<{ id: string; quantity: number }>(
      `SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?`,
      userId,
      input.productId,
    );

    if (existing) {
      await d1Run(
        `UPDATE cart_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?`,
        input.quantity,
        now,
        existing.id,
      );
    } else {
      await d1Run(
        `INSERT INTO cart_items (id, user_id, product_id, quantity, options, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        randomId("cit"),
        userId,
        input.productId,
        input.quantity,
        JSON.stringify(input.options || {}),
        now,
        now,
      );
    }

    // Log Activity
    await logActivity({
      userId,
      activityType: "CART_ADD",
      entityType: "product",
      entityId: input.productId,
      action: "add",
      metadata: { quantity: input.quantity, options: input.options },
      request: getRequest(),
    });
  });

export const updateCartItem = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(
    z.object({
      id: z.string(),
      quantity: z.number(),
    }),
  )
  .handler(async (args) => {
    const { data: input, context } = args;
    const userId = authed(context).userId;
    const now = new Date().toISOString();

    if (input.quantity <= 0) {
      await d1Run(`DELETE FROM cart_items WHERE id = ? AND user_id = ?`, input.id, userId);
    } else {
      await d1Run(
        `UPDATE cart_items SET quantity = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        input.quantity,
        now,
        input.id,
        userId,
      );
    }

    // Log Activity
    await logActivity({
      userId,
      activityType: "CART_UPDATE",
      entityType: "cart_item",
      entityId: input.id,
      action: "update",
      metadata: { quantity: input.quantity },
      request: getRequest(),
    });
  });

export const removeCartItem = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(
    z.object({
      id: z.string(),
    }),
  )
  .handler(async (args) => {
    const { data: input, context } = args;
    await d1Run(`DELETE FROM cart_items WHERE id = ? AND user_id = ?`, input.id, authed(context).userId);

    // Log Activity
    await logActivity({
      userId: authed(context).userId,
      activityType: "CART_REMOVE",
      entityType: "cart_item",
      entityId: input.id,
      action: "remove",
      request: getRequest(),
    });
  });
