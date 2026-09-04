import { cfEnv } from "./d1.server";
import type { ChatRealtimeEvent, TypingParticipant, PresenceParticipant } from "./types";

export type ChatEvent = ChatRealtimeEvent & {
  threadId: string;
  timestamp: string;
};

type Listener = (event: ChatEvent) => void;

/**
 * Fan-out for live chat events.
 *
 * A Durable Object holds the shared state when the binding is available, with an
 * in-isolate map as the fallback. Realtime delivery is a convenience on top of
 * the database write that actually matters, so a Durable Object failure must
 * degrade to that fallback rather than fail the caller: `appendMessage` calls
 * `broadcast`, so an unguarded throw here used to turn every chat read, every
 * message send, and part of order creation into a 500.
 */
class ChatRealtimeHub {
  private listeners: Map<string, Set<Listener>> = new Map();
  private typingMap: Map<string, Map<string, TypingParticipant & { expiresAt: number }>> =
    new Map();
  private presenceMap: Map<string, Map<string, PresenceParticipant>> = new Map();

  private getDO(threadId: string) {
    try {
      const env = cfEnv() as any;
      if (env && env.CHAT_REALTIME_DO) {
        const id = env.CHAT_REALTIME_DO.idFromName(threadId);
        return env.CHAT_REALTIME_DO.get(id);
      }
    } catch {
      // Binding missing or unusable — the in-memory path below still works.
    }
    return null;
  }

