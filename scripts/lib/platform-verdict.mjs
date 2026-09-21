/**
 * What the evidence permits, decided without a network and without a database.
 *
 * «صحح التسميات والمنصات» — the owner's instruction, and the first honest
 * thing to say about it is that a platform is not a cosmetic field. It is half
 * of a product's identity: `productIdentityKeys` builds `platform::title`, and
 * the catalogue has a unique index on exactly that pair. Moving a game from
 * Switch 2 to Switch 1 moves it onto a key another product may already hold.
 *
 * So the rules below are written as refusals, and the collision check that
 * follows them in the caller is a separate refusal again. Every one of them
 * has the same shape: when the evidence does not settle the question, the
 * stored value stands.
 *
 * Nothing here reads or returns a price, a cost, a stock level, a visibility
 * flag, an option, a type, a trade-in value, a display order or a sales
 * figure. The only fields this file has an opinion about are `platform`,
 * `title` and `titleEn`.
 */

/** `[Switch]`, `[Switch 2]`, `(Nintendo Switch)` — the supplier's console column. */
export const CONSOLE_BRACKET = /\s*[[(]\s*(?:nintendo\s*)?switch\s*(2?)\s*[\])]\s*$/i;

/**
 * `[4:03]`, `[0:43 Switch 2]`, `[2:00 ¥14.64]`, `[1:21 狂乱命运]`.
 *
 * Found by the first full sweep of the names, and not previously known to be
 * there: twenty-eight products carry a video timestamp in their title, and
 * next to the timestamp sits whatever cell the scrape ran into — the console,
 * a Chinese name, or a price in yuan.
 *
 * None of it is part of a game's name, and two kinds of it should never have
 * been on a public page at all. `¥14.64` is a supplier cost. `狂乱命运` is the
 * Chinese supplier name, which this shop keeps deliberately out of the public
 * product API, off the product page, out of the public HTML, out of the cache
 * and out of search — and it is sitting in the product's title.
 *
 * The timestamp is what makes this safe to match: a real title does not carry
 * `m:ss` in square brackets. `Absolute Fear -AOONI- (最恐 -青鬼-)` keeps its
 * parenthetical, because there is no timestamp in it.
 */
export const TIMESTAMP_BRACKET = /\s*\[\s*\d{1,2}:\d{2}(?:\s+([^\]]*?))?\s*\]\s*/;

/** The fragment beside a timestamp, when it is only naming the console. */
const CONSOLE_WORD = /^(?:nintendo\s*)?switch\s*(2?)$/i;

/** A fragment that should never have reached a customer: a cost, or the supplier's name. */
const SUPPLIER_FRAGMENT = /[¥$€£]|[\u3400-\u9FFF\u3040-\u30FF]/;

/** "Nintendo Switch 2 Edition" — a separate SKU, never a synonym for the console. */
const EDITION = /nintendo\s*switch\s*2\s*edition/i;

export const isEditionTitle = (title) => EDITION.test(String(title ?? "").replace(/[™®©]/g, ""));

/**
 * The console a product's own record claims, beyond the `platform` field.
 *
 * A Switch 2 Edition is a distinct product with its own price and its own
 * cartridge. "Switch 2 Enhanced" is not: it is the SAME Switch 1 cartridge
 * running better on newer hardware, and reading it as a console would move
 * hundreds of Switch 1 games onto a shelf they do not belong on. Only the
 * edition counts.
 */
export function declaresSwitch2Edition(product) {
  if (isEditionTitle(product?.title) || isEditionTitle(product?.titleEn)) return true;
  const switch2 = product?.switch2;
  if (switch2 && typeof switch2 === "object" && switch2.isSwitch2Edition === true) return true;
  return false;
}

/**
 * Whether to move a product's platform, given what Nintendo actually lists.
 *
 * @param ours       the stored platform, already through `normalizeProductPlatform`
 * @param evidence   generations seen by any Nintendo source: [] | ["switch1"] | ["switch2"] | both
 * @param complete   false when a request never arrived, so a gap is ignorance, not absence
 * @param isEdition  true when this product is a Nintendo Switch 2 Edition SKU
 */
