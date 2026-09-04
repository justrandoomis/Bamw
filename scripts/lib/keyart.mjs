/**
 * Wide key art, from a game's own official site.
 *
 * Nintendo's store record has no banner candidate — `media-candidates.mjs` says
 * so in as many words, that a screenshot is not key art and is not promoted
 * into that role. Every game probed carried a cover, a square and six
 * screenshots, and zero banners. So banners come from the publisher's own page
 * or they do not come at all.
 *
 * Two rules decide what counts, and both are conservative on purpose. A wrong
 * banner is worse than a missing one: a missing banner leaves a gap, a wrong
 * one puts a screenshot or somebody else's art at the top of a product page.
 *
 *   1. **Shape.** Key art is wide. Anything under 1.6:1, or narrower than 1000
 *      pixels, is not a banner whatever it is named.
 *   2. **Provenance.** The share card (`og:image`, `twitter:image`) is the image
 *      a publisher chose to represent the game, and paths naming key art, hero,
 *      banner or kv are labelled as such by the people who made them. An image
 *      that is merely wide is not accepted on shape alone.
 */

const KEY_ART_PATH = /(key[-_]?art|keyvisual|key[-_]?visual|\bkv\b|hero|banner|masthead|billboard|splash|cover[-_]?art|logo[-_]?art)/i;

/** Absolute, http(s), no data: or blob: */
function absolute(url, base) {
  try {
    const u = new URL(String(url).trim(), base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Every image the page points at, with why it might be key art.
 *
 * Reads the share card, `<img>` (including the largest entry of a srcset), and
 * CSS `background-image`, because a hero is as often a background as an img.
 */
export function keyArtCandidates(html, pageUrl) {
  const out = new Map();
  const add = (raw, provenance, weight) => {
    const url = absolute(raw, pageUrl);
    if (!url) return;
    const prior = out.get(url);
    if (!prior || weight > prior.weight) out.set(url, { url, provenance, weight });
  };

  /* The share card: the single image a publisher chose to represent the game. */
  for (const m of html.matchAll(
    /<meta[^>]+(?:property|name)=["'](og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)["']/gi,
  )) {
    add(m[2], `official site share card (${m[1]})`, 3);
  }
  for (const m of html.matchAll(
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](og:image(?::secure_url)?|twitter:image(?::src)?)["']/gi,
  )) {
    add(m[1], `official site share card (${m[2]})`, 3);
  }

  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const srcset = /srcset=["']([^"']+)["']/i.exec(tag)?.[1];
    if (srcset) {
      /* The last entry of a srcset is conventionally the largest. */
      const biggest = srcset.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
      if (biggest) add(biggest, "official site <img srcset>", KEY_ART_PATH.test(biggest) ? 2 : 1);
    }
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src) add(src, "official site <img>", KEY_ART_PATH.test(src) ? 2 : 1);
  }

  for (const m of html.matchAll(/background-image\s*:\s*url\((["']?)([^"')]+)\1\)/gi)) {
    add(m[2], "official site CSS background", KEY_ART_PATH.test(m[2]) ? 2 : 1);
  }

  return [...out.values()].sort((a, b) => b.weight - a.weight);
}

/** Wide enough, big enough, and labelled or chosen as key art — not merely wide. */
export function isKeyArt({ width, height, url, weight }) {
  if (!width || !height) return { ok: false, why: "no dimensions" };
  const ratio = width / height;
  if (width < 1000) return { ok: false, why: `only ${width}px wide` };
  if (ratio < 1.6) return { ok: false, why: `${ratio.toFixed(2)}:1 is not wide` };
  if (weight >= 2 || KEY_ART_PATH.test(url)) return { ok: true, why: "named or chosen as key art" };
  return { ok: false, why: "wide, but nothing says it is key art rather than a screenshot" };
}
