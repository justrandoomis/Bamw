import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppAuth, authed } from "./auth.middleware";
import { getUserPreferences, saveUserPreferences } from "./db.server";

export const savePreferences = createServerFn({ method: "POST" })
  .middleware([requireAppAuth])
  .validator(
    z.object({
      prefs: z.record(z.string(), z.any()),
    }),
  )
  .handler(async (args) => {
    const { data, context } = args;
    await saveUserPreferences(authed(context).userId, data.prefs);
    return { success: true };
  });

export const getPreferences = createServerFn({ method: "GET" })
  .middleware([requireAppAuth])
  .handler(async ({ context }) => {
    const prefs = await getUserPreferences(authed(context).userId);
    return prefs;
  });