export function platformVerdict({ ours, evidence = [], complete = true, isEdition = false }) {
  const seen = [...new Set(evidence)].sort();

  /*
    A request that failed in transport is not an answer. This is the guard the
    square-card filler learned the hard way: `Prison Architect → HTTP 0 · HTTP
    0` was once recorded as "Nintendo has nothing". Recording it as "Nintendo
    has no Switch 2 version" would be worse — it would write a wrong label
    rather than merely fail to write a right one.
  */
  if (!complete) {
    return { action: "report", reason: "a request never arrived, so the absence proves nothing" };
  }
  if (seen.length === 0) {
    return {
      action: "keep",
      reason: "neither Nintendo store lists this exact title, and no evidence is not evidence",
    };
  }
  if (seen.includes(ours)) {
    return { action: "keep", reason: `Nintendo lists this title on ${seen.join(" and ")}` };
  }

  /*
    An Edition can only be a Switch 2 product — that is what the words in its
    name mean. The generation readers already refuse to call an Edition row
    Switch 1, so this cannot be reached today; it is here so that a future
    change to those readers fails closed rather than silently demoting every
    Edition in the catalogue.
  */
  if (isEdition && !seen.includes("switch2")) {
    return {
      action: "report",
      reason: "the title says Nintendo Switch 2 Edition but no Switch 2 row was found",
    };
  }
  if (isEdition) return { action: "flip", to: "switch2", reason: "a Nintendo Switch 2 Edition" };

  /*
    "both" is not a console, so `seen` can never contain it and the check above
    cannot vindicate it. It is vindicated by Nintendo carrying the title on
    both consoles — which the first dry run found for RAIDOU Remastered and
    which this reported as a fault until it did.

    When Nintendo carries only one, the label still stands. Nearly every Switch
    1 game is playable on a Switch 2, so a shop selling one for both consoles
    is making a commercial statement about what it will sell, not a claim about
    Nintendo's catalogue, and that is the owner's to make.
  */
  if (ours === "both") {
    if (seen.length > 1) {
      return { action: "keep", reason: "Nintendo lists this title on both consoles" };
    }
    return {
      action: "report",
      reason: `the shop sells this for both consoles; Nintendo lists it only on ${seen[0] === "switch2" ? "Nintendo Switch 2" : "Nintendo Switch"}`,
    };
  }
  if (seen.length === 1) {
    return {
      action: "flip",
      to: seen[0],
      reason: `Nintendo lists this title only on ${seen[0] === "switch2" ? "Nintendo Switch 2" : "Nintendo Switch"}`,
    };
  }
  return {
    action: "report",
    reason: `stored as "${ours}", which is neither of the consoles Nintendo lists it on`,
  };
}

/**
 * Whether to take the supplier's console bracket out of a displayed name.
 *
 * `9 R.I.P. [Switch]` is not the game's name. The bracket is the console
 * column of the sheet fifteen hundred rows arrived in, and the shop already
 * has a field for that — which is the one the shelf badge reads. Leaving it in
 * the title shows it twice and, as the square-card runs measured, sends the
 * wrong slug to Nintendo.
 *
 * It is removed only when it AGREES with the platform. A bracket that says
 * Switch 2 on a Switch 1 product is the last remaining record of a
 * disagreement, and deleting it would destroy the evidence rather than settle
 * it — so that one is reported and left exactly as it is.
 */
export function titleVerdict(title, platform) {
  const raw = String(title ?? "");
  if (!raw) return { action: "keep" };

  /*
    The scraped timestamp comes off first, because in several titles it IS the
    console bracket — `Chained Together [0:43 Switch 2]` — and the plain
    console pattern below cannot see it behind the `0:43`.
  */
  let working = raw;
  let leaked = "";
  const stamp = TIMESTAMP_BRACKET.exec(working);
  if (stamp) {
    const fragment = String(stamp[1] ?? "").trim();
    const console = CONSOLE_WORD.exec(fragment);
    if (console) {
      /*
        The fragment names a console, so it is the same claim the plain bracket
        makes and it is held to the same rule: a bracket that disagrees with
        the platform is the last record of a disagreement, and deleting it
        would destroy the evidence rather than settle it. It carries no cost
        and no supplier name, so holding it costs nothing.
      */
      const bracket = console[1] ? "switch2" : "switch1";
      if (platform !== "both" && bracket !== platform) {
        return {
          action: "report",
          reason: `the name says ${bracket === "switch2" ? "Switch 2" : "Switch"} but the product is ${platform}`,
        };
      }
    } else if (SUPPLIER_FRAGMENT.test(fragment)) {
      leaked = fragment;
    }
    working = working.replace(TIMESTAMP_BRACKET, " ");
  }

  const match = CONSOLE_BRACKET.exec(working);

  if (match) {
    const bracket = match[1] ? "switch2" : "switch1";
    if (platform !== "both" && bracket !== platform) {
      return {
        action: "report",
        reason: `the name says ${bracket === "switch2" ? "Switch 2" : "Switch"} but the product is ${platform}`,
      };
    }
  }

  /*
    The bracket, then the spacing. Collapsing runs of whitespace and trimming
    the ends is safe in a way nothing else here is: `normalizeProductTitle`
    already collapses whitespace before it builds an identity key, so a
    whitespace-only change cannot move a product onto a different key and
    cannot collide with anything. It is still put through the same collision
    check as every other correction, because the rule should not depend on
    that remaining true.
  */
  const withoutBracket = match ? working.replace(CONSOLE_BRACKET, "") : working;
  const tidied = withoutBracket.replace(/\s+/g, " ").trim();

  if (!tidied) return { action: "keep", reason: "there would be no name left" };
  if (tidied === raw) return { action: "keep" };
  return {
    action: "rename",
    to: tidied,
    ...(leaked ? { leaked } : {}),
    reason: leaked
      ? `a scraped timestamp, and beside it "${leaked}" — supplier data, on a public name`
      : stamp
        ? "a scraped video timestamp is not part of the name"
        : match
          ? "the console belongs in the platform field"
          : "the name carries stray whitespace",
  };
}

