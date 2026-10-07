/**
 * Which uploaded files a member may reference in their own messages.
 *
 * `/api/upload` namespaces every file as `<folder>/<uploader id>/<name>`, and
 * the chat used to accept only the `chat/` folder. But the order chat uploads
 * payment receipts and account-registration proofs to `receipts/`, so attaching
 * one always failed with `invalid_image` — the exact step where a buyer proves
 * they registered the delivered account.
 *
 * Ownership is what actually matters here, not which folder the uploader picked,
 * so the check keeps the "must be your own file" rule and widens the folder set
 * to the ones members upload into.
 */
/*
  `avif` is here because `/api/upload` stores one: a phone that hands over an
  AVIF has nothing else to give, and every current browser renders it. This
  list and the upload route's `SERVABLE_IMAGE` are the same question asked at
  two steps — when they disagreed, a file uploaded 200 and the very next call
  refused it with `invalid_image`, and the member saw a photo that sent itself
  and then vanished.
*/
const MEMBER_UPLOAD_URL =
  /^\/api\/files\/(chat|uploads|orders|receipts|support|documents|reviews)\/(usr_[a-z0-9]+)\/[a-z0-9_-]{1,96}\.(png|jpe?g|webp|gif|avif|mp4|webm|mov)$/i;
/*
  Review proof is a screenshot from a phone, and a phone may well hand over an
  AVIF — the same reason the member folders accept one above.
*/
const REVIEW_IMAGE_URL =
  /^\/api\/files\/reviews\/(usr_[a-z0-9]+)\/[a-z0-9_-]{1,96}\.(png|jpe?g|webp|gif|avif)$/i;

const VIDEO_EXT = /^(mp4|webm|mov)$/i;

export function isOwnUploadUrl(url: string, userId: string): boolean {
  const match = MEMBER_UPLOAD_URL.exec(url);
  return Boolean(match && match[2] === userId);
}

/** A public review may expose only a still image uploaded for that review. */
export function isOwnReviewImageUrl(url: string, userId: string): boolean {
  const match = REVIEW_IMAGE_URL.exec(url);
  return Boolean(match && match[1] === userId);
}

/*
  The delivery attachment on a two-step submission, which may be a short clip
  as well as a photo — the customer is showing what arrived.

  Kept separate from `isOwnReviewImageUrl` rather than widening it: the
  Instagram proof is a screenshot and nothing else, and a check that accepted
  video everywhere would quietly accept it there too.
*/
const REVIEW_MEDIA_URL =
  /^\/api\/files\/reviews\/(usr_[a-z0-9]+)\/[a-z0-9_-]{1,96}\.(png|jpe?g|webp|gif|avif|mp4|webm|mov)$/i;

export function isOwnReviewMediaUrl(url: string, userId: string): boolean {
  const match = REVIEW_MEDIA_URL.exec(url);
  return Boolean(match && match[1] === userId);
}

/** True when the member's own upload is a video rather than a still image. */
export function isVideoUploadUrl(url: string): boolean {
  const match = MEMBER_UPLOAD_URL.exec(url);
  return Boolean(match && VIDEO_EXT.test(match[3] ?? ""));
}

/**
 * Render-time check for any stored media URL, including ones saved before
 * video was supported. Used by the chat views to decide between <img> and
 * <video>; it deliberately does not care who owns the file.
 */
export function isVideoUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && /\.(mp4|webm|mov)(?:\?|#|$)/i.test(url);
}

/*
  A member's voice note: always in their own `chat/` folder, always one of the
  audio extensions `/api/upload` gives a recording. Its own rule rather than a
  wider MEMBER_UPLOAD_URL, so `imageUrl` stays an image or a clip and nothing
  else.
*/
const VOICE_UPLOAD_URL =
  /^\/api\/files\/chat\/(usr_[a-z0-9]+)\/[a-z0-9_-]{1,96}\.(weba|ogg|oga|opus|m4a|aac|mp3)$/i;

export function isOwnVoiceUrl(url: string, userId: string): boolean {
  const match = VOICE_UPLOAD_URL.exec(url);
  return Boolean(match && match[1] === userId);
}

/**
 * A voice note an admin recorded into a conversation: filed under that
 * conversation by `/api/upload` (`chat/<threadId>/…`).
 */
export function isConversationVoiceUrl(url: string, threadId: string): boolean {
  const match =
    /^\/api\/files\/chat\/(thr_[a-z0-9]+)\/[a-z0-9_-]{1,96}\.(weba|ogg|oga|opus|m4a|aac|mp3)$/i.exec(
      url,
    );
  return Boolean(match && match[1] === threadId);
}

/** Render-time check: an audio file, played with an audio player rather than shown. */
export function isAudioUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && /\.(weba|ogg|oga|opus|m4a|aac|mp3)(?:\?|#|$)/i.test(url);
}
