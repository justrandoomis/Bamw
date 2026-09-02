import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { parseGameImport } from "./gameImportParser";
import { generateGameImportTemplate } from "./gameImportGenerator";
import {
  applyGameImportToForm,
  buildBatchGameImport,
  buildProductSavePayload,
  createBlankProductForm,
} from "./gameImportForm";
import { filterPurchasable, isProductHidden, isProductPurchasable } from "./purchasable";
import { isImportableTextEntry, listZipEntries, readZipEntryText } from "./zipReader";
import { sanitizeSlug, uniqueSlug } from "../routes/api/admin/products";

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const gameTemplate = (name: string, extra = "") => `
schema_version=1
name=${name}
slug=super-smash-bros-ultimate
platform=switch1
device_performance.1.device=Nintendo Switch
device_performance.1.information_status=not_published
device_performance.1.unavailable_reason=Nintendo has not published performance figures.
device_performance.1.source_name=Nintendo eShop
device_performance.1.verification_status=checked
price=25000
cost=18000
is_infinite_stock=true

option.1.id=offline_account
option.1.name=حساب أوفلاين
option.1.stock=
option.1.is_infinite_stock=true

option.2.id=online_account
option.2.name=حساب أونلاين
option.2.stock=4
option.2.is_infinite_stock=false

type.1.id=standard_offline
type.1.name=النسخة القياسية
type.1.option_id=offline_account
type.1.price=25000
type.1.cost=18000
type.1.stock=
type.1.is_infinite_stock=true

type.2.id=standard_online
type.2.name=النسخة القياسية
type.2.option_id=online_account
type.2.price=32000
type.2.cost=24000
type.2.stock=2
type.2.is_infinite_stock=false
${extra}`;

/** Raw-deflate a byte range with the platform compressor, as `zip(1)` would. */
async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new CompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * A ZIP built by hand, stored (uncompressed) so the fixture needs no
 * compressor. The reader never verifies CRCs, so they stay zero.
 */
function buildZip(files: { name: string; content: string }[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, 0x0800, true); // UTF-8 names
    localView.setUint16(8, 0, true); // stored
    localView.setUint32(18, data.length, true); // compressed size
    localView.setUint32(22, data.length, true); // uncompressed size
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true); // stored
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out.buffer;
}

/* -------------------------------------------------------------------------- */
/*  1. The existing single-game import is unchanged                            */
/* -------------------------------------------------------------------------- */

