import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { ChatRealtimeDO } from "./lib/chat-realtime.server";
import { publishEnv } from "./lib/env.server";
import { handleQueueBatch, type CloudflareMessageBatch } from "./lib/queue-consumer.server";
import {
  processAutoScheduledTasks,
  processBotTrading,
  processDigitalDeliveryMaintenance,
  processReleaseAlerts,
  processExpiredBotThreads,
  processHeldReferralRewards,
} from "./lib/scheduled-jobs.server";

// Cloudflare binds existing Durable Object instances to this exact named export.
export { ChatRealtimeDO };

const fetchHandler = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    publishEnv(env);

    if (env?.ASSETS && typeof env.ASSETS.fetch === "function") {
      try {
        const pathname = new URL(request.url).pathname;
        const isStaticAsset =
          pathname.startsWith("/assets/") ||
          pathname.startsWith("/illustrations/") ||
          pathname.startsWith("/textures/") ||
          pathname.startsWith("/templates/") ||
          pathname === "/favicon.png" ||
          pathname === "/favicon.ico" ||
          pathname === "/robots.txt" ||
          pathname === "/sw.js" ||
          pathname === "/manifest.webmanifest" ||
          pathname === "/latest.rss" ||
          /\.(?:js|css|png|jpg|jpeg|webp|svg|ico|json|woff2?|ttf|eot|wasm|map|txt)$/i.test(
            pathname,
          );

        if (isStaticAsset) {
          const assetResponse = await env.ASSETS.fetch(request);
          if (assetResponse.status < 400) return assetResponse;
        }
      } catch (error) {
        console.warn("[worker:assets_fetch_error]", error);
      }
    }

    try {
      /*
        The Cloudflare bindings ride on the request context — `publishEnv(env)`
        downstream is what makes D1, R2 and the queue reachable. The handler
        types `context` as the framework's registered request context, and this
        app registers none, so the parameter types as `{ nonce?: string }`
        only. The value is right and the runtime contract is real; the cast
        says so rather than pretending the bindings are optional.
      */
      return await fetchHandler(request, {
        context: { env, ctx } as unknown as { nonce?: string },
      });
    } catch (error: any) {
      console.error("[worker:fetch_error]", error?.stack || error);
      return new Response("Internal Server Error", {
        status: 500,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
  },

  async queue(batch: CloudflareMessageBatch, env: any) {
    await handleQueueBatch(batch, env);
  },

  /**
   * Two schedules, and until now the handler could not tell them apart.
   *
   * `wrangler.jsonc` registers a minute trigger and a half-hour one, and this
   * took `_event` — ignored — so every task ran on both. The half-hourly
   * trigger was decoration, and the note above
   * `processDigitalDeliveryMaintenance` ("keep this separate ... so the
   * one-hour delivery deadline does not make every heavier scheduled scan run
   * once per minute") described an intention the code did not carry out.
   *
   * Cloudflare's record of what that cost: over six hours the minute firing
   * ended **`exceededCpu` 119 times** against 15 that finished. An isolate
   * killed for exceeding CPU takes the requests sharing it with it, which is
   * why `/api/data` and the catalogue import were being answered 503 by a shop
   * whose own code was fine.
   *
   * What runs every minute is what a minute means something to: the chat
   * queue's five-minute reminders, the one-hour delivery deadline, and the
   * market bots, whose cadence is a commercial decision and not mine to
   * change. What moves to the half hour is the work whose deadline is a day —
   * and `processReleaseAlerts` above all, because it is the one that still
   * reads the whole catalogue, and it now does so twice an hour instead of
   * sixty times.
   *
   * Cron delivery is at-least-once and every task below is idempotent, so a
   * doubled firing is not a doubled payout — see the notes on each.
   */
  async scheduled(event: any, env: any) {
    publishEnv(env);
    const cron = String(event?.cron ?? "");
    /*
      An unrecognised cron runs the minute work rather than nothing. A
      schedule added later and forgotten here should be too eager, not silent.
    */
    const halfHourly = cron.startsWith("*/30");

    const tasks = halfHourly
      ? [
          processReleaseAlerts(),
          processHeldReferralRewards(),
          // Sweep the assistant's expired conversations. Bounded per run, and
          // it judges each row with the same function the UI filters by.
          processExpiredBotThreads(),
        ]
      : [
          processAutoScheduledTasks(),
          processDigitalDeliveryMaintenance(),
          processBotTrading(),
        ];

    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("[worker:scheduled_error]", cron, result.reason);
      }
    }
  },
};
