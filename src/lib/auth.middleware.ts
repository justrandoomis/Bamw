import { createMiddleware } from "@tanstack/react-start";
import { getSessionUser } from "./session.server";
import { findUserById, logLogin } from "./db.server";
import type { User } from "./types";

/** What `requireAppAuth` and `requireAdmin` put on a handler's context. */
export interface AppAuthContext {
  user: User;
  userId: string;
}

/**
 * The signed-in caller, from a handler's `context`.
 *
 * Both middlewares throw 401 before any handler body runs, so by then the user
 * is always there — but the framework infers the handler's `context` as
 * possibly undefined, and every one of the twenty-eight `context.userId` reads
 * across the server functions was typed against that. This states the
 * guarantee in one place and checks it rather than asserting it: if the
 * middleware is ever removed from a route, the handler refuses instead of
 * running for nobody.
 */
export function authed(context: unknown): AppAuthContext {
  const candidate = context as Partial<AppAuthContext> | undefined;
  if (!candidate?.user || !candidate.userId) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return candidate as AppAuthContext;
}

export const requireAppAuth = createMiddleware().server(async ({ next, request }) => {
  const user = await getSessionUser(request);
  if (!user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return next({
    context: {
      user,
      userId: user.id,
    },
  });
});

export const requireAdmin = createMiddleware().server(async ({ next, request }) => {
  const user = await getSessionUser(request);
  if (!user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Refetch user to ensure admin status is current from DB
  const dbUser = await findUserById(user.id);
  if (!dbUser?.isAdmin) {
    throw new Response(JSON.stringify({ error: "Forbidden: Admin access required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return next({
    context: {
      user: dbUser,
      userId: dbUser.id,
    },
  });
});