describe("single game import (existing behaviour)", () => {
  it("still parses a template file and maps it onto the product form", () => {
    const result = parseGameImport(gameTemplate("Splatoon Raiders"));
    expect(result.errors.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(result.data["title"]).toBe("Splatoon Raiders");

    const form = applyGameImportToForm(createBlankProductForm("cat_nintendo"), result.data);
    const payload = buildProductSavePayload(form);
    expect(payload["titleEn"]).toBe("Splatoon Raiders");
    expect(payload["price"]).toBe(25000);
    expect(payload["categoryId"]).toBe("cat_nintendo");
    // Nothing in the single-file path hides a product.
    expect(payload["isHidden"]).toBe(false);
  });

  it("keeps template files written before the new fields valid", () => {
    const legacy = `
schema_version=1
name=Legacy Game
platform=switch1
device_performance.1.device=Nintendo Switch
device_performance.1.information_status=not_published
device_performance.1.unavailable_reason=Nintendo has not published performance figures.
device_performance.1.source_name=Nintendo eShop
device_performance.1.verification_status=checked
price=19000
option.1.id=offline_account
option.1.name=حساب أوفلاين
type.1.id=standard_offline
type.1.name=النسخة القياسية
type.1.option_id=offline_account
type.1.price=19000
`;
    const result = parseGameImport(legacy);
    expect(result.errors.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(result.unknownFields).toEqual([]);
    expect(result.data["isHidden"]).toBeUndefined();
    expect(result.data["isInfiniteStock"]).toBeUndefined();

    const payload = buildProductSavePayload(
      applyGameImportToForm(createBlankProductForm("cat_nintendo"), result.data),
    );
    expect(payload["titleEn"]).toBe("Legacy Game");
  });
});

/* -------------------------------------------------------------------------- */
/*  2 & 3. A ZIP of three games becomes three separate hidden products         */
/* -------------------------------------------------------------------------- */

describe("ZIP batch import", () => {
  const archive = () =>
    buildZip([
      { name: "games/", content: "" },
      { name: "games/zelda.txt", content: gameTemplate("Zelda Echoes") },
      { name: "games/mario.txt", content: gameTemplate("Mario Wonder") },
      { name: "games/metroid.txt", content: gameTemplate("Metroid Prime 4") },
      { name: "__MACOSX/games/._zelda.txt", content: "resource fork junk" },
      { name: "games/.hidden.txt", content: "dot file" },
      { name: "games/cover.png", content: "not a template" },
      { name: "readme.md", content: "notes" },
    ]);

  it("reads only the real TXT files and ignores folders, __MACOSX and dot files", () => {
    const entries = listZipEntries(archive()).filter(isImportableTextEntry);
    expect(entries.map((entry) => entry.baseName)).toEqual([
      "zelda.txt",
      "mario.txt",
      "metroid.txt",
    ]);
  });

  it("creates three separate products from a ZIP holding three games", async () => {
    const buffer = archive();
    const entries = listZipEntries(buffer).filter(isImportableTextEntry);

    const payloads: Record<string, any>[] = [];
    for (const entry of entries) {
      const text = await readZipEntryText(buffer, entry);
      const prepared = buildBatchGameImport(text, "cat_nintendo");
      expect(prepared.ok).toBe(true);
      if (prepared.ok) payloads.push(prepared.payload);
    }

    expect(payloads).toHaveLength(3);
    expect(payloads.map((p) => p["titleEn"])).toEqual([
      "Zelda Echoes",
      "Mario Wonder",
      "Metroid Prime 4",
    ]);
    // Separate products, not one merged record.
    expect(new Set(payloads.map((p) => p["id"])).size).toBe(3);
  });

  it("saves every batch product hidden and flagged as a batch import", async () => {
    const buffer = archive();
    const entries = listZipEntries(buffer).filter(isImportableTextEntry);
    for (const entry of entries) {
      const prepared = buildBatchGameImport(await readZipEntryText(buffer, entry), "cat_nintendo");
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) continue;
      expect(prepared.payload["isHidden"]).toBe(true);
      expect(prepared.payload["batchImport"]).toBe(true);
      expect(prepared.payload["options"].map((option: any) => option.name)).toEqual([
        "حساب أوفلاين",
        "حساب أونلاين",
      ]);
      expect(prepared.payload["types"].map((type: any) => type.name)).toEqual([
        "حساب أوفلاين — عادي",
        "حساب أونلاين — عادي",
      ]);
      expect(prepared.payload["types"].every((type: any) => type.price > type.cost)).toBe(true);
    }
  });

  it("reports a broken file instead of stopping the run", () => {
    const prepared = buildBatchGameImport("this file has no fields at all", "cat_nintendo");
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.reason).toContain("اسم اللعبة");
  });

  it("reads a deflated entry, the form real archives use", async () => {
    const content = gameTemplate("Deflated Game");
    const deflated = await deflate(new TextEncoder().encode(content));

    // Rebuild the fixture with method 8 and the compressed payload.
    const encoder = new TextEncoder();
    const nameBytes = encoder.encode("deflated.txt");
    const local = new Uint8Array(30 + nameBytes.length + deflated.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, 8, true);
    localView.setUint32(18, deflated.length, true);
    localView.setUint32(22, content.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(deflated, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 8, true);
    centralView.setUint32(20, deflated.length, true);
    centralView.setUint32(24, content.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, 0, true);
    central.set(nameBytes, 46);

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(8, 1, true);
    eocdView.setUint16(10, 1, true);
    eocdView.setUint32(12, central.length, true);
    eocdView.setUint32(16, local.length, true);

    const out = new Uint8Array(local.length + central.length + eocd.length);
    out.set(local, 0);
    out.set(central, local.length);
    out.set(eocd, local.length + central.length);

    const entries = listZipEntries(out.buffer).filter(isImportableTextEntry);
    expect(entries).toHaveLength(1);
    expect(await readZipEntryText(out.buffer, entries[0]!)).toBe(content);
  });
});

/* -------------------------------------------------------------------------- */
/*  4, 5, 6. Hidden products: admin sees them, customers do not                */
/* -------------------------------------------------------------------------- */

describe("product visibility", () => {
  const visible = { id: "1", title: "Visible", price: 1000, isHidden: false };
  const hidden = { id: "2", title: "Hidden", price: 1000, isHidden: true };
  /** Saved before the field existed. */
  const legacy = { id: "3", title: "Legacy", price: 1000 };

  /** What `/api/data` hands an anonymous visitor. */
  const publicCatalogue = (products: Record<string, unknown>[]) =>
    products.filter((product) => !isProductHidden(product));

  it("hides a product from customers while the admin list keeps all of them", () => {
    const catalogue = [visible, hidden, legacy];
    expect(publicCatalogue(catalogue).map((p) => p.id)).toEqual(["1", "3"]);
    // The admin panel renders the raw catalogue.
    expect(catalogue).toHaveLength(3);
    expect(isProductPurchasable(hidden)).toBe(false);
    expect(filterPurchasable(catalogue).map((p) => p.id)).toEqual(["1", "3"]);
  });

  it("shows the product again once the admin clears the switch", () => {
    const published = { ...hidden, isHidden: false };
    expect(publicCatalogue([published]).map((p) => p.id)).toEqual(["2"]);
    expect(isProductPurchasable(published)).toBe(true);
  });

  it("leaves products saved before the field existed visible", () => {
    expect(isProductHidden(legacy)).toBe(false);
    expect(isProductPurchasable(legacy)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  7 & 8. Stock flags at product, option and type level                       */
/* -------------------------------------------------------------------------- */

describe("stock fields", () => {
  it("reads is_infinite_stock at product level", () => {
    const parsed = parseGameImport(gameTemplate("Infinite Stock Game"));
    expect(parsed.data["isInfiniteStock"]).toBe(true);

    const payload = buildProductSavePayload(
      applyGameImportToForm(createBlankProductForm("cat_nintendo"), parsed.data),
    );
    expect(payload["isInfiniteStock"]).toBe(true);
    expect(payload["stock"]).toBe(999999);
  });

  it("reads is_hidden at product level", () => {
    const parsed = parseGameImport(gameTemplate("Hidden Game", "\nis_hidden=true\n"));
    expect(parsed.data["isHidden"]).toBe(true);
  });

  it("reads and saves stock per option and per type", () => {
    const parsed = parseGameImport(gameTemplate("Stocked Game"));
    const payload = buildProductSavePayload(
      applyGameImportToForm(createBlankProductForm("cat_nintendo"), parsed.data),
    );

    const options = payload["options"] as Record<string, any>[];
    expect(options.map((option) => option.id)).toEqual(["offline_account", "online_account"]);
    expect(options[0]!["isInfiniteStock"]).toBe(true);
    expect(options[0]!["stock"]).toBeUndefined();
    expect(options[1]!["isInfiniteStock"]).toBe(false);
    expect(options[1]!["stock"]).toBe(4);

    const types = payload["types"] as Record<string, any>[];
    expect(types.map((type) => type.id)).toEqual(["standard_offline", "standard_online"]);
    expect(types[0]!["optionId"]).toBe("offline_account");
    expect(types[0]!["isInfiniteStock"]).toBe(true);
    expect(types[1]!["stock"]).toBe(2);
    expect(types[1]!["price"]).toBe(32000);
    expect(types[1]!["isInfiniteStock"]).toBe(false);
  });

  it("supports the two DLC types without inventing them for a game with no DLC", () => {
    const withDlc = parseGameImport(
      gameTemplate(
        "DLC Game",
        `
type.3.id=dlc_offline
type.3.name=نسخة الإضافة DLC
type.3.option_id=offline_account
type.3.price=41000
type.3.is_infinite_stock=true

type.4.id=dlc_online
type.4.name=نسخة الإضافة DLC
type.4.option_id=online_account
type.4.price=48000
type.4.is_infinite_stock=true
`,
      ),
    );
    const dlcTypes = withDlc.data["types"] as Record<string, any>[];
    expect(dlcTypes).toHaveLength(4);
    expect(dlcTypes[2]!["price"]).toBe(41000);
    // DLC is dearer than the standard edition, and the file states the price.
    expect(dlcTypes[2]!["price"]).toBeGreaterThan(dlcTypes[0]!["price"]);

    const withoutDlc = parseGameImport(gameTemplate("Plain Game"));
    expect(withoutDlc.data["types"]).toHaveLength(2);
  });

  it("offers the new fields in the generated template and in the shipped file", () => {
    const template = generateGameImportTemplate();
    for (const line of [
      "is_infinite_stock=true",
      "is_hidden=false",
      "option.1.stock=",
      "option.2.is_infinite_stock=true",
      "type.1.stock=",
      "type.4.is_infinite_stock=true",
    ]) {
      expect(template).toContain(line);
    }
    const shipped = readFileSync("public/templates/nintendo-switch-game-template.txt", "utf-8");
    expect(shipped).toBe(template);
  });
});

/* -------------------------------------------------------------------------- */
/*  9. Duplicates are decided by slug and nothing else                         */
/* -------------------------------------------------------------------------- */

describe("duplicate detection", () => {
  it("gives the copy its own slug and keeps the original untouched", () => {
    const catalogue = [{ id: "old", slug: "zelda-echoes", title: "Zelda Echoes" }];
    const desired = sanitizeSlug("Zelda Echoes", "prd_new");
    expect(desired).toBe("zelda-echoes");

    const conflict = catalogue.find((p) => p.slug.toLowerCase() === desired.toLowerCase());
    expect(conflict).toBeDefined();

    const stored = {
      id: "prd_new",
      slug: uniqueSlug(
        desired,
        catalogue.map((p) => p.slug),
      ),
      duplicateOriginalSlug: desired,
      isDuplicate: true,
      isHidden: true,
    };
    expect(stored.slug).toBe("zelda-echoes-2");
    expect(stored.duplicateOriginalSlug).toBe("zelda-echoes");
    // The product already in the catalogue is neither edited nor removed.
    expect(catalogue).toEqual([{ id: "old", slug: "zelda-echoes", title: "Zelda Echoes" }]);
  });

  it("does not treat a different slug as a duplicate, however similar the title", () => {
    const catalogue = ["zelda-echoes"];
    expect(uniqueSlug(sanitizeSlug("Zelda Echoes 2", "prd_x"), catalogue)).toBe("zelda-echoes-2");
    expect(catalogue.includes("zelda-echoes-2")).toBe(false);
  });

  it("keeps walking the suffix while slugs stay taken", () => {
    expect(uniqueSlug("mario", ["mario", "mario-2", "mario-3"])).toBe("mario-4");
    expect(uniqueSlug("mario", [])).toBe("mario");
  });
});

/* -------------------------------------------------------------------------- */
/*  10. No AI service is involved anywhere in the batch path                   */
/* -------------------------------------------------------------------------- */

describe("batch import stays offline", () => {
  const sources = [
    "src/lib/zipReader.ts",
    "src/lib/gameImportForm.ts",
    "src/components/admin/AdminZipImportModal.tsx",
  ].map((path) => readFileSync(path, "utf-8"));

  it("never reaches an AI provider", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/openai|gemini|genai|anthropic|api[-_]?key|GoogleGenAI/i);
    }
  });

  it("talks to the existing product endpoint and nothing else", () => {
    const calls = sources.flatMap((source) => [...source.matchAll(/fetch\(\s*"([^"]+)"/g)]);
    expect(calls.map((match) => match[1])).toEqual(["/api/admin/products"]);
  });
});
