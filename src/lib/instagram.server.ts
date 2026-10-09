/**
 * The shop's own Instagram posts and their comments, from Meta's Graph API.
 *
 * READ ONLY. It reads the comments on the shop's posts so a contest can be
 * drawn from them; it never comments, replies, hides or deletes.
 *
 * Configured by Cloudflare secrets, never by the code:
 *
 *   INSTAGRAM_ACCESS_TOKEN   an access token of the shop's professional
 *                            (business or creator) account, with
 *                            `instagram_business_basic` and
 *                            `instagram_business_manage_comments` —
 *                            "Instagram API with Instagram Login".
 *   INSTAGRAM_USER_ID        optional: the account's id. Needed only with a
 *                            Facebook-Login token (graph.facebook.com), where
 *                            `/me` is the Facebook user, not the Instagram one.
 *   INSTAGRAM_GRAPH_HOST     optional: graph.instagram.com (default) or
 *                            graph.facebook.com.
 *   INSTAGRAM_GRAPH_VERSION  optional: the API version, default v25.0.
 *
 * Without the token, contests still draw from Instagram — from comments the
 * admin pastes. With it, the same draw fetches them itself.
 *
 * The token goes in the query string, as the Graph API takes it, and nowhere
 * else: a paging cursor is stored, never a `paging.next` URL, because that URL
 * carries the token in it.
 */
import { env } from "./env.server";
import type { IgComment } from "./instagramComments";

const DEFAULT_HOST = "graph.instagram.com";
const DEFAULT_VERSION = "v25.0";
/** The Graph API's largest page of comments. */
const PAGE_SIZE = 50;

export class InstagramError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "token" | "not_found" | "permission" | "rate" | "network",
  ) {
    super(message);
  }
}

export function instagramConfigured(): boolean {
  return Boolean(env("INSTAGRAM_ACCESS_TOKEN"));
}

function graphBase(): string {
  const host = (env("INSTAGRAM_GRAPH_HOST") || DEFAULT_HOST).replace(/^https?:\/\//, "");
  const version = env("INSTAGRAM_GRAPH_VERSION") || DEFAULT_VERSION;
  return `https://${host}/${version}`;
}

function token(): string {
  const value = env("INSTAGRAM_ACCESS_TOKEN");
  if (!value) {
    throw new InstagramError(
      "حساب إنستغرام غير مربوط بالمتجر — الصق التعليقات بدلاً من ذلك.",
      "not_configured",
    );
  }
  return value;
}

type GraphPage<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } };

/** One Graph API read, with Meta's error codes turned into sentences. */
async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${graphBase()}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", token());

  let response: Response;
  try {
    response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  } catch {
    throw new InstagramError("تعذّر الوصول إلى إنستغرام، حاول مرة أخرى.", "network");
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: number; message?: string; error_subcode?: number };
  } & T;
  if (!response.ok || body.error) {
    const code = Number(body.error?.code ?? 0);
    if (code === 190 || code === 102) {
      throw new InstagramError(
        "انتهت صلاحية رمز إنستغرام أو أُلغي — جدّده في إعدادات Cloudflare.",
        "token",
      );
    }
    if (code === 10 || code === 200 || (code >= 200 && code < 300)) {
      throw new InstagramError(
        "رمز إنستغرام لا يملك صلاحية قراءة التعليقات (instagram_business_manage_comments).",
        "permission",
      );
    }
    if (code === 4 || code === 17 || code === 32 || code === 613) {
      throw new InstagramError("إنستغرام طلب التمهّل قليلاً — أعد المحاولة بعد دقائق.", "rate");
    }
    if (response.status === 404 || code === 100) {
      throw new InstagramError("لم يُعثر على المنشور في حساب المتجر.", "not_found");
    }
    throw new InstagramError(
      `إنستغرام رفض الطلب${body.error?.message ? `: ${body.error.message}` : ""}`,
      "network",
    );
  }
  return body as T;
}

export type InstagramMedia = {
  id: string;
  shortcode?: string;
  permalink?: string;
  caption?: string;
  timestamp?: string;
  comments_count?: number;
};

/**
 * The shop's post behind a link, found by its shortcode among the account's
 * own media. Only the shop's posts can be read: the API answers for the
 * professional account the token belongs to, and for no one else.
 */
export async function findMediaByShortcode(
  shortcode: string,
  maxPages = 20,
): Promise<InstagramMedia | null> {
  const owner = env("INSTAGRAM_USER_ID") || "me";
  let after: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await graphGet<GraphPage<InstagramMedia>>(`${owner}/media`, {
      fields: "id,shortcode,permalink,caption,timestamp,comments_count",
      limit: "50",
      ...(after ? { after } : {}),
    });
    const match = (result.data ?? []).find(
      (media) =>
        media.shortcode === shortcode || (media.permalink ?? "").includes(`/${shortcode}`),
    );
    if (match) return match;
    after = result.paging?.next ? result.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return null;
}

type GraphComment = {
  id: string;
  text?: string;
  timestamp?: string;
  username?: string;
  from?: { id?: string; username?: string };
  replies?: GraphPage<GraphComment>;
};

function toComment(raw: GraphComment, isReply: boolean): IgComment {
  return {
    id: String(raw.id),
    username: String(raw.username ?? raw.from?.username ?? "").toLowerCase(),
    text: String(raw.text ?? ""),
    timestamp: raw.timestamp,
    isReply,
  };
}

/**
 * A run of comment pages, starting after `cursor`.
 *
 * Bounded by `maxPages` so a post with ten thousand comments is read across
 * several requests rather than one that outlives the Worker; `nextCursor` is
 * where the next run picks up, and null once the last page is in.
 */
export async function fetchCommentPages(
  mediaId: string,
  options: { cursor?: string | null; maxPages?: number; includeReplies?: boolean } = {},
): Promise<{ comments: IgComment[]; nextCursor: string | null }> {
  const fields = options.includeReplies
    ? "id,text,timestamp,username,from,replies.limit(50){id,text,timestamp,username,from}"
    : "id,text,timestamp,username,from";
  const comments: IgComment[] = [];
  let after = options.cursor ?? undefined;
  const maxPages = Math.max(1, options.maxPages ?? 30);
  for (let page = 0; page < maxPages; page += 1) {
    const result = await graphGet<GraphPage<GraphComment>>(`${mediaId}/comments`, {
      fields,
      limit: String(PAGE_SIZE),
      ...(after ? { after } : {}),
    });
    for (const raw of result.data ?? []) {
      comments.push(toComment(raw, false));
      for (const reply of raw.replies?.data ?? []) comments.push(toComment(reply, true));
    }
    after = result.paging?.next ? result.paging.cursors?.after : undefined;
    if (!after) return { comments, nextCursor: null };
  }
  return { comments, nextCursor: after ?? null };
}
