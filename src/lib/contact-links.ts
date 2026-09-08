/**
 * A seller types a handle. The shop builds the link.
 *
 * On a used listing the seller is asked how to reach them — Telegram, a phone
 * number, Facebook, Instagram — and asking them for a full URL gets you
 * `t.me/ali`, `@ali`, `https://t.me/ali?start=x` and `ali` from four different
 * people for the same account. So they type whatever they have and this
 * normalises it to one handle, then builds the address itself.
 *
 * **Building rather than accepting is the security property.** The value comes
 * from a member and lands in an `href` on a public page. If the stored string
 * were used as the link, `javascript:...` would run on click and
 * `https://not-the-shop.example/pay` would read as the seller's Instagram. So
 * nothing here ever passes a URL through: a handle is validated against the
 * shape that platform allows, and the link is assembled from a constant
 * prefix. Anything that does not fit is refused with a reason the seller can
 * act on, never quietly half-accepted.
 */

import { normalizePhone } from "./phone";

export const CONTACT_CHANNELS = ["telegram", "whatsapp", "phone", "facebook", "instagram"] as const;

export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export interface ContactLink {
  channel: ContactChannel;
  /** What the seller gave, cleaned: a handle, or a number in E.164. */
  handle: string;
  /** What to put in href. Always built here from `handle`. */
  href: string;
  /** What to show on the button. */
  label: string;
}

export const CONTACT_LABEL_AR: Record<ContactChannel, string> = {
  telegram: "تلغرام",
  whatsapp: "واتساب",
  phone: "اتصال",
  facebook: "فيسبوك",
  instagram: "إنستغرام",
};

/**
 * Hosts whose paths are a handle, so a pasted profile URL can be reduced to
 * one. A host not listed for that channel is refused rather than trusted.
 */
const HOSTS: Record<ContactChannel, string[]> = {
  telegram: ["t.me", "telegram.me", "telegram.dog"],
  whatsapp: ["wa.me", "api.whatsapp.com", "whatsapp.com"],
  phone: [],
  facebook: ["facebook.com", "www.facebook.com", "fb.com", "m.facebook.com", "web.facebook.com"],
  instagram: ["instagram.com", "www.instagram.com", "instagr.am"],
};

/** Handle shapes, as each platform actually allows them. */
const SHAPES: Record<ContactChannel, RegExp> = {
  telegram: /^[a-zA-Z0-9_]{4,32}$/,
  whatsapp: /^\+[0-9]{8,15}$/,
  phone: /^\+[0-9]{8,15}$/,
  // Facebook allows dots and a numeric profile id.
  facebook: /^(?:[a-zA-Z0-9.]{5,50}|[0-9]{5,20})$/,
  instagram: /^[a-zA-Z0-9._]{1,30}$/,
};

/** Arabic-Indic and Persian digits, so a number typed in Arabic still parses. */
function westernDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Reduces whatever was typed to the handle inside it.
 *
 * Deliberately tolerant about the *wrapper* — a full URL, a bare handle, an
 * `@`, a trailing slash, a query string — and strict about the handle itself.
 * A URL is only unwrapped when its host is one this channel actually uses;
 * `https://evil.example/ali` is not an Instagram handle however it is spelled.
 */
function extractHandle(channel: ContactChannel, raw: string): string | null {
  let value = westernDigits(String(raw ?? "")).trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value) || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return null;
    }
    /*
      Only http(s). A `javascript:` or `data:` string that happens to contain a
      slash must not reach the handle path — the shapes below would reject its
      characters anyway, but refusing the scheme outright is the check that
      does not depend on a regex staying correct.
    */
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!HOSTS[channel].includes(host)) return null;
    value = decodeURIComponent(url.pathname).replace(/^\/+/, "").replace(/\/+$/, "");
    /*
      `facebook.com/profile.php?id=100001234567` names a profile by number, and
      the path is the script rather than the handle — so the id is where the
      answer is. Checked before the empty-path case, because the path is not
      empty here: it is `profile.php`, which would otherwise have been accepted
      as somebody's vanity name.
    */
    if (channel === "facebook" && (value === "profile.php" || !value)) {
      value = url.searchParams.get("id") ?? "";
    }
    if (channel === "whatsapp" && !value) value = url.searchParams.get("phone") ?? "";
    // A path with more than one segment is not a profile.
    if (value.includes("/")) return null;
  }

  value = value.replace(/^@+/, "").trim();
  return value || null;
}

/**
 * One contact button, or `null` when there is nothing usable.
 *
 * `null` rather than a thrown error: a seller filling in three of four fields
 * is the normal case, and an empty box is not a mistake to report.
 */
export function buildContactLink(channel: ContactChannel, raw: string): ContactLink | null {
  if (!CONTACT_CHANNELS.includes(channel)) return null;
  const extracted = extractHandle(channel, raw);
  if (!extracted) return null;

  if (channel === "whatsapp" || channel === "phone") {
    const phone = normalizePhone(extracted);
    if (!phone || !SHAPES[channel].test(phone)) return null;
    return {
      channel,
      handle: phone,
      // wa.me wants the digits without the plus; tel: wants it with.
      href: channel === "whatsapp" ? `https://wa.me/${phone.slice(1)}` : `tel:${phone}`,
      label: CONTACT_LABEL_AR[channel],
    };
  }

  const handle = extracted;
  if (!SHAPES[channel].test(handle)) return null;

  const href =
    channel === "telegram"
      ? `https://t.me/${handle}`
      : channel === "instagram"
        ? `https://instagram.com/${handle}`
        : `https://facebook.com/${handle}`;

  return { channel, handle, href, label: CONTACT_LABEL_AR[channel] };
}

/**
 * Every usable button from what the seller filled in, in a fixed order.
 *
 * Fixed so the buttons do not reshuffle between listings, and filtered so a
 * field the seller left blank — or filled in with something unusable — simply
 * has no button rather than a dead one.
 */
export function buildContactLinks(
  contact: Record<string, unknown> | null | undefined,
): ContactLink[] {
  if (!contact || typeof contact !== "object") return [];
  const links: ContactLink[] = [];
  for (const channel of CONTACT_CHANNELS) {
    const raw = contact[channel];
    if (typeof raw !== "string") continue;
    const link = buildContactLink(channel, raw);
    if (link) links.push(link);
  }
  return links;
}

/**
 * What to store for a listing: the cleaned handles, keyed by channel.
 *
 * Stored cleaned rather than raw so the value is validated once, at the point
 * the seller typed it, instead of on every render — and so an edit that breaks
 * a handle is refused while they are looking at it.
 */
export function normalizeContact(
  contact: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const link of buildContactLinks(contact)) out[link.channel] = link.handle;
  return out;
}
