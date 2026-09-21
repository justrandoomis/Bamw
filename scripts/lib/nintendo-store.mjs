/**
 * Reads a Nintendo of America store page and returns the one product it is about.
 *
 * The page ships its entire GraphQL cache in `__NEXT_DATA__`, so nothing here
 * scrapes markup. The cache holds dozens of products — the page's own, plus
 * every cross-sell and best-seller carousel — which is why the product is
 * selected by `urlKey`/nsuid and never by "the first Product node". Picking the
 * wrong node would attach another game's screenshots to this one.
 */

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const NINTENDO_ASSET_BASE = "https://assets.nintendo.com/image/upload";

/** Trademark symbols and punctuation Nintendo drops from its own url keys. */
export function slugifyTitle(title) {
  return (
    String(title ?? "")
      // Before NFKD, which decomposes ™ into the letters "TM".
      .replace(/[™®©]/g, "")
      .normalize("NFKD")
      .replace(/['’]/g, "")
      .replace(/&/g, " and ")
      // Nintendo writes "Mario + Rabbids" as "mario-plus-rabbids".
      .replace(/\+/g, " plus ")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
  );
}

/** Comparable form of a title: no marks, no spacing, no edition noise. */
export function normalizeTitle(title) {
  return String(title ?? "")
    .replace(/[™®©]/g, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export async function fetchText(url, { timeoutMs = 30_000, retries = 2 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
        signal: ctl.signal,
      });
      if (res.status === 404) return { status: 404, body: null };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, body: await res.text() };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 0, body: null, error: String(lastErr?.message ?? lastErr) };
}

export async function fetchBinary(url, { timeoutMs = 45_000, retries = 2 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error("empty body");
      return { ok: true, buffer: buf, contentType: res.headers.get("content-type") ?? "" };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: String(lastErr?.message ?? lastErr) };
}

function nextData(html) {
  const m = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** Follows Apollo `__ref` pointers so a caller sees values, not cache keys. */
export function deref(state, node, depth = 0) {
  if (depth > 6 || node == null) return node;
  if (Array.isArray(node)) return node.map((n) => deref(state, n, depth + 1));
  if (typeof node !== "object") return node;
  if (typeof node.__ref === "string") return deref(state, state[node.__ref], depth + 1);
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = deref(state, v, depth + 1);
  return out;
}

/**
 * @returns {null | {product: object, state: object, urlKey: string}}
 *   `product` is the page's own product with refs resolved one level deep.
 */
export function parseStorePage(html, { urlKey } = {}) {
  const data = nextData(html);
  const state = data?.props?.pageProps?.initialApolloState;
  if (!state) return null;

  const products = Object.entries(state).filter(
    ([k, v]) => k.startsWith("Product:") && v && typeof v === "object",
  );
  if (!products.length) return null;

  const wantKey = String(urlKey ?? data?.query?.slug ?? "").replace(/^\/|\/$/g, "");
  let hit = products.find(([, v]) => String(v.urlKey ?? "") === wantKey);
  if (!hit) {
    // The canonical url is authoritative when the url key was redirected.
    const canonical = data?.props?.pageProps?.linkedData?.[0]?.offers?.url ?? "";
    const fromCanonical = canonical.match(/\/store\/products\/([^/]+)\//)?.[1];
    if (fromCanonical) hit = products.find(([, v]) => String(v.urlKey ?? "") === fromCanonical);
  }
  if (!hit) return null;

  return { product: deref(state, hit[1], 0), state, urlKey: String(hit[1].urlKey ?? "") };
}

const cloudinary = (publicId, transform = "f_auto,q_auto") =>
  `${NINTENDO_ASSET_BASE}/${transform}/${String(publicId).replace(/^\/+/, "")}`;

/**
 * Screenshots only.
 *
 * `productGallery` interleaves trailer videos with screenshots, and the first
 * image is usually the same asset as `productImage` — the box art. Neither
 * belongs in a screenshot gallery, so both are dropped, and the cover is
 * returned separately for the roles that want it.
 */
export function galleryFrom(product) {
  const gallery = Array.isArray(product?.productGallery) ? product.productGallery : [];
  const coverId = String(product?.productImage?.publicId ?? "").replace(/^\/+/, "");
  const seen = new Set();
  const shots = [];
  for (const asset of gallery) {
    if (!asset || asset.resourceType !== "image") continue;
    const publicId = String(asset.publicId ?? "").replace(/^\/+/, "");
    if (!publicId || /\/Video\//i.test(publicId)) continue;
    if (publicId === coverId) continue;
    if (seen.has(publicId)) continue;
    seen.add(publicId);
    shots.push({ publicId, url: cloudinary(publicId) });
  }
  return shots;
}

export function coverFrom(product) {
  const publicId = String(product?.productImage?.publicId ?? "").replace(/^\/+/, "");
  const direct = String(product?.productImage?.url ?? "");
  return publicId ? cloudinary(publicId) : direct || null;
}

export function squareFrom(product) {
  const square = product?.['productImage({"shape":"square"})'];
  const url = String(square?.url ?? "");
  return url || null;
}

const PLATFORM_2 = /switch\s*2|nintendo_switch_2/i;
const isSwitch2 = (text) => PLATFORM_2.test(String(text ?? ""));

const bytesToGb = (n) => Math.round((Number(n) / 1024 ** 3) * 100) / 100;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/**
 * Nintendo's description is HTML; the storefront renders descriptions as text.
 *
 * Storing the markup verbatim would put literal `<p>` and `<br>` on the page,
 * so the tags become paragraph breaks and the entities become characters. No
 * words are removed.
 */
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n\n")
    .replace(/<\s*li\s*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#?\w+);/g, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Only what the page states outright. Nothing is inferred or averaged. */
export function metadataFrom(product) {
  const out = {};
  const put = (k, v) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string" && !v.trim()) return;
    if (Array.isArray(v) && !v.length) return;
    out[k] = v;
  };

  put("nsuid", product.nsuid);
  put("product_code", product.productCode);
  put("title_id", product.applicationId);
  put("publisher", product.softwarePublisher);
  put("developer", product.softwareDeveloper);
  put("edition", product.edition);
  put("tagline", product.headline);
  put("officialUrl", product.officialSite);
  put("nintendoEshopUrl", product.seo?.canonicalUrl);

  if (product.releaseDate) put("releaseDate", String(product.releaseDate).slice(0, 10));

  const genres = (product.tags?.genres ?? []).map((g) => g?.label).filter(Boolean);
  put("genres", genres);

  const rating = product.contentRating?.label ?? product.contentRating?.code;
  if (rating) put("ageRating", String(rating));

  const langs = Array.isArray(product.supportedLanguages) ? product.supportedLanguages : [];
  put("supportedLanguages", langs);
  if (langs.length) put("arabicSupport", langs.some((l) => /arabic/i.test(String(l))));

  const description = htmlToText(product['description({"html":true})'] ?? product.description);
  put("description", description);
  put("description_short", product.metaDescription);

  const sys = product.numberOfPlayers?.system;
  if (sys && (sys.min || sys.max)) {
    const min = Number(sys.min ?? 1);
    const max = Number(sys.max ?? min);
    put("numberOfPlayers", max > min ? `${min}-${max}` : String(min));
  }
  const local = Number(product.numberOfPlayers?.local?.max);
  if (Number.isFinite(local)) put("mpLocalPlayers", local);
  const online = Number(product.numberOfPlayers?.online?.max);
  if (Number.isFinite(online)) put("mpOnlinePlayers", online);

  const modes = (product.playModes ?? []).map((m) => String(m?.code ?? ""));
  if (modes.length) {
    put("nintendoPlayModes", (product.playModes ?? []).map((m) => m?.label).filter(Boolean));
    put("tvMode", modes.includes("TV_MODE"));
    put("tabletopMode", modes.includes("TABLETOP_MODE"));
    put("handheldMode", modes.includes("HANDHELD_MODE"));
  }

  const nso = (product.nsoFeatures ?? []).map((f) => String(f?.code ?? ""));
  if (product.nsoFeatures) put("nintendoCloudSaves", nso.includes("SAVE_DATA_CLOUD"));

  /*
    A cross-generation title carries a rom size for each console: HAC is the
    Nintendo Switch build, BEE the Nintendo Switch 2 build, and they differ —
    Metroid Prime 4 is 26.35 GB on one and 27.66 GB on the other. Taking the
    first row would put the wrong download size on one of the two editions.
  */
  const wantRom = isSwitch2(product.platform?.code ?? product.platform?.label ?? "") ? "BEE" : "HAC";
  const romSizes = product.softwareDetails?.romSizes ?? [];
  const rom =
    romSizes.find((r) => r?.totalRomSize && r.platform === wantRom) ??
    romSizes.find((r) => r?.totalRomSize);
  if (rom) {
    const gb = bytesToGb(rom.totalRomSize);
    put("size", `${gb} GB`);
    put("downloadSizeGb", gb);
    put("requiredSpaceGb", gb);
    put("microSdRecommended", gb >= 8);
  }

  /*
    `compatibility` in our schema is a list of compatible devices, not prose, so
    Nintendo's caption — "Supported – Game behavior is consistent with Nintendo
    Switch." — belongs in the Nintendo notes instead of overwriting a device list.
  */
  const compat = product.compatibility?.caption;
  if (compat) put("nintendoNotes", String(compat));

  const dlc = (product.downloadableContents ?? [])
    .map((d) => ({ name: d?.name, description: d?.description ?? "" }))
    .filter((d) => d.name);
  put("dlc", dlc);

  const editions = (product.variations ?? [])
    .map((v) => ({ name: v?.label }))
    .filter((e) => e.name);
  put("editionsList", editions);

  return out;
}

/* --------------------------------------------------- identity and resolution */

/** Edition wording differs between our titles and Nintendo's; compare the game. */
/**
 * This shop's own console bracket: `[Switch]`, `[Switch 2]`, `(Nintendo Switch)`.
 *
 * Only at the end, and only inside a bracket. A bare "switch" is left alone
 * because it is a word in real titles — `1-2-Switch`, `Nintendo Switch Sports`
 * — and removing it from those would make them match the wrong pages.
 */
const PLATFORM_BRACKET = /\s*[[(]\s*(?:nintendo\s*)?switch\s*2?\s*[\])]\s*$/i;

const bareTitle = (title) =>
  normalizeTitle(
    String(title ?? "")
      // Before the platform words are stripped: Nintendo writes "Switch™ 2",
      // and a mark sitting inside the phrase stops it matching.
      .replace(/[™®©]/g, "")
      /*
        The bracket comes off here too, not only when building the url key.

        `candidateKeys` already dropped it, so `9 R.I.P. [Switch]` found the
        right page — and then `identityMatch` refused it, because the rules
        below strip "nintendo switch" and "switch 2" but not a bare
        "[Switch]": "9ripswitch" is not "9rip". Half a fix reads exactly like
        no fix in the report, and that is what the first apply run showed.
      */
      .replace(PLATFORM_BRACKET, "")
      .replace(/[-–—:]\s*nintendo\s*switch\s*2\s*edition.*$/i, "")
      .replace(/\bnintendo\s*switch\s*2\s*edition\b/gi, "")
      .replace(/\b(standard|deluxe|digital|physical|complete|definitive|gold|ultimate)\s+edition\b/gi, "")
      .replace(/\bswitch\s*2\b/gi, "")
      .replace(/\bnintendo\s*switch\b/gi, ""),
  );

/* --------------------------------------------------------------- resolution */

/**
 * Url keys Nintendo might be using for this title, most likely first.
 *
 * Several bases are tried rather than one, because no single rule survives the
 * catalogue. Stripping the console words out of the title is what finds
 * "Breath of the Wild – Nintendo Switch 2 Edition", and is exactly wrong for
 * "Nintendo Switch Sports" and "Everybody 1-2-Switch!", where those words are
 * the game's name. Both spellings are offered and the first that answers wins.
 */
export function candidateKeys(doc) {
  const title = String(doc.title ?? doc.name ?? "");
  const two = isSwitch2(`${doc.platform ?? ""} ${title} ${doc.slug ?? ""}`);

  const stored = [doc.nintendoEshopUrl, doc.eshopUrl, doc.officialUrl]
    .map((u) => String(u ?? "").match(/nintendo\.com\/[^\s"']*\/store\/products\/([^/?#]+)/i)?.[1])
    .filter(Boolean);

  const bases = [];
  const addBase = (text) => {
    const slug = slugifyTitle(text);
    if (slug && !bases.includes(slug)) bases.push(slug);
  };

  /*
    This shop's own platform bracket comes off first.

    Fifteen hundred rows arrived from the supplier's sheet with the console in
    square brackets — `9 R.I.P. [Switch]`, `Resident Evil Requiem [Switch 2]`.
    Left on, the bracket becomes part of the slug and the shapes below then add
    the console a second time: `9-r-i-p-switch-switch`, which is not a page.
    The measured effect was exact — plain `9 R.I.P.` resolved and both of its
    bracketed siblings did not.

    Only a bracket that names a console is removed. `Absolute Fear -AOONI-
    (最恐 -青鬼-)` keeps its parenthetical, because that is part of the name,
    and `two` above has already read the bracket for the generation.
  */
  const withoutBracket = title.replace(PLATFORM_BRACKET, "");
  // The edition suffix is dropped: it comes back as its own key shape below.
  const withoutEdition = withoutBracket.replace(
    /[-–—:]?\s*\bnintendo\s*switch\s*2\s*edition\b.*$/i,
    "",
  );
  addBase(withoutEdition);
  // Console words removed, for the titles where they are packaging, not a name.
  addBase(
    withoutEdition
      .replace(/\bnintendo\s*switch\s*2\b/gi, "")
      .replace(/\bnintendo\s*switch\b/gi, "")
      .replace(/\bswitch\s*2\b/gi, ""),
  );
  const fromSlug = String(doc.slug ?? "").replace(/-switch(-2)?$/, "");
  if (fromSlug) addBase(fromSlug);

  const keys = [...stored];
  for (const base of bases) {
    const shapes = two
      ? [`${base}-switch-2`, `${base}-nintendo-switch-2-edition-switch-2`, `${base}-switch`]
      : [`${base}-switch`, `${base}-switch-2`];
    for (const k of shapes) if (!keys.includes(k)) keys.push(k);
    // "+" is spelled out in Nintendo's keys, but not always.
    const bare = base.replace(/-plus-/g, "-");
    if (bare !== base) {
      const k = two ? `${bare}-switch-2` : `${bare}-switch`;
      if (!keys.includes(k)) keys.push(k);
    }
  }
  // Enough shapes to find the page; not so many that a missing game costs a
  // dozen requests before it is reported.
  return keys.filter(Boolean).slice(0, 10);
}

export function apolloProducts(html) {
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { nodes: [], state: null };
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return { nodes: [], state: null };
  }
  const state = data?.props?.pageProps?.initialApolloState;
  if (!state) return { nodes: [], state: null };
  const nodes = Object.entries(state)
    .filter(([k, v]) => k.startsWith("Product:") && v && typeof v === "object")
    .map(([, v]) => v);
  return { nodes, state };
}


/**
 * Scores a candidate node against the stored product.
 *
 * `nsuid` is definitive when we hold one. Without it both the title and the
 * platform generation have to agree — a Switch 2 product filled from the
 * Switch 1 page would take the wrong screenshots and the wrong download size,
 * and the two are genuinely separate editions in this catalogue.
 */
export function identityMatch(doc, node) {
  /*
    Two products store "See regional Nintendo eShop listing" in `nsuid`. That is
    a note to a reader, not an identifier, and treating it as one would report a
    conflict with every page and block the real id from ever being filled in. An
    nsuid is a number.
  */
  const asNsuid = (v) => (/^\d{6,}$/.test(String(v ?? "").trim()) ? String(v).trim() : "");
  const storedNsuid = asNsuid(doc.nsuid);
  const nodeNsuid = asNsuid(node.nsuid);
  if (storedNsuid && nodeNsuid && storedNsuid === nodeNsuid) {
    return { ok: true, confidence: "nsuid", reason: "nsuid matches" };
  }
  const nsuidConflict = Boolean(storedNsuid && nodeNsuid && storedNsuid !== nodeNsuid);

  const want = bareTitle(doc.title ?? doc.name);
  const got = bareTitle(node.name);
  if (!want || !got) return { ok: false, reason: "no comparable title" };
  /*
    Equality, not containment.

    Containment read "Xenoblade Chronicles 2" as a match for "Xenoblade
    Chronicles: Definitive Edition" — the edition words come off, leaving
    "xenobladechronicles", which "xenobladechronicles2" contains. The two are
    different games, and that write put one game's screenshots, download size
    and release date on the other. Every sequel in the catalogue is one
    substring away from its predecessor: Pikmin 4 and Pikmin, Persona 5 Royal
    and Persona 5, Mario Kart World and Mario Kart.

    A title that does not match exactly is reported and left alone. Missing a
    page costs a report line; taking the wrong one corrupts a product.
  */
  if (want !== got) return { ok: false, reason: `title "${node.name}" is not "${doc.title}"` };

  const wantTwo = isSwitch2(`${doc.platform ?? ""} ${doc.title ?? ""} ${doc.slug ?? ""}`);
  const gotTwo = isSwitch2(`${node.platform?.label ?? node.platform?.code ?? ""} ${node.name ?? ""}`);
  if (wantTwo !== gotTwo) {
    return { ok: false, reason: `platform generation differs (stored ${wantTwo ? "Switch 2" : "Switch"}, page ${gotTwo ? "Switch 2" : "Switch"})` };
  }
  /*
    A stored nsuid that disagrees with the page is usually a regional id — the
    same game, a different storefront — not a different game, because the title
    and the console both agree. That is worth acting on for screenshots and
    stated facts, and worth reporting; it is never worth overwriting our own
    nsuid from, so the caller is told and leaves that one field alone.
  */
  return nsuidConflict
    ? {
        ok: true,
        confidence: "title+platform",
        nsuidConflict: true,
        storedNsuid,
        pageNsuid: nodeNsuid,
        reason: `title and platform agree, but the stored nsuid ${storedNsuid} is not the page's ${nodeNsuid}`,
      }
    : { ok: true, confidence: "title+platform", reason: "title and platform agree" };
}

const STORE = "https://www.nintendo.com/us/store/products";

/**
 * Finds the game's own store page.
 *
 * A page carries its whole product family in the GraphQL cache, but only the
 * page's own node is hydrated — siblings arrive with an empty gallery. So a
 * matching sibling is not used directly: its url key is followed and that page
 * is fetched instead. This is what makes a Switch 2 Edition resolvable from the
 * Switch 1 url key.
 *
 * A url key ending in a bare number is a physical or bundle SKU — the boxed
 * copy, or the console-plus-game bundle. Those nodes match the title, carry no
 * nsuid and have no gallery of their own, and filling a game from one gives it
 * the bundle's editions and the box's artwork. The software node, the one with
 * an nsuid, is always preferred.
 */
export async function resolveProduct(doc, seen = new Set()) {
  const tried = [];
  for (const key of candidateKeys(doc)) {
    if (seen.has(key)) continue;
    seen.add(key);
    const url = `${STORE}/${key}/`;
    const { status, body } = await fetchText(url);
    if (!body) {
      tried.push(`${key} → HTTP ${status}`);
      continue;
    }

    const { nodes, state } = apolloProducts(body);
    const own = nodes.find((n) => String(n.urlKey ?? "") === key);
    const ownVerdict = own ? identityMatch(doc, own) : { ok: false, reason: "the page has no node for this url key" };

    // A sibling worth hopping to: it matches, and it is more of a product than
    // whatever this page is about — an nsuid where the page's own node has none.
    const better = nodes.find(
      (n) =>
        n.urlKey &&
        String(n.urlKey) !== key &&
        !seen.has(String(n.urlKey)) &&
        identityMatch(doc, n).ok &&
        String(n.nsuid ?? "") &&
        !String(own?.nsuid ?? ""),
    );
    if (better) {
      tried.push(`${key} → ${status}, hopping to the software listing ${better.urlKey}`);
      const hop = await resolveProduct({ ...doc, slug: "", nintendoEshopUrl: `${STORE}/${better.urlKey}/`, eshopUrl: "", officialUrl: "" }, seen);
      if (hop.product) return { ...hop, tried: [...tried, ...hop.tried] };
      tried.push(...hop.tried);
    }

    if (ownVerdict.ok) {
      tried.push(`${key} → ${status}, matched`);
      const product = deref(state, own);
      /*
        Only the relatives. The cache holds every cross-sell and best-seller on
        the page, and dereferencing fifty unrelated products to find one upgrade
        pack costs more than the page fetch did.
      */
      const wanted = bareTitle(own.name);
      const family = nodes
        .filter((n) => n !== own && bareTitle(n.name).includes(wanted) && wanted)
        .map((n) => deref(state, n, 2));
      return { product, family, url, key, verdict: ownVerdict, tried };
    }
    tried.push(`${key} → ${status}, rejected: ${ownVerdict.reason}`);

    // The right edition may be a different member of the family on this page.
    const sibling = nodes.find(
      (n) => n.urlKey && String(n.urlKey) !== key && !seen.has(String(n.urlKey)) && identityMatch(doc, n).ok,
    );
    if (sibling) {
      const hop = await resolveProduct({ ...doc, slug: "", nintendoEshopUrl: `${STORE}/${sibling.urlKey}/`, eshopUrl: "", officialUrl: "" }, seen);
      if (hop.product) return { ...hop, tried: [...tried, ...hop.tried] };
      tried.push(...hop.tried);
    }
  }
  return { product: null, tried };
}

/**
 * What the rest of the product family says about this one.
 *
 * A "Nintendo Switch 2 Edition Upgrade Pack" is its own listing with its own
 * price, which is the only place the upgrade price is written down. Its mere
 * existence also settles two flags: the game is enhanced for Switch 2, and it
 * is not exclusive to it, because there is a Switch 1 copy to upgrade from.
 *
 * Nothing is concluded from absence. A game with no upgrade pack on the page is
 * not thereby exclusive — it may simply not have one listed — so
 * `switch2Exclusive` is only ever reported as false, never as true.
 */
const isSwitch2Edition = (name) =>
  // The mark in "Switch™ 2" sits inside the phrase, so it comes off first.
  /nintendo\s*switch\s*2\s*edition/i.test(String(name ?? "").replace(/[™®©]/g, ""));

export function familyFacts(product, family = []) {
  const out = {};
  const wanted = bareTitle(product?.name);
  if (!wanted) return out;

  const upgrade = family.find(
    (n) => /upgrade\s*pack/i.test(String(n?.name ?? "")) && bareTitle(n.name).includes(wanted),
  );
  if (upgrade) {
    const priceKey = Object.keys(upgrade).find((k) => k.startsWith("prices"));
    const price = Number(upgrade[priceKey]?.finalPrice ?? upgrade[priceKey]?.regularPrice);
    if (Number.isFinite(price)) out.switch2UpgradePrice = price;
    out.switch2Enhanced = true;
    out.switch2Exclusive = false;
  } else if (isSwitch2Edition(product?.name)) {
    // The edition exists because a Switch 1 version does.
    out.switch2Enhanced = true;
    out.switch2Exclusive = false;
  }
  return out;
}
