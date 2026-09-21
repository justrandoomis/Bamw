/**
 * Finds, validates and stores one game's media, and returns the fields to save.
 *
 * The order matters and is the point of the module: nothing reaches a product
 * document until the bytes have been fetched, proved to be an image of the
 * right shape for the role, converted, uploaded and read back out of R2. A URL
 * is never written on the strength of looking like one.
 *
 * Region is deliberately not a selection criterion for artwork. A US sleeve is
 * the same game as a Japanese one, and the account's region governs language,
 * not which packshot is correct.
 */

import { createHash } from "node:crypto";

import { candidatesFor, validateCandidate } from "./media-candidates.mjs";
import { cropFrontPanel, fetchWrap, gameTdbId } from "./gametdb-source.mjs";
import { resolveProduct } from "./nintendo-store.mjs";

/** Roles in the order they are filled, so the dedup check is deterministic. */
export const ROLES = [
  "cartridgeImage",
  "nintendoCardImage",
  "coverImage",
  "coverHiResImage",
  "bannerImages",
  "galleryImages",
];

const LIST_ROLES = new Set(["bannerImages", "galleryImages"]);

const slugForKey = (role, index) =>
  ({
    cartridgeImage: "front-box",
    nintendoCardImage: "square-card",
    coverImage: "cover",
    coverHiResImage: "3d-wrap",
    bannerImages: `banner-${index}`,
    galleryImages: `gallery-${index}`,
  })[role] ?? role;

/** The two roles cut out of the printed GameTDB sleeve rather than the eShop. */
const WRAP_ROLES = new Set(["coverHiResImage", "cartridgeImage"]);

/**
 * @param identity  {title, platform, slug, nsuid} — enough to resolve the game
 * @param deps      {sharp, r2, apply, log, roles}
 *
 * `roles` narrows the run to a subset of {@link ROLES}; it defaults to all of
 * them, so an importer filling a new product is unaffected. Asking for one
 * role is not an optimisation dressed up as an option: a repair that fills
 * the square card must not also rewrite the cover, the banners and the
 * gallery of a product whose owner only asked for the one missing picture.
 * It also skips the GameTDB sleeve download when no role is cut from it,
 * which is most of the wall clock for a single-role run.
 *
 * @returns {Promise<{patch: object, report: object[], unresolved: string[], stored: number, failed: number}>}
 */
export async function buildMedia(
  identity,
  { sharp, r2, apply = false, log = () => {}, roles = ROLES },
) {
  const report = [];
  const unresolved = [];
  const patch = {};
  let stored = 0;
  let failed = 0;

  /* Keep ROLES' order whatever order the caller listed them in. */
  const wanted = ROLES.filter((role) => roles.includes(role));
  if (!wanted.length) {
    return { patch, report, unresolved: [], stored: 0, failed: 0, note: "no roles requested" };
  }

  const resolved = await resolveProduct(identity);
  if (!resolved.product) {
    return {
      patch,
      report,
      unresolved: [...wanted],
      stored: 0,
      failed: 0,
      note: `no Nintendo store page resolved (${resolved.tried.join("; ")})`,
    };
  }
  const product = resolved.product;
  const accepted = new Map(); // content hash -> role that took it

  /* ---- the printed sleeve, which the eShop never carries ---- */
  let wrapBuffer = null;
  let frontBuffer = null;
  let wrapNote = "";
  const tdbId = wanted.some((role) => WRAP_ROLES.has(role)) ? gameTdbId(product.productCode) : "";
  if (tdbId) {
    const wrap = await fetchWrap(tdbId);
    if (wrap) {
      wrapBuffer = wrap.buffer;
      wrapNote = `GameTDB coverfullHQ ${wrap.region} (${wrap.url})`;
      try {
        frontBuffer = await cropFrontPanel(wrap.buffer, sharp);
      } catch (err) {
        log(`front panel crop failed: ${String(err).slice(0, 80)}`);
      }
    }
  }

  const put = async (role, buffer, index, note, sourceUrl) => {
    let out;
    try {
      out = await sharp(buffer).webp({ quality: 90 }).toBuffer();
    } catch (err) {
      failed++;
      report.push({ role, ok: false, reason: `conversion failed: ${String(err).slice(0, 60)}`, source: sourceUrl });
      return null;
    }
    const meta = await sharp(out).metadata().catch(() => ({}));
    const hash = createHash("sha256").update(out).digest("hex").slice(0, 16);
    const taken = accepted.get(hash);
    if (taken) {
      report.push({ role, ok: false, reason: `identical bytes already used for ${taken}`, source: sourceUrl });
      return null;
    }
    const key = `files/products/${identity.id}/${slugForKey(role, index)}-${hash}.webp`;
    if (apply) {
      if (!(await r2.put(key, out, "image/webp"))) {
        failed++;
        report.push({ role, ok: false, reason: "R2 store or read-back failed", source: sourceUrl });
        return null;
      }
      stored++;
    }
    accepted.set(hash, role);
    report.push({
      role,
      ok: true,
      width: meta.width,
      height: meta.height,
      bytes: out.length,
      note,
      source: sourceUrl,
      key: `/api/${key}`,
      verified: apply,
    });
    return `/api/${key}`;
  };

  /* ---- roles the sleeve answers ---- */
  if (wrapBuffer) {
    const wrapRef = await put("coverHiResImage", wrapBuffer, 0, wrapNote, wrapNote);
    if (wrapRef) patch.coverHiResImage = wrapRef;
  }
  if (frontBuffer) {
    const frontRef = await put("cartridgeImage", frontBuffer, 0, `front panel of the ${wrapNote}`, wrapNote);
    if (frontRef) patch.cartridgeImage = frontRef;
  }

  /* ---- roles the eShop answers ---- */
  const candidates = candidatesFor(product);
  for (const role of wanted) {
    if (patch[role]) continue;
    const list = candidates[role] ?? [];
    const kept = [];
    for (const [i, candidate] of list.entries()) {
      const v = await validateCandidate(candidate, role, sharp);
      if (!v.ok) {
        report.push({ role, ok: false, reason: v.reason || v.kind, source: candidate.url });
        continue;
      }
      if (!v.shapeOk) {
        report.push({ role, ok: false, reason: v.reason, source: candidate.url });
        continue;
      }
      const ref = await put(role, v.buffer, i + 1, candidate.provenance, candidate.url);
      if (!ref) continue;
      kept.push(LIST_ROLES.has(role) ? { url: ref, alt: `${identity.title ?? ""} ${role === "galleryImages" ? "screenshot" : "banner"} ${i + 1}` } : ref);
      if (!LIST_ROLES.has(role)) break;
    }
    if (!kept.length) {
      unresolved.push(role);
      continue;
    }
    patch[role] = LIST_ROLES.has(role) ? kept : kept[0];
  }

  return { patch, report, unresolved, stored, failed, resolvedUrl: resolved.url };
}