  /**
   * Call the thread's Durable Object, or return undefined so the caller can use
   * its local fallback.
   *
   * The stub is called with (url, init) rather than a constructed Request:
   * passing a Request through the local dev proxy fails to serialize, which made
   * every realtime call throw outside production.
   */
  private async callDO(
    threadId: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response | undefined> {
    const obj = this.getDO(threadId);
    if (!obj) return undefined;
    try {
      return (await obj.fetch(`http://do/${path}`, init)) as Response;
    } catch (error) {
      console.error(`[chat-realtime] durable object call failed: ${path}`, error);
      return undefined;
    }
  }

  async getStreamResponse(threadId: string, request: Request): Promise<Response | null> {
    const response = await this.callDO(threadId, "subscribe", {
      method: "GET",
      headers: request.headers,
      signal: request.signal,
    });
    // Null hands the route back to its own in-process SSE stream.
    return response ?? null;
  }

  /** Subscribe to events for a specific thread (in-isolate fallback transport) */
  subscribe(threadId: string, listener: Listener): () => void {
    if (!this.listeners.has(threadId)) {
      this.listeners.set(threadId, new Set());
    }
    const set = this.listeners.get(threadId)!;
    set.add(listener);

    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(threadId);
      }
    };
  }

  /** Broadcast event to all subscribers of a thread */
  async broadcast(threadId: string, event: Omit<ChatEvent, "threadId" | "timestamp">) {
    const fullEvent = {
      ...event,
      threadId,
      timestamp: new Date().toISOString(),
    } as ChatEvent;

    const delivered = await this.callDO(threadId, "broadcast", {
      method: "POST",
      body: JSON.stringify(fullEvent),
    });
    if (delivered) return;

    const threadListeners = this.listeners.get(threadId);
    if (threadListeners) {
      for (const listener of threadListeners) {
        try {
          listener(fullEvent);
        } catch {
          // ignore subscriber error
        }
      }
    }
  }

  /** Set user typing status (expires in 4 seconds) */
  async setTyping(
    threadId: string,
    user: { id: string; name: string; role: "user" | "admin" },
    isTyping: boolean,
  ) {
    const delivered = await this.callDO(threadId, "setTyping", {
      method: "POST",
      body: JSON.stringify({ user, isTyping }),
    });
    if (delivered) return;

    if (!this.typingMap.has(threadId)) {
      this.typingMap.set(threadId, new Map());
    }
    const threadTyping = this.typingMap.get(threadId)!;

    if (isTyping) {
      threadTyping.set(user.id, {
        userId: user.id,
        userName: user.name,
        senderRole: user.role,
        expiresAt: Date.now() + 4000,
      });
    } else {
      threadTyping.delete(user.id);
    }

    this.cleanExpired(threadId);
    const activeTypers = Array.from(threadTyping.values()).map((t) => ({
      userId: t.userId,
      userName: t.userName,
      senderRole: t.senderRole,
    }));

    await this.broadcast(threadId, {
      type: "typing.update",
      payload: { typers: activeTypers },
    });
  }

  /** Record presence heartbeat */
  async recordPresence(threadId: string, userId: string) {
    const delivered = await this.callDO(threadId, "recordPresence", {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
    if (delivered) return;

    if (!this.presenceMap.has(threadId)) {
      this.presenceMap.set(threadId, new Map());
    }
    const threadPresence = this.presenceMap.get(threadId)!;
    threadPresence.set(userId, {
      userId,
      lastSeen: Date.now(),
    });
  }

  /** Get active typing users in a thread */
  async getActiveTypers(
    threadId: string,
  ): Promise<{ userId: string; userName: string; senderRole: "user" | "admin" }[]> {
    const response = await this.callDO(threadId, "getActiveTypers");
    if (response) {
      const parsed =
        await safeJson<{ userId: string; userName: string; senderRole: "user" | "admin" }[]>(
          response,
        );
      if (Array.isArray(parsed)) return parsed;
    }

    this.cleanExpired(threadId);
    const threadTyping = this.typingMap.get(threadId);
    if (!threadTyping) return [];
    return Array.from(threadTyping.values()).map((t) => ({
      userId: t.userId,
      userName: t.userName,
      senderRole: t.senderRole,
    }));
  }

  /** Check if a user in a thread was seen recently (last 60s) */
  async isUserOnline(threadId: string, userId: string): Promise<boolean> {
    const response = await this.callDO(
      threadId,
      `isUserOnline?userId=${encodeURIComponent(userId)}`,
    );
    if (response) {
      const parsed = await safeJson<boolean>(response);
      if (typeof parsed === "boolean") return parsed;
    }

    const threadPresence = this.presenceMap.get(threadId);
    if (!threadPresence) return false;
    const p = threadPresence.get(userId);
    if (!p) return false;
    return Date.now() - p.lastSeen < 60_000;
  }

  private cleanExpired(threadId: string) {
    const now = Date.now();
    const threadTyping = this.typingMap.get(threadId);
    if (threadTyping) {
      for (const [uid, item] of threadTyping.entries()) {
        if (item.expiresAt < now) {
          threadTyping.delete(uid);
        }
      }
    }
  }
}

/** A Durable Object that answered with a non-JSON body must not throw here. */
async function safeJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

export const chatRealtime = new ChatRealtimeHub();

/**
 * Cloudflare Durable Object for cross-isolate chat fan-out, typing state, and
 * presence. The class name is part of the deployed Cloudflare migration and
 * must remain a named Worker export (see src/server.ts and wrangler.jsonc).
 */
export class ChatRealtimeDO {
  state: any;
  env: any;
  private subscribers: Set<ReadableStreamDefaultController> = new Set();
  private typingMap: Map<string, TypingParticipant & { expiresAt: number }> = new Map();
  private presenceMap: Map<string, PresenceParticipant> = new Map();

  constructor(state: any, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, "");

    if (path === "subscribe") {
      let controller: ReadableStreamDefaultController;
      const stream = new ReadableStream({
        start: (streamController) => {
          controller = streamController;
          this.subscribers.add(streamController);
        },
        cancel: () => {
          if (controller) this.subscribers.delete(controller);
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    if (path === "broadcast" && request.method === "POST") {
      const data = await request.text();
      this.pushEvent(data);
      return jsonResponse({ ok: true });
    }

    if (path === "setTyping" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as any;
      const { user, isTyping } = body || {};
      if (user?.id) {
        if (isTyping) {
          this.typingMap.set(user.id, {
            userId: user.id,
            userName: user.name,
            senderRole: user.role,
            expiresAt: Date.now() + 4000,
          });
        } else {
          this.typingMap.delete(user.id);
        }
      }

      this.cleanExpired();
      const event = {
        type: "typing.update",
        payload: { typers: this.activeTypers() },
        timestamp: new Date().toISOString(),
      };
      this.pushEvent(JSON.stringify(event));
      return jsonResponse({ ok: true });
    }

    if (path === "recordPresence" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as any;
      const { userId } = body || {};
      if (userId) {
        this.presenceMap.set(userId, { userId, lastSeen: Date.now() });
      }
      return jsonResponse({ ok: true });
    }

    if (path === "getActiveTypers") {
      this.cleanExpired();
      return jsonResponse(this.activeTypers());
    }

    if (path === "isUserOnline") {
      const userId = url.searchParams.get("userId");
      const presence = userId ? this.presenceMap.get(userId) : undefined;
      return jsonResponse(Boolean(presence && Date.now() - presence.lastSeen < 60_000));
    }

    return new Response("Not Found", { status: 404 });
  }

  /**
   * Send one event to every subscriber, named.
   *
   * This wrote `data: …` with no `event:` line. Per the SSE spec a frame with
   * no event field is dispatched as "message", and the client registers only
   * named listeners — `message.created`, `thread.updated`, `typing.update` and
   * the rest — so not one of them ever fired.
   *
   * It went unnoticed because there are two streams. The in-process fallback
   * in `api/chat.ts` writes `event: ${type}` and works; the Durable Object is
   * the one production binds. So the admin inbox updated live on a developer's
   * machine and never once in the shop: a customer's message, and the image
   * with it, arrived only when somebody reloaded.
   *
   * The name is read from the payload's own `type`, which every producer here
   * already sets, and falls back to "message" — the default the spec would
   * have used anyway — rather than dropping an event this cannot name.
   */
  private pushEvent(data: string) {
    let name = "message";
    try {
      const parsed = JSON.parse(data) as { type?: unknown };
      if (typeof parsed?.type === "string" && parsed.type.trim()) {
        /*
          An event name may not contain a newline: one would end the field and
          let a crafted `type` inject frames of its own.
        */
        name = parsed.type.replace(/[\r\n]/g, "").slice(0, 64);
      }
    } catch {
      /* Not JSON: send it as the default event rather than losing it. */
    }
    const encoded = new TextEncoder().encode(`event: ${name}\ndata: ${data}\n\n`);
    for (const subscriber of this.subscribers) {
      try {
        subscriber.enqueue(encoded);
      } catch {
        this.subscribers.delete(subscriber);
      }
    }
  }

  private activeTypers() {
    return Array.from(this.typingMap.values()).map((typing) => ({
      userId: typing.userId,
      userName: typing.userName,
      senderRole: typing.senderRole,
    }));
  }

  private cleanExpired() {
    const now = Date.now();
    for (const [userId, item] of this.typingMap.entries()) {
      if (item.expiresAt < now) this.typingMap.delete(userId);
    }
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}