/**
 * Faults in a name worth a person's eye, reported and never acted on.
 *
 * Each of these has more than one plausible repair, and choosing between them
 * is a judgement about a shop's own copy rather than something a rule can
 * settle. `Ã©` may be a mangled `é` or may be what the publisher actually
 * wrote; an all-capitals title may be shouting or may be the logo. So they are
 * counted and listed, and the stored name stands.
 */
export function titleFlags(title) {
  const raw = String(title ?? "");
  const flags = [];
  if (!raw.trim()) return ["empty"];
  // The classic UTF-8-read-as-Latin-1 signatures.
  if (/[ÃÂ]\s*[\u0080-\u00BF]|â€|ï»¿|\uFFFD/.test(raw)) flags.push("mojibake");
  // The console as prose rather than as a bracket: "Foo for Nintendo Switch".
  if (/\b(?:for|on)\s+(?:the\s+)?nintendo\s+switch\s*2?\s*$/i.test(raw)) {
    flags.push("console in prose");
  }
  const letters = raw.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 6 && /\p{Lu}/u.test(letters) && !/\p{Ll}/u.test(letters)) {
    flags.push("all capitals");
  }
  const leftover = raw.replace(CONSOLE_BRACKET, "").replace(TIMESTAMP_BRACKET, " ");
  if (/\[[^\]]*\]/.test(leftover)) flags.push("another bracket");
  return flags;
}

/**
 * Drop every correction that would land on an identity something else holds.
 *
 * Not one product at a time against the catalogue as it stands. Two
 * corrections in the same batch can land on the same identity, and each would
 * look safe measured against the other's OLD key — which is how a duplicate
 * gets created by a run whose every individual check passed.
 *
 * So the catalogue this run WOULD produce is built, and any proposal sharing a
 * key with anything else is dropped. Dropping restores that product's old key,
 * which can itself collide with a proposal that survived, so the check repeats
 * until nothing more is dropped.
 *
 * A key already shared by two products with no proposal between them is a
 * duplicate that predates this run. It is reported and nothing is done about
 * it: a duplicate may already carry orders, favourites and reviews, and
 * deciding which copy keeps them is a person's judgement, not a script's.
 *
 * @param products  the whole catalogue, not just the audited slice
 * @param proposals Map of product id → patch; mutated, the drops are removed
 * @param keysOf    the application's own `productIdentityKeys`
 * @returns the dropped proposals and the duplicates that were already there
 */
export function settleCollisions(products, proposals, keysOf) {
  const dropped = [];
  const preexisting = [];

  const finalOf = (product) => {
    const patch = proposals.get(String(product?.id ?? ""));
    return {
      id: product?.id,
      title: patch && "title" in patch ? patch.title : product?.title,
      titleEn: patch && "titleEn" in patch ? patch.titleEn : product?.titleEn,
      platform: patch && "platform" in patch ? patch.platform : product?.platform,
    };
  };

  for (let pass = 0; pass < 20; pass++) {
    const owners = new Map();
    for (const product of products) {
      const id = String(product?.id ?? "");
      if (!id) continue;
      for (const key of keysOf(finalOf(product))) {
        if (!owners.has(key)) owners.set(key, []);
        owners.get(key).push(id);
      }
    }

    let removed = 0;
    for (const [key, ids] of owners) {
      if (ids.length < 2) continue;
      const withProposal = ids.filter((id) => proposals.has(id));
      if (withProposal.length === 0) {
        if (pass === 0) preexisting.push({ key, ids });
        continue;
      }
      for (const id of withProposal) {
        dropped.push({ id, key, held: ids.filter((other) => other !== id) });
        proposals.delete(id);
        removed += 1;
      }
    }
    if (!removed) break;
  }

  return { dropped, preexisting };
}
