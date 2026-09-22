/**
 * Sending a member the steps of one login method, with a way back to it.
 *
 * The admin could already type instructions into the order conversation, and
 * that is what they did: the same fifteen steps, retyped or pasted, every time,
 * getting shorter as the evening got longer. The owner asked for the steps to
 * be SENT — from the guide the shop actually publishes — with a button on the
 * message that opens that method at `/account_guides`.
 *
 * Both halves matter. The text is what a member reads in the conversation
 * without leaving it; the button is what they open when a step needs the
 * pictures, and it is a deep link to that method rather than to the top of a
 * page with six of them on it.
 *
 * The steps are rendered from the guide record on the SERVER at the moment of
 * sending. An admin cannot send a method the shop does not publish, and cannot
 * send a stale copy of one — but the message keeps the text it was sent with,
 * because a conversation is a record of what was said, not a live view of a
 * document someone may edit tomorrow.
 */
import { guideAnchor, guideSteps } from "./siteGuides";
import type { GuideItem } from "./content";

/** The `body` of an `instructions` message that carries a guide. */
export interface GuideMessageBody {
  text: string;
  /** The guide's id, so a client can tell this apart from free text. */
  guideId: string;
  /** What the button says. */
  guideTitle: string;
  /** The fragment the button links to: `/account_guides#<anchor>`. */
  guideAnchor: string;
}

/** Where a guide lives, as a path a link can use. */
export function guidePath(anchor: string): string {
  const clean = String(anchor || "")
    .replace(/^#/, "")
    .trim();
  return clean ? `/account_guides#${clean}` : "/account_guides";
}

/**
 * The steps of a guide as plain numbered text.
 *
 * Plain on purpose: this lands in a chat bubble, is forwarded to Telegram and
 * is read on a phone, and none of those places render markdown the same way.
 * A step with no title falls back to its description, and a step with neither
 * is dropped rather than sent as a bare number.
 */
export function guideStepsText(guide: GuideItem): string {
  const lines: string[] = [];
  const title = String(guide.title_ar || guide.title_en || "").trim();
  if (title) lines.push(title);

  const description = String(guide.description_ar || "").trim();
  if (description) lines.push(description);

  let number = 0;
  for (const step of guideSteps(guide)) {
    const heading = String(step.title_ar || "").trim();
    const detail = String(step.description_ar || "").trim();
    if (!heading && !detail) continue;
    number++;
    lines.push(
      heading && detail ? `${number}. ${heading} — ${detail}` : `${number}. ${heading || detail}`,
    );
  }

  if (number === 0) return title || description;
  return lines.join("\n");
}

/** The message body to store for this guide. */
export function guideMessageBody(guide: GuideItem): GuideMessageBody {
  return {
    text: guideStepsText(guide),
    guideId: String(guide.id ?? ""),
    guideTitle: String(guide.title_ar || guide.title_en || guide.id || ""),
    guideAnchor: guideAnchor(guide),
  };
}

/**
 * Read a stored body back, tolerating every shape the field has ever held.
 *
 * `instructions` messages predate this and carry `{ text }` alone; those are
 * still instructions and still render, they simply have no button. Anything
 * that is not a usable string is treated as absent rather than printed.
 */
export function readGuideMessage(body: unknown): {
  text: string;
  guideTitle: string;
  href: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const text = typeof record["text"] === "string" ? record["text"] : "";
  const anchor = typeof record["guideAnchor"] === "string" ? record["guideAnchor"] : "";
  const guideTitle = typeof record["guideTitle"] === "string" ? record["guideTitle"] : "";
  if (!text && !anchor) return null;
  return {
    text,
    guideTitle: guideTitle || "شرح الطريقة",
    /*
      An empty anchor means an older instructions message, or one an admin
      typed themselves. It gets no button rather than a button to nowhere.
    */
    href: anchor ? guidePath(anchor) : "",
  };
}
